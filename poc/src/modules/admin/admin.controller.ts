import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { AdminService } from './admin.service';
import { ManualRefreshController } from '@modules/api/manual-refresh.controller';

// ─── body schemas ──────────────────────────────────────────────────────────

const SyncTierSchema = z
  .object({
    tier: z.enum(['vip', 'standard', 'lite', 'demo', 'paused']),
  })
  .strict();

const CadenceOverrideBodySchema = z
  .object({
    product: z.string().min(1),
    interval_seconds: z.number().int().min(300).max(30 * 86_400),
    reason: z.string().max(256).optional(),
    expires_at: z
      .string()
      .datetime({ offset: true })
      .optional(),
  })
  .strict();

const CadencePatchSchema = z
  .object({
    interval_seconds: z.number().int().min(60).max(30 * 86_400),
  })
  .strict();

const ThrottleReleaseSchema = z
  .object({
    key: z.string().min(1),
  })
  .strict();

const MINS_MIN = 1;
const MINS_MAX = 1440;
const DEFAULT_HISTORY_MINS = 60;
const DEFAULT_HORIZON_HOURS = 24;

/**
 * Admin HTTP surface. Thin dispatch onto `AdminService`; validation happens
 * here via zod, and BigInt route params are parsed through
 * `parseBigInt` so we get a 400 for non-numeric ids rather than a 500.
 */
@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly manualRefresh: ManualRefreshController,
  ) {}

  // ─── Overview + health ─────────────────────────────────────────────────

  @Get('overview')
  async overview(): Promise<unknown> {
    return this.admin.overview();
  }

  @Get('healthz')
  @HttpCode(200)
  healthz(): { status: 'ok' } {
    return { status: 'ok' };
  }

  // ─── Rate buckets ──────────────────────────────────────────────────────

  @Get('rate-buckets')
  async listRateBuckets(): Promise<unknown> {
    return this.admin.listRateBuckets();
  }

  @Get('rate-buckets/history')
  async bucketHistory(
    @Query('key') key: string | undefined,
    @Query('mins') mins: string | undefined,
  ): Promise<unknown> {
    if (!key) {
      throw new BadRequestException('key is required');
    }
    const parsedMins = this.parseIntParam(mins, DEFAULT_HISTORY_MINS, MINS_MIN, MINS_MAX);
    return this.admin.bucketHistory(key, parsedMins);
  }

  @Post('rate-buckets/:key/reset')
  @HttpCode(200)
  async resetBucket(@Param('key') key: string): Promise<unknown> {
    if (!key) {
      throw new BadRequestException('key is required');
    }
    return this.admin.resetBucket(decodeURIComponent(key));
  }

  // ─── Queues ────────────────────────────────────────────────────────────

  @Get('queues')
  async listQueues(): Promise<unknown> {
    return this.admin.listQueues();
  }

  // ─── Sync jobs ─────────────────────────────────────────────────────────

  @Get('sync-jobs')
  async listSyncJobs(
    @Query('account_id') accountId: string | undefined,
    @Query('status') status: string | undefined,
    @Query('platform') platform: string | undefined,
    @Query('limit') limit: string | undefined,
  ): Promise<unknown> {
    return this.admin.listSyncJobs({
      accountId: accountId ? this.parseBigInt(accountId) : undefined,
      status: status ?? undefined,
      platform: platform ?? undefined,
      limit: this.parseIntParam(limit, 100, 1, 500),
    });
  }

  @Post('sync-jobs/:id/reenqueue')
  @HttpCode(200)
  async reenqueueSyncJob(@Param('id') rawId: string): Promise<unknown> {
    return this.admin.reenqueueSyncJob(this.parseBigInt(rawId));
  }

  // ─── Next runs ─────────────────────────────────────────────────────────

  @Get('next-runs')
  async nextRuns(
    @Query('horizon_hours') horizonHours: string | undefined,
  ): Promise<unknown> {
    return this.admin.nextRuns(
      this.parseIntParam(horizonHours, DEFAULT_HORIZON_HOURS, 1, 24 * 7),
    );
  }

  // ─── Accounts ──────────────────────────────────────────────────────────

  @Get('accounts')
  async listAccounts(): Promise<unknown> {
    return this.admin.listAccountsDetailed();
  }

  @Get('accounts/:id')
  async getAccount(@Param('id') rawId: string): Promise<unknown> {
    return this.admin.getAccountDetailed(this.parseBigInt(rawId));
  }

  @Patch('accounts/:id/sync-tier')
  async patchSyncTier(
    @Param('id') rawId: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const parsed = SyncTierSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Invalid sync-tier payload',
        issues: parsed.error.issues,
      });
    }
    return this.admin.updateSyncTier(this.parseBigInt(rawId), parsed.data.tier);
  }

  @Post('accounts/:id/cadence-overrides')
  @HttpCode(200)
  async upsertOverride(
    @Param('id') rawId: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const parsed = CadenceOverrideBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Invalid cadence-override payload',
        issues: parsed.error.issues,
      });
    }
    return this.admin.upsertCadenceOverride(this.parseBigInt(rawId), {
      product: parsed.data.product,
      intervalSeconds: parsed.data.interval_seconds,
      reason: parsed.data.reason,
      expiresAt: parsed.data.expires_at ? new Date(parsed.data.expires_at) : undefined,
    });
  }

  @Delete('accounts/:id/cadence-overrides/:product')
  async deleteOverride(
    @Param('id') rawId: string,
    @Param('product') product: string,
  ): Promise<unknown> {
    return this.admin.deleteCadenceOverride(this.parseBigInt(rawId), product);
  }

  @Post('accounts/:id/refresh-now')
  @HttpCode(202)
  async refreshNow(@Param('id') rawId: string): Promise<unknown> {
    // Delegate to the existing manual-refresh controller so the logic stays
    // DRY. Default products inferred from adapter support.
    return this.manualRefresh.refresh(rawId, {});
  }

  @Post('accounts/:id/pause')
  @HttpCode(200)
  async pauseAccount(@Param('id') rawId: string): Promise<unknown> {
    return this.admin.pauseAccount(this.parseBigInt(rawId));
  }

  @Post('accounts/:id/unpause')
  @HttpCode(200)
  async unpauseAccount(@Param('id') rawId: string): Promise<unknown> {
    return this.admin.unpauseAccount(this.parseBigInt(rawId));
  }

  // ─── Cadences ──────────────────────────────────────────────────────────

  @Get('cadences')
  async listCadences(): Promise<unknown> {
    return this.admin.listCadences();
  }

  @Get('cadences/projection')
  async cadenceProjection(): Promise<unknown> {
    return this.admin.cadenceProjection();
  }

  @Patch('cadences/:platform/:product')
  async updateCadence(
    @Param('platform') platform: string,
    @Param('product') product: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const parsed = CadencePatchSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Invalid cadence payload',
        issues: parsed.error.issues,
      });
    }
    return this.admin.updateCadence(platform, product, parsed.data.interval_seconds);
  }

  // ─── Throttle locks ────────────────────────────────────────────────────

  @Get('throttle-locks')
  async listThrottleLocks(): Promise<unknown> {
    return this.admin.listThrottleLocks();
  }

  @Post('throttle-locks/release')
  @HttpCode(200)
  async releaseThrottleLock(@Body() body: unknown): Promise<unknown> {
    const parsed = ThrottleReleaseSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Invalid release payload',
        issues: parsed.error.issues,
      });
    }
    return this.admin.releaseThrottleLock(parsed.data.key);
  }

  // ─── API call log ──────────────────────────────────────────────────────

  @Get('api-calls')
  async listApiCalls(
    @Query('platform') platform: string | undefined,
    @Query('status') status: string | undefined,
    @Query('account_id') accountId: string | undefined,
    @Query('limit') limit: string | undefined,
  ): Promise<unknown> {
    return this.admin.listApiCalls({
      platform: platform ?? undefined,
      statusClass: status ?? undefined,
      accountId: accountId ? this.parseBigInt(accountId) : undefined,
      limit: this.parseIntParam(limit, 100, 1, 500),
    });
  }

  // ─── Webhooks ──────────────────────────────────────────────────────────

  @Get('webhooks/inbound')
  async listInboundWebhooks(
    @Query('limit') limit: string | undefined,
  ): Promise<unknown> {
    return this.admin.listInboundWebhooks(this.parseIntParam(limit, 100, 1, 500));
  }

  @Get('webhooks/silence')
  async webhookSilence(): Promise<unknown> {
    return this.admin.webhookSilence();
  }

  @Post('webhooks/replay/:id')
  @HttpCode(202)
  async replayWebhook(@Param('id') rawId: string): Promise<unknown> {
    return this.admin.replayWebhook(this.parseBigInt(rawId));
  }

  // ─── Events ────────────────────────────────────────────────────────────

  @Get('events')
  async listEvents(
    @Query('limit') limit: string | undefined,
    @Query('event_type') eventType: string | undefined,
    @Query('account_id') accountId: string | undefined,
  ): Promise<unknown> {
    return this.admin.listEvents({
      eventType: eventType ?? undefined,
      accountId: accountId ?? undefined,
      limit: this.parseIntParam(limit, 100, 1, 500),
    });
  }

  // ─── Raw responses ─────────────────────────────────────────────────────

  @Get('raw-responses')
  async listRawResponses(
    @Query('account_id') accountId: string | undefined,
    @Query('limit') limit: string | undefined,
  ): Promise<unknown> {
    return this.admin.listRawResponses(
      accountId ?? null,
      this.parseIntParam(limit, 50, 1, 200),
    );
  }

  @Get('raw-responses/:id')
  async getRawResponse(@Param('id') id: string): Promise<unknown> {
    if (!id) throw new BadRequestException('id is required');
    return this.admin.getRawResponse(id);
  }

  // ─── Support matrix ────────────────────────────────────────────────────

  @Get('support-matrix')
  supportMatrix(): unknown {
    return this.admin.supportMatrix();
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  private parseBigInt(raw: string): bigint {
    if (!/^\d+$/.test(raw)) {
      throw new BadRequestException(`Invalid id: ${raw}`);
    }
    try {
      return BigInt(raw);
    } catch {
      throw new BadRequestException(`Invalid id: ${raw}`);
    }
  }

  private parseIntParam(
    raw: string | undefined,
    fallback: number,
    min: number,
    max: number,
  ): number {
    if (raw === undefined || raw === null || raw === '') return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
      throw new BadRequestException(`Invalid integer: ${raw}`);
    }
    return Math.min(Math.max(n, min), max);
  }
}
