# Cutover Plan — Phyllo → Connector

**Status:** Living — updated as cutover progresses
**Last updated:** 2026-04-23

Plan for replacing Phyllo/InsightIQ with the connector in production, per-platform. Corresponds to Sprint 6 in the overall plan.

---

## Overview

**Principle: no big-bang.** Flip one platform at a time. Each flip is gated by validation. If a platform flip fails, it can be reverted in minutes by flipping the feature flag back to Phyllo. Other platforms remain on whichever adapter they're currently using.

**Sequence (one per week):**
1. Instagram (highest volume, tests the full pipeline end-to-end)
2. Facebook (shares Meta infra; most risk already absorbed by IG flip)
3. TikTok (distinct OAuth, different API shape)
4. YouTube (depends on Google App Verification)
5. Twitch (smallest cohort, closer to pure lifecycle testing)

Total cutover: **3 weeks** if all flips go smoothly. Extend if any flip finds issues.

---

## Pre-cutover checklist (before week 1)

- [ ] Connector running in prod; all 5 platforms adapted
- [ ] All App Reviews approved (Meta, TikTok, Google)
- [ ] Meta app has webhook subscriptions configured for production callback URL
- [ ] Backend-api integration merged (see [`backend-api-changes.md`](backend-api-changes.md))
- [ ] Feature flag in backend-api DI container accepts per-platform toggles
- [ ] Monitoring dashboards live; alert rules armed
- [ ] Runbook reviewed by on-call team
- [ ] Re-consent messaging drafted (bilingual ES/EN)
- [ ] Communication plan for the ~50 affected creators
- [ ] Rollback procedure rehearsed in dev (flip back to Phyllo, verify data still flows)
- [ ] Phyllo subscription renewal freeze — don't auto-renew, leave running pay-as-you-go

---

## Per-platform flip procedure

### Day 0 — Prep
1. Verify connector adapter for the platform is passing all parallel-run diff tests (see §Validation below).
2. Announce flip window in #connector-alerts + #platform-ops.
3. Confirm on-call rotation for next 48h.

### Day 1 — Re-consent invitations
1. Send re-consent email/notification to creators with accounts on the target platform. Copy explains: "We're moving to an improved integration. Please reconnect your account within the next 5 days."
2. Track re-consent status in backend-api.
3. Creators who reconnect go through connector (feature flag says `connector`). Phyllo continues for creators who haven't yet.

### Day 5 — Flip the flag
1. Merge `DI_PROVIDER_<platform> = 'connector'` change to backend-api prod.
2. Deploy. New OAuth flows and all subsequent reads for that platform route to the connector.
3. Phyllo stops receiving new connections for this platform. Existing accounts still flow through Phyllo until the creator reconnects.
4. Monitor for 24h:
   - connector-emitted event volume matches expected (no drop)
   - backend-api `process_logs` continue writing (mapped from events)
   - Freshness SLOs stable
   - No `account.needs_reauth` spike beyond expected re-consent tail
   - DLQ stays empty

### Day 7 — Last chance + fallback
1. Reminder to remaining non-reconnected creators.
2. Remaining accounts: backend-api's existing scraper takeover kicks in (per C-08) once Phyllo disconnects them.
3. When all target-platform accounts have either reconnected via connector OR handed off to scraper, this platform is done.

### Day 7+ — Mark platform "cutover complete"
- Update cutover tracker.
- Confirm Phyllo is no longer receiving any data for this platform.
- Move to next platform.

---

## Parallel-run validation (Day 0 each week)

Before flipping the flag for a platform, run in **parallel mode**:

1. In a dev/staging env, feature flag: `DI_PROVIDER_<platform> = 'parallel'`.
2. In parallel mode, backend-api calls BOTH Phyllo and connector adapters; stores outputs side-by-side for comparison.
3. Diff tool compares:
   - Event counts match (within 5%)
   - Post metadata matches (content_id present in both sources for same creator)
   - Metric deltas within 10% (platform-side clock skew tolerated)
   - No enriched fields (brands, virality) diverge — those live in backend-api anyway, so the two paths should produce identical enrichment given same inputs
4. Any diff > threshold → investigate adapter bug before Day 5 flip.

Diffs allowed:
- **Fields connector provides that Phyllo didn't** (e.g., cleaner YT Analytics data) — expected upgrade.
- **Fields Phyllo enriched but connector doesn't** — these are OUT of connector's scope (business logic stayed in backend-api); should be unchanged through the flip.

---

## Rollback per platform

If the flip goes wrong within the first 48h:
1. Merge revert PR: `DI_PROVIDER_<platform> = 'phyllo'`.
2. Deploy to prod (<5 min).
3. Connector-emitted events stop being produced for that platform; Phyllo resumes.
4. Reconnected creators (those who went through connector) will find their account is in a state where Phyllo still has a stale token — handled by backend-api as `needs_reauth`, one more re-consent.
5. Debrief; fix; retry the flip in a future week.

RTO for rollback: **<5 min** (Docker Compose restart + env update).
Data loss: 0 (connector DB retains everything; Phyllo resumes from its own state).

---

## Post-cutover — all 5 platforms done

Checklist:
- [ ] All 5 `DI_PROVIDER_*` flags set to `connector`.
- [ ] Zero Phyllo-emitted events observed for 7 days.
- [ ] All monitoring green for 7 days.
- [ ] S-01 through S-10 success criteria (requirements §7) validated over 30-day window.
- [ ] Cancel Phyllo subscription (S-06).
- [ ] Remove Phyllo integration code from backend-api (cleanup PR) — adapter files for InsightIQ deleted, `INSIGHTIQ_*` env vars removed.
- [ ] Update `docs/01-requirements.md` and `docs/00-overview.md` to note "Phyllo removed YYYY-MM-DD".

---

## Communication plan

- **Internal:** #connector-alerts for ops, #product for stakeholder updates, daily standup during cutover weeks.
- **External (to creators):** transactional email + in-app notification. Bilingual (ES/EN). Subject: "Action required: reconnect your <platform> account". Copy approved by product + legal.
- **Executive:** weekly summary during cutover weeks.

---

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| App Review not approved by cutover date | Delay that platform's flip; keep Phyllo running for it. No impact on other platforms. |
| Meta outage during flip window | Pause the week's flip; retry the following week. |
| Re-consent rate too low (<50% in 5 days) | Extend re-consent window by 1 week; consider incentive (product decision). |
| Connector bug surfaces in prod load | Rollback (5 min), fix, resume. Parallel-run in previous week should catch most. |
| Google App Verification delayed (YouTube) | YouTube cutover pushed; Phyllo runs YouTube longer. Other platforms can still cut over. |

---

## Related docs

- [`backend-api-changes.md`](backend-api-changes.md) — adapter swap checklist
- [`../07-platforms/*.md`](../07-platforms/) — per-platform quirks that may affect flip
- [`../08-operations/runbook.md`](../08-operations/runbook.md) — rollback procedure
- [`../01-requirements.md`](../01-requirements.md) §7 — success criteria (S-01..S-10)
