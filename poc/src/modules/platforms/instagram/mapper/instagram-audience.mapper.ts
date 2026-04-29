// Instagram audience mappers — pure functions. Phase E.

import type { DistributionBucket } from '../../shared/platform-types';
import type { GraphInsight } from '../../shared/meta-graph';

export function parseFollowerDemographics(
  data: GraphInsight[],
): DistributionBucket[] {
  const out: DistributionBucket[] = [];
  for (const insight of data) {
    const breakdowns = insight.total_value?.breakdowns ?? [];
    for (const bd of breakdowns) {
      for (const r of bd.results ?? []) {
        const label = (r.dimension_values ?? []).join('|');
        if (!label) continue;
        out.push({ label, value: r.value, unit: 'count' });
      }
    }
  }
  return out;
}

/**
 * Splits FB-style `F.18-24` / `M.25-34` / `U.65+` labels into separate
 * gender + age distributions. Currently only retained because the Phase 0
 * pinning test exercises it; production IG uses parseFollowerDemographics.
 */
export function splitGenderAge(
  entries: ReadonlyArray<[string, number]>,
  gender: DistributionBucket[],
  age: DistributionBucket[],
): void {
  const genderTotals: Record<string, number> = {};
  const ageTotals: Record<string, number> = {};

  for (const [label, value] of entries) {
    const parts = label.split('.');
    if (parts.length !== 2) {
      gender.push({ label, value, unit: 'count' });
      continue;
    }
    const [g, a] = parts;
    genderTotals[g] = (genderTotals[g] ?? 0) + value;
    ageTotals[a] = (ageTotals[a] ?? 0) + value;
  }

  for (const [label, value] of Object.entries(genderTotals)) {
    gender.push({ label, value, unit: 'count' });
  }
  for (const [label, value] of Object.entries(ageTotals)) {
    age.push({ label, value, unit: 'count' });
  }
}
