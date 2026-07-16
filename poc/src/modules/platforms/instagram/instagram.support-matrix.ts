// Instagram support matrix — declarative capability statement. Phase E +
// Phase A refactor.
//
// `engagement_new` keeps the cross-platform shape (FB/Threads/YouTube/TikTok
// all expose this key under the same name — see metrics.service.ts and the
// admin dashboard). Phase A adds a new sub-matrix `engagement_breakdowns`
// that Phase C will populate as breakdown calls land — keeping the core
// metrics list stable while breakdowns evolve independently.

import type { SupportMatrix } from '../shared/platform-types';

export const INSTAGRAM_SUPPORT_MATRIX: SupportMatrix = {
  profile: {
    username: 'supported',
    displayName: 'supported',
    biography: 'supported',
    avatarUrl: 'supported',
    followersCount: 'supported',
    followingCount: 'supported',
    postsCount: 'supported',
    verified: 'not_supported',
    accountType: 'empty_possible',
    website: 'supported', // business-discovery website field (verified live 5/5)
  },
  audience: {
    genderDistribution: 'supported',
    ageDistribution: 'supported',
    countryDistribution: 'supported',
    cityDistribution: 'supported',
    interests: 'not_supported',
  },
  engagement_new: {
    caption: 'supported',
    permalink: 'supported',
    mediaUrls: 'supported',
    likes: 'supported',
    comments: 'supported',
    saves: 'supported',
    shares: 'empty_possible',
    // Meta retired `impressions` for IG in v22 — rebranded as Views. The
    // legacy key is gone from ContentMetrics; declare `views` instead.
    views: 'supported',
    reach: 'supported',
  },
  // Phase C placeholder — populated when breakdown calls ship. Keys will
  // land as `<metric>_by_<dimension>` (e.g. `reach_by_follow_type`,
  // `views_by_media_product_type`).
  engagement_breakdowns: {},
  stories: {
    permalink: 'supported',
    mediaUrls: 'supported',
    publishedAt: 'supported',
  },
};
