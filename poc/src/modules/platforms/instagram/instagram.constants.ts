// Instagram adapter local constants. Phase E.

import type { ContentType } from '../shared/platform-types';

/** Hard cap when callers don't pin a `limit` on FetchOpts. */
export const DEFAULT_PAGE_SIZE = 25;

/** IG media type → canonical content type. */
export const MEDIA_TYPE_MAP: Record<string, ContentType> = {
  IMAGE: 'image',
  VIDEO: 'video',
  CAROUSEL_ALBUM: 'carousel',
  REELS: 'reel',
};
