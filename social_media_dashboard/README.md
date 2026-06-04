# Social Media Dashboard

Sample client app for [Camaleonic Connect][connect]. Demonstrates the full
integration:

1. **Login** — in-memory user store (email + password).
2. **Connect** — opens the Camaleonic Connect widget scoped to the logged-in
   user via a short-lived JWT.
3. **Read** — lists the user's connected accounts and shows normalized
   profile data on demand.
4. **Disconnect** — revokes tokens via `DELETE /v1/accounts/:id`.

The Camaleonic API key lives server-side only.

## Run

```bash
cp .env.example .env
# Fill in CAMALEONIC_API_KEY (cmlk_live_...) and WORKSPACE_SLUG.

npm install
node --env-file=.env server.js
# → http://localhost:4000
```

## Architecture

```
Browser ──► Express (server.js) ──► Camaleonic API
            │                          │
            └─ session cookie          └─ Bearer cmlk_live_*
            └─ in-memory users
```

`server.js` exposes 8 routes:

| Method | Path                          | What |
|--------|-------------------------------|------|
| POST   | `/api/register`               | Create user + log in |
| POST   | `/api/login`                  | Log in |
| POST   | `/api/logout`                 | Drop session |
| GET    | `/api/me`                     | Current user + workspace |
| POST   | `/api/sdk-token`              | Mint SDK JWT bound to current user; body `{ platform }` attaches the per-connection product scope (see below) |
| GET    | `/api/accounts`               | List `end_user_id == me.email` |
| GET    | `/api/accounts/:id/identity`  | Normalized profile |
| DELETE | `/api/accounts/:id`           | Disconnect |

Every Camaleonic-bound route enforces ownership (`account.end_user_id ===
session.email`) before touching the upstream resource — never trust the id
from the URL.

## Files

- `server.js` — entire backend, ~170 LOC.
- `public/index.html` — login form + dashboard, single page.
- `public/app.js` — frontend controller, loads `/connect-sdk.js` from
  Camaleonic and calls `CamaleonicConnect.init().open()`.
- `public/style.css` — dark theme.

## Per-connection product scope (demo)

`server.js` keeps a `CONNECTION_PRODUCTS` map (platform → product ids). When the
frontend opens a connection it tells the backend which platform
(`POST /api/sdk-token { platform }`), and the backend mints the token with
`products: { [platform]: [...] }` — signed, so the end user can't widen it.
The demo ships with:

```js
const CONNECTION_PRODUCTS = {
  twitch: ['identity'], // profile only — no "VODs + clips"
};
```

Platforms not in the map inherit the full workspace allow-list. Watch the
server log: each mint prints `[sdk-token] platform=… products=…`.

Note: on Twitch the `identity` product is labelled "Channel + followers + subs"
and already carries all of Twitch's OAuth scopes, so the consent screen looks
the same either way — the scope's effect is which products get enrolled.
Facebook/YouTube show the scope reduction in the consent screen itself
(`ads_read` / analytics scopes drop).

## Limitations (demo, not production)

- **In-memory store** — restart wipes users and sessions.
- **No HTTPS** — fine for `localhost`, mandatory for any deployment.
- **No CSRF token** — same-site cookies cover most cases; real apps add one.
- **No webhook receiver** — see Camaleonic's `/docs.html` for the HMAC
  signing scheme.

[connect]: https://smconnector.camaleonicanalytics.com/docs.html
