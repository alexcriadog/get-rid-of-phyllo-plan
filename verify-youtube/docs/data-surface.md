# Data surface — what we can extract per OAuth scope

> Exhaustive reference. Last verified against official docs on 2026-05-12.
> Sources cited inline. For each scope we list every endpoint, the data
> it returns, and what we currently do vs. what we COULD do.

## TL;DR — six scopes, summary

| Scope | API | What it unlocks |
|---|---|---|
| `openid` + `userinfo.email` + `userinfo.profile` | Google Identity (OIDC) | Who's connecting (email + name + avatar + locale + Google subject ID) |
| `youtube.readonly` | YouTube Data API v3 | Everything the user can see in YouTube Studio about their own channel(s), videos, playlists, subscriptions, live streams, comments, members. **Read-only.** |
| `yt-analytics.readonly` | YouTube Analytics API v2 | Engagement, watch-time, audience, traffic, retention, real-time concurrent viewers. **No revenue.** |
| `adwords` | Google Ads API v24 | Everything queryable via GAQL about the user's own Google Ads accounts — campaigns (all types, not just video), ad groups, ads, keywords, audiences, conversions, video performance, etc. **Read-only in our use.** |

---

## 1 · OIDC (openid + userinfo.email + userinfo.profile)

**Endpoint**: `GET https://openidconnect.googleapis.com/v1/userinfo`
**Headers**: `Authorization: Bearer {access_token}`
**Response** (all the fields Google actually returns):

| Field | Type | What it is |
|---|---|---|
| `sub` | string | The stable Google account ID — **the one identifier that never changes** even if email/name does. Use this as our user key. |
| `email` | string | Primary Google email of the connected user. |
| `email_verified` | boolean | Whether Google has verified that email. |
| `name` | string | Full display name as the user has it set in Google. |
| `given_name` | string | First name. |
| `family_name` | string | Last name. |
| `picture` | URL | Public URL of the avatar (hot-linkable, no auth needed). |
| `locale` | string | BCP-47 locale, e.g. `es-ES`, `en-US`. Useful to default the dashboard language. |
| `hd` | string | Hosted-domain — only present if the account is a Google Workspace org member (e.g. `camaleonicanalytics.com`). Lets us detect "business account" vs. "personal Gmail". |

That's the full payload — Google does not expose age/gender/birthdate/phone/address through this scope.

> The ID token (a JWT signed by Google, returned alongside `access_token`)
> contains the same fields. We can verify it locally with Google's public
> keys and skip the `/userinfo` call entirely if we want.

---

## 2 · youtube.readonly — YouTube Data API v3

All endpoints are `GET` under `https://www.googleapis.com/youtube/v3/{resource}`.
Authorization: `Authorization: Bearer {access_token}`. Many take `mine=true` to scope to the connected user.

### 2.1 channels

The most loaded endpoint. With `parts=snippet,contentDetails,statistics,status,brandingSettings,topicDetails,localizations`:

- **id** — channel ID
- **snippet**: title, description, customUrl, publishedAt, defaultLanguage, country, thumbnails (default/medium/high/standard/maxres URLs), localized (title + description in user locale)
- **contentDetails.relatedPlaylists**: `uploads` (← the playlist that contains every video the channel ever uploaded), `likes`, `favorites`, `watchHistory`, `watchLater`
- **statistics**: viewCount (lifetime), subscriberCount, hiddenSubscriberCount (boolean), videoCount
- **status**: privacyStatus, isLinked, longUploadsStatus (`allowed` / `disallowed` / `eligible`), madeForKids, selfDeclaredMadeForKids
- **brandingSettings.channel**: title, description, keywords (comma-separated), country, defaultLanguage, moderateComments, trackingAnalyticsAccountId, unsubscribedTrailer, profileColor, featuredChannelsTitle, featuredChannelsUrls[]
- **brandingSettings.image**: bannerExternalUrl
- **topicDetails.topicIds[]** + **topicDetails.topicCategories[]** — what Wikipedia categories YouTube has classified the channel under
- **localizations** — title/description translations the channel uploaded

### 2.2 videos

`videos.list?part=...&id=...,...` (batches up to 50 video IDs per call). Available parts:

- **snippet**: publishedAt, channelId, channelTitle, title, description, thumbnails (5 sizes), tags[], categoryId, liveBroadcastContent (`live`/`upcoming`/`none`), defaultLanguage, defaultAudioLanguage, localized
- **contentDetails**: duration (ISO 8601: `PT4M13S`), dimension (`2d`/`3d`), definition (`hd`/`sd`), caption (boolean as string), licensedContent (boolean), contentRating (per board: `mpaaRating`, `tvpgRating`, `ytRating`, many more), regionRestriction.allowed / .blocked, projection (`360`/`rectangular`)
- **statistics**: viewCount, likeCount, commentCount, favoriteCount (dislikeCount **no longer returned** by YouTube since late 2021)
- **status**: uploadStatus (`uploaded`/`processed`/`failed`/`rejected`/`deleted`), failureReason, rejectionReason, privacyStatus (`public`/`unlisted`/`private`), publishAt (scheduled publish), license (`youtube`/`creativeCommon`), embeddable, publicStatsViewable, madeForKids, selfDeclaredMadeForKids
- **player.embedHtml**, embedHeight, embedWidth
- **topicDetails.topicIds[] / .topicCategories[]**
- **recordingDetails**: location (lat/long), locationDescription, recordingDate
- **fileDetails** (only the owner sees this): fileName, fileSize, fileType, container, videoStreams[] (codec, bitrate, fps, resolution, aspectRatio), audioStreams[], durationMs, bitrateBps, creationTime
- **processingDetails**: processingStatus, processingProgress.partsTotal / .partsProcessed / .timeLeftMs, processingFailureReason, fileDetailsAvailability, processingIssuesAvailability, tagSuggestionsAvailability, editorSuggestionsAvailability, thumbnailsAvailability
- **suggestions**: processingErrors[], processingWarnings[], processingHints[], tagSuggestions[], editorSuggestions[]
- **liveStreamingDetails**: actualStartTime, actualEndTime, scheduledStartTime, scheduledEndTime, concurrentViewers, activeLiveChatId
- **localizations** — per-locale title/description

### 2.3 playlists / playlistItems

- `playlists.list?mine=true` — all playlists the user owns. Parts: snippet, status, contentDetails (itemCount), localizations.
- `playlistItems.list?playlistId=...` — items in a playlist. Combined with the channel's `uploads` playlist ID this **enumerates every video the channel has ever published**. Parts: snippet, contentDetails (videoId, videoPublishedAt, note), status.

### 2.4 subscriptions

- `subscriptions.list?mine=true` — channels the user follows. Pages of 50. Parts: snippet (resourceId.channelId, channelTitle, description, thumbnails), contentDetails (activityType, newItemCount, totalItemCount), subscriberSnippet.
- `subscriptions.list?mySubscribers=true` — channels that follow the user (subject to YouTube's restriction: only available to users who haven't disabled the "show my subscribers" setting, and only the count is exposed for most).

### 2.5 activities

- `activities.list?channelId=...` or `?mine=true` — a chronological feed of channel actions: uploads, likes, favorites, subscriptions, playlistItems, recommendations, bulletins, social, channelItems, promotedItems. Parts: snippet, contentDetails (with sub-objects per action type).

### 2.6 commentThreads / comments

- `commentThreads.list?videoId=...` (or `channelId`, or `allThreadsRelatedToChannelId`) — top-level comments + their replies. Parts: snippet, replies.
- `comments.list?parentId=...` — replies under a top-level comment.
- Each comment has: authorDisplayName, authorProfileImageUrl, authorChannelUrl, authorChannelId, textDisplay, textOriginal, publishedAt, updatedAt, likeCount, canRate, viewerRating, parentId, moderationStatus, totalReplyCount.

### 2.7 captions

- `captions.list?videoId=...` — caption tracks the channel has uploaded. Parts: snippet (videoId, language, name, audioTrackType, isCC, isLarge, isEasyReader, isDraft, isAutoSynced, status, lastUpdated, trackKind: `standard` / `ASR` / `forced`).
- Note: actually downloading caption file content requires `youtube.force-ssl` scope (write), not just readonly. With our scope we only get **metadata**.

### 2.8 channelSections

- `channelSections.list?channelId=...` — the sections the channel has configured on its profile (Featured channels, Popular uploads, etc.). Parts: snippet (type, style, position, title), contentDetails (playlists[], channels[]), localizations, targeting (languages[], regions[], countries[]).

### 2.9 search

`search.list?part=snippet&q=...&forMine=true` — search within the connected channel's videos. Useful for content discovery within their own catalog. Also `relevanceLanguage`, `safeSearch`, `videoCategoryId`, `videoDefinition`, `videoDuration`, `videoEmbeddable`, `videoLicense`, `videoSyndicated`, `videoType`, `eventType` (`live`/`upcoming`/`completed`), `order` (`date`/`rating`/`viewCount`/`videoCount`/`relevance`/`title`).

### 2.10 liveBroadcasts / liveStreams / liveChatMessages

- `liveBroadcasts.list?mine=true` — past + scheduled + currently-live broadcasts. Parts: snippet (publishedAt, channelId, title, description, thumbnails, scheduledStartTime, scheduledEndTime, actualStartTime, actualEndTime, isDefaultBroadcast, liveChatId), contentDetails (boundStreamId, monitorStream, enableEmbed, enableDvr, enableContentEncryption, startWithSlate, recordFromStart, enableClosedCaptions, closedCaptionsType, projection, enableLowLatency, latencyPreference, enableAutoStart, enableAutoStop), status (lifeCycleStatus: `created`/`ready`/`testing`/`live`/`complete`/`revoked`, privacyStatus, recordingStatus, madeForKids, selfDeclaredMadeForKids), statistics (totalChatCount).
- `liveStreams.list?mine=true` — stream input configuration (RTMP keys, etc.). Parts: snippet, cdn, contentDetails, status.
- `liveChatMessages.list?liveChatId=...` — chat messages on a live stream (during or replay). Parts: snippet (with messageDeletedDetails, userBannedDetails, messageRetractedDetails, fanFundingEventDetails [Super Chat], etc.), authorDetails (channelId, channelUrl, displayName, profileImageUrl, isVerified, isChatOwner, isChatSponsor, isChatModerator).

### 2.11 members / membershipsLevels

Only if the connected channel has YouTube Channel Memberships enabled.
- `membershipsLevels.list` — tiers the channel offers.
- `members.list?mode=all_current` (or `updates`) — current paying members. Snippet: memberDetails (channelId, channelUrl, displayName, profileImageUrl), membershipsDetails (highestAccessibleLevel, highestAccessibleLevelDisplayName, accessibleLevels[], memberSince, memberTotalDurationMonths, etc.).

### 2.12 i18nLanguages / i18nRegions / videoCategories / videoAbuseReportReasons

Static reference data, useful for mapping codes to readable labels.

### 2.13 What this scope DOES NOT give us

- **Video binaries**. There's no API to download MP4s. Anyone who tells you otherwise is wrong (the historical `youtube.download` scope is a CMS-partner-only artifact). For the brand-watermark analysis feature, the route is `yt-dlp` against the public video URLs the API enumerates.
- **Caption file contents**. `youtube.force-ssl` (write) is required to download the .vtt — readonly only sees metadata.
- **Other users' private data**. We only see what the connected user can see in YouTube Studio.

---

## 3 · yt-analytics.readonly — YouTube Analytics API v2

**Endpoint**: `GET https://youtubeanalytics.googleapis.com/v2/reports`
**Headers**: `Authorization: Bearer {access_token}`

The shape is **one** endpoint, infinitely composable through `metrics=`, `dimensions=`, `filters=`, `sort=`, `startDate=`, `endDate=`, `ids=channel==MINE`.

### 3.1 Dimensions (group-by axes)

| Category | Dimensions |
|---|---|
| **Time** | `day`, `month` |
| **Geographic** | `country`, `province`, `dma`, `city`. Filter-only: `continent`, `subContinent` |
| **Content** | `video`, `playlist`, `channel`. Filter-only: `group` (custom Analytics groups) |
| **Demographics** | `ageGroup` (e.g. `age13-17`, `age18-24`, …), `gender` (`male`/`female`/`gender_other`) |
| **Playback location** | `insightPlaybackLocationType` (`embedded`/`watch`/`channel`/`mobile`/`external_app`/`searches`/`browse`/`yt_other`), `insightPlaybackLocationDetail` (specific URL or app, when location is `embedded` or `external_app`) |
| **Playback details** | `subscribedStatus` (`subscribed`/`unsubscribed`), `liveOrOnDemand`, `youtubeProduct` (`core`/`gaming`/`kids`/`music`/`unknown`), `creatorContentType` (`live_stream`/`short_form_video`/`long_form_video`/`unknown`) |
| **Traffic source** | `insightTrafficSourceType` (15+ values: `YT_SEARCH`, `EXT_URL`, `RELATED_VIDEO`, `PLAYLIST`, `YT_CHANNEL`, `ADVERTISING`, `NOTIFICATION`, `END_SCREEN`, `SHORTS`, etc.), `insightTrafficSourceDetail` (concrete URL or playlist ID) |
| **Device** | `deviceType` (`MOBILE`/`DESKTOP`/`TABLET`/`TV`/`GAME_CONSOLE`/`UNKNOWN_PLATFORM`), `operatingSystem` (`ANDROID`/`IOS`/`WINDOWS`/`MACINTOSH`/`LINUX`/`SMART_TV`/...) |
| **Sharing** | `sharingService` (Twitter, WhatsApp, Reddit, etc. — the platform the user clicked Share to) |
| **Retention** | `elapsedVideoTimeRatio` (0.00–1.00 buckets across video duration). Filter-only: `audienceType` (`ORGANIC` / `AD_INSTREAM` / `AD_INDISPLAY` / etc.) |
| **Live** | `livestreamPosition` |

### 3.2 Metrics (non-monetary — what our scope unlocks)

| Category | Metrics |
|---|---|
| **Views / watch time** | `views`, `engagedViews`, `redViews` (YouTube Premium viewers), `viewerPercentage` (per demographic bucket), `estimatedMinutesWatched`, `estimatedRedMinutesWatched`, `averageViewDuration` (seconds), `averageViewPercentage` (0–100 % of video length) |
| **Engagement** | `likes`, `dislikes`, `comments`, `shares`, `videosAddedToPlaylists`, `videosRemovedFromPlaylists` |
| **Subscriptions** | `subscribersGained`, `subscribersLost` |
| **Playlist** | `playlistViews`, `playlistStarts`, `playlistSaves`, `playlistEstimatedMinutesWatched`, `playlistAverageViewDuration`, `averageTimeInPlaylist`, `viewsPerPlaylistStart` |
| **Cards** | `cardImpressions`, `cardClicks`, `cardClickRate`, `cardTeaserImpressions`, `cardTeaserClicks`, `cardTeaserClickRate` |
| **Annotations** (legacy) | `annotationImpressions`, `annotationClickableImpressions`, `annotationClicks`, `annotationClickThroughRate`, `annotationClosableImpressions`, `annotationCloses`, `annotationCloseRate` |
| **Audience retention** | `audienceWatchRatio` (% of viewers watching each moment), `relativeRetentionPerformance` (vs. similar videos), `startedWatching`, `stoppedWatching`, `totalSegmentImpressions` |
| **Live streaming** | `averageConcurrentViewers`, `peakConcurrentViewers` |
| **Memberships** | `membershipsCancellationSurveyResponses` |

### 3.3 Useful queries you could run today

```
# Views por país, último mes
metrics=views,estimatedMinutesWatched
dimensions=country
startDate=2026-04-12&endDate=2026-05-12
sort=-views

# Retención de un vídeo concreto
metrics=audienceWatchRatio,relativeRetentionPerformance
dimensions=elapsedVideoTimeRatio
filters=video==VIDEO_ID
startDate=...&endDate=...

# Demografía edad × género
metrics=viewerPercentage
dimensions=ageGroup,gender
startDate=...&endDate=...

# Top traffic sources
metrics=views,averageViewDuration
dimensions=insightTrafficSourceType
sort=-views

# Subs gained/lost por día
metrics=subscribersGained,subscribersLost
dimensions=day
```

### 3.4 Lo que NO entra en este scope

Todo lo monetario: `estimatedRevenue`, `estimatedAdRevenue`, `estimatedRedPartnerRevenue`, `grossRevenue`, `cpm`, `playbackBasedCpm`, `monetizedPlaybacks`, `adImpressions`. Requeriría volver a pedir `yt-analytics-monetary.readonly`.

---

## 4 · adwords — Google Ads API v24

**Endpoints**: `https://googleads.googleapis.com/v24/{path}`
**Headers**: `Authorization: Bearer {access_token}` + `developer-token: {our_token}` + opcional `login-customer-id: {mcc_id}`.

Esto se queda como "lo que podrás hacer cuando llegue Basic" — con Test token actual sólo da `PERMISSION_DENIED` contra cuentas reales.

### 4.1 Mecánica

Una sola query GAQL contra un endpoint. Decides recurso (FROM) + campos (SELECT) + filtros (WHERE) + orden + límite.

```sql
SELECT campaign.id, campaign.name,
       metrics.video_views, metrics.average_cpv, metrics.cost_micros
FROM campaign
WHERE campaign.advertising_channel_type = 'VIDEO'
  AND segments.date BETWEEN '2026-04-12' AND '2026-05-12'
ORDER BY metrics.video_views DESC
LIMIT 50
```

### 4.2 Recursos disponibles (los más relevantes)

| Recurso | Para qué |
|---|---|
| `customer` | El propio Google Ads account: descriptive_name, currency_code, time_zone, tracking_url_template, auto_tagging_enabled, has_partners_badge, manager (boolean), test_account (boolean), conversion_tracking_setting, remarketing_setting, pay_per_conversion_eligibility_failure_reasons, optimization_score |
| `customer_client` | Si la cuenta es MCC: hijos de la MCC con sus IDs, status, hidden, manager flag |
| `campaign` | id, name, status, advertising_channel_type (SEARCH / DISPLAY / SHOPPING / VIDEO / MULTI_CHANNEL / LOCAL / SMART / PERFORMANCE_MAX / LOCAL_SERVICES / DISCOVERY / DEMAND_GEN / TRAVEL / HOTEL), advertising_channel_sub_type, start_date, end_date, bidding_strategy_type, campaign_budget, frequency_caps, network_settings, geo_target_type_setting, ad_serving_optimization_status, serving_status, payment_mode, optimization_score, primary_status, experiment_type |
| `ad_group` | id, name, status, campaign, type, cpc_bid_micros, cpm_bid_micros, target_cpa_micros, target_cpm_micros, percent_cpc_bid_micros, ad_rotation_mode, labels, audience_setting |
| `ad_group_ad` | ad.id, ad.name, ad.type (RESPONSIVE_SEARCH_AD / RESPONSIVE_DISPLAY_AD / VIDEO_RESPONSIVE_AD / VIDEO_AD / DEMAND_GEN_VIDEO_RESPONSIVE_AD / DEMAND_GEN_CAROUSEL_AD / etc.), ad.final_urls, ad.display_url, status, policy_summary |
| `ad_group_criterion` | Keywords (con keyword.text, keyword.match_type), audiences, age_range, gender, parental_status, income_range, placement (URL where ad showed), youtube_video, youtube_channel, mobile_app_category, etc. |
| `keyword_view` | Cruzado con métricas: rendimiento por keyword |
| `video` | id (YouTube video ID), title, duration_millis, channel_id — videos usados en campañas de vídeo |
| `asset` | Imágenes, vídeos, headlines, descriptions usados en campañas (Performance Max sobre todo) |
| `audience` | Audiencias custom de la cuenta |
| `bidding_strategy` | Estrategias de puja portafolio |
| `campaign_budget` | Budgets, presupuesto compartido entre campañas |
| `conversion_action` | Conversiones configuradas (compras, leads, etc.) y sus contadores |
| `geographic_view` | Métricas por ubicación geográfica (donde el usuario clickó) |
| `age_range_view`, `gender_view`, `parental_status_view`, `user_interest`, `topic_view` | Rendimiento por demografía/intereses |
| `device_view` | Métricas por device (MOBILE/DESKTOP/TABLET/CONNECTED_TV) |
| `hour_view`, `day_of_week_view`, `ad_schedule_view` | Rendimiento por hora del día / día de la semana |
| `landing_page_view` | Métricas por URL de destino |
| `search_term_view` | Consultas reales que dispararon ads (para Search) |
| `shopping_performance_view` | Métricas de campañas de Shopping |
| `change_event`, `change_status` | Auditoría de cambios en la cuenta |
| `recommendation` | Sugerencias que Google Ads ofrece (KEYWORD_MATCH_TYPE, RESPONSIVE_SEARCH_AD, CALLOUT_EXTENSION, etc.) — sólo lectura |
| `experiment`, `experiment_arm` | A/B tests configurados |
| `asset_group`, `asset_group_listing_group_filter` | Performance Max asset groups |

### 4.3 Métricas (`metrics.*` — las útiles para vídeo)

| Métrica | Significado |
|---|---|
| `metrics.impressions` | Veces que el ad se mostró |
| `metrics.clicks` | Clicks en el ad |
| `metrics.ctr` | impressions / clicks |
| `metrics.cost_micros` | Spend en micros (1 USD = 1,000,000 micros) |
| `metrics.average_cpc` / `metrics.average_cpm` / `metrics.average_cpv` | Costes promedio |
| `metrics.video_views` | Reproducciones contadas como view (≥30s o todo el ad si dura menos) |
| `metrics.video_view_rate` | views / impressions |
| `metrics.video_quartile_p25_rate`, `p50_rate`, `p75_rate`, `p100_rate` | % de viewers que llegaron al 25 / 50 / 75 / 100 % del vídeo |
| `metrics.engagements` / `metrics.engagement_rate` | Interacciones (cards, end screens, etc.) |
| `metrics.conversions`, `metrics.conversions_value`, `metrics.cost_per_conversion`, `metrics.conversion_rate` | Conversiones |
| `metrics.view_through_conversions` | Conversiones tras impresión sin click |
| `metrics.all_conversions`, `metrics.all_conversions_value` | Incluye conversiones cross-account / cross-device |
| `metrics.search_impression_share`, `metrics.search_top_impression_share`, `metrics.search_absolute_top_impression_share` | Cuota de impresiones (Search) |
| `metrics.relative_ctr` | CTR vs. competencia (Display) |
| `metrics.active_view_*` | Visibility (Active View) |
| `metrics.gmail_*`, `metrics.video_*` | Métricas específicas de formato |
| `metrics.cross_device_conversions` | Conversiones cross-device |
| `metrics.interaction_event_types[]` | Tipos de interacción registrados |

### 4.4 Segmentación (`segments.*`)

Cualquier query se puede partir por:
- `segments.date` — partir por día (granularidad básica)
- `segments.week`, `segments.month`, `segments.quarter`, `segments.year`
- `segments.day_of_week`, `segments.hour`
- `segments.device`
- `segments.geo_target_country` / `_region` / `_city` / `_metro` / `_most_specific_location`
- `segments.ad_network_type` (SEARCH / SEARCH_PARTNERS / CONTENT / YOUTUBE_SEARCH / YOUTUBE_WATCH / MIXED)
- `segments.click_type`, `segments.conversion_action`, `segments.conversion_attribution_event_type`
- `segments.placeholder_type`
- `segments.product_*` (Shopping)
- `segments.recommendation_type`

### 4.5 Ejemplos de queries útiles para vídeo

```sql
-- Todas las campañas de video con métricas, último mes
SELECT campaign.id, campaign.name, campaign.status,
       campaign.advertising_channel_sub_type,
       metrics.impressions, metrics.video_views, metrics.video_view_rate,
       metrics.average_cpv, metrics.cost_micros,
       metrics.video_quartile_p25_rate, metrics.video_quartile_p50_rate,
       metrics.video_quartile_p75_rate, metrics.video_quartile_p100_rate
FROM campaign
WHERE campaign.advertising_channel_type = 'VIDEO'
  AND segments.date DURING LAST_30_DAYS

-- Rendimiento por device en campañas de video
SELECT campaign.name, segments.device,
       metrics.video_views, metrics.cost_micros
FROM campaign
WHERE campaign.advertising_channel_type = 'VIDEO'
  AND segments.date DURING LAST_30_DAYS

-- Qué vídeos creativos están funcionando
SELECT ad_group_ad.ad.id, ad_group_ad.ad.name,
       video.title, video.duration_millis,
       metrics.video_views, metrics.video_view_rate, metrics.average_cpv
FROM video
WHERE segments.date DURING LAST_30_DAYS

-- Audiencias demográficas por campaña de video
SELECT campaign.name, ad_group_criterion.age_range.type,
       ad_group_criterion.gender.type,
       metrics.impressions, metrics.video_views
FROM age_range_view
WHERE campaign.advertising_channel_type = 'VIDEO'
  AND segments.date DURING LAST_30_DAYS

-- Geografía: dónde se ven los ads
SELECT campaign.name, segments.geo_target_country,
       metrics.video_views, metrics.cost_micros
FROM geographic_view
WHERE campaign.advertising_channel_type = 'VIDEO'
  AND segments.date DURING LAST_30_DAYS

-- Cuenta global: spend total + conversiones
SELECT customer.descriptive_name, customer.currency_code,
       metrics.cost_micros, metrics.conversions,
       metrics.conversions_value
FROM customer
WHERE segments.date DURING LAST_30_DAYS
```

### 4.6 Lo que NO podemos hacer (en nuestro setup actual)

- **Mutate**. Crear/editar/pausar campañas requeriría llamadas a `*Service:mutate*` y no las implementamos.
- **Cuentas que el usuario no controla**. El OAuth del usuario sólo desbloquea sus customer_ids accesibles.
- **Keyword Planner** (`KeywordPlanIdeaService.GenerateKeywordIdeas`) — técnicamente posible pero queda fuera de nuestro scope de uso declarado a Google.

---

## 5 · Composición — qué dashboards puedes montar combinando scopes

Combinando lo de arriba, el producto puede enseñar:

1. **Channel snapshot** — quién es el creador, su canal, subs, vídeos, lifetime views, país. *(youtube.readonly + OIDC)*
2. **Catálogo completo de vídeos** con metadata, tags, categoría, duración, privacidad, scheduling. *(youtube.readonly)*
3. **Engagement por vídeo / por periodo** — views, watch time, likes, comentarios, shares, saves. *(yt-analytics.readonly + youtube.readonly)*
4. **Audiencia: edad, género, país, ciudad, device, OS, idioma**. *(yt-analytics.readonly)*
5. **Traffic sources** — de dónde llegan las views (search, related videos, shorts feed, ext URLs, ads…). *(yt-analytics.readonly)*
6. **Retención por vídeo** — curva audienceWatchRatio + comparativa relativeRetentionPerformance. *(yt-analytics.readonly)*
7. **Live streams** — broadcasts pasados/programados, chat, concurrent viewers, peak. *(youtube.readonly + yt-analytics.readonly)*
8. **Members / Memberships tiers** si el canal está en YPP. *(youtube.readonly)*
9. **Comentarios completos** con análisis de sentimiento, etc. — toda la conversación bajo cada vídeo. *(youtube.readonly)*
10. **Campañas de YouTube ads del creador** — performance, CPV, view rate, quartiles, demografía de quien las vio. *(adwords — cuando Basic se apruebe)*
11. **Cruce creator/advertiser** — el plato fuerte: para un mismo canal, comparar views orgánicas (Analytics) vs. views pagadas (Ads) y separar el aporte de cada uno.

## 6 · Lo que sigue fuera de OAuth (decisiones a tomar más adelante)

- **Descarga de binarios de vídeo** (para análisis de marcas en frames): `yt-dlp` sobre los URLs de los vídeos públicos del canal conectado. No requiere scope OAuth adicional. Política de retención pendiente.
- **Descarga de subtítulos completos**: `youtube.force-ssl` (write scope) — si lo quisiéramos, hay que añadirlo a la verificación.
- **Insertar/actualizar campañas, pausar ads, crear ad groups**: requeriría el `adwords` con permiso de mutate + diseño de UI completamente nuevo. Hoy es out-of-scope.

---

*Documento generado contra docs oficiales de Google el 2026-05-12. Si una API se actualiza (rotación de versiones, nuevos campos, deprecations), reverificar contra:*
- *https://developers.google.com/youtube/v3/docs*
- *https://developers.google.com/youtube/analytics/dimensions*
- *https://developers.google.com/youtube/analytics/metrics*
- *https://developers.google.com/google-ads/api/fields/v24/overview*
- *https://developers.google.com/identity/openid-connect/openid-connect#obtainuserinfo*
