// socialActions/{postUrn}/comments element → canonical CommentData.
//
// Limitation: `actor` is a bare person/organization URN — resolving display
// names would cost one extra call per unique commenter (and person lookup is
// not permitted for arbitrary members), so authorHandle carries the URN and
// authorDisplayName stays null. The UI can still thread + count.

import type { CommentData } from '../../shared/platform-types';
import type { LinkedInComment } from '../../shared/linkedin-api/linkedin-types';

const RAW_REF = { collection: 'raw_platform_responses', contentHash: '' };

export function linkedInCommentToComment(
  comment: LinkedInComment,
  postUrn: string,
): CommentData {
  const id =
    comment.$URN ??
    comment.commentUrn ??
    (comment.id != null ? String(comment.id) : '');
  const likes =
    comment.likesSummary?.totalLikes ??
    comment.likesSummary?.aggregatedTotalLikes;

  return {
    platformCommentId: id,
    platformContentId: postUrn,
    parentCommentId: comment.parentComment ?? null,
    authorHandle: comment.actor ?? null,
    authorDisplayName: null,
    text: comment.message?.text ?? '',
    publishedAt: comment.created?.time ? new Date(comment.created.time) : null,
    fetchedAt: new Date(),
    metrics: {
      ...(typeof likes === 'number' ? { likes } : {}),
    },
    rawResponse: RAW_REF,
  };
}
