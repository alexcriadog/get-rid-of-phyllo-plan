Here's the complete rundown of every piece of Phyllo/InsightIQ logic in this codebase. Note: Phyllo was rebranded to    
  InsightIQ — the SDK/API code uses InsightIQ* class names, but domain/business terminology still says "Phyllo".
                                                                                          
  1. Module layout (src/modules/oauth/)                                                                                   
                                                                                                                          
  Hexagonal, split into domain/, infrastructure/, application/, interfaces/.                                              
                                                                                                                          
  - Domain interfaces (ports) describe what we need from the provider:                                                    
    - OAuthIdentityAPI — users + SDK tokens
    - OAuthAccountAPI — accounts, disconnect, refresh                                                                     
    - OAuthProfileAPI — profile info                                                                                      
    - OAuthProfileAudienceAPI — audience demographics                                                                     
    - OAuthContentAPI — posts/content                                                                                     
  - Infrastructure adapters implement them against InsightIQ's REST API:                                                  
    - InsightIQIdentityAdapter, InsightIQAccountAdapter, InsightIQProfileAdapter, InsightIQProfileAudienceAdapter,        
  InsightIQContentAdapter                                                                                                 
    - All use basic auth (INSIGHTIQ_CLIENT_KEY:INSIGHTIQ_SECRET_KEY base64) against API_ACTIVE_URL, with fetchWithRetry.  
                                                                                                                          
  2. REST endpoints we expose
                                                                                                                          
  OAuthController at /oauth (src/modules/oauth/interfaces/oauth.controller.ts):                                           
  
  ┌─────────────────────────────────┬─────────────────────────────────────────────────────────────────────────────────┐   
  │            Endpoint             │                                     Purpose                                     │
  ├─────────────────────────────────┼─────────────────────────────────────────────────────────────────────────────────┤
  │                                 │ Creates/returns a Phyllo user + SDK token for the frontend Connect SDK. Keyed   │
  │ POST /oauth/create              │ by externalUserId in the format organizationId_.... Caches the SDK token in     │
  │                                 │ user_token until expiry (CreateUserUseCase).                                    │   
  ├─────────────────────────────────┼─────────────────────────────────────────────────────────────────────────────────┤
  │                                 │ Marks an existing connection_method row as freshly refreshed — pushes           │   
  │ POST /oauth/refresh             │ expires_at out based on platform.token_validity, clears disconnected_at, logs   │   
  │                                 │ phyllo_account_refreshed (RefreshAccountConnectionUseCase).                     │
  ├─────────────────────────────────┼─────────────────────────────────────────────────────────────────────────────────┤   
  │ POST /oauth/webhook-receiver    │ The webhook entry point. Signature-validates, dispatches by event.              │
  ├─────────────────────────────────┼─────────────────────────────────────────────────────────────────────────────────┤   
  │ POST                            │ Health probe.                                                                   │
  │ /oauth/webhook-receiver/health  │                                                                                 │   
  ├─────────────────────────────────┼─────────────────────────────────────────────────────────────────────────────────┤   
  │ POST /oauth/webhook-test        │ Dev helper — manually triggers profile+content handlers.                        │
  └─────────────────────────────────┴─────────────────────────────────────────────────────────────────────────────────┘   
                  
  Plus on the UI side: DisconnectPhylloAccountUseCase                                                                     
  (src/modules/ui-api/application/settings/integration/disconnect-phyllo-account.usecase.ts) which calls POST 
  /v1/accounts/{id}/disconnect on Phyllo, logs, and emails.                                                               
                  
  3. Webhook pipeline                                                                                                     
  
  POST /oauth/webhook-receiver steps (oauth.controller.ts:164):                                                           
                  
  1. Signature check — verifyWebhookSignature (infrastructure/utils/insight-iq/webhook.utils.ts) does HMAC-SHA256 with    
  INSIGHTIQ_SECRET_KEY, constant-time compare against the webhook-signatures header. Supports multi-secret rotation.
  2. Immediately 200-ack so Phyllo's 5s timeout doesn't fire.                                                             
  3. Parse the raw Buffer as JSON → WebhookEventPayload { event, id, data: { account_id, user_id, profile_id?, items?,    
  last_updated_time } }.                                                                                                  
  4. switch on payload.event, dispatch to the matching use case, and log success/failure to MongoDB via                   
  ProcessLogRepository (source: 'phyllo', typed phyllo_*).                                                                
                  
  Event → handler mapping                                                                                                 
                  
  ┌──────────────────────────────────────────────────────────────────────┬───────────────────────────────┬────────────┐   
  │                             Phyllo event                             │            Handler            │  What it   │
  │                                                                      │                               │    does    │
  ├──────────────────────────────────────────────────────────────────────┼───────────────────────────────┼────────────┤
  │ ACCOUNTS.DISCONNECTED, SESSION.EXPIRED                               │ OnDisconnectedAccountUseCase  │ See §4     │
  ├──────────────────────────────────────────────────────────────────────┼───────────────────────────────┼────────────┤   
  │ PROFILES.ADDED, PROFILES.UPDATED                                     │ OnAddedProfileUseCase         │ See §5     │   
  ├──────────────────────────────────────────────────────────────────────┼───────────────────────────────┼────────────┤   
  │ CONTENTS.ADDED, CONTENTS.UPDATED, CONTENT-GROUPS.ADDED,              │ OnAddedContentUseCase         │ See §6     │   
  │ CONTENT-GROUPS.UPDATED                                               │                               │            │
  ├──────────────────────────────────────────────────────────────────────┼───────────────────────────────┼────────────┤   
  │ PROFILES_AUDIENCE.ADDED, PROFILES_AUDIENCE.UPDATED                   │ OnAddedProfileAudienceUseCase │ See §7     │
  └──────────────────────────────────────────────────────────────────────┴───────────────────────────────┴────────────┘   
  
  Note: there is no ACCOUNTS.CONNECTED webhook path. "Connect" is driven by the frontend calling our own                  
  /integration/account-setup (which runs OnConnectedAccountUseCase); the controller's handleAccountConnectedUseCase
  injection is only used by /webhook-test.                                                                                
                  
  4. OnConnectedAccountUseCase (connect flow)                                                                             
  
  Input: { phyllo_account_id, platform_id, user_id, organization_id, contract_id, brands, created_at, visible_users?,     
  is_ig_direct? }.
                                                                                                                          
  1. OAuthAccountAPI.getAccountById → verify account exists in InsightIQ.                                                 
  2. Resolve the real userPlatformId:
    - Facebook → getFacebookPageId (Graph API, retry 2s/5s/10s).                                                          
    - TikTok → getTikTokAccountInfo (TikAPI, retry).                                                                      
    - Instagram Direct → getInstagramDirectAccountId (retry).                                                             
    - Otherwise use insightIqAccount.platformUserId as-is.                                                                
  3. Upsert the account row in Postgres (official → unofficial → platform-id match → create new).                         
  4. Create account_external_info(account_id, phyllo_account_id, organization_id) for first-time connect.                 
  5. YouTube special case — immediately accountMongoRepo.save(...) and set is_active = true, because the PROFILES.ADDED   
  webhook is skipped for YouTube (scraped elsewhere).                                                                     
  6. Create or update user_account_organization_contract. For non-YouTube it starts isActive=false and flips true once the
   profile webhook succeeds. If the account is NOT already oAuth-connected, other orgs' contracts are restricted so only  
  the official org keeps the account.
  7. Create/update the connection_method row (type oAuth, connected_at = params.created_at, expires_at = created_at +     
  platform.token_validity hours, clears disconnected_at). Reconnect detection: snapshots wasDisconnected before mutation  
  so the process log can distinguish reconnect vs duplicate connect.
  8. Insert user_account_organization_brand_contract rows for any provided brands.                                        
  9. Upsert user_visible_account entries for visible_users (filters by allowed roles 0/3/4).                              
  10. Fire-and-trigger POST /v1/profiles/refresh and POST /v1/social/contents/refresh on InsightIQ — this is what makes   
  Phyllo queue the profile/content webhooks back to us.                                                                   
  11. Delete the pending_account_connection row (if any).                                                                 
  12. Log phyllo_account_connected / "Phyllo Account Reconnected" to Mongo.                                               
                  
  5. OnAddedProfileUseCase                                                                                                
                  
  1. phylloAccountValidation (see §8) to confirm account + oAuth contract.                                                
  2. OAuthProfileAPI.getProfileByAccount(account_id).
  3. YouTube short-circuit — skip entirely (handled by scraper).                                                          
  4. Sanity-check profile.platformProfileId === account.userPlatformId (skipped for TikTok/Facebook/Instagram Direct where
   IDs differ).                                                                                                           
  5. Parse with OAuthProfileParser.toAccount → save/update the Mongo accounts doc.                                        
  6. TikTok fallback: if secure_id is missing, fetch via getTikTokAccountInfo and re-save.                                
  7. Build today's accounts_stats_history entry; set followers_growth = todayFollowers - yesterdayFollowers (via          
  getLastByAccountId).                                                                                                    
  8. Write followers_growth back onto the Mongo account.                                                                  
                                                                                                                          
  6. OnAddedContentUseCase (the heavyweight one)                                                                          
                                                                                                                          
  Input: account_id, user_id, items[], last_updated_time. Currently re-fetches everything rather than trusting items.     
                  
  1. Throttle lock — Redis key webhook_throttle:content_added:{account_id} with WEBHOOK_THROTTLE_TTL = 600s (NX). If      
  already held, skip and log webhook-throttle.
  2. phylloAccountValidation + profile fetch. YouTube short-circuits out.                                                 
  3. Fetch all content via getAllContentForAccount:                                                                       
    - Two parallel paged loops (is_content_group = false and true), limit=100, stops when page < limit.                   
    - The commented-out stories-only path would fetch last 48h instead.                                                   
  4. For each item:                                                                                                       
    - Skip X/Twitter reposts (RT @).                                                                                      
    - Compute average engagement rate and viral post IDs for the account.                                                 
    - Parse via OAuthContentParser.toPlatformPost → enriches with viral flag, isViral/eventData, economic-value pricing   
  from the contract.                                                                                                      
    - Brand detection — matches post caption_hashtags and caption_mentions against org BrandKeywords.                     
    - Paid-post detection — hashtag match against Paid Hashtags indicators, caption regex against Promotional Language    
  indicators.                                                                                                             
    - Build ContentToDownload items per media URL (carousels → N entries).                                                
  5. Bulk upsert posts to Mongo (postsRepo.bulkUpsertPosts).                                                              
  6. Aggregate totals by day → upsert accounts_posts_stats_history (avgEngagement is divided by post count at the end).   
  7. Download + upload media to S3 (downloadAllMedia):                                                                    
    - S3_UPLOAD_CONCURRENCY = 5 for "other" platforms (IG, X, FB images).                                                 
    - YouTube/Twitch videos go through yt-dlp with their own concurrency + inter-launch delay (YT_DOWNLOAD_CONCURRENCY,   
  YT_INTER_DOWNLOAD_DELAY_MS).                                                                                            
    - TikTok videos use downloadTikTokVideo (TikAPI) with its own limiter.                                                
    - Facebook videos are special: InsightIQ returns an image URL for FB videos. We lazily call RapidAPI via              
  withFacebookVideoRateLimit + fetchFacebookVideoDetails per unique post URL (deduped via fbResolutionCache). Priority:   
  InsightIQ direct mediaUrl → RapidAPI resolved URL → skip video, keep thumbnail. Per-batch stats (insightIqDirect,       
  rapidApiResolved, rapidApiIndexMissing, rapidApiFailed) are rolled up into one summary log at end, with up to 5 sample  
  failures.       
    - Thumbnail fallback chain for videos: provider thumbnail URL → ffmpeg frame extraction (extractThumbnailFromVideo) —
  but skipped if the video upload itself failed or mediaUrl isn't a real video URL.                                       
  8. On error, delete the Redis throttle lock (so retries can proceed) and throw. Also deletes the legacy
  content_processing:{account}:{YYYY-MM-DD} key in the controller's catch.                                                
  9. Returns { processedPosts, totalContentFetched, mediaUploaded } for the success log.
                                                                                                                          
  7. OnAddedProfileAudienceUseCase                                                                                        
                                                                                                                          
  1. phylloAccountValidation.                                                                                             
  2. OAuthProfileAudienceAPI.getProfileByAccount(account_id).
  3. Parse and save current audience snapshot in Mongo accounts_audience_demographics.                                    
  4. Save dated history entry in accounts_audience_demographics_history (countries/cities/gender-age).                    
  5. processCitiesCountryCodes — take top 50 cities, find which aren't yet in city_country_code, resolve their country    
  codes in a single batch Groq call (getCountryCodesForCities), look up country IDs, bulk insert.                         
                                                                                                                          
  8. OnDisconnectedAccountUseCase (disconnect flow)                                                                       
                  
  Triggered by ACCOUNTS.DISCONNECTED or SESSION.EXPIRED.                                                                  
  
  1. OAuthAccountAPI.getAccountById → verifies and extracts userName (format organizationId_platformId) to know which org 
  disconnected.   
  2. Snapshot connection_method before mutation → wasAlreadyDisconnected for duplicate-webhook detection.                 
  3. Delete the account_external_info row for this specific phyllo_account_id (one row per (account, org) oAuth           
  connection).                                                                                                            
  4. Check remaining account_external_info for the account → hasOtherOAuthConnections:                                    
    - No other orgs → set this org's contracts to isActive=false (YouTube: keep true); upsert connection_method to type   
  Scraping with disconnected_at = now; YouTube: restore restricted contracts so scraping resumes.                         
    - Another org is still official → mark the disconnected org's contracts as isRestricted=true (YouTube: keep           
  is_active=true); safety-sweep other non-official orgs that were erroneously left active.                                
  5. Log phyllo_account_disconnected with hasOtherOAuthConnections + alreadyDisconnected flags.
                                                                                                                          
  phylloAccountValidation (infrastructure/utils/phylloAccountValidation.ts) is the common guard used by                   
  profile/content/audience handlers: verifies the account exists in Postgres with a non-null userPlatformId, has a        
  user_account_organization_contract, and has an active oAuth connection_method. Anything else → BadRequestException.     
                  
  9. Cron jobs

  - ConnectionMethodExpirationCron (@Cron EVERY_DAY_AT_5PM) — finds connection_method rows expiring in exactly 14 / 7 / 3 
  / 1 days; groups by account_id; resolves visible shared users via user_visible_account; sends bilingual (ES/EN) bulk
  notifications via SendBulkNotificationUseCase with urgency-driven level (ERROR ≤1 day, WARNING ≤3, else INFO). Relies on
   expires_at which is set by OnConnectedAccountUseCase and bumped by RefreshAccountConnectionUseCase.
  - AccountStatsUpdaterCron — separate cron in the same module (not Phyllo-webhook-specific).
                                                                                                                          
  10. Observability                                                                                                       
                                                                                                                          
  Every webhook handler (success + error) writes a record to Mongo process_log via ProcessLogRepository.create with:      
                  
  - type: phyllo_profile_added / phyllo_content_added / phyllo_account_connected / phyllo_account_disconnected /          
  phyllo_account_refreshed / phyllo_session_expired / webhook-throttle etc.
  - source: 'phyllo', level: success|error|info, processId: payload.id                                                    
  - metadata: startedAt, finishedAt, durationMs, accountId, userId, event, plus handler-specific fields (processedPosts,  
  isReconnect, hasOtherOAuthConnections, redisKeyRemoved, etc.)                                                           
                                                                                                                          
  11. Config / env                                                                                                        
                  
  - API_ACTIVE_URL — Phyllo base URL.                                                                                     
  - INSIGHTIQ_CLIENT_KEY / INSIGHTIQ_SECRET_KEY — basic auth and the HMAC secret used both for outbound auth and inbound
  webhook signature verification.                                                                                         
  - SDK token products requested: IDENTITY, IDENTITY.AUDIENCE, ENGAGEMENT, ENGAGEMENT.AUDIENCE.
                                                                                                                          
✻ Cooked for 3m 0s                                             
                                                                                                                          
──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
❯                                                                                                                         
──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  ? for shortcuts                                                                                                         
                                                                                                                          
    - YouTube/Twitch videos go through yt-dlp with their own concurrency + inter-launch delay (YT_DOWNLOAD_CONCURRENCY, YT_INTER_DOWNLOAD_DELAY_MS).
    - TikTok videos use downloadTikTokVideo (TikAPI) with its own limiter.
    - Facebook videos are special: InsightIQ returns an image URL for FB videos. We lazily call RapidAPI via withFacebookVideoRateLimit +
  fetchFacebookVideoDetails per unique post URL (deduped via fbResolutionCache). Priority: InsightIQ direct mediaUrl → RapidAPI resolved URL → skip video,
  keep thumbnail. Per-batch stats (insightIqDirect, rapidApiResolved, rapidApiIndexMissing, rapidApiFailed) are rolled up into one summary log at end, with
   up to 5 sample failures.
    - Thumbnail fallback chain for videos: provider thumbnail URL → ffmpeg frame extraction (extractThumbnailFromVideo) — but skipped if the video upload
  itself failed or mediaUrl isn't a real video URL.
  8. On error, delete the Redis throttle lock (so retries can proceed) and throw. Also deletes the legacy content_processing:{account}:{YYYY-MM-DD} key in
  the controller's catch.
  9. Returns { processedPosts, totalContentFetched, mediaUploaded } for the success log.

  7. OnAddedProfileAudienceUseCase

  1. phylloAccountValidation.
  2. OAuthProfileAudienceAPI.getProfileByAccount(account_id).
  3. Parse and save current audience snapshot in Mongo accounts_audience_demographics.
  4. Save dated history entry in accounts_audience_demographics_history (countries/cities/gender-age).
  5. processCitiesCountryCodes — take top 50 cities, find which aren't yet in city_country_code, resolve their country codes in a single batch Groq call
  (getCountryCodesForCities), look up country IDs, bulk insert.

  8. OnDisconnectedAccountUseCase (disconnect flow)

  Triggered by ACCOUNTS.DISCONNECTED or SESSION.EXPIRED.

  1. OAuthAccountAPI.getAccountById → verifies and extracts userName (format organizationId_platformId) to know which org disconnected.
  2. Snapshot connection_method before mutation → wasAlreadyDisconnected for duplicate-webhook detection.
  3. Delete the account_external_info row for this specific phyllo_account_id (one row per (account, org) oAuth connection).
  4. Check remaining account_external_info for the account → hasOtherOAuthConnections:
    - No other orgs → set this org's contracts to isActive=false (YouTube: keep true); upsert connection_method to type Scraping with disconnected_at =
  now; YouTube: restore restricted contracts so scraping resumes.
    - Another org is still official → mark the disconnected org's contracts as isRestricted=true (YouTube: keep is_active=true); safety-sweep other
  non-official orgs that were erroneously left active.
  5. Log phyllo_account_disconnected with hasOtherOAuthConnections + alreadyDisconnected flags.

  phylloAccountValidation (infrastructure/utils/phylloAccountValidation.ts) is the common guard used by profile/content/audience handlers: verifies the
  account exists in Postgres with a non-null userPlatformId, has a user_account_organization_contract, and has an active oAuth connection_method. Anything
  else → BadRequestException.

  9. Cron jobs

  - ConnectionMethodExpirationCron (@Cron EVERY_DAY_AT_5PM) — finds connection_method rows expiring in exactly 14 / 7 / 3 / 1 days; groups by account_id;
  resolves visible shared users via user_visible_account; sends bilingual (ES/EN) bulk notifications via SendBulkNotificationUseCase with urgency-driven
  level (ERROR ≤1 day, WARNING ≤3, else INFO). Relies on expires_at which is set by OnConnectedAccountUseCase and bumped by
  RefreshAccountConnectionUseCase.
  - AccountStatsUpdaterCron — separate cron in the same module (not Phyllo-webhook-specific).

  10. Observability

  Every webhook handler (success + error) writes a record to Mongo process_log via ProcessLogRepository.create with:

  - type: phyllo_profile_added / phyllo_content_added / phyllo_account_connected / phyllo_account_disconnected / phyllo_account_refreshed /
  phyllo_session_expired / webhook-throttle etc.
  - source: 'phyllo', level: success|error|info, processId: payload.id
  - metadata: startedAt, finishedAt, durationMs, accountId, userId, event, plus handler-specific fields (processedPosts, isReconnect,
  hasOtherOAuthConnections, redisKeyRemoved, etc.)

  11. Config / env

  - API_ACTIVE_URL — Phyllo base URL.
  - INSIGHTIQ_CLIENT_KEY / INSIGHTIQ_SECRET_KEY — basic auth and the HMAC secret used both for outbound auth and inbound webhook signature verification.
  - SDK token products requested: IDENTITY, IDENTITY.AUDIENCE, ENGAGEMENT, ENGAGEMENT.AUDIENCE.