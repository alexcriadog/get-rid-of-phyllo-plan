// Per-platform product catalog. Mirrors poc/src/modules/accounts/accounts.service.ts
// PRODUCTS_BY_PLATFORM. Hardcoded here on purpose — connect-tool is
// transient, the duplication dies with it. Sync this file by hand if
// products change in POC.
//
// `required:true` → checkbox disabled (always on). For products the rest
// of the data model assumes (identity).
// `default:true`  → checkbox starts ticked.
// `default:false` → opt-in, e.g. ads.

import type { PlatformKey } from './platforms';

export interface ProductDef {
  id: string;
  label: string;
  hint?: string;
  required?: boolean;
  default?: boolean;
}

export const PRODUCT_CATALOG: Record<PlatformKey, ProductDef[]> = {
  facebook: [
    { id: 'identity', label: 'Profile', required: true, default: true, hint: 'Page metadata' },
    { id: 'audience', label: 'Audience', default: true, hint: 'Country + city distribution' },
    { id: 'engagement_new', label: 'Posts + metrics', default: true, hint: 'Reactions, comments, reach' },
    { id: 'stories', label: 'Stories', default: true, hint: 'Page Stories API (24h-expiring)' },
    { id: 'mentions', label: 'Tagged posts (UGC)', default: true, hint: '/tagged — pages_read_user_content' },
    { id: 'comments', label: 'Comments', default: true, hint: 'With user identity' },
    { id: 'ratings', label: 'Page reviews', default: true, hint: 'Star ratings + recommendation text' },
    { id: 'ads', label: 'Ad insights', default: false, hint: 'ads_read — needs USER token' },
  ],
  instagram: [
    { id: 'identity', label: 'Profile', required: true, default: true },
    { id: 'audience', label: 'Audience', default: true },
    { id: 'engagement_new', label: 'Posts + metrics', default: true },
    { id: 'stories', label: 'Stories', default: true },
  ],
  tiktok: [
    { id: 'identity', label: 'Profile', required: true, default: true },
    { id: 'audience', label: 'Audience', default: true },
    { id: 'engagement_new', label: 'Videos + metrics', default: true },
    { id: 'comments', label: 'Comments on top videos', default: true },
  ],
  threads: [
    { id: 'identity', label: 'Profile', required: true, default: true },
    { id: 'audience', label: 'Audience', default: true },
    { id: 'engagement_new', label: 'Threads + metrics', default: true },
    { id: 'comments', label: 'Replies', default: true },
    { id: 'mentions', label: 'Mentions (@-tags)', default: true },
  ],
  youtube: [
    { id: 'identity', label: 'Channel info', required: true, default: true },
    { id: 'audience', label: 'Audience', default: true, hint: 'Analytics API' },
    { id: 'engagement_new', label: 'Videos + metrics', default: true },
    { id: 'engagement_deep', label: 'Per-video analytics', default: true, hint: 'Watch time, retention, traffic sources' },
    { id: 'comments', label: 'Comments on top videos', default: true },
    { id: 'ads', label: 'Ad insights', default: false, hint: 'Requires linked ads access' },
  ],
  twitch: [
    {
      id: 'identity',
      label: 'Channel + followers + subs',
      required: true,
      default: true,
      hint: 'Profile, follower count, subscriber count + tier breakdown',
    },
    {
      id: 'engagement_new',
      label: 'VODs + clips',
      default: true,
      hint: 'Past broadcasts and recent clips with view counts',
    },
  ],
};

export function defaultSelectedProducts(platform: PlatformKey): string[] {
  return PRODUCT_CATALOG[platform]
    .filter((p) => p.required || p.default)
    .map((p) => p.id);
}

export function requiredProducts(platform: PlatformKey): string[] {
  return PRODUCT_CATALOG[platform].filter((p) => p.required).map((p) => p.id);
}
