#!/usr/bin/env bash
# issue-prod-key.sh — codified operator tool. Runs `npm run issue-key` inside
# the prod api container and prints the raw key once. The key is stored as
# its SHA-256 hash; this is the only chance to capture the plaintext.
#
# Usage:
#   ./tools/issue-prod-key.sh <workspace-slug> [--label "text"]
#
# Override defaults via env (same as deploy.sh):
#   PEM_PATH=/some/path/key.pem HOST=ubuntu@other-host ./tools/issue-prod-key.sh demo

set -euo pipefail

PEM="${PEM_PATH:-$HOME/Camaleonic/credentials/new_web.pem}"
HOST="${HOST:-ubuntu@ec2-3-89-195-248.compute-1.amazonaws.com}"

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <workspace-slug> [--label \"text\"]" >&2
  exit 1
fi

if [[ ! -f "$PEM" ]]; then
  echo "PEM not found at $PEM. Set PEM_PATH=…" >&2
  exit 1
fi

# Quote each arg so it survives one round-trip through ssh + bash -lc.
quoted=""
for a in "$@"; do
  quoted+=" $(printf '%q' "$a")"
done

echo "▶ Issuing API key on ${HOST}…"
ssh -i "$PEM" -o StrictHostKeyChecking=accept-new "$HOST" \
  "cd ~/get-rid-of-phyllo/poc && \
   docker compose -f docker-compose.yml -f ../tools/docker-compose.prod.yml \
     exec -T api npm run issue-key --silent --${quoted}"
