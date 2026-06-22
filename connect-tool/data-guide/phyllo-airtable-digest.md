## Products — Phyllo Products
Columns: Platform (text), Identity (multiSelect), Engagement (multiSelect), Audience demographics (multiSelect), Comments (multiSelect), Income (multiSelect), Category (select), Publish (multiSelect)

| Platform | Identity | Engagement | Audience demographics | Comments | Income | Category | Publish |
|---|---|---|---|---|---|---|---|
| YouTube | production | production | production | production | production | Social | production |
| Instagram | production | production | production | production |  | Social |  |
| TikTok | production | production | production |  |  | Social | production |
| Twitter | production | production |  |  |  | Social |  |
| Twitch | production | production |  |  |  | Social |  |
| Facebook | production | production | production |  |  | Social |  |
| Pinterest |  |  |  |  |  | Social |  |
| Substack | production | production |  |  |  | Social |  |
| Discord |  |  |  |  |  | Social |  |
| Shopify |  |  |  |  |  | Commerce |  |
| Etsy |  |  |  |  |  | Commerce |  |
| Stripe |  |  |  |  |  | Commerce |  |
| Reddit |  |  |  |  |  | Social |  |
| LinkedIn | production |  |  |  |  | Social |  |
| Patreon |  |  |  |  |  | Social |  |
| Spotify |  |  |  |  |  | Social |  |
| Facebook Commerce |  |  |  |  |  | Commerce |  |
| Adsense | production |  |  |  | production | Social |  |
| Gumroad |  |  |  |  |  | Commerce |  |
| Medium |  |  |  |  |  | Social |  |
| Ghost |  |  |  |  |  | Social |  |
| Trovo |  |  |  |  |  | Social |  |
| AfreecaTV |  |  |  |  |  | Social |  |
| Spotify Podcasts | production |  |  |  |  | Publishing |  |
| Beehiv | production | production |  |  |  | Publishing |  |
| Soundcloud |  |  |  |  |  | Social |  |
| Lemon8 |  |  |  |  |  | Social |  |
| OnlyFans |  |  |  |  |  | Social |  |
| Snapchat |  |  |  |  |  | Social |  |
| IG Direct | production | production | production | production |  | Social |  |

## Identity — Identity API contains information about creator's account identity and profile info from a connected creator platform.
Columns: Field Name (text), Description (multilineText), YouTube (checkbox), Instagram (checkbox), TikTok (checkbox), Twitter (checkbox), Twitch (checkbox), Facebook (checkbox), Pinterest (checkbox), Substack (checkbox), Discord (checkbox), Reddit (checkbox), LinkedIn (checkbox), Patreon (checkbox), Spotify (checkbox), Adsense (checkbox), Facebook Commerce (checkbox), Gumroad (checkbox), Medium (checkbox), Shopify (checkbox), Etsy (checkbox), Stripe (checkbox), Ghost (checkbox), Trovo (checkbox), AfreecaTV (checkbox), Snapchat (checkbox), IG Direct (checkbox)

| Field Name | Description | YouTube | Instagram | TikTok | Twitter | Twitch | Facebook | Pinterest | Substack | Discord | Reddit | LinkedIn | Patreon | Spotify | Adsense | Facebook Commerce | Gumroad | Medium | Shopify | Etsy | Stripe | Ghost | Trovo | AfreecaTV | Snapchat | IG Direct |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| platform_username | Username of the connected account. This is used to uniquely identify a user on any platform and usually the name that is present in the URLs, used to tag a user etc.  Ex - For YouTube, it's the channel name in the URL and for Instagram / Twitter / TikTok etc, it's the handle. | true | true | true | true | true | true | true | true | true | true | true | true |  | true | true | true | true | true | true | true | true | true | true | true | true |
| full_name | Full name of the user profile. | true | true | true | true | true | true |  |  | true | true |  | true | true | true | true | true | true |  |  |  | true |  |  | true | true |
| first_name | First name of the user profile. | true |  |  |  |  | true |  |  |  |  | true | true |  |  | true |  |  |  |  |  |  |  |  |  |  |
| last_name | Last name of the user profile. | true |  |  |  |  | true |  |  |  |  | true | true |  |  | true |  |  |  |  |  |  |  |  |  |  |
| nick_name | Nickname of the user profile. | true |  |  |  |  | true |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | true | true |  |  |
| url | Profile URL on the connected platform. | true | true | true | true | true | true | true | true |  | true |  | true |  |  | true | true | true | true | true |  | true | true |  | true | true |
| introduction | Description of the profile.  Ex - For Instagram it's the bio and for YouTube it's the channel introduction. | true | true | true | true | true | true | true | true | true | true |  | true |  |  | true | true | true |  |  |  | true | true | true | true | true |
| image_url | URL of the profile image on the platform. | true | true | true | true | true | true |  | true | true | true | true | true |  |  | true |  |  |  | true |  | true | true | true | true | true |
| date_of_birth | Date of birth of the user on the platform. | true |  |  |  |  |  |  |  |  |  |  |  | true |  | true |  |  |  |  |  |  |  | true |  |  |
| external_id | Unique identifier of the profile on the platform. | true | true | true | true | true | true |  |  |  | true | true | true | true | true | true | true | true | true | true | true | true | true | true | true | true |
| platform_account_type | Account type of the user on the platform. |  |  |  |  | true |  | true | true |  | true |  |  |  |  |  |  | true | true | true | true |  |  |  | true | true |
| category | Category of the user's platform account.  Ex - For Instagram it's the page type which could be beauty, fitness etc |  |  |  |  |  | true |  |  |  |  |  | true |  |  | true |  |  | true | true | true |  |  |  | true |  |
| website | User website listed on the platform. |  | true | true | true |  | true | true |  |  |  |  |  |  |  | true |  |  | true | true | true | true |  |  | true | true |
| reputation.follower_count | Total number of followers of this profile. |  | true | true | true | true | true |  |  |  |  | true |  |  |  | true |  | true |  |  |  |  | true | true |  | true |
| reputation.following_count | Total number of profiles this profile is following. |  | true | true | true | true |  |  |  |  |  |  |  |  |  |  |  | true |  |  |  |  |  |  |  | true |
| reputation.subscriber_count | Total number of subscribers. | true |  |  |  | true |  |  | true |  | true |  | true |  |  |  |  |  |  |  |  |  | true | true | true |  |
| reputation.content_count | Total number of content items (videos, images, posts etc). | true | true | true | true |  |  |  |  |  |  |  | true |  |  |  |  | true |  |  |  |  | true |  |  | true |
| reputation.content_group_count | Total number of content group items (playlists, albums, collections etc). |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| reputation.watch_time_in_hours | Total watch time in hours. |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | true |  |  |
| emails.type | Type of the email ID. - WORK / OTHER / HOME  | true |  |  |  |  |  |  |  |  |  |  |  | true | true |  |  |  |  |  |  |  |  |  |  |  |
| emails.email_id | Email ID of the user. | true |  |  |  | true | true |  | true | true |  | true | true | true | true | true | true | true | true | true | true | true | true | true | true |  |
| phone_numbers.type | Type of the phone number. | true |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| phone_numbers.id | Phone number of the user. | true |  |  |  |  |  |  |  |  |  |  |  |  |  | true |  |  | true | true | true |  |  |  | true |  |
| addresses.type | Type of the address. - WORK / OTHER / HOME   | true |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| addresses .address | Address of the user. | true |  |  | true |  |  |  |  |  |  |  | true |  |  | true |  |  | true | true | true |  |  |  | true |  |
| country | Country of the user on the connected platform. |  |  |  | true |  | true |  |  |  |  |  | true | true |  | true |  | true |  |  |  | true |  | true |  |  |
| gender | Gender of the user. | true |  |  |  |  |  |  |  |  |  |  | true |  |  | true |  |  |  |  |  |  |  | true |  |  |
| platform_profile_name | User's profile name on the work platform. This is not unique, is displayed prominently on the profile, usually editable and is most commonly associated with that user's identity on the platform.  Ex - For YouTube, it's the channel name displayed on the channel page and for Instagram / Twitter / TikTok etc, it's the name displayed on the user's profile page. | true | true | true | true | true | true | true |  | true | true | true | true | true | true | true | true | true | true | true | true | true | true | true |  | true |
| platform_profile_id | Unique profile ID of the user on the work platform.  Ex - For YouTube it's the channel ID and for Instagram it's the Instagram page ID. | true | true | true | true | true | true | true |  | true | true | true | true | true | true | true | true | true | true | true | true | true | true | true |  | true |
| platform_profile_published_at | Timestamp when the profile was created on the platform. | true |  |  | true | true |  | true |  | true | true |  | true | true | true |  |  | true |  |  |  | true | true | true |  |  |
| is_verified | true if the user's profile is verified by the platform. | true | true | true | true |  | true |  |  |  |  |  |  |  |  | true |  |  | true | true | true |  |  |  |  | true |
| is_business | true if the user's profile is business account on the platform. | true | true | true |  |  | true |  |  |  |  |  |  |  |  | true |  |  | true | true | true |  |  |  |  | true |
| reputation.connection_count | Total number of connections of this profile. |  |  |  |  |  |  |  |  |  |  | true |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| work_experiences | Work experiences listed on the profile |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| reputation.paid_subscriber_count | Total number of paid subscribers. |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| reputation.average_open_rate | The historical average open rate of the publication as percentage. |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| reputation.average_click_rate | The historical average clickthrough rate of the publication as percentage. |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| reputation.like_count | Total number of likes count |  |  | true |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| education | Education listed on the profile |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| publications | Publications listed on the profile |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| certifications | Certifications listed on the profile |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| volunteer_experiences | Volunteering experiences listed on the profile |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| honors | List of honors listed on the profile |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| projects | List of projects listed on the profile |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |

## Audience — Demographics API contains details about a creators audience including aggregated data for audience countries, cities and gender_age_split.
Columns: Field Name (text), Description (multilineText), YouTube (checkbox), Instagram (checkbox), TikTok (checkbox), Facebook (checkbox), IG Direct (checkbox)

| Field Name | Description | YouTube | Instagram | TikTok | Facebook | IG Direct |
|---|---|---|---|---|---|---|
| countries.code | 2 letter country code | true | true | true | true | true |
| countries.value | Percentage value of demographics from the corresponding country | true | true | true | true | true |
| cities.name | Name of the city |  | true |  | true | true |
| cities.value | Percentage value of demographics from the corresponding city |  | true |  | true | true |
| gender_age_distribution.gender | Gender of the audience | true | true | true | true | true |
| gender_age_distribution.age_range | Age range of the audience | true | true | true | true | true |
| gender_age_distribution.value | Percentage value of demographics from the corresponding gender in the corresponding age range | true | true | true | true | true |
|  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |

## Engagement — Engagement API contains information about creator's work, content, and engagement metrics on the content from a connected work platform.
Columns: Field Name (text), Description (multilineText), YouTube (checkbox), Instagram (checkbox), TikTok (checkbox), Twitter (checkbox), Twitch (checkbox), Facebook (checkbox), Pinterest (checkbox), Substack (checkbox), Reddit (checkbox), LinkedIn (checkbox), Patreon (checkbox), Spotify (checkbox), Medium (checkbox), Ghost (checkbox), Trovo (checkbox), AfreecaTV (checkbox), Snapchat (checkbox), IG Direct (checkbox)

| Field Name | Description | YouTube | Instagram | TikTok | Twitter | Twitch | Facebook | Pinterest | Substack | Reddit | LinkedIn | Patreon | Spotify | Medium | Ghost | Trovo | AfreecaTV | Snapchat | IG Direct |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| title | Title of the content item. | true | true | true | true | true | true | true | true | true | true | true | true | true | true | true | true | true | true |
| format | Media type of the content item. - VIDEO / IMAGE / AUDIO / TEXT / OTHER  | true | true | true | true | true | true | true | true | true |  |  | true |  |  |  |  |  | true |
| type | Platform specific content type. - VIDEO / POST / STORY / TWEET / BLOG / IMAGE / THREAD / PODCAST / TRACK / REELS / STREAM / FEED / IGTV | true | true | true | true | true | true | true | true | true |  | true | true |  |  |  |  |  | true |
| url | Platform permanent content URL  | true | true | true | true | true | true | true | true | true | true | true | true | true | true | true |  | true | true |
| media_url | Direct media URL of the content item, which can be used to download the media item. This is usually a signed URL and may have certain expiry limits so we recommend using it for downloads as soon as possible (such as when a webhook is received), if you are looking to cache media files with you.)  |  | true | true |  |  | true |  |  |  | true | true |  |  |  |  |  | true | true |
| description | Description of the content item. | true | true | true | true | true | true | true |  | true | true | true | true | true | true |  | true | true | true |
| thumbnail_url | Thumbnail URL of the content item, which can be used to download the media thumbnail. This is usually a signed URL and may have certain expiry limits so we recommend using it for downloads as soon as possible (such as when a webhook is received), if you are looking to cache thumbnails with you. | true | true | true |  | true | true |  | true | true |  | true | true |  | true | true | true | true | true |
| published_at | Publishing timestamp of the content item. | true | true | true | true | true | true | true | true | true | true | true | true | true | true |  | true | true | true |
| platform_profile_id | Unique profile ID of the user on the work platform.  Ex - For YouTube it's the channel ID and for Instagram it's the Instagram page ID. | true | true | true | true | true | true | true | true | true | true | true | true | true | true | true | true | true | true |
| platform_profile_name | User's profile name on the work platform.  Ex - For YouTube, it's the channel name and for Instagram it's the Instagram handle. | true | true | true | true | true | true | true | true | true | true | true | true | true | true | true | true | true | true |
| engagement.like_count | Total likes. | true | true | true | true |  | true |  | true | true | true | true |  | true |  | true | true |  | true |
| engagement_dislike_count | Total dislikes. | true |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| engagement.impression_organic_count | Total organic impressions. |  |  |  |  |  | true |  | true |  | true |  |  |  |  |  | true | true |  |
| engagement.reach_organic_count | Total organic reach. |  | true |  |  |  | true |  | true |  |  |  |  |  |  |  |  |  | true |
| engagement.save_count | Total item saves. |  | true | true |  |  |  | true |  |  |  |  |  |  |  |  |  | true | true |
| engagement.view_count | Total views. | true | true | true |  | true | true |  |  |  | true |  | true |  |  | true | true | true | true |
| engagement.watch_time_in_hours | If format is video - total watch time in hours. | true |  |  |  |  | true |  | true |  |  |  | true |  |  |  | true |  | true |
| engagement.share_count | Total shares. |  | true | true | true |  |  |  |  |  | true |  |  |  |  |  |  | true | true |
| engagement.impressions_paid_count | Total paid impressions. |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | true |
| engagement.reach_paid_count | Total paid reach. |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | true |
| external_id | Unique content ID on the platform. | true | true | true | true |  | true |  |  | true | true | true | true | true | true | true | true | true | true |
| sponsored.is_sponsored | Indicates if the content item is sponsored. |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| sponsored.tags | Sponsor tag (can include mentions of the sponsor) |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| collaboration.has_collaborators | Indicates if the content item has collaborators. |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| is_owned_by_platform_user | true, if the content is owned by the creator. In YouTube, it is possible that content is actually owned by another creator, but current creator has linked that content in their playlist. In such a case the content will still be listed for the current creator. | true |  |  | true |  |  |  |  |  |  |  |  |  |  |  |  |  | true |
| engagement.comment_count | Total comments. | true | true | true |  |  | true | true | true | true | true | true |  | true |  | true | true |  | true |
| duration | Video duration in seconds (only available for YouTube). | true |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | true |  |
| hashtags | Array of hashtags used in the media description  | true | true | true | true | true | true |  |  |  |  |  |  |  |  |  |  |  | true |
| mentions | Array of mentioned accounts in the media | true | true | true | true | true | true |  |  |  |  |  |  |  |  |  |  |  | true |
| engagement.avg_watch_time_in_sec | Average watch time of reel in seconds |  | true |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | true |
|   persistent_thumbnail_url | A stable, long-lived URL to the media thumbnail cached on our servers. Since the original "thumbnail_url" provided by the platform has an expiry limit. | true | true | true |  | true | true |  | true | true |  | true | true |  | true | true | true | true | true |
| visibility | Visibility of a content item. Values can be PRIVATE / UNLISTED / PUBLIC | true | true | true | true | true | true | true | true | true | true | true | true | true |  | true | true | true | true |
| content_tags |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| media_urls |  |  |  |  |  |  | true |  |  |  |  |  |  |  |  |  |  |  | true |
| engagement.replay_count |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| engagement.email_open_rate |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| engagement.email_click_rate |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| engagement.unsubscribe_count |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| engagement.spam_report_count |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| engagement.click_count |  |  |  |  |  |  | true |  |  |  |  |  |  |  |  |  |  |  |  |
| engagement.additional_info.profile_visits |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| engagement.additional_info.bio_link_clicked |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| engagement.additional_info.followers_gained |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| engagement.repost_count |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| authors |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| audience |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| platform |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |

## Comments — Comments API contains information about the audience of a creators content in the form of comments and commenters.
Columns: Field Name (text), Description (multilineText), YouTube (checkbox), Instagram (checkbox), IG Direct (checkbox)

| Field Name | Description | YouTube | Instagram | IG Direct |
|---|---|---|---|---|
| text | Text content of the comment. | true | true | true |
| commenter_display_name | Full display name of the commenter profile. |  |  |  |
| commenter_id | Unique identifier of the commenter's profile on the platform. | true |  |  |
| commenter_username | Commenter profile username. |  |  |  |
| commenter_profile_url | Commenter's profile URL on the connected platform. | true |  |  |
| like_count | Total likes. | true | true |  |
| reply_count | Total replies. | true | true |  |
| external_id | Unique comment ID on the platform. | true | true | true |
| content.id | Unique ID of the content item. | true | true | true |
| content.url | URL of the content item. | true | true | true |
| content.published_at | Content's published date and time on the platform. | true | true | true |

## Income - Social - Transactions — Transactions records for ad and subscription income from social platforms.
Columns: Field Name (text), Description (multilineText), YouTube (checkbox), Facebook (checkbox), Twitch (checkbox)

| Field Name | Description | YouTube | Facebook | Twitch |
|---|---|---|---|---|
| id | Transaction id  | true | true | true |
| external_id | Platform transaction id   | true | true | true |
| transaction_at | Date or timestamp of transaction | true | true | true |
| amount | Amount for the given transaction | true | true | true |
| type | Transaction type - AD / SUBSCRIPTION /  ADDITIONAL | true | true | true |
| cpm | ad revenue per 1000 ad impressions | true | true |  |
| platform_profile_name | User's profile name on the work platform.  Ex - For YouTube, it's the channel name and for Instagram it's the Instagram handle. | true | true | true |
| platform_profile_id | Unique profile ID of the user on the work platform.  Ex - For YouTube it's the channel ID and for Instagram it's the Instagram page ID. | true | true | true |
| currency | 3 letter currency code | true | true | true |

## Income - Social - Payouts — Payout records from social platforms.
Columns: Field Name (text), Description (multilineText), Adsense (checkbox)

| Field Name | Description | Adsense |
|---|---|---|
| external_id | Platform payout id | true |
| payout_at | Payout date | true |
| amount | Payout amount | true |
| currency | Payout currency | true |
| status | Payout status - SCHEDULED, PAID, IN_TRANSIT, CANCELLED, OTHER | true |
| payout_interval | Payout interval - AUTOMATIC_DAILY, AUTOMATIC_MONTHLY, AUTOMATIC_WEEKLY, MANUAL, OTHER |  |
| bank_details.name | Destination bank name  |  |
| bank_details.account_last_digits | Destination bank account last digits |  |
| bank_details.account_routing_number | Destination bank account routing number |  |
| platform_profile_id | Unique profile ID of the user on the work platform.  Ex - For YouTube it's the channel ID and for Instagram it's the Instagram page ID. | true |
| platform_profile_name | User's profile name on the work platform.  Ex - For YouTube, it's the channel name and for Instagram it's the Instagram handle. | true |

## Income - Commerce - Balances — Balances records from e-commerce platforms.
Columns: Field name (text), Description (multilineText), Shopify (checkbox), Etsy (checkbox), Stripe (checkbox)

| Field name | Description | Shopify | Etsy | Stripe |
|---|---|---|---|---|
| balance.amount | Amount for the given balance | true | true | true |
| balance.currency | 3 letter currency code  | true | true | true |
| balance_at | Current balance date | true | true | true |
| platform_profile_id | Unique profile ID of the user on the work platform.  Ex - For YouTube it's the channel ID and for Instagram it's the Instagram page ID. | true | true | true |
| platform_profile_name | User's profile name on the work platform.  Ex - For YouTube, it's the channel name and for Instagram it's the Instagram handle. | true | true | true |

## Income - Commerce - Transactions — Transactions records from e-commerce platforms.
Columns: Field name (text), Description (multilineText), Shopify (checkbox), Etsy (checkbox), Stripe (checkbox), Facebook Commerce (checkbox), Gumroad (checkbox)

| Field name | Description | Shopify | Etsy | Stripe | Facebook Commerce | Gumroad |
|---|---|---|---|---|---|---|
| external_id | Platform transaction id  | true | true | true | true | true |
| transaction_at | Platform transaction date | true | true | true | true | true |
| amount | Transaction amount | true | true | true | true | true |
| currency | Transaction currency | true | true | true | true | true |
| type | Transaction type - SALE, REFUND, VOID, CANCELLED, OTHER | true | true | true | true | true |
| status | Transaction status - SUCCESS, FAILURE, PENDING, OTHER | true | true | true | true | true |
| platform_profile_id | Unique profile ID of the user on the work platform.  Ex - For YouTube it's the channel ID and for Instagram it's the Instagram page ID. | true | true | true | true | true |
| platform_profile_name | User's profile name on the work platform.  Ex - For YouTube, it's the channel name and for Instagram it's the Instagram handle. | true | true | true | true | true |

## Income - Commerce - Payouts — Payout records from e-commerce platforms.
Columns: Field Name (text), Description (multilineText), Shopify (checkbox), Etsy (checkbox), Stripe (checkbox), Facebook Commerce (checkbox)

| Field Name | Description | Shopify | Etsy | Stripe | Facebook Commerce |
|---|---|---|---|---|---|
| external_id | Platform payout id | true | true | true | true |
| payout_at | Payout date | true | true | true | true |
| amount | Payout amount | true | true | true | true |
| currency | Payout currency | true | true | true | true |
| status | Payout status - SCHEDULED, PAID, IN_TRANSIT, CANCELLED, OTHER | true | true | true | true |
| payout_interval | Payout interval - AUTOMATIC_DAILY, AUTOMATIC_MONTHLY, AUTOMATIC_WEEKLY, MANUAL, OTHER | true | true | true | true |
| bank_details.name | Destination bank name  | true |  | true |  |
| bank_details.account_last_digits | Destination bank account last digits | true |  | true |  |
| bank_details.account_routing_number | Destination bank account routing number | true |  | true |  |
| platform_profile_id | Unique profile ID of the user on the work platform.  Ex - For YouTube it's the channel ID and for Instagram it's the Instagram page ID. | true | true | true | true |
| platform_profile_name | User's profile name on the work platform.  Ex - For YouTube, it's the channel name and for Instagram it's the Instagram handle. | true | true | true | true |

## Publish — Publish new content to creators' accounts on supported work platforms.
Columns: Request field (text), Description (multilineText), TikTok (checkbox), YouTube (checkbox), Instagram (checkbox)

| Request field | Description | TikTok | YouTube | Instagram |
|---|---|---|---|---|
| account_id | Unique ID of the account. | true | true | true |
| title | Title of the post.  | true | true | true |
| description | Description for the post being published. | true | true | true |
| type | Platform specific content type of the post being published : TWEET / REELS / STORY / VIDEO / IMAGE / BLOG / THREAD / POST / PODCAST / TRACK / STREAM / FEED / SHORTS | true | true | true |
| visibility | Visibility of the post : PUBLIC/ PRIVATE / UNLISTED |  | true |  |
| retry | Whether we should retry posting the content in case of any technical failures. | true | true | true |
| additional_info.share_to_feed | Mandatory for Instagram. Whether you want to share the video only to Reels section or Reels + Feed section. |  |  | true |
| media.media_type | Media type of the media item being published: IMAGE / VIDEO  | true | true | true |
| media.source_media_url | Publicly accessible URL for the media to be uploaded. | true | true | true |
| media.source_thumbnail_url | Publicly accessible image URL to be used as the thumbnail to be uploaded. |  | true |  |
| media.thumbnail_offset | Time offset in milliseconds within the video for the frame that should be used as the thumbnail (Instagram only). |  |  | true |
| media.additional_info | Platform specific fields |  |  |  |

## Activity — Fetch users' activity info from supported work platforms. Activity attributes provided include top played artists, recently played media content, top played media content, etc. via the work platform.
Columns: Field Name (text), Description (multilineText), Spotify (checkbox)

| Field Name | Description | Spotify |
|---|---|---|
| platform_artist_id | Unique ID of the artist on the platform | true |
| image_url | Image URL of the artist on the platform | true |
| artist_name | Name of the artist | true |
| artist_url | URL of the artist on the platform | true |
| genre | Genre of the artist | true |
| activity_type | Type of the artist. FOLLOWED / TOP | true |
| platform_content_id | Unique content ID on the platform | true |
| title | Title of the content item | true |
| format | Media type of the content item.  Allowed values: VIDEO / IMAGE / AUDIO / TEXT / OTHER.  | true |
| type | Platform specific content type. - VIDEO / POST / STORY / TWEET / BLOG / IMAGE / THREAD / PODCAST / TRACK / REELS / STREAM / FEED / IGTV | true |
| url | Platform content URL | true |
| description | Description of the content item | true |
| thumbnail_url | Thumbnail URL of the content item | true |
| embed_url | Embed URL of the content item | true |
| activity_type | Type of the content item.  RECENT / TOP / SAVED | true |
| additional_info.artists | Artists of the track | true |
| additional_info.album | 	  Album that the track belongs to | true |
| additional_info.genre | Genre of the track |  |

## Platform Token Validity — Describes the access token validity for different platforms.
Columns: Platform (text), Access token validity (text), Refresh token available (checkbox), Exceptions (richText)

| Platform | Access token validity | Refresh token available | Exceptions |
|---|---|---|---|
| YouTube | 60 minutes | true | Can be invalidated by password changes, permission revocation, user de-authorisation on the platform end etc.  |
| Instagram | 60 days |  | Can be invalidated by password changes, permission revocation, user de-authorisation on the platform end etc.  |
| Facebook | 60 days |  | Can be invalidated by password changes, permission revocation, user de-authorisation on the platform end etc.  |
| TikTok | 24 hours | true | Can be invalidated by password changes, permission revocation, user de-authorisation on the platform end etc.  |
| Twitter | Not specified (Ideally shouldn't expire) |  | Can be invalidated by password changes, permission revocation, user de-authorisation on the platform end etc.  |
| Twitch | 4 hours | true | Can be invalidated by password changes, permission revocation, user de-authorisation on the platform end etc.  |
| LinkedIn | 2 months | true | Can be invalidated by password changes, permission revocation, user de-authorisation on the platform end etc.  |
| IG Direct | 60 days |  | Can be invalidated by password changes, permission revocation, user de-authorisation on the platform end etc.  |
