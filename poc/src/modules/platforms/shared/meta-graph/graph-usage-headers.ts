// Meta Graph rate-limit telemetry header parser. Phase A2 of the platform
// refactor. Identical bodies were duplicated in FB + IG adapters; merged
// here. See docs/platform-refactor.md §7.
//
// Headers Meta returns:
//   x-app-usage                 — app-level call_count / total_time / total_cputime
//   x-page-usage                — Page-level (FB Pages + IG Business)
//   x-business-use-case-usage   — BUC token bucket per call category
//
// Each header is a JSON-encoded string. We JSON.parse defensively; if Meta
// ever returns a non-JSON string we keep the raw value rather than throw.

import type { AxiosResponse } from 'axios';

export function parseUsageHeaders(
  response: AxiosResponse,
): Record<string, unknown> | null {
  const headers = response.headers;
  const out: Record<string, unknown> = {};

  const appUsage = headers['x-app-usage'];
  if (typeof appUsage === 'string') {
    out['x-app-usage'] = safeJson(appUsage);
  }
  const pageUsage = headers['x-page-usage'];
  if (typeof pageUsage === 'string') {
    out['x-page-usage'] = safeJson(pageUsage);
  }
  const buc = headers['x-business-use-case-usage'];
  if (typeof buc === 'string') {
    out['x-business-use-case-usage'] = safeJson(buc);
  }
  return Object.keys(out).length > 0 ? out : null;
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
