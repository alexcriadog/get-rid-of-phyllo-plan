// Instagram support matrix — declarative capability statement. Phase E.

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
    impressions: 'supported',
    reach: 'supported',
  },
  stories: {
    permalink: 'supported',
    mediaUrls: 'supported',
    publishedAt: 'supported',
  },
};
