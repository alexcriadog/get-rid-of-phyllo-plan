/**
 * Connect Studio shared types — ported verbatim from the legacy
 * `pages/admin/connect.tsx` so the restyle does not drift from the real
 * /admin/connect/discover + /admin/connect/seed contract.
 */

export type DiscoveredPage = {
  page_id: string;
  page_name: string;
  // Sec C-3: discover no longer returns the live Page token; it returns a
  // short-lived, single-use server-side ref we pass to /admin/connect/seed.
  page_token_ref: string;
  page_already_connected: boolean;
  instagram?: {
    ig_business_id: string;
    username: string | null;
    name: string | null;
    followers_count: number | null;
    profile_picture_url: string | null;
    already_connected: boolean;
  };
};

export type TikTokDiscoveredAccount = {
  open_id: string;
  username: string | null;
  display_name: string | null;
  profile_image: string | null;
  followers_count: number | null;
  following_count: number | null;
  videos_count: number | null;
  total_likes: number | null;
  is_verified: boolean | null;
  already_connected: boolean;
};

export type ThreadsDiscoveredAccount = {
  user_id: string;
  username: string | null;
  name: string | null;
  profile_picture_url: string | null;
  biography: string | null;
  is_verified: boolean | null;
  already_connected: boolean;
};

export type DiscoverResponse = {
  me: { id: string | null; name: string | null };
  token_type:
    | 'user'
    | 'page'
    | 'unknown'
    | 'tiktok-business'
    | 'threads-user';
  pages: DiscoveredPage[];
  tiktok_account?: TikTokDiscoveredAccount;
  threads_account?: ThreadsDiscoveredAccount;
  warnings: string[];
};

export type SeedResponse = {
  account_id: string;
  sync_jobs_created: string[];
};

export type ConnectKey = string; // `${platform}:${id}`

export type SeedBody = {
  platform: 'instagram' | 'facebook' | 'tiktok' | 'threads';
  // Exactly one of these. FB/IG seeds from discover use a broker ref
  // (Sec C-3); manual/tiktok/threads paste flows send the raw token.
  access_token?: string;
  page_token_ref?: string;
  refresh_token?: string;
  expires_at?: string; // ISO 8601 with offset
  canonical_user_id: string;
  handle?: string;
  metadata?: Record<string, unknown>;
  workspace_slug?: string;
};

/** Platforms the Discover step supports. */
export type DiscoverPlatform = 'facebook' | 'tiktok' | 'threads';

/** Map of connect-key → seed result (success object) or error string. */
export type ResultMap = Record<ConnectKey, SeedResponse | string>;

export type ConnectFn = (key: ConnectKey, body: SeedBody) => Promise<void>;

/** Narrow a result entry to a successful seed response, or null. */
export function asSeedSuccess(
  result: SeedResponse | string | undefined,
): SeedResponse | null {
  return result && typeof result === 'object' && 'account_id' in result
    ? result
    : null;
}

/** Narrow a result entry to an error string, or null. */
export function asSeedError(
  result: SeedResponse | string | undefined,
): string | null {
  return typeof result === 'string' ? result : null;
}
