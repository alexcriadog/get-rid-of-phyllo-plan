# X (Twitter)

**Status:** Login-only — no API sync
**Last updated:** 2026-07-15
**Platform API:** X API v2 (free tier), OAuth 2.0 + PKCE

X is the only platform here whose OAuth exists purely to **prove account
ownership**. It captures the handle and a profile snapshot, and then stops. Post
and metric data for X accounts is produced by scraping in `socialmedia-backend`
— the connector never polls the X API, because the free tier can't sustain it.

Everything below follows from that one decision.

---

## What the connect actually does

1. OAuth 2.0 authorization-code + PKCE (S256 — X mandates it).
2. Exactly **one** X API call, ever: `GET /2/users/me` in the callback, which
   fills the identity snapshot. The free tier covers it.
3. Seeds an account with the `identity` product only, and fires
   `ACCOUNTS.CONNECTED` carrying `canonical_user_id` + `handle`.

Scopes: `users.read tweet.read` (both are required by `/2/users/me`).
**`offline.access` is deliberately NOT requested** → no refresh token → the
~2h access token lapses right after login and is never used again.

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

1. Create an app at <https://developer.x.com> — the free tier is enough.
2. In *User authentication settings*: enable OAuth 2.0, type **Web App**
   (confidential client), and register the callback:
   `${PUBLIC_BASE_URL}/api/oauth/callback/twitter`
3. Set `TWITTER_CLIENT_ID` / `TWITTER_CLIENT_SECRET` in `connect-tool/.env`
   (see `.env.example`; `TWITTER_REDIRECT_URI` is an optional override).

### Required: enable X per workspace

`workspaces.products` is an explicit allow-list, and the
`workspace_products_required` migration backfilled it **without** `twitter`
(same as `linkedin` — new platforms are opt-in by design). Until an admin adds
it:

- the X tile does not appear in the connect modal (`offeredPlatforms`), and
- a forced `/api/oauth/start/twitter` fails **before** redirecting to X, with
  *"This platform isn't available for workspace …"*
  (`platformReachableAtOAuthStart`).

Enable it with:

```
PATCH /admin/workspaces/:slug/products    { "twitter": ["identity"] }
```

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
