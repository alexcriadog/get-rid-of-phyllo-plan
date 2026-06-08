# Phyllo "Authenticated APIs Data Guide" — Study

Source: public Airtable shared by Phyllo
(`https://airtable.com/appzUnJ2y5rmmTShH/shrwEMTWlgECOUhre/tbl1UKPTVMMno7qf7/viwm7iMn6QNHLJGJ8`).
Full raw export: `.screenshots/phyllo-airtable-full.json` · rendered tables: `.screenshots/phyllo-airtable-digest.md` (fetched 2026-06-05).

## What it is

A customer-facing **data availability guide**: for every platform and every product,
exactly which normalized fields Phyllo returns. It is the answer to the #1
pre-sales/integration question: *"if my creator connects platform X, what data do I
actually get?"* — without reading API docs per platform.

## Structure (13 tables)

### 1. `Products` — the master matrix (30 platforms)

One row per platform, one column per product. Cell value = maturity tag
(`production` / blank = not available). Plus a `Category` select
(Social / Commerce / Publishing).

Products (columns): **Identity, Engagement, Audience demographics, Comments,
Income, Publish**.

Highlights of their coverage:

| Platform | Identity | Engagement | Audience | Comments | Income | Publish |
|---|---|---|---|---|---|---|
| YouTube | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Instagram | ✅ | ✅ | ✅ | ✅ | — | — |
| IG Direct | ✅ | ✅ | ✅ | ✅ | — | — |
| TikTok | ✅ | ✅ | ✅ | — | — | ✅ |
| Facebook | ✅ | ✅ | ✅ | — | — | — |
| Twitter / Twitch / Substack | ✅ | ✅ | — | — | — | — |
| LinkedIn / Adsense / Spotify Podcasts / Beehiv | ✅ (some +1 more) | | | | | |
| ~15 more (Pinterest, Discord, Reddit, Shopify, Etsy, Stripe, Patreon, …) | listed but **no products in production** | | | | | |

Note: more than half the platforms listed have *zero* production products — the
matrix doubles as a roadmap/marketing surface ("we know about these platforms").

### 2. Per-product field dictionaries (the core value)

One table per product. Rows = **normalized field names** (their unified schema,
dot-notation, e.g. `reputation.follower_count`, `engagement.like_count`),
columns = **one checkbox per platform**. Each field has a human description.

- **Identity** (44 fields × 25 platforms): `platform_username`, `full_name`, `url`,
  `image_url`, `external_id`, `is_verified`, `is_business`,
  `reputation.follower_count|following_count|subscriber_count|content_count|watch_time_in_hours`,
  `emails.*`, `phone_numbers.*`, `addresses.*`, `platform_profile_id|name|published_at`, …
  Several rows have no checkboxes at all (planned fields: `work_experiences`,
  `education`, `publications`, `reputation.paid_subscriber_count`, newsletter
  open/click rates …).
- **Engagement** (48 fields × 18 platforms): content-item level. `title`, `format`
  (VIDEO/IMAGE/AUDIO/TEXT), `type` (REELS/STORY/TWEET/…), `url`, `media_url`
  (signed, short-lived — explicitly documented as such), `persistent_thumbnail_url`
  (**their own cached, long-lived re-host** of the thumbnail), `published_at`,
  `engagement.like_count|comment_count|view_count|share_count|save_count|watch_time…`,
  `hashtags`, `mentions`, `visibility`, `sponsored.*`, `collaboration.*`.
- **Audience** (7 fields × 5 platforms): aggregated only — `countries.code/value`,
  `cities.name/value`, `gender_age_distribution.gender/age_range/value`
  (percentages). Only YouTube, Instagram, TikTok, Facebook, IG Direct.
- **Comments** (11 fields × 3 platforms): YouTube, Instagram, IG Direct.
  `text`, `commenter_id/username/display_name/profile_url`, `like_count`,
  `reply_count`, `content.id/url/published_at`. Notably sparse — IG only gets
  `text` + ids.
- **Income** — split into 5 tables: Social-Transactions (YT/FB/Twitch: `amount`,
  `type` AD/SUBSCRIPTION, `cpm`…), Social-Payouts (Adsense), Commerce-Balances /
  -Transactions / -Payouts (Shopify, Etsy, Stripe, FB Commerce, Gumroad) with
  `status`, `payout_interval`, `bank_details.*`.
- **Publish** (12 request fields × TikTok/YouTube/Instagram): write API —
  `title`, `description`, `type`, `visibility`, `retry`,
  `media.media_type/source_media_url/source_thumbnail_url/thumbnail_offset`,
  `additional_info.share_to_feed` (IG).
- **Activity** (Spotify only): top/recent/saved artists & tracks.

### 3. `Platform Token Validity` (8 platforms)

Operational reference: access-token lifetime + whether refresh token exists +
exception notes ("can be invalidated by password change / permission revocation").
E.g. YouTube 60 min (refresh ✅), Instagram/Facebook/IG Direct 60 days (no refresh
token, long-lived token), TikTok 24 h (refresh ✅), Twitch 4 h (refresh ✅),
LinkedIn 2 months (refresh ✅).

## Patterns worth copying

1. **Field-level availability is the product.** Not "we support Instagram" but
   "on Instagram you get `follower_count` but not `subscriber_count`". Checkbox
   matrix per normalized field × platform.
2. **One unified schema, dot-notation field names** shared across platforms;
   the matrix documents per-platform gaps instead of per-platform schemas.
3. **Maturity tags** (`production` etc.) on the platform × product matrix —
   communicates roadmap without promising dates.
4. **Honest operational metadata**: token validity table, signed-URL expiry
   caveats, `persistent_thumbnail_url` as the documented mitigation.
5. **Aspirational rows/platforms included but unchecked** — the guide doubles as
   roadmap and SEO/pre-sales surface.
6. **Live shared Airtable** = zero-cost publishing, always current, filterable
   by the customer. (We could equally render it from our own catalog.)

## Mapping to our project

We already have the machine-readable core: `poc/src/modules/accounts/products.catalog.ts`
(PLATFORM_CATALOG = platforms × products × scopes, single source of truth, served at
`GET /internal/products-catalog`). What we **don't** have is the Phyllo-style
customer-facing layer:

| Phyllo artifact | Our equivalent today | Gap |
|---|---|---|
| Products matrix (platform × product × maturity) | `products.catalog.ts` (boolean availability only) | no maturity tag, no human-facing rendering |
| Per-product field dictionaries | implicit in normalizers / Mongo docs per platform | not documented anywhere; no field × platform matrix |
| Token validity table | scattered in docs/platform notes + refresh cron | not consolidated |
| Publish guide | n/a (read-only product) | n/a |

A natural implementation for us:

1. Extend the catalog with `status: 'production' | 'beta' | 'planned'` per
   platform × product.
2. Add a **field-availability map** per product: normalized field name →
   description → platforms that emit it (derivable by introspecting our
   normalizers, then hand-curated).
3. Render it: a public/embeddable "Data Guide" page (dashboard or docs site)
   generated from the catalog — our equivalent of this Airtable, but always in
   sync with the code.
4. Consolidate a token-validity/ops table (we already know the numbers from the
   refresh cron work).

No code changed yet — this document is the study deliverable.
