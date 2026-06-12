// EngagementRefreshService — manual engagement-refresh trigger.
//
// Operators (or the product API) can force a `data.<product>.updated`
// emit for an account without waiting for a sync delta. We query the
// `contents` canonical collection for the account's in-window posts
// (published within the last `windowDays`), newest first, cap the sample,
// and emit both the InsightIQ-compatible thin webhook (standard emitter)
// and the native event with `reason: 'manual'`.
//
// Unlike the sync-driven path in DataEventDispatcher this is unthrottled —
// the caller (the guarded POST endpoint) is responsible for rate limiting.

import { Injectable } from '@nestjs/common';
import { MongoService } from '@shared/database/mongo.service';
import { OutboundWebhooksService } from './outbound-webhooks.service';
import { StandardWebhookEmitter } from './standard-webhook-emitter.service';

const SAMPLE_CAP = 20;
const DAY_MS = 86_400_000;

interface RefreshAccount {
  id: bigint;
  workspaceId: string;
  platform: string;
}

@Injectable()
export class EngagementRefreshService {
  constructor(
    private readonly mongo: MongoService,
    private readonly standardWebhooks: StandardWebhookEmitter,
    private readonly webhooks: OutboundWebhooksService,
  ) {}

  /**
   * Emit a manual `data.<product>.updated` for the account's in-window
   * content. Returns the number of sample ids that were included.
   */
  async emitForAccount(
    account: RefreshAccount,
    product: string,
    windowDays: number,
  ): Promise<{ sampleCount: number }> {
    const cutoff = new Date(Date.now() - windowDays * DAY_MS);
    const rows = await this.mongo
      .getCollection<{ external_id?: string }>('contents')
      .find({
        account_pk: account.id.toString(),
        published_at: { $gte: cutoff },
      })
      .sort({ published_at: -1 })
      .limit(SAMPLE_CAP)
      .toArray();

    const ids = rows
      .map((r) => r.external_id)
      .filter((x): x is string => !!x);

    // No in-window content → nothing meaningful to refresh. Skip both emits so
    // we don't deliver an empty `data.<product>.updated` to subscribers.
    if (ids.length === 0) {
      return { sampleCount: 0 };
    }

    // InsightIQ-compatible thin webhook (fires independently of native cadence).
    await this.standardWebhooks.fireData({
      accountId: account.id,
      product,
      sampleIds: ids,
    });

    const now = new Date();
    await this.webhooks.emit(account.workspaceId, `data.${product}.updated`, {
      account_id: account.id.toString(),
      platform: account.platform,
      workspace_id: account.workspaceId,
      product,
      items_added: 0,
      sample_ids: ids,
      reason: 'manual',
      window_start: cutoff.toISOString(),
      window_end: now.toISOString(),
      cadence: 'immediate',
      occurred_at: now.toISOString(),
    });

    return { sampleCount: ids.length };
  }
}
