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

log "Status:"
$DC -f docker-compose.yml -f ../tools/docker-compose.prod.yml ps
