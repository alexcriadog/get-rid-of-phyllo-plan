// Maps /{post_id}/comments rows onto the canonical CommentData shape. With
// pages_read_user_content the `from{id,name}` field is now populated for
// user comments (previously only the Page admin's own comments carried it).

import { createHash } from 'node:crypto';
import { MONGO_COLLECTIONS } from '@shared/database/mongo.service';
import type { CommentData } from '../../shared/platform-types';
import type { FacebookCommentRow } from '../facebook.types';

export function commentRowToComment(
  row: FacebookCommentRow,
  postId: string,
  selfPageId: string,
): CommentData {
  const serialized = JSON.stringify(row);
  const hash = createHash('sha256').update(serialized).digest('hex');
  const fromId = row.from?.id ?? null;
  const fromName = row.from?.name ?? null;
  return {
    platformCommentId: row.id,
    platformContentId: postId,
    parentCommentId: row.parent?.id ?? null,
    authorHandle: fromId,
    authorDisplayName: fromName,
    text: row.message ?? '',
    publishedAt: row.created_time ? new Date(row.created_time) : null,
    fetchedAt: new Date(),
    metrics: {
      likes: typeof row.like_count === 'number' ? row.like_count : undefined,
      replies:
        typeof row.comment_count === 'number' ? row.comment_count : undefined,
    },
    isOwnerReply: fromId !== null && fromId === selfPageId,
    rawResponse: {
      collection: MONGO_COLLECTIONS.rawPlatformResponses,
      contentHash: hash,
    },
  };
}
