// Connector-specific Prometheus gauges (Week 3 observability).
//
// These are global counts (not per-process resource metrics), so they're
// registered ONLY on the api process — registering them on worker + scheduler
// too would triple the DB/Redis queries per scrape and emit duplicate series.
// Each gauge uses a scrape-time collect() callback so the value is always
// current without a background poller; callbacks fail soft (keep last value)
// so a DB blip never breaks the whole /metrics scrape.

import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Gauge } from 'prom-client';
import { PrismaService } from '@shared/database/prisma.service';
import { BullmqService } from '@shared/redis/bullmq.service';
import { register } from './prometheus';

const TOKEN_EXPIRY_WINDOW_MS = 24 * 60 * 60_000;

@Injectable()
export class PrometheusCollectorsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PrometheusCollectorsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bullmq: BullmqService,
  ) {}

  onApplicationBootstrap(): void {
    if (process.argv[2] !== 'api') {
      // Global-count gauges live on the api process only.
      return;
    }
    const prisma = this.prisma;
    const bullmq = this.bullmq;

    // Accounts that have fallen out of sync because their token died and the
    // end user must re-authorise. A rising count is the "tokens expiring en
    // masse" signal — alertable in the obs stack.
    new Gauge({
      name: 'connector_accounts_needs_reauth',
      help: 'Accounts currently in status=needs_reauth (require OAuth re-consent)',
      registers: [register],
      async collect() {
        try {
          this.set(await prisma.account.count({ where: { status: 'needs_reauth' } }));
        } catch {
          /* keep last value on a transient DB error */
        }
      },
    });

    // Tokens that will expire within 24h on still-connected accounts — leading
    // indicator before they flip to needs_reauth.
    new Gauge({
      name: 'connector_tokens_expiring_24h',
      help: 'OAuth tokens on ready accounts expiring within the next 24 hours',
      registers: [register],
      async collect() {
        try {
          const horizon = new Date(Date.now() + TOKEN_EXPIRY_WINDOW_MS);
          this.set(
            await prisma.oAuthToken.count({
              where: {
                expiresAt: { not: null, lte: horizon },
                account: { is: { status: 'ready' } },
              },
            }),
          );
        } catch {
          /* keep last value */
        }
      },
    });

    // BullMQ sync-queue backlog. A sustained climb means the worker fleet is
    // behind (alert on queue depth).
    new Gauge({
      name: 'connector_sync_queue_waiting',
      help: 'Jobs waiting in the BullMQ sync queue',
      registers: [register],
      async collect() {
        try {
          const queue = bullmq.getQueue('sync');
          this.set(await queue.getWaitingCount());
        } catch {
          /* keep last value */
        }
      },
    });

    this.logger.log('Prometheus connector gauges registered (api process)');
  }
}
