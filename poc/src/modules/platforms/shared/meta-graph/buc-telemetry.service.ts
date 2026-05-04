// Phase 1 of the Meta rate-limit mirror plan: passive observation only.
//
// Listens to every Graph response that carries X-App-Usage or
// X-Business-Use-Case-Usage and persists the latest known state per bucket
// in Redis. Does NOT gate any call yet — that's phases 2-3. The point of
// phase 1 is to get a real picture of how close we are to Meta's caps
// before we change the gating logic.
//
// State per bucket (Redis hash, TTL 25h):
//   { callCountPct, totalTimePct, totalCpuPct, retryAfterMs,
//     lastSeenAt, type, source }
//
// Bucket key conventions:
//   `app:{app_id}`              for X-App-Usage  (one per Meta App)
//   `asset:{id}`                for X-Business-Use-Case-Usage entries
//
// `app_id` is read from META_APP_ID at boot. The `id` for asset buckets is
// the top-level key Meta returns (business_id, IG account id, page id —
// they all live in the same flat map under x-business-use-case-usage).

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '@shared/redis/redis.service';

const STATE_TTL_SECONDS = 25 * 60 * 60;
// Phase 2 gating: deny when Meta is reporting a bucket above this threshold
// or when Meta has signalled estimated_time_to_regain_access. The user
// chose 75% as the SLO sweet spot — see chat history.
const GATE_THRESHOLD_PCT = 75;
const GATE_DEFAULT_BACKOFF_MS = 60_000;

interface AppUsage {
  call_count?: unknown;
  total_time?: unknown;
  total_cputime?: unknown;
}

interface BucEntry {
  type?: unknown;
  call_count?: unknown;
  total_time?: unknown;
  total_cputime?: unknown;
  estimated_time_to_regain_access?: unknown;
}

export interface BucketSnapshot {
  scopeKey: string;
  source: 'app' | 'buc';
  type: string;
  callCountPct: number;
  totalTimePct: number;
  totalCpuPct: number;
  retryAfterMs: number;
  lastSeenAt: number;
}

export interface GateDecision {
  allowed: boolean;
  retryAfterMs: number;
  blockedBy?: string;
}

@Injectable()
export class BucTelemetryService {
  private readonly logger = new Logger(BucTelemetryService.name);
  private readonly appId: string | undefined;

  constructor(
    private readonly redis: RedisService,
    config: ConfigService,
  ) {
    this.appId = config.get<string>('META_APP_ID');
  }

  /**
   * Observe a Graph response. Idempotent — safe to call from every
   * BoundGraphClient.call() and BoundThreadsClient.call() right after
   * `parseUsageHeaders` returns. Never throws (telemetry must not break
   * the data path).
   */
  async observe(headers: Record<string, unknown> | null): Promise<void> {
    if (!headers) return;
    try {
      const appUsage = headers['x-app-usage'] as AppUsage | undefined;
      if (appUsage && this.appId) {
        await this.writeState(`app:${this.appId}`, {
          source: 'app',
          type: 'app',
          callCountPct: pct(appUsage.call_count),
          totalTimePct: pct(appUsage.total_time),
          totalCpuPct: pct(appUsage.total_cputime),
          retryAfterMs: 0,
        });
      }
      const buc = headers['x-business-use-case-usage'] as
        | Record<string, BucEntry[]>
        | undefined;
      if (buc) {
        for (const [assetId, entries] of Object.entries(buc)) {
          if (!Array.isArray(entries) || entries.length === 0) continue;
          const worst = entries.reduce<{
            call: number;
            time: number;
            cpu: number;
            ttg: number;
            type: string;
          }>(
            (acc, e) => ({
              call: Math.max(acc.call, pct(e.call_count)),
              time: Math.max(acc.time, pct(e.total_time)),
              cpu: Math.max(acc.cpu, pct(e.total_cputime)),
              ttg: Math.max(
                acc.ttg,
                numericMinutes(e.estimated_time_to_regain_access),
              ),
              type: typeof e.type === 'string' ? e.type : acc.type,
            }),
            { call: 0, time: 0, cpu: 0, ttg: 0, type: 'unknown' },
          );
          await this.writeState(`asset:${assetId}`, {
            source: 'buc',
            type: worst.type,
            callCountPct: worst.call,
            totalTimePct: worst.time,
            totalCpuPct: worst.cpu,
            retryAfterMs: worst.ttg * 60_000,
          });
        }
      }
    } catch (err) {
      // Telemetry failures must never break the caller. Log and move on.
      this.logger.warn(
        `observe failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Lightweight lookup for a single bucket — used by the scheduler's
   * preflight check to peek at app-level pressure without acquiring
   * anything. Returns null if the bucket has no state (cold cache) or if
   * Redis is unreachable (fail-open: caller treats absence as "fine").
   */
  async getBucketPct(scopeKey: string): Promise<{
    callCountPct: number;
    retryAfterMs: number;
    lastSeenAt: number;
  } | null> {
    try {
      const raw = await this.redis.client.hgetall(
        this.redis.key('rate', 'meta', scopeKey),
      );
      if (!raw || Object.keys(raw).length === 0) return null;
      return {
        callCountPct: numeric(raw.callCountPct),
        retryAfterMs: numeric(raw.retryAfterMs),
        lastSeenAt: numeric(raw.lastSeenAt),
      };
    } catch (err) {
      this.logger.warn(
        `getBucketPct failed for ${scopeKey}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  /**
   * Phase 3: returns the app-level bucket key (`app:{META_APP_ID}`) for
   * callers that want to include it in checkGate. Null when META_APP_ID
   * isn't configured (e.g. dev without a Meta app).
   *
   * The app-level cap (`200 × users/h` per Meta docs) is global to the
   * Meta App, so every Meta-family call should include this key in the
   * gate check on top of its per-asset bucKeys.
   */
  appKey(): string | null {
    return this.appId ? `app:${this.appId}` : null;
  }

  /**
   * Read all known bucket snapshots, sorted by callCountPct descending.
   * Used by the admin endpoint to render the picture. Caps at `limit`
   * results to keep the endpoint fast even with thousands of assets.
   */
  async snapshot(limit = 50): Promise<BucketSnapshot[]> {
    const pattern = this.redis.key('rate', 'meta', '*');
    const keys: string[] = [];
    let cursor = '0';
    do {
      const [next, batch] = await this.redis.client.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        500,
      );
      keys.push(...batch);
      cursor = next;
    } while (cursor !== '0');

    const out: BucketSnapshot[] = [];
    for (const fullKey of keys) {
      const raw = await this.redis.client.hgetall(fullKey);
      if (!raw || Object.keys(raw).length === 0) continue;
      const scopeKey = fullKey.split(':').slice(2).join(':');
      out.push({
        scopeKey,
        source: (raw.source as 'app' | 'buc') ?? 'buc',
        type: raw.type ?? 'unknown',
        callCountPct: numeric(raw.callCountPct),
        totalTimePct: numeric(raw.totalTimePct),
        totalCpuPct: numeric(raw.totalCpuPct),
        retryAfterMs: numeric(raw.retryAfterMs),
        lastSeenAt: numeric(raw.lastSeenAt),
      });
    }
    out.sort((a, b) => b.callCountPct - a.callCountPct);
    return out.slice(0, limit);
  }

  /**
   * Phase 2 gate. Decide whether a call may proceed based on the latest
   * BUC state Meta reported. Returns:
   *   - allowed=false + retryAfterMs > 0 if any bucket is throttled or above
   *     the threshold;
   *   - allowed=true (optimistic) if a bucket has no recorded state yet, or
   *     if Redis itself is unreachable (fail-open).
   *
   * Threshold: GATE_THRESHOLD_PCT (75%). When a bucket has Meta-supplied
   * `estimated_time_to_regain_access` we honour that exact remaining time;
   * otherwise we use GATE_DEFAULT_BACKOFF_MS (60s).
   */
  async checkGate(bucketKeys: string[]): Promise<GateDecision> {
    if (bucketKeys.length === 0) return { allowed: true, retryAfterMs: 0 };
    const now = Date.now();
    for (const key of bucketKeys) {
      let raw: Record<string, string> | null;
      try {
        raw = await this.redis.client.hgetall(this.redis.key('rate', 'meta', key));
      } catch (err) {
        // Fail-open: if Redis itself is unreachable, prefer letting calls
        // through. The legacy RateBucketService still gates via its own
        // path, and Meta will reject with a real 429 if we overshoot.
        this.logger.warn(
          `checkGate redis read failed for ${key}: ${err instanceof Error ? err.message : String(err)}`,
        );
        return { allowed: true, retryAfterMs: 0 };
      }
      if (!raw || Object.keys(raw).length === 0) continue; // unknown → optimistic
      const callPct = numeric(raw.callCountPct);
      const ttgMs = numeric(raw.retryAfterMs);
      const lastSeenAt = numeric(raw.lastSeenAt);
      const ttgRemaining = ttgMs > 0 ? Math.max(0, ttgMs - (now - lastSeenAt)) : 0;
      if (ttgRemaining > 0) {
        return { allowed: false, retryAfterMs: ttgRemaining, blockedBy: key };
      }
      if (callPct >= GATE_THRESHOLD_PCT) {
        return {
          allowed: false,
          retryAfterMs: GATE_DEFAULT_BACKOFF_MS,
          blockedBy: key,
        };
      }
    }
    return { allowed: true, retryAfterMs: 0 };
  }

  private async writeState(
    scopeKey: string,
    fields: {
      source: 'app' | 'buc';
      type: string;
      callCountPct: number;
      totalTimePct: number;
      totalCpuPct: number;
      retryAfterMs: number;
    },
  ): Promise<void> {
    const fullKey = this.redis.key('rate', 'meta', scopeKey);
    await this.redis.client
      .multi()
      .hset(fullKey, {
        source: fields.source,
        type: fields.type,
        callCountPct: fields.callCountPct.toString(),
        totalTimePct: fields.totalTimePct.toString(),
        totalCpuPct: fields.totalCpuPct.toString(),
        retryAfterMs: fields.retryAfterMs.toString(),
        lastSeenAt: Date.now().toString(),
      })
      .expire(fullKey, STATE_TTL_SECONDS)
      .exec();
  }
}

function pct(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return n;
}

function numeric(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function numericMinutes(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
