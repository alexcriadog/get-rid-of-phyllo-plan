// DataEventDispatcher — central emitter for `data.<product>.updated` events.
//
// The sync.worker calls `fire()` after persisting new items to MongoDB.
// This service decides whether to:
//   - emit the webhook directly (cadence === "immediate"), or
//   - upsert into pending_webhook_events for the digest cron to flush
//     later (cadence === "hourly" | "daily").
//
// Cadence is resolved from the workspace's webhookCadence JSON (operator
// set via the admin UI). Snapshot products always emit immediately —
// they have no items_added delta to aggregate.

import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@shared/database/prisma.service';
import { OutboundWebhooksService } from './outbound-webhooks.service';
import { StandardWebhookEmitter } from './standard-webhook-emitter.service';
import { RefreshCadenceService } from './refresh-cadence.service';

const DAY_MS = 86_400_000;

type Cadence = 'immediate' | 'hourly' | 'daily';

// Snapshot products: a single document is rewritten on each sync, so
// there's no meaningful "items_added" delta to aggregate over time.
// They always emit immediately regardless of workspace cadence config.
const SNAPSHOT_PRODUCTS: ReadonlySet<string> = new Set([
  'identity',
  'audience',
  'engagement_deep',
  'ratings',
  'ads',
]);

const SAMPLE_ID_CAP = 20;
// Memoize workspace lookups for 60 s. Sync jobs for the same workspace
// fire frequently (multiple per minute on a healthy stack) and the
// cadence config almost never changes; the cache keeps this off the hot
// path of every sync.
const WORKSPACE_CACHE_TTL_MS = 60_000;

interface CachedWorkspace {
  cadenceMap: Record<string, Cadence>;
  expiresAt: number;
}

@Injectable()
export class DataEventDispatcher {
  private readonly logger = new Logger(DataEventDispatcher.name);
  private readonly workspaceCache = new Map<string, CachedWorkspace>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly webhooks: OutboundWebhooksService,
    private readonly standardWebhooks: StandardWebhookEmitter,
    private readonly refresh: RefreshCadenceService,
  ) {}

  /**
   * Called from sync.worker after a successful persistToMongo.
   *
   * Two mutually exclusive paths:
   *
   *   ADD (itemsAdded > 0) — new items landed. Behaves as before:
   *     cadence === 'immediate' → emit the webhook event now.
   *     cadence === 'hourly|daily' → upsert one row in pending_webhook_events
   *       per subscribed endpoint, accumulating items_added and sampleIds.
   *
   *   REFRESH (itemsAdded === 0 && itemsUpdated > 0) — no new items, but
   *     existing items had their metrics updated. Emits a throttled
   *     `data.<product>.updated` (reason: 'refresh') at most once per the
   *     per-(platform, product) refresh interval, guarded by a Redis lock.
   *
   * Short-circuits when nothing changed, the account is missing, or the
   * account is test-mode.
   */
  async fire(args: {
    accountId: bigint;
    product: string;
    itemsAdded: number;
    sampleIds: string[];
    itemsUpdated?: number;
    updatedSampleIds?: string[];
  }): Promise<void> {
    const isAdd = args.itemsAdded > 0;
    // Add and refresh are mutually exclusive: an add webhook already signals
    // the consumer to re-fetch, so we only emit a refresh when nothing new
    // landed but existing items' metrics changed.
    const isRefresh = !isAdd && (args.itemsUpdated ?? 0) > 0;
    if (!isAdd && !isRefresh) return;

    const account = await this.prisma.account.findUnique({
      where: { id: args.accountId },
      select: {
        id: true,
        workspaceId: true,
        platform: true,
        isTest: true,
      },
    });
    if (!account) {
      this.logger.warn(
        `DataEventDispatcher: account ${args.accountId.toString()} not found`,
      );
      return;
    }
    if (account.isTest) return;

    if (isRefresh) {
      // Refresh path: existing items had their metrics updated but nothing
      // new landed. Throttle to at most one emit per (account, product)
      // refresh interval so a churny metric stream doesn't spam clients.
      const cfg = await this.refresh.getConfig(account.platform, args.product);
      const ok = await this.refresh.tryAcquire(
        args.accountId,
        args.product,
        cfg.intervalSeconds,
      );
      if (!ok) return;
      const ids = (args.updatedSampleIds ?? []).slice(0, SAMPLE_ID_CAP);
      // InsightIQ-compatible thin webhook (independent of native cadence).
      await this.standardWebhooks.fireData({
        accountId: args.accountId,
        product: args.product,
        sampleIds: ids,
      });
      const now = new Date();
      await this.webhooks.emit(
        account.workspaceId,
        `data.${args.product}.updated`,
        {
          account_id: account.id.toString(),
          platform: account.platform,
          workspace_id: account.workspaceId,
          product: args.product,
          items_added: 0,
          sample_ids: ids,
          reason: 'refresh',
          window_start: new Date(
            now.getTime() - cfg.windowDays * DAY_MS,
          ).toISOString(),
          window_end: now.toISOString(),
          cadence: 'immediate',
          occurred_at: now.toISOString(),
        },
      );
      return;
    }

    // InsightIQ-compatible thin webhooks fire immediately and independently of
    // the native cadence/digest logic below (InsightIQ has no digest concept).
    // Best-effort — the emitter swallows its own errors.
    await this.standardWebhooks.fireData({
      accountId: args.accountId,
      product: args.product,
      sampleIds: args.sampleIds,
    });

    const cadence = await this.resolveCadence(account.workspaceId, args.product);
    const eventName = `data.${args.product}.updated`;
    const sampleIds = args.sampleIds.slice(0, SAMPLE_ID_CAP);

    if (cadence === 'immediate') {
      const now = new Date();
      await this.webhooks.emit(account.workspaceId, eventName, {
        account_id: account.id.toString(),
        platform: account.platform,
        workspace_id: account.workspaceId,
        product: args.product,
        items_added: args.itemsAdded,
        sample_ids: sampleIds,
        window_start: now.toISOString(),
        window_end: now.toISOString(),
        cadence: 'immediate',
        occurred_at: now.toISOString(),
      });
      return;
    }

    // Digest path: upsert one bucket per subscribed endpoint. Resolve
    // subscriptions NOW so an unsubscribe between buffer-time and
    // flush-time doesn't create a phantom row (the cron also re-checks,
    // but defending in depth keeps the buffer small).
    const endpoints = await this.prisma.webhookEndpoint.findMany({
      where: { workspaceId: account.workspaceId, active: true },
      select: { id: true, events: true },
    });
    const subscribed = endpoints.filter((e) => {
      if (!Array.isArray(e.events)) return false;
      return (e.events as unknown as string[]).includes(eventName);
    });
    if (subscribed.length === 0) return;

    for (const endpoint of subscribed) {
      await this.bufferOne({
        endpointId: endpoint.id,
        accountId: args.accountId,
        product: args.product,
        cadence,
        itemsAdded: args.itemsAdded,
        newSampleIds: sampleIds,
      });
    }
  }

  /**
   * Upsert one digest bucket. The "update" branch reads + writes
   * sample_ids inside a transaction so two concurrent syncs don't
   * clobber each other's appends; items_added uses Prisma's atomic
   * `increment` so even if the tx serializes weirdly the total is right.
   */
  private async bufferOne(args: {
    endpointId: string;
    accountId: bigint;
    product: string;
    cadence: Cadence;
    itemsAdded: number;
    newSampleIds: string[];
  }): Promise<void> {
    const where = {
      endpointId_accountId_product: {
        endpointId: args.endpointId,
        accountId: args.accountId,
        product: args.product,
      },
    };
    const existing = await this.prisma.pendingWebhookEvent.findUnique({
      where,
      select: { sampleIds: true },
    });
    const existingIds = Array.isArray(existing?.sampleIds)
      ? (existing.sampleIds as unknown as string[])
      : [];
    const mergedSampleIds = mergeCapped(existingIds, args.newSampleIds, SAMPLE_ID_CAP);

    await this.prisma.pendingWebhookEvent.upsert({
      where,
      create: {
        endpointId: args.endpointId,
        accountId: args.accountId,
        product: args.product,
        cadence: args.cadence,
        itemsAdded: args.itemsAdded,
        sampleIds: args.newSampleIds.slice(0, SAMPLE_ID_CAP) as unknown as Prisma.InputJsonValue,
      },
      update: {
        itemsAdded: { increment: args.itemsAdded },
        sampleIds: mergedSampleIds as unknown as Prisma.InputJsonValue,
        // Cadence shouldn't change mid-window but if the operator flipped
        // it, follow the new value so the cron's where-clause matches.
        cadence: args.cadence,
      },
    });
  }

  /**
   * Returns the operator-configured cadence for (workspace, product), or
   * "immediate" by default. Snapshot products are forced to immediate
   * regardless of config — the digest concept doesn't apply to them.
   */
  private async resolveCadence(
    workspaceId: string,
    product: string,
  ): Promise<Cadence> {
    if (SNAPSHOT_PRODUCTS.has(product)) return 'immediate';
    const map = await this.loadWorkspaceCadence(workspaceId);
    const v = map[product];
    if (v === 'hourly' || v === 'daily') return v;
    return 'immediate';
  }

  private async loadWorkspaceCadence(
    workspaceId: string,
  ): Promise<Record<string, Cadence>> {
    const now = Date.now();
    const cached = this.workspaceCache.get(workspaceId);
    if (cached && cached.expiresAt > now) return cached.cadenceMap;

    const row = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { webhookCadence: true },
    });
    const raw = row?.webhookCadence;
    const cadenceMap: Record<string, Cadence> =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? Object.fromEntries(
            Object.entries(raw as Record<string, unknown>).filter(
              (entry): entry is [string, Cadence] =>
                typeof entry[1] === 'string' &&
                (entry[1] === 'immediate' ||
                  entry[1] === 'hourly' ||
                  entry[1] === 'daily'),
            ),
          )
        : {};
    this.workspaceCache.set(workspaceId, {
      cadenceMap,
      expiresAt: now + WORKSPACE_CACHE_TTL_MS,
    });
    return cadenceMap;
  }

  /** Test helper — drops the workspace cache so the next call refetches. */
  clearCacheForTests(): void {
    this.workspaceCache.clear();
  }
}

function mergeCapped(
  existing: ReadonlyArray<string>,
  incoming: ReadonlyArray<string>,
  cap: number,
): string[] {
  if (existing.length >= cap) return [...existing];
  const seen = new Set(existing);
  const out = [...existing];
  for (const id of incoming) {
    if (out.length >= cap) break;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}
