# Observability

**Status:** Living
**Last updated:** 2026-04-23

Integrates with the existing observability stack: `agent-prometheus` scrapes metrics, `agent-promtail` tails logs, Grafana renders dashboards. No parallel monitoring system. This doc lists **metrics, log structure, dashboards, and alerts.**

---

## Stack

```
   connector-api/worker/scheduler containers
            │
            ├── /metrics (port 9090) ────► agent-prometheus ────► Prometheus ────► Grafana
            │
            └── stdout (structured JSON) ──► agent-promtail ────► Loki ────► Grafana
```

- Prometheus scrape interval: 15s
- Log retention: Loki, 30 days hot / 90 days cold

---

## Metrics — full catalog

All metrics are prefixed `connector_`. Labels are low-cardinality unless noted.

### Service vitals

- `connector_build_info{version,commit,branch}` — info gauge (always 1)
- `connector_up{process="api|worker|scheduler"}` — gauge, 1 if healthy
- `connector_uptime_seconds{process}` — counter
- `connector_http_requests_total{method,route,status}` — counter
- `connector_http_request_duration_seconds{method,route}` — histogram

### Sync orchestration

- `connector_sync_jobs_enqueued_total{platform,product,priority,source="scheduler|webhook|manual"}` — counter
- `connector_sync_jobs_completed_total{platform,product,result="success|failed|dlq"}` — counter
- `connector_sync_jobs_duration_seconds{platform,product}` — histogram
- `connector_sync_jobs_in_flight{platform,product}` — gauge
- `connector_sync_queue_depth{queue="sync|events|delivery",priority}` — gauge
- `connector_sync_queue_age_seconds{queue}` — gauge, age of oldest item
- `connector_sync_lag_seconds{platform,product}` — histogram, `NOW() - next_run_at` at enqueue
- `connector_scheduler_tick_duration_seconds` — histogram
- `connector_scheduler_batch_size` — gauge

### Rate limiting (from [`../rate-limiting.md`](../rate-limiting.md))

- `connector_rate_bucket_tokens{platform,scope,id_hash}` — gauge — **HIGH cardinality**, aggregate before alerting
- `connector_rate_bucket_usage_ratio{platform,scope}` — gauge
- `connector_rate_bucket_acquire_total{platform,scope,result="allowed|denied"}` — counter
- `connector_rate_bucket_denied_wait_ms{platform,scope}` — histogram
- `connector_platform_api_429_total{platform,scope}` — counter
- `connector_platform_api_usage_percent_from_headers{platform,scope}` — gauge
- `connector_youtube_quota_consumed{api="data|analytics"}` — gauge
- `connector_youtube_quota_remaining_ratio{api}` — gauge
- `connector_youtube_quota_backpressure_active{threshold}` — gauge 0/1

### Platform API calls

- `connector_platform_api_calls_total{platform,endpoint,status_class="2xx|4xx|5xx"}` — counter
- `connector_platform_api_duration_seconds{platform,endpoint}` — histogram
- `connector_platform_api_error_total{platform,error_class}` — counter

### Cadence & tiers (from [`../refresh-cadence.md`](../refresh-cadence.md))

- `connector_sync_tier_count{tier}` — gauge, accounts per tier
- `connector_cadence_override_active{product}` — gauge
- `connector_cadence_fallback_used_total{platform,product}` — counter (should be 0)
- `connector_cadence_change_rescheduled_total{kind}` — counter

### Ingestion (from [`../ingestion-modes.md`](../ingestion-modes.md))

- `connector_inbound_webhook_total{platform,result="accepted|signature_invalid|unknown_account"}` — counter
- `connector_inbound_webhook_duration_seconds{platform}` — histogram
- `connector_webhook_silent_total{platform,product}` — counter — heartbeat fallback detection
- `connector_throttle_lock_hits_total{action="acquired|skipped"}` — counter

### Outbound events

- `connector_events_emitted_total{event_type,subscription}` — counter
- `connector_events_delivered_total{subscription,status_class}` — counter
- `connector_events_delivery_attempts{subscription}` — histogram
- `connector_events_delivery_latency_seconds{subscription}` — histogram, emit-to-ack
- `connector_events_dlq_depth{subscription}` — gauge
- `connector_events_signature_rotation_status{slot="active|next|old"}` — info gauge

### Account health

- `connector_accounts_total{platform,status}` — gauge
- `connector_accounts_needs_reauth_total{platform}` — gauge
- `connector_accounts_connected_today{platform}` — counter
- `connector_accounts_disconnected_today{platform,reason}` — counter
- `connector_token_expiring_soon{platform,days_until="14|7|3|1"}` — gauge

### Freshness SLOs (from requirements NF-30)

- `connector_freshness_seconds{platform,product}` — histogram, platform update → our fetch
- `connector_freshness_slo_breach_total{platform,product}` — counter when p95 exceeds target

### Database / Redis

- `connector_db_query_duration_seconds{query_label}` — histogram (Prisma-instrumented)
- `connector_db_pool_connections{state="idle|active|waiting"}` — gauge
- `connector_redis_command_duration_seconds{command_class}` — histogram

---

## Log structure (JSON, stdout)

All logs are JSON, one line per entry. Fields:

```json
{
  "timestamp": "2026-04-23T15:32:10.123Z",
  "level": "info",
  "logger": "worker.sync",
  "message": "sync job completed",
  "correlation_id": "cor_01HXYZ...",
  "request_id": "req_01HXYZ...",
  "job_id": "j_01HXYZ...",
  "account_id": "acc_01HXYZ...",
  "platform": "instagram",
  "product": "engagement_new",
  "duration_ms": 1234,
  "result": "success",
  "environment": "prod",
  "service": "connector",
  "process": "worker",
  "version": "<SHA>"
}
```

**No secrets, no tokens, no PII** ever in logs. Specifically: access tokens, refresh tokens, state nonces, HMAC secrets are REDACTED at the serializer layer. Violations caught by pre-commit lint + runtime test.

**Correlation ID** (`correlation_id`) flows through OAuth callback → worker job → event emission → webhook delivery. Lets ops follow a single request end-to-end across Loki.

---

## Dashboards (Grafana)

To be built in sprint 4. Minimum panels per dashboard.

### 1. Service Overview
- Up/down indicator per process
- HTTP request rate + error rate + p50/p95/p99 latency
- Worker queue depth + age
- Recent deploys (from `connector_build_info`)

### 2. Platform Health (per platform: IG/FB/YT/Twitch/TikTok)
- Rate bucket utilization (ratio gauges)
- Platform API 2xx/4xx/5xx rate
- 429 rate
- Freshness SLO p95 per product
- needs_reauth account count trend

### 3. Sync Throughput
- Jobs enqueued vs completed (should track)
- Duration p50/p95 per (platform, product)
- DLQ depth per queue
- Scheduler tick duration

### 4. YouTube Quota (dedicated)
- Current daily consumption (Data + Analytics)
- Time-until-reset countdown
- Back-pressure state
- Per-call cost distribution (bar chart)

### 5. Ingestion
- Inbound webhook rate per platform
- Signature-invalid rate (should be 0)
- Webhook silence detector (per account × product)
- Throttle-lock hit rate

### 6. Outbound Events
- Event emission rate per type
- Delivery latency p95
- DLQ depth trend
- HMAC rotation status

### 7. Account Lifecycle
- Connected/disconnected today
- needs_reauth trend
- Token expiring soon breakdown (14/7/3/1d)
- Tier distribution

---

## Alerts — PagerDuty + Slack

| Severity | Condition | Action |
|---|---|---|
| P1 page | `connector_up == 0` for 2min (any process) | PagerDuty |
| P1 page | `connector_events_dlq_depth > 0` for 5min | PagerDuty |
| P1 page | `connector_platform_api_429_total` rate > 0.1/min | PagerDuty |
| P1 page | `connector_accounts_needs_reauth_total` spike (>10% of cohort in 1h) | PagerDuty |
| P1 page | `connector_youtube_quota_remaining_ratio < 0.1` at any time | PagerDuty |
| P2 Slack | `connector_rate_bucket_usage_ratio > 0.80` for 15min | Slack #connector-alerts |
| P2 Slack | `connector_sync_lag_seconds p95 > effective_cadence(platform, product)` for 30min | Slack |
| P2 Slack | `connector_freshness_slo_breach_total` rate > 0 for 1h | Slack |
| P2 Slack | `connector_cadence_fallback_used_total > 0` | Slack (bug: missing `cadences` row) |
| P3 Log  | `connector_webhook_silent_total` > 0 for 7d on any (account, product) | Log + email |
| P3 Log  | Platform 5xx rate > 5% for 10min | Log + email |

Alert rule files checked into `infra/grafana/alerts/` in connector repo.

---

## Related docs

- [`../rate-limiting.md`](../rate-limiting.md) — metrics it emits
- [`../ingestion-modes.md`](../ingestion-modes.md) — inbound webhook metrics
- [`../refresh-cadence.md`](../refresh-cadence.md) — cadence metrics
- [`../06-event-catalog.md`](../06-event-catalog.md) — event SLOs
- [`runbook.md`](runbook.md) — how to respond to each alert
- [`security.md`](security.md) — audit logs (separate from ops logs)
