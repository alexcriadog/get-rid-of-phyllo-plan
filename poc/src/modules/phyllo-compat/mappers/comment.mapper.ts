import type { CommentData } from "@modules/platforms/shared/platform-types";
import type { PhylloContext } from "../context";
import type { PhylloComment } from "../phyllo-types";
import { phylloCommentId, phylloContentId } from "../ids";
import { buildEnvelope } from "./envelope.mapper";
import { naiveUtc } from "../serializers";

/** Optional content reference so the comment can embed content.url/published_at. */
export interface CommentContentJoin {
  url?: string | null;
  publishedAt?: Date | string | null;
}

/** CommentData → Phyllo comment document (§4.4). */
export function toPhylloComment(
  ctx: PhylloContext,
  comment: CommentData,
  contentJoin?: CommentContentJoin,
): PhylloComment {
  const id = phylloCommentId(ctx.accountPk, comment.platformCommentId);
  const env = buildEnvelope(ctx, id, {
    updatedAt: comment.fetchedAt ?? ctx.updatedAt,
  });
  const contentUuid = phylloContentId(ctx.accountPk, comment.platformContentId);
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
  };
}
