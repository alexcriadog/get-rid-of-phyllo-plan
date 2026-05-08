# IG empirical probe results

Generated: 2026-05-08T10:11:21.215Z
IG User: `17841450633103215` (Camaleonic Analytics, account id=2)
Graph version: `v22.0`
Token scopes (from connect-tool): `pages_show_list, pages_read_engagement, pages_read_user_content, ads_read, business_management, instagram_basic, instagram_manage_insights, read_insights`

Source: `poc/scripts/probe-ig-fields.ts`. Each row is one isolated Graph call.
Phase B/C lists in the implementation plan are filtered against this output —
anything in **ERROR** or universal **SILENT_EMPTY** is dropped or moved to `extra`.

## Plan filtering decision (TL;DR)

### ✅ Phase B confirmed adds (Meta accepts in wire)

**B.1 Profile** — add to `instagram-profile.fetcher.ts:30`:
- `is_published`, `has_profile_pic`, `legacy_instagram_user_id`
- ❌ `shopping_product_tag_eligibility` returns `(#10) permission` — needs scope we don't have. Drop.

**B.2 Per-media fields** — add to `instagram-content.fetcher.ts:59`:
- `shares_count`, `reposts_count`, `saved_count`, `total_like_count`, `total_comments_count`, `total_views_count`, `boost_ads_list`, `boost_eligibility_info`, `legacy_instagram_media_id`
- ❌ `view_count` — `(#36104) outside Business Discovery API only`. Drop.
- ❌ `branded_content_partner` — `(#100) nonexisting field`. Meta retired. Drop.
- ⚠️ `copyright_check_information` — only valid for video media (returned `(#9005) Video content was not found` on a CAROUSEL probe). Re-probe against a real VIDEO/REELS to confirm before adding.

**B.3 Per-media insight metrics** — add to `IG_MEDIA_METRICS`:
- REELS only: `ig_reels_avg_watch_time`, `ig_reels_video_view_total_time`, `reels_skip_rate`
- ❌ `facebook_views` — `(#-1) Fatal` server error on both FEED and REELS. Drop.
- ❌ `crossposted_views` — `(#100) not supported for this media product type`. Drop.
- ✅ `views` on FEED — works! Today the spec restricts `views` to VIDEO/REELS but FEED CAROUSEL returned `views=120`. **Update `IG_MEDIA_METRICS` to include FEED in `views.appliesTo`**.

### ❌ Phase C — both rejected, plan needs rethink

- `views × follow_type` → `(#100) Incompatible breakdowns (follow_type) for metric (views)`
- `reach × follow_type` → idem
- `views × media_product_type` → `(#100) breakdown[0] must be one of: follow_type, surface_type, action_type, story_navigation_action_type` (so `media_product_type` is invalid)
- `profile_activity × action_type` (account-level) → `(#100) profile_activity not in valid metric list`. Account-level metric was retired or never existed at this granularity — `profile_links_taps × contact_button_type` (already implemented) is the working substitute.
- `online_followers × period=week` → `(#100) periods (week) are incompatible`. Stays at `period=lifetime`.

**Phase C action**: do NOT implement breakdowns as currently scoped. Future re-probe should test `surface_type` (Meta's own error message lists it as valid) on per-media metrics — that's a credible new breakdown to evaluate before committing Phase C.

### Sample success values (sanity check that fields are real)

- `views` on a FEED CAROUSEL post: 120
- `reach` on a REELS post: 763, `views`: 888, `total_interactions`: 13
- `ig_reels_avg_watch_time`: 6,524 (ms?), `ig_reels_video_view_total_time`: 5,128,546 (ms), `reels_skip_rate`: 48.4 (%)
- `boost_eligibility_info`: `{"eligible_to_boost": true}`
- `legacy_instagram_user_id`: 4272703712836092 (different from the v2 IG-Business id 17841450633103215)

---

## Profile fields (/{ig-user})

| Field / Metric | Endpoint | Result | HTTP | Sample / Error |
|---|---|---|---|---|
| `id` | `/17841450633103215` | ✗ #2500 | 400 | Syntax error "Field id specified more than once. This is only possible before version 2.1" at character 5: id,id |
| `username` | `/17841450633103215` | ✓ OK | 200 | camaleonicanalytics |
| `name` | `/17841450633103215` | ✓ OK | 200 | Camaleonic Analytics |
| `biography` | `/17841450633103215` | ✓ OK | 200 | The most advanced Artificial Intelligence tool on sponsorship analysis. Track… |
| `profile_picture_url` | `/17841450633103215` | ✓ OK | 200 | https://scontent-iad3-2.xx.fbcdn.net/v/t51.2885-15/409642541_1510036006436302… |
| `followers_count` | `/17841450633103215` | ✓ OK | 200 | 419 |
| `follows_count` | `/17841450633103215` | ✓ OK | 200 | 112 |
| `media_count` | `/17841450633103215` | ✓ OK | 200 | 306 |
| `website` | `/17841450633103215` | ✓ OK | 200 | https://linktr.ee/camaleonic |
| `is_published` | `/17841450633103215` | ✓ OK | 200 | true |
| `has_profile_pic` | `/17841450633103215` | ✓ OK | 200 | true |
| `shopping_product_tag_eligibility` | `/17841450633103215` | ✗ #10 | 400 | (#10) Application does not have permission for this action |
| `legacy_instagram_user_id` | `/17841450633103215` | ✓ OK | 200 | 4272703712836092 |

## Per-media fields (/{media})

| Field / Metric | Endpoint | Result | HTTP | Sample / Error |
|---|---|---|---|---|
| `caption` | `/17959783845106192` | ✓ OK | 200 | Who owns #ElClásico on social media? 🔥   With the May 10 clash around the co… |
| `media_type` | `/17959783845106192` | ✓ OK | 200 | CAROUSEL_ALBUM |
| `media_url` | `/17959783845106192` | ✓ OK | 200 | https://scontent-iad6-1.cdninstagram.com/v/t39.30808-6/690642382_989495080255… |
| `permalink` | `/17959783845106192` | ✓ OK | 200 | https://www.instagram.com/p/DYCdDzPjXGK/ |
| `timestamp` | `/17959783845106192` | ✓ OK | 200 | 2026-05-07T13:00:34+0000 |
| `thumbnail_url` | `/17959783845106192` | ⊘ EMPTY | 200 | (field absent) |
| `like_count` | `/17959783845106192` | ✓ OK | 200 | 9 |
| `comments_count` | `/17959783845106192` | ✓ OK | 200 | 0 |
| `is_shared_to_feed` | `/17959783845106192` | ⊘ EMPTY | 200 | (field absent) |
| `is_comment_enabled` | `/17959783845106192` | ✓ OK | 200 | true |
| `alt_text` | `/17959783845106192` | ⊘ EMPTY | 200 | (field absent) |
| `media_product_type` | `/17959783845106192` | ✓ OK | 200 | FEED |
| `shortcode` | `/17959783845106192` | ✓ OK | 200 | DYCdDzPjXGK |
| `owner{id,username}` | `/17959783845106192` | ✓ OK | 200 | {"id":"17841450633103215","username":"camaleonicanalytics"} |
| `collaborators{id,username}` | `/17959783845106192` | ⊘ EMPTY | 200 | (field absent) |
| `children{id,media_type,media_url,thumbnail_url,permalink}` | `/17959783845106192` | ✓ OK | 200 | {"data":[{"id":"17888291427520607","media_type":"IMAGE","media_url":"https://sco |
| `shares_count` | `/17959783845106192` | ✓ OK | 200 | 0 |
| `reposts_count` | `/17959783845106192` | ✓ OK | 200 | 0 |
| `saved_count` | `/17959783845106192` | ✓ OK | 200 | 0 |
| `total_like_count` | `/17959783845106192` | ✓ OK | 200 | 9 |
| `total_comments_count` | `/17959783845106192` | ✓ OK | 200 | 0 |
| `total_views_count` | `/17959783845106192` | ⊘ EMPTY | 200 | (field absent) |
| `view_count` | `/17959783845106192` | ✗ #36104 | 400 | (#36104) You do not have permission to access this field outside of the Business Discovery API. |
| `boost_ads_list` | `/17959783845106192` | ⊘ EMPTY | 200 | (field absent) |
| `boost_eligibility_info` | `/17959783845106192` | ✓ OK | 200 | {"eligible_to_boost":true} |
| `copyright_check_information` | `/17959783845106192` | ✗ #9005/1452042 | 400 | Video content was not found. |
| `legacy_instagram_media_id` | `/17959783845106192` | ✓ OK | 200 | 35633583172952785 |
| `branded_content_partner` | `/17959783845106192` | ✗ #100 | 400 | (#100) Tried accessing nonexisting field (branded_content_partner) |

## Per-media insights — FEED

| Field / Metric | Endpoint | Result | HTTP | Sample / Error |
|---|---|---|---|---|
| `reach` | `/17959783845106192/insights` | ✓ OK | 200 | 43 |
| `saved` | `/17959783845106192/insights` | ✓ OK | 200 | 0 |
| `likes` | `/17959783845106192/insights` | ✓ OK | 200 | 9 |
| `comments` | `/17959783845106192/insights` | ✓ OK | 200 | 0 |
| `shares` | `/17959783845106192/insights` | ✓ OK | 200 | 0 |
| `total_interactions` | `/17959783845106192/insights` | ✓ OK | 200 | 9 |
| `follows` | `/17959783845106192/insights` | ✓ OK | 200 | 0 |
| `profile_visits` | `/17959783845106192/insights` | ✓ OK | 200 | 0 |
| `views` | `/17959783845106192/insights` | ✓ OK | 200 | 120 |
| `facebook_views` | `/17959783845106192/insights` | ✗ #-1/2207086 | 400 | Fatal |
| `crossposted_views` | `/17959783845106192/insights` | ✗ #100 | 400 | (#100) The Media Insights API does not support the crossposted_views metric for this media product type. |

## Per-media insights — REELS

| Field / Metric | Endpoint | Result | HTTP | Sample / Error |
|---|---|---|---|---|
| `reach` | `/18246395218306388/insights` | ✓ OK | 200 | 763 |
| `saved` | `/18246395218306388/insights` | ✓ OK | 200 | 0 |
| `likes` | `/18246395218306388/insights` | ✓ OK | 200 | 11 |
| `comments` | `/18246395218306388/insights` | ✓ OK | 200 | 0 |
| `shares` | `/18246395218306388/insights` | ✓ OK | 200 | 2 |
| `total_interactions` | `/18246395218306388/insights` | ✓ OK | 200 | 13 |
| `views` | `/18246395218306388/insights` | ✓ OK | 200 | 888 |
| `ig_reels_avg_watch_time` | `/18246395218306388/insights` | ✓ OK | 200 | 6524 |
| `ig_reels_video_view_total_time` | `/18246395218306388/insights` | ✓ OK | 200 | 5128546 |
| `reels_skip_rate` | `/18246395218306388/insights` | ✓ OK | 200 | 48.4 |
| `facebook_views` | `/18246395218306388/insights` | ✗ #-1/2207086 | 400 | Fatal |
| `crossposted_views` | `/18246395218306388/insights` | ✗ #-1/2207086 | 400 | Fatal |

## Per-media breakdowns — FEED

| Field / Metric | Endpoint | Result | HTTP | Sample / Error |
|---|---|---|---|---|
| `views × follow_type` | `/17959783845106192/insights` | ✗ #100 | 400 | (#100) Incompatible breakdowns (follow_type) for metric (views) |
| `reach × follow_type` | `/17959783845106192/insights` | ✗ #100 | 400 | (#100) Incompatible breakdowns (follow_type) for metric (reach) |

## Per-media breakdowns — REELS

| Field / Metric | Endpoint | Result | HTTP | Sample / Error |
|---|---|---|---|---|
| `views × follow_type` | `/18246395218306388/insights` | ✗ #100 | 400 | (#100) Incompatible breakdowns (follow_type) for metric (views) |
| `reach × follow_type` | `/18246395218306388/insights` | ✗ #100 | 400 | (#100) Incompatible breakdowns (follow_type) for metric (reach) |
| `views × media_product_type` | `/18246395218306388/insights` | ✗ #100 | 400 | (#100) breakdown[0] must be one of the following values: follow_type, surface_type, action_type, story_navigation_action_type |

## Account-level new probes

| Field / Metric | Endpoint | Result | HTTP | Sample / Error |
|---|---|---|---|---|
| `profile_activity × action_type (period=day)` | `/17841450633103215/insights` | ✗ #100 | 400 | (#100) metric[0] must be one of the following values: reach, follower_count, website_clicks, profile_views, online_followers, accounts_engaged, total_interactions, likes, comments, shares, saves, replies, engaged_audience_demographics, reached_audience_demographics, follower_demographics, follows_and_unfollows, profile_links_taps, views, threads_likes, threads_replies, reposts, quotes, threads_followers, threads_follower_demographics, content_views, threads_views, threads_clicks, threads_reposts |
| `online_followers (period=week)` | `/17841450633103215/insights` | ✗ #100 | 400 | (#100) The following periods (week) are incompatible with the metric (online_followers) |

## Summary

- ✓ OK: **49**
- ⊘ Silent empty: **6**
- ✗ Errors: **16**
- Total probes: 71
