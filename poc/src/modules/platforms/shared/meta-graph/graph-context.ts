// Meta Graph request-context helpers. Phase A4 of the platform refactor.
// See docs/platform-refactor.md §7.
//
// Identical helpers were duplicated across FB + IG adapters. None of them
// touch I/O or DI — pure functions on input.

import { createHash } from 'node:crypto';

/**
 * Stable token fingerprint for log/metric tagging. Never store raw access
 * tokens (PII per §8.2.1 of the refactor doc).
 */
export function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 16);
}

/**
 * Pull an account id out of the worker-provided metadata bag. Accepts
 * `accountId` or `account_id` (camel + snake), and bigint / string-of-digits
 * / finite-number inputs. Account ids are bigint end-to-end (Mongo persists
 * as string; metrics observe as bigint|null) — never widen to `number`.
 */
export function extractAccountId(
  metadata?: Record<string, unknown>,
): bigint | undefined {
  const raw = metadata?.['accountId'] ?? metadata?.['account_id'];
  if (typeof raw === 'bigint') return raw;
  if (typeof raw === 'string' && /^\d+$/.test(raw)) return BigInt(raw);
  if (typeof raw === 'number' && Number.isFinite(raw)) return BigInt(raw);
  return undefined;
}

/**
 * Drop undefined params and append the access token as the last query
 * parameter. Returns a fresh object — never mutates the input.
 */
export function withToken(
  params: Record<string, string | number | undefined>,
  token: string,
): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    out[k] = v;
  }
  out['access_token'] = token;
  return out;
}

/**
 * Number/numeric-string → number. Returns null on anything else.
 */
export function asNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return null;
}
