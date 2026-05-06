// Maps /{page_id}/tagged rows (third-party posts that mention the Page) onto
// the canonical ContentData shape. Uses pages_read_user_content under the
// hood. The key difference vs postToContent is that we set ownerHandle to
// the third-party Page name so the public Mentions UI can surface "who
// tagged us".

import { createHash } from 'node:crypto';
import { MONGO_COLLECTIONS } from '@shared/database/mongo.service';
import type { ContentData } from '../../shared/platform-types';
import {
  detectPostContentType,
  extractMediaUrls,
  extractPostMetrics,
} from './facebook-post.mapper';
import type { FacebookTaggedPost } from '../facebook.types';

export function taggedPostToContent(
  post: FacebookTaggedPost,
  selfPageId: string,
): ContentData | null {
  // Filter own-Page posts that simply tagged themselves.
  if (post.from?.id && post.from.id === selfPageId) return null;

  const metrics = extractPostMetrics(post);
  const mediaUrls = extractMediaUrls(post);
  const contentType = detectPostContentType(post);
  const serialized = JSON.stringify(post);
  const hash = createHash('sha256').update(serialized).digest('hex');

  return {
    platformContentId: post.id,
    contentType,
    caption: post.message ?? null,
    permalink: post.permalink_url ?? null,
    mediaUrls,
    thumbnailUrl: post.full_picture ?? null,
    metrics,
    publishedAt: post.created_time ? new Date(post.created_time) : null,
    fetchedAt: new Date(),
    ownerHandle: post.from?.name ?? null,
    rawResponse: {
      collection: MONGO_COLLECTIONS.rawPlatformResponses,
      contentHash: hash,
    },
  };
}
