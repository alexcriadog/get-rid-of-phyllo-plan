# Rate Limiting

**Status:** Stable reference
**Last updated:** 2026-04-23
**Answers question:** Q1 — How do we control rate limits per platform?

Every creator platform publishes a different rate-limit model — hourly budgets, daily quotas, per-minute points, per-endpoint counters. The connector's job is to respect **all of them simultaneously** without ever triggering a 429 during normal operation. This doc defines the strategy, the data structures, the per-platform configs, and the failure modes.

---

## 1. Why the platforms differ

| Platform | Model type | Unit | Reset | Source of truth |
|---|---|---|---|---|
| Meta (IG + FB) | Percent-of-budget per token + per-app + per-page (**Business Use Case**) | % (0–100) | Sliding 1 hour | `X-Business-Use-Case-Usage`, `X-App-Usage`, `X-Page-Usage` headers |
| YouTube Data v3 | Daily quota units | 10,000 units/day per GCP project (shared across ALL our YT accounts) | UTC 00:00 | Docs; no live header |
| YouTube Analytics | Separate daily quota | ~2,000 queries/day default | UTC 00:00 | Docs; no live header |
| Twitch Helix | Points per minute per token | 800 pts/min per app token + 800/min per user token | Sliding 1 minute | `Ratelimit-Remaining`, `Ratelimit-Reset` |
| TikTok | Per-endpoint counters | Varies (e.g. `video.list` = 100/hour/user) | Varies | 429 response + `Retry-After` header |

**Consequence:** we cannot use a single "N calls per minute" abstraction. Each adapter must declare **its own bucket topology** — one bucket per distinct limit scope it cares about.

---

## 2. The `RateBucketService` abstraction

The core engine never hardcodes a platform's limit. Adapters declare buckets; the service applies them.

```
┌────────────────────────────────────────────────────────────────┐
│   interface PlatformAdapter {                                  │
│     rateLimitHints(): RateLimitHint[]                          │
│     // returns a list of buckets this adapter consumes,        │
│     // keyed by (platform, scope, id_template)                 │
│   }                                                            │
│                                                                │
│   type RateLimitHint = {                                       │
│     scope: string            // e.g. 'user_token' | 'app' |    │
│                              //      'page' | 'daily_quota'    │
│     keyTemplate: string      // e.g. 'rate:ig:user_token:{id}' │
│                              //  (id resolved at call time)    │
│     capacity: number         // tokens the bucket holds full   │
│     refillRatePerMs: number  // tokens restored per ms         │
│     costPerCall: number      // default = 1; YT varies         │
│     strategy: 'token-bucket' │ 'daily-counter' │ 'per-minute'  │
│   }                                                            │
└────────────────────────────────────────────────────────────────┘
```

Before any external HTTP call, the worker calls:

```
result = RateBucketService.acquire(hints, context)
  -> { allowed: true,  tokensRemaining: N }
  -> { allowed: false, resetInMs: N }
```

If `allowed: false`, the job is **re-enqueued with `delay = resetInMs + jitter(0-5s)`**. The worker logs a rate-limit-hit metric and moves to the next job. No blocking, no polling.

All buckets live in Redis (single source of truth across N worker replicas).

---

## 3. Token bucket algorithm (IG / FB / Twitch / TikTok)

Implemented with atomic Lua in Redis so N workers cannot race.

```
Redis key format:  rate:{platform}:{scope}:{id}
Stored as hash:    { tokens: float, last_refill_ts: int }

acquire(key, capacity, refill_per_ms, cost):
  LUA SCRIPT (atomic):
    1. h = HGETALL key  (or init { tokens: capacity, ts: now })
    2. elapsed_ms = now - h.last_refill_ts
    3. refilled = min(capacity, h.tokens + elapsed_ms * refill_per_ms)
    4. if refilled >= cost:
         tokens_after = refilled - cost
         HSET key tokens=tokens_after, last_refill_ts=now
         return { allowed: true, tokens_remaining: tokens_after }
       else:
         needed = cost - refilled
         reset_in_ms = ceil(needed / refill_per_ms)
         (no write)
         return { allowed: false, reset_in_ms }
    5. EXPIRE key to (capacity / refill_per_ms) * 2  (auto-cleanup)
```

**Why atomic Lua:** two workers calling `acquire` on the same account at the same millisecond must not both get `allowed=true` when only one token remains. Lua in Redis is single-threaded, so the read-modify-write cycle is safe.

**Why store `last_refill_ts` + `tokens` instead of a per-second counter:** decouples refill from wall-clock ticks. The bucket refills *during the acquire* based on elapsed ms. No background refill process needed.

---

## 4. YouTube daily quota — separate strategy

YouTube's model is fundamentally different: 10,000 units/day total, per-call cost varies (`channels.list` = 1, `search.list` = 100, `videos.list` = 1, `playlistItems.list` = 1, `reports.query` depends on dimensions). Budget is **shared across all accounts.**

```
Redis key:   quota:youtube:daily:{YYYY-MM-DD-UTC}
Stored as:   integer (units consumed so far)

acquire_youtube(cost):
  LUA (atomic):
    key = "quota:youtube:daily:" + today_utc()
    consumed = INCRBY key cost
    if consumed > 10000:
      DECRBY key cost           // rollback
      reset_in_ms = ms_until_utc_midnight()
      return { allowed: false, reset_in_ms }
    EXPIRE key (ttl_until_midnight + 3600)  // self-cleanup
    return { allowed: true, remaining: 10000 - consumed }
```

Separate key for YT Analytics (`quota:youtube:analytics:{YYYY-MM-DD-UTC}`). Scheduler applies **back-pressure** (see §6) when the counter crosses thresholds.

**Backfill optimization:** the YT adapter prefers `playlistItems.list` (cost=1) over `search.list` (cost=100) for listing a channel's videos. `search.list` is only used when we need server-side search/filter. A single well-written adapter can do thousands of video-listing operations per day within the 10k budget.

---

## 5. Headers — sanity check, not primary

Where platforms expose live usage headers, we parse them after every successful call:

| Platform | Header | What it tells us |
|---|---|---|
| Meta | `X-App-Usage: {"call_count":12,"total_cputime":8,"total_time":14}` | % of per-app hourly budget consumed |
| Meta | `X-Business-Use-Case-Usage` | per-BUC budgets (complex JSON per endpoint) |
| Meta | `X-Page-Usage` | per-page budget |
| Twitch | `Ratelimit-Remaining: 792` | points left in current 1-min window |
| Twitch | `Ratelimit-Reset: 1713817800` | epoch seconds when window resets |

Headers are **advisory**. We do not use them to decide whether to call — the token bucket does that. We use them to:
1. **Detect config drift** — if we think the bucket says 500 left but the header says 5, our refill rate is wrong. Alert, don't trust the header.
2. **Emit metric** `platform_api_usage_percent{platform,scope}` for dashboards.
3. **Early warning** — header-based alert at ≥80% usage, even if bucket hasn't fired back-pressure yet.

TikTok and YouTube don't expose live usage headers, so §4 (counter) and §6 (back-pressure) are the only signals for those.

---

## 6. Back-pressure — graceful degradation

When a bucket is close to exhaustion, we **don't wait for 429**. We reduce load proactively.

**Scheduler-level back-pressure** (applied every tick, ~30s):

```
For each (platform, scope, id) that the scheduler is about to enqueue jobs for:
  usage = RateBucketService.usageRatio(key)
  if usage >= 0.95:
    ⇒ enqueue ONLY priority=HIGH (on-demand refresh).
       Skip priority=NORMAL (periodic syncs) this tick.
  elif usage >= 0.80:
    ⇒ halve the batch size for this (platform, scope).
```

This gives on-demand refresh (which the user is actively watching) priority over bulk periodic syncs.

**YouTube daily quota back-pressure** (stricter):

```
consumed = GET quota:youtube:daily:today
if consumed >= 9500:  # 95% of 10k
  ⇒ pause all priority=NORMAL YT jobs until UTC 00:00
     (enqueue with delay = ms_until_midnight + 60s)
  ⇒ still accept priority=HIGH (manual refresh)
elif consumed >= 8000:  # 80%
  ⇒ stop all backfill jobs (priority=BACKFILL)
  ⇒ alert operators
```

Back-pressure thresholds are tunable per-platform in a YAML config, not hardcoded.

---

## 7. 429 handling — reactive fallback

If a 429 comes back despite our buckets (clock skew, platform-side change, multi-app shared budget we didn't model), the adapter:

1. Parses `Retry-After` header if present.
2. Returns a specific `RateLimitError` up the stack.
3. Worker:
   - **Penalizes the bucket** — sets `tokens = 0`, `last_refill_ts = now + retry_after_ms` to force alignment.
   - **Re-queues the job** with `delay = retry_after + jitter`.
   - **Emits metric** `platform_api_429_total{platform,scope}` (alert if rate > 0.1/min).
4. Backoff on consecutive 429s: if same `(account, product)` 429s 3 times in 10 min, mark the account `sync_degraded` and stop enqueueing for 1h. Ops receives alert.

**429 is treated as a bug.** We track them and root-cause; recurring 429s mean our bucket config is wrong.

---

## 8. What BullMQ's built-in rate limiter is for (and what it's NOT)

BullMQ has its own `limiter` option on queues. We use it **for concurrency control**, not platform rate limits.

| Concern | Who handles it |
|---|---|
| "Don't run more than K workers at once for this queue" | BullMQ `limiter` |
| "Don't exceed platform X's budget" | `RateBucketService` (this doc) |
| "Don't spam the same account with repeated syncs" | Redis throttle lock (separate, see `ingestion-modes.md`) |

All three coexist. The worker pipeline is:

```
BullMQ limiter allows worker to pick up job
  ↓
Redis throttle lock acquired for (account, product)?  else skip
  ↓
RateBucketService.acquire(platform buckets)?          else re-enqueue with delay
  ↓
adapter.fetch(...)
```

---

## 9. Observability

Metrics emitted per bucket:
- `rate_bucket_tokens{platform,scope,id}` — gauge, current tokens
- `rate_bucket_usage_ratio{platform,scope}` — gauge, (capacity - tokens) / capacity, aggregated across ids
- `rate_bucket_acquire_total{platform,scope,result="allowed|denied"}` — counter
- `rate_bucket_denied_wait_ms{platform,scope}` — histogram of rejection resetInMs
- `platform_api_429_total{platform,scope}` — counter
- `platform_api_usage_percent_from_headers{platform,scope}` — gauge, from header parsing

YouTube-specific:
- `youtube_quota_consumed{api="data|analytics"}` — gauge, current day's consumption
- `youtube_quota_remaining_ratio{api}` — gauge, `(10000 - consumed) / 10000`
- `youtube_quota_backpressure_active{threshold}` — gauge 0/1

Alerts:
- `rate_bucket_usage_ratio > 0.80` for 15min → PagerDuty warn
- `platform_api_429_total` rate > 0.1/min → PagerDuty critical
- `youtube_quota_remaining_ratio < 0.1` at any time → PagerDuty warn
- `youtube_quota_consumed > 10000` — should never fire if back-pressure works; if it does = bug

Dashboard (Grafana): one row per platform, showing bucket usage, 429 rate, effective refill rate vs declared.

---

## 10. Bucket config examples

### Instagram Graph API (Business)
```yaml
platform: ig
buckets:
  - scope: user_token
    keyTemplate: 'rate:ig:user_token:{access_token_hash}'
    capacity: 200
    refill_per_ms: 0.0555   # 200 per 3600000ms (1h)
    strategy: token-bucket
  - scope: app
    keyTemplate: 'rate:ig:app'
    capacity: 200          # scale by # active users
    refill_per_ms: 0.0555
    strategy: token-bucket
  - scope: page
    keyTemplate: 'rate:ig:page:{page_id}'
    capacity: 200
    refill_per_ms: 0.0555
    strategy: token-bucket
```

### YouTube Data API v3
```yaml
platform: yt
buckets:
  - scope: daily_quota
    keyTemplate: 'quota:youtube:daily:{YYYY-MM-DD-UTC}'
    capacity: 10000
    strategy: daily-counter
    backpressure_thresholds: [0.80, 0.95]
```

### Twitch Helix
```yaml
platform: twitch
buckets:
  - scope: app_token
    keyTemplate: 'rate:twitch:app'
    capacity: 800
    refill_per_ms: 13.333  # 800 per 60000ms
    strategy: token-bucket
  - scope: user_token
    keyTemplate: 'rate:twitch:user_token:{user_id}'
    capacity: 800
    refill_per_ms: 13.333
    strategy: token-bucket
```

### TikTok (Business)
```yaml
platform: tiktok
buckets:
  - scope: user_video_list
    keyTemplate: 'rate:tiktok:user_video_list:{user_id}'
    capacity: 100
    refill_per_ms: 0.0278  # 100 per 3600000ms
    strategy: token-bucket
  - scope: user_user_info
    keyTemplate: 'rate:tiktok:user_info:{user_id}'
    capacity: 600
    refill_per_ms: 0.1667  # 600 per 3600000ms
    strategy: token-bucket
```

---

## 11. Edge cases & remediation

| Scenario | What happens | Remediation |
|---|---|---|
| Redis unavailable | `acquire` returns error | Worker fails the job, BullMQ retries with backoff. Alerts fire. Buckets are ephemeral — no data loss. |
| Clock skew between workers | Two workers disagree on "now"; extra token leak | Redis is authoritative (`last_refill_ts` is Redis time via `TIME` command). Workers use `redis.TIME()`, not system clock. |
| Bucket capacity grows (more users) | Our hardcoded `capacity: 200` is too low for IG app-level | Recompute capacity from platform docs × # users. Weekly cron updates config. |
| Platform increases our quota | Bucket config stale | Update YAML, deploy. No migration. |
| Platform reduces our quota (punishment) | We get 429s in otherwise-healthy state | Reactive handling (§7) detects and penalizes bucket; ops adjusts config. |
| A single account syncs on 3 workers at once | Redis throttle lock (`ingestion-modes.md` §throttle) prevents this | Separate concern from rate-limit. |
| New GCP project for YouTube (to expand quota) | Multi-project routing needed | Adapter maintains pool of project-level tokens; bucket key includes `gcp_project_id`. Doc update required. |

---

## 12. ADRs

See [`adr/0008-token-bucket-rate-limits.md`](adr/0008-token-bucket-rate-limits.md) for the decision history and alternatives considered (celery-style global rate limiter, leaky bucket, platform-side webhooks only).

See [`adr/0009-rate-limit-strategy.md`](adr/0009-rate-limit-strategy.md) for the adapter-declared-buckets decision and why we rejected a single-algorithm fits-all approach.

---

## 13. Related docs

- [`ingestion-modes.md`](ingestion-modes.md) — the Redis throttle lock pattern (different concern from rate limits)
- [`refresh-cadence.md`](refresh-cadence.md) — cadences are sized to respect these budgets
- [`07-platforms/instagram.md`](07-platforms/instagram.md) — IG-specific rate-limit quirks
- [`07-platforms/youtube.md`](07-platforms/youtube.md) — YouTube quota deep dive
- [`08-operations/runbook.md`](08-operations/runbook.md) — how to raise a bucket, investigate 429s
