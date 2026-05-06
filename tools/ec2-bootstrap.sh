#!/usr/bin/env bash
# ec2-bootstrap.sh — one-shot setup for a fresh Ubuntu EC2.
#
# Usage on the EC2 host:
#   bash ~/get-rid-of-phyllo/tools/ec2-bootstrap.sh         # full bootstrap
#   bash ~/get-rid-of-phyllo/tools/ec2-bootstrap.sh keys    # only generate ssh key
#
# Idempotent: re-running skips steps already done.
set -euo pipefail

REPO_URL="${REPO_URL:-git@github.com:alexcriadog/get-rid-of-phyllo-plan.git}"
REPO_DIR="${REPO_DIR:-$HOME/get-rid-of-phyllo}"
MODE="${1:-full}"

log()  { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m⚠ %s\033[0m\n' "$*"; }

ensure_pkg() {
  local pkg="$1"
  if ! dpkg -s "$pkg" >/dev/null 2>&1; then
    log "Installing $pkg…"
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y "$pkg"
  fi
}

ensure_ssh_key() {
  if [[ ! -f "$HOME/.ssh/id_ed25519" ]]; then
    log "Generating SSH key for git…"
    mkdir -p "$HOME/.ssh"
    chmod 700 "$HOME/.ssh"
    ssh-keygen -t ed25519 -N '' -f "$HOME/.ssh/id_ed25519" -C "ec2@get-rid-of-phyllo"
    ssh-keyscan -t ed25519 github.com >> "$HOME/.ssh/known_hosts" 2>/dev/null || true
  fi
  echo
  warn "Add this key as a Deploy key on GitHub before continuing:"
  warn "  https://github.com/alexcriadog/get-rid-of-phyllo-plan/settings/keys/new"
  echo
  echo "── public key ──────────────────────────────────────────────────────"
  cat "$HOME/.ssh/id_ed25519.pub"
  echo "────────────────────────────────────────────────────────────────────"
}

if [[ "$MODE" == "keys" ]]; then
  ensure_ssh_key
  exit 0
fi

# ── 1. apt prerequisites ──────────────────────────────────────────────────
log "Updating apt…"
sudo apt-get update -y
ensure_pkg ca-certificates
ensure_pkg curl
ensure_pkg git

# ── 2. Docker + compose plugin ────────────────────────────────────────────
if ! command -v docker >/dev/null 2>&1; then
  log "Installing Docker (official apt repo)…"
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
    sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  sudo chmod a+r /etc/apt/keyrings/docker.gpg
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
     https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
    sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt-get update -y
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  sudo usermod -aG docker "$USER"
  ok "Docker installed. NOTE: re-login for group change, or run with sudo until then."
else
  ok "Docker already installed: $(docker --version)"
fi

# ── 3. SSH key + repo clone ───────────────────────────────────────────────
ensure_ssh_key

if [[ ! -d "$REPO_DIR/.git" ]]; then
  log "Cloning $REPO_URL → $REPO_DIR…"
  if ! git clone "$REPO_URL" "$REPO_DIR"; then
    warn "git clone failed. Add the deploy key on GitHub then re-run this script."
    exit 1
  fi
else
  log "Repo already cloned. Pulling latest…"
  git -C "$REPO_DIR" fetch --all --prune
  git -C "$REPO_DIR" reset --hard origin/main
fi

# ── 4. .env files (must already be in place — see scp instructions) ───────
if [[ ! -f "$REPO_DIR/poc/.env" ]] || [[ ! -f "$REPO_DIR/connect-tool/.env" ]]; then
  warn "Missing .env files. From your dev box run:"
  warn "  scp -i <pem> /local/poc/.env           ubuntu@HOST:$REPO_DIR/poc/.env"
  warn "  scp -i <pem> /local/connect-tool/.env  ubuntu@HOST:$REPO_DIR/connect-tool/.env"
  warn "Re-run this script after the .env files are in place."
  exit 1
fi

# ── 5. docker compose up ─────────────────────────────────────────────────
log "Building + starting compose stack (this can take a few minutes)…"
cd "$REPO_DIR/poc"
DC="docker compose"
if ! docker compose version >/dev/null 2>&1; then DC="sudo docker compose"; fi
$DC -f docker-compose.yml -f ../tools/docker-compose.prod.yml build --pull
$DC -f docker-compose.yml -f ../tools/docker-compose.prod.yml up -d

log "Waiting 15s for Caddy to obtain TLS cert…"
sleep 15
$DC -f docker-compose.yml -f ../tools/docker-compose.prod.yml ps

ok "Bootstrap complete. Test:"
echo "  https://3-89-195-248.nip.io/                       (connect-tool)"
echo "  https://3-89-195-248.nip.io/admin/accounts         (POC admin)"
echo "  https://3-89-195-248.nip.io/api/poc/admin/healthz  (POC API)"
