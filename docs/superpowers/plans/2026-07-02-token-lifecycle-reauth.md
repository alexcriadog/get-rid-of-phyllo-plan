# Token Lifecycle & Re-auth Handling — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a soft "re-auth recommended" signal + real webhook deliveries, plus a selective liveness canary that self-heals false-positive `needs_reauth` — so the connector keeps extracting data until an account is genuinely ROTA, warns early, and never breaks silently.

**Architecture:** Two orthogonal mechanisms alongside the existing hourly refresh cron. (1) The daily `token-health` cron (data_access window) additionally sets a soft `Account.reauthRecommendedAt` flag and fires a `token.reauth_required` delivery — never changing sync status. (2) A new daily `token-canary` cron does a real cheapest-read probe (each adapter's existing `fetchProfile`) only for accounts NOT exercised by real syncs and for `needs_reauth` accounts; a real 200 restores `needs_reauth → ready` (self-heal, `token.recovered`), a token-dead error flips `ready → needs_reauth` (reusing the existing lifecycle). The hard path from active syncs already exists in `sync.worker.ts`.

**Tech Stack:** NestJS, Prisma (MySQL), BullMQ, Redis, Jest.

## Global Constraints

- Prisma provider is **MySQL**; migrations live in `poc/prisma/migrations/<14-digit>_<snake>/migration.sql`; create with `npx prisma migrate dev --name <snake>` (run from `poc/`).
- New outbound event names MUST be added to `ALLOWED_EVENTS` (`poc/src/modules/outbound-webhooks/outbound-webhooks.service.ts:25-49`) or `emit()` silently drops them.
- Token-dead classification is `TokenRevokedError` (`poc/src/modules/platforms/shared/platform-adapter.port.ts:135-145`); **default-to-transient** — only a genuine revoke flips `needs_reauth`; anything uncertain is transient.
- The soft state is a **field, not a new `Account.status`** value (`status` stays `ready` | `needs_reauth`).
- Soft signal **never** gates sync; only `needs_reauth` gates sync (existing behavior).
- Decrypt the probe token exactly as the sync worker does: `userAccessTokenCiphertext ?? accessTokenCiphertext` (`sync.worker.ts:317-320`).
- Fast test command (from `poc/`): `npx jest -c jest.lite.config.cjs <pattern> --no-coverage --maxWorkers=1`. Never run the full `npm test` (OOMs); type-safety via `npm run lint` (`tsc --noEmit`).
- Cron pattern: clone `token-health.cron.service.ts` shape — `process.argv[2] === 'api'` gate + `runWithLock` + UTC `@Cron`.

---

### Task 1: Migration — soft-signal + probe fields on `Account`

**Files:**
- Modify: `poc/prisma/schema.prisma:10-53` (the `Account` model)
- Create: `poc/prisma/migrations/20260702000000_token_health_soft_signal/migration.sql`

**Interfaces:**
- Produces: `Account.reauthRecommendedAt: DateTime?`, `Account.dataAccessExpiresAt: DateTime?`, `Account.lastProbedAt: DateTime?` (Prisma client fields consumed by Tasks 4 & 6).

- [ ] **Step 1: Add the three nullable columns to the `Account` model**

In `poc/prisma/schema.prisma`, inside `model Account { ... }`, after the `updatedAt` line (`:29` area), add:

```prisma
  reauthRecommendedAt  DateTime? @map("reauth_recommended_at")
  dataAccessExpiresAt  DateTime? @map("data_access_expires_at")
  lastProbedAt         DateTime? @map("last_probed_at")
```

- [ ] **Step 2: Create the migration**

Run (from `poc/`):

```bash
npx prisma migrate dev --name token_health_soft_signal
```

Expected: creates `poc/prisma/migrations/20260702_..._token_health_soft_signal/migration.sql` and applies it to the local dev MySQL. If the auto-generated folder timestamp differs from the header path, that's fine — keep whatever Prisma generates.

- [ ] **Step 3: Verify the generated SQL is additive**

Open the new `migration.sql`. Expected content (all nullable, no default, no backfill):

```sql
ALTER TABLE `accounts` ADD COLUMN `reauth_recommended_at` DATETIME(3) NULL,
    ADD COLUMN `data_access_expires_at` DATETIME(3) NULL,
    ADD COLUMN `last_probed_at` DATETIME(3) NULL;
```

- [ ] **Step 4: Regenerate the client and type-check**

```bash
npx prisma generate && npm run lint
```

Expected: PASS (no type errors; new fields available on the Prisma `Account` type).

- [ ] **Step 5: Commit**

```bash
git add poc/prisma/schema.prisma poc/prisma/migrations
git commit -m "feat(token-health): add reauthRecommendedAt/dataAccessExpiresAt/lastProbedAt to Account"
```

---

### Task 2: Register `token.reauth_required` + `token.recovered` events

**Files:**
- Modify: `poc/src/modules/outbound-webhooks/outbound-webhooks.service.ts:25-49` (`ALLOWED_EVENTS`)
- Test: `poc/src/modules/outbound-webhooks/__tests__/allowed-events.spec.ts` (create)

**Interfaces:**
- Produces: the strings `'token.reauth_required'` and `'token.recovered'` are emittable + subscribable.

- [ ] **Step 1: Write the failing test**

Create `poc/src/modules/outbound-webhooks/__tests__/allowed-events.spec.ts`:

```ts
import { ALLOWED_EVENTS } from '../outbound-webhooks.service';

describe('ALLOWED_EVENTS token lifecycle', () => {
  it('includes the new re-auth lifecycle events', () => {
    expect(ALLOWED_EVENTS).toContain('token.reauth_required');
    expect(ALLOWED_EVENTS).toContain('token.recovered');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx jest -c jest.lite.config.cjs allowed-events --no-coverage --maxWorkers=1
```

Expected: FAIL — `token.reauth_required` not in array.

- [ ] **Step 3: Add the events**

In `outbound-webhooks.service.ts`, inside the `ALLOWED_EVENTS` array, after `'token.expired',` add:

```ts
  'token.reauth_required',
  'token.recovered',
```

- [ ] **Step 4: Run it to verify it passes**

```bash
npx jest -c jest.lite.config.cjs allowed-events --no-coverage --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add poc/src/modules/outbound-webhooks/outbound-webhooks.service.ts poc/src/modules/outbound-webhooks/__tests__/allowed-events.spec.ts
git commit -m "feat(webhooks): allow token.reauth_required + token.recovered events"
```

---

### Task 3: `TokenLifecycleEmitter` — `reauthRecommended()` + `tokenRecovered()`

**Files:**
- Modify: `poc/src/modules/outbound-webhooks/token-lifecycle-emitter.service.ts` (add two methods after `tokenExpired`, `:98`)
- Test: `poc/src/modules/outbound-webhooks/__tests__/token-lifecycle-emitter.spec.ts` (create)

**Interfaces:**
- Consumes: existing `private loadAccount(accountId)` (returns `{id, workspaceId, platform, canonicalUserId, endUserId, isTest}`), `this.webhooks.emit(workspaceId, event, payload)`.
- Produces:
  - `reauthRecommended(accountId: bigint, opts: { dataAccessExpiresAt: Date | null; reason: string }): Promise<void>` → emits native `token.reauth_required` (`severity: 'soft'`).
  - `tokenRecovered(accountId: bigint, opts: { reason: string }): Promise<void>` → emits native `token.recovered`.

- [ ] **Step 1: Write the failing test**

Create `poc/src/modules/outbound-webhooks/__tests__/token-lifecycle-emitter.spec.ts`:

```ts
import { TokenLifecycleEmitter } from '../token-lifecycle-emitter.service';

function build(account: any) {
  const prisma = { account: { findUnique: jest.fn().mockResolvedValue(account) } };
  const webhooks = { emit: jest.fn().mockResolvedValue(undefined) };
  const standardWebhooks = { fireLifecycle: jest.fn().mockResolvedValue(undefined) };
  const svc = new TokenLifecycleEmitter(prisma as never, webhooks as never, standardWebhooks as never);
  return { svc, webhooks };
}

const acct = {
  id: 7n, workspaceId: 'w1', platform: 'instagram',
  canonicalUserId: 'cid', endUserId: 'eu1', isTest: false,
};

describe('TokenLifecycleEmitter re-auth signals', () => {
  it('reauthRecommended emits token.reauth_required with severity soft', async () => {
    const { svc, webhooks } = build(acct);
    const when = new Date('2026-08-08T00:00:00.000Z');
    await svc.reauthRecommended(7n, { dataAccessExpiresAt: when, reason: 'data_access expiring' });
    expect(webhooks.emit).toHaveBeenCalledWith(
      'w1',
      'token.reauth_required',
      expect.objectContaining({
        account_id: '7',
        platform: 'instagram',
        workspace_id: 'w1',
        severity: 'soft',
        data_access_expires_at: when.toISOString(),
        reason: 'data_access expiring',
      }),
    );
  });

  it('tokenRecovered emits token.recovered', async () => {
    const { svc, webhooks } = build(acct);
    await svc.tokenRecovered(7n, { reason: 'canary probe healthy' });
    expect(webhooks.emit).toHaveBeenCalledWith(
      'w1',
      'token.recovered',
      expect.objectContaining({ account_id: '7', reason: 'canary probe healthy' }),
    );
  });

  it('drops test-mode accounts silently', async () => {
    const { svc, webhooks } = build({ ...acct, isTest: true });
    await svc.reauthRecommended(7n, { dataAccessExpiresAt: null, reason: 'x' });
    expect(webhooks.emit).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx jest -c jest.lite.config.cjs token-lifecycle-emitter --no-coverage --maxWorkers=1
```

Expected: FAIL — `svc.reauthRecommended is not a function`.

- [ ] **Step 3: Add the two methods**

In `token-lifecycle-emitter.service.ts`, immediately after the `tokenExpired(...)` method (before `private async loadAccount`), add:

```ts
  /**
   * Soft signal: the data-access window is near/at its cliff but the token
   * still works. The account keeps syncing; the client should prompt the
   * end-user to reconnect at leisure. Fired once per transition (the health
   * cron gates on Account.reauthRecommendedAt), never changes status.
   */
  async reauthRecommended(
    accountId: bigint,
    opts: { dataAccessExpiresAt: Date | null; reason: string },
  ): Promise<void> {
    const acc = await this.loadAccount(accountId);
    if (!acc) return;
    if (acc.isTest) return;
    await this.webhooks.emit(acc.workspaceId, 'token.reauth_required', {
      account_id: acc.id.toString(),
      platform: acc.platform,
      workspace_id: acc.workspaceId,
      end_user_id: acc.endUserId ?? null,
      canonical_user_id: acc.canonicalUserId,
      severity: 'soft',
      data_access_expires_at: opts.dataAccessExpiresAt?.toISOString() ?? null,
      reason: opts.reason,
      occurred_at: new Date().toISOString(),
    });
  }

  /**
   * An account previously flagged needs_reauth passed a real liveness probe
   * again — it has been restored to status='ready'. Lets the client clear its
   * "reconnect" prompt.
   */
  async tokenRecovered(
    accountId: bigint,
    opts: { reason: string },
  ): Promise<void> {
    const acc = await this.loadAccount(accountId);
    if (!acc) return;
    if (acc.isTest) return;
    await this.webhooks.emit(acc.workspaceId, 'token.recovered', {
      account_id: acc.id.toString(),
      platform: acc.platform,
      workspace_id: acc.workspaceId,
      end_user_id: acc.endUserId ?? null,
      canonical_user_id: acc.canonicalUserId,
      reason: opts.reason,
      occurred_at: new Date().toISOString(),
    });
  }
```

- [ ] **Step 4: Run it to verify it passes**

```bash
npx jest -c jest.lite.config.cjs token-lifecycle-emitter --no-coverage --maxWorkers=1
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add poc/src/modules/outbound-webhooks/token-lifecycle-emitter.service.ts poc/src/modules/outbound-webhooks/__tests__/token-lifecycle-emitter.spec.ts
git commit -m "feat(webhooks): emit token.reauth_required (soft) + token.recovered"
```

---

### Task 4: Health cron sets/clears the soft flag + fires the soft signal

**Files:**
- Modify: `poc/src/modules/token-refresh/token-health.cron.service.ts` (constructor + `run()` select + `checkRow`)
- Test: `poc/src/modules/token-refresh/__tests__/token-health.soft-signal.spec.ts` (create)

**Interfaces:**
- Consumes: `TokenLifecycleEmitter.reauthRecommended`, `classifyDataAccess` (existing, from `./token-health.util`), `Account.reauthRecommendedAt` (Task 1).
- Produces: on a `expiring`/`expired` classification with `reauthRecommendedAt === null` → sets `reauthRecommendedAt` + `dataAccessExpiresAt` and calls `reauthRecommended` once; on a healthy classification with a set flag → clears it (no event).

- [ ] **Step 1: Write the failing test**

Create `poc/src/modules/token-refresh/__tests__/token-health.soft-signal.spec.ts`:

```ts
import { TokenHealthCronService } from '../token-health.cron.service';

// data_access ~2 days out => classifyDataAccess => 'expiring'
const soonMs = Date.now() + 2 * 24 * 3600_000;

function build(account: any) {
  const prisma = {
    oAuthToken: {
      findMany: jest.fn().mockResolvedValue([
        { accountId: 7n, accessTokenCiphertext: Buffer.from('x'), account: {
          platform: 'facebook', handle: 'p', metadata: {},
          reauthRecommendedAt: account.reauthRecommendedAt, status: 'ready',
        } },
      ]),
    },
    account: { update: jest.fn().mockResolvedValue({}) },
  };
  const aes = { decrypt: jest.fn(() => 'plain') };
  const config = { get: jest.fn(() => 'appid') };
  const metrics = { incr: jest.fn() };
  const redis = { client: { set: jest.fn(), get: jest.fn() }, key: () => 'k' };
  const lifecycle = { reauthRecommended: jest.fn().mockResolvedValue(undefined) };
  const svc = new TokenHealthCronService(
    prisma as never, redis as never, aes as never, config as never,
    metrics as never, lifecycle as never,
  );
  // Force debug_token to report the "expiring" cliff without a network call.
  (svc as any).probeDataAccessExpiry = jest.fn().mockResolvedValue(soonMs);
  return { svc, prisma, lifecycle };
}

const run = (s: TokenHealthCronService) =>
  (s as unknown as { run: () => Promise<unknown> }).run();

describe('token-health soft signal', () => {
  it('sets reauthRecommendedAt + fires reauthRecommended once when expiring', async () => {
    const { svc, prisma, lifecycle } = build({ reauthRecommendedAt: null });
    await run(svc);
    expect(prisma.account.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 7n },
        data: expect.objectContaining({ reauthRecommendedAt: expect.any(Date) }),
      }),
    );
    expect(lifecycle.reauthRecommended).toHaveBeenCalledTimes(1);
  });

  it('is idempotent: does not re-fire when already flagged', async () => {
    const { svc, lifecycle } = build({ reauthRecommendedAt: new Date() });
    await run(svc);
    expect(lifecycle.reauthRecommended).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx jest -c jest.lite.config.cjs token-health.soft-signal --no-coverage --maxWorkers=1
```

Expected: FAIL — constructor arity mismatch / `reauthRecommended` never called.

- [ ] **Step 3: Extend the health cron**

3a. Add the import at the top of `token-health.cron.service.ts`:

```ts
import { TokenLifecycleEmitter } from '@modules/outbound-webhooks/token-lifecycle-emitter.service';
```

3b. Add `lifecycle` to the constructor (after `metrics`):

```ts
    private readonly metrics: MetricsService,
    private readonly lifecycle: TokenLifecycleEmitter,
```

3c. In `run()`, extend the nested account select (currently `account: { select: { platform: true, handle: true, metadata: true } }`) to:

```ts
        account: { select: {
          platform: true, handle: true, metadata: true,
          reauthRecommendedAt: true, status: true,
        } },
```

3d. Extract the debug_token expiry lookup into an overridable method so tests can stub it. Add this method to the class:

```ts
  /** Overridable seam: returns data_access_expires_at ms (or null). */
  protected async probeDataAccessExpiry(
    url: string, inputToken: string, appToken: string,
  ): Promise<number | null> {
    const res = await axios.get<unknown>(url, {
      params: { input_token: inputToken, access_token: appToken },
      timeout: DEBUG_TIMEOUT_MS,
    });
    return parseDebugTokenDataAccessExpiry(res.data);
  }
```

Then in `checkRow`, replace the `const res = await axios.get<unknown>(...)` + `const expiresAtMs = parseDebugTokenDataAccessExpiry(res.data)` lines with:

```ts
      const expiresAtMs = await this.probeDataAccessExpiry(url, inputToken, appToken);
```

3e. Still in `checkRow`, after `const cls = classifyDataAccess(expiresAtMs, nowMs);`, add the soft-signal actuation:

```ts
      const alert = cls.status === 'expiring' || cls.status === 'expired';
      const dataAccessDate = expiresAtMs === null ? null : new Date(expiresAtMs);
      if (alert && row.account.reauthRecommendedAt === null) {
        await this.prisma.account.update({
          where: { id: row.accountId },
          data: { reauthRecommendedAt: new Date(), dataAccessExpiresAt: dataAccessDate },
        });
        await this.lifecycle.reauthRecommended(row.accountId, {
          dataAccessExpiresAt: dataAccessDate,
          reason: `data_access ${cls.status} (${cls.daysLeft} day(s) left)`,
        });
      } else if (!alert && row.account.reauthRecommendedAt !== null) {
        await this.prisma.account.update({
          where: { id: row.accountId },
          data: { reauthRecommendedAt: null },
        });
      }
```

3f. Update the `checkRow` parameter type: add `reauthRecommendedAt: Date | null;` and `status: string;` to the inline `account: {...}` type (the block at `:179-183`).

- [ ] **Step 4: Run it to verify it passes**

```bash
npx jest -c jest.lite.config.cjs token-health.soft-signal --no-coverage --maxWorkers=1
```

Expected: PASS (2 tests). Then confirm no regression on the existing sweep:

```bash
npx jest -c jest.lite.config.cjs token-health --no-coverage --maxWorkers=1 && npm run lint
```

- [ ] **Step 5: Register the new dependency + commit**

Confirm `TokenLifecycleEmitter` is importable in `token-refresh.module.ts` (it's provided by `OutboundWebhooksModule`; if the module isn't already imported there, add it to `imports`). Then:

```bash
git add poc/src/modules/token-refresh/token-health.cron.service.ts poc/src/modules/token-refresh/__tests__/token-health.soft-signal.spec.ts poc/src/modules/token-refresh/token-refresh.module.ts
git commit -m "feat(token-health): set soft reauthRecommended flag + emit token.reauth_required"
```

---

### Task 5: `probeAccount` classifier helper

**Files:**
- Create: `poc/src/modules/token-refresh/token-canary.util.ts`
- Test: `poc/src/modules/token-refresh/__tests__/token-canary.util.spec.ts`

**Interfaces:**
- Consumes: `PlatformAdapter.fetchProfile(accessToken, canonicalId, metadata?)`, `TokenRevokedError` (`platform-adapter.port.ts`).
- Produces: `probeAccount(adapter, accessToken, canonicalId, metadata?): Promise<'healthy' | 'reauth' | 'transient'>`.

- [ ] **Step 1: Write the failing test**

Create `poc/src/modules/token-refresh/__tests__/token-canary.util.spec.ts`:

```ts
import { probeAccount } from '../token-canary.util';
import { TokenRevokedError } from '@modules/platforms/shared/platform-adapter.port';

const adapterWith = (impl: () => Promise<unknown>) => ({ fetchProfile: impl }) as never;

describe('probeAccount', () => {
  it('returns healthy on a successful read', async () => {
    const r = await probeAccount(adapterWith(async () => ({ id: '1' })), 't', 'c');
    expect(r).toBe('healthy');
  });
  it('returns reauth on TokenRevokedError', async () => {
    const r = await probeAccount(
      adapterWith(async () => { throw new TokenRevokedError('dead'); }), 't', 'c');
    expect(r).toBe('reauth');
  });
  it('returns transient on any other error (default-to-transient)', async () => {
    const r = await probeAccount(
      adapterWith(async () => { throw new Error('503'); }), 't', 'c');
    expect(r).toBe('transient');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx jest -c jest.lite.config.cjs token-canary.util --no-coverage --maxWorkers=1
```

Expected: FAIL — cannot find `../token-canary.util`.

- [ ] **Step 3: Implement the helper**

Create `poc/src/modules/token-refresh/token-canary.util.ts`:

```ts
// Liveness probe verdict for the canary cron. Reuses each platform adapter's
// cheapest real read (fetchProfile) as ground truth, and classifies the error
// with the codebase's default-to-transient policy: only a genuine
// TokenRevokedError flips an account to needs_reauth.
import {
  PlatformAdapter,
  TokenRevokedError,
} from '@modules/platforms/shared/platform-adapter.port';

export type ProbeVerdict = 'healthy' | 'reauth' | 'transient';

export async function probeAccount(
  adapter: Pick<PlatformAdapter, 'fetchProfile'>,
  accessToken: string,
  canonicalId: string,
  metadata?: Record<string, unknown> | null,
): Promise<ProbeVerdict> {
  try {
    await adapter.fetchProfile(accessToken, canonicalId, metadata ?? undefined);
    return 'healthy';
  } catch (err) {
    if (err instanceof TokenRevokedError) return 'reauth';
    return 'transient';
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

```bash
npx jest -c jest.lite.config.cjs token-canary.util --no-coverage --maxWorkers=1
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add poc/src/modules/token-refresh/token-canary.util.ts poc/src/modules/token-refresh/__tests__/token-canary.util.spec.ts
git commit -m "feat(token-canary): probeAccount ground-truth classifier"
```

---

### Task 6: `token-canary` cron — selective liveness + self-heal

**Files:**
- Create: `poc/src/modules/token-refresh/token-canary.cron.service.ts`
- Modify: `poc/src/modules/token-refresh/token-refresh.module.ts` (register provider)
- Test: `poc/src/modules/token-refresh/__tests__/token-canary.cron.service.spec.ts`

**Interfaces:**
- Consumes: `@Inject(ADAPTER_REGISTRY) adapters: AdapterRegistry`, `probeAccount` (Task 5), `AesLocalService.decrypt`, `TokenLifecycleEmitter.{tokenRecovered, tokenExpired}`, `runWithLock`, `MetricsService`.
- Produces: a daily cron `token-canary` that self-heals `needs_reauth → ready` (+ `token.recovered`) and flags `ready → needs_reauth` (+ `token.expired`) based on the probe.

- [ ] **Step 1: Write the failing test**

Create `poc/src/modules/token-refresh/__tests__/token-canary.cron.service.spec.ts`:

```ts
import { TokenCanaryCronService } from '../token-canary.cron.service';

function build(accounts: any[], probe: (p: string) => Promise<unknown>) {
  const prisma = {
    account: {
      findMany: jest.fn().mockResolvedValue(accounts),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const aes = { decrypt: jest.fn(() => 'plain') };
  const metrics = { incr: jest.fn() };
  const redis = { client: {}, key: () => 'k' };
  const lifecycle = {
    tokenRecovered: jest.fn().mockResolvedValue(undefined),
    tokenExpired: jest.fn().mockResolvedValue(undefined),
  };
  const adapters = new Proxy({}, { get: () => ({ fetchProfile: probe }) });
  const svc = new TokenCanaryCronService(
    prisma as never, redis as never, aes as never,
    metrics as never, lifecycle as never, adapters as never,
  );
  return { svc, prisma, lifecycle };
}
const row = (o: any) => ({
  id: o.id, platform: 'facebook', canonicalUserId: 'c', status: o.status,
  metadata: {}, tokens: [{ accessTokenCiphertext: Buffer.from('x'), userAccessTokenCiphertext: null }],
});
const run = (s: TokenCanaryCronService) =>
  (s as unknown as { run: () => Promise<unknown> }).run();

describe('token-canary cron', () => {
  it('self-heals a needs_reauth account whose probe is healthy', async () => {
    const { svc, prisma, lifecycle } = build(
      [row({ id: 2n, status: 'needs_reauth' })], async () => ({ id: '1' }));
    await run(svc);
    expect(prisma.account.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 2n }, data: expect.objectContaining({ status: 'ready' }) }));
    expect(lifecycle.tokenRecovered).toHaveBeenCalledTimes(1);
    expect(lifecycle.tokenExpired).not.toHaveBeenCalled();
  });

  it('flags a quiet ready account whose probe reports reauth', async () => {
    const { TokenRevokedError } = require('@modules/platforms/shared/platform-adapter.port');
    const { svc, prisma, lifecycle } = build(
      [row({ id: 5n, status: 'ready' })],
      async () => { throw new TokenRevokedError('dead'); });
    await run(svc);
    expect(prisma.account.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 5n }, data: expect.objectContaining({ status: 'needs_reauth' }) }));
    expect(lifecycle.tokenExpired).toHaveBeenCalledTimes(1);
    expect(lifecycle.tokenRecovered).not.toHaveBeenCalled();
  });

  it('does nothing on a transient probe', async () => {
    const { svc, prisma, lifecycle } = build(
      [row({ id: 5n, status: 'ready' })], async () => { throw new Error('503'); });
    await run(svc);
    expect(prisma.account.update).not.toHaveBeenCalled();
    expect(lifecycle.tokenExpired).not.toHaveBeenCalled();
    expect(lifecycle.tokenRecovered).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx jest -c jest.lite.config.cjs token-canary.cron --no-coverage --maxWorkers=1
```

Expected: FAIL — cannot find `../token-canary.cron.service`.

- [ ] **Step 3: Implement the canary cron**

Create `poc/src/modules/token-refresh/token-canary.cron.service.ts`:

```ts
// Selective liveness canary + self-heal.
//
// The refresh cron keeps tokens authenticating; the health cron watches the
// data-access window. Neither tells us whether we can ACTUALLY read data for
// an account that isn't syncing — and needs_reauth accounts are excluded from
// every other sweep, so a false-positive flag is terminal. This cron closes
// both gaps with a single cheap real read (each adapter's fetchProfile):
//   - status='ready' but NOT exercised by a real sync in EXERCISED_WINDOW_MS
//     (quiet/paused) -> probe; a token-dead verdict flags needs_reauth.
//   - status='needs_reauth' -> probe; a healthy verdict self-heals to 'ready'.
// Active accounts are never probed here — their real syncs already classify
// token-dead errors in sync.worker.ts. Default-to-transient (probeAccount)
// guarantees a blip never bounces a healthy account.
import { Injectable, Logger, OnApplicationBootstrap, Inject } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ulid } from 'ulid';
import { PrismaService } from '@shared/database/prisma.service';
import { RedisService } from '@shared/redis/redis.service';
import { AesLocalService } from '@shared/crypto/aes-local.service';
import { runWithLock } from '@shared/redis/cron-lock';
import { MetricsService } from '@shared/metrics/metrics.service';
import { TokenLifecycleEmitter } from '@modules/outbound-webhooks/token-lifecycle-emitter.service';
import {
  ADAPTER_REGISTRY,
  AdapterRegistry,
} from '@modules/platforms/shared/platform-adapter.port';
import { probeAccount } from './token-canary.util';

const EXERCISED_WINDOW_MS = 36 * 60 * 60_000; // 36h: "recently exercised" by a real sync
const BATCH_SIZE = 500;
const LOCK_TTL_MS = 10 * 60_000;

interface CanaryResult {
  scanned: number;
  recovered: number;
  flagged: number;
  skipped: number;
}
const EMPTY: CanaryResult = { scanned: 0, recovered: 0, flagged: 0, skipped: 0 };

@Injectable()
export class TokenCanaryCronService implements OnApplicationBootstrap {
  private readonly logger = new Logger(TokenCanaryCronService.name);
  private readonly instanceToken = ulid();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly aes: AesLocalService,
    private readonly metrics: MetricsService,
    private readonly lifecycle: TokenLifecycleEmitter,
    @Inject(ADAPTER_REGISTRY) private readonly adapters: AdapterRegistry,
  ) {}

  onApplicationBootstrap(): void {
    if (process.argv[2] !== 'api') return;
    this.logger.log('Token-canary cron scheduled: daily at 06:10 UTC');
  }

  @Cron('10 6 * * *', { name: 'token-canary', timeZone: 'UTC' })
  async sweep(): Promise<CanaryResult> {
    if (process.argv[2] !== 'api') return EMPTY;
    const res = await runWithLock(
      this.redis.client,
      this.redis.key('cron', 'token-canary'),
      this.instanceToken,
      LOCK_TTL_MS,
      () => this.run(),
    );
    return res.ran ? res.result ?? EMPTY : EMPTY;
  }

  private async run(): Promise<CanaryResult> {
    const quietCutoff = new Date(Date.now() - EXERCISED_WINDOW_MS);
    const rows = await this.prisma.account.findMany({
      where: {
        OR: [
          // Quiet/paused: connected but no real sync attempt recently.
          { status: 'ready', syncJobs: { none: { lastAttemptAt: { gte: quietCutoff } } } },
          // Self-heal candidates: excluded from every other sweep.
          { status: 'needs_reauth' },
        ],
      },
      select: {
        id: true, platform: true, canonicalUserId: true, status: true, metadata: true,
        tokens: { select: { accessTokenCiphertext: true, userAccessTokenCiphertext: true } },
      },
      take: BATCH_SIZE,
    });

    const result: CanaryResult = { ...EMPTY, scanned: rows.length };
    for (const row of rows) {
      const adapter = this.adapters[row.platform];
      const token = row.tokens[0];
      if (!adapter || !token) { result.skipped += 1; continue; }

      const accessToken = token.userAccessTokenCiphertext
        ? this.aes.decrypt(Buffer.from(token.userAccessTokenCiphertext))
        : this.aes.decrypt(Buffer.from(token.accessTokenCiphertext));

      const verdict = await probeAccount(
        adapter, accessToken, row.canonicalUserId,
        row.metadata as Record<string, unknown> | null,
      );

      if (verdict === 'healthy') {
        if (row.status === 'needs_reauth') {
          await this.prisma.account.update({
            where: { id: row.id },
            data: { status: 'ready', lastProbedAt: new Date() },
          });
          await this.lifecycle.tokenRecovered(row.id, {
            reason: 'canary liveness probe succeeded',
          });
          result.recovered += 1;
          this.metrics.incr('token_canary_recovered', { platform: row.platform });
        } else {
          await this.prisma.account.update({
            where: { id: row.id }, data: { lastProbedAt: new Date() },
          });
          result.skipped += 1;
        }
      } else if (verdict === 'reauth') {
        if (row.status === 'ready') {
          await this.prisma.account.update({
            where: { id: row.id },
            data: { status: 'needs_reauth', lastProbedAt: new Date() },
          });
          await this.lifecycle.tokenExpired(row.id, {
            reason: 'canary liveness probe: token revoked/expired',
          });
          result.flagged += 1;
          this.metrics.incr('token_canary_flagged', { platform: row.platform });
        } else {
          result.skipped += 1;
        }
      } else {
        result.skipped += 1; // transient — retry next run, never flip
      }
    }

    if (result.scanned > 0) {
      this.logger.log(
        `Token-canary sweep: scanned=${result.scanned} recovered=${result.recovered} ` +
          `flagged=${result.flagged} skipped=${result.skipped}`,
      );
    }
    return result;
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

```bash
npx jest -c jest.lite.config.cjs token-canary.cron --no-coverage --maxWorkers=1
```

Expected: PASS (3 tests).

- [ ] **Step 5: Register the provider**

In `poc/src/modules/token-refresh/token-refresh.module.ts`, add `TokenCanaryCronService` to the `providers` array (next to `TokenHealthCronService`) and its import at the top:

```ts
import { TokenCanaryCronService } from './token-canary.cron.service';
```

- [ ] **Step 6: Type-check + commit**

```bash
npm run lint
git add poc/src/modules/token-refresh/token-canary.cron.service.ts poc/src/modules/token-refresh/token-refresh.module.ts poc/src/modules/token-refresh/__tests__/token-canary.cron.service.spec.ts
git commit -m "feat(token-canary): selective liveness probe + needs_reauth self-heal"
```

---

## Self-Review

**Spec coverage:**
- Extract-until-ROTA → soft flag never gates sync (Tasks 1,3,4); only `needs_reauth` gates (existing). ✔
- Earliest warning + delivery → Task 4 sets flag + Task 3 emits `token.reauth_required` through the real pipeline (Task 2 allowlist). ✔
- Instant hard detection → already in `sync.worker.ts:461-479` (noted); canary covers quiet accounts (Task 6). ✔
- Auto-recover false positives → Task 6 self-heal + `token.recovered`. ✔
- No ban risk → canary probes only non-exercised + `needs_reauth` accounts; active accounts get zero extra calls (Task 6 query). ✔
- IG-Direct blind spot → canary uses `fetchProfile` (works on `graph.instagram.com`), not `debug_token` (Tasks 5,6). ✔
- Webhook deliveries in both formats → native via `emit` (Tasks 2,3); HARD reuses existing `token.expired`→`SESSION.EXPIRED`; soft/recovered native-only (design decision). ✔

**Placeholder scan:** none — every step has concrete code/commands.

**Type consistency:** `probeAccount` verdict `'healthy'|'reauth'|'transient'` consistent across Tasks 5,6. `reauthRecommended(accountId, {dataAccessExpiresAt, reason})` / `tokenRecovered(accountId, {reason})` signatures identical in Tasks 3,4,6. `Account.reauthRecommendedAt/dataAccessExpiresAt/lastProbedAt` defined in Task 1, used in Tasks 4,6.

**Open item deferred to execution:** confirm `token-refresh.module.ts` already imports `OutboundWebhooksModule` (for `TokenLifecycleEmitter`) and that `ADAPTER_REGISTRY` is in scope there; if not, add the module import (Task 4 Step 5 / Task 6 Step 5).

## Verification (end-to-end, after implementation)

Run each new spec fast:
```bash
cd poc && for p in allowed-events token-lifecycle-emitter token-health.soft-signal token-canary.util token-canary.cron; do \
  npx jest -c jest.lite.config.cjs "$p" --no-coverage --maxWorkers=1 || break; done
npm run lint
```
Manual prod-shaped check (optional, mirrors this session's probes): point a staging account with a near data_access cliff, run the health cron `runNow()`, assert `token.reauth_required` lands in `GET /admin/token-health` + a `webhook_deliveries` row; flip a token dead on a paused account, run the canary, assert `needs_reauth` + `token.expired` delivery; restore it, re-run, assert `ready` + `token.recovered`.
