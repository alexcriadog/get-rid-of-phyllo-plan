# ADR 0014 — Meta rate-limit mirror

**Status:** Accepted
**Date:** 2026-05-04
**Supersedes (in part):** ADR 0008 (token-bucket rate limits) for the Meta family
**Related:** ADR 0009 (rate-limit strategy), `docs/rate-limiting.md` §0

## Context

Until 2026-05-04 the Meta family adapters (Instagram, Facebook) gated outbound calls with the same generic local token-bucket the rest of the platforms use, configured at a flat `200 calls/hour` per scope (`user_token`, `app`, `page`). That cap was **invented**, not derived from anything Meta publishes:

- Meta's actual Instagram Platform cap is `4800 × Impressions per 24h` per `(App, Asset)` — for an account with 100k daily impressions, that is ~480M calls/24h.
- Meta's actual app-level cap (X-App-Usage) is `200 × Daily Active Users per hour`, scoped per Meta App and only counting calls made with User/System User tokens (Page tokens are excluded).

Three concrete consequences of the invented cap:

1. With ~5 connected accounts we were operating at ~1% of Meta's real budgets but blocking calls at our own ceiling whenever a single sync did >200 calls in an hour. The synthetic `app` scope in particular acted as an artificial bottleneck shared across every account.
2. We had no visibility into the bucket Meta actually maintains. The `X-Business-Use-Case-Usage` and `X-App-Usage` headers were captured into `api_call_log.usage_header` for forensics but never consulted at admission time.
3. When Meta itself starts throttling — the `estimated_time_to_regain_access` field of the BUC header — we ignored it; we kept hitting Meta until we got a 429, which then pollutes the next BUC window.

We had two options:

- **(A) Increase the synthetic cap.** Raise the 200/h to something larger and call it a day. Cheap, but still wrong: the real cap is per-asset and scales with each account's own impressions. A static number cannot reflect that, and we'd still be blind to throttle signals from Meta.
- **(B) Mirror what Meta tells us.** Build a local view of each Meta-modelled bucket from the response headers, and gate on that. This is the standard pattern (Phyllo, Hootsuite, Buffer all do this).

## Decision

Adopt (B). Implement the mirror in three phases so each can be validated independently.

**Phase 1 — passive observation.** Persist `X-App-Usage` and `X-Business-Use-Case-Usage` to Redis after every Meta response. No gating. Surface the state via `GET /admin/rate-limits`. Backfill from `api_call_log.usage_header` to bootstrap visibility without waiting for a sync cycle.

**Phase 2 — per-asset gating.** Before each Meta call, consult the per-asset bucket(s) (`asset:{ig_account_id}` for IG, `asset:{page_id}` for FB) plus the business asset bucket. Deny when `call_count_pct >= 75` or when Meta's `estimated_time_to_regain_access > 0`. Throw `RateLimitedError` so the existing worker retry path applies the right delay.

**Phase 3 — app-level gating + cap removal.** Add `app:{app_id}` to the gate (mirrored from `X-App-Usage`). Remove the synthetic `app` scope from the Instagram and Facebook strategies entirely. Keep the `user_token` scope as a local runaway-protection fuse only.

## Consequences

### Positive

- The active cap per call is now derived from what Meta is actually willing to serve, which scales with each account's traffic. A 100k-impressions account gets ~480M calls/24h of headroom, where before we'd cap it at 4.8k/day.
- We respect Meta's own backoff signals (`estimated_time_to_regain_access`) so we stop adding load when Meta says we're throttled, and we don't burn the next BUC window with calls Meta would have rejected anyway.
- `GET /admin/rate-limits` gives operators a real-time view of which assets are running hot.
- Adding new connected accounts no longer pressures other accounts via a shared synthetic `app` ceiling — the per-asset model is naturally horizontally scalable.

### Negative / risks

- The mirror state is only as fresh as the last Meta response. Between calls, the state ages. We mitigate by consulting Meta's own `estimated_time_to_regain_access` (which decreases predictably) and by accepting fail-open semantics for cold/unknown buckets — Meta will reject with a real 429 if we overshoot.
- We rely on Redis availability for the gate. Redis down → fail-open. This was discussed and accepted as the conservative default; the alternative (fail-closed) would block all syncs during an unrelated cache outage.
- The `user_token` legacy bucket still exists as a fuse but is now redundant under normal operation. We keep it because removing it requires more work than it saves; flagged as cleanup in `docs/TODO.md`.
- The 75% threshold and 60s default backoff are static. Future work may make them adaptive (see `docs/TODO.md` Phase 4 — inflight tracking, hash-based time bucketing).

### What this does NOT do

- TikTok, YouTube, Twitch, Threads keep the original token-bucket model from ADR 0008. Their rate-limit shapes are different (TikTok per-endpoint counters, YouTube daily quota, Twitch per-minute points) and the BUC mirror pattern doesn't transfer cleanly. Threads observes via `BucTelemetryService.observe()` for visibility but does not yet gate.
- Atomic acquire across multiple concurrent workers (Lua-script style) is not part of this decision; the per-call sequential `HGETALL` is acceptable at current concurrency. See `docs/TODO.md` for the Phase 4 work.

## Files

- `poc/src/modules/platforms/shared/meta-graph/buc-telemetry.service.ts` — the mirror itself.
- `poc/src/modules/platforms/shared/meta-graph/graph-client.ts` — `BoundGraphClient.call()` consults `checkGate()` before HTTP.
- `poc/src/modules/platforms/shared/threads-api/threads-client.ts` — calls `observe()` only (Phase 1 visibility).
- `poc/src/modules/platforms/instagram/instagram.rate-limit.strategy.ts` — `bucKeys()` returns `[asset:{ig_account_id}]`; synthetic `app` scope removed.
- `poc/src/modules/platforms/facebook/facebook.rate-limit.strategy.ts` — `bucKeys()` returns `[asset:{page_id}]`; synthetic `app` scope removed.
- `poc/src/modules/admin/admin.controller.ts` — `GET /admin/rate-limits`, `POST /admin/rate-limits/replay`.
