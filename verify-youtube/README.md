# verify-youtube

Single-purpose Next.js app whose only job is to host the OAuth flow that
Google reviewers walk through during **YouTube OAuth verification**.

It reuses the **existing `GROP-Youtube` Google Cloud project / OAuth client**
that already serves `connect-tool`. The new subdomain is added as an
additional authorized redirect URI on that client — see "Google Cloud
setup" below. Once Google approves verification, this throwaway service
is torn down from the EC2 (the code stays here for future scope-extension
rounds).

Public URL (prod): https://yt-connector.camaleonicanalytics.com

## What it does

1. Landing → "Connect your YouTube channel" CTA.
2. OAuth start → 302 to Google with the six scopes:
   - `openid`, `userinfo.email`, `userinfo.profile`
   - `youtube.readonly` (sensitive)
   - `yt-analytics.readonly`
   - `yt-analytics-monetary.readonly` (sensitive)
3. OAuth callback → exchanges `code` for tokens, calls all four data
   surfaces (userinfo, channel, analytics views, analytics revenue), and
   renders a verified page where the reviewer can see each scope being
   used.
4. Privacy policy at `/privacy`, Terms of Service at `/terms` — linked
   from the consent screen via Google Cloud Console.

Tokens live in-memory for 10 minutes per session. No persistence.

## Google Cloud setup (one-time, before deploy)

In the existing **`GROP-Youtube`** project (same one connect-tool uses):

1. **OAuth consent screen → Edit**:
   - Application home page → `https://yt-connector.camaleonicanalytics.com/`
   - Privacy policy → `https://yt-connector.camaleonicanalytics.com/privacy`
   - Terms of service → `https://yt-connector.camaleonicanalytics.com/terms`
   - Authorized domain includes `camaleonicanalytics.com`.
   - Heads up: this consent screen is shared with the connect-tool flow at
     `smconnector.camaleonicanalytics.com`. Users connecting there will see
     these same links.
2. **Scopes → Edit**:
   - Remove `https://www.googleapis.com/auth/youtube.download` (unused; the
     YouTube API does not actually expose a download endpoint for it).
   - Keep `openid`, `userinfo.email`, `userinfo.profile`, `youtube.readonly`,
     `yt-analytics.readonly`, `yt-analytics-monetary.readonly`.
3. **Credentials → existing Web OAuth client**:
   - Authorized redirect URIs → **add**
     `https://yt-connector.camaleonicanalytics.com/api/oauth/callback/youtube`
     alongside the existing smconnector ones.
   - Authorized JavaScript origins → **add**
     `https://yt-connector.camaleonicanalytics.com`.

## Local dev

```bash
cp .env.example .env
# GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are the SAME values as in
# connect-tool/.env (same OAuth client, just a different redirect URI).

# In Google Cloud Console → Credentials → Web client, temporarily add this
# redirect URI for local dev (or just deploy and test against prod):
#   http://localhost:3003/api/oauth/callback/youtube

pnpm install   # or npm/yarn
pnpm dev
# → http://localhost:3003
```

## Deploy (EC2)

This service is wired into the same docker compose stack as `poc/` and
`connect-tool/`. Subdomain `yt-connector.camaleonicanalytics.com` points
to the same EC2 IP and is fronted by the existing Caddy.

```bash
# DNS: A record yt-connector.camaleonicanalytics.com → 3.89.195.248
# (one-time, before first deploy — Caddy needs port 80 reachable for
# Let's Encrypt HTTP-01 challenge).

# Upload .env for the new service:
scp -i ~/Camaleonic/credentials/new_web.pem verify-youtube/.env \
    ubuntu@3-89-195-248.nip.io:~/get-rid-of-phyllo/verify-youtube/.env

# Push and deploy:
git push origin main
./tools/deploy.sh
```

See `tools/EC2-DEPLOY.md` for the full deploy story.

## Removal (after Google approves verification)

```bash
# In tools/Caddyfile: remove the yt-connector.camaleonicanalytics.com block
# In tools/docker-compose.prod.yml: remove the verify-youtube service
# (and the entry under caddy.depends_on)
git commit -am "chore: tear down verify-youtube from EC2 (verified)"
git push
./tools/deploy.sh
# Optionally drop the DNS A record.
```

The `verify-youtube/` source stays in the repo for future verification
rounds (additional scopes, re-verification, etc.).
