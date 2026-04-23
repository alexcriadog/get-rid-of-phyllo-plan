# Runbook

**Status:** Living
**Last updated:** 2026-04-23

Operational playbooks for common tasks and incidents. Each entry has a **symptom, diagnostic steps, and remediation.**

---

## Table of contents

1. [Alert: `connector_up == 0`](#alert-connector_up--0)
2. [Alert: `events_dlq_depth > 0`](#alert-events_dlq_depth--0)
3. [Alert: `platform_api_429_total` spike](#alert-platform_api_429_total-spike)
4. [Alert: `accounts_needs_reauth_total` spike](#alert-accounts_needs_reauth_total-spike)
5. [Alert: `youtube_quota_remaining_ratio < 0.1`](#alert-youtube_quota_remaining_ratio--01)
6. [Alert: `rate_bucket_usage_ratio > 0.80`](#alert-rate_bucket_usage_ratio--080)
7. [Alert: `webhook_silent_total` spike](#alert-webhook_silent_total-spike)
8. [Task: Tier a new client account](#task-tier-a-new-client-account)
9. [Task: Pause / unpause an account](#task-pause--unpause-an-account)
10. [Task: Re-enqueue a failed sync](#task-re-enqueue-a-failed-sync)
11. [Task: Rotate HMAC outbound secret](#task-rotate-hmac-outbound-secret)
12. [Task: Rotate platform app credentials](#task-rotate-platform-app-credentials)
13. [Task: Replay a DLQ event](#task-replay-a-dlq-event)
14. [Task: Resubscribe all platform webhooks](#task-resubscribe-all-platform-webhooks)
15. [Task: GDPR purge an account](#task-gdpr-purge-an-account)
16. [Task: Handle a merge freeze](#task-handle-a-merge-freeze)
17. [Task: Debug a failing account](#task-debug-a-failing-account)

---

## Alert: `connector_up == 0`

**Symptom:** a connector process (api/worker/scheduler) is down for 2+ min.

Steps:
1. SSH to connector EC2: `ssh ec2-user@connector-<env>.internal`.
2. `docker compose ps` — identify which service.
3. `docker compose logs --tail=200 <service>` — look for fatal error.
4. Common causes:
   - DB connection pool exhausted → scale RDS connections or restart service
   - Redis unreachable → check Redis cluster health
   - OOMKilled → check memory; bump instance size if recurring
5. `docker compose up -d <service>` to restart.

If DB/Redis is the root cause → escalate to infra channel.

---

## Alert: `events_dlq_depth > 0`

**Symptom:** outbound events failed 8 retries, landed in DLQ.

Steps:
1. Grafana → Outbound Events dashboard → DLQ panel → identify which subscription + event type.
2. Loki query: `{service="connector"} |= "delivery_failed" | json` → inspect error messages.
3. Common causes:
   - Subscriber (backend-api) endpoint down → check backend-api health
   - Bad HMAC rotation on subscriber side → see `rotate HMAC` task, confirm subscriber has current secrets
   - Schema change subscriber can't parse → validate event against subscriber's accepted version
4. Fix root cause, then replay via `POST /v1/admin/webhook-deliveries/:id/replay`.

---

## Alert: `platform_api_429_total` spike

**Symptom:** we're hitting platform rate limits despite our buckets.

Steps:
1. Grafana → Platform Health dashboard → identify which `(platform, scope)`.
2. Compare declared bucket capacity against `platform_api_usage_percent_from_headers` — if header shows 99% but bucket shows 20%, config is wrong.
3. Adjust `rateLimitHints()` in the adapter; deploy.
4. If genuinely exceeded platform limit: platform may have reduced our quota. Check platform developer console. Request quota increase (Google) or reach out to platform support (Meta/TikTok).

---

## Alert: `accounts_needs_reauth_total` spike

**Symptom:** many accounts moved to `needs_reauth` in short window.

Steps:
1. Check platform status page — is the platform reporting an incident?
2. Loki: `{service="connector"} |= "needs_reauth"` → check `reason` field.
3. If all same reason (`token_expired`, `scope_revoked`) → likely platform-side event (password change, policy change). Notify backend-api team so user-facing notifications fire.
4. If `refresh_failed` → check our refresh logic for that platform. Possible adapter bug.

---

## Alert: `youtube_quota_remaining_ratio < 0.1`

**Symptom:** <10% of daily YT quota left.

Steps:
1. Grafana → YouTube Quota dashboard → confirm consumption rate.
2. Back-pressure should already be active (suppressing BACKFILL and NORMAL jobs).
3. If on-demand HIGH jobs are still heavy: consider admin action to pause non-essential refreshes until UTC 00:00 reset.
4. If chronic: request quota expansion from Google Cloud Console (`IAM & Admin` → `Quotas`). Typically 1-2 week approval.
5. Longer-term (>5k YT accounts): plan for multi-GCP-project routing.

---

## Alert: `rate_bucket_usage_ratio > 0.80`

**Symptom:** rate bucket sustained above 80%.

Steps:
1. Not always actionable — back-pressure handles it. If sustained for hours and we're hitting 429s, raise bucket capacity (if platform allows) or slow cadences for that product.
2. Validate bucket config matches platform docs (platforms occasionally change published limits).

---

## Alert: `webhook_silent_total` spike

**Symptom:** expected webhook from platform hasn't arrived in 2× cadence window.

Steps:
1. Check platform status page — webhooks may be delayed globally.
2. Loki query incoming webhook volume for that platform over last 24h.
3. Trigger manual resubscribe:
   ```
   connector-cli webhooks resubscribe --platform=<p> [--account=<id>]
   ```
4. Polling is already covering — no data loss, just no fast detection. Resubscribe restores fast-path.

---

## Task: Tier a new client account

A client has VIP accounts that need 2× more frequent syncs.

```
curl -X PATCH https://connector-prod.internal/v1/admin/accounts/<id>/sync-tier \
  -H 'Authorization: Service-Token <token>' \
  -H 'Content-Type: application/json' \
  -d '{"tier": "vip", "reason": "Client X onboarding 2026-05-01"}'
```

Verify: `GET /v1/admin/accounts/<id>/cadence` shows new effective intervals.

---

## Task: Pause / unpause an account

```
curl -X PATCH https://connector-prod.internal/v1/admin/accounts/<id>/sync-tier \
  -H 'Authorization: Service-Token <token>' \
  -d '{"tier": "paused", "reason": "Client dispute pending"}'
```

Account stays connected. No syncs scheduled. Webhooks are received and logged but don't trigger fetches. Unpause by setting tier back to `standard` (or whatever was previous). Event `account.tier_changed` fires in both directions.

---

## Task: Re-enqueue a failed sync

```
curl -X POST https://connector-prod.internal/v1/admin/sync-jobs/<id>/reenqueue \
  -H 'Authorization: Service-Token <token>'
```

Job goes back in queue at HIGH priority. Next worker picks it up.

To re-enqueue all failed jobs for one account:
```
connector-cli sync re-enqueue-failed --account-id=<id>
```

---

## Task: Rotate HMAC outbound secret

Zero-downtime rotation.

1. Add new secret to the rotation set in Secrets Manager:
   ```
   aws secretsmanager update-secret --secret-id /connector/prod/outbound-hmac-secrets \
     --secret-string '{"active": "<new>", "previous": "<current-active>"}'
   ```
2. Reload connector config: `connector-cli secrets reload`. Connector now signs with `active` + accepts both `active` and `previous` on verification (inbound events we'd receive).
3. Notify subscribers (backend-api) to add the new secret as an accepted one.
4. After subscribers confirm they accept the new secret (check their inbound signature validation metrics), mark the old one for removal:
   ```
   aws secretsmanager update-secret --secret-id /connector/prod/outbound-hmac-secrets \
     --secret-string '{"active": "<new>", "previous": null}'
   ```
5. `connector-cli secrets reload` again.

Audit log entry auto-created on each rotation step.

---

## Task: Rotate platform app credentials

Need to rotate Meta App Secret, TikTok client secret, etc.

1. Generate new credential on platform's developer console.
2. Update Secrets Manager:
   ```
   aws secretsmanager update-secret --secret-id /connector/prod/platform-apps/meta \
     --secret-string '{"client_id": "<same>", "client_secret": "<new>"}'
   ```
3. `connector-cli secrets reload`.
4. Revoke old secret on platform console.

No downtime: connector loads fresh secret on next OAuth exchange or API call. Existing tokens already issued remain valid.

---

## Task: Replay a DLQ event

```
connector-cli events list-dlq --subscription=backend-api --since=1h
```
Identify event, then:
```
curl -X POST https://connector-prod.internal/v1/admin/webhook-deliveries/<delivery-id>/replay \
  -H 'Authorization: Service-Token <token>'
```
Delivery attempts reset; event re-posted to subscriber.

---

## Task: Resubscribe all platform webhooks

After a major platform change or subscription mass-revoke.

```
connector-cli webhooks resubscribe --platform=meta      # IG + FB
connector-cli webhooks resubscribe --platform=youtube   # PubSubHubbub
connector-cli webhooks resubscribe --platform=twitch    # EventSub
```

Takes a few minutes at 50k accounts. Rate-limited per platform.

---

## Task: GDPR purge an account

```
curl -X DELETE "https://connector-prod.internal/v1/accounts/<id>?organization_id=<org>&gdpr=true" \
  -H 'Authorization: Service-Token <token>'
```

Deletes:
- `accounts`, `account_organizations` rows
- `oauth_tokens` (all versions, including history)
- `sync_jobs`, `account_cadences`
- `posts`, `audience_snapshots`, `identity_snapshots`
- `raw_platform_responses` MySQL rows + S3 objects
- `webhook_deliveries` for this account
- `inbound_webhook_log` rows where account_id matches
- Associated logs from Loki via purge API

Audit entry retained (NOT purged) — required for compliance.

SLA: complete within 24h.

---

## Task: Handle a merge freeze

If ops declares a merge freeze (e.g., mobile release cut):
- No connector deploys during freeze window
- Hot-fixes only by explicit on-call approval
- Re-open window communicated in #connector-alerts

---

## Task: Debug a failing account

1. Start: `GET /v1/accounts/<id>` → shows status, tier, token expiry, sync health per product.
2. Loki: `{service="connector", account_id="<id>"} | json` over last 24h.
3. Recent deliveries: `GET /v1/admin/webhook-subscriptions/backend-api/deliveries?account_id=<id>&limit=20`.
4. If a specific endpoint is failing: `POST /v1/admin/dev/webhook-test` to replay a synthetic payload into the handler.

If user reports missing data:
- Check `platform_field_support` matrix — field may not be supported by platform.
- Check `sync_jobs.last_success_at` — is sync running?
- Manual refresh `POST /v1/accounts/<id>/refresh` to force fetch.

---

## Related docs

- [`deployment.md`](deployment.md) — rollback procedure
- [`observability.md`](observability.md) — alert definitions
- [`security.md`](security.md) — detail on secret rotation
- [`../ingestion-modes.md`](../ingestion-modes.md) — webhook resubscribe mechanics
