import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

// Connection-pool sizing (Week 3). Prisma's default pool is num_cpus*2+1 PER
// PROCESS, so api + scheduler + N workers can silently exhaust MySQL's
// max_connections (~151) once you scale workers. Pin an explicit, modest limit
// — 3 processes × 10 = 30, leaving generous headroom — and fail fast (rather
// than hang) when the pool is saturated. Both overridable via env.
const DEFAULT_CONNECTION_LIMIT = 10;
const DEFAULT_POOL_TIMEOUT_S = 20;

/**
 * Append connection_limit + pool_timeout to DATABASE_URL when not already
 * present, so the pool is bounded regardless of CPU count. Returns undefined
 * when DATABASE_URL is unset (tests) so PrismaClient falls back to the schema
 * datasource. A malformed URL is passed through untouched for Prisma to report.
 */
function buildDatasourceUrl(): string | undefined {
  const raw = process.env.DATABASE_URL;
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (!url.searchParams.has('connection_limit')) {
      const limit =
        Number(process.env.PRISMA_CONNECTION_LIMIT) || DEFAULT_CONNECTION_LIMIT;
      url.searchParams.set('connection_limit', String(limit));
    }
    if (!url.searchParams.has('pool_timeout')) {
      url.searchParams.set('pool_timeout', String(DEFAULT_POOL_TIMEOUT_S));
    }
    return url.toString();
  } catch {
    return raw;
  }
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const datasourceUrl = buildDatasourceUrl();
    super(datasourceUrl ? { datasourceUrl } : {});
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Prisma connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('Prisma disconnected');
  }
}
