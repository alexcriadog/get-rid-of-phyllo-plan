// Threads reply → CommentData mapper. Pure, no DI.
//
// Threads "replies" are the comments product. The reply object has the same
// shape as a thread plus root_post + replied_to. We treat replies whose
// `replied_to` is NOT the root post as nested (their parent is the comment
// they directly reply to); top-level replies have parentCommentId=null.

import { createHash } from 'node:crypto';
import { MONGO_COLLECTIONS } from '@shared/database/mongo.service';
import type { CommentData } from '../../shared/platform-types';
import type { ThreadsReply } from '../../shared/threads-api/threads-types';

export function threadsReplyToComment(
  reply: ThreadsReply,
  rootPostId: string,
): CommentData {
  const serialized = JSON.stringify(reply);
  const hash = createHash('sha256').update(serialized).digest('hex');

  const repliedToId = reply.replied_to?.id;
  const parentCommentId =
    repliedToId && repliedToId !== rootPostId ? repliedToId : null;

  return {
    platformCommentId: reply.id,
    platformContentId: rootPostId,
    parentCommentId,
    authorHandle: reply.username ?? null,
    authorDisplayName: null,
    text: reply.text ?? '',
    publishedAt: reply.timestamp ? safeDate(reply.timestamp) : null,
    fetchedAt: new Date(),
    metrics: {
      likes: typeof reply.likes === 'number' ? reply.likes : undefined,
      replies: typeof reply.replies === 'number' ? reply.replies : undefined,
    },
    isOwnerReply: reply.is_reply_owned_by_me ?? undefined,
    rawResponse: {
      collection: MONGO_COLLECTIONS.rawPlatformResponses,
      contentHash: hash,
    },
  };
}

function safeDate(s: string): Date | null {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
