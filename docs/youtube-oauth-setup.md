# YouTube OAuth setup — Google Cloud Console walkthrough

This guide is the one-time setup you do per Google Cloud project before any creator can connect their YouTube channel to the PoC. Anyone connecting a channel after that just clicks the consent screen.

**Status:** Required for any environment that talks to YouTube.
**Time:** ~15 min the first time.
**Audience:** developer / ops setting up the project.

---

## 1. Pick or create a Google Cloud project

1. Open <https://console.cloud.google.com/projectselector>.
2. Either pick the existing project or click **NEW PROJECT** and name it (e.g. `camaleonic-connector-dev`).
3. Note the **Project ID** — you'll see it in quota dashboards later.

---

## 2. Enable the three APIs

For each of these, go to **APIs & Services → Library**, search, click **Enable**:

- **YouTube Data API v3** — channels, videos, playlists, comments. 10 000 quota units/day per project, reset at midnight Pacific.
- **YouTube Analytics API** — time series, demographics, geo, traffic, devices, monetization. No units, only QPS limits (720/100s project, 60/100s/user).
- **YouTube Reporting API** — bulk daily CSV reports. Optional for the PoC; needed for full-history backfills (>12 months).

You can verify they're enabled at **APIs & Services → Enabled APIs**.

---

## 3. Configure the OAuth consent screen

1. **APIs & Services → OAuth consent screen**.
2. **User Type**: External (unless you're inside a Google Workspace org for *only* internal users).
3. Fill in:
   - **App name**: e.g. `Camaleonic Connector (dev)`
   - **User support email**: yours
   - **App logo**: optional
   - **App domain → application home page**: optional for testing
   - **Developer contact email**: yours
4. **Scopes**: click **Add or Remove Scopes** and add these three (search by name):
   - `https://www.googleapis.com/auth/youtube.readonly`
   - `https://www.googleapis.com/auth/yt-analytics.readonly`
   - `https://www.googleapis.com/auth/yt-analytics-monetary.readonly`

   All three appear under "Sensitive scopes" / "Restricted scopes" — that's expected.

5. **Test users**: add the Google account(s) that own the YouTube channels you want to connect during development. Up to 100 testers.
6. Save and exit.

> ⚠️ **Testing-mode caveat**: while the app is in *Testing* status, refresh tokens **expire after 7 days**. Each connected creator silently breaks weekly until the app is verified. Production status removes that limit but requires OAuth verification + a third-party CASA assessment (lead time: weeks). Plan for this before going live with non-test-user creators.

---

## 4. Create the OAuth Client ID

1. **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
2. **Application type**: **Web application**.
3. **Name**: `Connector PoC` (or whatever).
4. **Authorized redirect URIs** — add at least the local dev URI. Add staging/prod URIs as needed:
   - `http://localhost:3000/oauth/callback/youtube` (PoC dev)
   - `https://staging.example.com/oauth/callback/youtube` (when applicable)
5. Click **Create**.
6. The dialog shows your **Client ID** and **Client Secret** — copy both NOW. The secret is only shown once. (You can always reset it later from the same page.)

Paste them into `poc/.env`:

```
GOOGLE_CLIENT_ID=<your_client_id>.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=<your_client_secret>
GOOGLE_REDIRECT_URI=http://localhost:3000/oauth/callback/youtube
# Optional — only used for public-channel lookups that don't need OAuth.
YOUTUBE_API_KEY=<your_data_api_v3_api_key>
```

Restart the API container so the new env is picked up:

```
docker compose up -d --force-recreate
```

(`docker compose restart` keeps the container's old env — you must `up -d --force-recreate` to load new keys.)

---

## 5. Connect a creator (manual flow, PoC)

The PoC doesn't run a full OAuth callback server (the production connector will). Instead we expose two admin endpoints that give you a one-time manual flow:

### 5.1 Get the authorize URL

```
curl -s 'http://localhost:3000/admin/connect/youtube/authorize-url' | jq -r .url
```

Open the printed URL in a browser, log in as a **test user** you added in §3, and consent. The browser will redirect to your `GOOGLE_REDIRECT_URI` with `?code=...&scope=...&state=...` in the query string. Copy the `code` value.

> ⚠️ The first time you connect, you'll see a **"Google hasn't verified this app"** warning. Click **Advanced → Go to {app name} (unsafe)** to continue. This is normal in Testing mode.

### 5.2 Complete the connection

```
curl -s -X POST 'http://localhost:3000/admin/connect/youtube/complete' \
  -H 'Content-Type: application/json' \
  -d '{"code":"<paste-code-from-redirect>"}'
```

Response:

```json
{
  "seeded": { "account_id": "12", "sync_jobs_created": ["..."] },
  "youtube_account": {
    "channel_id": "UC...",
    "handle": "democreator",
    "title": "Demo Creator",
    "subscriber_count": 120000,
    "uploads_playlist_id": "UU...",
    "already_connected": false
  },
  "warnings": []
}
```

The PoC has now: persisted the access + refresh token (encrypted), created `accounts` + `oauth_tokens` rows, and inserted 4 `sync_jobs` (identity, audience, engagement_new, comments) for the worker to pick up.

### 5.3 Trigger a manual sync

Either wait for the cadence (identity = 6h, engagement_new = 4h, audience = 24h, comments = 12h) or kick one immediately:

```
# Find the sync_job ids
curl -s 'http://localhost:3000/admin/sync-jobs?account_id=<id>' | jq

# Trigger a specific one
curl -s -X POST 'http://localhost:3000/admin/sync-jobs/<job_id>/reenqueue'
```

Inspect results in Mongo (`raw_platform_responses` collection, filter `platform=youtube`) and Prisma Studio (`accounts.metadata.uploads_playlist_id` should now be populated).

---

## 6. Quota dashboard

- **Data API quota**: <https://console.cloud.google.com/apis/api/youtube.googleapis.com/quotas> — shows units used today out of 10 000. Per-method costs at <https://developers.google.com/youtube/v3/determine_quota_cost>.
- **Analytics API quota**: <https://console.cloud.google.com/apis/api/youtubeanalytics.googleapis.com/quotas>.

Request an increase via the same page when usage approaches 70%. Approval typically takes 1–2 weeks.

---

## 7. Going to production

When you're ready to invite non-test-user creators:

1. **Submit the OAuth consent screen for verification** at <https://console.cloud.google.com/apis/credentials/consent>. Google reviews the app + privacy policy + scope justification.
2. **Complete a CASA (Cloud Application Security Assessment)** via Google's third-party assessor — required for restricted scopes. Lead time: weeks.
3. After verification, the consent screen no longer shows the "unverified app" warning and refresh tokens stop expiring at 7 days.

Until then, every connected creator must be on the test-user list and reconnect every 7 days.
