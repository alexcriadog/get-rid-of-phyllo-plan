# Historical Backfill

**Status:** Living
**Last updated:** 2026-04-23

When a creator connects a new account, how far back does data go? When we migrate from Phyllo, do we lose history? This doc answers both, per platform and per dimension.

---

## 1. Two dimensions — they behave very differently

| Dimension | Recoverable historically? |
|---|---|
| **Content list** (posts, videos, their IDs, captions, publish timestamps) | **Mostly yes** — platform APIs let us paginate backward |
| **Metric history** (likes on day X, follower growth per day, views at T) | **No** — platform APIs return current state only; historical snapshots must be built by polling over time |

The second dimension is the harder one. No platform gives us "likes count on 2026-03-15". They give us "likes count now". Daily series is something we build by polling and persisting snapshots. Phyllo has been doing that; after cutover, the connector does it going forward — and backend-api's MongoDB preserves the series that already exists.

YouTube is the only partial exception: **YouTube Analytics API** exposes historical reports with day granularity. For other platforms, history is what we polled and stored.

---

## 2. Per-platform capability at connect time

What we can pull on a **fresh connect** (cold backfill) for a newly connected account:

| Platform | Content list (backfill depth) | Metrics at backfill | Notes |
|---|---|---|---|
| **Instagram** | Full history (since account inception). Paginate `/me/media`. | Current state only (likes/comments/views at backfill moment) | Stories not recoverable — 24h TTL on platform |
| **Facebook** | Full history. Paginate `/{page-id}/posts`, `/videos`. | Current state + some Page Insights back up to 2 years (lifetime period) | Page Insights "days_28" windows available historically |
| **YouTube** | Full history. `playlistItems.list` on uploads playlist — 1 unit/call, cheap. | Data API: current state only. **Analytics API: daily report per dimension going back ~2 years.** | YT is our most "historically recoverable" platform |
| **Twitch** | **Partial** — VODs expire on platform side (14d non-Partner, 60d Partner). Old VODs are gone. Clips persist. | Current state only | The one platform where content itself can be permanently lost |
| **TikTok** | Paginate `/v2/video/list/` — returns back as far as pagination allows (limit subject to TikTok API changes). | Current state only | |

**Backfill is cheap on some platforms, expensive on others:**
- YouTube `playlistItems.list` = 1 unit/call = 10,000 videos listable per day with zero impact on quota headroom
- IG + FB paginate without consuming "per-post" budget beyond the normal Graph API quota
- TikTok uses the standard rate bucket
- Twitch has no retention on our side to worry about (whatever exists, we can pull)

---

## 3. Migration preservation — we do NOT lose history at cutover

**Key insight:** historical series already lives in `backend-api`'s MongoDB. The connector doesn't own it. Cutting over from Phyllo → connector doesn't touch it.

Collections that preserve historical metric series:
- `accounts_stats_history` — daily follower/following/posts counts, followers_growth
- `accounts_posts_stats_history` — per-post metrics by day
- `accounts_audience_demographics_history` — audience snapshots by day

These are written by `backend-api`'s `OnAdded*` use cases in response to Phyllo webhooks today, and will be written in response to connector events after cutover. **The handoff is at the event-source level; the storage doesn't change.**

What could be lost at cutover — and isn't:
- Snapshots Phyllo collected but `backend-api` never wrote to Mongo? **None** — `backend-api` writes to Mongo in every webhook handler (`on-added-profile`, `on-added-content`, `on-added-profile-audience`). What Phyllo sent, Mongo has.
- Raw API responses Phyllo cached? We didn't store those centrally anyway; they were transient on Phyllo's side.

## 4. Pre-cutover export + diff (validation step)

Optional belt-and-suspenders for each platform's cutover day:

**Day -1 of each platform flip:**
1. Export everything Phyllo has for that platform's accounts (Phyllo has data-export APIs or a bulk dump).
2. Compare with what's in `backend-api`'s MongoDB collections:
   - Count of posts per account in Phyllo's dump vs count in `posts` collection
   - Earliest/latest timestamps match
   - Sample-compare N random posts for metric agreement within tolerance
3. If diffs are within tolerance → cleared for cutover.
4. If diffs are material → investigate: is it Phyllo returning stale, or did we drop writes? Usually the former. Document and proceed.

Time budget: 1-2 days per platform, runs in parallel with other cutover prep.

This doesn't change architecture; it's a pre-flight check.

---

## 5. Backfill depth — configurable, not hardcoded

The plan defaults to **90 days** for the initial backfill on connect. This is a **product choice**, not a platform limit. Making it configurable:

### Global default
Row in `cadences`-adjacent config table (or the existing `cadences` table with a new column):
```
platform | backfill_default_days
ig       | 90
fb       | 90
yt       | 365         # cheap, why not
twitch   | max         # whatever isn't expired
tiktok   | 90
```

### Per-sync_tier
Tiers can override the global depth:

| Tier | Backfill depth |
|---|---|
| `vip` | 365d or `full` |
| `standard` | 90d (global default) |
| `lite` | 30d |
| `demo` | 7d |

### Per-account override
`account_backfill_overrides` table (analogous to `account_cadences`):
```
account_id | backfill_depth_days | created_at | created_by | reason
```

Resolution: override > tier > platform default.

**Backfill runs as a one-off BACKFILL-priority job** on first connect (already in the plan; see `account.backfill_started` / `account.backfill_complete` events). Depth is read at enqueue time. If ops wants to re-backfill an existing account to more depth, a new admin endpoint triggers it:

```
POST /v1/admin/accounts/:id/re-backfill
  { depth_days: 365, reason: 'client_onboarding_VIP_upgrade' }
```

---

## 6. New tier: `vip_backfill_full` (optional)

If "vip" always means "full history", we can fold it into the existing `vip` tier (backfill = full). Or split:

| Tier | Multiplier (cadence) | Backfill depth |
|---|---|---|
| `vip` | 0.5× | 365d |
| `vip_backfill_full` | 0.5× | **full** (platform-permitting) |

I'd recommend **not** creating a new tier — instead set backfill via the per-account override when a VIP client wants full. Keeps tiers small and composable. But if "full-backfill VIPs" become a recurring pattern, the dedicated tier makes the admin API cleaner.

Decision: **keep as per-account override for now**, revisit if pattern emerges.

---

## 7. Re-backfill after-the-fact

A creator was connected 6 months ago with default 90d backfill. Now the client wants the full year-plus. Can we?

**Yes, subject to platform retention:**
- IG, FB, YT: yes, full history still available server-side
- Twitch: only whatever hasn't expired (limited)
- TikTok: subject to pagination limits

Admin endpoint `POST /v1/admin/accounts/:id/re-backfill` enqueues a BACKFILL-priority job with the requested depth. Respects rate limits. Emits `account.backfill_started` + `account.backfill_complete`.

Re-backfills detect what we already have and skip duplicates (idempotent upsert on `posts.platform_content_id`).

**Metric history for the re-backfilled period** is still "current-state-at-re-backfill-time", not per-day history — platforms don't give us that. The new posts added by re-backfill will have metric snapshots from today onward, not from their publish date.

YouTube is the exception — Analytics API can retroactively fill daily metrics history for re-backfilled videos. Adapter handles this in a secondary pass after the basic backfill completes.

---

## 8. Failure modes

| Scenario | Behavior | Remediation |
|---|---|---|
| Platform paginates back N pages then errors | Worker retries the page; marks partial success after max retries | `account.backfill_complete` event still fires with `complete: false, reached: <timestamp>`. Ops can trigger re-backfill later. |
| Backfill burns through daily rate-limit budget | Rate-bucket re-queues with delay; backfill spans multiple days for that account | `account.backfill_progress` events inform the UI |
| Creator disconnects mid-backfill | In-flight job completes; no further fetches | Data we got so far is retained with `posts.metric_backfilled_at` marker |
| Twitch VODs already expired | Content simply isn't returned | `supported_fields` for Twitch notes "content before expiry window is not retrievable" — UI can display "data from <date> onward" |
| Re-backfill for an account at 50k accounts already | BACKFILL priority queue absorbs; rate limits protect platform | Metric: `connector_backfill_queue_depth`; alert if sustained |

---

## 9. Observability

Metrics:
- `connector_backfill_started_total{platform,depth_days,trigger="connect|re-backfill"}`
- `connector_backfill_items_fetched{platform,account_id}`
- `connector_backfill_duration_seconds{platform}`
- `connector_backfill_incomplete_total{platform,reason}` — hitting retention limit, rate bucket, platform error

Dashboards: dedicated "Backfill" panel; track re-backfill requests for capacity planning.

---

## 10. Related docs

- [`refresh-cadence.md`](refresh-cadence.md) — periodic cadences (distinct from one-off backfill)
- [`rate-limiting.md`](rate-limiting.md) — backfill jobs respect buckets like any other
- [`06-event-catalog.md`](06-event-catalog.md) — `account.backfill_*` events
- [`09-migration/cutover-plan.md`](09-migration/cutover-plan.md) §Parallel-run validation — Phyllo export diff
- [`07-platforms/*.md`](07-platforms/) — per-platform sections on historical capability
