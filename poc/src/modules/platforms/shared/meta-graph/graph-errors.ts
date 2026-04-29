// Meta Graph error classification. Phase A5 of the platform refactor.
// See docs/platform-refactor.md §7 + §8.1 (intentional fix D6).
//
// Canonicalises three near-identical extractors that lived inside FB and IG
// adapters into one. The output format is `(#code/sub) message` when both
// code and subcode are present, `(#code) message` when only code is present,
// or just `message` when the body has no error envelope.
//
// FB previously emitted `(#100) message` with no subcode (its
// `audienceErrorMessage` only read `code`). Phase A5 unifies on the IG-style
// richer form. Audit-log error strings on FB-only paths change shape — this
// is the documented intentional fix D6.

export interface GraphError {
  message: string;
  code?: number;
  subcode?: number;
}

/**
 * Best-effort extraction of a Graph error envelope. Looks for `err.body.error`
 * first (the AdapterFetchError shape), falls back to `err.message` for plain
 * Errors, then `String(err)` for everything else.
 */
export function extractGraphError(err: unknown): GraphError {
  const fromBody = graphErrorFromBody((err as { body?: unknown } | null)?.body);
  if (fromBody) return fromBody;
  if (err instanceof Error) return { message: err.message };
  return { message: String(err) };
}

/**
 * Pretty `(#code/sub) message` rendering. Use this everywhere FB+IG used to
 * render a Graph error to a log line or audit string.
 */
export function extractMetaError(err: unknown): string {
  const { message, code, subcode } = extractGraphError(err);
  if (code === undefined) return message;
  const tag = subcode !== undefined ? `#${code}/${subcode}` : `#${code}`;
  return `(${tag}) ${message}`;
}

/**
 * Heuristic: does this look like a permission/scope error rather than a
 * content shape problem? Used by adapters to decide whether retrying makes
 * sense.
 */
export function looksLikeInsightsScopeError(err: unknown): boolean {
  const msg = extractMetaError(err);
  return /insights|read_insights|nonexisting field|permission|#10\b|#100\b|#200\b/i.test(
    msg,
  );
}

function graphErrorFromBody(body: unknown): GraphError | null {
  if (!body || typeof body !== 'object') return null;
  const errObj = (body as { error?: unknown }).error;
  if (!errObj || typeof errObj !== 'object') return null;
  const e = errObj as {
    message?: unknown;
    code?: unknown;
    error_subcode?: unknown;
  };
  return {
    message: typeof e.message === 'string' ? e.message : 'Graph API error',
    code: typeof e.code === 'number' ? e.code : undefined,
    subcode: typeof e.error_subcode === 'number' ? e.error_subcode : undefined,
  };
}
