# ADR 0015 — Meta token-type normalisation at seed time

**Status:** Accepted
**Date:** 2026-05-04
**Related:** ADR 0007 (KMS envelope tokens), ADR 0014 (Meta rate-limit mirror), `docs/connection-portal.md` §0

## Context

The Meta family (Facebook Pages, Instagram Business) supports several access-token types and the choice has direct consequences for rate limits and token lifetime:

| Token type | Lifetime | Counts toward app-level cap (`200 × DAU/h`)? |
|---|---|---|
| User access token | ~60d (long-lived) | **Yes** |
| Page access token | never (as long as the user remains valid) | No (Page tokens are excluded) |
| System User access token | never | No |
| Threads user token | 60d when long-lived; refreshable via `th_refresh_token` | n/a (Threads has its own scope) |

Pre-2026-05 the connector had three independent paths that could persist a token to `oauth_tokens`:

1. The structured discovery UI in `/admin/connect`, which extracted `page.access_token` from `/me/accounts` correctly.
2. The "Manual connect (bypass discovery)" form in the same page, which persisted whatever the operator pasted verbatim.
3. The public `POST /accounts/seed` endpoint and its helper scripts (`scripts/seed-tiktok-account.ts`, etc.), which also passed the token straight through.

A 2026-05-04 audit (`/debug_token` over every persisted Meta token) revealed:

- IG @padelwithjud (account 2) was holding a USER token — almost certainly because it was first connected via path 2 or 3.
- The other Meta accounts had PAGE tokens, but the FB ones still showed up in the App-Level dashboard for `/{page_id}/insights` and `/{page_id}/stories` calls (Meta routes those endpoints through user-context permissions even when the supplied token is a Page token; this contradicts the literal reading of the public docs but matches observed behaviour in `api_call_log.usage_header`).

For Threads, the parallel issue was that `seedConnection` never invoked `ThreadsTokenRefreshService.exchangeShortLived()` even though it existed — the result was that whatever short-lived token the operator pasted got persisted as-is and died ~hours later, marking the account `needs_reauth` repeatedly.

## Decision

Move every guarantee about token type to a single chokepoint that all paths must traverse: `AccountsService.seedAccount()`.

For Meta family accounts:

1. Call `GET /me/accounts?fields=id,access_token,instagram_business_account{id}` with the supplied token.
2. **If the response is a list of pages** → the token is a User token. Find the page that matches `canonical_user_id` (FB: `page.id === canonicalUserId`; IG: `page.instagram_business_account.id === canonicalUserId`). Replace `accessToken` with that page's `access_token` before encrypting.
3. **If the response is `(#100) nonexisting field (accounts)`** → it's already a Page token. Probe `GET /{canonical_user_id}?fields=id` to verify the token actually accesses the requested resource, then accept it as-is.
4. **Anything else** → throw `BadRequestException` carrying the upstream Meta error. Nothing reaches the AES vault.

For Threads, `AdminService.seedConnection()` always invokes `ThreadsTokenRefreshService.exchangeShortLived()` first; on success the long-lived token plus `expires_at` is persisted, on failure (e.g. the token is already long-lived and Meta rejects the exchange, or `THREADS_APP_SECRET` is unset) we fall back to persisting the original.

## Consequences

### Positive

- Operators can no longer accidentally persist a User token via the Manual form, the public seed endpoint, or a script — there is exactly one chokepoint and it enforces the invariant.
- The Meta App-Level cap (`200 × DAU/h`, see ADR 0014) stops accumulating from FB Page calls that should be exempt. The remaining App-Level pressure comes only from the small set of FB endpoints where Meta routes through user permissions even with a Page token.
- Threads tokens persisted via the connect flow are now reliably 60d long-lived with `expires_at` populated. The proactive refresh path (`ThreadsTokenRefreshService.ensureFresh`) actually fires now — previously `expiresAt: null` made it early-return.

### Negative / risks

- The seed flow now does an extra HTTP call to Meta (`/me/accounts` or the page probe). Latency cost is one round-trip; throughput is acceptable because seeds are infrequent.
- A token that once worked but has lost the `pages_show_list` scope will fail normalisation with a `BadRequestException`. This is the correct failure mode (we want to reject, not silently store an unusable token) but it is a behaviour change.
- Threads' `exchangeShortLived` requires `THREADS_APP_SECRET`. Operators must set it; without it the connect succeeds but persists whatever was pasted, with a warning log. This was a deliberate compromise to keep the connect flow working in dev environments without the secret configured.

### What this does NOT do

- It does not migrate already-persisted bad tokens. Account 2's User token was migrated separately via a one-shot script that called `/me/accounts`, found the matching Page, and rotated `access_token_ciphertext` directly. Future re-OAuth from the UI will trigger the chokepoint normally.
- It does not introduce token-rotation policy beyond what each platform's refresh service already does. The chokepoint guarantees the *type* of token at seed time, not its long-term lifecycle.

## Files

- `poc/src/modules/accounts/accounts.service.ts` — `normalizeMetaToken()` plus the `seedAccount` wiring.
- `poc/src/modules/admin/admin.service.ts` — `seedConnection()` for the Threads `exchangeShortLived` step.
- `poc/src/modules/platforms/shared/threads-api/threads-token-refresh.service.ts` — the long-lived exchange that was never being called pre-2026-05.
