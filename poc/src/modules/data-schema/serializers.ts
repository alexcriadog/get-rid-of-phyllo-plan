// Serialization helpers that make our output byte-compatible with InsightIQ.
//
//  - Timestamps: naive ISO with microseconds, NO timezone suffix
//    (InsightIQ: "2026-06-05T11:12:04.637922", UTC implied). JS Date is
//    millisecond-precision, so we pad the microsecond digits with zeros.
//  - Percentages: 0..100 scale with 2 decimals (InsightIQ: 62.95).

/** "2026-06-05T11:12:04.637000" — naive UTC, microsecond width, no `Z`. */
export function naiveUtc(
  value: Date | string | null | undefined,
): string | null {
  if (value === null || value === undefined) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  // toISOString → "2026-06-05T11:12:04.637Z"; drop the Z, pad ms→micros.
  const iso = d.toISOString();
  const noZ = iso.endsWith("Z") ? iso.slice(0, -1) : iso;
  // noZ = "...:04.637" — extend the 3 ms digits to 6 micro digits.
  return /\.\d{3}$/.test(noZ) ? `${noZ}000` : noZ;
}

/** Like naiveUtc but never returns null — falls back to the supplied default. */
export function naiveUtcOr(
  value: Date | string | null | undefined,
  fallback: Date,
): string {
  return naiveUtc(value) ?? (naiveUtc(fallback) as string);
}

/** Round a number to 2 decimals (InsightIQ percentage precision). */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
