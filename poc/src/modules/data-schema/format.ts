// Per-platform value normalization for the content mapper.

import type { ContentType } from "@modules/platforms/shared/platform-types";

/**
 * Our ContentType → InsightIQ (format, type). format ∈
 * VIDEO/IMAGE/AUDIO/TEXT/OTHER; type ∈ the InsightIQ content-type vocabulary.
 * `mediaProductType`/platform hints refine the IMAGE/VIDEO split for stories.
 */
export function contentTypeToFormatType(
  ct: ContentType,
  hint?: { isVideo?: boolean | null },
): { format: string; type: string } {
  switch (ct) {
    case "image":
      return { format: "IMAGE", type: "IMAGE" };
    case "video":
      return { format: "VIDEO", type: "VIDEO" };
    case "reel":
      return { format: "VIDEO", type: "REELS" };
    case "story":
      return { format: hint?.isVideo ? "VIDEO" : "IMAGE", type: "STORY" };
    case "carousel":
      return { format: "IMAGE", type: "POST" };
    case "live":
    case "clip":
      return { format: "VIDEO", type: "STREAM" };
    case "other":
    default:
      return { format: "OTHER", type: "POST" };
  }
}

/**
 * ISO-8601 duration (YouTube "PT4M13S") → integer seconds (InsightIQ `int`).
 * Already-numeric strings/numbers pass through. Returns null when absent.
 */
export function durationToSeconds(
  duration: string | number | null | undefined,
): number | null {
  if (duration === null || duration === undefined) return null;
  if (typeof duration === "number") return Math.round(duration);
  if (/^\d+$/.test(duration)) return parseInt(duration, 10);
  const m = /^P(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(
    duration,
  );
  if (!m) return null;
  const [, h, min, s] = m;
  const secs =
    (h ? +h * 3600 : 0) + (min ? +min * 60 : 0) + (s ? Math.round(+s) : 0);
  return secs > 0 ? secs : 0;
}

/** PUBLIC / PRIVATE / UNLISTED — upper-cased; null when unknown. */
export function visibilityOf(
  privacyStatus?: string | null,
  visibility?: string | null,
): string | null {
  const raw = visibility ?? privacyStatus;
  if (!raw) return null;
  const v = raw.toUpperCase();
  if (v === "PUBLIC" || v === "PRIVATE" || v === "UNLISTED") return v;
  return v;
}

const GENDER_MAP: Record<string, string> = {
  m: "MALE",
  male: "MALE",
  f: "FEMALE",
  female: "FEMALE",
  u: "OTHER",
  o: "OTHER",
  other: "OTHER",
  unknown: "OTHER",
};

/** Normalize a gender label to InsightIQ's MALE/FEMALE/OTHER. */
export function normalizeGender(label: string): string {
  return GENDER_MAP[label.trim().toLowerCase()] ?? label.toUpperCase();
}

/**
 * Split a combined demographic label like "F.25-34" / "male:18-24" into
 * {gender, age_range}. Falls back to gender-only or age-only when one side
 * is missing.
 */
export function splitGenderAge(label: string): {
  gender: string;
  age_range: string;
} {
  const parts = label
    .split(/[.:|,/]/)
    .map((p) => p.trim())
    .filter(Boolean);
  let gender = "OTHER";
  let age = "";
  for (const p of parts) {
    if (/^\d/.test(p) || /^\d+-/.test(p) || /-$/.test(p) || /^\d+$/.test(p)) {
      age = p.replace(/^age/i, "");
    } else {
      gender = normalizeGender(p);
    }
  }
  return { gender, age_range: age };
}
