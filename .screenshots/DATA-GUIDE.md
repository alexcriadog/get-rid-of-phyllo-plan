# Camaleonic Connect — Data Guide

> **Live explorer:** https://smconnector.camaleonicanalytics.com/data-guide · **How to read it:** [docs/data-guide.md](../docs/data-guide.md)

> What data you actually get when a creator connects each platform. Field-level availability is **measured empirically against real production documents** (connector_ui), not promised — `✅` = the field was populated in at least one real synced document. Generated 2026-06-22.

## Products by platform

Maturity = `production` (offered today). Source: `products.catalog.ts` (single source of truth).

| Platform | Identity | Audience | Engagement | Engagement+ | Stories | Mentions | Comments | Ratings | Ads |
|---|---|---|---|---|---|---|---|---|---|
| YouTube | ✅ | ✅ | ✅ | ✅ |  |  | ✅ |  | ✅ |
| Instagram | ✅ | ✅ | ✅ |  | ✅ |  |  |  |  |
| TikTok | ✅ | ✅ | ✅ |  |  |  | ✅ |  |  |
| Threads | ✅ | ✅ | ✅ |  |  | ✅ | ✅ |  |  |
| Facebook | ✅ | ✅ | ✅ |  | ✅ | ✅ | ✅ | ✅ | ✅ |
| LinkedIn | ✅ | ✅ | ✅ |  |  | ✅ | ✅ |  |  |
| Twitch | ✅ |  | ✅ |  |  |  |  |  |  |

## Identity — fields × platform

_Creator account identity & profile info._

| Field | YouTube | Instagram | TikTok | Threads | Facebook | LinkedIn | Twitch |
|---|---|---|---|---|---|---|---|
| `addresses` |  |  |  |  |  |  |  |
| `category` | ✅ |  |  |  |  |  |  |
| `certifications` |  |  |  |  |  |  |  |
| `country` |  |  |  |  |  |  |  |
| `date_of_birth` |  |  |  |  |  |  |  |
| `education` |  |  |  |  |  |  |  |
| `emails` |  |  |  |  |  |  |  |
| `external_id` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `first_name` |  |  |  |  |  |  |  |
| `full_name` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `gender` |  |  |  |  |  |  |  |
| `honors` |  |  |  |  |  |  |  |
| `image_url` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `introduction` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `is_business` |  |  | ✅ |  | ✅ | ✅ |  |
| `is_verified` |  |  | ✅ | ✅ |  |  |  |
| `last_name` |  |  |  |  |  |  |  |
| `nick_name` |  |  |  |  |  |  |  |
| `phone_numbers` |  |  |  |  |  |  |  |
| `platform_account_type` |  |  | ✅ |  | ✅ | ✅ |  |
| `platform_profile_id` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `platform_profile_name` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `platform_profile_published_at` | ✅ |  |  |  |  |  | ✅ |
| `platform_username` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `projects` |  |  |  |  |  |  |  |
| `publications` |  |  |  |  |  |  |  |
| `reputation.average_click_rate` |  |  |  |  |  |  |  |
| `reputation.average_open_rate` |  |  |  |  |  |  |  |
| `reputation.connection_count` |  |  |  |  |  | ✅ |  |
| `reputation.content_count` | ✅ | ✅ | ✅ |  |  |  |  |
| `reputation.content_group_count` |  |  |  |  |  |  |  |
| `reputation.follower_count` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `reputation.following_count` |  | ✅ | ✅ |  |  |  |  |
| `reputation.like_count` |  |  |  |  |  |  |  |
| `reputation.paid_subscriber_count` |  |  |  |  |  |  |  |
| `reputation.subscriber_count` |  |  |  |  |  |  | ✅ |
| `reputation.watch_time_in_hours` |  |  |  |  |  |  |  |
| `url` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `username` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `volunteer_experiences` |  |  |  |  |  |  |  |
| `website` |  | ✅ |  |  |  | ✅ |  |
| `work_experiences` |  |  |  |  |  |  |  |
| _sample size (docs)_ | _1_ | _5_ | _3_ | _2_ | _2_ | _2_ | _2_ |

## Engagement — fields × platform

_Content items and their engagement metrics._

| Field | YouTube | Instagram | TikTok | Threads | Facebook | LinkedIn | Twitch |
|---|---|---|---|---|---|---|---|
| `audience` |  |  |  |  |  |  |  |
| `audience.age_distribution` |  |  |  |  |  |  |  |
| `audience.audience_types` |  |  | ✅ |  |  |  |  |
| `audience.cities` |  |  |  |  |  |  |  |
| `audience.countries` |  |  | ✅ |  |  |  |  |
| `audience.gender_age_distribution` |  |  |  |  |  |  |  |
| `audience.gender_distribution` |  |  | ✅ |  |  |  |  |
| `authors` |  |  |  |  |  |  |  |
| `collaboration` |  |  |  |  |  |  |  |
| `content_tags` |  |  |  |  |  |  |  |
| `description` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `duration` | ✅ |  |  |  |  |  |  |
| `engagement.additional_info` |  |  |  |  |  |  |  |
| `engagement.additional_info.bio_link_clicked` |  |  |  |  |  |  |  |
| `engagement.additional_info.completion_rate` |  |  | ✅ |  |  |  |  |
| `engagement.additional_info.followers_gained` |  | ✅ | ✅ |  |  |  |  |
| `engagement.additional_info.profile_visits` |  | ✅ | ✅ |  |  |  |  |
| `engagement.additional_info.reels_skip_rate` |  | ✅ |  |  |  |  |  |
| `engagement.additional_info.sticker_interactions` |  |  |  |  |  |  |  |
| `engagement.additional_info.story_navigation` |  |  |  |  |  |  |  |
| `engagement.additional_info.story_replies` |  |  |  |  | ✅ |  |  |
| `engagement.additional_info.total_interactions` |  | ✅ |  |  | ✅ |  |  |
| `engagement.additional_info.unique_media_views` |  |  |  |  | ✅ |  |  |
| `engagement.avg_watch_time_in_sec` |  | ✅ | ✅ |  |  |  |  |
| `engagement.click_count` |  |  |  |  |  | ✅ |  |
| `engagement.comment_count` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| `engagement.dislike_count` |  |  |  |  |  |  |  |
| `engagement.email_click_rate` |  |  |  |  |  |  |  |
| `engagement.email_open_rate` |  |  |  |  |  |  |  |
| `engagement.impression_organic_count` |  |  |  |  |  |  |  |
| `engagement.impression_paid_count` |  |  |  |  |  |  |  |
| `engagement.like_count` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| `engagement.reach_organic_count` |  | ✅ | ✅ |  | ✅ | ✅ |  |
| `engagement.reach_paid_count` |  |  |  |  |  |  |  |
| `engagement.replay_count` |  |  |  |  |  |  |  |
| `engagement.repost_count` |  | ✅ |  |  |  |  |  |
| `engagement.save_count` |  | ✅ | ✅ |  |  |  |  |
| `engagement.share_count` |  | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| `engagement.spam_report_count` |  |  |  |  |  |  |  |
| `engagement.unsubscribe_count` |  |  |  |  |  |  |  |
| `engagement.view_count` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `engagement.watch_time_in_hours` |  | ✅ | ✅ |  |  |  |  |
| `external_id` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `format` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `hashtags` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| `insights` |  |  |  |  |  |  |  |
| `insights.audience_retention` |  |  |  |  |  |  |  |
| `insights.devices` | ✅ |  |  |  |  |  |  |
| `insights.extra.countries` |  |  |  |  |  |  |  |
| `insights.extra.metrics.annotationClickThroughRate` | ✅ |  |  |  |  |  |  |
| `insights.extra.metrics.annotationClicks` | ✅ |  |  |  |  |  |  |
| `insights.extra.metrics.annotationImpressions` | ✅ |  |  |  |  |  |  |
| `insights.extra.metrics.averageViewDuration` | ✅ |  |  |  |  |  |  |
| `insights.extra.metrics.averageViewPercentage` | ✅ |  |  |  |  |  |  |
| `insights.extra.metrics.cardClickRate` | ✅ |  |  |  |  |  |  |
| `insights.extra.metrics.cardClicks` | ✅ |  |  |  |  |  |  |
| `insights.extra.metrics.cardImpressions` | ✅ |  |  |  |  |  |  |
| `insights.extra.metrics.cardTeaserClickRate` | ✅ |  |  |  |  |  |  |
| `insights.extra.metrics.cardTeaserClicks` | ✅ |  |  |  |  |  |  |
| `insights.extra.metrics.cardTeaserImpressions` | ✅ |  |  |  |  |  |  |
| `insights.extra.metrics.comments` | ✅ |  |  |  |  |  |  |
| `insights.extra.metrics.dislikes` | ✅ |  |  |  |  |  |  |
| `insights.extra.metrics.engagedViews` | ✅ |  |  |  |  |  |  |
| `insights.extra.metrics.estimatedMinutesWatched` | ✅ |  |  |  |  |  |  |
| `insights.extra.metrics.likes` | ✅ |  |  |  |  |  |  |
| `insights.extra.metrics.shares` | ✅ |  |  |  |  |  |  |
| `insights.extra.metrics.subscribersGained` | ✅ |  |  |  |  |  |  |
| `insights.extra.metrics.subscribersLost` | ✅ |  |  |  |  |  |  |
| `insights.extra.metrics.videosAddedToPlaylists` | ✅ |  |  |  |  |  |  |
| `insights.extra.metrics.videosRemovedFromPlaylists` | ✅ |  |  |  |  |  |  |
| `insights.extra.metrics.views` | ✅ |  |  |  |  |  |  |
| `insights.likes_timeline` |  |  | ✅ |  |  |  |  |
| `insights.retention_curve` |  |  | ✅ |  |  |  |  |
| `insights.sharing` |  |  |  |  |  |  |  |
| `insights.traffic_sources` | ✅ |  | ✅ |  |  |  |  |
| `insights.viewer_demographics` |  |  |  |  |  |  |  |
| `insights.viewer_types` |  |  | ✅ |  |  |  |  |
| `is_owned_by_platform_user` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `media_url` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `media_urls` |  | ✅ |  | ✅ | ✅ | ✅ |  |
| `mentions` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |  |
| `persistent_thumbnail_url` |  |  |  |  |  |  |  |
| `platform` |  |  |  |  |  |  |  |
| `platform_profile_id` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `platform_profile_name` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `published_at` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `sponsored` |  |  |  |  |  |  |  |
| `thumbnail_url` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `title` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `type` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `url` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `visibility` | ✅ |  |  |  |  | ✅ | ✅ |
| _sample size (docs)_ | _8_ | _986_ | _74_ | _44_ | _69_ | _112_ | _2_ |

## Audience — fields × platform

_Aggregated audience demographics (countries, cities, gender x age)._

| Field | YouTube | Instagram | TikTok | Threads | Facebook | LinkedIn |
|---|---|---|---|---|---|---|
| `age_distribution` |  | ✅ |  |  |  |  |
| `cities` |  | ✅ |  |  |  |  |
| `countries` |  | ✅ |  |  |  | ✅ |
| `gender_age_distribution` |  |  |  |  |  |  |
| `gender_distribution` |  | ✅ |  |  |  |  |
| _sample size (docs)_ | _1_ | _5_ | _3_ | _2_ | _2_ | _2_ |

## Comments — fields × platform

_Comments and commenters on the creator's content._

| Field | TikTok | Threads | Facebook | LinkedIn |
|---|---|---|---|---|
| `commenter_display_name` | ✅ |  | ✅ |  |
| `commenter_id` |  |  |  |  |
| `commenter_profile_url` |  |  |  |  |
| `commenter_username` | ✅ | ✅ | ✅ | ✅ |
| `content.id` | ✅ | ✅ | ✅ | ✅ |
| `content.published_at` |  |  |  |  |
| `content.url` |  |  |  |  |
| `external_id` | ✅ | ✅ | ✅ | ✅ |
| `like_count` |  |  | ✅ |  |
| `reply_count` |  |  | ✅ |  |
| `text` | ✅ | ✅ | ✅ | ✅ |
| _sample size (docs)_ | _19_ | _10_ | _20_ | _12_ |

---

**Honesty notes.** Availability is empirical: a blank cell means the field was *not populated* in the sampled production documents for that platform — it may be genuinely unsupported, or simply absent for the sampled accounts (small samples per platform). A curation layer marks supported-but-unsampled fields. Sample sizes are shown per matrix.
