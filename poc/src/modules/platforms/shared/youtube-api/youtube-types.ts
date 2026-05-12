// YouTube API JSON shapes — minimal, stable subset of googleapis types.
//
// We re-declare the fields we actually consume so a major-version bump of
// googleapis doesn't cascade into mappers. Source for every field:
// https://developers.google.com/youtube/v3/docs and
// https://developers.google.com/youtube/analytics/reference/reports/query.

// ---------------- Data API v3 ----------------

export interface YoutubeThumbnail {
  url?: string | null;
  width?: number | null;
  height?: number | null;
}

export interface YoutubeThumbnailSet {
  default?: YoutubeThumbnail;
  medium?: YoutubeThumbnail;
  high?: YoutubeThumbnail;
  standard?: YoutubeThumbnail;
  maxres?: YoutubeThumbnail;
}

export interface YoutubeChannelSnippet {
  title?: string | null;
  description?: string | null;
  customUrl?: string | null;
  publishedAt?: string | null;
  thumbnails?: YoutubeThumbnailSet;
  country?: string | null;
  defaultLanguage?: string | null;
}

export interface YoutubeChannelStatistics {
  viewCount?: string | null;
  subscriberCount?: string | null;
  hiddenSubscriberCount?: boolean;
  videoCount?: string | null;
}

export interface YoutubeChannelContentDetails {
  relatedPlaylists?: { uploads?: string | null; likes?: string | null };
}

export interface YoutubeChannelBranding {
  channel?: { keywords?: string | null; country?: string | null };
  image?: { bannerExternalUrl?: string | null };
}

export interface YoutubeChannelTopicDetails {
  topicCategories?: string[];
}

export interface YoutubeChannelStatus {
  privacyStatus?: string | null;
  madeForKids?: boolean;
  selfDeclaredMadeForKids?: boolean;
  longUploadsStatus?: string | null;
  isLinked?: boolean;
}

export interface YoutubeChannel {
  id?: string | null;
  snippet?: YoutubeChannelSnippet;
  statistics?: YoutubeChannelStatistics;
  contentDetails?: YoutubeChannelContentDetails;
  brandingSettings?: YoutubeChannelBranding;
  topicDetails?: YoutubeChannelTopicDetails;
  status?: YoutubeChannelStatus;
}

export interface YoutubePlaylistItemSnippet {
  publishedAt?: string | null;
  channelId?: string | null;
  title?: string | null;
  resourceId?: { kind?: string; videoId?: string | null };
}

export interface YoutubePlaylistItemContentDetails {
  videoId?: string | null;
  videoPublishedAt?: string | null;
}

export interface YoutubePlaylistItem {
  id?: string | null;
  snippet?: YoutubePlaylistItemSnippet;
  contentDetails?: YoutubePlaylistItemContentDetails;
}

export interface YoutubeVideoSnippet {
  publishedAt?: string | null;
  channelId?: string | null;
  title?: string | null;
  description?: string | null;
  thumbnails?: YoutubeThumbnailSet;
  tags?: string[];
  categoryId?: string | null;
  defaultLanguage?: string | null;
  defaultAudioLanguage?: string | null;
  liveBroadcastContent?: 'none' | 'upcoming' | 'live' | string | null;
}

export interface YoutubeVideoStatistics {
  viewCount?: string | null;
  likeCount?: string | null;
  favoriteCount?: string | null;
  commentCount?: string | null;
}

export interface YoutubeVideoContentDetails {
  duration?: string | null;
  dimension?: string | null;
  definition?: string | null;
  caption?: string | null;
  licensedContent?: boolean;
  contentRating?: Record<string, unknown>;
  regionRestriction?: { allowed?: string[]; blocked?: string[] };
}

export interface YoutubeVideoStatus {
  uploadStatus?: string | null;
  privacyStatus?: 'public' | 'unlisted' | 'private' | string | null;
  madeForKids?: boolean;
  selfDeclaredMadeForKids?: boolean;
  license?: string | null;
  embeddable?: boolean;
  publicStatsViewable?: boolean;
  failureReason?: string | null;
  rejectionReason?: string | null;
  publishAt?: string | null;
}

export interface YoutubeLiveStreamingDetails {
  actualStartTime?: string | null;
  actualEndTime?: string | null;
  scheduledStartTime?: string | null;
  scheduledEndTime?: string | null;
  concurrentViewers?: string | null;
  activeLiveChatId?: string | null;
}

export interface YoutubeVideoTopicDetails {
  topicCategories?: string[];
}

export interface YoutubeVideoRecordingDetails {
  recordingDate?: string | null;
  location?: {
    latitude?: number;
    longitude?: number;
    altitude?: number;
  };
  locationDescription?: string | null;
}

export interface YoutubeVideo {
  id?: string | null;
  snippet?: YoutubeVideoSnippet;
  statistics?: YoutubeVideoStatistics;
  contentDetails?: YoutubeVideoContentDetails;
  status?: YoutubeVideoStatus;
  liveStreamingDetails?: YoutubeLiveStreamingDetails;
  topicDetails?: YoutubeVideoTopicDetails;
  recordingDetails?: YoutubeVideoRecordingDetails;
}

export interface YoutubeCommentSnippet {
  textDisplay?: string | null;
  textOriginal?: string | null;
  authorDisplayName?: string | null;
  authorProfileImageUrl?: string | null;
  authorChannelId?: { value?: string | null };
  authorChannelUrl?: string | null;
  likeCount?: number | null;
  publishedAt?: string | null;
  updatedAt?: string | null;
  parentId?: string | null;
}

export interface YoutubeComment {
  id?: string | null;
  snippet?: YoutubeCommentSnippet;
}

export interface YoutubeCommentThread {
  id?: string | null;
  snippet?: {
    videoId?: string | null;
    topLevelComment?: YoutubeComment;
    totalReplyCount?: number;
    canReply?: boolean;
    isPublic?: boolean;
  };
  replies?: { comments?: YoutubeComment[] };
}

export interface YoutubeListResponse<T> {
  kind?: string;
  etag?: string;
  nextPageToken?: string | null;
  prevPageToken?: string | null;
  pageInfo?: { totalResults?: number; resultsPerPage?: number };
  items?: T[];
}

// ---------------- Analytics API v2 ----------------

export interface YoutubeAnalyticsColumnHeader {
  name?: string;
  columnType?: 'DIMENSION' | 'METRIC' | string;
  dataType?: 'STRING' | 'INTEGER' | 'FLOAT' | string;
}

export interface YoutubeAnalyticsReport {
  kind?: string;
  columnHeaders?: YoutubeAnalyticsColumnHeader[];
  rows?: Array<Array<string | number>>;
}

// ---------------- OAuth ----------------

export interface YoutubeOAuthCredentials {
  accessToken: string;
  refreshToken?: string | null;
  expiryDate?: number | null;
  scopes?: string[];
}
