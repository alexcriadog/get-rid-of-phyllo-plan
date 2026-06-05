// Shared helpers for the inbound webhook ingest controllers (meta, threads,
// tiktok). Pure functions — no Nest dependencies.

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

export const PAYLOAD_SNIPPET_MAX_BYTES = 2048;

/**
 * The raw-body middleware in main.ts attaches a Buffer for
 * /webhooks/ingest/* routes; fall back defensively for other middleware
 * arrangements so logging never crashes.
 */
export function extractRawBody(req: Request): Buffer {
  const body = (req as Request & { body?: unknown }).body;
  if (Buffer.isBuffer(body)) return body;
  const rawBody = (req as Request & { rawBody?: unknown }).rawBody;
  if (Buffer.isBuffer(rawBody)) return rawBody;
  if (typeof body === 'string') return Buffer.from(body, 'utf8');
  // Last-resort stringify — signature will fail but we still return a
  // deterministic buffer so logging does not crash.
  return Buffer.from(JSON.stringify(body ?? {}), 'utf8');
}

/** Truncate a payload for inbound_webhook_log storage. */
export function payloadSnippet(rawBody: Buffer): string {
  if (rawBody.length <= PAYLOAD_SNIPPET_MAX_BYTES) {
    return rawBody.toString('utf8');
  }
  return `${rawBody.subarray(0, PAYLOAD_SNIPPET_MAX_BYTES).toString('utf8')}...[truncated]`;
}

/**
 * Verify a Meta-style `X-Hub-Signature-256: sha256=<hex>` header (HMAC-SHA256
 * of the raw body with the app secret). Used by both the FB/IG and Threads
 * ingest routes — they share the scheme but use different app secrets.
 */
export function verifyMetaHubSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  appSecret: string | undefined,
): boolean {
  if (!appSecret || !signatureHeader) return false;

  const prefix = 'sha256=';
  if (!signatureHeader.startsWith(prefix)) return false;

  const providedHex = signatureHeader.slice(prefix.length);
  if (!/^[0-9a-fA-F]+$/.test(providedHex)) return false;

  const computedHex = createHmac('sha256', appSecret).update(rawBody).digest('hex');

  const providedBuf = Buffer.from(providedHex, 'hex');
  const computedBuf = Buffer.from(computedHex, 'hex');

  if (providedBuf.length !== computedBuf.length) return false;

  try {
    return timingSafeEqual(providedBuf, computedBuf);
  } catch {
    return false;
  }
}
