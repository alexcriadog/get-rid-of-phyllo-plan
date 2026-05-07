# TikTok Ads (Marketing API) — TODO / not yet implemented

Status: **planned**. Tracked here so we don't lose the architecture
decision; ship when the first customer with active TikTok ad campaigns
lands. The trigger entry lives in `docs/TODO.md`; this file holds the
implementation detail.

## Decision: model as a **separate platform**, not a new product

The existing `tiktok` platform (Login Kit / Display API) covers organic
creator data — profile, follower stats, video list, engagement counts,
comments. It does NOT cover advertising data. To serve customers who
also run paid TikTok campaigns we need access to TikTok's Marketing API
(BC), which is a genuinely separate API surface with its own OAuth flow,
its own token, its own ID space, and its own data schema.

We model that as a new platform key `tiktok_ads`, NOT as an `ads`
product on the existing `tiktok` platform.

### Why platform, not product

| Constraint | Why it forces "new platform" |
|---|---|
| Different OAuth host | `business-api.tiktok.com/portal/auth` (separate consent screen, separate token endpoint at `business-api.tiktok.com/open_api/v1.3/oauth2/access_token/`). Cannot be enabled by ticking a product checkbox on an existing tiktok account row. |
| Different identifier topology | Login Kit returns one `open_id`; BC returns N `advertiser_ids`. A brand may run campaigns through 3 ad accounts — that's 3 connections, not 1 product. |
| Different schema | Organic = identity/audience/engagement/stories/comments. Ads = campaigns / ad sets / ads / creatives / spend / impressions / CPC / CPM / conversions / audience reports. Forcing them into a shared product slot dilutes the abstraction. |
| Different ID spaces don't cross | `open_id` (Login Kit) and `identity_id` (BC) refer to different views of the same person, but the graphs are not joined. Each side's queries are scoped to its own ID. |
| Industry precedent | Sprout Social, Hootsuite, HubSpot all expose two distinct TikTok integrations. Phyllo's "single login" was Login Kit only — it never had real ad data behind that one OAuth. |

## Pricing / packaging implication

- Platform-level SKUs in the contract: `tiktok` and `tiktok_ads` are
  priced separately. Customer with only organic content pays one;
  customer with both pays both.
- Inside each platform, products remain a-la-carte (identity, audience,
  campaigns, ad_insights, etc.) so partial purchases stay possible.
- A single "Nike" entity in the customer's dashboard can visually
  merge a `tiktok` row and a `tiktok_ads` row sharing the same
  display_name — a UI/data-aggregation concern that does not push
  back into the data model.

## Implementation outline (when greenlit)

### Backend

1. Add `tiktok_ads` to the `Platform` enum / union.
2. Add a new `TiktokAdsModule` with:
   - `TiktokAdsAdapter` (PlatformAdapter implementation)
   - Fetchers: `tiktok-ads-campaigns.fetcher.ts`,
     `tiktok-ads-insights.fetcher.ts`,
     `tiktok-ads-creatives.fetcher.ts`,
     `tiktok-ads-audience.fetcher.ts` (paid-audience reports)
   - Rate-limit strategy port (BC v1.3 BUC headers)
   - Token refresh handler (BC tokens are 24h short-lived; refresh
     tokens last 365d)
3. New product set in `PRODUCTS_BY_PLATFORM.tiktok_ads`:
   `identity`, `campaigns`, `ad_insights`, `ad_creatives`,
   `audience_demographics_paid`.
4. `AccountsService.seedAccount` already accepts arbitrary
   `metadata.products[]` — no changes needed there.
5. New seed metadata fields on the `tiktok_ads` Account row:
   `advertiser_ids[]`, `bc_id`, `core_user_id` (BC user).
6. Support multi-row seed: a single OAuth granting access to N
   advertisers should produce N `tiktok_ads` Account rows (one per
   advertiser_id), all linked by `metadata.bc_id`.

### Connect-tool

1. Second platform tile `tiktok_ads` in `lib/platforms.ts` with its own
   `PlatformDef` (BC OAuth start, BC token exchange).
2. Visual: group `tiktok` and `tiktok_ads` under one "TikTok" header in
   the tile grid (UI-only concern) so customers see "TikTok →
   Profile / Ads" rather than two unrelated tiles.
3. Confirm screen shows discovered advertiser_ids and lets the
   customer pick which to seed (mirrors the existing FB page picker).

### POC adapter scope (data we'll fetch with BC token)

- `/campaign/get/?advertiser_id=…` — list campaigns
- `/adgroup/get/?advertiser_id=…` — list ad groups
- `/ad/get/?advertiser_id=…` — list ads
- `/report/integrated/get/` — campaign / ad / ad-set insights with
  metrics (spend, impressions, clicks, CTR, CPC, CPM, conversions,
  cost_per_conversion, conversion_rate)
- `/report/audience/get/` — paid audience demographics (this IS
  available on BC, unlike organic where TikTok hides it)
- `/identity/get/?advertiser_id=…&identity_type=BC_AUTH_TT` — Spark
  Ads identity lookup; useful for joining ad performance back to
  organic post IDs.

### Auth-management notes

- BC token expires after 24h; refresh token after 365d. Implement
  proactive refresh in `TokenManagerService` (mirrors existing IG /
  YT refresh patterns).
- Multiple advertisers per OAuth → store the master `bc_id` once and
  fan out per-advertiser fetches.

## What we explicitly do NOT do here

- We do NOT try to consolidate Login Kit + BC under a single tile or
  single Account row. Two OAuths, two rows, two SKUs. Joining them is
  a presentation-layer job in the customer dashboard.
- We do NOT use BC for organic data. The `/business/get/` endpoints
  the legacy code referenced are not real / not in TikTok's official
  SDK. Organic stays on Login Kit.

## References

- TikTok Marketing API Postman:
  https://www.postman.com/tiktok/tiktok-api-for-business/documentation/efqhadc/tiktok-business-api-v1-3
- Display API overview:
  https://developers.tiktok.com/doc/display-api-overview
- TikTok Business API SDK:
  https://github.com/tiktok/tiktok-business-api-sdk
