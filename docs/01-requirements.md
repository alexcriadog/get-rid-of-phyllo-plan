# 01 · Requirements

**Status:** Living — normalized English summary
**Last updated:** 2026-04-23
**Canonical source:** [`../context/phyllo-replacement-requirements.md`](../context/phyllo-replacement-requirements.md) (v2)

This doc is a **navigable summary**. The canonical, exhaustive requirements (with every F-xx and NF-xx identifier) live in the source file above and will continue to be the reference for audits and ADR traceability. Update both if a requirement changes.

---

## Summary

Replace Phyllo/InsightIQ as the data gateway. Internal service (NestJS) consumed only by `backend-api`. Normalized Identity, Audience, Engagement data for 5 platforms (IG, FB, YT, Twitch, TikTok). X/Twitter handled by the existing scraper, not the connector. Business logic stays in `backend-api`; connector is a pure gateway.

Scale: 50 accounts → 5,000 (12 months) → 50,000 (36 months) without re-architecture.

---

## Scope

- **In scope:** Connect SDK equivalent (OAuth flows), Identity, Audience, Engagement data, event emission to backend-api, adapter-based extensibility for future platforms/scopes/products.
- **Out of scope:** X/Twitter (goes to scraper), business logic (brand detection, paid-post, virality, media→S3), MongoDB writes, multi-region, BYOC.

See [`00-overview.md`](00-overview.md) for the boundary with `backend-api`.

---

## Functional requirements — by category

Full IDs and text in the canonical source. Summary per category:

- **F-01..F-11 · Connect / onboarding:** OAuth per platform, multi-account per user, consent UI, disconnect, reconnect detection, canonical platform ID resolution (FB Page ID, TikTok user-info, IG Direct), pending-connection state, initial fetch on connect.
- **F-20..F-24 · Multi-organization sharing:** accounts shareable across orgs; connector stores owning org + N:N references; backend-api owns visibility policy and handover decisions.
- **F-30..F-35 · Identity:** handle, display name, bio, avatar, URL, verified status, account type, current totals (followers, following, posts). Historical snapshots are backend-api's responsibility.
- **F-40..F-44 · Audience:** gender, age, country, city, interests where platform exposes them. Distinguish "unsupported" from "empty".
- **F-50..F-56 · Engagement:** content list with type/caption/media/permalink/timestamps/metrics. 90-day default backfill. YouTube content **full via official API** (updated from v1). X/Twitter content **not in connector**. Media URLs transient; fetch timestamp included so backend-api can copy to S3.
- **F-60..F-64 · Data synchronization:** auto-refresh on cadence, on-demand refresh, initial backfill, Stories faster cadence, cadences overridable globally/per-platform/per-account.
- **F-70..F-78 · Event notifications:** lifecycle + data-product + backfill + operational events. At-least-once with DLQ. HMAC-SHA256 signed, multi-secret rotation. ACK-first delivery. Versioned event schema.
- **F-80..F-82 · Platform extensibility:** adding platform ≤ days, not weeks. No changes to core engine.
- **F-90..F-96 · Admin/ops:** sync health per account, re-enqueue, pause, cadence changes without deploy, expiring-token visibility, developer-experience endpoint.
- **F-100..F-103 · Internal API:** stable versioned REST for backend-api, backward-compat, shaped to fit behind existing `OAuthIdentityAPI` / `OAuthAccountAPI` / `OAuthProfileAPI` / `OAuthProfileAudienceAPI` / `OAuthContentAPI` ports.
- **F-110..F-112 · Ingestion throttling and idempotency:** per-(account, product) throttle lock (10min), idempotent handlers, duplicate-signal detection.

---

## Non-functional requirements — by category

- **NF-01..NF-06 · Scalability:** 50 → 5k → 50k accounts; horizontal worker scaling; scheduler not O(N) per tick.
- **NF-10..NF-14 · Isolation & fault containment:** separate EC2, per-platform failure containment, restartable workers, safe throttle locks under crash.
- **NF-20..NF-24 · Reliability:** 99.5% internal API availability, idempotent sync, bounded retries with backoff, DLQ, RTO <1h, RPO <1h for tokens.
- **NF-30..NF-31 · Freshness SLOs (p95):** identity ≤6h, audience ≤24h, new content ≤2h, recent metrics ≤6h, old metrics ≤24h, stories ≤1h, on-demand ≤60s after handler completion.
- **NF-40..NF-44 · Rate limits:** respect platform budgets globally; proactive (no "wait for 429"); graceful degradation; YouTube daily units tracked separately; per-account throttle coexists with platform-level limits.
- **NF-50..NF-58 · Security:** tokens envelope-encrypted with KMS; platform secrets in Secrets Manager; no creds in logs; short-lived OAuth state; internal-API auth; webhook HMAC with multi-secret rotation and constant-time compare; audit log.
- **NF-60..NF-63 · Compliance:** consent captured per account with scope set + privacy version; GDPR SLA delete; exportable per-creator data; platform ToS compliance.
- **NF-70..NF-73 · Data retention:** raw platform responses 30-90d then pruned, normalized data kept while connected, no long-term time-series in connector, GDPR purge overrides policy.
- **NF-80..NF-84 · Observability:** Prometheus metrics, structured logs with correlation IDs, alerting on SLO/DLQ/rate-limit/OAuth error spikes, reuse existing agent-prometheus/agent-promtail stack; `process_log` continuity via events (backend-api writes, confirmed D-05 & D-14).
- **NF-90..NF-92 · Extensibility (non-functional):** constant cost to add platform #N or data product #N; backward-compat by default.
- **NF-100..NF-104 · Deployability:** GitHub Actions → ECR → EC2 Docker Compose (matches backend-api pattern); zero-downtime deploy for API; rollback <5min.
- **NF-110..NF-111 · Cost:** materially lower than Phyllo spend; predictable scaling.

---

## Deltas from v2 canonical source

Subsequent decisions recorded during planning that extend v2:

| Ref | Added decision | Doc |
|---|---|---|
| 2026-04-22 | YouTube full scope (identity + audience + engagement via official APIs) | [`00-overview.md`](00-overview.md), [`rate-limiting.md`](rate-limiting.md) |
| 2026-04-22 | X/Twitter 100% scraper — not in connector | [`00-overview.md`](00-overview.md) |
| 2026-04-22 | `process_log` stays in backend-api (written from events) | plan file D-05 |
| 2026-04-22 | Migration = clean re-consent of ~50 creators | plan file D-migration |
| 2026-04-23 | Storage two-tier: connector MySQL for normalized platform data + raw in S3; backend-api MongoDB for enriched business data | plan file D-14, [`04-data-model.md`](04-data-model.md) |
| 2026-04-23 | Sync tiers (vip/standard/lite/demo/paused) + per-(account,product) overrides | [`refresh-cadence.md`](refresh-cadence.md) |
| 2026-04-23 | Hybrid webhook+polling ingestion; per-platform sig verification | [`ingestion-modes.md`](ingestion-modes.md) |
| 2026-04-23 | Manual refresh endpoint `/v1/accounts/:id/refresh` with HIGH priority + 60s anti-spam lock | [`manual-refresh.md`](manual-refresh.md) |
| 2026-04-23 | Connection portal embedded in frontend-app + shared contract package | [`connection-portal.md`](connection-portal.md) |

---

## Success criteria (30-day window post-cutover)

- S-01: 5 platforms connectable E2E
- S-02: ≥95% sync success per platform per product
- S-03: Freshness SLOs met at p95
- S-04: Existing 50 accounts migrated without historical series loss
- S-05: Phyllo removed from backend-api
- S-06: Phyllo subscription cancelled
- S-07: Cost materially below Phyllo spend
- S-08: Adding a new platform ≤ 2 dev-weeks
- S-09: Token-expiry cron continues delivering 14/7/3/1-day alerts correctly
- S-10: Org-sharing behavior identical to today

Full text in canonical source §7.

---

## Deferred questions

Not blocking the plan, to resolve at implementation time:

- Connect widget placement detail inside frontend-app (modal vs page)
- Historical backfill depth (default 90d — tunable per adapter)
- Phyllo monthly spend (needed for NF-110/S-07 baseline)
- Backend-api expected QPS against internal API (for API container sizing)
- Organization model authority (backend-api as sole source vs denormalize into connector)

Full list in canonical source §9.

---

## Related docs

- [`00-overview.md`](00-overview.md)
- [`02-architecture.md`](02-architecture.md)
- [`03-extensibility.md`](03-extensibility.md)
- [`../context/phyllo-replacement-requirements.md`](../context/phyllo-replacement-requirements.md) (canonical)
