import type { PhylloContext } from "../context";
import type { PhylloEnvelope } from "../phyllo-types";
import { naiveUtcOr } from "../serializers";
import { phylloAccountId, phylloUserIdOrFallback } from "../ids";
import { workPlatformRef } from "../work-platforms";

/**
 * Build the common Phyllo envelope (id-less) shared by every resource doc.
 * Each resource supplies its own top-level `id`; this fills user/account/
 * work_platform + timestamps.
 */
export function buildEnvelope(
  ctx: PhylloContext,
  id: string,
  timestamps?: { createdAt?: Date; updatedAt?: Date },
): PhylloEnvelope {
  const created = timestamps?.createdAt ?? ctx.createdAt;
  const updated = timestamps?.updatedAt ?? ctx.updatedAt;
  return {
    id,
    created_at: naiveUtcOr(created, ctx.createdAt),
    updated_at: naiveUtcOr(updated, ctx.updatedAt),
    user: {
      id: phylloUserIdOrFallback(ctx.endUserId, ctx.accountPk),
      name: ctx.endUserName,
    },
    account: {
      id: phylloAccountId(ctx.accountPk),
      platform_username: ctx.platformUsername,
      username: ctx.platformUsername,
    },
    work_platform: workPlatformRef(ctx.platform),
  };
}
