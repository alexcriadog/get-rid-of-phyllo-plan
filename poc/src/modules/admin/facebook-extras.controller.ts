// CA-only Facebook extras endpoints. These cover Meta scopes granted in May
// 2026 (pages_read_user_content / ads_read / Page Public Content Access)
// that aren't part of the platform-agnostic sync worker pipeline.
//
// Routes (all behind `/admin/ca/...`):
//   POST /admin/ca/ratings/sync/:accountId        — pull /{page}/ratings → page_ratings
//   POST /admin/ca/ads/sync/:accountId            — pull /me/adaccounts + insights → ad_insights
//   POST /admin/ca/public-pages/snapshot/:accountId
//                                                  — pull /{any_page}/* via PPCA → public_page_snapshots
//   GET  /admin/ca/public-pages/:accountId        — list stored snapshots for owner
//
// Each mutation accepts an optional `access_token` in the body so operators
// can override the stored token when scope-level differs (page token for
// ratings/PPCA; user token for ads_read). When omitted the stored token is
// used.

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '@shared/database/prisma.service';
import { AesLocalService } from '@shared/crypto/aes-local.service';
import {
  MONGO_COLLECTIONS,
  MongoService,
} from '@shared/database/mongo.service';
import { AccountsService } from '@modules/accounts/accounts.service';
import { FacebookExtrasService } from '@modules/platforms/facebook/fetcher/facebook-extras.service';
import {
  AdapterFetchError,
  TokenRevokedError,
} from '@modules/platforms/shared/platform-adapter.port';

const SyncRatingsBody = z
  .object({ access_token: z.string().min(20).optional() })
  .strict();

const SyncMentionsCommentsBody = z
  .object({
    access_token: z.string().min(20).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict();

const SyncAdsBody = z
  .object({
    access_token: z.string().min(20).optional(),
    date_preset: z
      .enum([
        'today',
        'yesterday',
        'last_7d',
        'last_14d',
        'last_28d',
        'last_30d',
        'last_90d',
        'this_month',
        'last_month',
        'maximum',
      ])
      .optional(),
  })
  .strict();

const SnapshotPublicPageBody = z
  .object({
    page_id: z.string().min(1),
    access_token: z.string().min(20).optional(),
  })
  .strict();

@Controller('admin/ca')
export class FacebookExtrasController {
  constructor(
    private readonly extras: FacebookExtrasService,
    private readonly prisma: PrismaService,
    private readonly aes: AesLocalService,
    private readonly mongo: MongoService,
    private readonly accountsService: AccountsService,
  ) {}

  @Post('ratings/sync/:accountId')
  @HttpCode(200)
  async syncRatings(
    @Param('accountId') rawId: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const accountId = this.parseAccountId(rawId);
    const parsed = SyncRatingsBody.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException({ issues: parsed.error.issues });
    }
    const { account, accessToken } = await this.resolveCaAccount(
      accountId,
      parsed.data.access_token,
    );
    const result = await this.extras.syncRatings(
      accountId,
      accessToken,
      account.canonicalUserId,
    );
    return { account_id: rawId, ...result };
  }

  @Post('ads/sync/:accountId')
  @HttpCode(200)
  async syncAds(
    @Param('accountId') rawId: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const accountId = this.parseAccountId(rawId);
    const parsed = SyncAdsBody.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException({ issues: parsed.error.issues });
    }
    const { accessToken, tokenLevel } = await this.resolveCaAccount(
      accountId,
      parsed.data.access_token,
      'ads',
    );
    try {
      const result = await this.extras.syncAdInsights(
        accountId,
        accessToken,
        parsed.data.date_preset ?? 'last_30d',
      );
      return { account_id: rawId, token_level: tokenLevel, ...result };
    } catch (err) {
      throw mapMetaError(err, {
        hint:
          tokenLevel === 'page'
            ? 'No user-level token stored for this account. Re-seed it with the USER access token (the one returned by /me/accounts) so ads_read can run from the worker. As a workaround pass `access_token` in the body.'
            : 'Meta rejected the ads_read call even with the stored user token. Verify the scope is still granted.',
      });
    }
  }

  @Post('public-pages/snapshot/:accountId')
  @HttpCode(200)
  async snapshotPublicPage(
    @Param('accountId') rawId: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const accountId = this.parseAccountId(rawId);
    const parsed = SnapshotPublicPageBody.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException({ issues: parsed.error.issues });
    }
    const { accessToken } = await this.resolveCaAccount(
      accountId,
      parsed.data.access_token,
    );
    const result = await this.extras.snapshotPublicPage(
      accountId,
      accessToken,
      parsed.data.page_id,
    );
    return { account_id: rawId, ...result };
  }

  @Post('mentions/sync/:accountId')
  @HttpCode(200)
  async syncMentions(
    @Param('accountId') rawId: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const accountId = this.parseAccountId(rawId);
    const parsed = SyncMentionsCommentsBody.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException({ issues: parsed.error.issues });
    }
    const { account, accessToken } = await this.resolveCaAccount(
      accountId,
      parsed.data.access_token,
    );
    const result = await this.extras.syncMentions(
      accountId,
      accessToken,
      account.canonicalUserId,
      parsed.data.limit ?? 25,
    );
    return { account_id: rawId, ...result };
  }

  @Post('comments/sync/:accountId')
  @HttpCode(200)
  async syncComments(
    @Param('accountId') rawId: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const accountId = this.parseAccountId(rawId);
    const parsed = SyncMentionsCommentsBody.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException({ issues: parsed.error.issues });
    }
    const { account, accessToken } = await this.resolveCaAccount(
      accountId,
      parsed.data.access_token,
    );
    const result = await this.extras.syncComments(
      accountId,
      accessToken,
      account.canonicalUserId,
      parsed.data.limit ?? 10,
    );
    return { account_id: rawId, ...result };
  }

  @Get('public-pages/:accountId')
  async listPublicPages(
    @Param('accountId') rawId: string,
    @Query('limit') limit?: string,
  ): Promise<unknown> {
    this.parseAccountId(rawId);
    const cap = limit ? Math.min(Math.max(Number(limit) || 10, 1), 50) : 25;
    const cursor = await this.mongo
      .getCollection(MONGO_COLLECTIONS.publicPageSnapshots)
      .find({ owner_account_id: rawId })
      .sort({ captured_at: -1 })
      .limit(cap)
      .toArray();
    return cursor.map((doc) => stripMongoId(doc));
  }

  // ─── helpers ──────────────────────────────────────────────────────────

  private parseAccountId(raw: string): bigint {
    if (!/^\d+$/.test(raw)) {
      throw new BadRequestException(`Invalid account id: ${raw}`);
    }
    return BigInt(raw);
  }

  private async resolveCaAccount(
    accountId: bigint,
    overrideToken: string | undefined,
    tokenLevel: 'page' | 'ads' = 'page',
  ): Promise<{
    account: { id: bigint; platform: string; canonicalUserId: string };
    accessToken: string;
    tokenLevel: 'page' | 'user';
  }> {
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
    });
    if (!account) {
      throw new NotFoundException(`Account ${accountId.toString()} not found`);
    }
    if (account.platform !== 'facebook') {
      throw new BadRequestException(
        `Account ${accountId.toString()} is not a Facebook account (platform=${account.platform}). CA extras only support facebook.`,
      );
    }
    if (overrideToken) {
      return {
        account: {
          id: account.id,
          platform: account.platform,
          canonicalUserId: account.canonicalUserId,
        },
        accessToken: overrideToken,
        tokenLevel: 'page',
      };
    }
    try {
      const { token, level } = await this.accountsService.getDecryptedAccessToken(
        accountId,
        tokenLevel,
      );
      return {
        account: {
          id: account.id,
          platform: account.platform,
          canonicalUserId: account.canonicalUserId,
        },
        accessToken: token,
        tokenLevel: level,
      };
    } catch (e) {
      throw new BadRequestException(
        (e as Error).message ??
          `Could not resolve token for account ${accountId.toString()}.`,
      );
    }
  }
}

function stripMongoId(doc: Record<string, unknown>): Record<string, unknown> {
  const { _id, ...rest } = doc;
  void _id;
  return rest;
}

function mapMetaError(
  err: unknown,
  ctx: { hint?: string } = {},
): BadRequestException {
  if (err instanceof TokenRevokedError) {
    return new BadRequestException({
      message:
        'Facebook rejected the access token (revoked, expired, or wrong scope).',
      hint: ctx.hint,
      cause: err.message,
    });
  }
  if (err instanceof AdapterFetchError) {
    return new BadRequestException({
      message: err.message,
      meta_error: err.body,
      hint: ctx.hint,
    });
  }
  if (err instanceof Error) {
    return new BadRequestException({ message: err.message, hint: ctx.hint });
  }
  return new BadRequestException({ message: String(err), hint: ctx.hint });
}
