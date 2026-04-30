import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@shared/database/prisma.service';

/**
 * Tier → cadence multiplier. A VIP account polls twice as often as standard;
 * a `lite` account halves its polling frequency; `demo` accounts barely poll.
 * `paused` shortcircuits the resolver — no job should be scheduled.
 */
const TIER_MULTIPLIERS: Readonly<Record<string, number>> = {
  vip: 0.5,
  standard: 1,
  lite: 2,
  demo: 5,
};

const MIN_INTERVAL_SECONDS = 60;
const MAX_INTERVAL_SECONDS = 7 * 24 * 60 * 60; // 7 days
const DEFAULT_FALLBACK_SECONDS = 24 * 60 * 60; // 24h — used if no cadences row exists

/**
 * ±10% jitter applied to every scheduled interval so that accounts whose
 * `nextRunAt` would otherwise land at the same wall-clock second (e.g.
 * after a long downtime where every catch-up gets `now + cadence`) fan out
 * uniformly. Reduces thundering-herd pressure on the rate bucket and
 * downstream APIs without distorting the long-run sync rate (mean of the
 * jitter is 0).
 */
const JITTER_FRACTION = 0.1;

function clampInterval(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return MIN_INTERVAL_SECONDS;
  }
  if (seconds < MIN_INTERVAL_SECONDS) return MIN_INTERVAL_SECONDS;
  if (seconds > MAX_INTERVAL_SECONDS) return MAX_INTERVAL_SECONDS;
  return Math.round(seconds);
}

/** Returns `seconds` scaled by a uniform random factor in [1 - f, 1 + f]. */
function applyJitter(seconds: number, fraction: number = JITTER_FRACTION): number {
  const factor = 1 + (Math.random() * 2 - 1) * fraction;
  return seconds * factor;
}

@Injectable()
export class CadenceService {
  private readonly logger = new Logger(CadenceService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolves the effective next_run_at for a given account × product.
   *
   * Precedence:
   *   1. Non-expired per-account override from `account_cadences`
   *   2. `cadences.default_interval_seconds` × tier multiplier (clamped)
   *   3. Fallback 24h × tier multiplier (clamped)
   *
   * Returns null when the account is paused — caller should not schedule.
   */
  async resolveNextRunAt(
    accountId: bigint,
    product: string,
    now: Date = new Date(),
  ): Promise<Date | null> {
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: { platform: true, syncTier: true },
    });

    if (!account) {
      this.logger.warn(`resolveNextRunAt: account ${accountId.toString()} not found`);
      return null;
    }

    if (account.syncTier === 'paused') {
      return null;
    }

    const override = await this.prisma.accountCadenceOverride.findUnique({
      where: { accountId_product: { accountId, product } },
    });

    if (override && (!override.expiresAt || override.expiresAt > now)) {
      const jittered = clampInterval(applyJitter(override.overrideIntervalSeconds));
      return new Date(now.getTime() + jittered * 1000);
    }

    const defaultRow = await this.prisma.cadence.findUnique({
      where: { platform_product: { platform: account.platform, product } },
    });

    const baseSeconds = defaultRow?.defaultIntervalSeconds ?? DEFAULT_FALLBACK_SECONDS;
    const multiplier = TIER_MULTIPLIERS[account.syncTier] ?? 1;
    const effective = clampInterval(applyJitter(baseSeconds * multiplier));

    return new Date(now.getTime() + effective * 1000);
  }

  /**
   * Rough projection of calls/hour per platform given the current set of
   * non-paused accounts, cadences, and tier multipliers. Used by the admin
   * cadence-simulator card.
   *
   * Formula: for each (platform, product) pair, sum `3600 / effective_interval`
   * across matching non-paused accounts. Honours non-expired overrides.
   */
  async projectHourlyCallsPerPlatform(): Promise<Record<string, number>> {
    const now = new Date();

    const [cadences, accounts, overrides] = await Promise.all([
      this.prisma.cadence.findMany(),
      this.prisma.account.findMany({
        where: { syncTier: { not: 'paused' }, disconnectedAt: null },
        select: { id: true, platform: true, syncTier: true },
      }),
      this.prisma.accountCadenceOverride.findMany({
        where: {
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        select: {
          accountId: true,
          product: true,
          overrideIntervalSeconds: true,
        },
      }),
    ]);

    const cadenceMap = new Map<string, number>();
    const productsByPlatform = new Map<string, Set<string>>();
    for (const c of cadences) {
      cadenceMap.set(`${c.platform}:${c.product}`, c.defaultIntervalSeconds);
      if (!productsByPlatform.has(c.platform)) {
        productsByPlatform.set(c.platform, new Set());
      }
      productsByPlatform.get(c.platform)!.add(c.product);
    }

    const overrideMap = new Map<string, number>();
    for (const o of overrides) {
      overrideMap.set(`${o.accountId.toString()}:${o.product}`, o.overrideIntervalSeconds);
    }

    const result: Record<string, number> = {};

    for (const account of accounts) {
      const products = productsByPlatform.get(account.platform);
      if (!products) continue;

      const multiplier = TIER_MULTIPLIERS[account.syncTier] ?? 1;
      let callsPerHour = 0;

      for (const product of products) {
        const overrideSeconds = overrideMap.get(`${account.id.toString()}:${product}`);
        const effectiveSeconds = overrideSeconds
          ? clampInterval(overrideSeconds)
          : clampInterval((cadenceMap.get(`${account.platform}:${product}`) ?? DEFAULT_FALLBACK_SECONDS) * multiplier);
        callsPerHour += 3600 / effectiveSeconds;
      }

      result[account.platform] = (result[account.platform] ?? 0) + callsPerHour;
    }

    for (const k of Object.keys(result)) {
      result[k] = Math.round(result[k] * 100) / 100;
    }

    return result;
  }
}
