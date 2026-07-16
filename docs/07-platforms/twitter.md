# X (Twitter)

**Status:** Login-only — no API sync
**Last updated:** 2026-07-16
**Platform API:** OAuth 1.0a "Sign in with Twitter" (free)

X is the only platform here whose OAuth exists purely to **prove account
ownership**. It captures the @handle and then stops. Post and metric data for X
accounts is produced by scraping in `socialmedia-backend` — the connector never
polls the X API.

Everything below follows from that one decision.

---

## Why OAuth 1.0a, not 2.0

X removed its free API tier (Feb 2026): OAuth 2.0 login needs `GET /2/users/me`
to learn who signed in, and that read is **metered** under Pay-Per-Use. We don't
want to pay per login, and we don't need the profile (it's scraped).

**OAuth 1.0a "Sign in with Twitter" returns `user_id` + `screen_name` in the
access-token response itself — for free, no read call, no Pay-Per-Use project.**
That's exactly a login-only integration. The implementation is
`connect-tool/lib/oauth1a.ts` (HMAC-SHA1 signing) driven by the dispatcher's
`oauth1a` branch.

## What the connect actually does

1. 3-legged OAuth 1.0a: `POST /oauth/request_token` → redirect to
   `/oauth/authenticate` → `POST /oauth/access_token`.
2. The access-token response carries `user_id` + `screen_name` — **no X API
   read is ever made.** No rich profile (display name, avatar, followers): that
   is scraped.
3. Seeds an account with the `identity` product only, storing `canonical_user_id`
   (= `user_id`) + `handle` (= `screen_name`), and fires `ACCOUNTS.CONNECTED`.

The 1.0a access token is long-lived and **never used** (login-only). No
`expires_at` is stored, so the admin token badge never shows a false "expired".

---

## ⚠️ Join on `canonical_user_id`, never on the handle

This is the one thing that matters for the scraping integration.

`canonical_user_id` is X's numeric user id: immutable across renames, never
reissued. **`handle` is a display value.** X frees a username the moment its
owner renames, and a stranger can then register it.

So if scraping is keyed on `@handle`, this happens:

1. User connects `@alice` — ownership proven, snapshot stored.
2. User renames to `@alice_new`. X releases `@alice`.
3. Someone else registers `@alice`.
4. The scraper, still keyed on `alice`, attributes a stranger's posts to the
   original user's account and workspace.

The connector cannot detect this: it makes its only X call at connect time, so a
later rename leaves the stored handle stale until the user reconnects (which
upserts the same row on the canonical id and refreshes both). **Key the scrape
on `canonical_user_id`; treat `handle` as a refreshable display hint.**

---

## Setup

1. Create an app at <https://developer.x.com>. It does **not** need to be in a
   Pay-Per-Use project — OAuth 1.0a login works on the free/standalone app.
2. In *User authentication settings*: enable **OAuth 1.0a**, request **Read**
   permission, type **Web App**, and register the callback:
   `${PUBLIC_BASE_URL}/api/oauth/callback/twitter`
3. Set `TWITTER_CONSUMER_KEY` / `TWITTER_CONSUMER_SECRET` in `connect-tool/.env`
   — these are the app's **OAuth 1.0a Consumer keys** (shown as "API Key" /
   "API Key Secret" under Keys & Tokens), NOT the OAuth 2.0 Client ID/Secret.
   `TWITTER_REDIRECT_URI` is an optional override.

### Required: enable X per workspace

`workspaces.products` is an explicit allow-list, and the
`workspace_products_required` migration backfilled it **without** `twitter`
(same as `linkedin` — new platforms are opt-in by design). Until an admin adds
it:

- the X tile does not appear in the connect modal (`offeredPlatforms`), and
- a forced `/api/oauth/start/twitter` fails **before** redirecting to X, with
  *"This platform isn't available for workspace …"*
  (`platformReachableAtOAuthStart`).

**⚠️ The PATCH REPLACES the whole allow-list — it is not a merge.** Any platform
you omit is removed, and `updateProducts` then deletes *every* sync_job of that
platform's accounts in the workspace (`admin-saas.controller.ts` — the `else`
branch prunes by `accountId` alone). So `{"twitter":["identity"]}` on its own
would silently wipe the workspace's other platforms.

Always GET first and send back the full object plus X:

```bash
# inside poc-api (loopback bypasses the Caddy admin gate)
docker exec poc-api node -e '
const url = "http://localhost:3000/admin/workspaces/<slug>";
(async () => {
  const cur = await (await fetch(url)).json();
  const next = { ...cur.products, twitter: ["identity"] };   // additive
  const res = await fetch(url + "/products", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(next),
  });
  console.log(res.status, JSON.stringify(await res.json()));
})();'
```

`pruned_sync_jobs: 0` in the response confirms nothing was collaterally dropped.

`identity` is the only valid product for X — `resolveWorkspaceProducts` filters
against the catalog, so nothing else can be granted even by mistake.

---

## Consequences of login-only (all deliberate)

| Behaviour | Why |
|---|---|
| `identity` re-reads the stored snapshot; no X API call | The token is dead by design, and the snapshot only changes on reconnect. Cadence is daily (`seed.ts` `CADENCE_DEFAULTS`). |
| No `expires_at` persisted | Nobody will ever act on that expiry. Recording it would make every X account show a red `expired` token badge forever, poisoning a signal that means "needs attention". |
| Excluded from the token-refresh cron (`LOGIN_ONLY`) | Nothing to refresh — and permanently-expired rows sort first under `expiresAt asc`, so they would crowd out tokens that do need work. |
| Token-canary always reports healthy | `fetchProfile` can't fail, so an X account is never flagged `needs_reauth`. Correct: no live token dependency exists. |
| **Revocation is undetectable** | A user revoking access on X is invisible to us. "Ownership proven" has no expiry and no revocation channel — accepted, since the proof is a point-in-time fact and the handle stays scrapeable regardless. |

---

## Not supported

Posts, metrics, audience, comments, mentions — everything except `identity`.
See `twitter.support-matrix.ts`. Note the profile counters
(followers/following/posts) read `supported` there, but they are **frozen at
connect time**; the matrix vocabulary has no state for "static", so the Data
Guide presents them like live counters.
