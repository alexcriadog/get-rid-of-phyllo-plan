import type { SchemaContext } from "../context";
import type { ApiEnvelope } from "../api-types";
import { naiveUtcOr } from "../serializers";
import { apiAccountId, apiUserIdOrFallback } from "../ids";
import { workPlatformRef } from "../work-platforms";

/**
 * Build the common InsightIQ envelope (id-less) shared by every resource doc.
 * Each resource supplies its own top-level `id`; this fills user/account/
 * work_platform + timestamps.
 */
export function buildEnvelope(
  ctx: SchemaContext,
  id: string,
  timestamps?: { createdAt?: Date; updatedAt?: Date },
): ApiEnvelope {
  const created = timestamps?.createdAt ?? ctx.createdAt;
  const updated = timestamps?.updatedAt ?? ctx.updatedAt;
  return {
    id,
    created_at: naiveUtcOr(created, ctx.createdAt),
    updated_at: naiveUtcOr(updated, ctx.updatedAt),
    user: {
      id: apiUserIdOrFallback(ctx.endUserId, ctx.accountPk),
      name: ctx.endUserName,
    },
    account: {
      id: apiAccountId(ctx.accountPk),
      platform_username: ctx.platformUsername,
      username: ctx.platformUsername,
    },
    work_platform: workPlatformRef(ctx.platform),
  };
}
