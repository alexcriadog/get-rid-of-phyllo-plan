# 04 · Data Model

**Status:** Living — updated as Prisma schema evolves
**Last updated:** 2026-04-23

The connector's state lives in a new database `connector` on the existing RDS MySQL instance. Prisma-managed. Separate user, separate credentials. This doc is the **reference for every table** in that database, what it stores, and why.

The authoritative source at implementation time is `prisma/schema.prisma` in the connector repo. Keep this doc synchronized.

---

## Storage principle (D-14)

Two-tier:

- **Connector MySQL** = source of truth for **platform-normalized data** (what the platform's API returned).
- **Backend-api MongoDB** = source of truth for **business-enriched data** (brand, virality, paid-post, S3 media, org context).

The connector never writes to MongoDB. Backend-api enriches and persists based on connector events + API reads.

Raw platform responses (large JSON blobs, 30-90d retention) go to **S3**, not MySQL.

---

## Tables

All tables in the `connector` database. IDs are `BIGINT AUTO_INCREMENT` unless noted. All tables have `created_at`, `updated_at` timestamps.

### Account lifecycle

#### `accounts`
The primary entity — one row per connected creator account on one platform.

```
id                    BIGINT PK
platform              ENUM('instagram','facebook','youtube','twitch','tiktok') NOT NULL
canonical_user_id     VARCHAR(128) NOT NULL    -- platform's canonical ID (FB Page ID, IG Business ID, YT channel ID, …)
handle                VARCHAR(128)             -- @handle or platform equivalent
display_name          VARCHAR(255)
status                ENUM('pending','ready','needs_reauth','disconnected','pending_resolution_failed') NOT NULL
sync_tier             ENUM('vip','standard','lite','demo','paused') NOT NULL DEFAULT 'standard'
owning_organization_id VARCHAR(64) NOT NULL    -- org that initiated OAuth (from backend-api)
connected_at          TIMESTAMP
disconnected_at       TIMESTAMP NULL
created_at            TIMESTAMP
updated_at            TIMESTAMP

UNIQUE (platform, canonical_user_id)
INDEX (status)
INDEX (sync_tier)
INDEX (owning_organization_id)
```

#### `account_organizations`
N:N — which organizations have visibility into an account (multi-org sharing, F-20..F-24).

```
account_id         BIGINT FK accounts.id
organization_id    VARCHAR(64) NOT NULL
role               ENUM('owning','visible') NOT NULL
added_at           TIMESTAMP

PRIMARY KEY (account_id, organization_id)
INDEX (organization_id)
```

#### `oauth_tokens`
Envelope-encrypted tokens (D-07). One active row per account.

```
id                       BIGINT PK
account_id               BIGINT FK accounts.id
access_token_ciphertext  BLOB NOT NULL    -- encrypted with kms_data_key
refresh_token_ciphertext BLOB
kms_data_key_ciphertext  BLOB NOT NULL    -- data key encrypted by KMS
scopes                   JSON NOT NULL    -- array of scope strings
expires_at               TIMESTAMP
last_refreshed_at        TIMESTAMP
created_at               TIMESTAMP

UNIQUE (account_id)
INDEX (expires_at)    -- for expiry cron
```

Historical rows kept in `oauth_tokens_history` (same shape + `revoked_at`) for audit. Never plaintext anywhere.

#### `pending_connections`
Mid-handshake state (F-10). TTL-based cleanup.

```
id                BIGINT PK
platform          ENUM(...) NOT NULL
user_id           VARCHAR(64)          -- backend-api's user id
organization_id   VARCHAR(64)
state_nonce       VARCHAR(128) UNIQUE  -- OAuth state parameter
return_url        VARCHAR(512)
expires_at        TIMESTAMP NOT NULL
created_at        TIMESTAMP

INDEX (expires_at)   -- for cleanup cron
INDEX (state_nonce)
```

Short retention: expired rows purged nightly. State nonce also lives in Redis with matching TTL for fast validation.

#### `platform_apps`
References to platform app credentials in Secrets Manager (no secrets in DB).

```
id              BIGINT PK
platform        ENUM(...) NOT NULL
env             VARCHAR(16) NOT NULL     -- dev, staging, prod
secret_arn      VARCHAR(512) NOT NULL    -- Secrets Manager ARN
app_label       VARCHAR(64)              -- human-readable app name
enabled         BOOLEAN NOT NULL DEFAULT TRUE
created_at      TIMESTAMP

UNIQUE (platform, env, app_label)
```

---

### Sync orchestration

#### `sync_jobs`
One row per `(account, product)` pair we ever schedule.

```
id                  BIGINT PK
account_id          BIGINT FK accounts.id
product             ENUM('identity','audience','engagement_new','engagement_metrics_recent','engagement_metrics_old','stories','live_status') NOT NULL
status              ENUM('idle','queued','running','failed') NOT NULL DEFAULT 'idle'
priority            ENUM('BACKFILL','NORMAL','HIGH') NOT NULL DEFAULT 'NORMAL'
next_run_at         TIMESTAMP NULL   -- NULL if account paused
last_success_at    TIMESTAMP
last_attempt_at    TIMESTAMP
last_error          TEXT
failure_count       INT NOT NULL DEFAULT 0
created_at          TIMESTAMP
updated_at          TIMESTAMP

UNIQUE (account_id, product)
INDEX (status, next_run_at)   -- scheduler hot path
INDEX (account_id)
```

**Scheduler query:**
```
SELECT id, account_id, product, priority
FROM sync_jobs
WHERE next_run_at <= NOW()
  AND status IN ('idle')
ORDER BY priority DESC, next_run_at ASC
LIMIT 500
```

The `(status, next_run_at)` index keeps this O(log n) at 50k accounts × ~7 products.

#### `cadences`
Platform defaults (one row per `(platform, product)`).

```
platform                     ENUM(...)
product                      ENUM(...)
default_interval_seconds     INT NOT NULL
updated_at                   TIMESTAMP
updated_by                   VARCHAR(64)

PRIMARY KEY (platform, product)
```

#### `account_cadences`
Per-(account, product) overrides.

```
account_id                  BIGINT FK accounts.id
product                     ENUM(...)
override_interval_seconds   INT NOT NULL
reason                      VARCHAR(255)
created_at                  TIMESTAMP
created_by                  VARCHAR(64)
expires_at                  TIMESTAMP NULL

PRIMARY KEY (account_id, product)
INDEX (expires_at)
```

---

### Platform-normalized data (the "posts layer" of D-14)

#### `posts`
Normalized content record — the **connector's view** of platform content. Backend-api enriches and mirrors into its MongoDB `posts` collection.

```
id                     BIGINT PK
account_id             BIGINT FK accounts.id
platform_content_id    VARCHAR(128) NOT NULL
content_type           ENUM('post','reel','story','carousel','video','short','stream','clip','vod','tweet') NOT NULL
caption                TEXT
permalink              VARCHAR(1024)
media_urls             JSON           -- [{url, type, width, height, duration_s}, …] — transient, re-fetched on expiry
metrics                JSON           -- {likes, comments, views, shares, saves, impressions, reach, watch_time_s}
published_at           TIMESTAMP
fetched_at             TIMESTAMP NOT NULL
last_updated_at        TIMESTAMP NOT NULL
raw_response_id        BIGINT FK raw_platform_responses.id NULL
created_at             TIMESTAMP

UNIQUE (platform_content_id, account_id)   -- dedupe
INDEX (account_id, published_at DESC)      -- timeline queries
INDEX (last_updated_at)                    -- "which posts need metrics refresh"
INDEX (content_type)
```

Upserts use `INSERT … ON DUPLICATE KEY UPDATE` on the unique key.

**Note on metrics JSON:** indexing inside MySQL JSON is possible via virtual columns if specific metric queries become common. Add only if observability shows need.

#### `audience_snapshots`
Current audience state per account. One row per account (replace on refresh).

```
account_id          BIGINT FK accounts.id
gender_distribution JSON      -- {male: pct, female: pct, other: pct, unknown: pct}
age_distribution    JSON      -- {"13-17": pct, "18-24": pct, …}
country_distribution JSON     -- {"US": pct, "MX": pct, …}
city_distribution   JSON      -- {"New York, US": pct, …}   raw city names; backend-api resolves to country codes
interests           JSON      -- [{name, affinity_score}]; nullable where platform doesn't expose
fetched_at          TIMESTAMP NOT NULL
raw_response_id     BIGINT FK raw_platform_responses.id NULL

PRIMARY KEY (account_id)
```

Historical audience snapshots remain in backend-api's MongoDB `accounts_audience_demographics_history` (written from events). Not duplicated here.

#### `identity_snapshots`
Current profile state per account. One row per account.

```
account_id         BIGINT FK accounts.id
handle             VARCHAR(128)
display_name       VARCHAR(255)
biography          TEXT
avatar_url         VARCHAR(1024)
profile_url        VARCHAR(1024)
followers_count    BIGINT
following_count    BIGINT
posts_count        BIGINT
verified           BOOLEAN
account_type       VARCHAR(32)           -- business/creator/personal — platform-specific values
fetched_at         TIMESTAMP NOT NULL
raw_response_id    BIGINT FK raw_platform_responses.id NULL

PRIMARY KEY (account_id)
```

#### `raw_platform_responses`
Pointers to raw blobs in S3. Retention 30-90d via S3 lifecycle policy.

```
id             BIGINT PK
account_id     BIGINT FK accounts.id
platform       ENUM(...) NOT NULL
endpoint       VARCHAR(128) NOT NULL   -- which platform endpoint, e.g. 'GET /instagram/me/media'
s3_uri         VARCHAR(512) NOT NULL   -- s3://<bucket>/connector/<env>/raw-responses/…
content_hash   CHAR(64) NOT NULL       -- sha256 of body, for dedupe + integrity
size_bytes     INT
fetched_at     TIMESTAMP NOT NULL
expires_at     TIMESTAMP NOT NULL      -- when S3 lifecycle will delete

INDEX (account_id, fetched_at)
INDEX (expires_at)
```

---

### Event system (outbound)

#### `webhook_subscriptions`
Consumers of outbound events (fan-out-ready).

```
id                 BIGINT PK
name               VARCHAR(64) UNIQUE     -- 'backend-api', future: 'partner-x'
url                VARCHAR(512) NOT NULL
secret_arn         VARCHAR(512) NOT NULL  -- Secrets Manager ARN for the HMAC secret set
event_types        JSON                   -- nullable = all; else subscription filter
enabled            BOOLEAN NOT NULL DEFAULT TRUE
created_at         TIMESTAMP
```

#### `webhook_deliveries`
Outbound delivery ledger + dedup.

```
id                    BIGINT PK
event_id              CHAR(26) NOT NULL   -- ULID generated at emission
subscription_id       BIGINT FK webhook_subscriptions.id
event_type            VARCHAR(64) NOT NULL
payload               JSON NOT NULL
status                ENUM('pending','delivered','failed','dlq') NOT NULL
attempts              INT NOT NULL DEFAULT 0
next_retry_at         TIMESTAMP
first_attempt_at      TIMESTAMP
last_attempt_at       TIMESTAMP
delivered_at          TIMESTAMP
last_error            TEXT
created_at            TIMESTAMP

UNIQUE (event_id, subscription_id)
INDEX (status, next_retry_at)    -- delivery worker hot path
INDEX (event_type)
```

#### `inbound_webhook_log`
Audit + idempotency for webhooks **we receive** from platforms.

```
id                 BIGINT PK
platform           ENUM(...) NOT NULL
event_id           VARCHAR(128) NOT NULL  -- derived per §ingestion-modes.md §10
received_at        TIMESTAMP NOT NULL
signature_valid    BOOLEAN NOT NULL
account_resolved   BOOLEAN NOT NULL
payload_snippet    TEXT                   -- trimmed to 2KB for forensics
processed          BOOLEAN NOT NULL DEFAULT FALSE
processing_error   TEXT

UNIQUE (platform, event_id)  -- dedup
INDEX (received_at)
INDEX (signature_valid)
```

---

### Support / ops

#### `audit_log`
Append-only log of admin-significant events.

```
id                 BIGINT PK
actor              VARCHAR(64) NOT NULL   -- 'service:backend-api', 'operator:<user>', 'system'
action             VARCHAR(64) NOT NULL   -- 'set_sync_tier', 'rotate_secret', 'force_disconnect', …
target_type        VARCHAR(32)            -- 'account', 'webhook_subscription', …
target_id          VARCHAR(64)
details            JSON
ip_address         VARCHAR(45)            -- if available
created_at         TIMESTAMP

INDEX (actor, created_at)
INDEX (target_type, target_id, created_at)
INDEX (action)
```

Retention: permanent (for compliance).

#### `platform_field_support`
Declarative matrix of what fields each adapter actually populates. Persisted from `PlatformAdapter.supportMatrix()`.

```
platform        ENUM(...)
product         ENUM(...)
field_name      VARCHAR(64)
status          ENUM('supported','empty_possible','not_supported') NOT NULL
note            VARCHAR(255)

PRIMARY KEY (platform, product, field_name)
```

Updated on adapter deploy (migration or seed). Queried by backend-api to render "data unavailable" vs "not supported by this platform".

---

## Indexes — design notes

- **Scheduler hot path** (`sync_jobs` WHERE `next_run_at <= NOW()`) has a covering index on `(status, next_run_at)`. Hot-path SELECT returns only IDs we care about. Confirmed O(log n) at 50k × 7.
- **Posts timeline queries** use `(account_id, published_at DESC)` — supports "latest N posts for this account" pattern.
- **Audit log** has three separate indexes because ops queries by actor, by target, and by action category. Cheap; audit is append-only.
- **Webhook deliveries** hot path is `(status, next_retry_at)` for the delivery worker scan. Same pattern as `sync_jobs`.

---

## Retention

| Table | Retention | Mechanism |
|---|---|---|
| `accounts` | Lifetime of connection + grace period (NF-71) | Manual purge on GDPR; hard-delete via `DELETE /v1/accounts/:id?purge=true` |
| `oauth_tokens` | Latest per account; history retained 90 days | Cron deletes history rows > 90d |
| `pending_connections` | 10 minutes | Nightly cron deletes `expires_at < NOW() - 1d` |
| `sync_jobs` | Lifetime of account | Purged with account |
| `posts` / `audience_snapshots` / `identity_snapshots` | Lifetime of connection | Purged with account |
| `raw_platform_responses` | 30-90d (configurable per env) | S3 lifecycle policy + MySQL row FK SET NULL when S3 deletes |
| `webhook_deliveries` | Delivered: 30d; DLQ: 180d | Nightly cron |
| `inbound_webhook_log` | 30d | Nightly cron |
| `audit_log` | Permanent | — |
| `platform_field_support` | Lives with code | Migration-managed |

GDPR purge (`DELETE /v1/accounts/:id?gdpr=true`) cascades across all account-scoped tables and raw S3 objects. Audit entry written for the purge itself.

---

## Migration strategy

- **Prisma migrations** per repo convention. Migration files checked in, CI applies on deploy.
- **Initial migration** creates all tables from the schema in this doc.
- **Additive changes** (new columns, new tables) in a standalone migration per PR.
- **Breaking changes** (rename columns, change types) use expand-migrate-contract: add new → dual-write in code → backfill → switch reads → remove old.
- **Seed data** (`cadences`, `platform_field_support`, initial `platform_apps`) via Prisma seed scripts, idempotent.
- No cross-DB JOIN or FK between `connector` and the other three backend-api DBs. Isolation is strict.

---

## Backup & restore

- RDS automated backups (existing): daily snapshot, 7d retention, PITR 5 minutes.
- For `oauth_tokens`: snapshot + KMS key both needed to restore. KMS key not rotated on backup cadence; rotated on security events only.
- Restore drill: quarterly on a dev RDS clone.

---

## Related docs

- [`02-architecture.md`](02-architecture.md) — where this DB fits
- [`06-event-catalog.md`](06-event-catalog.md) — events emitted from writes to these tables
- [`08-operations/security.md`](08-operations/security.md) — KMS envelope, Secrets Manager paths
- [`08-operations/deployment.md`](08-operations/deployment.md) — Prisma migration application
- [`adr/0006-connector-db-on-shared-rds.md`](adr/0006-connector-db-on-shared-rds.md)
- [`adr/0007-kms-envelope-tokens.md`](adr/0007-kms-envelope-tokens.md)
