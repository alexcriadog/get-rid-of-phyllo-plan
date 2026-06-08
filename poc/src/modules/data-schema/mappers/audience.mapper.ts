import type {
  AudienceData,
  DistributionBucket,
} from "@modules/platforms/shared/platform-types";
import type { SchemaContext } from "../context";
import type {
  ApiAudience,
  ApiCountryBucket,
  ApiCityBucket,
  ApiGenderAgeBucket,
  ApiLabelBucket,
} from "../api-types";
import { apiAudienceId } from "../ids";
import { buildEnvelope } from "./envelope.mapper";
import { toPercentPairs } from "../buckets";
import { normalizeGender, splitGenderAge } from "../format";

export function countriesToApi(
  buckets: ReadonlyArray<DistributionBucket> | undefined,
): ApiCountryBucket[] {
  return toPercentPairs(buckets).map((b) => ({
    code: b.label.toUpperCase(),
    value: b.value,
  }));
}

export function citiesToApi(
  buckets: ReadonlyArray<DistributionBucket> | undefined,
): ApiCityBucket[] {
  return toPercentPairs(buckets).map((b) => ({
    name: b.label,
    value: b.value,
  }));
}

export function gendersToApi(
  buckets: ReadonlyArray<DistributionBucket> | undefined,
): ApiLabelBucket[] {
  return toPercentPairs(buckets).map((b) => ({
    label: normalizeGender(b.label),
    value: b.value,
  }));
}

export function agesToApi(
  buckets: ReadonlyArray<DistributionBucket> | undefined,
): ApiLabelBucket[] {
  return toPercentPairs(buckets).map((b) => ({
    label: b.label,
    value: b.value,
  }));
}

/**
 * Build the InsightIQ joint gender×age distribution. We only have a true joint
 * when the platform emitted combined labels (e.g. "F.25-34"); otherwise the
 * separate breakdowns are carried in gender_distribution/age_distribution
 * (additive) and this returns []. See §10.3 — full joint needs normalizer
 * changes per platform.
 */
export function genderAgeToApi(
  gender: ReadonlyArray<DistributionBucket> | undefined,
  age: ReadonlyArray<DistributionBucket> | undefined,
): ApiGenderAgeBucket[] {
  const combined = [...(gender ?? []), ...(age ?? [])].filter(
    (b) => /[.:|,/]/.test(b.label) && /\d/.test(b.label),
  );
  if (combined.length === 0) return [];
  return toPercentPairs(combined).map((b) => {
    const { gender: g, age_range } = splitGenderAge(b.label);
    return { gender: g, age_range, value: b.value };
  });
}

/** AudienceData → InsightIQ audience document (§4.3). */
export function toApiAudience(
  ctx: SchemaContext,
  audience: AudienceData,
): ApiAudience {
  const id = apiAudienceId(ctx.accountPk);
  const env = buildEnvelope(ctx, id, {
    updatedAt: audience.fetchedAt ?? ctx.updatedAt,
  });
  return {
    ...env,
    countries: countriesToApi(audience.countryDistribution),
    cities: citiesToApi(audience.cityDistribution),
    gender_age_distribution: genderAgeToApi(
      audience.genderDistribution,
      audience.ageDistribution,
    ),
    gender_distribution: gendersToApi(audience.genderDistribution),
    age_distribution: agesToApi(audience.ageDistribution),
  };
}
