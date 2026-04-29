// TikTok audience demographics mapper. v1.3 flow.

import type { DistributionBucket } from '../../shared/platform-types';
import type { TikTokBusinessAccount } from '../../shared/tiktok-api';

/**
 * /business/get/ returns demographics as `[{country, percentage}]`. We map
 * percentage → `unit: 'percent'` (no absolute counts surfaced).
 * Camaleonic with 82 followers gets `[]` empty arrays — TikTok requires
 * 100+ active followers to expose demographics.
 */
export function parseAudienceCountries(
  account: TikTokBusinessAccount,
): DistributionBucket[] {
  return (account.audience_countries ?? [])
    .filter((b) => typeof b.percentage === 'number')
    .map((b) => ({ label: b.country, value: b.percentage, unit: 'percent' as const }));
}

export function parseAudienceGenders(
  account: TikTokBusinessAccount,
): DistributionBucket[] {
  return (account.audience_genders ?? [])
    .filter((b) => typeof b.percentage === 'number')
    .map((b) => ({ label: b.gender, value: b.percentage, unit: 'percent' as const }));
}
