// Static work-platform catalog with InsightIQ's EXACT UUIDs so the consumer can
// keep mapping on work_platform.id unchanged (§2). UUIDs verified live from
// GET /v1/work-platforms on api.staging.insightiq.ai (work-platforms.json).
// Threads has no InsightIQ platform → we mint a deterministic UUIDv5 for it.

import { v5 as uuidv5 } from "uuid";
import type { Platform } from "@modules/accounts/products.catalog";
import { API_ID_NAMESPACE } from "./ids";
import type { ApiWorkPlatformRef } from "./api-types";

const LOGO = (slug: string): string =>
  `https://cdn.getphyllo.com/platforms_logo/logos/logo_${slug}.png`;

export const WORK_PLATFORMS: Record<Platform, ApiWorkPlatformRef> = {
  instagram: {
    id: "9bb8913b-ddd9-430b-a66a-d74d846e6c66",
    name: "Instagram",
    logo_url: LOGO("instagram"),
  },
  facebook: {
    id: "ad2fec62-2987-40a0-89fb-23485972598c",
    name: "Facebook",
    logo_url: LOGO("facebook"),
  },
  tiktok: {
    id: "de55aeec-0dc8-4119-bf90-16b3d1f0c987",
    name: "TikTok",
    logo_url: LOGO("tiktok"),
  },
  youtube: {
    id: "14d9ddf5-51c6-415e-bde6-f8ed36ad7054",
    name: "YouTube",
    logo_url: LOGO("youtube"),
  },
  twitch: {
    id: "e4de6c01-5b78-4fc0-a651-24f44134457b",
    name: "Twitch",
    logo_url: LOGO("twitch"),
  },
  linkedin: {
    id: "36410629-f907-43ba-aa0d-434ca9c0501a",
    name: "LinkedIn",
    logo_url: LOGO("linkedin"),
  },
  // No InsightIQ platform exists for Threads — mint a stable UUID in our namespace.
  threads: {
    id: uuidv5("work_platform:threads", API_ID_NAMESPACE),
    name: "Threads",
    logo_url: LOGO("threads"),
  },
  // InsightIQ's real "X" platform UUID (work-platforms.json) so consumers
  // that still map on Phyllo-era work_platform ids recognise the account.
  twitter: {
    id: "7645460a-96e0-4192-a3ce-a1fc30641f72",
    name: "X",
    logo_url: LOGO("x"),
  },
};

export function workPlatformRef(platform: Platform): ApiWorkPlatformRef {
  return WORK_PLATFORMS[platform];
}

/** Reverse lookup: InsightIQ work_platform UUID → our internal platform id. */
export function platformFromWorkPlatformId(id: string): Platform | null {
  for (const [platform, ref] of Object.entries(WORK_PLATFORMS)) {
    if (ref.id === id) return platform as Platform;
  }
  return null;
}
