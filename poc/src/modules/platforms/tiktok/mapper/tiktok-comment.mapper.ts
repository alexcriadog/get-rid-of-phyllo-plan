// TikTok comment mapper. F3.

import { createHash } from 'node:crypto';
import { MONGO_COLLECTIONS } from '@shared/database/mongo.service';
import type { CommentData } from '../../shared/platform-types';
import type { TikTokComment } from '../../shared/tiktok-api';

export function commentToCommentData(
  comment: TikTokComment,
  /** Required because `/business/comment/list/` returns `video_id` but
   * `/business/comment/reply/list/` may not — caller passes it. */
  videoId: string,
): CommentData {
  const serialized = JSON.stringify(comment);
  const hash = createHash('sha256').update(serialized).digest('hex');

  return {
    platformCommentId: comment.comment_id,
    platformContentId: comment.video_id ?? videoId,
    parentCommentId: comment.parent_comment_id ?? null,
    authorHandle: comment.username ?? null,
    authorDisplayName: comment.display_name ?? null,
    text: comment.text ?? '',
    publishedAt:
      typeof comment.create_time === 'number'
        ? new Date(comment.create_time * 1000)
        : null,
    fetchedAt: new Date(),
    metrics: {
      likes: typeof comment.like_count === 'number' ? comment.like_count : undefined,
      replies:
        typeof comment.reply_count === 'number' ? comment.reply_count : undefined,
    },
    pinned: comment.pinned,
    likedByCreator: comment.liked_by_creator,
    isOwnerReply: comment.is_owner,
    rawResponse: {
      collection: MONGO_COLLECTIONS.rawPlatformResponses,
      contentHash: hash,
    },
  };
}
