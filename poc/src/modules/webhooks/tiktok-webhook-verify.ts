// TikTok webhook signature verification.
//
// TikTok signs every webhook POST with:
//   TikTok-Signature: t=<unix-seconds>,s=<hex>
// where s = HMAC-SHA256(key = app client_secret, message = `${t}.${rawBody}`).
// Docs: developers.tiktok.com/doc/webhooks-verification
//
// Pure functions (no Nest deps) so they are unit-testable like
// meta-webhook-fields.ts.

import { createHmac, timingSafeEqual } from 'node:crypto';

/** Reject signatures older than this — replay-attack window. */
export const TIKTOK_SIGNATURE_MAX_AGE_SECONDS = 300;

export interface TikTokSignatureHeader {
  timestamp: number;
  signature: string;
}

/** Parse `t=<seconds>,s=<hex>`. Returns null on any malformation. */
export function parseTikTokSignatureHeader(
  header: string | undefined,
): TikTokSignatureHeader | null {
  if (!header) return null;

  let timestamp: number | null = null;
  let signature: string | null = null;
  for (const part of header.split(',')) {
    const [key, value] = part.split('=', 2);
    if (key?.trim() === 't' && value && /^\d+$/.test(value.trim())) {
      timestamp = Number(value.trim());
    }
    if (key?.trim() === 's' && value) {
      signature = value.trim();
    }
  }

  if (timestamp == null || !signature) return null;
  return { timestamp, signature };
}

/**
 * Verify a TikTok webhook delivery. `nowSeconds` is injected so tests are
 * deterministic; production callers pass `Math.floor(Date.now() / 1000)`.
 */
export function verifyTikTokSignature(
  rawBody: Buffer,
  header: string | undefined,
  clientSecret: string,
  nowSeconds: number,
): boolean {
  if (!clientSecret) return false;

  const parsed = parseTikTokSignatureHeader(header);
  if (!parsed) return false;

  if (Math.abs(nowSeconds - parsed.timestamp) > TIKTOK_SIGNATURE_MAX_AGE_SECONDS) {
    return false;
  }

  const computedHex = createHmac('sha256', clientSecret)
    .update(`${parsed.timestamp}.`)
    .update(rawBody)
    .digest('hex');

  if (!/^[0-9a-fA-F]+$/.test(parsed.signature)) return false;
  const providedBuf = Buffer.from(parsed.signature, 'hex');
  const computedBuf = Buffer.from(computedHex, 'hex');
  if (providedBuf.length !== computedBuf.length) return false;

  try {
    return timingSafeEqual(providedBuf, computedBuf);
  } catch {
    return false;
  }
}
