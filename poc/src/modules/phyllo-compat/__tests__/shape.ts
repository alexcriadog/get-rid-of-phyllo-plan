// Contract-diff helpers. The Phyllo compatibility guarantee is structural:
// our output must carry EVERY key Phyllo returns (we may add additive keys,
// but must never drop one) with a type-compatible value (null always ok).

export function keyType(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

/**
 * Assert `actual` is a structural superset of `expected`: every key in
 * `expected` exists in `actual`, recursively for plain objects, and for the
 * first element of arrays of objects. Type mismatches are reported unless one
 * side is null (Phyllo nulls a field we populate or vice versa — both fine).
 * Returns a list of human-readable problems (empty = pass).
 */
export function diffShape(
  expected: unknown,
  actual: unknown,
  path = "",
): string[] {
  const problems: string[] = [];
  const et = keyType(expected);
  const at = keyType(actual);

  if (et === "object") {
    if (at !== "object") {
      problems.push(`${path || "<root>"}: expected object, got ${at}`);
      return problems;
    }
    const eo = expected as Record<string, unknown>;
    const ao = actual as Record<string, unknown>;
    for (const k of Object.keys(eo)) {
      if (!(k in ao)) {
        problems.push(`${path}${k}: MISSING (Phyllo has it, we don't)`);
        continue;
      }
      problems.push(...diffShape(eo[k], ao[k], `${path}${k}.`));
    }
    return problems;
  }

  if (et === "array") {
    if (at !== "array") {
      problems.push(`${path}: expected array, got ${at}`);
      return problems;
    }
    const ea = expected as unknown[];
    const aa = actual as unknown[];
    // Only compare element shape when Phyllo's sample has an element.
    if (ea.length > 0 && keyType(ea[0]) === "object") {
      if (aa.length > 0) {
        problems.push(...diffShape(ea[0], aa[0], `${path}[].`));
      }
      // empty actual array is acceptable (field present, no data)
    }
    return problems;
  }

  // Scalars: only flag a hard type conflict (both non-null and different).
  if (et !== "null" && at !== "null" && et !== at) {
    problems.push(`${path.replace(/\.$/, "")}: type ${at}, Phyllo ${et}`);
  }
  return problems;
}
