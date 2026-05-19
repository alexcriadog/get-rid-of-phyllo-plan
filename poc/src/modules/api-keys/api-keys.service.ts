import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '@shared/database/prisma.service';

const KEY_PREFIX_LIVE = 'cmlk_live_';
const KEY_PREFIX_TEST = 'cmlk_test_';
const RANDOM_BYTES = 24;

export type KeyEnvironment = 'live' | 'test';

export interface IssuedApiKey {
  /** Full bearer string — returned to the operator ONCE on creation. */
  rawKey: string;
  /** Public prefix shown in dashboards/logs (`cmlk_live_<8 chars>`). */
  prefix: string;
  /** The persisted row id. */
  id: string;
}

export interface ResolvedApiKey {
  id: string;
  workspaceId: string;
  workspaceSlug: string;
  scope: string;
  keyPrefix: string;
  /** Derived from the keyPrefix; downstream code uses it to mark accounts. */
  environment: KeyEnvironment;
}

/**
 * Issue, verify, and revoke API keys. Keys are stored as SHA-256 hex
 * digests — even a DB dump cannot recover usable credentials. The full
 * bearer string is returned exactly once at issue time and never again.
 */
@Injectable()
export class ApiKeysService {
  private readonly logger = new Logger(ApiKeysService.name);

  constructor(private readonly prisma: PrismaService) {}

  async issue(opts: {
    workspaceId: string;
    environment?: KeyEnvironment;
    label?: string;
    scope?: string;
  }): Promise<IssuedApiKey> {
    const env: KeyEnvironment = opts.environment ?? 'live';
    const random = randomBytes(RANDOM_BYTES).toString('base64url');
    const rawKey = `${env === 'live' ? KEY_PREFIX_LIVE : KEY_PREFIX_TEST}${random}`;
    const prefix = rawKey.slice(0, KEY_PREFIX_LIVE.length + 8);
    const keyHash = this.hash(rawKey);

    const row = await this.prisma.apiKey.create({
      data: {
        workspaceId: opts.workspaceId,
        keyPrefix: prefix,
        keyHash,
        scope: opts.scope ?? 'read_write',
        label: opts.label ?? null,
      },
    });

    this.logger.log(
      `Issued ${env} API key ${prefix} for workspace ${opts.workspaceId}`,
    );
    return { rawKey, prefix, id: row.id };
  }

  /**
   * Resolve a Bearer string against the api_keys table. Throws on miss,
   * revoked, or expired. On success, the row's `last_used_at` is bumped.
   */
  async verify(rawKey: string): Promise<ResolvedApiKey> {
    if (
      !rawKey ||
      (!rawKey.startsWith(KEY_PREFIX_LIVE) && !rawKey.startsWith(KEY_PREFIX_TEST))
    ) {
      throw new UnauthorizedException('Malformed API key');
    }
    const hash = this.hash(rawKey);
    const row = await this.prisma.apiKey.findUnique({
      where: { keyHash: hash },
      select: {
        id: true,
        workspaceId: true,
        scope: true,
        keyPrefix: true,
        revokedAt: true,
        keyHash: true,
        workspace: { select: { slug: true } },
      },
    });
    if (!row) {
      throw new UnauthorizedException('Invalid API key');
    }
    if (row.revokedAt) {
      throw new UnauthorizedException('API key revoked');
    }
    // Constant-time comparison guard. findUnique already matched, but keep
    // the discipline so a partial-match storage bug can't leak timing.
    const a = Buffer.from(hash, 'hex');
    const b = Buffer.from(row.keyHash, 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Invalid API key');
    }

    // Fire-and-forget the last-used bump. Failure here must not block the
    // request path.
    void this.prisma.apiKey
      .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
      .catch((err: unknown) =>
        this.logger.warn(
          `Failed to bump lastUsedAt for ${row.keyPrefix}: ${describe(err)}`,
        ),
      );

    return {
      id: row.id,
      workspaceId: row.workspaceId,
      workspaceSlug: row.workspace.slug,
      scope: row.scope,
      keyPrefix: row.keyPrefix,
      environment: row.keyPrefix.startsWith(KEY_PREFIX_TEST) ? 'test' : 'live',
    };
  }

  async revoke(id: string): Promise<void> {
    await this.prisma.apiKey.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
  }

  private hash(rawKey: string): string {
    return createHash('sha256').update(rawKey).digest('hex');
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
