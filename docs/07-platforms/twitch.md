# Twitch

**Status:** Stable reference
**Last updated:** 2026-04-23
**Platform API:** Twitch Helix API + EventSub

Twitch's role is modest: identity + VODs/clips/streams. **Audience data is thin** on the platform side — the connector exposes what Twitch exposes, marked as `supported_with_limitations`.

---

## Account eligibility

- Any Twitch account. No business/creator tier required.
- Subscriber/revenue data requires Affiliate/Partner scopes — gated behind optional scopes.

---

## OAuth flow + scopes

| Product | Scopes |
|---|---|
| Identity | (none beyond OAuth; public data via client credentials also works) |
| Engagement — VODs/clips | `user:read:broadcast` (for own broadcasts) |
| Live events via EventSub | app token only (no user scope required for public stream events) |
| Followers (if exposed) | `moderator:read:followers` (requires moderator status on channel — skip if absent) |
| Subs (Affiliate/Partner) | `channel:read:subscriptions` |

**OAuth endpoint:** `https://id.twitch.tv/oauth2/authorize?response_type=code&client_id=...&redirect_uri=...&scope=...&state=...`

No app-review equivalent for most scopes; some restricted scopes (subscriptions, moderation) require higher trust tiers applied for in the Twitch Developer Console.

---

## Canonical ID resolution

1. Call `GET https://api.twitch.tv/helix/users` with access token → `data[0]`.
2. `canonical_user_id = data[0].id` (the numeric broadcaster ID, not the login name).
3. No retries needed.

---

## Data products supported

### Identity (1 point)
```
GET /helix/users?id=<broadcaster_id>
```
Returns login, display_name, type, broadcaster_type, description, profile_image_url, offline_image_url, view_count, created_at, email (if `user:read:email` scope).

### Followers count (limited)
```
GET /helix/channels/followers?broadcaster_id=<id>&first=1
```
Returns total count in `total` field. Full list requires `moderator:read:followers` + moderator status — skip if no scope.

### VODs
```
GET /helix/videos?user_id=<id>&type=archive&first=100
```
`archive` = past broadcasts; `highlight` = user-curated; `upload` = uploaded. Fetch all three.

### Clips
```
GET /helix/clips?broadcaster_id=<id>&first=100&started_at=<ISO>&ended_at=<ISO>
```

### Streams (live)
```
GET /helix/streams?user_id=<id>
```
Returns current live stream details. Also drives EventSub subscriptions (§Webhooks).

### Audience (weak)
Twitch doesn't expose creator-dashboard-equivalent demographics via Helix. `supported_fields.audience.gender = not_supported`, same for age. Only `total_followers` is exposed. Matches what backend-api renders today.

---

## Webhooks — EventSub

See [`../ingestion-modes.md`](../ingestion-modes.md) §3.3 for full setup. Webhook transport (not WebSocket).

**Subscriptions created after OAuth:**
- `stream.online`
- `stream.offline`
- `channel.update` (title, category, language, content_classification)
- `channel.follow` v2 (needs moderator scope — skip if unavailable)
- `channel.subscribe` (Affiliate/Partner only)

Creation:
```
POST https://api.twitch.tv/helix/eventsub/subscriptions
  Authorization: Bearer <app_access_token>
  Body: {
    type: 'stream.online',
    version: '1',
    condition: { broadcaster_user_id: '<id>' },
    transport: {
      method: 'webhook',
      callback: 'https://connector.<env>.internal/webhooks/ingest/twitch',
      secret: '<per_subscription_secret>'
    }
  }
```

**Signature:** HMAC-SHA256 in `Twitch-Eventsub-Message-Signature: sha256=<hex>` over `{message_id}{timestamp}{body}`.

**Verification challenge:** first POST is type `webhook_callback_verification`; handler echoes `challenge` within 10s.

**Subscription lifecycle:** Twitch revokes subs after consecutive failed deliveries. Adapter monitors header `Twitch-Eventsub-Subscription-Status` and recreates revoked subs.

---

## Rate limits

Helix API: **800 points/minute per app token + 800/min per user token**. Most calls = 1 point.

Headers: `Ratelimit-Remaining`, `Ratelimit-Reset` (epoch seconds).

Bucket config in [`../rate-limiting.md`](../rate-limiting.md) §10. Two buckets per Twitch account:
- `app_token` (shared)
- `user_token:{user_id}` (per user)

EventSub creation costs 1 EventSub point per subscription (separate 10k pool; vast).

---

## Token lifecycle

- Access tokens: **~4 hours** typical.
- Refresh via `POST https://id.twitch.tv/oauth2/token?grant_type=refresh_token`.
- Refresh tokens rotate — adapter uses the new refresh token from each response.
- Token revocation by user → refresh returns 400 `invalid_grant` → `account.needs_reauth`.

App access tokens (client credentials) for EventSub subscription creation: obtained on connector startup, cached in Redis with TTL, refreshed automatically.

---

## Historical backfill — the weakest of the five

Twitch is the only platform where **content itself can be permanently lost** before we see it.

- **VOD retention on the platform side:**
  - Non-Partner: 14 days
  - Affiliate: 14 days
  - Partner: 60 days
  Old VODs disappear from `/helix/videos`. There is nothing we can do to recover them.
- **Clips:** persist long-term. Paginate `/helix/clips` with date-range parameters for full historical list.
- **Streams history:** past live sessions exist as VODs (subject to above) or Highlights (Partner-curated). No separate "ever-been-live" history via API.
- **Metrics:** current state only; no historical analytics API.
- **Stream title / game history:** tracked only via `channel.update` EventSub events going forward — not reconstructable for the past.

Backfill depth for Twitch is effectively "whatever the platform still has". `platform_field_support` marks `content_before_retention_window = not_supported`.

See [`../historical-backfill.md`](../historical-backfill.md) for the cross-platform policy.

## Known quirks / landmines

- **EventSub is the primary signal for "stream online/offline"** — polling the `streams` endpoint is a fallback when EventSub silences.
- **Follower count updates in near-real-time** via EventSub `channel.follow`, but it **doesn't fire for unfollows**. Polling required to detect follower decrease.
- **VOD retention** is limited: non-Partner = 14 days; Affiliate = 14 days; Partner = 60 days. Old VODs disappear. Adapter emits `content.deleted` when they drop off.
- **Clips and VODs have overlapping IDs in different namespaces.** `content_type` distinguishes (`vod` vs `clip` vs `stream`).
- **Stream title changes** fire `channel.update` — this is a metadata change, not a new content event. Adapter maps to `content.updated` on the currently-live `stream` record.
- **Chat data is out of scope** (different API tier, massive volume).
- **Subscription data** (paid subs) is Affiliate/Partner only. If scope is granted, connector syncs; if not, field is `not_supported` for that account (distinct from empty).

---

## Related docs

- [`../rate-limiting.md`](../rate-limiting.md) §10 — bucket config
- [`../ingestion-modes.md`](../ingestion-modes.md) §3.3 — EventSub setup
- [`../refresh-cadence.md`](../refresh-cadence.md) — `live_status` 5min polling backstop
- [`../06-event-catalog.md`](../06-event-catalog.md) — live status events map to content events
