# Meta webhook auto-subscribe on connect

**Date:** 2026-06-02
**Status:** Approved (design)

## Problem

The inbound Meta webhook pipeline works end-to-end (verified 2026-06-02:
`GET/POST /webhooks/ingest/meta`, HMAC signature validation, dedupe, enqueue,
`inbound_webhook_log`). But events only flow for a Page once that Page is
subscribed to the app via `POST /{page-id}/subscribed_apps`, which requires the
`pages_manage_metadata` permission. The connector's OAuth flow only requests
read scopes, so no connected account is subscribed — real events never arrive
without a manual Graph API Explorer step.

The product requirement: **the end-user connects once** through the normal
OAuth flow and the webhook subscription happens automatically, invisibly. No
manual steps, ever.

## Goals

- Request `pages_manage_metadata` as part of the normal connect consent, only
  when a webhook-capable product is in the workspace's allow-list.
- Automatically subscribe each connected Page to the app's webhooks during the
  seed step, with the field set derived from the products the user selected.
- Subscribing the Page also enables delivery for its linked Instagram business
  account (IG object fields are configured app-level; the Page subscription
  activates delivery).
- Never break onboarding: a subscribe failure is logged + counted, the
  connection still completes.

## Non-goals

- App-level `instagram` object field subscription. Already configured once via
  the App Dashboard toggles (`comments`, `mentions`, `story_insights`). Not a
  per-connection concern. (YAGNI: do not automate the one-time app-level config.)
- Backfilling existing accounts. Accounts connected before this change lack the
  scope; they must reconnect to gain webhooks. Documented, not automated.
- Instagram-with-Instagram-Login subscription path (`/{ig-user-id}/subscribed_apps`).
  Current `connect-tool/lib/platforms.ts` implements the Facebook-Login variety
  (Page + linked IG business account). Out of scope.

## Design

### 1. Scope — `poc/src/modules/accounts/products.catalog.ts`

Add `pages_manage_metadata` to the `scopes` array of the facebook and
instagram products that have webhook coverage: `engagement_new`, `mentions`,
`comments`, `stories`.

`scopesForProducts()` de-dupes, so listing it on multiple products is fine.
The connect-tool computes the consent scope set per workspace from this catalog
(`GET /internal/products-catalog` → `computeOAuthScopes`), so the permission is
requested exactly when the workspace allows at least one of those products, and
appears in the Meta consent dialog alongside the existing read permissions.

### 2. Auto-subscribe — POC seed handler (`poc/src/modules/admin/admin.service.ts`)

Done in the POC, not the connect-tool, because the POC already has: the Graph
client (`GRAPH_BASE`), `MetricsService` (Prometheus), Prisma, and the webhook
domain (`FIELD_TO_PRODUCT` lives in `webhooks-ingest.controller.ts`). The
connect-tool stays a thin OAuth shuttle. The seed body already carries
everything required: `access_token` (the Page token), `metadata.page_id`, and
`metadata.products`.

After the account + OAuthToken are persisted, when `platform ∈ {facebook,
instagram}`:

```
POST https://graph.facebook.com/v22.0/{page_id}/subscribed_apps
     ?subscribed_fields={derived page fields, comma-joined}
     &access_token={page token}
```

One call per Page. Use the existing `GRAPH_VERSION`/`GRAPH_BASE` constant.

Duplicate-call handling: for a Page connected with IG, two seeds run for the
same `page_id` (facebook + instagram). Meta's `subscribed_apps` is idempotent
for a given field set, so calling it on both is harmless (re-asserts the
subscription). Rule: subscribe whenever the seed carries both a Page token and
a `page_id`. No cross-seed coordination needed.

### 3. Product → webhook field mapping

Inverse of the inbound `FIELD_TO_PRODUCT`, restricted to **Page** object fields
(IG fields are app-level):

| Selected product | Page fields subscribed |
|------------------|------------------------|
| `engagement_new` | `feed`, `videos`, `live_videos` |
| `mentions`       | `mentions` |
| `comments`       | `feed` |
| `ratings`        | `ratings` |
| `stories`        | — (no Page story webhook field) |

Subscribe the deduplicated union of fields across the selected products. If the
union is empty, skip the Meta call entirely.

Also add `ratings: 'ratings'` to `FIELD_TO_PRODUCT` in
`webhooks-ingest.controller.ts` so inbound `ratings` events route to the
`ratings` product instead of falling through to the `engagement_new` default.

## Error handling (non-blocking) + metrics

The subscribe runs in its own `try/catch`, after the account is created:

- Success: `metrics.incr('webhook_subscribe_ok', { platform })` + info log.
- Failure (timeout, permission not granted, `#200`, rate limit, etc.):
  `metrics.incr('webhook_subscribe_failed', { platform })` + warn log with the
  reason. **The connection still completes.**
- The seed response includes an informational field with the subscribe outcome
  (e.g. `webhook_subscribed: boolean` + optional `webhook_error`), but the
  subscribe path never throws.

## Data flow

```
Client clicks Connect
  -> OAuth consent (now includes pages_manage_metadata, once)
  -> picks Page/IG (fb-picker)
  -> connect-tool seed-pages -> POST /admin/connect/seed (page token + page_id + products)
  -> POC seed: create account + token
  ->   [if facebook/instagram] derive fields from products
  ->   POST /{page_id}/subscribed_apps  (non-blocking; log + metric)
  -> webhooks now deliver for this Page (and its linked IG)
```

## Affected files

- `poc/src/modules/accounts/products.catalog.ts` — add scope to fb/ig products.
- `poc/src/modules/admin/admin.service.ts` — subscribe call in seed handler.
- `poc/src/modules/webhooks/webhooks-ingest.controller.ts` — add `ratings`
  to `FIELD_TO_PRODUCT`.
- New helper (product -> page fields) — colocated with the webhook domain or a
  small `meta-webhook-fields.ts`; reused by the seed handler.
- Tests: catalog scope assertion, product->fields mapping, seed subscribe
  success/failure (mock Graph), `FIELD_TO_PRODUCT` ratings routing.

## Testing

- Unit: product->fields mapping (each product, union, empty case).
- Unit: catalog includes `pages_manage_metadata` for the four products on both
  platforms; absent from products without webhook coverage.
- Unit: seed handler calls Graph with the right URL/fields on success; on Graph
  error, account still created, `webhook_subscribe_failed` incremented, no throw.
- Manual (post-deploy): reconnect one real account, confirm a row lands in
  `inbound_webhook_log` from a real event (or the dashboard "Test" button) with
  `account_resolved=1`.

## Rollout

1. Implement + tests green.
2. Deploy POC (api) + connect-tool.
3. Reconnect at least one Meta account to pick up the new scope and trigger the
   auto-subscribe.
4. Verify `inbound_webhook_log` receives real events with `account_resolved=1`.

## Open considerations

- Meta rate limits: a non-issue. `subscribed_apps` fires once per Page at
  connect time (human-paced, config call), negligible against the polling data
  calls that actually consume BUC quota. Non-blocking design absorbs any
  transient limit.
- Token longevity: the Page token used to subscribe is the one seeded (derived
  from the long-lived user token). The subscription persists on Meta's side
  independent of token expiry once created.
