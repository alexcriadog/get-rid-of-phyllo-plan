import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { WorkspacesService } from '@modules/workspaces/workspaces.service';

const ALG = 'HS256';
const TYP = 'JWT';
const ISS = 'camaleonic';
const AUD = 'connect-ui';
const DEFAULT_TTL_SECONDS = 1800; // 30 min
const MIN_TTL_SECONDS = 60;
const MAX_TTL_SECONDS = 1800;

const ALLOWED_PLATFORMS: ReadonlyArray<string> = [
  'instagram',
  'facebook',
  'tiktok',
  'threads',
  'youtube',
  'twitch',
];

export interface MintSdkTokenInput {
  workspaceId: string;
  /**
   * Public-facing workspace slug embedded in the JWT so the connect-ui
   * popup can verify it against the `?ws=<slug>` query param without a
   * DB roundtrip.
   */
  workspaceSlug: string;
  endUserId: string;
  ttlSeconds?: number;
  allowedPlatforms?: ReadonlyArray<string>;
}

export interface SdkTokenClaims {
  /** Workspace id this token was minted for. */
  ws: string;
  /** Workspace slug (public-facing identifier). */
  ws_slug: string;
  /** Client's id for the end-user inside their own product. */
  sub: string;
  /** Optional whitelist of platforms the popup may offer. */
  platforms?: ReadonlyArray<string>;
  iss: string;
  aud: string;
  iat: number;
  exp: number;
  jti: string;
}

export interface MintedSdkToken {
  token: string;
  expiresAt: Date;
}

/**
 * HS256 JWT mint + verify for short-lived SDK tokens.
 *
 * The browser never sees the workspace API key. Instead the client's
 * backend exchanges it for a per-end-user JWT (TTL ≤ 30 min) signed with
 * the workspace's HMAC secret. The hosted OAuth popup decodes and trusts
 * the claims to scope the connection.
 *
 * Self-contained (no jsonwebtoken dep) so a future operator can audit
 * the alg confusion / key confusion surface without leaning on a third-
 * party allow-list. Only HS256 is implemented; verify() rejects anything
 * else.
 */
@Injectable()
export class SdkTokensService {
  private readonly logger = new Logger(SdkTokensService.name);

  constructor(private readonly workspaces: WorkspacesService) {}

  async mint(input: MintSdkTokenInput): Promise<MintedSdkToken> {
    const ttl = clampTtl(input.ttlSeconds ?? DEFAULT_TTL_SECONDS);
    if (input.allowedPlatforms) {
      for (const p of input.allowedPlatforms) {
        if (!ALLOWED_PLATFORMS.includes(p)) {
          throw new BadRequestException(`Unsupported platform: ${p}`);
        }
      }
    }
    if (!input.endUserId || input.endUserId.length === 0) {
      throw new BadRequestException('endUserId is required');
    }

    const expandedPlatforms = expandPlatformAliases(input.allowedPlatforms);
    const secret = await this.workspaces.getSecret(input.workspaceId);
    const now = Math.floor(Date.now() / 1000);
    const payload: SdkTokenClaims = {
      ws: input.workspaceId,
      ws_slug: input.workspaceSlug,
      sub: input.endUserId,
      ...(expandedPlatforms && expandedPlatforms.length > 0
        ? { platforms: expandedPlatforms }
        : {}),
      iss: ISS,
      aud: AUD,
      iat: now,
      exp: now + ttl,
      jti: randomJti(),
    };

    const token = signHs256(payload, secret);
    return { token, expiresAt: new Date(payload.exp * 1000) };
  }

  /**
   * Decode + verify an SDK token. Throws UnauthorizedException on any
   * tamper / expiry / alg mismatch / signature failure.
   */
  async verify(token: string): Promise<SdkTokenClaims> {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new UnauthorizedException('Malformed SDK token');
    }
    const [encodedHeader, encodedPayload, encodedSignature] = parts;

    let header: { alg?: string; typ?: string };
    try {
      header = JSON.parse(base64UrlDecode(encodedHeader).toString('utf8'));
    } catch {
      throw new UnauthorizedException('Malformed SDK token header');
    }
    if (header.alg !== ALG || header.typ !== TYP) {
      throw new UnauthorizedException('Unsupported SDK token alg');
    }

    let payload: SdkTokenClaims;
    try {
      payload = JSON.parse(
        base64UrlDecode(encodedPayload).toString('utf8'),
      ) as SdkTokenClaims;
    } catch {
      throw new UnauthorizedException('Malformed SDK token payload');
    }

    if (!payload.ws || typeof payload.ws !== 'string') {
      throw new UnauthorizedException('SDK token missing workspace claim');
    }
    if (!payload.ws_slug || typeof payload.ws_slug !== 'string') {
      throw new UnauthorizedException('SDK token missing workspace slug claim');
    }
    if (payload.iss !== ISS || payload.aud !== AUD) {
      throw new UnauthorizedException('SDK token issuer/audience mismatch');
    }
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp !== 'number' || payload.exp <= now) {
      throw new UnauthorizedException('SDK token expired');
    }
    if (typeof payload.iat !== 'number' || payload.iat > now + 60) {
      throw new UnauthorizedException('SDK token issued in the future');
    }

    const secret = await this.workspaces.getSecret(payload.ws);
    const expectedSignature = hmacSha256(
      Buffer.from(`${encodedHeader}.${encodedPayload}`, 'utf8'),
      secret,
    );
    const providedSignature = base64UrlDecode(encodedSignature);
    if (
      providedSignature.length !== expectedSignature.length ||
      !timingSafeEqual(providedSignature, expectedSignature)
    ) {
      throw new UnauthorizedException('SDK token signature invalid');
    }

    return payload;
  }
}

// ─── HS256 implementation ────────────────────────────────────────────────

function signHs256(payload: SdkTokenClaims, secret: Buffer): string {
  const header = { alg: ALG, typ: TYP };
  const encodedHeader = base64UrlEncode(
    Buffer.from(JSON.stringify(header), 'utf8'),
  );
  const encodedPayload = base64UrlEncode(
    Buffer.from(JSON.stringify(payload), 'utf8'),
  );
  const signature = hmacSha256(
    Buffer.from(`${encodedHeader}.${encodedPayload}`, 'utf8'),
    secret,
  );
  return `${encodedHeader}.${encodedPayload}.${base64UrlEncode(signature)}`;
}

function hmacSha256(data: Buffer, key: Buffer): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

function base64UrlEncode(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(input: string): Buffer {
  const padded = input + '='.repeat((4 - (input.length % 4)) % 4);
  const std = padded.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(std, 'base64');
}

function randomJti(): string {
  // 16 random bytes → 22-char base64url. Enough entropy for replay
  // detection if we ever track issued tokens; today it's just identifying.
  return base64UrlEncode(randomBytes(16));
}

/**
 * Expand platform aliases so the popup-dispatcher accept-list matches
 * the OAuth-provider truth:
 *   - "instagram" has no standalone OAuth surface; the IG Business
 *     Account is connected through Facebook's OAuth + Page picker.
 *     Allowing `instagram` therefore implicitly allows `facebook`.
 *
 * Returns the resolved set (deduped) or undefined when the input was
 * empty/absent. The client sees their original list echoed back via
 * GET /v1/sdk-tokens?... in future endpoints; here we only normalise
 * what we write into the JWT claim consumed by the popup.
 */
function expandPlatformAliases(
  list: ReadonlyArray<string> | undefined,
): ReadonlyArray<string> | undefined {
  if (!list || list.length === 0) return undefined;
  const out = new Set(list);
  if (out.has('instagram') && !out.has('facebook')) out.add('facebook');
  return Array.from(out);
}

function clampTtl(ttl: number): number {
  if (!Number.isFinite(ttl) || !Number.isInteger(ttl)) {
    throw new BadRequestException('ttl must be an integer number of seconds');
  }
  if (ttl < MIN_TTL_SECONDS || ttl > MAX_TTL_SECONDS) {
    throw new BadRequestException(
      `ttl must be between ${MIN_TTL_SECONDS} and ${MAX_TTL_SECONDS} seconds`,
    );
  }
  return ttl;
}
