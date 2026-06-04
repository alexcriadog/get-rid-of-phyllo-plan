import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Inject,
  NotFoundException,
  Param,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '@shared/database/prisma.service';
import {
  ADAPTER_REGISTRY,
  AdapterRegistry,
} from '@modules/platforms/platforms.module';
import type {
  ContentData,
  ProfileData,
} from '@modules/platforms/shared/platform-types';
import { AccountsService } from '@modules/accounts/accounts.service';
import { FacebookExtrasService } from '@modules/platforms/facebook/fetcher/facebook-extras.service';
import {
  BearerApiKeyGuard,
  RequestWithWorkspace,
} from '@/common/guards/bearer-api-key.guard';
import { RateLimitInterceptor } from '@/common/interceptors/rate-limit.interceptor';
import { V1CacheInterceptor } from '@/common/interceptors/cache.interceptor';
import { SnapshotReader } from './snapshot-reader';
import {
  decodeBigIntCursor,
  encodeCursor,
  envelopeStatic,
  paginate,
  parseLimit,
  type Paginated,
} from '@shared/pagination/cursor';

/** True when the client explicitly opted into a live platform fetch with
 *  ?live=true|1. Default (false) serves the synced Mongo snapshot. */
function wantsLive(req: RequestWithWorkspace): boolean {
  const v = (req.query as Record<string, unknown>)['live'];
  return v === 'true' || v === '1';
}

/**
 * Public /v1 surface for external client backends. Auth: Bearer
 * `cmlk_(live|test)_*` (validated by BearerApiKeyGuard, which attaches
 * `req.workspace`). Every query is scoped to that workspace — cross-tenant
 * reads return 404.
 *
 * Read endpoints serve the SYNCED SNAPSHOT from MongoDB by default — the
 * scheduler/worker already persists every product to Mongo, so we don't
 * re-hit the platform API on every client read (that was double-paying:
 * sync to Mongo AND fetch live). A snapshot read costs one Mongo query and
 * zero platform quota. If the account hasn't been synced for a product
 * yet, the endpoint returns 404 { error: 'not_synced_yet' }.
 *
 * Escape hatch: `?live=true` forces a fresh adapter fetch (post-OAuth
 * flows, debugging). Each response carries `synced_at` so clients know
 * how fresh the data is.
 *
 * Exception: `/mentions` stays live — mentions share the `posts`
 * collection with no reliable discriminator (see the endpoint comment).
 */
@Controller('v1')
@UseGuards(BearerApiKeyGuard)
@UseInterceptors(RateLimitInterceptor, V1CacheInterceptor)
export class V1AccountsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AccountsService,
    private readonly facebookExtras: FacebookExtrasService,
    private readonly snapshots: SnapshotReader,
    @Inject(ADAPTER_REGISTRY) private readonly adapters: AdapterRegistry,
  ) {}

  @Get('accounts')
  async listAccounts(
    @Req() req: RequestWithWorkspace,
    @Query('platform') platform: string | undefined,
    @Query('end_user_id') endUserId: string | undefined,
    @Query('limit') limitRaw: string | undefined,
    @Query('cursor') cursorRaw: string | undefined,
  ): Promise<Paginated<AccountSummary>> {
    const workspaceId = this.requireWorkspace(req);
    const limit = parseLimit(limitRaw, 100, 1, 500);
    const cursorId = decodeBigIntCursor(cursorRaw);

    return paginate(
      limit,
      (take) =>
        this.prisma.account.findMany({
          where: {
            workspaceId,
            ...(platform ? { platform } : {}),
            ...(endUserId ? { endUserId } : {}),
            ...(cursorId !== null ? { id: { lt: cursorId } } : {}),
          },
          // Cursor on PK (BigInt autoincrement). For accounts that's a
          // tight proxy for connectedAt desc — newer rows always have
          // larger ids — and gives index-friendly cursor semantics.
          orderBy: { id: 'desc' },
          take,
        }),
      (r) => toSummary(r),
      (r) => encodeCursor(r.id),
    );
  }

  @Get('accounts/:id')
  async getAccount(
    @Req() req: RequestWithWorkspace,
    @Param('id') rawId: string,
  ): Promise<AccountSummary> {
    const workspaceId = this.requireWorkspace(req);
    const id = parseBigInt(rawId);
    const row = await this.prisma.account.findUnique({ where: { id } });
    if (!row || row.workspaceId !== workspaceId) {
      throw new NotFoundException(`Account ${rawId} not found`);
    }
    return toSummary(row);
  }

  @Get('accounts/:id/identity')
  async getIdentity(
    @Req() req: RequestWithWorkspace,
    @Param('id') rawId: string,
  ): Promise<NormalizedIdentity & { synced_at?: string | null }> {
    if (wantsLive(req)) {
      const { adapter, account, token, metadata } = await this.resolve(req, rawId);
      const profile = await adapter.fetchProfile(token, account.canonicalUserId, metadata);
      return toIdentityView(account.platform, account.canonicalUserId, profile);
    }
    const account = await this.resolveAccount(req, rawId);
    const snap = await this.snapshots.readSnapshot('identity_snapshots', account.id);
    if (!snap) throw new NotFoundException({ error: 'not_synced_yet', product: 'identity' });
    return {
      ...toIdentityView(account.platform, account.canonicalUserId, snap.data as ProfileData),
      synced_at: snap.syncedAt,
    };
  }

  @Get('accounts/:id/audience')
  async getAudience(
    @Req() req: RequestWithWorkspace,
    @Param('id') rawId: string,
  ): Promise<{ platform: string; data: unknown; synced_at?: string | null }> {
    if (wantsLive(req)) {
      const { adapter, account, token, metadata } = await this.resolve(req, rawId, 'page', 'audience');
      const audience = await adapter.fetchAudience(token, account.canonicalUserId, metadata);
      return { platform: account.platform, data: audience };
    }
    const account = await this.resolveAccount(req, rawId, 'audience');
    const snap = await this.snapshots.readSnapshot('audience_snapshots', account.id);
    if (!snap) throw new NotFoundException({ error: 'not_synced_yet', product: 'audience' });
    return { platform: account.platform, data: snap.data, synced_at: snap.syncedAt };
  }

  @Get('accounts/:id/content')
  async getContent(
    @Req() req: RequestWithWorkspace,
    @Param('id') rawId: string,
    @Query('limit') limitRaw: string | undefined,
    @Query('since') since: string | undefined,
  ): Promise<{ platform: string; synced_at?: string | null } & Paginated<unknown>> {
    const limit = parseLimit(limitRaw, 50, 1, 200);
    if (wantsLive(req)) {
      const { adapter, account, token, metadata } = await this.resolve(req, rawId, 'page', 'engagement_new');
      const sinceDate = since ? new Date(since) : undefined;
      if (sinceDate && Number.isNaN(sinceDate.getTime())) {
        throw new BadRequestException(`Invalid since timestamp: ${since}`);
      }
      const items = await adapter.fetchContents(
        token,
        account.canonicalUserId,
        { limit, since: sinceDate },
        metadata,
      );
      return { platform: account.platform, ...envelopeStatic<unknown>(items) };
    }
    const account = await this.resolveAccount(req, rawId, 'engagement_new');
    const { items, syncedAt } = await this.snapshots.readList('posts', account.id, { limit });
    return { platform: account.platform, synced_at: syncedAt, ...envelopeStatic<unknown>(items) };
  }

  @Get('accounts/:id/engagement')
  async getEngagement(
    @Req() req: RequestWithWorkspace,
    @Param('id') rawId: string,
    @Query('limit') limitRaw: string | undefined,
    @Query('since') since: string | undefined,
  ): Promise<NormalizedEngagement & { synced_at?: string | null } & Paginated<unknown>> {
    const limit = parseLimit(limitRaw, 25, 1, 100);
    const sinceDate = since ? new Date(since) : undefined;
    if (sinceDate && Number.isNaN(sinceDate.getTime())) {
      throw new BadRequestException(`Invalid since timestamp: ${since}`);
    }
    if (wantsLive(req)) {
      const { adapter, account, token, metadata } = await this.resolve(req, rawId, 'page', 'engagement_new');
      const items = await adapter.fetchContents(
        token,
        account.canonicalUserId,
        { limit, since: sinceDate },
        metadata,
      );
      const view = toEngagementView(account.platform, items, sinceDate);
      const list = (view as { items?: unknown[] }).items ?? [];
      return { ...view, ...envelopeStatic<unknown>(list) };
    }
    const account = await this.resolveAccount(req, rawId, 'engagement_new');
    const { items, syncedAt } = await this.snapshots.readList('posts', account.id, { limit });
    const view = toEngagementView(account.platform, items as ContentData[], sinceDate);
    const list = (view as { items?: unknown[] }).items ?? [];
    return { ...view, synced_at: syncedAt, ...envelopeStatic<unknown>(list) };
  }

  @Get('accounts/:id/ratings')
  async getRatings(
    @Req() req: RequestWithWorkspace,
    @Param('id') rawId: string,
    @Query('limit') limitRaw: string | undefined,
  ): Promise<{
    platform: string;
    sample_size: number;
    average_rating: number | null;
    captured_at: string | null;
  } & Paginated<unknown>> {
    const { account } = await this.resolve(req, rawId, 'page', 'ratings');
    if (account.platform !== 'facebook') {
      throw new BadRequestException(
        `ratings not supported for ${account.platform}`,
      );
    }
    const limit = parseLimit(limitRaw, 25, 1, 100);
    const snap = await this.facebookExtras.listRatings(account.id, limit);
    const { data, ...rest } = snap;
    return {
      platform: account.platform,
      ...rest,
      ...envelopeStatic<unknown>(data),
    };
  }

  @Delete('accounts/:id')
  async deleteAccount(
    @Req() req: RequestWithWorkspace,
    @Param('id') rawId: string,
  ): Promise<{ id: string; status: string; disconnected_at: string }> {
    const workspaceId = this.requireWorkspace(req);
    const id = parseBigInt(rawId);
    const result = await this.accounts.disconnectAccount(id, workspaceId);
    if (!result) {
      throw new NotFoundException(`Account ${rawId} not found`);
    }
    return result;
  }

  @Get('accounts/:id/engagement-deep')
  async getEngagementDeep(
    @Req() req: RequestWithWorkspace,
    @Param('id') rawId: string,
  ): Promise<{ platform: string; data: unknown; synced_at?: string | null }> {
    if (wantsLive(req)) {
      const { adapter, account, token, metadata } = await this.resolve(req, rawId, 'page', 'engagement_deep');
      if (!adapter.fetchEngagementDeep) {
        throw new BadRequestException(
          `engagement-deep not supported for ${account.platform}`,
        );
      }
      const snap = await adapter.fetchEngagementDeep(token, account.canonicalUserId, metadata);
      return { platform: account.platform, data: snap };
    }
    const account = await this.resolveAccount(req, rawId, 'engagement_deep');
    const snap = await this.snapshots.readSnapshot('engagement_deep_snapshots', account.id);
    if (!snap) throw new NotFoundException({ error: 'not_synced_yet', product: 'engagement_deep' });
    return { platform: account.platform, data: snap.data, synced_at: snap.syncedAt };
  }

  @Get('accounts/:id/stories')
  async getStories(
    @Req() req: RequestWithWorkspace,
    @Param('id') rawId: string,
    @Query('limit') limitRaw: string | undefined,
  ): Promise<{ platform: string; synced_at?: string | null } & Paginated<unknown>> {
    if (wantsLive(req)) {
      const { adapter, account, token, metadata } = await this.resolve(req, rawId, 'page', 'stories');
      if (!adapter.fetchStories) {
        throw new BadRequestException(
          `stories not supported for ${account.platform}`,
        );
      }
      const stories = await adapter.fetchStories(token, account.canonicalUserId, metadata);
      return { platform: account.platform, ...envelopeStatic<unknown>(stories) };
    }
    const account = await this.resolveAccount(req, rawId, 'stories');
    const limit = parseLimit(limitRaw, 50, 1, 200);
    // Stories share the `posts` collection with engagement_new/mentions;
    // filter by the stored contentType discriminator.
    const { items, syncedAt } = await this.snapshots.readList('posts', account.id, {
      limit,
      extraFilter: { 'data.contentType': 'story' },
    });
    return { platform: account.platform, synced_at: syncedAt, ...envelopeStatic<unknown>(items) };
  }

  // NOTE: mentions is the ONE read endpoint still served live. Mentions
  // (tagged UGC) are persisted into the shared `posts` collection with no
  // reliable discriminator to separate them from engagement_new posts, so
  // serving them from Mongo would return the wrong set. Proper fix =
  // tag posts with their source product at write time (follow-up). Until
  // then this stays live; it's a low-traffic FB/Threads-only surface.
  @Get('accounts/:id/mentions')
  async getMentions(
    @Req() req: RequestWithWorkspace,
    @Param('id') rawId: string,
    @Query('limit') limitRaw: string | undefined,
  ): Promise<{ platform: string } & Paginated<unknown>> {
    const { adapter, account, token, metadata } = await this.resolve(req, rawId, 'page', 'mentions');
    if (!adapter.fetchMentions) {
      throw new BadRequestException(
        `mentions not supported for ${account.platform}`,
      );
    }
    const limit = parseLimit(limitRaw, 50, 1, 200);
    const items = await adapter.fetchMentions(
      token,
      account.canonicalUserId,
      { limit },
      metadata,
    );
    return { platform: account.platform, ...envelopeStatic<unknown>(items) };
  }

  @Get('accounts/:id/comments')
  async getComments(
    @Req() req: RequestWithWorkspace,
    @Param('id') rawId: string,
    @Query('limit') limitRaw: string | undefined,
  ): Promise<{ platform: string; synced_at?: string | null } & Paginated<unknown>> {
    const limit = parseLimit(limitRaw, 50, 1, 200);
    if (wantsLive(req)) {
      const { adapter, account, token, metadata } = await this.resolve(req, rawId, 'page', 'comments');
      if (!adapter.fetchComments) {
        throw new BadRequestException(
          `comments not supported for ${account.platform}`,
        );
      }
      const items = await adapter.fetchComments(
        token,
        account.canonicalUserId,
        { limit },
        metadata,
      );
      return { platform: account.platform, ...envelopeStatic<unknown>(items) };
    }
    const account = await this.resolveAccount(req, rawId, 'comments');
    const { items, syncedAt } = await this.snapshots.readList('comments', account.id, { limit });
    return { platform: account.platform, synced_at: syncedAt, ...envelopeStatic<unknown>(items) };
  }

  @Get('accounts/:id/ads')
  async getAds(
    @Req() req: RequestWithWorkspace,
    @Param('id') rawId: string,
  ): Promise<{ platform: string; data: unknown; synced_at?: string | null }> {
    if (wantsLive(req)) {
      const { adapter, account, token, metadata } = await this.resolve(req, rawId, 'ads', 'ads');
      if (!adapter.fetchAds) {
        throw new BadRequestException(
          `ads not supported for ${account.platform}`,
        );
      }
      const snap = await adapter.fetchAds(token, account.canonicalUserId, metadata);
      return { platform: account.platform, data: snap };
    }
    const account = await this.resolveAccount(req, rawId, 'ads');
    const snap = await this.snapshots.readSnapshot('ads_campaigns', account.id);
    if (!snap) throw new NotFoundException({ error: 'not_synced_yet', product: 'ads' });
    return { platform: account.platform, data: snap.data, synced_at: snap.syncedAt };
  }

  /**
   * Shared lookup for every account-scoped endpoint. Enforces the workspace
   * boundary, resolves the platform adapter, decrypts the right token
   * (page vs user — only the ads endpoint asks for the user token), and
   * surfaces the platform-extension metadata bag.
   */
  private async resolve(
    req: RequestWithWorkspace,
    rawId: string,
    tokenAudience: 'page' | 'ads' = 'page',
    requireProduct?: string,
  ): Promise<{
    workspaceId: string;
    account: { id: bigint; platform: string; canonicalUserId: string; metadata: unknown };
    adapter: NonNullable<AdapterRegistry[string]>;
    token: string;
    metadata: Record<string, unknown> | undefined;
  }> {
    const workspaceId = this.requireWorkspace(req);
    const id = parseBigInt(rawId);
    const account = await this.prisma.account.findUnique({ where: { id } });
    if (!account || account.workspaceId !== workspaceId) {
      throw new NotFoundException(`Account ${rawId} not found`);
    }
    if (requireProduct) await this.assertEnrolled(account.id, requireProduct);
    const adapter = this.adapters[account.platform];
    if (!adapter) {
      throw new BadRequestException(`Unsupported platform: ${account.platform}`);
    }
    const { token } = await this.accounts.getDecryptedAccessToken(
      account.id,
      tokenAudience,
    );
    const metadata =
      (account.metadata as Record<string, unknown> | null) ?? undefined;
    return { workspaceId, account, adapter, token, metadata };
  }

  /**
   * Cheap account resolution for the snapshot read path: validates the
   * workspace boundary + loads the account, WITHOUT decrypting a token or
   * resolving a platform adapter (no platform call happens when serving
   * from Mongo). Use this instead of resolve() whenever ?live is off.
   */
  private async resolveAccount(
    req: RequestWithWorkspace,
    rawId: string,
    requireProduct?: string,
  ): Promise<{ id: bigint; platform: string; canonicalUserId: string }> {
    const workspaceId = this.requireWorkspace(req);
    const id = parseBigInt(rawId);
    const account = await this.prisma.account.findUnique({ where: { id } });
    if (!account || account.workspaceId !== workspaceId) {
      throw new NotFoundException(`Account ${rawId} not found`);
    }
    if (requireProduct) await this.assertEnrolled(account.id, requireProduct);
    return {
      id: account.id,
      platform: account.platform,
      canonicalUserId: account.canonicalUserId,
    };
  }

  /**
   * 404 unless the account is enrolled in `product` (a sync_jobs row exists).
   * Enrolment is set at connect time — workspace allow-list ∩ the SDK token's
   * per-connection scope — and a re-connect prunes out-of-scope jobs. Without
   * this gate, data persisted by an OLDER, broader connection would still be
   * served for accounts whose current scope no longer includes the product
   * (and ?live=true would even fetch it fresh). identity is exempt: it is
   * enrolled on every account by construction.
   */
  private async assertEnrolled(accountId: bigint, product: string): Promise<void> {
    const job = await this.prisma.syncJob.findUnique({
      where: { accountId_product: { accountId, product } },
      select: { id: true },
    });
    if (!job) {
      throw new NotFoundException({ error: 'product_not_enrolled', product });
    }
  }

  private requireWorkspace(req: RequestWithWorkspace): string {
    const ws = req.workspace?.workspaceId;
    if (!ws) {
      // BearerApiKeyGuard ran but didn't attach a workspace — programmer
      // error in route wiring. Surface as 500 rather than 401 to make the
      // misconfiguration loud during development.
      throw new Error('Workspace context missing on authenticated request');
    }
    return ws;
  }
}

// ─── views ────────────────────────────────────────────────────────────────

interface AccountSummary {
  id: string;
  platform: string;
  canonical_user_id: string;
  handle: string | null;
  display_name: string | null;
  status: string;
  end_user_id: string | null;
  is_test: boolean;
  connected_at: string;
  disconnected_at: string | null;
}

interface NormalizedIdentity {
  platform: string;
  platform_user_id: string;
  username: string | null;
  full_name: string | null;
  biography: string | null;
  profile_image_url: string | null;
  profile_url: string | null;
  followers_count: number | null;
  following_count: number | null;
  posts_count: number | null;
  is_verified: boolean | null;
  account_type: string | null;
  // Platform-specific extensions (kept namespaced so the cross-platform
  // shape stays clean while platform-rich fields remain accessible).
  extra: Record<string, unknown> | null;
  fetched_at: string;
}

function toSummary(row: {
  id: bigint;
  platform: string;
  canonicalUserId: string;
  handle: string | null;
  displayName: string | null;
  status: string;
  endUserId: string | null;
  isTest: boolean;
  connectedAt: Date;
  disconnectedAt: Date | null;
}): AccountSummary {
  return {
    id: row.id.toString(),
    platform: row.platform,
    canonical_user_id: row.canonicalUserId,
    handle: row.handle,
    display_name: row.displayName,
    status: row.status,
    end_user_id: row.endUserId,
    is_test: row.isTest,
    connected_at: row.connectedAt.toISOString(),
    disconnected_at: row.disconnectedAt ? row.disconnectedAt.toISOString() : null,
  };
}

function toIdentityView(
  platform: string,
  canonicalUserId: string,
  profile: ProfileData,
): NormalizedIdentity {
  // Strip the core fields we expose as first-class; everything else goes
  // into `extra`. Keeps the response stable across platforms while not
  // hiding platform-specific richness.
  const {
    username,
    displayName,
    biography,
    avatarUrl,
    profileUrl,
    followersCount,
    followingCount,
    postsCount,
    verified,
    accountType,
    fetchedAt,
    ...rest
  } = profile;
  const extra =
    Object.keys(rest).length > 0 ? (rest as Record<string, unknown>) : null;

  return {
    platform,
    platform_user_id: canonicalUserId,
    username,
    full_name: displayName,
    biography,
    profile_image_url: avatarUrl,
    profile_url: profileUrl,
    followers_count: followersCount,
    following_count: followingCount,
    posts_count: postsCount,
    is_verified: verified,
    account_type: accountType,
    extra,
    fetched_at: fetchedAt.toISOString(),
  };
}

// ─── helpers ──────────────────────────────────────────────────────────────

interface NormalizedEngagement {
  platform: string;
  window: {
    since: string | null;
    until: string;
    sample_size: number;
  };
  totals: {
    likes: number;
    comments: number;
    shares: number;
    saves: number;
    views: number;
    reach: number;
  };
  averages_per_post: {
    likes: number | null;
    comments: number | null;
    shares: number | null;
    views: number | null;
  };
  /**
   * Engagement rate (likes + comments + shares) / reach, expressed as a
   * fraction (0.0421 == 4.21%). `null` when reach is unavailable.
   */
  engagement_rate: number | null;
}

function toEngagementView(
  platform: string,
  items: ContentData[],
  since: Date | undefined,
): NormalizedEngagement {
  const totals = items.reduce(
    (acc, it) => ({
      likes: acc.likes + (it.metrics.likes ?? 0),
      comments: acc.comments + (it.metrics.comments ?? 0),
      shares: acc.shares + (it.metrics.shares ?? 0),
      saves: acc.saves + (it.metrics.saves ?? 0),
      views: acc.views + (it.metrics.views ?? 0),
      reach: acc.reach + (it.metrics.reach ?? 0),
    }),
    { likes: 0, comments: 0, shares: 0, saves: 0, views: 0, reach: 0 },
  );
  const n = items.length;
  const avg = (x: number): number | null =>
    n === 0 ? null : Number((x / n).toFixed(2));
  const engagementRate =
    totals.reach > 0
      ? Number(
          ((totals.likes + totals.comments + totals.shares) / totals.reach).toFixed(
            4,
          ),
        )
      : null;

  return {
    platform,
    window: {
      since: since ? since.toISOString() : null,
      until: new Date().toISOString(),
      sample_size: n,
    },
    totals,
    averages_per_post: {
      likes: avg(totals.likes),
      comments: avg(totals.comments),
      shares: avg(totals.shares),
      views: avg(totals.views),
    },
    engagement_rate: engagementRate,
  };
}

function parseBigInt(raw: string): bigint {
  if (!/^\d+$/.test(raw)) {
    throw new BadRequestException(`Invalid account id: ${raw}`);
  }
  try {
    return BigInt(raw);
  } catch {
    throw new BadRequestException(`Invalid account id: ${raw}`);
  }
}

// parseIntParam (formerly defined here) is replaced by parseLimit imported
// from @shared/pagination/cursor. The shared helper has the same clamp
// behaviour but returns the fallback on invalid input instead of throwing
// — better UX for clients passing exploratory cursors.
