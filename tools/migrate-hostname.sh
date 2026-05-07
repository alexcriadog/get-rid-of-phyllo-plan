#!/usr/bin/env bash
# migrate-hostname.sh — swap the public hostname across Caddy + compose
# overlay so the EC2 stack moves from `3-89-195-248.nip.io` to a real
# subdomain you control (e.g. oauth.camaleonicanalytics.com).
#
# Why a real subdomain: TikTok For Business OAuth flags wildcard-DNS
# services (nip.io) as invalid, returning 403 from /portal/auth even when
# the URL is registered. A subdomain on a domain you own (DNS A record →
# 3.89.195.248) passes validation; Caddy auto-issues an LE cert.
#
# Usage (from dev box):
#   bash tools/migrate-hostname.sh oauth.camaleonicanalytics.com
#
# What it does:
#   1. Sanity-checks the new hostname looks like a domain.
#   2. Replaces the literal `3-89-195-248.nip.io` in tools/Caddyfile and
#      tools/docker-compose.prod.yml (`.bak` files kept for rollback).
#   3. Prints the follow-up checklist (DNS, commit/push, redeploy, OAuth
#      console re-registrations).
#
# Roll back:
#   mv tools/Caddyfile.bak              tools/Caddyfile
#   mv tools/docker-compose.prod.yml.bak tools/docker-compose.prod.yml
#   git checkout -- tools/   # then commit + redeploy
set -euo pipefail

NEW_HOST="${1:-}"
OLD_HOST="3-89-195-248.nip.io"

if [[ -z "$NEW_HOST" ]]; then
  echo "usage: bash tools/migrate-hostname.sh <new.host.com>"
  exit 1
fi

if ! [[ "$NEW_HOST" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$ ]]; then
  echo "error: '$NEW_HOST' does not look like a valid hostname"
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

if ! grep -q "$OLD_HOST" tools/Caddyfile; then
  echo "error: tools/Caddyfile no longer contains '$OLD_HOST' — already migrated?"
  exit 1
fi

log() { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
ok()  { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }

log "Backing up Caddyfile + compose overlay"
cp tools/Caddyfile tools/Caddyfile.bak
cp tools/docker-compose.prod.yml tools/docker-compose.prod.yml.bak

log "Rewriting hostname → $NEW_HOST"
sed -i.tmp "s|$OLD_HOST|$NEW_HOST|g" tools/Caddyfile
sed -i.tmp "s|$OLD_HOST|$NEW_HOST|g" tools/docker-compose.prod.yml
rm -f tools/Caddyfile.tmp tools/docker-compose.prod.yml.tmp

log "Verification"
echo "Caddyfile site block:"
grep -n "^$NEW_HOST" tools/Caddyfile || true
echo
echo "Compose env entries pointing at new host:"
grep -n "$NEW_HOST" tools/docker-compose.prod.yml || true

ok "Files updated. Next steps:"
cat <<EOF

  1. Verify DNS already points to EC2:
       dig +short $NEW_HOST            # expect 3.89.195.248

  2. Commit + push:
       git add tools/Caddyfile tools/docker-compose.prod.yml
       git commit -m "ops(deploy): switch public hostname to $NEW_HOST"
       git push

  3. Redeploy on EC2 (Caddy issues a fresh LE cert via HTTP-01 challenge,
     ~30 s; web container rebuilds with the new NEXT_PUBLIC_* baked in):
       ssh -i ~/Camaleonic/credentials/new_web.pem ubuntu@ec2-3-89-195-248.compute-1.amazonaws.com \\
         'bash ~/get-rid-of-phyllo/tools/redeploy.sh'

  4. Smoke test:
       curl -sSI https://$NEW_HOST/api/poc/admin/healthz | head -2

  5. Update OAuth consoles — replace the old nip.io redirect URI with:
       https://$NEW_HOST/api/oauth/callback/facebook
       https://$NEW_HOST/api/oauth/callback/youtube
       https://$NEW_HOST/api/oauth/callback/threads
       https://$NEW_HOST/api/oauth/callback/tiktok       (Advertiser redirect URL — TikTok BC)

  Rollback:
       mv tools/Caddyfile.bak tools/Caddyfile
       mv tools/docker-compose.prod.yml.bak tools/docker-compose.prod.yml
       (then commit + redeploy + revert console URIs)

EOF
