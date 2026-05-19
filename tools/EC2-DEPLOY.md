# EC2 deploy

Single-host docker compose deploy on `3-89-195-248.nip.io`. Caddy fronts everything with a Let's Encrypt cert.

## Public URLs

| URL | Routes to |
|---|---|
| `https://smconnector.camaleonicanalytics.com/` | connect-tool (port 3002) |
| `https://smconnector.camaleonicanalytics.com/admin/*` | POC admin web (port 3001) |
| `https://smconnector.camaleonicanalytics.com/api/poc/*` | POC API (port 3000, bearer-guarded) |
| `https://yt-connector.camaleonicanalytics.com/` | verify-youtube (port 3003) — YouTube OAuth verification UI. Throwaway; tear down after Google approves. |

## Bootstrap (one-time, fresh EC2)

Pre-req in **AWS Security Group**: open inbound TCP **80** and **443** (SSH 22 already). Without 80 open, Let's Encrypt HTTP-01 fails and Caddy serves a self-signed cert.

```bash
ssh -i ~/Camaleonic/credentials/new_web.pem ubuntu@3-89-195-248.nip.io

# 1. clone tooling early so the bootstrap script is available before the
#    full repo clone (chicken-and-egg on the deploy key)
sudo apt-get update -y && sudo apt-get install -y git
git clone https://github.com/alexcriadog/get-rid-of-phyllo-plan.git --depth 1 ~/_tooling
bash ~/_tooling/tools/ec2-bootstrap.sh keys
```

The script prints a public SSH key. Copy it and add it as a **Deploy key** on GitHub:
https://github.com/alexcriadog/get-rid-of-phyllo-plan/settings/keys/new (read-only is fine).

```bash
# 2. now SSH-cloning works:
rm -rf ~/_tooling
bash ~/get-rid-of-phyllo/tools/ec2-bootstrap.sh    # will fail at the .env check
```

The script will fail telling you the `.env` files are missing. Upload them from your dev box:

```bash
# from local machine
scp -i ~/Camaleonic/credentials/new_web.pem poc/.env \
    ubuntu@3-89-195-248.nip.io:~/get-rid-of-phyllo/poc/.env
scp -i ~/Camaleonic/credentials/new_web.pem connect-tool/.env \
    ubuntu@3-89-195-248.nip.io:~/get-rid-of-phyllo/connect-tool/.env
```

Re-run on the EC2:

```bash
bash ~/get-rid-of-phyllo/tools/ec2-bootstrap.sh
```

Wait ~30s for Caddy to obtain the cert, then check the URLs above.

## Update workflow

After every `git push` to `main`:

```bash
./tools/deploy.sh
```

That SSHes into the EC2 and runs `redeploy.sh` (git pull + `docker compose up -d --build`). Only the containers whose source changed get rebuilt.

## Locking down /admin/* with Basic Auth

The `/admin/*` surface is operator-trust by default — open to anyone with the URL. Before onboarding a real customer, flip on Basic Auth at the Caddy layer:

```bash
# 1. Generate a bcrypt hash for your password
docker run --rm caddy:2-alpine caddy hash-password --plaintext 'YOUR_PASSWORD_HERE'
# Copy the entire $2a$14$... line that comes back.

# 2. Edit tools/Caddyfile — find the `handle /admin*` block and uncomment
#    the basic_auth lines, pasting your hash:
#
#    handle /admin* {
#        basic_auth {
#            alex $2a$14$RealBcryptHashGoesHere
#            # add more 'user hash' lines for additional operators
#        }
#        reverse_proxy web:3001
#    }

# 3. Commit + deploy
git add tools/Caddyfile
git commit -m "ops: enable basic auth on /admin/*"
git push && ./tools/deploy.sh
```

Caddy reloads automatically on `redeploy.sh`. From the next request onwards `/admin/*` returns 401 unless the browser sends the credentials. Note this also affects the AdminSaasController endpoints (`/admin/workspaces`, `/admin/api-keys`, etc.) — the `/client/*` and `/v1/*` surfaces are unaffected.

## Client-dashboard session secret

`poc/web` signs the API-key cookie with `WEB_SESSION_SECRET`. If unset it falls back to `hmac(hostname() + CONNECTOR_API_URL)` — stable per host, not trivially guessable. For real security, set the env var explicitly:

```bash
# Generate
openssl rand -hex 32

# Add to the web container's env_file (or environment block in docker-compose.prod.yml)
echo "WEB_SESSION_SECRET=<that hex>" >> poc/web/.env
# Then redeploy.
```


## OAuth redirect URIs (one-time, in each platform console)

Add the prod URIs alongside the existing ngrok ones. **Do not delete** the ngrok ones until you've verified prod works.

```
https://smconnector.camaleonicanalytics.com/api/oauth/callback/facebook
https://smconnector.camaleonicanalytics.com/api/oauth/callback/youtube
https://smconnector.camaleonicanalytics.com/api/oauth/callback/tiktok
https://smconnector.camaleonicanalytics.com/api/oauth/callback/threads
```

### verify-youtube (reuses existing GROP-Youtube Cloud project)

The verification UI shares the **same** Google Cloud project and OAuth Web
client as `connect-tool`. We just append a new authorized redirect URI to
the existing client:

```
https://yt-connector.camaleonicanalytics.com/api/oauth/callback/youtube
```

And add `https://yt-connector.camaleonicanalytics.com` as an Authorized
JavaScript origin. The existing smconnector entries stay in place.

When the main company app is ready, add its redirect URI(s) to the same
client. That doesn't re-trigger verification.

## verify-youtube — first-deploy checklist

The throwaway YouTube OAuth verification UI rides on the same compose
stack but lives at its own subdomain. To stand it up:

1. **DNS A record**: `yt-connector.camaleonicanalytics.com` → `3.89.195.248`. Wait for propagation (`dig yt-connector.camaleonicanalytics.com` returns the IP).
2. **Existing GROP-Youtube Cloud project** updates (no new project):
   - Consent screen: set homepage to `https://yt-connector.camaleonicanalytics.com/`, privacy to `/privacy`, terms to `/terms` on that subdomain.
   - Remove the unused `youtube.download` scope.
   - On the existing Web OAuth client, add the new authorized redirect URI and JavaScript origin (see "verify-youtube (reuses existing GROP-Youtube Cloud project)" above).
3. **Upload `.env`** — use the SAME `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` values that are already in `connect-tool/.env`:
   ```bash
   scp -i ~/Camaleonic/credentials/new_web.pem verify-youtube/.env \
       ubuntu@3-89-195-248.nip.io:~/get-rid-of-phyllo/verify-youtube/.env
   ```
4. **Deploy**:
   ```bash
   ./tools/deploy.sh
   ```
5. **Verify**: open `https://yt-connector.camaleonicanalytics.com/`, run the flow with a test Google account, confirm the `/verified/{session}` page renders all four cards.

When Google approves the verification: see [Teardown — verify-youtube](#teardown--verify-youtube) below.

## Removal

```bash
ssh ubuntu@3-89-195-248.nip.io
cd ~/get-rid-of-phyllo/poc
docker compose -f docker-compose.yml -f ../tools/docker-compose.prod.yml down -v
```

`-v` wipes the named volumes (mongo/mysql/redis/caddy data). Skip if you want to keep them.

### Teardown — verify-youtube

After Google approves the verification, take the verification UI offline
without touching the rest of the stack:

1. In `tools/Caddyfile`, remove the `yt-connector.camaleonicanalytics.com { ... }` block.
2. In `tools/docker-compose.prod.yml`, remove the `verify-youtube` service block and drop `- verify-youtube` from `caddy.depends_on`.
3. Commit + push, then `./tools/deploy.sh`. The `verify-youtube` container stops and is removed.
4. (Optional) Delete the DNS A record for `yt-connector.camaleonicanalytics.com`.

The `verify-youtube/` source tree stays in the repo for future verification rounds (additional scopes, re-verification).

## Common gotchas

- **Caddy errors with "no certificate"**: AWS Security Group blocks port 80. Open it. `docker compose restart caddy`.
- **OAuth callback fails with "URL Blocked"**: redirect URI not registered in the platform console. Add it. Wait 30s.
- **`docker: permission denied`**: re-login (bootstrap added your user to the `docker` group; SSH session must be re-established).
- **`./tools/deploy.sh` says PEM not found**: pass `PEM_PATH=...`. Or symlink the pem to the default path.
