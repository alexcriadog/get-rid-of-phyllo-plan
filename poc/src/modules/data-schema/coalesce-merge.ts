// Null-coalescing deep merge for canonical docs.
//
// We store ONE snapshot per resource (upsert with $set). A partial fetch
// failure — e.g. a rate-limited stats sub-call on any platform — produces a
// doc with null/empty fields. Writing that blindly would clobber good prior
// data (the classic "follower_count went null after a 429"). This merge keeps
// the LAST KNOWN GOOD value for any field the new sync didn't actually fill.
//
// Rule: the new sync wins whenever it has a real value (any non-null scalar,
// incl. a lower number; any non-empty array; any object). Only null/undefined
// leaves — and empty arrays where we previously had data — fall back to the
// stored value. A genuine transition to null is therefore masked; for a
// creator-data snapshot "last known good" is the right default.

export function coalesceMerge<T>(oldVal: T, newVal: T): T {
  if (newVal === null || newVal === undefined) {
    return (oldVal ?? newVal) as T;
  }
  if (Array.isArray(newVal)) {
    if (newVal.length === 0 && Array.isArray(oldVal) && oldVal.length > 0) {
      return oldVal as unknown as T;
    }
    return newVal;
  }
  if (typeof newVal === "object") {
    if (
      oldVal === null ||
      oldVal === undefined ||
      typeof oldVal !== "object" ||
      Array.isArray(oldVal)
    ) {
      return newVal;
    }
    const newObj = newVal as Record<string, unknown>;
    const oldObj = oldVal as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(newObj)) {
      out[k] = coalesceMerge(oldObj[k], newObj[k]);
    }
    // Preserve keys that only exist on the stored doc (forward-compat).
    for (const k of Object.keys(oldObj)) {
      if (!(k in out)) out[k] = oldObj[k];
    }
    return out as T;
  }
  return newVal;
}
