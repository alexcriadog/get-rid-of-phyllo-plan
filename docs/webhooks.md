# Webhooks

Camaleonic Connect can push real-time notifications to your servers when
events happen on a connected account (a user finishes OAuth, a refresh
token expires, etc.). This document is the contract: events, payload
shapes, signing, retries, and how to handle failures.

## TL;DR

```bash
# 1. Register an endpoint with your workspace API key:
curl -X POST https://api.example.com/v1/webhook-endpoints \
  -H "Authorization: Bearer cmlk_live_..." \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-app.example.com/webhooks/camaleonic",
    "events": ["account.connected", "account.disconnected", "token.expired"]
  }'

# Response (returns the signing secret EXACTLY ONCE — store it):
# {
#   "id": "ckxyz...",
#   "url": "https://your-app.example.com/webhooks/camaleonic",
#   "events": ["account.connected", "account.disconnected", "token.expired"],
#   "active": true,
#   "secret": "whsec_aBcDeF1234...",
#   "createdAt": "2026-05-28T15:00:00.000Z"
# }
```

Then on every event we POST JSON to that URL signed with the secret. Your
endpoint MUST respond with a 2xx within 10 seconds.

## Event catalog

All events share a common envelope:

```ts
interface BaseEvent {
  /** Numeric account id, stringified to keep BigInt safe through JSON. */
  account_id?: string;
  /** Platform key: facebook, instagram, tiktok, threads, youtube, twitch. */
  platform?: string;
  /** Your workspace id (cuid). */
  workspace_id?: string;
  /** ISO-8601 timestamp this event was generated. */
  occurred_at: string;
}
```

| Event | When | Extra fields |
|---|---|---|
| `account.connected` | An end-user completes OAuth and we create the account row | `end_user_id`, `canonical_user_id`, `handle` |
| `account.disconnected` | The account is removed via `DELETE /v1/accounts/:id` | `end_user_id`, `canonical_user_id` |
| `account.refreshed` | Access token successfully refreshed via refresh-token grant | `expires_at` (next expiry) |
| `token.refresh_failed` | Refresh attempt failed but we'll retry — transient issue | `reason`, `retry_in_seconds` |
| `token.expired` | Refresh failed terminally — end-user must reconnect | `end_user_id`, `canonical_user_id`, `reason` |
| `webhook.test` | Triggered via `POST /v1/webhook-endpoints/:id/test` or admin UI | `endpoint_id`, `message: "test"` |

### Example payloads

`account.connected`:
```json
{
  "account_id": "42",
  "platform": "tiktok",
  "workspace_id": "wkspc_demo",
  "end_user_id": "user@example.com",
  "canonical_user_id": "tiktok_open_id_123",
  "handle": "camaleonicanalytics",
  "occurred_at": "2026-05-28T15:00:00.000Z"
}
```

`token.expired`:
```json
{
  "account_id": "42",
  "platform": "tiktok",
  "workspace_id": "wkspc_demo",
  "end_user_id": "user@example.com",
  "canonical_user_id": "tiktok_open_id_123",
  "reason": "refresh_token revoked by user",
  "occurred_at": "2026-05-28T15:00:00.000Z"
}
```

## Signing & verification

Every delivery carries three headers:

- `X-Camaleonic-Event: account.connected` — the event name.
- `X-Camaleonic-Delivery: ckxyz...` — unique delivery id (use for idempotency).
- `X-Camaleonic-Signature: t=1717002000,v1=abc123def...` — timestamp + HMAC.

The signature is computed as:

```
HMAC-SHA256(secret, `${t}.${rawBody}`)
```

Where `t` is the unix-seconds timestamp from the header and `rawBody` is
the literal request body (don't re-serialise — float ordering may differ).

### Node.js verifier

```js
import crypto from 'node:crypto';

function verify(req, secret, toleranceSeconds = 300) {
  const header = req.headers['x-camaleonic-signature'];
  const m = /^t=(\d+),v1=([0-9a-f]+)$/.exec(header || '');
  if (!m) throw new Error('Malformed signature header');
  const [, ts, sig] = m;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > toleranceSeconds) {
    throw new Error('Timestamp outside tolerance window');
  }
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${ts}.${req.rawBody}`)
    .digest('hex');
  if (
    sig.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))
  ) {
    throw new Error('Signature mismatch');
  }
}
```

### Python verifier

```python
import hmac, hashlib, time, re

def verify(headers, raw_body, secret, tolerance_seconds=300):
    m = re.match(r'^t=(\d+),v1=([0-9a-f]+)$', headers.get('X-Camaleonic-Signature', ''))
    if not m:
        raise ValueError('Malformed signature header')
    ts, sig = m.groups()
    if abs(time.time() - int(ts)) > tolerance_seconds:
        raise ValueError('Timestamp outside tolerance window')
    expected = hmac.new(secret.encode(), f'{ts}.{raw_body}'.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expected):
        raise ValueError('Signature mismatch')
```

**Recommended tolerance: ±5 minutes (300 s).** Outside that window, reject —
it's almost certainly a replay attempt.

## Idempotency

Use the `X-Camaleonic-Delivery` header as the idempotency key. We retry on
non-2xx responses, so the same delivery may arrive at your endpoint
multiple times. Track seen ids for ~24 hours.

## Retries

Schedule (delay until the NEXT attempt after the failure):

| Attempt | Delay |
|---|---|
| After 1st failure | 1 min |
| After 2nd | 5 min |
| After 3rd | 30 min |
| After 4th | 2 h |
| After 5th | 12 h |
| After 6th | 24 h |
| After 7th | **abandoned** (no further automatic retries) |

An admin can manually re-queue an abandoned delivery from the admin UI.

We retry on:
- Any non-2xx HTTP status code.
- Network errors (timeout, connection refused, ECONNRESET, etc.).

We DO NOT retry on:
- SSRF rejection (the target resolved to a private/loopback/metadata IP).
  Marked as `abandoned` with `lastError: ssrf_rejected:<reason>` — the
  attacker doesn't get free probes.

## Security

### Target URL policy

- HTTPS is required in production (`WEBHOOKS_REQUIRE_HTTPS=true` by default).
- Embedded credentials (`https://user:pass@host/`) are rejected.
- Fragments (`#…`) are rejected.
- URLs over 2048 chars are rejected.
- DNS resolution checked at registration AND immediately before each
  delivery (defends against DNS rebinding). Any of these blocks the URL:
  - `127.0.0.0/8` (loopback)
  - `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` (RFC1918 private)
  - `169.254.0.0/16` (link-local — covers AWS/GCP/Azure metadata)
  - `0.0.0.0/8`, `fc00::/7`, `fe80::/10`
  - hostnames `localhost`, `metadata.google.internal`, `*.local`, `*.internal`
- Payload size cap: 256 KB (rejected at emit, never reaches the wire).

### Secret rotation

```
POST /v1/webhook-endpoints/:id/rotate-secret
```

Returns the new `secret` once. The old secret is invalidated **immediately**
(no grace period — verify both during your client-side rollout if needed).

## Managing endpoints

| Operation | Endpoint |
|---|---|
| Create | `POST /v1/webhook-endpoints` |
| List | `GET /v1/webhook-endpoints` |
| Update (subset of url/events/description/active) | `PATCH /v1/webhook-endpoints/:id` |
| Rotate secret | `POST /v1/webhook-endpoints/:id/rotate-secret` |
| Send test | `POST /v1/webhook-endpoints/:id/test` |
| List deliveries (paginated) | `GET /v1/webhook-endpoints/:id/deliveries?limit=50&cursor=…` |
| Inspect delivery | `GET /v1/webhook-endpoints/:id/deliveries/:delivery_id` |
| Delete | `DELETE /v1/webhook-endpoints/:id` |

All authenticated with `Authorization: Bearer cmlk_(live|test)_...`.

## Admin observability

Operators have view + retry access at the admin dashboard:

- `/admin/webhook-deliveries` — filter by workspace / status / event;
  click any row for full payload + response_body + response_headers +
  duration_ms + retry button.
- `/admin/workspaces/:slug` Webhook section — health rollup per endpoint
  over the last 24 h: success rate, p50/p95 latency, consecutive
  failures, "Send test webhook" button.
- `GET /admin/workspaces/:slug/webhook-endpoints/:id/health` — same data,
  programmatic.

## Retention

To keep DB cost bounded, daily cron at 03:00 UTC:

- `InboundWebhookLog` rows older than `INBOUND_LOG_RETENTION_DAYS` (default 30) → deleted.
- `WebhookDelivery` rows with status `delivered` or `abandoned`, older than `OUTBOUND_DELIVERY_RETENTION_DAYS` (default 90) → deleted.

Rows with status `pending` or `failed` are kept indefinitely so an admin
can replay them.
