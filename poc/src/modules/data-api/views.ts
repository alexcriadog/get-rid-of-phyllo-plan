// View builders for the InsightIQ-compatible account/user/work-platform shapes
// that aren't stored in Mongo (they're derived from Prisma rows + sync state).

import {
  naiveUtc,
  apiAccountId,
  apiUserIdOrFallback,
  WORK_PLATFORMS,
} from "@modules/data-schema";
import type { Platform } from "@modules/accounts/products.catalog";
import type { ResolvedAccount } from "./account-resolver.service";

export interface SyncJobLite {
  product: string;
  status: string;
  lastSuccessAt: Date | null;
}

interface SyncState {
  status: string;
  monitor_type: string;
  last_sync_at: string | null;
}

function syncStateFor(jobs: SyncJobLite[], products: string[]): SyncState {
  const matched = jobs.filter((j) => products.includes(j.product));
  if (matched.length === 0)
    return {
      status: "NOT_SYNCED",
      monitor_type: "STANDARD",
      last_sync_at: null,
    };
  const synced = matched.find((j) => j.lastSuccessAt);
  if (synced) {
    return {
      status: "SYNCED",
      monitor_type: "STANDARD",
      last_sync_at: naiveUtc(synced.lastSuccessAt),
    };
  }
  const running = matched.find(
    (j) => j.status === "running" || j.status === "in_progress",
  );
  return {
    status: running ? "SYNC_IN_PROGRESS" : "NOT_SYNCED",
    monitor_type: "STANDARD",
    last_sync_at: null,
  };
}

export function accountView(
  acc: ResolvedAccount,
  jobs: SyncJobLite[],
  profilePicUrl: string | null,
): Record<string, unknown> {
  const platform = acc.platform as Platform;
  const wp = WORK_PLATFORMS[platform];
  const connected = acc.status !== "disconnected";
  const identity = syncStateFor(jobs, ["identity"]);
  const audience = syncStateFor(jobs, ["audience"]);
  const engagement = syncStateFor(jobs, [
    "engagement_new",
    "engagement_deep",
    "stories",
  ]);
  return {
    id: apiAccountId(acc.id.toString()),
    created_at: naiveUtc(acc.connectedAt ?? acc.createdAt),
    updated_at: naiveUtc(acc.updatedAt),
    user: {
      id: apiUserIdOrFallback(acc.endUserId, acc.id.toString()),
      name: acc.endUserId,
    },
    work_platform: wp
      ? { id: wp.id, name: wp.name, logo_url: wp.logo_url }
      : null,
    username: acc.handle,
    platform_username: acc.handle,
    profile_pic_url: profilePicUrl,
    status: connected ? "CONNECTED" : "NOT_CONNECTED",
    platform_profile_name: acc.displayName ?? acc.handle,
    platform_profile_id: acc.canonicalUserId,
    platform_profile_published_at: null,
    disconnection_source: connected ? null : "USER",
    data: {
      identity: { ...identity, audience: { ...audience } },
      engagement: { ...engagement, audience: { ...audience } },
    },
  };
}

export function userView(u: {
  uuid: string;
  endUserId: string;
  createdAt: Date;
  updatedAt: Date;
}): Record<string, unknown> {
  return {
    name: u.endUserId,
    external_id: u.endUserId,
    id: u.uuid,
    created_at: naiveUtc(u.createdAt),
    updated_at: naiveUtc(u.updatedAt),
    status: "ACTIVE",
  };
}
