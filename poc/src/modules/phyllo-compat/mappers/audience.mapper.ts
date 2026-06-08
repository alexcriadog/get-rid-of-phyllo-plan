import type {
  AudienceData,
  DistributionBucket,
} from "@modules/platforms/shared/platform-types";
import type { PhylloContext } from "../context";
import type {
  PhylloAudience,
  PhylloCountryBucket,
  PhylloCityBucket,
  PhylloGenderAgeBucket,
  PhylloLabelBucket,
} from "../phyllo-types";
import { phylloAudienceId } from "../ids";
import { buildEnvelope } from "./envelope.mapper";
import { toPercentPairs } from "../buckets";
import { normalizeGender, splitGenderAge } from "../format";

export function countriesToPhyllo(
  buckets: ReadonlyArray<DistributionBucket> | undefined,
): PhylloCountryBucket[] {
  return toPercentPairs(buckets).map((b) => ({
    code: b.label.toUpperCase(),
    value: b.value,
  }));
}

export function citiesToPhyllo(
  buckets: ReadonlyArray<DistributionBucket> | undefined,
): PhylloCityBucket[] {
  return toPercentPairs(buckets).map((b) => ({
    name: b.label,
    value: b.value,
  }));
}

export function gendersToPhyllo(
  buckets: ReadonlyArray<DistributionBucket> | undefined,
): PhylloLabelBucket[] {
  return toPercentPairs(buckets).map((b) => ({
    label: normalizeGender(b.label),
    value: b.value,
  }));
}

export function agesToPhyllo(
  buckets: ReadonlyArray<DistributionBucket> | undefined,
): PhylloLabelBucket[] {
  return toPercentPairs(buckets).map((b) => ({
    label: b.label,
    value: b.value,
  }));
}

/**
 * Build the Phyllo joint gender×age distribution. We only have a true joint
 * when the platform emitted combined labels (e.g. "F.25-34"); otherwise the
 * separate breakdowns are carried in gender_distribution/age_distribution
 * (additive) and this returns []. See §10.3 — full joint needs normalizer
 * changes per platform.
 */
export function genderAgeToPhyllo(
  gender: ReadonlyArray<DistributionBucket> | undefined,
  age: ReadonlyArray<DistributionBucket> | undefined,
): PhylloGenderAgeBucket[] {
  const combined = [...(gender ?? []), ...(age ?? [])].filter(
    (b) => /[.:|,/]/.test(b.label) && /\d/.test(b.label),
  );
  if (combined.length === 0) return [];
  return toPercentPairs(combined).map((b) => {
    const { gender: g, age_range } = splitGenderAge(b.label);
    return { gender: g, age_range, value: b.value };
  });
}

/** AudienceData → Phyllo audience document (§4.3). */
export function toPhylloAudience(
  ctx: PhylloContext,
  audience: AudienceData,
): PhylloAudience {
  const id = phylloAudienceId(ctx.accountPk);
  const env = buildEnvelope(ctx, id, {
    updatedAt: audience.fetchedAt ?? ctx.updatedAt,
  });
  return {
    ...env,
    countries: countriesToPhyllo(audience.countryDistribution),
    cities: citiesToPhyllo(audience.cityDistribution),
    gender_age_distribution: genderAgeToPhyllo(
      audience.genderDistribution,
      audience.ageDistribution,
    ),
    gender_distribution: gendersToPhyllo(audience.genderDistribution),
    age_distribution: agesToPhyllo(audience.ageDistribution),
  };
}
