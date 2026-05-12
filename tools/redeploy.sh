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

# Reconcile Prisma schema. Idempotent — no-op when live DB matches
# schema.prisma. Catches schema additions automatically on every deploy.
log "Reconciling Prisma schema…"
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
