# connect-tool

> ⚠️ **TRANSIENT.** This is the throwaway OAuth helper for the POC. It
> exists so the operator can click "Connect Facebook / Instagram /
> TikTok / Threads / YouTube" instead of pasting tokens by hand.
>
> When the real OAuth/connection app is built, **delete this folder**
> and update `CONNECT_TOOL_SECRET` on the POC. The POC's
> `POST /admin/connect/seed` contract is the only thing the real app
> needs to know.

## What it does

Runs a tiny Next.js server on **port 3002** that:
1. Renders 5 buttons (one per platform).
2. Handles the OAuth round-trip (authorize URL → callback → token exchange).
3. POSTs the resulting tokens to the POC's `/admin/connect/seed` with a
   shared bearer token (`CONNECT_TOOL_SECRET`).
4. Redirects the operator to a confirmation page.

It does **not**:
- Touch the POC database directly.
- Share Prisma client / Mongo connection / Redis with the POC.
- Persist any tokens locally (Facebook user-token is held in-memory for
  10 minutes between dialog and page-picker, then discarded).

## Local run

```bash
cd connect-tool
cp .env.example .env       # fill in app credentials
npm install
npm run dev                # http://localhost:3002
```

The POC must be reachable at `POC_API_URL` (default `http://api:3000` for
docker compose; use `http://localhost:3000` if running on host).

## Removal

```bash
docker compose stop connect-tool
docker compose rm -f connect-tool
rm -rf connect-tool/
# Edit poc/docker-compose.yml: remove the `connect-tool` service block.
# Done. POC keeps running. Already-seeded accounts keep syncing.
```

## Layout

```
pages/                 ← UI (Next.js page routing)
  index.tsx            ← landing with 5 platform tiles
  facebook/pages.tsx   ← page-picker (FB returns N pages, operator picks)
  success.tsx          ← post-seed confirmation
  api/oauth/[...slug]  ← single dispatcher: start/{platform}, callback/{platform}
  api/seed-pages.ts    ← FB multi-page seed handler
lib/
  platforms.ts         ← all 5 OAuth flows
  seed-client.ts       ← POC API caller
  session.ts           ← in-memory FB user-token cache (TTL 10min)
components/
  PlatformTile.tsx     ← landing tile
styles/
  globals.css          ← copy of POC design tokens (mint / uv / anton)
```
