import { createHmac } from 'node:crypto';
import {
  parseTikTokSignatureHeader,
  verifyTikTokSignature,
  TIKTOK_SIGNATURE_MAX_AGE_SECONDS,
} from '../tiktok-webhook-verify';

const SECRET = 'test-client-secret';

/** Build a valid TikTok-Signature header for the given body/timestamp. */
function sign(body: string, timestamp: number, secret = SECRET): string {
  const s = createHmac('sha256', secret)
    .update(`${timestamp}.${body}`)
    .digest('hex');
  return `t=${timestamp},s=${s}`;
}

describe('parseTikTokSignatureHeader', () => {
  it('parses t and s from a well-formed header', () => {
    expect(parseTikTokSignatureHeader('t=1633174587,s=abc123')).toEqual({
      timestamp: 1633174587,
      signature: 'abc123',
    });
  });

  it('returns null for missing header', () => {
    expect(parseTikTokSignatureHeader(undefined)).toBeNull();
  });

  it('returns null when t is not numeric', () => {
    expect(parseTikTokSignatureHeader('t=abc,s=abc123')).toBeNull();
  });

  it('returns null when s is missing', () => {
    expect(parseTikTokSignatureHeader('t=1633174587')).toBeNull();
  });
});

describe('verifyTikTokSignature', () => {
  const body = '{"event":"authorization.removed","user_openid":"u1"}';
  const now = 1_700_000_000;

  it('accepts a valid signature within tolerance', () => {
    const header = sign(body, now - 10);
    expect(
      verifyTikTokSignature(Buffer.from(body), header, SECRET, now),
    ).toBe(true);
  });

  it('rejects a signature computed with the wrong secret', () => {
    const header = sign(body, now, 'wrong-secret');
    expect(
      verifyTikTokSignature(Buffer.from(body), header, SECRET, now),
    ).toBe(false);
  });

  it('rejects a tampered body', () => {
    const header = sign(body, now);
    expect(
      verifyTikTokSignature(Buffer.from(body + 'x'), header, SECRET, now),
    ).toBe(false);
  });

  it('rejects a replayed (too old) timestamp even if HMAC matches', () => {
    const old = now - TIKTOK_SIGNATURE_MAX_AGE_SECONDS - 1;
    const header = sign(body, old);
    expect(
      verifyTikTokSignature(Buffer.from(body), header, SECRET, now),
    ).toBe(false);
  });

  it('rejects when secret is empty', () => {
    const header = sign(body, now);
    expect(verifyTikTokSignature(Buffer.from(body), header, '', now)).toBe(
      false,
    );
  });

  it('rejects a malformed header', () => {
    expect(
      verifyTikTokSignature(Buffer.from(body), 'garbage', SECRET, now),
    ).toBe(false);
  });
});
