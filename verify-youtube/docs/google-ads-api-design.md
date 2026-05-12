# Camaleonic Analytics — Google Ads API Integration Design Document

> Submitted as part of the Basic Access application for the Google Ads API
> developer token associated with the Camaleonic Analytics MCC.

## 1. Product overview

**Camaleonic Analytics** is a SaaS dashboard for YouTube creators and
brands. It lets a connected user view their **own** YouTube channel
analytics together with their **own** YouTube video advertising campaigns
on Google Ads, in a single read-only interface.

The Google Ads API integration is one data source inside the dashboard —
it is not a product we resell, repackage, or expose to other developers.
We do not use it for campaign management; only for displaying performance
metrics back to the same user who owns the campaigns.

- **Operating entity**: Camaleonic Ads 2020 SL (Spain).
- **Production URL**: https://camaleonicanalytics.com
- **OAuth verification surface**: https://yt-connector.camaleonicanalytics.com
- **Privacy policy**: https://yt-connector.camaleonicanalytics.com/privacy
- **Terms of service**: https://yt-connector.camaleonicanalytics.com/terms

## 2. User journey

1. The end user visits `https://yt-connector.camaleonicanalytics.com` and
   clicks **Connect with YouTube**.
2. Our server redirects the user to Google's OAuth 2.0 consent screen
   (`https://accounts.google.com/o/oauth2/v2/auth`), requesting:
   - `openid`, `userinfo.email`, `userinfo.profile` — account
     identification.
   - `https://www.googleapis.com/auth/youtube.readonly` — YouTube channel
     metadata and videos.
   - `https://www.googleapis.com/auth/yt-analytics.readonly` — YouTube
     engagement metrics.
   - `https://www.googleapis.com/auth/adwords` — **this application**.
3. The user reviews the requested permissions and grants consent.
4. Google redirects to our server with an authorization code.
5. The server exchanges the code at `https://oauth2.googleapis.com/token`
   for an access token (and refresh token, since we request
   `access_type=offline`).
6. The server immediately calls `customers:listAccessibleCustomers` with
   the user's access token and our developer token to discover the Google
   Ads customer IDs the user has access to.
7. For each accessible customer (or a primary one selected by the user
   in production), the server issues a single GAQL query against
   `customers/{customer_id}/googleAds:search` to retrieve the user's
   own VIDEO advertising_channel_type campaigns and metrics for the last
   30 days.
8. The dashboard renders the results in a single page: campaign name,
   status, video views, view rate, average CPV, spend.

The full flow is demonstrated end-to-end at
`https://yt-connector.camaleonicanalytics.com` for Google reviewers.

## 3. Technical architecture

### 3.1 Stack

- **Language / runtime**: TypeScript on Node.js 20.
- **Web framework**: Next.js 14.2 (Pages router).
- **Hosting**: single AWS EC2 instance running Docker Compose.
- **Reverse proxy**: Caddy, with TLS terminated via Let's Encrypt.
- **Persistence**: PostgreSQL for user metadata; OAuth tokens encrypted
  at rest with AES-256-GCM, key managed via AWS KMS.

### 3.2 Google Ads API calls (REST, v24)

We make exactly two read-only call shapes. Both are invoked server-side
from the Next.js backend; the browser never sees the developer token.

**A. List accessible customers**

```
GET https://googleads.googleapis.com/v24/customers:listAccessibleCustomers
Headers:
  Authorization: Bearer {user_access_token}
  developer-token: {camaleonic_developer_token}
```

Response shape:

```json
{ "resourceNames": ["customers/1234567890", "customers/0987654321"] }
```

**B. Read video campaigns (last 30 days)**

```
POST https://googleads.googleapis.com/v24/customers/{customer_id}/googleAds:search
Headers:
  Authorization: Bearer {user_access_token}
  developer-token: {camaleonic_developer_token}
  Content-Type: application/json
```

Request body:

```json
{
  "query": "SELECT campaign.id, campaign.name, campaign.status,
                   metrics.video_views, metrics.video_view_rate,
                   metrics.average_cpv, metrics.cost_micros,
                   metrics.impressions
            FROM campaign
            WHERE campaign.advertising_channel_type = 'VIDEO'
              AND segments.date BETWEEN '{start}' AND '{end}'
            ORDER BY metrics.video_views DESC
            LIMIT 50"
}
```

If the user is themselves a manager (MCC) and the queried customer is
one of their children, the `login-customer-id` header is set to the
user's MCC ID. For direct advertiser accounts the header is omitted.

### 3.3 What we explicitly do NOT do

- **No mutate operations.** No `*Service.Mutate*` calls. No campaign,
  ad group, ad, asset, budget, audience, bidding, or extension changes.
- **No App Conversion Tracking and Remarketing API.**
- **No bulk uploads.** No `BatchJobService`.
- **No keyword planning or research tools.**
- **No reach planning or recommendations.**
- **No mass-scanning** of multiple unrelated customer accounts.
- **We never call the API without an active user session and the user's
  own OAuth token.**

If we ever add capabilities outside the read-only video campaign reporting
described above, we will update this document and notify Google via the
API contact email registered in the API Center.

## 4. Data storage and retention

| Data | Where | Retention |
|---|---|---|
| OAuth access token (short-lived, 1h) | Encrypted at rest, AWS KMS-wrapped | Up to expiry. Refreshed on demand. |
| OAuth refresh token | Encrypted at rest, AWS KMS-wrapped | Until user disconnects, then deleted within 24h. |
| Discovered `customer_id` | Encrypted at rest | Until user disconnects. |
| Cached campaign metrics | Encrypted at rest | ≤24h, or until manually invalidated by the user. |
| Aggregate, anonymized usage telemetry (request counts, error rates) | Application logs | 30 days. |

No raw Google Ads data is shared with third parties. No data is used to
train AI or machine-learning models. No data is sold or used for
advertising / remarketing of our own services.

## 5. Security

- TLS everywhere. Plain HTTP is 301-redirected to HTTPS by Caddy.
- TLS certificates issued by Let's Encrypt, auto-renewed.
- The developer token is stored in an environment variable on the EC2
  host, never in source control, never sent to the browser, never logged.
- The OAuth client secret is stored in the same manner.
- Application logs redact authentication headers.
- Access to the EC2 instance is restricted by AWS IAM and SSH keys; no
  shared accounts.
- We follow the Google API Services User Data Policy, including the
  Limited Use requirements.

## 6. Estimated usage

- **Operations per day**: under **1,000** initially. Well below the
  Basic Access cap of 15,000.
- **Pattern**: small number of connected creators, each triggering a
  handful of GAQL queries per dashboard load. Dashboards are typically
  loaded a few times per week per user.
- **No nightly cron jobs**, no batched bulk operations, no scheduled
  multi-account exports.

## 7. User-facing transparency

- The consent screen requests are displayed in the standard Google OAuth
  UI; the user sees the exact scope list before approving.
- The dashboard explicitly shows which Google account is connected (via
  the OIDC userinfo response) and what data has been retrieved.
- Users can revoke our access at any time from
  https://myaccount.google.com/permissions; we surface this link in
  both our consent UI and the dashboard footer.
- Our Privacy Policy and Terms of Service explicitly cover the `adwords`
  scope and the data we read with it.

## 8. Contact

- **API contact email** (registered in API Center):
  `oesteban@camaleonicanalytics.com`
- **Operating entity**: Camaleonic Ads 2020 SL, Spain.

---

*Document last updated: 2026-05-12.*
