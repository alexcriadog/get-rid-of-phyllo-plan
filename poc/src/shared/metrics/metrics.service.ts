import { AsyncLocalStorage } from 'node:async_hooks';
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '@shared/database/prisma.service';
import { RateBucketService, BucketState } from '@shared/redis/rate-bucket.service';

export interface ApiCallObservation {
  platform: string;
  endpoint: string;
  method: string;
  status: number;
  durationMs: number;
  bucketBefore: number | null;
  bucketAfter: number | null;
  usageHeader: Record<string, unknown> | null;
  accountId: bigint | null;
  rateBucketKey: string | null;
  product?: string | null;
  /**
   * Marks calls whose non-2xx is a documented "no data" outcome (e.g.
   * Meta IG privacy threshold). Excluded from dashboard error counts;
   * still visible in raw logs.
   */
  expected?: boolean;
}

export interface ApiCallRecord extends ApiCallObservation {
  timestamp: number;
}

interface ProductContextStore {
  product: string;
}

export interface BucketHistoryEntry {
  timestamp: number;
  tokens: number;
  hits: number;
  denies: number;
}

interface CounterEntry {
  labels: Record<string, string>;
  value: number;
}

const MAX_API_CALLS = 500;
const BUCKET_SNAPSHOT_INTERVAL_MS = 10_000;
const BUCKET_HISTORY_MINS = 60;
const BUCKET_HISTORY_CAPACITY =
  (BUCKET_HISTORY_MINS * 60_000) / BUCKET_SNAPSHOT_INTERVAL_MS;

@Injectable()
export class MetricsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MetricsService.name);
  private readonly counters = new Map<string, CounterEntry[]>();
  private readonly apiCalls: ApiCallRecord[] = [];
  private readonly bucketHistory = new Map<string, BucketHistoryEntry[]>();
  private readonly productAls = new AsyncLocalStorage<ProductContextStore>();
  private snapshotTimer: NodeJS.Timeout | null = null;

  /**
   * Run `fn` inside an AsyncLocalStorage context that tags every
   * `observeApiCall` invocation with the given product. Used by the sync
   * worker to attribute API calls to the product (`identity`/`audience`/
   * `engagement_new`/`stories`) that triggered them. The product flows
   * through async boundaries (axios, prisma) without polluting adapter
   * signatures.
   */
  runWithProduct<T>(product: string, fn: () => Promise<T>): Promise<T> {
    return this.productAls.run({ product }, fn);
  }

  /** Returns the product currently in scope (set by `runWithProduct`), or null. */
  currentProduct(): string | null {
    return this.productAls.getStore()?.product ?? null;
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly rateBucket: RateBucketService,
  ) {}

  onModuleInit(): void {
    this.snapshotTimer = setInterval(() => {
      this.tickSnapshot().catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`bucket snapshot tick failed: ${msg}`);
      });
    }, BUCKET_SNAPSHOT_INTERVAL_MS);

    if (this.snapshotTimer.unref) {
      this.snapshotTimer.unref();
    }
    this.logger.log(
      `Metrics started (snapshot every ${BUCKET_SNAPSHOT_INTERVAL_MS}ms, history ${BUCKET_HISTORY_MINS}m)`,
    );
  }

  onModuleDestroy(): void {
    if (this.snapshotTimer) {
      clearInterval(this.snapshotTimer);
      this.snapshotTimer = null;
    }
  }

  incr(name: string, labels: Record<string, string> = {}, by: number = 1): void {
    const entries = this.counters.get(name) ?? [];
    const existing = entries.find((e) => this.labelsEqual(e.labels, labels));
    if (existing) {
      existing.value += by;
    } else {
      entries.push({ labels: { ...labels }, value: by });
    }
    this.counters.set(name, entries);
  }

  /**
   * Record an API call. Appends to the in-memory ring buffer for admin
   * tailing and fires-and-forgets a durable write to `api_call_log` in
   * MySQL. The durable write is intentionally not awaited — logging must
   * never block the hot fetch path.
   */
  observeApiCall(obs: ApiCallObservation): void {
    const product = obs.product ?? this.currentProduct();
    const record: ApiCallRecord = { ...obs, product, timestamp: Date.now() };
    this.apiCalls.push(record);
    if (this.apiCalls.length > MAX_API_CALLS) {
      this.apiCalls.splice(0, this.apiCalls.length - MAX_API_CALLS);
    }

    this.incr('api_call_total', {
      platform: obs.platform,
      endpoint: obs.endpoint,
      status_class: this.statusClass(obs.status),
      product: product ?? 'unknown',
    });

    void this.persistApiCall(record).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`api_call_log write failed: ${msg}`);
    });
  }

  /**
   * Snapshot a list of bucket states into the per-bucket ring buffer. Called
   * internally every 10s; also exposed so tests can drive it deterministically.
   */
  snapshotBuckets(states: ReadonlyArray<BucketState>): void {
    const now = Date.now();
    for (const s of states) {
      const buf = this.bucketHistory.get(s.bucketKey) ?? [];
      buf.push({
        timestamp: now,
        tokens: s.tokens,
        hits: s.hits,
        denies: s.denies,
      });
      if (buf.length > BUCKET_HISTORY_CAPACITY) {
        buf.splice(0, buf.length - BUCKET_HISTORY_CAPACITY);
      }
      this.bucketHistory.set(s.bucketKey, buf);
    }
  }

  getCounter(name: string, labels?: Record<string, string>): number {
    const entries = this.counters.get(name) ?? [];
    if (!labels) {
      return entries.reduce((sum, e) => sum + e.value, 0);
    }
    const match = entries.find((e) => this.labelsEqual(e.labels, labels));
    return match?.value ?? 0;
  }

  listCounters(
    name: string,
  ): ReadonlyArray<{ labels: Record<string, string>; value: number }> {
    return this.counters.get(name) ?? [];
  }

  getBucketHistory(key: string, mins: number): BucketHistoryEntry[] {
    const buf = this.bucketHistory.get(key) ?? [];
    const cutoff = Date.now() - mins * 60_000;
    return buf.filter((e) => e.timestamp >= cutoff);
  }

  getRecentCalls(
    filter?: Partial<Pick<ApiCallRecord, 'platform' | 'accountId'>> & {
      statusClass?: string;
    },
    limit: number = 100,
  ): ApiCallRecord[] {
    let pool = this.apiCalls;
    if (filter?.platform) {
      pool = pool.filter((c) => c.platform === filter.platform);
    }
    if (filter?.accountId !== undefined) {
      pool = pool.filter((c) => c.accountId === filter.accountId);
    }
    if (filter?.statusClass) {
      pool = pool.filter((c) => this.statusClass(c.status) === filter.statusClass);
    }
    return pool.slice(-limit).reverse();
  }

  private async tickSnapshot(): Promise<void> {
    const states = await this.rateBucket.listAllBuckets();
    this.snapshotBuckets(states);
  }

  private async persistApiCall(record: ApiCallRecord): Promise<void> {
    await this.prisma.apiCallLog.create({
      data: {
        platform: record.platform,
        endpoint: record.endpoint,
        method: record.method,
        statusCode: record.status,
        durationMs: record.durationMs,
        rateBucketKey: record.rateBucketKey,
        tokensBefore:
          record.bucketBefore !== null ? Math.round(record.bucketBefore) : null,
        tokensAfter:
          record.bucketAfter !== null ? Math.round(record.bucketAfter) : null,
        usageHeader: (record.usageHeader ?? undefined) as
          | import('@prisma/client').Prisma.InputJsonValue
          | undefined,
        accountId: record.accountId,
        product: record.product ?? null,
        expected: record.expected ?? false,
      },
    });
  }

  private statusClass(status: number): string {
    if (status >= 500) return '5xx';
    if (status >= 400) return '4xx';
    if (status >= 300) return '3xx';
    if (status >= 200) return '2xx';
    return 'other';
  }

  private labelsEqual(
    a: Record<string, string>,
    b: Record<string, string>,
  ): boolean {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    for (const k of keysA) {
      if (a[k] !== b[k]) return false;
    }
    return true;
  }
}
