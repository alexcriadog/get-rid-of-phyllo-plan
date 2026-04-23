# 06 · Event Catalog

**Status:** Living — authoritative source is `@camaleonic/connector-contract` package
**Last updated:** 2026-04-23

Events are the **primary way** the connector tells `backend-api` (and any future consumer) that something changed. Signed HMAC webhooks, at-least-once delivery, idempotent consumers. This doc lists every event type the connector emits, their payload shapes, and versioning rules.

---

## Envelope — shared across all events

```json
{
  "event_id": "evt_01HXYZ...",                    // ULID, stable, idempotency key
  "event_type": "account.connected",
  "version": "v1",
  "emitted_at": "2026-04-23T15:45:12.345Z",
  "producer": "connector",
  "correlation_id": "cor_<id>",                   // traces back to the triggering request/job
  "signature_header": "sha256=<hex>",             // per-subscription HMAC-SHA256
  "signature_timestamp": "2026-04-23T15:45:12Z",  // prevents replay
  "data": { /* event-specific payload */ }
}
```

Signature is computed as `HMAC_SHA256(secret, signature_timestamp + "." + JSON.stringify(data))`. Multi-secret set supported — any secret in `webhook_subscriptions.secret_arn`'s list validates. Rotation is additive: add new, consumers accept both, remove old.

Consumers that cannot validate signature → reject 401. Signatures older than 10 minutes → reject (replay protection).

Full rotation procedure: [`08-operations/security.md`](08-operations/security.md).

---

## Event types

### Account lifecycle

| Event | When | Data payload |
|---|---|---|
| `account.connected` | Initial successful OAuth + token stored | `{ account_id, platform, canonical_user_id, owning_organization_id, connected_at, initial_backfill_enqueued: true }` |
| `account.reconnected` | Same canonical ID reconnects (token refresh via OAuth flow) | `{ account_id, platform, previously_needs_reauth: bool, reconnected_at }` |
| `account.disconnected` | User-initiated via DELETE or platform revoked token | `{ account_id, platform, organization_id, reason: 'user'|'platform_revoked'|'gdpr'|..., remaining_organizations: N, disconnected_at }` |
| `account.needs_reauth` | 401 from platform during sync, scope loss, refresh failure | `{ account_id, platform, detected_at, reason: 'token_expired'|'scope_revoked'|'refresh_failed' }` |
| `account.shared_with_organization` | Second org gets visibility on an existing account | `{ account_id, organization_id, role: 'visible' }` |
| `account.tier_changed` | Admin changed `sync_tier` | `{ account_id, old_tier, new_tier, changed_by }` |
| `account.ready` | After `pending_resolution_failed` → canonical ID finally resolved | `{ account_id, resolved_at }` |

### Data product — profile / identity

| Event | When | Data |
|---|---|---|
| `profile.updated` | Identity snapshot changed (followers, handle, bio, etc.) | `{ account_id, platform, fetched_at, changes: { followers_count: {from, to}, handle: {from, to}, ... } }` |

### Data product — audience

| Event | When | Data |
|---|---|---|
| `audience.updated` | Audience snapshot refreshed | `{ account_id, platform, fetched_at, supported_fields: [...], summary: { top_country, top_age_bucket, dominant_gender } }` |

Full audience body is **not** in the event — backend-api pulls detail from `GET /v1/accounts/:id/audience` if it needs it. Keeps event small, idempotent, and the API remains the source of truth.

### Data product — engagement / content

| Event | When | Data |
|---|---|---|
| `content.added` | New post detected (webhook or polling) | `{ account_id, platform, content_id, content_type, published_at, first_fetched_at }` |
| `content.updated` | Existing post's metrics changed or caption edited | `{ account_id, platform, content_id, fetched_at, metric_deltas: { likes: +N, views: +N, ... } }` |
| `content.deleted` | Post no longer visible on platform | `{ account_id, platform, content_id, detected_deleted_at }` |

Like audience, the full post body is pulled via `GET /v1/accounts/:id/contents/:contentId`. Events carry identity, not full content.

### Backfill

| Event | When | Data |
|---|---|---|
| `account.backfill_started` | Initial or re-backfill job begins | `{ account_id, product, window_start, window_end, priority }` |
| `account.backfill_progress` | Per batch progress (rate-limited to max 1 per minute per account) | `{ account_id, product, items_fetched_so_far, estimated_total }` |
| `account.backfill_complete` | Backfill finished | `{ account_id, product, items_fetched, duration_s }` |

### Refresh

| Event | When | Data |
|---|---|---|
| `refresh.completed` | Manual-refresh job finished (success or failure) | `{ account_id, product, trigger: 'manual'|'webhook'|'scheduled', success, changes?, error? }` — see [`manual-refresh.md`](manual-refresh.md) §7 |

### Operational / ops

| Event | When | Data |
|---|---|---|
| `sync.failed` | Job failed after all retries and landed in DLQ | `{ account_id, product, error_code, last_error, attempts, requires_human: true }` |
| `token.expiring_soon` | Cron detects token within 14/7/3/1 days of expiry | `{ account_id, platform, expires_at, days_until_expiry }` — consumed by backend-api's expiry notification cron |
| `token.refreshed` | Access token successfully refreshed | `{ account_id, platform, old_expires_at, new_expires_at }` |
| `cadence.default_changed` | Platform default cadence updated via admin API | `{ platform, product, old, new, affected_accounts: N }` |
| `account.cadence_override_expired` | Timed cadence override auto-reverted | `{ account_id, product, reverted_to_default_interval_seconds }` |

---

## Payload example — `content.added`

```json
{
  "event_id": "evt_01HXYZABC...",
  "event_type": "content.added",
  "version": "v1",
  "emitted_at": "2026-04-23T15:45:12.345Z",
  "producer": "connector",
  "correlation_id": "cor_<id>",
  "signature_header": "sha256=<hex>",
  "signature_timestamp": "2026-04-23T15:45:12Z",
  "data": {
    "account_id": "acc_01HXYZ...",
    "platform": "instagram",
    "content_id": "post_01HXYZ...",
    "platform_content_id": "17920123456789012",
    "content_type": "reel",
    "published_at": "2026-04-23T14:30:00Z",
    "first_fetched_at": "2026-04-23T15:44:50.110Z",
    "via": "webhook"                                   // 'webhook' | 'polling' | 'backfill' | 'manual_refresh'
  }
}
```

Consumer flow in backend-api:
1. Verify signature with one of the valid secrets.
2. Verify `signature_timestamp` is within 10 min of now.
3. Check `event_id` against idempotency table — if already seen, return 200 ACK without processing.
4. Insert `event_id` into idempotency table (unique index).
5. Call `GET /v1/accounts/:id/contents/:content_id` on the connector if full content needed.
6. Apply business logic (brand detection, paid-post, virality, S3 copy).
7. Upsert into backend-api's MongoDB `posts` collection.
8. Return 200 ACK.

Ack timeout budget: backend-api has **up to 5 seconds** to respond 2xx. Heavy processing happens after the ACK (async worker in backend-api if needed).

---

## Versioning

- `version` field in the envelope is the **event-type version**, not the service version.
- Additive changes to `data` (new fields) do not bump the version.
- Removing or renaming fields, changing field semantics = new version (`v2`).
- The connector can emit **both** `v1` and `v2` during a transition window (subscribers declare which versions they accept).
- Stored in `webhook_subscriptions.event_types` as `{ "content.added": ["v1"] }` or `[ "v1", "v2" ]`.
- Default: latest stable version. Migrate subscriptions explicitly.

Breaking-change process:
1. Add `v2` emitter alongside `v1`; both fire for 30 days.
2. Subscribers update `event_types` to include `v2`.
3. Remove `v1` after every subscriber is on `v2` + buffer.

---

## Idempotency

- **Every event carries a stable `event_id` (ULID).** Emitted once per source event — if retried, same ID.
- **Consumers must dedupe** by `event_id`. Inserting into a unique-indexed idempotency table is the standard pattern in backend-api.
- **At-least-once delivery** means: a consumer can see the same `event_id` more than once (network retry, worker crash between ACK and DB commit, etc.). Consumer processing must be idempotent.
- Connector side: `webhook_deliveries` keyed by `(event_id, subscription_id)` UNIQUE — once delivered, never re-sent to that subscriber.

---

## Delivery SLOs

| Metric | Target |
|---|---|
| First-attempt delivery latency (from emission to HTTP POST) | p95 < 2s |
| Successful-delivery rate (no retry needed) | p95 > 99% |
| Retry-to-success (after initial failure) | p95 < 5 min |
| DLQ rate | < 0.1% of total events |

Alert rules in [`08-operations/observability.md`](08-operations/observability.md).

---

## Failure handling

- Non-2xx from subscriber → retry with exponential backoff (1s, 5s, 30s, 2m, 10m, 1h, 6h, 24h).
- After 8 failed attempts → move to DLQ. Alert.
- DLQ replay via admin endpoint `POST /v1/admin/webhook-deliveries/:id/replay`.
- Persistent bad signature on subscriber side → investigate rotation state; ops runbook in [`08-operations/runbook.md`](08-operations/runbook.md).

---

## Related docs

- [`05-api-contract.md`](05-api-contract.md) — pull endpoints for full payloads referenced by events
- [`ingestion-modes.md`](ingestion-modes.md) — **inbound** webhooks from platforms (separate concern)
- [`manual-refresh.md`](manual-refresh.md) — the `refresh.completed` event specifically
- [`08-operations/security.md`](08-operations/security.md) — HMAC multi-secret rotation
- [`08-operations/runbook.md`](08-operations/runbook.md) — DLQ replay, subscription troubleshooting
- [`adr/0005-signed-webhook-events.md`](adr/0005-signed-webhook-events.md) — decision behind the approach
