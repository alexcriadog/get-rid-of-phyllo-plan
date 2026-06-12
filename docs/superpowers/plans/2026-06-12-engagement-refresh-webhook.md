# Engagement-Refresh Webhook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Emit `CONTENTS.UPDATED` when engagement on existing in-window posts changes (change-gated, cadence-throttled), plus a manual refresh trigger — so the consumer's engagement stops going stale when no new posts are published.

**Architecture:** Piggyback the existing per-account sync loop. `CanonicalWriteService` already has prev+fresh docs in memory; it gains an `itemsUpdated`/`updatedSampleIds` delta. `DataEventDispatcher.fire()` gains a refresh branch (emit when only engagement changed, throttled via Redis `SET NX EX`). A shared `EngagementRefreshService` powers both the auto path and a manual `POST /v1/accounts/:id/refresh`. Refresh cadence/window are two new columns on the `Cadence` Prisma model. No `socialmedia-backend` changes.

**Tech Stack:** NestJS, TypeScript, Prisma (MySQL `Cadence`), MongoDB (`contents` canonical), ioredis (`RedisService`), Jest (transpile-only — `npm test` is heavy; validate with `npx tsc --noEmit` + targeted `jest --config jest.config.ts <file>`).

---

### Task 1: Engagement-change helper + extended `PersistDelta`

**Files:**
- Modify: `poc/src/modules/sync/canonical-write.service.ts`
- Test: `poc/src/modules/sync/__tests__/engagement-changed.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { engagementChanged } from '../canonical-write.service';

const eng = (o: Partial<Record<string, number | null>>) => ({
  like_count: null, comment_count: null, view_count: null,
  share_count: null, save_count: null, dislike_count: null, ...o,
});

describe('engagementChanged', () => {
  it('true when a metric differs', () => {
    expect(engagementChanged({ engagement: eng({ like_count: 10 }) }, { engagement: eng({ like_count: 11 }) })).toBe(true);
  });
  it('false when all metrics equal', () => {
    expect(engagementChanged({ engagement: eng({ like_count: 10 }) }, { engagement: eng({ like_count: 10 }) })).toBe(false);
  });
  it('ignores non-engagement fields', () => {
    expect(engagementChanged({ engagement: eng({ like_count: 1 }), title: 'a' }, { engagement: eng({ like_count: 1 }), title: 'b' })).toBe(false);
  });
  it('true when prev has no engagement but fresh does', () => {
    expect(engagementChanged({}, { engagement: eng({ like_count: 5 }) })).toBe(true);
  });
  it('false when neither has engagement', () => {
    expect(engagementChanged({}, {})).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd poc && npx jest --config jest.config.ts src/modules/sync/__tests__/engagement-changed.spec.ts`
Expected: FAIL — `engagementChanged` is not exported.

- [ ] **Step 3: Implement `engagementChanged` + extend `PersistDelta`**

In `canonical-write.service.ts`, add the exported helper near the top (after imports):

```ts
const ENGAGEMENT_KEYS = [
  'like_count', 'comment_count', 'view_count',
  'share_count', 'save_count', 'dislike_count',
] as const;

/** True if any engagement metric differs between the stored doc and the fresh doc. */
export function engagementChanged(prev: unknown, fresh: unknown): boolean {
  const p = (prev as { engagement?: Record<string, unknown> } | null)?.engagement ?? {};
  const f = (fresh as { engagement?: Record<string, unknown> } | null)?.engagement ?? {};
  for (const k of ENGAGEMENT_KEYS) {
    if ((p[k] ?? null) !== (f[k] ?? null)) return true;
  }
  return false;
}
```

Extend the interface and constants:

```ts
export interface PersistDelta {
  itemsAdded: number;
  sampleIds: string[];
  itemsUpdated: number;
  updatedSampleIds: string[];
}

const ZERO_DELTA: PersistDelta = { itemsAdded: 0, sampleIds: [], itemsUpdated: 0, updatedSampleIds: [] };
const SNAPSHOT_DELTA: PersistDelta = { itemsAdded: 1, sampleIds: [], itemsUpdated: 0, updatedSampleIds: [] };
```

Update `deltaFromBulk` to return the new fields (set `itemsUpdated: 0, updatedSampleIds: []` there — Task 2 fills them in `writeContents`).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd poc && npx jest --config jest.config.ts src/modules/sync/__tests__/engagement-changed.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
cd poc && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "canonical-write|engagement-changed" || echo clean
git add src/modules/sync/canonical-write.service.ts src/modules/sync/__tests__/engagement-changed.spec.ts
git commit -m "feat(sync): engagementChanged helper + extend PersistDelta with itemsUpdated"
```

---

### Task 2: Populate `itemsUpdated` in `writeContents` (window-scoped)

**Files:**
- Modify: `poc/src/modules/sync/canonical-write.service.ts` (`writeContents`, `persist`)
- Test: `poc/src/modules/sync/__tests__/write-contents-delta.spec.ts`

**Context:** `writeContents` (lines ~210-262) loops `items`, has `prev = prevByExt.get(externalId)` and `fresh = toApiContent(ctx, item)`. New posts → existing `deltaFromBulk` path (upserts). Existing posts whose engagement changed AND `item.publishedAt >= now - windowDays` → count into `itemsUpdated` + push id into `updatedSampleIds` (cap 20). `windowDays` is threaded through `persist()` (default 90; Task 5 wires the real value).

- [ ] **Step 1: Write the failing test** (mock the Mongo collection)

```ts
import { CanonicalWriteService } from '../canonical-write.service';

function mockMongo(stored: Array<{ external_id: string; doc: unknown }>) {
  return {
    getCollection: () => ({
      find: () => ({ toArray: async () => stored }),
      bulkWrite: async () => ({ upsertedCount: 0, upsertedIds: {} }),
      findOne: async () => null,
    }),
  } as any;
}
const acct = { id: 1n, platform: 'tiktok', canonicalUserId: 'u', handle: 'h', endUserId: 'e', connectedAt: new Date(), createdAt: new Date() };
const recent = new Date().toISOString();
const old = new Date(Date.now() - 200 * 86400000).toISOString();
const item = (id: string, likes: number, published: string) => ({ platformContentId: id, publishedAt: published, engagement: { likes } } as any);

describe('writeContents itemsUpdated', () => {
  it('counts in-window existing posts whose engagement changed', async () => {
    const svc = new CanonicalWriteService(mockMongo([{ external_id: 'a', doc: { engagement: { like_count: 10 } } }]));
    const d = await (svc as any).writeContents((svc as any).buildContext(acct), [item('a', 11, recent)], 90);
    expect(d.itemsUpdated).toBe(1);
    expect(d.updatedSampleIds).toContain('a');
  });
  it('ignores out-of-window changes', async () => {
    const svc = new CanonicalWriteService(mockMongo([{ external_id: 'a', doc: { engagement: { like_count: 10 } } }]));
    const d = await (svc as any).writeContents((svc as any).buildContext(acct), [item('a', 11, old)], 90);
    expect(d.itemsUpdated).toBe(0);
  });
  it('ignores unchanged engagement', async () => {
    const svc = new CanonicalWriteService(mockMongo([{ external_id: 'a', doc: { engagement: { like_count: 10 } } }]));
    const d = await (svc as any).writeContents((svc as any).buildContext(acct), [item('a', 10, recent)], 90);
    expect(d.itemsUpdated).toBe(0);
  });
});
```

> NOTE TO IMPLEMENTER: `toApiContent` maps `ContentData.engagement.likes` → `ApiContent.engagement.like_count`. The production compare runs on the *mapped* fresh doc vs the stored `doc`. Read `toApiContent` (in `@modules/data-schema`) to confirm the mapping and adjust the `item()` builder so `fresh.engagement.like_count` ends up set. If building a full valid `ContentData` is heavy, keep the production compare as `engagementChanged(prev, fresh)` where `fresh = toApiContent(ctx, item)` and tune the fixture accordingly.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd poc && npx jest --config jest.config.ts src/modules/sync/__tests__/write-contents-delta.spec.ts`
Expected: FAIL — `writeContents` ignores the third arg / returns `itemsUpdated: 0`.

- [ ] **Step 3: Implement**

Change `writeContents` signature to `writeContents(ctx, items, windowDays = 90)`. Before the loop add `const updatedSampleIds: string[] = []; let itemsUpdatedCount = 0; const cutoff = Date.now() - windowDays * 86_400_000;`. Inside the loop, after `const doc = prev ? coalesceMerge(prev, fresh) : fresh;`:

```ts
const publishedMs = item.publishedAt ? new Date(item.publishedAt).getTime() : 0;
if (prev && publishedMs >= cutoff && engagementChanged(prev, fresh)) {
  if (updatedSampleIds.length < 20) updatedSampleIds.push(externalId);
  itemsUpdatedCount++;
}
```

After `const res = await col.bulkWrite(ops, { ordered: false });`:

```ts
const base = this.deltaFromBulk(res, idByOpIndex);
return { ...base, itemsUpdated: itemsUpdatedCount, updatedSampleIds };
```

Thread the window: change `persist(account, result, windowDays = 90)` and its `case "content": return this.writeContents(ctx, result.data as ContentData[], windowDays);`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd poc && npx jest --config jest.config.ts src/modules/sync/__tests__/write-contents-delta.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
cd poc && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "canonical-write|write-contents" || echo clean
git add src/modules/sync/canonical-write.service.ts src/modules/sync/__tests__/write-contents-delta.spec.ts
git commit -m "feat(sync): count in-window engagement changes as itemsUpdated"
```

---

### Task 3: Refresh config columns on `Cadence` + Prisma migration

**Files:**
- Modify: `poc/prisma/schema.prisma` (`model Cadence`)
- Create: migration under `poc/prisma/migrations/`

- [ ] **Step 1: Edit the schema** — add to `model Cadence`:

```prisma
  refreshIntervalSeconds Int? @map("refresh_interval_seconds")
  refreshWindowDays      Int? @map("refresh_window_days")
```

- [ ] **Step 2: Create + apply the migration**

Run: `cd poc && npx prisma migrate dev --name cadence_refresh_knobs --create-only`
Review the generated SQL (expect `ALTER TABLE Cadence ADD COLUMN refresh_interval_seconds INT NULL, ADD COLUMN refresh_window_days INT NULL;`), then `npx prisma migrate dev` to apply + regenerate client.

> NOTE: If no dev DB is reachable, use `--create-only`, hand-verify the SQL, run `npx prisma generate`, and flag in the PR that the prod migration runs via the normal deploy.

- [ ] **Step 3: Commit**

```bash
cd poc && git add prisma/schema.prisma prisma/migrations
git commit -m "feat(db): refresh_interval_seconds + refresh_window_days on Cadence"
```

---

### Task 4: `RefreshCadenceService` (config read + Redis throttle)

**Files:**
- Create: `poc/src/modules/outbound-webhooks/refresh-cadence.service.ts`
- Test: `poc/src/modules/outbound-webhooks/__tests__/refresh-cadence.spec.ts`

**Defaults:** `DEFAULT_REFRESH_INTERVAL_SECONDS = 21600` (6h), `DEFAULT_REFRESH_WINDOW_DAYS = 90`.

- [ ] **Step 1: Write the failing test**

```ts
import { RefreshCadenceService } from '../refresh-cadence.service';

const prisma = { cadence: { findUnique: jest.fn() } } as any;
function redisMock(setResult: 'OK' | null) {
  return { client: { set: jest.fn().mockResolvedValue(setResult) } } as any;
}

describe('RefreshCadenceService', () => {
  it('returns config with defaults when row missing', async () => {
    prisma.cadence.findUnique.mockResolvedValue(null);
    const svc = new RefreshCadenceService(prisma, redisMock('OK'));
    expect(await svc.getConfig('tiktok', 'content')).toEqual({ intervalSeconds: 21600, windowDays: 90 });
  });
  it('uses row overrides when present', async () => {
    prisma.cadence.findUnique.mockResolvedValue({ refreshIntervalSeconds: 3600, refreshWindowDays: 30 });
    const svc = new RefreshCadenceService(prisma, redisMock('OK'));
    expect(await svc.getConfig('tiktok', 'content')).toEqual({ intervalSeconds: 3600, windowDays: 30 });
  });
  it('tryAcquire returns true when SET NX returns OK', async () => {
    const r = redisMock('OK');
    const svc = new RefreshCadenceService(prisma, r);
    expect(await svc.tryAcquire(1n, 'content', 3600)).toBe(true);
    expect(r.client.set).toHaveBeenCalledWith('refresh_emit:1:content', '1', 'EX', 3600, 'NX');
  });
  it('tryAcquire returns false when SET NX returns null (already set)', async () => {
    const svc = new RefreshCadenceService(prisma, redisMock(null));
    expect(await svc.tryAcquire(1n, 'content', 3600)).toBe(false);
  });
  it('tryAcquire fails closed (false) on redis error', async () => {
    const r = { client: { set: jest.fn().mockRejectedValue(new Error('down')) } } as any;
    const svc = new RefreshCadenceService(prisma, r);
    expect(await svc.tryAcquire(1n, 'content', 3600)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd poc && npx jest --config jest.config.ts src/modules/outbound-webhooks/__tests__/refresh-cadence.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** (confirm `RedisService` exposes the ioredis client — read `src/shared/redis/redis.service.ts`; webhooks-digest uses `this.redis`. Use the real accessor; `this.redis.client` assumed below.)

```ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@shared/database/prisma.service';
import { RedisService } from '@shared/redis/redis.service';

export const DEFAULT_REFRESH_INTERVAL_SECONDS = 21_600; // 6h
export const DEFAULT_REFRESH_WINDOW_DAYS = 90;

export interface RefreshConfig { intervalSeconds: number; windowDays: number; }

@Injectable()
export class RefreshCadenceService {
  private readonly logger = new Logger(RefreshCadenceService.name);
  constructor(private readonly prisma: PrismaService, private readonly redis: RedisService) {}

  async getConfig(platform: string, product: string): Promise<RefreshConfig> {
    const row = await this.prisma.cadence.findUnique({ where: { platform_product: { platform, product } } });
    return {
      intervalSeconds: row?.refreshIntervalSeconds ?? DEFAULT_REFRESH_INTERVAL_SECONDS,
      windowDays: row?.refreshWindowDays ?? DEFAULT_REFRESH_WINDOW_DAYS,
    };
  }

  /** SET NX EX — true once per interval. Fails closed (false) on Redis error to avoid spamming. */
  async tryAcquire(accountId: bigint, product: string, intervalSeconds: number): Promise<boolean> {
    const key = `refresh_emit:${accountId.toString()}:${product}`;
    try {
      const res = await this.redis.client.set(key, '1', 'EX', intervalSeconds, 'NX');
      return res === 'OK';
    } catch (err) {
      this.logger.warn(`refresh throttle redis error for ${key}: ${err instanceof Error ? err.message : err}`);
      return false;
    }
  }
}
```

> NOTE: confirm the composite key arg name in the generated Prisma client (`platform_product` from `@@id([platform, product])`). Adjust `where` if the generated name differs.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd poc && npx jest --config jest.config.ts src/modules/outbound-webhooks/__tests__/refresh-cadence.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
cd poc && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "refresh-cadence" || echo clean
git add src/modules/outbound-webhooks/refresh-cadence.service.ts src/modules/outbound-webhooks/__tests__/refresh-cadence.spec.ts
git commit -m "feat(webhooks): RefreshCadenceService (config + redis throttle)"
```

---

### Task 5: Refresh branch in `DataEventDispatcher.fire` + sync.worker pass-through

**Files:**
- Modify: `poc/src/modules/outbound-webhooks/data-event-dispatcher.service.ts`
- Modify: `poc/src/modules/outbound-webhooks/outbound-webhooks.module.ts` (provide `RefreshCadenceService`)
- Modify: `poc/src/modules/sync/sync.worker.ts:389` (pass new delta fields)
- Test: `poc/src/modules/outbound-webhooks/__tests__/data-event-dispatcher.refresh.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { DataEventDispatcher } from '../data-event-dispatcher.service';

function deps(acquire: boolean) {
  const account = { findUnique: jest.fn().mockResolvedValue({ id: 1n, workspaceId: 'w', platform: 'tiktok', isTest: false }) };
  const prisma = { account, webhookEndpoint: { findMany: jest.fn().mockResolvedValue([]) } } as any;
  const standardWebhooks = { fireData: jest.fn().mockResolvedValue(undefined) } as any;
  const webhooks = { emit: jest.fn().mockResolvedValue(undefined) } as any;
  const refresh = { getConfig: jest.fn().mockResolvedValue({ intervalSeconds: 3600, windowDays: 90 }), tryAcquire: jest.fn().mockResolvedValue(acquire) } as any;
  return { prisma, standardWebhooks, webhooks, refresh };
}

describe('DataEventDispatcher refresh branch', () => {
  it('emits refresh (fireData) when only engagement changed and cadence elapsed', async () => {
    const d = deps(true);
    const svc = new DataEventDispatcher(d.prisma, d.webhooks, d.standardWebhooks, d.refresh);
    await svc.fire({ accountId: 1n, product: 'content', itemsAdded: 0, sampleIds: [], itemsUpdated: 2, updatedSampleIds: ['a', 'b'] });
    expect(d.standardWebhooks.fireData).toHaveBeenCalledWith(expect.objectContaining({ accountId: 1n, product: 'content', sampleIds: ['a', 'b'] }));
  });
  it('does NOT emit when cadence not elapsed', async () => {
    const d = deps(false);
    const svc = new DataEventDispatcher(d.prisma, d.webhooks, d.standardWebhooks, d.refresh);
    await svc.fire({ accountId: 1n, product: 'content', itemsAdded: 0, sampleIds: [], itemsUpdated: 2, updatedSampleIds: ['a'] });
    expect(d.standardWebhooks.fireData).not.toHaveBeenCalled();
  });
  it('does NOT emit when nothing changed', async () => {
    const d = deps(true);
    const svc = new DataEventDispatcher(d.prisma, d.webhooks, d.standardWebhooks, d.refresh);
    await svc.fire({ accountId: 1n, product: 'content', itemsAdded: 0, sampleIds: [], itemsUpdated: 0, updatedSampleIds: [] });
    expect(d.standardWebhooks.fireData).not.toHaveBeenCalled();
    expect(d.refresh.tryAcquire).not.toHaveBeenCalled();
  });
  it('added path unchanged when itemsAdded>0', async () => {
    const d = deps(true);
    const svc = new DataEventDispatcher(d.prisma, d.webhooks, d.standardWebhooks, d.refresh);
    await svc.fire({ accountId: 1n, product: 'content', itemsAdded: 1, sampleIds: ['n'], itemsUpdated: 5, updatedSampleIds: ['x'] });
    expect(d.standardWebhooks.fireData).toHaveBeenCalledWith(expect.objectContaining({ sampleIds: ['n'] }));
    expect(d.refresh.tryAcquire).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd poc && npx jest --config jest.config.ts src/modules/outbound-webhooks/__tests__/data-event-dispatcher.refresh.spec.ts`
Expected: FAIL — constructor arity / no refresh branch.

- [ ] **Step 3: Implement**

Add `private readonly refresh: RefreshCadenceService` as the 4th constructor param. Change `fire()` to accept `itemsUpdated`/`updatedSampleIds` and replace the top guard + add the refresh branch:

```ts
async fire(args: {
  accountId: bigint; product: string;
  itemsAdded: number; sampleIds: string[];
  itemsUpdated?: number; updatedSampleIds?: string[];
}): Promise<void> {
  const isAdd = args.itemsAdded > 0;
  const isRefresh = !isAdd && (args.itemsUpdated ?? 0) > 0;
  if (!isAdd && !isRefresh) return;

  const account = await this.prisma.account.findUnique({ where: { id: args.accountId }, select: { id: true, workspaceId: true, platform: true, isTest: true } });
  if (!account) { this.logger.warn(`DataEventDispatcher: account ${args.accountId.toString()} not found`); return; }
  if (account.isTest) return;

  if (isRefresh) {
    const cfg = await this.refresh.getConfig(account.platform, args.product);
    const ok = await this.refresh.tryAcquire(args.accountId, args.product, cfg.intervalSeconds);
    if (!ok) return;
    const ids = (args.updatedSampleIds ?? []).slice(0, SAMPLE_ID_CAP);
    await this.standardWebhooks.fireData({ accountId: args.accountId, product: args.product, sampleIds: ids });
    const now = new Date();
    await this.webhooks.emit(account.workspaceId, `data.${args.product}.updated`, {
      account_id: account.id.toString(), platform: account.platform, workspace_id: account.workspaceId,
      product: args.product, items_added: 0, sample_ids: ids, reason: 'refresh',
      window_start: new Date(now.getTime() - cfg.windowDays * 86_400_000).toISOString(),
      window_end: now.toISOString(), cadence: 'immediate', occurred_at: now.toISOString(),
    });
    return;
  }

  // ---- existing itemsAdded>0 path unchanged below (keep fireData + cadence/digest logic) ----
  const sampleIds = args.sampleIds.slice(0, SAMPLE_ID_CAP);
  await this.standardWebhooks.fireData({ accountId: args.accountId, product: args.product, sampleIds });
  // ...retain the existing resolveCadence + immediate/digest block exactly as today, using `args.itemsAdded` and `sampleIds`...
}
```

In `outbound-webhooks.module.ts`, add `RefreshCadenceService` to `providers`. In `sync.worker.ts` (~line 389):

```ts
await this.dataEvents.fire({
  accountId: account.id, product,
  itemsAdded: delta.itemsAdded, sampleIds: delta.sampleIds,
  itemsUpdated: delta.itemsUpdated, updatedSampleIds: delta.updatedSampleIds,
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd poc && npx jest --config jest.config.ts src/modules/outbound-webhooks/__tests__/data-event-dispatcher.refresh.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
cd poc && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "data-event-dispatcher|sync.worker|outbound-webhooks.module" || echo clean
git add src/modules/outbound-webhooks/data-event-dispatcher.service.ts src/modules/outbound-webhooks/outbound-webhooks.module.ts src/modules/sync/sync.worker.ts src/modules/outbound-webhooks/__tests__/data-event-dispatcher.refresh.spec.ts
git commit -m "feat(webhooks): change-gated CONTENTS.UPDATED refresh emit"
```

---

### Task 6: Manual refresh trigger (`EngagementRefreshService` + endpoint)

**Files:**
- Create: `poc/src/modules/outbound-webhooks/engagement-refresh.service.ts`
- Create: `poc/src/modules/outbound-webhooks/refresh.controller.ts`
- Modify: `poc/src/modules/outbound-webhooks/outbound-webhooks.module.ts` (register both)
- Test: `poc/src/modules/outbound-webhooks/__tests__/engagement-refresh.spec.ts`

**Behavior:** `EngagementRefreshService.emitForAccount(account, product, windowDays)` enumerates in-window content `external_id`s from `contents` (cap 20, newest first), then `standardWebhooks.fireData` + native emit (`reason: 'manual'`). The controller `POST /v1/accounts/:accountId/refresh` (BearerApiKeyGuard) resolves the account, verifies workspace ownership, **bypasses throttle**, returns `{ refreshed, sample_count }`.

- [ ] **Step 1: Write the failing test**

```ts
import { EngagementRefreshService } from '../engagement-refresh.service';

function mongoWith(ids: string[]) {
  return { getCollection: () => ({ find: () => ({ sort: () => ({ limit: () => ({ toArray: async () => ids.map((external_id) => ({ external_id })) }) }) }) }) } as any;
}

describe('EngagementRefreshService', () => {
  it('emits with in-window ids, reason=manual', async () => {
    const standardWebhooks = { fireData: jest.fn().mockResolvedValue(undefined) } as any;
    const webhooks = { emit: jest.fn().mockResolvedValue(undefined) } as any;
    const svc = new EngagementRefreshService(mongoWith(['a', 'b']), standardWebhooks, webhooks);
    const r = await svc.emitForAccount({ id: 1n, workspaceId: 'w', platform: 'tiktok' } as any, 'content', 90);
    expect(r.sampleCount).toBe(2);
    expect(standardWebhooks.fireData).toHaveBeenCalledWith(expect.objectContaining({ accountId: 1n, product: 'content', sampleIds: ['a', 'b'] }));
    expect(webhooks.emit).toHaveBeenCalledWith('w', 'data.content.updated', expect.objectContaining({ reason: 'manual' }));
  });
  it('returns sampleCount 0 without throwing when no in-window content', async () => {
    const standardWebhooks = { fireData: jest.fn().mockResolvedValue(undefined) } as any;
    const webhooks = { emit: jest.fn().mockResolvedValue(undefined) } as any;
    const svc = new EngagementRefreshService(mongoWith([]), standardWebhooks, webhooks);
    const r = await svc.emitForAccount({ id: 1n, workspaceId: 'w', platform: 'tiktok' } as any, 'content', 90);
    expect(r.sampleCount).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd poc && npx jest --config jest.config.ts src/modules/outbound-webhooks/__tests__/engagement-refresh.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service**

```ts
import { Injectable } from '@nestjs/common';
import { MongoService } from '@shared/database/mongo.service';
import { OutboundWebhooksService } from './outbound-webhooks.service';
import { StandardWebhookEmitter } from './standard-webhook-emitter.service';

const SAMPLE_CAP = 20;

@Injectable()
export class EngagementRefreshService {
  constructor(
    private readonly mongo: MongoService,
    private readonly standardWebhooks: StandardWebhookEmitter,
    private readonly webhooks: OutboundWebhooksService,
  ) {}

  async emitForAccount(account: { id: bigint; workspaceId: string; platform: string }, product: string, windowDays: number): Promise<{ sampleCount: number }> {
    const cutoff = new Date(Date.now() - windowDays * 86_400_000);
    const rows = await this.mongo
      .getCollection<{ external_id?: string }>('contents')
      .find({ account_pk: account.id.toString(), published_at: { $gte: cutoff } })
      .sort({ published_at: -1 })
      .limit(SAMPLE_CAP)
      .toArray();
    const ids = rows.map((r) => r.external_id).filter((x): x is string => !!x);
    await this.standardWebhooks.fireData({ accountId: account.id, product, sampleIds: ids });
    const now = new Date();
    await this.webhooks.emit(account.workspaceId, `data.${product}.updated`, {
      account_id: account.id.toString(), platform: account.platform, workspace_id: account.workspaceId,
      product, items_added: 0, sample_ids: ids, reason: 'manual',
      window_start: cutoff.toISOString(), window_end: now.toISOString(), cadence: 'immediate', occurred_at: now.toISOString(),
    });
    return { sampleCount: ids.length };
  }
}
```

> NOTE: `writeContents` stores `published_at: item.publishedAt ?? null` — confirm it's a Date in Mongo. If stored as ISO strings, the `$gte: cutoff` Date still compares correctly for ISO strings, but if the collection has mixed types, filter in app code instead.

- [ ] **Step 4: Implement the controller** (mirror `webhook-deliveries.controller.ts` guard/workspace pattern)

```ts
import { BadRequestException, Body, Controller, NotFoundException, Param, Post, Req, UseGuards } from '@nestjs/common';
import { PrismaService } from '@shared/database/prisma.service';
import { BearerApiKeyGuard, RequestWithWorkspace } from '@/common/guards/bearer-api-key.guard';
import { EngagementRefreshService } from './engagement-refresh.service';
import { DEFAULT_REFRESH_WINDOW_DAYS } from './refresh-cadence.service';

@Controller('v1/accounts')
@UseGuards(BearerApiKeyGuard)
export class RefreshController {
  constructor(private readonly prisma: PrismaService, private readonly refresh: EngagementRefreshService) {}

  @Post(':accountId/refresh')
  async refreshAccount(
    @Req() req: RequestWithWorkspace,
    @Param('accountId') accountId: string,
    @Body() body: { product?: string; windowDays?: number },
  ): Promise<{ refreshed: boolean; sample_count: number }> {
    const ws = req.workspace?.workspaceId;
    if (!ws) throw new BadRequestException('workspace context missing');
    let id: bigint;
    try { id = BigInt(accountId); } catch { throw new BadRequestException('invalid accountId'); }
    const account = await this.prisma.account.findUnique({ where: { id }, select: { id: true, workspaceId: true, platform: true } });
    if (!account || account.workspaceId !== ws) throw new NotFoundException('account not found');
    const product = body.product ?? 'content';
    const windowDays = body.windowDays ?? DEFAULT_REFRESH_WINDOW_DAYS;
    const r = await this.refresh.emitForAccount(account, product, windowDays);
    return { refreshed: true, sample_count: r.sampleCount };
  }
}
```

Register `EngagementRefreshService` (providers) + `RefreshController` (controllers) in `outbound-webhooks.module.ts`.

- [ ] **Step 5: Run test + typecheck**

Run: `cd poc && npx jest --config jest.config.ts src/modules/outbound-webhooks/__tests__/engagement-refresh.spec.ts`
Expected: PASS (2 tests).
Run: `cd poc && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "engagement-refresh|refresh.controller|outbound-webhooks.module" || echo clean`

- [ ] **Step 6: Commit**

```bash
cd poc && git add src/modules/outbound-webhooks/engagement-refresh.service.ts src/modules/outbound-webhooks/refresh.controller.ts src/modules/outbound-webhooks/outbound-webhooks.module.ts src/modules/outbound-webhooks/__tests__/engagement-refresh.spec.ts
git commit -m "feat(webhooks): manual engagement-refresh trigger endpoint"
```

---

### Task 7: Full typecheck + wire-up verification + PR

- [ ] **Step 1:** `cd poc && npx tsc --noEmit -p tsconfig.json 2>&1 | tail -20` — no errors in touched files (pre-existing unrelated errors, if any, are out of scope; confirm none reference the touched files).
- [ ] **Step 2:** Run all four new spec dirs/files: `cd poc && npx jest --config jest.config.ts src/modules/sync/__tests__ src/modules/outbound-webhooks/__tests__/refresh-cadence.spec.ts src/modules/outbound-webhooks/__tests__/data-event-dispatcher.refresh.spec.ts src/modules/outbound-webhooks/__tests__/engagement-refresh.spec.ts` — all green.
- [ ] **Step 3:** DI smoke: `cd poc && npx nest build 2>&1 | tail -10` (if `nest build` exists) or `npx tsc --noEmit`; both should be clean. Optionally boot to confirm `RefreshCadenceService`/`EngagementRefreshService` resolve.
- [ ] **Step 4:** Push branch + open PR to `main`: summarize feature, the `Cadence` migration, and that `socialmedia-backend` needs no change.

## Self-Review

- **Spec coverage:** Component 1 → Tasks 1-2; Component 2 → Task 5; Component 3 → Tasks 3-4; Component 4 → Task 4; Component 5 → Task 6. Error handling (fail-closed throttle) → Task 4. Tests → each task. ✓
- **Type consistency:** `PersistDelta` fields (`itemsUpdated`/`updatedSampleIds`) consistent across Tasks 1/2/5; `fire()` arg shape matches sync.worker pass-through; `RefreshConfig.{intervalSeconds,windowDays}` consistent across Tasks 4/5; `engagementChanged`/`emitForAccount`/`tryAcquire`/`getConfig` names consistent. ✓
- **Items deferred to implementer (flagged inline, not behavior placeholders):** exact `RedisService` client accessor, Prisma composite-key arg name (`platform_product`), `toApiContent` engagement mapping in the Task 2 fixture, `published_at` stored type. Each requires reading the live file and is marked with a NOTE.
