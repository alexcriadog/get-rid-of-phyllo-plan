# Deployment

**Status:** Living
**Last updated:** 2026-04-23

How the connector is built, shipped, and run in each environment. Matches the existing backend-api deployment pattern (GitHub Actions → ECR → EC2 with Docker Compose) to minimize new ops surface.

---

## Infrastructure per environment

```
connector-{env}.internal         — private DNS, ALB target
EC2 instance: t3.small (launch) → t3.medium (yr 1) → t3.large (yr 2)
OS: Amazon Linux 2023, Docker Engine, docker-compose plugin
IAM role: connector-{env}-role with:
  • Secrets Manager read on /connector/{env}/*
  • KMS decrypt on alias/connector-{env}-token
  • S3 read/write on s3://<bucket>/connector/{env}/*
  • CloudWatch Logs write
  • SSM agent (for CI-driven deploys)
Security group:
  • In: 443 from private subnet (API traffic from backend-api)
  • In: 443 from nginx-proxy EC2 (OAuth callbacks + inbound platform webhooks)
  • Out: 443 to platform APIs
  • Out: 3306 to RDS
  • Out: 6379 to Redis
Nginx on main-stack EC2 (existing):
  /oauth/callback/:platform        → proxy_pass connector-{env}.internal
  /webhooks/ingest/:platform        → proxy_pass connector-{env}.internal
RDS MySQL (existing instance) — new DB `connector`, separate user
Redis (existing cluster) — shared key namespace, no isolation needed
S3 bucket (existing or new) — connector/{env}/raw-responses/ with lifecycle policy
```

---

## Docker image

Multi-stage `Dockerfile`:

```dockerfile
# Stage 1: build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --only=production
COPY . .
RUN npx prisma generate && npm run build

# Stage 2: runtime
FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
ENV NODE_ENV=production
# entrypoint: argv[2] decides process type
ENTRYPOINT ["node", "dist/main.js"]
CMD ["api"]
```

**Single image, three commands:**
- `node dist/main.js api` — HTTP server
- `node dist/main.js worker` — BullMQ consumer
- `node dist/main.js scheduler` — scheduler loop

Image tagged by commit SHA; pushed to ECR repo `social-connector`.

---

## docker-compose.{env}.yml

```yaml
services:
  connector-api:
    image: <ECR_URI>:<tag>
    command: ["api"]
    env_file: /opt/connector/.env
    ports: ["3000:3000"]
    deploy:
      replicas: 2
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:3000/healthz"]
      interval: 30s
      start_period: 20s

  connector-worker:
    image: <ECR_URI>:<tag>
    command: ["worker"]
    env_file: /opt/connector/.env
    deploy:
      replicas: 3          # scales up with load
    restart: unless-stopped

  connector-scheduler:
    image: <ECR_URI>:<tag>
    command: ["scheduler"]
    env_file: /opt/connector/.env
    deploy:
      replicas: 1          # single instance at launch; HA later via leader lock
    restart: unless-stopped
```

Same image for all three services. Different `command` selects the process.

---

## Environment variables

Non-secret env lives in `/opt/connector/.env` (managed by SSM Parameter Store or CI templating). Secrets fetched at runtime via Secrets Manager (KMS-encrypted).

```
# Required
NODE_ENV=production
CONNECTOR_ENV=prod                                 # dev | staging | prod
CONNECTOR_VERSION=<SHA>                            # for /healthz

# Database
DATABASE_URL=mysql://connector_user:<from-secrets>@<rds-host>:3306/connector

# Redis
REDIS_URL=redis://<redis-host>:6379/<db-index>

# AWS
AWS_REGION=eu-west-1
KMS_KEY_ALIAS=alias/connector-prod-token
SECRETS_MANAGER_PREFIX=/connector/prod

# Outbound webhook signing (HMAC multi-secret rotation)
OUTBOUND_HMAC_SECRETS_ARN=/connector/prod/outbound-hmac-secrets

# Observability
PROMETHEUS_PORT=9090                               # /metrics scrape
LOG_LEVEL=info

# Operational
SCHEDULER_TICK_INTERVAL_MS=30000
SCHEDULER_BATCH_SIZE=500
BULLMQ_WORKER_CONCURRENCY=8
```

See [`security.md`](security.md) for the full Secrets Manager layout.

---

## CI/CD

Matches backend-api pattern. `.github/workflows/build-push-{env}.yml`:

```
trigger: push to main (dev), tag v* (prod)
steps:
  1. Checkout
  2. Install + lint + test (npm ci, npm run lint, npm test)
  3. Build Docker image tagged with SHA
  4. Push to ECR
  5. SSM Run Command on target EC2:
       cd /opt/connector
       docker compose pull
       docker compose up -d
       docker image prune -af --filter "until=24h"
```

Prisma migrations run **before** the new image starts:

```
docker compose run --rm connector-api npx prisma migrate deploy
```

(This command produces no long-running container — it exits after migration. If it fails, compose up is aborted.)

---

## Zero-downtime deploy

- **connector-api:** 2 replicas behind internal ALB; rolling update (1 at a time). Health check must pass before old replica drained.
- **connector-worker:** BullMQ workers drain gracefully on SIGTERM (finish current job, don't pick next). Replicas replaced one at a time.
- **connector-scheduler:** single instance. On deploy, brief scheduler gap (<30s) — missed ticks catch up on restart (query is `next_run_at <= NOW()`). Acceptable at launch.

Target: **no user-visible downtime** for API traffic. Worker/scheduler gaps tolerated per NF-102.

---

## Rollback

1. Get previous-image SHA: `aws ecr describe-images --repository-name social-connector --query 'sort_by(imageDetails,&imagePushedAt)[-2].imageTags'`.
2. SSM: `cd /opt/connector && IMAGE_TAG=<prev> docker compose up -d`.
3. If schema migration in new version: run down-migration first (Prisma) or restore from snapshot (last-resort).
4. Target RTO: <5 minutes (NF-103).

---

## Provisioning a new environment

Terraform module in `infra/` of connector repo (to be written):
- VPC assumption: existing VPC reused
- Resources: EC2 instance, IAM role + instance profile, Security Group, Secrets Manager entries (empty, ops populates), ECR repo policy, S3 bucket (if new), nginx config update in main stack

Manual steps (one-time per env):
1. Populate Secrets Manager entries (`/connector/{env}/platform-apps/*`, `/connector/{env}/outbound-hmac-secrets`, etc.).
2. Create RDS user + GRANT on new DB: `CREATE USER 'connector_user'@'%' IDENTIFIED BY '<secret>'; GRANT ALL ON connector.* TO 'connector_user'@'%';`.
3. Register platform app credentials with each platform's developer console, pointing OAuth redirect to `https://<env>.camaleonic.com/oauth/callback/:platform`.
4. Submit Meta App Review (IG + FB) + TikTok App Review + Google App Verification (YouTube).
5. Seed `cadences` and `platform_field_support` tables via `npm run seed`.

---

## Related docs

- [`security.md`](security.md) — Secrets Manager paths, IAM policies, HMAC rotation
- [`observability.md`](observability.md) — Prometheus scrape, Grafana dashboards, Promtail
- [`runbook.md`](runbook.md) — deploy failures, rollback playbook
- [`../04-data-model.md`](../04-data-model.md) — migration applies DB schema defined there
