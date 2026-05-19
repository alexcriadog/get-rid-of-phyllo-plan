#!/usr/bin/env bash
# redeploy.sh — runs ON the EC2 host. Pulls latest main, rebuilds images
# whose context changed, restarts containers in place.
#
# Invoked by tools/deploy.sh from the dev box, or run directly via:
#   ssh ubuntu@<host> 'bash ~/get-rid-of-phyllo/tools/redeploy.sh'
set -euo pipefail

REPO_DIR="${REPO_DIR:-$HOME/get-rid-of-phyllo}"
cd "$REPO_DIR"

log() { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }

log "Pulling latest main…"
git fetch --all --prune
git reset --hard origin/main

log "Rebuilding + restarting compose stack…"
cd poc
DC="docker compose"
if ! docker compose version >/dev/null 2>&1; then DC="sudo docker compose"; fi
$DC -f docker-compose.yml -f ../tools/docker-compose.prod.yml build --pull
$DC -f docker-compose.yml -f ../tools/docker-compose.prod.yml up -d

# Apply Prisma migrations. `migrate deploy` is the production-safe path
# — unlike `db push`, it executes the explicit migration SQL so backfill
# steps (e.g. seeding "wkspc_demo" before promoting accounts.workspace_id
# to NOT NULL) run in the right order.
#
# Historically this stack used `db push --accept-data-loss`, so the
# _prisma_migrations table may be empty on long-lived prod instances.
# Baseline the four pre-multi-tenancy migrations as applied first;
# `migrate resolve --applied` is idempotent (no-op if already recorded).
log "Baselining historic Prisma migrations (idempotent)…"
for m in 20260423151828_init \
         20260426150000_add_product_to_api_call_log \
         20260428151952_add_tiktok_token_columns_and_account_metadata \
         20260505131500_add_sync_job_settings_column; do
  $DC -f docker-compose.yml -f ../tools/docker-compose.prod.yml exec -T api \
    npx prisma migrate resolve --applied "$m" 2>&1 | tail -2 || true
done

log "Applying pending Prisma migrations…"
$DC -f docker-compose.yml -f ../tools/docker-compose.prod.yml exec -T api \
  npx prisma migrate deploy 2>&1 | tail -10

# `db push` kept as a safety net for ad-hoc schema additions that haven't
# been promoted to a migration yet (e.g. a quick column tweak between
# releases). Idempotent — no-op when schema matches.
log "Reconciling residual Prisma drift (db push fallback)…"
$DC -f docker-compose.yml -f ../tools/docker-compose.prod.yml exec -T api \
  npx prisma db push --accept-data-loss 2>&1 | tail -3 || true

# Apply data seed (Cadence defaults + SyncJob backfill for new products).
# Idempotent via upserts; safe to run on every deploy. Without this step
# new products like engagement_deep / ads never get cadence rows in prod
# and the scheduler can't pick them up.
log "Running Prisma seed (cadences + sync_jobs backfill)…"
$DC -f docker-compose.yml -f ../tools/docker-compose.prod.yml exec -T api \
  npm run seed 2>&1 | tail -10 || true

# Caddy bind-mounts the Caddyfile but doesn't auto-reload on file changes.
# `docker compose up -d` won't restart the container unless its compose
# definition changed. Force a restart so Caddyfile edits propagate.
log "Restarting Caddy to pick up Caddyfile changes…"
$DC -f docker-compose.yml -f ../tools/docker-compose.prod.yml restart caddy 2>&1 | tail -2 || true

log "Status:"
$DC -f docker-compose.yml -f ../tools/docker-compose.prod.yml ps

# Temporary diagnostic — remove once the multi-tenancy rollout is stable.
log "DIAG: workspaces + api_keys table presence and counts"
$DC -f docker-compose.yml -f ../tools/docker-compose.prod.yml exec -T mysql \
  mysql -u root -prootpw -D connector -e \
  "SHOW TABLES LIKE 'workspaces'; SHOW TABLES LIKE 'api_keys'; SHOW TABLES LIKE 'workspace_secrets'; SELECT COUNT(*) AS workspaces_count FROM workspaces; SELECT COUNT(*) AS accounts_with_ws FROM accounts WHERE workspace_id IS NOT NULL;" 2>&1 | grep -v "Warning"

log "DIAG: api logs (last 60 lines)"
$DC -f docker-compose.yml -f ../tools/docker-compose.prod.yml logs --tail=60 api 2>&1 | tail -60
