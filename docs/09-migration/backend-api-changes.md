# Backend-API Changes

**Status:** Living
**Last updated:** 2026-04-23

Exact changes required in `socialmedia-backend` to swap Phyllo → connector. Implemented in Sprint 5. Paired with the cutover procedure in [`cutover-plan.md`](cutover-plan.md).

---

## Philosophy

The connector is designed so that **backend-api's domain and use case layers don't change**. All changes live in the infrastructure layer (adapters) + DI wiring + a new inbound event receiver.

Existing OAuth ports in backend-api stay identical:
- `OAuthIdentityAPI`
- `OAuthAccountAPI`
- `OAuthProfileAPI`
- `OAuthProfileAudienceAPI`
- `OAuthContentAPI`

New connector adapters implement the same interfaces. DI container swaps which implementation is active, per platform.

---

## Files to CREATE in backend-api

Location: `src/modules/oauth/infrastructure/`

| File | Implements | Purpose |
|---|---|---|
| `connector-identity.adapter.ts` | `OAuthIdentityAPI` | Maps port methods to connector REST calls |
| `connector-account.adapter.ts` | `OAuthAccountAPI` | Same |
| `connector-profile.adapter.ts` | `OAuthProfileAPI` | Same |
| `connector-profile-audience.adapter.ts` | `OAuthProfileAudienceAPI` | Same |
| `connector-content.adapter.ts` | `OAuthContentAPI` | Same |
| `connector-http.service.ts` | — | Shared HTTP client (service token header, retries, correlation ID) |

Location: `src/modules/oauth/interfaces/`

| File | Purpose |
|---|---|
| `connector-event-receiver.controller.ts` | `POST /oauth/connector-events` — verifies HMAC signature with multi-secret rotation support; dedups by `event_id`; dispatches to existing use cases |

Location: `src/modules/oauth/infrastructure/idempotency/`

| File | Purpose |
|---|---|
| `event-idempotency.service.ts` | Insert `event_id` into Mongo collection `connector_event_idempotency` with unique index; catch duplicate-key errors as "already processed" |

---

## Files to MODIFY

### `src/modules/oauth/oauth.module.ts`

Add DI binding with feature flag per platform:

```
providers: [
  { provide: OAuthIdentityAPI, useFactory: (cfg) => cfg.get('DI_PROVIDER_GLOBAL') === 'connector'
      ? new ConnectorIdentityAdapter(...) : new InsightIQIdentityAdapter(...) },
  // similar for OAuthAccountAPI, OAuthProfileAPI, OAuthProfileAudienceAPI, OAuthContentAPI
]
```

Actually: the port granularity is one adapter covering all 5 ports per provider. DI picks **by platform** at runtime. The adapter selects Phyllo vs connector client based on env var `DI_PROVIDER_<PLATFORM>`:

```
DI_PROVIDER_INSTAGRAM=connector
DI_PROVIDER_FACEBOOK=phyllo            # still on old path during cutover
DI_PROVIDER_YOUTUBE=phyllo
DI_PROVIDER_TWITCH=phyllo
DI_PROVIDER_TIKTOK=phyllo
```

### `src/modules/oauth/interfaces/oauth.controller.ts`

No changes required. Existing `/oauth/webhook-receiver` keeps serving Phyllo webhooks for whichever platforms are still on Phyllo. New `/oauth/connector-events` (connector-emitted) is handled by the new controller.

### Existing use cases (`on-*.usecase.ts`)

**Unchanged.** Adapters preserve their signatures. New connector-event-receiver controller translates connector event payloads into the shape these use cases already expect. This keeps domain logic untouched.

The translation layer in `connector-event-receiver.controller.ts`:

```
// pseudocode
onEventReceived(event):
  switch event.event_type:
    case 'account.connected':
      handleAccountConnectedUseCase.execute({ ...mapFromEvent(event) })
    case 'account.disconnected':
      onDisconnectedAccountUseCase.execute({ ...mapFromEvent(event) })
    case 'profile.updated':
      onAddedProfileUseCase.execute({ ...mapFromEvent(event) })
    case 'content.added' | 'content.updated':
      onAddedContentUseCase.execute({ ...mapFromEvent(event) })
    case 'audience.updated':
      onAddedProfileAudienceUseCase.execute({ ...mapFromEvent(event) })
    case 'refresh.completed':
      // forward to WebSocket/SSE for frontend
```

Map functions align event data → use-case input. Most fields map 1:1 with renames (e.g. `account_id` → `phyllo_account_id` — yes, we keep the name in use cases to avoid churn; connector `account_id` just takes its slot).

---

## Process log continuity (D-14 ramification)

Today backend-api writes `process_logs` for every Phyllo webhook. After cutover, same `process_logs` are written from connector-event-receiver. Same `type:` values (`phyllo_account_connected`, `phyllo_content_added`, etc.) for dashboard compatibility. Grafana dashboards filtering on `source: 'phyllo'` keep working — mapping-wise the `source` field stays but the data now originates from events.

Eventually rename to `source: 'connector'` after all dashboards updated. Not required at cutover.

---

## Idempotency table

Collection: `connector_event_idempotency` in the default Mongo connection.

Schema:
```
{
  event_id: String (unique index),
  event_type: String,
  received_at: Date,
  processed_at: Date,
  processing_result: 'success' | 'error' | 'skipped'
}
```

TTL: 30 days (auto-purge).

Inbound flow:
1. Receive `POST /oauth/connector-events` with signed body.
2. Verify HMAC signature using multi-secret set.
3. Verify `signature_timestamp` within 10 min of now.
4. `INSERT INTO connector_event_idempotency { event_id }` — unique violation means already processed, return 200.
5. Dispatch to use case.
6. Update `processed_at`, `processing_result`.
7. Return 200.

Processing is **async-after-ACK**: the HTTP handler returns 200 fast (within ~100ms), kicks off the use case via Bull queue or similar in backend-api. Matches connector's "ACK-first delivery" expectation (F-76).

---

## Environment variables in backend-api

Add:
```
CONNECTOR_BASE_URL=https://connector-prod.internal
CONNECTOR_SERVICE_TOKEN=<from Secrets Manager>
CONNECTOR_INBOUND_HMAC_SECRETS=<comma-separated rotation set>
DI_PROVIDER_INSTAGRAM=phyllo                           # default to phyllo pre-flip
DI_PROVIDER_FACEBOOK=phyllo
DI_PROVIDER_YOUTUBE=phyllo
DI_PROVIDER_TWITCH=phyllo
DI_PROVIDER_TIKTOK=phyllo
```

After each flip day, the corresponding flag moves to `connector`.

---

## Testing before flip

Integration tests in backend-api:
1. **Adapter swap test** — with flag set to `connector` for one platform, connect a test account via UI, verify `process_logs` entries match pre-flip shape (all type: values, metadata fields).
2. **Parallel-run diff** — with flag set to `parallel` (if implemented), compare outputs side-by-side.
3. **Idempotency test** — send the same event twice, assert use case runs once.
4. **Signature rotation test** — rotate HMAC secret, verify both old+new work until old is removed.
5. **Rollback test** — flip flag from connector back to phyllo, verify no data loss, existing accounts remain reachable.

---

## Cleanup after all platforms cut over (post-Sprint 6)

- Delete `src/modules/oauth/infrastructure/insightiq-*.adapter.ts`
- Delete `src/modules/oauth/infrastructure/utils/insight-iq/` (utils, webhook signing for Phyllo)
- Remove `INSIGHTIQ_CLIENT_KEY`, `INSIGHTIQ_SECRET_KEY`, `API_ACTIVE_URL` env vars
- Remove `/oauth/webhook-receiver` endpoint if no other use
- Rename `phyllo_*` process_log types to `connector_*` (optional, if dashboards are updated)
- Simplify `oauth.module.ts` DI wiring (remove feature flags, go direct)

This cleanup is NOT part of the cutover itself. It happens after 30+ days of stable connector-only operation.

---

## Related docs

- [`cutover-plan.md`](cutover-plan.md) — when and how each flip happens
- [`../05-api-contract.md`](../05-api-contract.md) — connector endpoints backend-api will call
- [`../06-event-catalog.md`](../06-event-catalog.md) — event shapes for the receiver
- [`../08-operations/security.md`](../08-operations/security.md) — service token + HMAC rotation
- [`../connection-portal.md`](../connection-portal.md) — frontend-app OAuth flow integration
