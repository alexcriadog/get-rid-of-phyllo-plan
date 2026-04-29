// TikTok-specific context helpers. v1.3 flow.

import { createHash } from 'node:crypto';

export function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 16);
}

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
 * For the TikTok account-holder OAuth flow, business_id and open_id are
 * the SAME value (verified live). The chokepoint requires it as a query
 * param on every call. We accept it from `metadata.business_id` and fall
 * back to `metadata.open_id`.
 */
export function extractBusinessId(metadata?: Record<string, unknown>): string {
  const raw = metadata?.['business_id'] ?? metadata?.['businessId'] ?? metadata?.['open_id'];
  if (typeof raw === 'string' && raw.length > 0) return raw;
  throw new Error(
    'TikTok adapter: accounts.metadata.business_id (or open_id) required. Seed via the admin console.',
  );
}
