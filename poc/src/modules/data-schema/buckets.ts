// Percent-normalization for distribution buckets. Our internal buckets use
// inconsistent scales per platform (verified in the adapters):
//   - TikTok: unit:'percent' but values are FRACTIONS (0..1)
//   - YouTube gender/age: unit:'percent', values already 0..100
//   - YouTube country / Instagram everything: unit:'count' (raw counts)
// InsightIQ always uses 0..100 percentages, so we normalize to that here.

import type { DistributionBucket } from "@modules/platforms/shared/platform-types";
import { round2 } from "./serializers";

/**
 * Convert a bucket array into 0..100 percentages, robust to the three
 * scales above:
 *   - unit:'count'  → value / sum(values) * 100
 *   - unit:'percent', max<=1 → value * 100   (fraction)
 *   - unit:'percent', max>1  → value as-is    (already 0..100)
 * Returns [{label, value}] with value rounded to 2 decimals.
 */
export function toPercentPairs(
  buckets: ReadonlyArray<DistributionBucket> | undefined | null,
): Array<{ label: string; value: number }> {
  if (!buckets || buckets.length === 0) return [];
  const isCount = buckets.some((b) => b.unit === "count");
  if (isCount) {
    const total = buckets.reduce((s, b) => s + (b.value || 0), 0);
    if (total <= 0) return buckets.map((b) => ({ label: b.label, value: 0 }));
    return buckets.map((b) => ({
      label: b.label,
      value: round2((b.value / total) * 100),
    }));
  }
  const max = buckets.reduce((m, b) => Math.max(m, b.value || 0), 0);
  const scale = max <= 1 ? 100 : 1;
  return buckets.map((b) => ({
    label: b.label,
    value: round2((b.value || 0) * scale),
  }));
}
