#!/usr/bin/env bash
# deploy.sh — local one-liner. After `git push`, run this to propagate the
# change to the EC2.
#
# Override defaults via env:
#   PEM_PATH=/some/path/key.pem HOST=ubuntu@other-host ./tools/deploy.sh
set -euo pipefail

PEM="${PEM_PATH:-$HOME/Camaleonic/credentials/new_web.pem}"
HOST="${HOST:-ubuntu@ec2-3-89-195-248.compute-1.amazonaws.com}"

if [[ ! -f "$PEM" ]]; then
  echo "PEM not found at $PEM. Set PEM_PATH=…" >&2
  exit 1
fi

echo "▶ Redeploying on $HOST…"
ssh -i "$PEM" -o StrictHostKeyChecking=accept-new "$HOST" \
  'bash ~/get-rid-of-phyllo/tools/redeploy.sh'
echo "✓ Done."
