import type { CommentData } from "@modules/platforms/shared/platform-types";
import type { SchemaContext } from "../context";
import type { ApiComment } from "../api-types";
import { apiCommentId, apiContentId } from "../ids";
import { buildEnvelope } from "./envelope.mapper";
import { naiveUtc } from "../serializers";

/** Optional content reference so the comment can embed content.url/published_at. */
export interface CommentContentJoin {
  url?: string | null;
  publishedAt?: Date | string | null;
}

/** CommentData → InsightIQ comment document (§4.4). */
export function toApiComment(
  ctx: SchemaContext,
  comment: CommentData,
  contentJoin?: CommentContentJoin,
): ApiComment {
  const id = apiCommentId(ctx.accountPk, comment.platformCommentId);
  const env = buildEnvelope(ctx, id, {
    updatedAt: comment.fetchedAt ?? ctx.updatedAt,
  });
  const contentUuid = apiContentId(ctx.accountPk, comment.platformContentId);
  return {
    ...env,
    text: comment.text,
    commenter_display_name: comment.authorDisplayName,
    commenter_id: null,
    commenter_username: comment.authorHandle,
    commenter_profile_url: null,
    like_count:
      typeof comment.metrics?.likes === "number" ? comment.metrics.likes : null,
    reply_count:
      typeof comment.metrics?.replies === "number"
        ? comment.metrics.replies
        : null,
    external_id: comment.platformCommentId,
    content: {
      id: contentUuid,
      url: contentJoin?.url ?? null,
      published_at: naiveUtc(contentJoin?.publishedAt ?? null),
    },
    // Additive, only-when-present (see ApiComment) — threading + publish
    // time + owner signals the InsightIQ shape drops but the UI needs.
    ...(comment.publishedAt
      ? { published_at: naiveUtc(comment.publishedAt) }
      : {}),
    ...(comment.parentCommentId
      ? { parent_comment_id: comment.parentCommentId }
      : {}),
    ...(comment.pinned === true ? { pinned: true } : {}),
    ...(comment.likedByCreator === true ? { liked_by_creator: true } : {}),
    ...(comment.isOwnerReply === true ? { is_owner_reply: true } : {}),
  };
}
