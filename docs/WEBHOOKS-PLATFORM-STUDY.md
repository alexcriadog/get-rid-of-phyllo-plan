# Platform Webhooks Study — beyond Meta (June 2026)

> Scope: INBOUND webhooks from platforms to us (`/webhooks/ingest/*`).
> For OUTBOUND client-facing webhooks see [webhooks.md](./webhooks.md).

Meta (FB/IG) webhooks are live (`POST /webhooks/ingest/meta`). This study covers the
remaining 5 platforms: what push/webhook surface each offers TODAY, and whether it is
worth implementing on our ingest infra.

Our infra is already generic: raw-body middleware applies to all of
`/webhooks/ingest/*` (`main.ts`), the route is public via Caddy's `/api/poc/*`
passthrough, and the pattern (verify signature → `recordWebhook` dedupe → map
event→product → enqueue HIGH-priority sync) is platform-agnostic. Adding a platform =
one controller route + its verification scheme + its event→product mapping.

## Comparison

| Platform | Webhooks? | Useful events | Metrics push? | Gating | Verdict |
|---|---|---|---|---|---|
| **Threads** | ✅ Meta infra | `publish` (own new post!), `replies`, `mentions`, `delete` | ❌ insights poll-only | App Review (Advanced Access per scope) | **Implement first** |
| **Twitch** | ✅ EventSub | `stream.online/offline`, `channel.update`, follows, subs, cheers, raids, hype trains | ❌ counts/VODs/clips poll-only | Scopes at OAuth connect; app token + conduit | **Implement second** |
| **YouTube** | ⚠️ WebSub only | New upload / title / description change | ❌ stats/comments poll-only | None (public per channel-id, no quota) | **Implement third** (cheap trigger) |
| **LinkedIn** | ⚠️ Org-only | Likes/comments/shares/mentions **on org posts** | ❌ posts/followers/analytics poll-only | Community Mgmt vetted product + webhook use case + per-admin subscription | **Wait** |
| **TikTok** | ⚠️ Minimal | `authorization.removed` (with churn reason) only | ❌ no organic content/engagement events | None beyond existing products | **Token-hygiene only** |

Key cross-platform finding: **no platform pushes metric deltas** (views/likes/followers).
Webhooks everywhere are *triggers for targeted syncs*; polling stays as source of truth.
This matches our Meta design (webhook → HIGH-priority product sync).

---

## 1. Threads — best ROI, reuses Meta infra

- **Events**: `replies` (topic `moderate`), `delete` (`moderate`), `mentions`
  (`interaction`), `publish` (`interaction`) — `publish` fires when the connected user
  posts a new thread/reply (added Aug 2025). Payload pinpoints the object
  (`values.value.id`) and the user (`target_id`).
- **NOT covered**: quotes/reposts, insights/metrics, edits → keep polling.
- **Transport**: same Meta App Dashboard webhooks, same `hub.challenge` GET verify,
  same `X-Hub-Signature-256` HMAC (use the **Threads app's** secret if distinct).
  ⚠️ Envelope is FLAT (`{app_id, topic, target_id, time, subscription_id, values:{value,field}}`),
  NOT the FB/IG `{object, entry[].changes[]}` shape — needs its own parser branch.
- **Subscription model**: app-level field subscribe in dashboard; activates per user
  when they grant the scope at OAuth. No per-account subscribe call (unlike FB Pages).
- **Scopes**: `threads_basic` (+ `threads_read_replies` / `threads_delete` /
  `threads_manage_mentions` per field). Advanced Access via App Review for production.
- **Implementation**: new route `POST /webhooks/ingest/threads`, map
  `publish|replies|mentions` → `engagement_new` sync, `delete` → engagement sync
  (tombstone via re-fetch).
- **Effort**: S/M (parser + dashboard config + App Review wait).
- Source: developers.facebook.com/docs/threads/webhooks + changelog.

## 2. Twitch — richest event surface, new transport concepts

- **Events (cost 0 with broadcaster OAuth)**: `channel.follow` (v2,
  `moderator:read:followers`), `channel.subscribe/.gift/.message`
  (`channel:read:subscriptions`), `channel.cheer` (`bits:read`), channel points, polls,
  predictions, hype trains. **App-token-only (cost 1, free if user authorized)**:
  `stream.online/offline`, `channel.update`, `channel.raid`.
- **NOT covered**: follower/sub COUNTS, VOD publish, clips, concurrent viewers → poll
  Helix; trigger VOD/metrics poll off `stream.offline`.
- **Transport**: `POST /helix/eventsub/subscriptions` with app token; **conduits**
  recommended for multi-tenant (5/client, 20k shards). HMAC-SHA256 over
  `messageId + timestamp + rawBody`, secret 10–100 ASCII chars, challenge response =
  raw `challenge` as `text/plain`. At-least-once → dedupe on
  `Twitch-Eventsub-Message-Id`; reject >10min-old timestamps. Handle `revocation`
  messages (authorization_revoked / notification_failures_exceeded / etc.).
- **Implementation**: route `POST /webhooks/ingest/twitch` + subscription lifecycle
  service (subscribe on connect, resubscribe on revocation, unsubscribe on disconnect).
  Map: stream/channel events → identity/engagement syncs; follow/sub/cheer → audience.
- **Effort**: M (subscription lifecycle is the real work, not the endpoint).
- **max_total_cost**: 10,000 — fine, since authorized broadcasters cost 0.
- Source: dev.twitch.tv/docs/eventsub.

## 3. YouTube — WebSub upload trigger, cheap but best-effort

- **Events**: new upload + title/description edits ONLY (Atom XML POST with
  `yt:videoId`/`yt:channelId`). Deletes undocumented/unreliable.
- **NOT covered**: views/likes/comments/subscriber counts, analytics → poll.
- **Transport**: subscribe at `pubsubhubbub.appspot.com` per channel topic URL
  (`youtube.com/feeds/videos.xml?channel_id=…`) — **no OAuth, no quota**. GET
  challenge echo; optional `hub.secret` → `X-Hub-Signature` (HMAC-**SHA1**).
  **Lease ~5 days → renewal cron required** (renew at ~80% lease). Known stale-feed
  race: re-fetch with short backoff.
- **Reliability**: best-effort, drops happen, no replay → keep polling as
  reconciliation; WebSub only lowers upload-detection latency.
- **Implementation**: route `GET/POST /webhooks/ingest/youtube` (XML body!),
  subscribe/renew service keyed to connected channels, map upload → `engagement_new`.
- **Effort**: S/M (XML parsing + lease-renewal cron).
- Source: developers.google.com/youtube/v3/guides/push_notifications.

## 4. LinkedIn — org-engagement only, heavy lifecycle; WAIT

- **Events**: `ORGANIZATION_SOCIAL_ACTION_NOTIFICATIONS` — LIKE / COMMENT / SHARE /
  SHARE_MENTION / ADMIN_COMMENT / COMMENT_EDIT / COMMENT_DELETE on org posts.
  Batched ≤10, URN-only payloads (hydrate via API), dedupe on `notificationId`.
- **NOT covered**: new org posts, follower stats, page/share/video analytics, ANY
  member-level events (`r_member_social` closed) → all poll-only.
- **Gating**: webhook use case must be approved (portal Webhooks tab enabled);
  Community Management API vetted product (we have standalone tier — verify tab).
  Subscription is **per member(admin)×org** via `PUT /rest/eventSubscriptions/...`,
  dies with the member's grant. Endpoint re-validated **every 2h** (HMAC
  challengeCode/challengeResponse with clientSecret); 3 failures → BLOCKED.
  Incoming events signed via `X-LI-Signature` (HMAC-SHA256, clientSecret).
- **Why wait**: covers only engagement-on-org-posts (we sync org analytics anyway),
  high lifecycle cost, and we haven't validated the first real org connection yet.
  Revisit after LinkedIn platform is validated in prod. 60-day backfill API exists
  (`organizationalEntityNotifications?q=criteria`) if we adopt later.
- **Effort**: M/L. **Value**: low-medium today.
- Source: learn.microsoft.com/linkedin (webhook-validation, developer-webhooks,
  organization-social-action-notifications).

## 5. TikTok — only deauthorization; do as token hygiene

- **Events**: `authorization.removed` (reason codes: user disconnect / account deleted
  / age change / ban / dev-revoked), `video.publish.completed` + `video.upload.failed`
  (ONLY for API-posted content — never fires for organic posts),
  `portability.download.ready`.
- **NOT covered**: organic new posts, any engagement/metrics → poll Display API.
- **Transport**: callback URL set in Developer Portal (dashboard-only, all events,
  HTTPS). Signature: `TikTok-Signature: t=<ts>,s=<hex>` =
  HMAC-SHA256(`ts + "." + rawBody`, client_secret). At-least-once, retries ≤72h,
  ack 200 fast. `content` field is double-encoded JSON (parse twice).
- **Implementation**: route `POST /webhooks/ingest/tiktok` → on
  `authorization.removed`: mark account disconnected, stop syncs, fire `token.expired`
  lifecycle event. ~Half a day of work, real operational win (today we discover
  revocation only when a sync fails).
- **Effort**: S. **Value**: token hygiene only.
- Source: developers.tiktok.com/doc/webhooks-overview.

---

## Recommended order

1. **TikTok `authorization.removed`** — smallest effort, immediate ops win, no review gate.
2. **Threads** — reuses Meta verify infra; `publish` gives instant new-post syncs.
   Start App Review early (it's the long pole).
3. **Twitch EventSub** — biggest event surface; do when Twitch accounts matter
   commercially (subscription lifecycle service is the main cost).
4. **YouTube WebSub** — cheap upload trigger; pairs with a lease-renewal cron.
5. **LinkedIn** — park until the LinkedIn platform has real prod usage; then re-check
   the Webhooks tab availability on our app.

Every implementation reuses the Meta pattern: verify → `recordWebhook` (platform,
eventId dedupe) → map → enqueue HIGH sync → throttle-lock absorbs bursts. The admin
panel (`/admin/webhooks`) picks up new platforms automatically (platform column comes
from the log row), though `parseWebhookSnippet` in `admin.service.ts` is Meta-envelope
specific and will need per-platform branches as they land.
