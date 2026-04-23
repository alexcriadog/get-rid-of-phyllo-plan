# Ingestion Modes

**Status:** Stable reference
**Last updated:** 2026-04-23
**Answers question:** Q3 — How does data flow from each platform to the connector?

Platforms deliver data in three fundamentally different ways:
- **Push (webhook)** — the platform calls us when something happens
- **Pull (polling)** — we call the platform on a schedule and ask for new data
- **Hybrid** — webhook for "something new exists", polling for "give me the latest metrics"

No platform gives us everything via push. Metric updates (views, likes, followers growth) are always polling. Webhooks only tell us about **events** (new content exists, account disconnected, stream went live). This doc maps which modes each platform × data product supports and how the connector orchestrates them.

---

## 1. The matrix — platform × data product → modes available

| | Identity | Audience | Content **(new)** | Content **(metrics)** | Live / Stories |
|---|---|---|---|---|---|
| **Instagram** | POL | POL | **WH + POL** | POL | POL (Stories 1h) |
| **Facebook** | POL | POL | **WH + POL** | POL | — |
| **YouTube** | POL | POL | **WH (PubSubHubbub) + POL** | POL | — |
| **Twitch** | POL | POL (lim) | **WH (EventSub) + POL** | POL | **WH (EventSub)** |
| **TikTok** | POL | POL (lim) | POL (WH incomplete) | POL | — |

- **POL** = polling (scheduled sync job, cadence from [`refresh-cadence.md`](refresh-cadence.md))
- **WH** = webhook (platform pushes to us)
- **WH + POL** = **hybrid** — webhook for fast new-content detection, polling as safety net + for metrics

**Design principle:** polling always runs, even when webhooks are configured. Webhooks accelerate detection; they never *replace* polling. Platforms drop webhooks silently, change payload formats, or stop sending after subscription expiry. Polling is the ground truth.

---

## 2. Webhook ingestion architecture

Every connector API replica accepts inbound webhooks at `/webhooks/ingest/:platform`. Each platform's handler:

1. **Validates the signature** — per-platform scheme (see §5).
2. **ACKs immediately** (HTTP 200) within sub-second — platforms have strict timeouts (Meta: 5s, Twitch: 10s, YT PubSubHubbub: 15s).
3. **Extracts minimal identity** from the payload (e.g. `page_id`, `channel_id`, `broadcaster_user_id`).
4. **Resolves our internal account ID** via a lookup on `platform_external_id`.
5. **Enqueues** a BullMQ job with `priority=HIGH` to fetch the relevant data product.
6. **Records** the webhook delivery in `inbound_webhook_log` (event_id, platform, received_at, signature_valid, account_resolved).

The HTTP handler does **zero** external API work. If it needs more data than the payload gives, it enqueues a job and the worker fetches later.

```
 [Platform]  ─── POST /webhooks/ingest/:platform ──►  connector-api
                                                         │
                                                   ┌─────┴────┐
                                                   │ 1. verify sig
                                                   │ 2. parse payload
                                                   │ 3. lookup account
                                                   │ 4. enqueue HIGH job
                                                   │ 5. log to DB
                                                   │ 6. return 200
                                                   └─────┬────┘
                                                         │
                                                         ▼
                                              BullMQ `sync` queue
                                                         │
                                                         ▼
                                              connector-worker picks up,
                                              runs adapter.fetchContents()
                                              (respecting rate limits)
```

---

## 3. Per-platform webhook setup

### 3.1 Meta (Instagram + Facebook) — Graph API Webhooks

One subscription per product, per app. Subscriptions managed in Meta App Dashboard + via Graph API `/{app-id}/subscriptions`.

**Subscribed topics (phase 1):**
- `instagram` object, fields: `comments`, `media`, `mentions`, `story_insights`
- `page` object, fields: `feed`, `videos`, `live_videos`

**Per-account subscription:** after OAuth, the connector calls `POST /{page-id}/subscribed_apps` to activate webhooks for that specific page/business account. This is idempotent — calling it again on reconnect is safe.

**Inbound URL:** `https://connector.<env>.internal/webhooks/ingest/meta` (nginx routes this from public).

**Verification challenge:** Meta sends a `GET /webhooks/ingest/meta?hub.mode=subscribe&hub.verify_token=XXX&hub.challenge=YYY` once. The handler checks `hub.verify_token` against a secret in Secrets Manager and echoes `hub.challenge` back as plain text.

**Payload signature:** HMAC-SHA256 in `X-Hub-Signature-256: sha256=<hex>` header, computed over the raw request body using the **App Secret** (not our HMAC rotation secrets). Single secret, but rotatable at the app level.

**Payload shape (example — `instagram media`):**
```json
{
  "object": "instagram",
  "entry": [
    {
      "id": "17841405309211844",
      "time": 1713900000,
      "changes": [
        {
          "field": "media",
          "value": { "media_id": "17920123456789012", "verb": "add" }
        }
      ]
    }
  ]
}
```

**Important caveats:**
- Meta webhooks do **not** carry full data — just IDs and "something changed" signals. The worker must fetch the actual media via Graph API.
- Subscriptions expire silently if the page access token expires. The connector re-subscribes after every successful token refresh.
- Meta sometimes sends duplicates. Idempotency handled via `event_id = hash(entry.id + entry.time + changes)` persisted in `inbound_webhook_log` with a unique index.

### 3.2 YouTube — PubSubHubbub (Atom feed push)

YouTube uses the W3C PubSubHubbub 0.4 protocol via `https://pubsubhubbub.appspot.com/` to push notifications on new videos uploaded to a channel.

**Subscription:** per-channel, active for 5 days max. The connector's scheduler re-subscribes every 4 days per active channel via `POST` to the hub with `hub.mode=subscribe`, `hub.topic=https://www.youtube.com/xml/feeds/videos.xml?channel_id=<CHANNEL>`, `hub.callback=https://connector.<env>.internal/webhooks/ingest/youtube`.

**Verification challenge:** hub sends `GET /webhooks/ingest/youtube?hub.mode=subscribe&hub.challenge=YYY&hub.topic=...&hub.lease_seconds=...`. Echo challenge back.

**Inbound payload:** Atom XML with `<entry>` elements. The connector parses `<yt:videoId>` and `<yt:channelId>`, looks up the account, enqueues a fetch job to call the YouTube Data API for full metadata.

**Payload signature:** HMAC-SHA1 in `X-Hub-Signature: sha1=<hex>` header (note: SHA1, not SHA256 — legacy protocol). Computed over the raw body using a secret sent in the subscription's `hub.secret` parameter. Each subscription can have its own secret; we use one rotatable secret per env from Secrets Manager.

**Limits:**
- YouTube does **not** push on deletions, visibility changes, or metric updates. Only new-video notifications.
- Missed notifications are not retried by the hub. Polling is mandatory.

### 3.3 Twitch — EventSub (webhook transport)

Twitch's EventSub supports webhook, WebSocket, and conduit transports. We use **webhook** (simpler; doesn't need persistent connection).

**Subscriptions:** per-broadcaster, per-event-type. Created via `POST /helix/eventsub/subscriptions` with `type`, `version`, `condition`, `transport={method:'webhook', callback, secret}`. Each subscription costs **1 quota point** against a total limit (10,000 points per app; large room).

**Events we subscribe to (phase 1):**
- `stream.online` / `stream.offline` (live status)
- `channel.update` (title, game, tags)
- `channel.follow` v2 (requires moderator scope — skip if unavailable)
- `channel.subscribe` (if Affiliate/Partner scope granted)

**Inbound URL:** `https://connector.<env>.internal/webhooks/ingest/twitch`.

**Verification challenge:** Twitch sends an `webhook_callback_verification` event (HTTP POST with `Twitch-Eventsub-Message-Type: webhook_callback_verification`). Handler responds 200 with the `challenge` value from the JSON body as plain text within 10 seconds.

**Payload signature:** HMAC-SHA256 in `Twitch-Eventsub-Message-Signature: sha256=<hex>` over `{message_id}{timestamp}{body}`. Message ID in `Twitch-Eventsub-Message-Id`, timestamp in `Twitch-Eventsub-Message-Timestamp`. Per-subscription secret, rotatable via PATCH to the subscription.

**Duplicate detection:** use `Twitch-Eventsub-Message-Id` as the idempotency key. Twitch retries up to 3 times with jitter on non-2xx.

**Subscription lifecycle:** Twitch auto-revokes subscriptions after consecutive failed deliveries. The connector's scheduler monitors `Twitch-Eventsub-Subscription-Status` headers and recreates revoked subs.

### 3.4 TikTok — partial webhooks, polling-first

TikTok for Business / Creator API **does** expose webhooks but coverage is incomplete and documentation sparse. Known events:
- Video creation (Business account only, `video.publish`)
- Account disconnection

The connector **does not rely on TikTok webhooks** for phase 1. All TikTok ingestion is polling. If TikTok's webhook coverage improves, we add it as accelerator later — no core change, only adapter config update.

Inbound URL reserved but not registered: `https://connector.<env>.internal/webhooks/ingest/tiktok`.

---

## 4. Inbound URLs — nginx + security

nginx on the existing main-stack EC2 proxies:
```
/webhooks/ingest/meta    →  connector-api:3000/webhooks/ingest/meta
/webhooks/ingest/youtube →  connector-api:3000/webhooks/ingest/youtube
/webhooks/ingest/twitch  →  connector-api:3000/webhooks/ingest/twitch
/webhooks/ingest/tiktok  →  (reserved, not active)
```

**TLS:** public, Let's Encrypt. **Rate limiting at nginx level:** 100 req/s per platform endpoint (defensive DoS).
**Access log retention:** 30 days including body snippets (trimmed to 2KB) for forensics.

**Connector-api webhook handlers are lightweight and stateless** — they can be replicated horizontally without coordination. N replicas = N× throughput on webhook ingestion.

---

## 5. Signature verification — per-platform quirks

**All four platforms use HMAC but with different details.** A single `verifySignature()` helper won't work; each platform has its own verification function that the adapter supplies.

| Platform | Algo | Key source | Signed payload | Header |
|---|---|---|---|---|
| Meta | HMAC-SHA256 | App Secret (Secrets Manager) | raw body bytes | `X-Hub-Signature-256: sha256=<hex>` |
| YouTube PubSubHubbub | HMAC-SHA1 | `hub.secret` per subscription | raw body bytes | `X-Hub-Signature: sha1=<hex>` |
| Twitch EventSub | HMAC-SHA256 | Per-subscription secret | `{message_id}{timestamp}{raw_body}` | `Twitch-Eventsub-Message-Signature: sha256=<hex>` |
| TikTok | HMAC-SHA256 | App Secret | raw body bytes | `TikTok-Signature: sha256=<hex>` |

All comparisons **constant-time**. All HMAC computation on **raw body bytes**, not parsed JSON (parse-then-serialize would change whitespace and break signatures). Express/NestJS middleware must preserve the raw body — the signature verification runs before JSON parsing.

**Multi-secret rotation** (for our outbound signing) is described in [`08-operations/security.md`](08-operations/security.md). Inbound verification uses whatever secret the platform expects; rotation is per-platform procedure.

---

## 6. Polling architecture

Polling is orchestrated by the `connector-scheduler` loop and executed by `connector-worker`. It is the **default** mode for every product — webhooks layer on top.

```
connector-scheduler (every ~30s):
  SELECT id, account_id, product, cadence_override
  FROM sync_jobs
  WHERE next_run_at <= NOW()
  ORDER BY priority DESC, next_run_at ASC
  LIMIT 500

  For each row:
    enqueue BullMQ job { queue: 'sync', job_id, priority }
    mark row status='queued'
```

```
connector-worker (consumes 'sync' queue):
  1. Acquire Redis throttle lock `throttle:{account}:{product}` TTL 10min (see §8)
     if held: skip, re-enqueue with delay=lock_ttl + jitter
  2. Acquire rate-limit buckets (see rate-limiting.md §3)
     if denied: re-enqueue with delay=reset_in_ms
  3. Load token from oauth_tokens, decrypt, refresh if expired
  4. Call adapter.fetch{Profile,Audience,Contents,ContentMetrics}(...)
  5. Normalize response → upsert in connector DB
  6. Emit outbound events per change
  7. Release throttle lock
  8. UPDATE sync_jobs SET
       last_success_at=NOW(),
       next_run_at = NOW() + effective_cadence(account, product),
       status='idle'
```

Cadence computation is covered in [`refresh-cadence.md`](refresh-cadence.md).

---

## 7. Hybrid mode — webhook + polling coexisting

For IG, FB, YT, Twitch (`content_new`), both modes run simultaneously:

```
                   Webhook arrives    ┐
                   for `new_content`  │
                                      ▼
                             enqueue HIGH job
                                      │
                                      ▼
                            worker fetches latest
                                      │
                                      ▼
                   UPDATE sync_jobs SET
                     last_success_at = NOW(),
                     next_run_at = NOW() + effective_cadence()
                                      │
                                      ▼
                   (polling for THIS account + THIS product
                    is postponed by one cadence cycle because
                    the webhook already did the work)
```

**Key mechanic:** when a webhook triggers a successful fetch, we update `sync_jobs.next_run_at` the same way polling does. The scheduler sees the job is no longer due and skips it. **Polling is inhibited, not duplicated.**

If the webhook arrives while a polling job is already running for the same account+product, the throttle lock (§8) blocks the second one.

---

## 8. Throttle locks — prevent duplicate work

A 10-minute Redis lock per `(account_id, product)`. Mirrors the current `backend-api` behaviour (`webhook_throttle:content_added:{account_id}` TTL 600s) but generalized per-product.

```
Redis key:  throttle:{account_id}:{product}
SET NX EX 600

If acquired: proceed with fetch.
If NOT acquired: another worker/webhook already fetching this combo recently.
                 Skip work, log `throttle_skipped`, re-enqueue if polling.
                 Do NOT re-enqueue if webhook (platform will redeliver).
```

**Why 10 min:** balances "don't refetch constantly on duplicate webhooks" against "don't block legit manual refresh 10s later". Manual refresh endpoint uses a shorter separate lock (60s) — see [`manual-refresh.md`](manual-refresh.md).

**Crash safety:** lock has TTL, so worker crashes don't leave permanent locks. Worker does **not** release the lock early on completion — the TTL provides the cool-down window. If a legit rerun is needed within 10 min, the `/v1/accounts/:id/refresh` endpoint explicitly bypasses this lock (it has its own shorter anti-spam).

---

## 9. Fallback detection — "webhook went quiet"

If a webhook is expected but doesn't arrive, polling covers. But how do we know polling-plus-webhook-hybrid is actually working?

**Heartbeat metric per (platform, account, product):**
- `webhook_last_received_at` — updated every inbound webhook
- `expected_webhook_interval_ms` — e.g. 2× cadence for that product

Scheduler checks every 5 min:
```
For each (platform, account, product) where mode includes webhook:
  if now - webhook_last_received_at > 2 * expected_webhook_interval_ms:
    emit metric webhook_silent{platform, product}
    (polling is already catching this — no functional impact)
    log WARN "webhook silent for {account}/{product} — investigate"

  if now - webhook_last_received_at > 7 * 24h (week of silence):
    resubscribe automatically
    alert ops
```

Silent webhooks don't break correctness (polling runs). They signal a subscription-expiry or platform-config bug.

---

## 10. Idempotency — duplicates happen, must be safe

Every inbound webhook has a deterministic **`event_id`** derived from payload identity:

| Platform | Event ID derivation |
|---|---|
| Meta | `hash(entry.id + entry.time + changes[0].field + changes[0].value)` |
| YouTube | `hash(yt:videoId + published)` |
| Twitch | `Twitch-Eventsub-Message-Id` (provided by Twitch) |
| TikTok | `hash(event_type + user_id + content_id + created_time)` |

Stored in `inbound_webhook_log` with unique index on `(platform, event_id)`. Duplicate POSTs → unique-constraint violation → handler returns 200 ACK without enqueuing.

Adapter fetch logic is also idempotent: `fetchContents(...)` uses `INSERT ... ON DUPLICATE KEY UPDATE` on content IDs. Running the fetch twice converges to the same state.

---

## 11. Failure modes

| Scenario | Behavior | Remediation |
|---|---|---|
| Platform webhook down | Polling covers (hybrid) | No-op. Heartbeat metric alerts. |
| Platform webhook sends bad signature | 401 returned; platform retries; metric `webhook_signature_invalid_total` | Ops verifies secret rotation state; alert if rate >0 for 5min |
| Webhook storm (1000s/sec from one page) | nginx rate-limits at 100/s; excess returns 503 | Platforms retry with backoff; enqueue buffered |
| Subscription silently revoked | Heartbeat detects week-of-silence, auto-resubscribes | Ops alert if auto-resubscribe fails |
| Payload schema change on platform side | Adapter throws; job fails; DLQ | Ops alerted, update adapter |
| Our API replica crashes mid-processing | Webhook ACKed but job not enqueued | Polling catches it on next cadence; heartbeat notices brief silence |
| Clock skew on signature validation (Twitch) | Signatures include timestamp; >10min skew rejected | NTP on all hosts; alert if `webhook_timestamp_skew_total > 0` |

---

## 12. Operational knobs

- **Enable/disable webhook per platform:** `platform_ingestion_config.webhook_enabled = false` → only polling. Useful during Meta outages.
- **Force polling re-run:** ops API `POST /v1/admin/sync-jobs/:id/reenqueue`.
- **Resubscribe all webhooks per platform:** ops CLI `connector-cli webhooks resubscribe --platform=meta`.
- **Replay a webhook from log:** ops CLI `connector-cli webhooks replay --event-id=...`.

Runbook details in [`08-operations/runbook.md`](08-operations/runbook.md).

---

## 13. Decisions & alternatives

See [`adr/0011-hybrid-ingestion.md`](adr/0011-hybrid-ingestion.md) for why we chose **webhook + polling coexistence** over:
- Webhook-only (rejected — silent subscription failures would be undetected)
- Polling-only (rejected — freshness SLOs for new content require <2h detection, polling that frequently burns rate limits)
- Webhook-primary with polling only on silence (rejected — complexity of detecting "silence" reliably; current hybrid is simpler and defensively correct)

---

## 14. Related docs

- [`rate-limiting.md`](rate-limiting.md) — rate buckets that webhook-triggered fetches also respect
- [`refresh-cadence.md`](refresh-cadence.md) — how polling cadence is computed
- [`manual-refresh.md`](manual-refresh.md) — on-demand refresh, shorter lock window
- [`07-platforms/*.md`](07-platforms/) — per-platform webhook setup quirks
- [`06-event-catalog.md`](06-event-catalog.md) — outbound events emitted after ingestion
- [`08-operations/security.md`](08-operations/security.md) — HMAC secret rotation (outbound)
- [`08-operations/runbook.md`](08-operations/runbook.md) — resubscribe, replay, debug
