// Emits Phyllo (InsightIQ)-compatible thin webhooks to endpoints whose
// `format === 'phyllo'`. Thin = ids only; the consumer fetches data from our
// Phyllo-compatible read API. See PLAN-phyllo-schema-alignment.md §5.
//
// Differences from the native emitter (OutboundWebhooksService):
//   - Phyllo event names + envelope {event, name, id, data:{...}}.
//   - account_id/user_id/profile_id/items are minted Phyllo UUIDs.
//   - ADDED vs UPDATED resolved via a per-(account,event) marker.
//   - Always immediate (Phyllo has no digest cadence).
//   - Signed with `Webhook-Signatures` (handled in the delivery worker by
//     branching on endpoint.format).

import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PrismaService } from "@shared/database/prisma.service";
import { MongoService } from "@shared/database/mongo.service";
import { BullmqService, QueueName } from "@shared/redis/bullmq.service";
import {
  naiveUtc,
  phylloAccountId,
  phylloProfileId,
  phylloContentId,
  phylloUserIdOrFallback,
} from "@modules/phyllo-compat";
import {
  PRODUCT_EVENT_MAP,
  LIFECYCLE_EVENT_MAP,
  chunk,
  type PhylloEventSpec,
} from "./phyllo-webhook-events";

const QUEUE: QueueName = "delivery";
const MAX_ITEMS = 100;

interface AccountCtx {
  pk: string;
  workspaceId: string;
  endUserId: string | null;
  isTest: boolean;
}

@Injectable()
export class PhylloWebhookEmitter {
  private readonly logger = new Logger(PhylloWebhookEmitter.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mongo: MongoService,
    private readonly bull: BullmqService,
  ) {}

  /**
   * Fire a Phyllo data event for a product sync that added items. `sampleIds`
   * are platform-native ids (content ids for content products; comment ids
   * for the comments product — resolved to their content ids here).
   */
  async fireData(args: {
    accountId: bigint;
    product: string;
    sampleIds: string[];
  }): Promise<void> {
    const spec = PRODUCT_EVENT_MAP[args.product];
    if (!spec) return; // product not part of the Phyllo surface
    const acc = await this.loadAccount(args.accountId);
    if (!acc || acc.isTest) return;
    const endpoints = await this.phylloEndpoints(acc.workspaceId);
    if (endpoints.length === 0) return;

    const items =
      spec.kind === "items"
        ? await this.resolveItems(acc.pk, args.product, args.sampleIds)
        : [];

    for (const ep of endpoints) {
      const eventName = await this.resolveAddedUpdated(
        acc.pk,
        spec,
        args.product,
      );
      if (!this.subscribed(ep, eventName)) continue;
      const data = this.buildData(spec, acc, items);
      const chunks =
        spec.kind === "items" && items.length > MAX_ITEMS
          ? chunk(items, MAX_ITEMS)
          : [items];
      for (const c of chunks) {
        await this.enqueue(ep, eventName, spec, {
          ...data,
          ...(spec.kind === "items" ? { items: c } : {}),
        });
      }
    }
  }

  /** Fire a Phyllo lifecycle event (connect/disconnect/session expired). */
  async fireLifecycle(args: {
    accountId: bigint;
    type: string;
  }): Promise<void> {
    const spec = LIFECYCLE_EVENT_MAP[args.type];
    if (!spec) return;
    const acc = await this.loadAccount(args.accountId);
    if (!acc || acc.isTest) return;
    const endpoints = await this.phylloEndpoints(acc.workspaceId);
    for (const ep of endpoints) {
      if (!this.subscribed(ep, spec.added)) continue;
      await this.enqueue(ep, spec.added, spec, this.buildData(spec, acc, []));
    }
  }

  // ── internals ──

  private buildData(
    spec: PhylloEventSpec,
    acc: AccountCtx,
    items: string[],
  ): Record<string, unknown> {
    const base: Record<string, unknown> = {
      account_id: phylloAccountId(acc.pk),
      user_id: phylloUserIdOrFallback(acc.endUserId, acc.pk),
      last_updated_time: naiveUtc(new Date()),
    };
    if (spec.kind === "profile") base.profile_id = phylloProfileId(acc.pk);
    if (spec.kind === "items") base.items = items;
    return base;
  }

  private async enqueue(
    ep: { id: string },
    eventName: string,
    spec: PhylloEventSpec,
    data: Record<string, unknown>,
  ): Promise<void> {
    const isUpdated = spec.updated === eventName;
    const payload = {
      event: eventName,
      name: (isUpdated ? spec.nameUpdated : spec.nameAdded) ?? spec.nameAdded,
      id: randomUUID(),
      data,
    };
    try {
      const delivery = await this.prisma.webhookDelivery.create({
        data: {
          endpointId: ep.id,
          event: eventName,
          payload: payload as object,
          status: "pending",
        },
      });
      await this.bull
        .getQueue<{ deliveryId: string }>(QUEUE)
        .add("webhook", { deliveryId: delivery.id }, { jobId: delivery.id });
    } catch (err) {
      this.logger.error(
        `phyllo webhook enqueue failed (event=${eventName}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async loadAccount(accountId: bigint): Promise<AccountCtx | null> {
    const a = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: { id: true, workspaceId: true, endUserId: true, isTest: true },
    });
    if (!a) return null;
    return {
      pk: a.id.toString(),
      workspaceId: a.workspaceId,
      endUserId: a.endUserId,
      isTest: a.isTest,
    };
  }

  private async phylloEndpoints(
    workspaceId: string,
  ): Promise<Array<{ id: string; events: unknown }>> {
    return this.prisma.webhookEndpoint.findMany({
      where: { workspaceId, active: true, format: "phyllo" },
      select: { id: true, events: true },
    });
  }

  private subscribed(ep: { events: unknown }, eventName: string): boolean {
    return (
      Array.isArray(ep.events) && (ep.events as string[]).includes(eventName)
    );
  }

  /**
   * First emit for (account, product) → ADDED; subsequent → UPDATED. Uses a
   * Mongo marker upserted atomically; upsertedCount===1 means it's the first.
   */
  private async resolveAddedUpdated(
    accountPk: string,
    spec: PhylloEventSpec,
    product: string,
  ): Promise<string> {
    if (!spec.updated) return spec.added;
    const res = await this.mongo
      .getCollection("phyllo_emit_state")
      .updateOne(
        { account_pk: accountPk, product },
        {
          $setOnInsert: {
            account_pk: accountPk,
            product,
            first_emitted_at: new Date(),
          },
        },
        { upsert: true },
      );
    const isFirst = (res.upsertedCount ?? 0) === 1;
    return isFirst ? spec.added : spec.updated;
  }

  /**
   * Map sample ids to Phyllo content UUIDs. For content products the sample
   * ids ARE platform content ids. For the comments product they are comment
   * ids — resolve each to its content's external id first.
   */
  private async resolveItems(
    accountPk: string,
    product: string,
    sampleIds: string[],
  ): Promise<string[]> {
    if (sampleIds.length === 0) return [];
    if (product !== "comments") {
      return sampleIds.map((extId) => phylloContentId(accountPk, extId));
    }
    const rows = await this.mongo
      .getCollection<{ content_external_id: string }>("phyllo_comments")
      .find({ account_pk: accountPk, external_id: { $in: sampleIds } })
      .project({ content_external_id: 1 })
      .toArray();
    const contentExtIds = [
      ...new Set(rows.map((r) => r.content_external_id).filter(Boolean)),
    ];
    return contentExtIds.map((extId) => phylloContentId(accountPk, extId));
  }
}
