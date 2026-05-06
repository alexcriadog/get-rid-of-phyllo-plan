# EC2 deploy

Single-host docker compose deploy on `3-89-195-248.nip.io`. Caddy fronts everything with a Let's Encrypt cert.

## Public URLs

| URL | Routes to |
|---|---|
| `https://3-89-195-248.nip.io/` | connect-tool (port 3002) |
| `https://3-89-195-248.nip.io/admin/*` | POC admin web (port 3001) |
| `https://3-89-195-248.nip.io/api/poc/*` | POC API (port 3000, bearer-guarded) |

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

## OAuth redirect URIs (one-time, in each platform console)

Add the prod URIs alongside the existing ngrok ones. **Do not delete** the ngrok ones until you've verified prod works.

```
https://3-89-195-248.nip.io/api/oauth/callback/facebook
https://3-89-195-248.nip.io/api/oauth/callback/youtube
https://3-89-195-248.nip.io/api/oauth/callback/tiktok
https://3-89-195-248.nip.io/api/oauth/callback/threads
```

## Removal

```bash
ssh ubuntu@3-89-195-248.nip.io
cd ~/get-rid-of-phyllo/poc
docker compose -f docker-compose.yml -f ../tools/docker-compose.prod.yml down -v
```

`-v` wipes the named volumes (mongo/mysql/redis/caddy data). Skip if you want to keep them.

## Common gotchas

- **Caddy errors with "no certificate"**: AWS Security Group blocks port 80. Open it. `docker compose restart caddy`.
- **OAuth callback fails with "URL Blocked"**: redirect URI not registered in the platform console. Add it. Wait 30s.
- **`docker: permission denied`**: re-login (bootstrap added your user to the `docker` group; SSH session must be re-established).
- **`./tools/deploy.sh` says PEM not found**: pass `PEM_PATH=...`. Or symlink the pem to the default path.
