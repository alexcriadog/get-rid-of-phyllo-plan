import 'reflect-metadata';
import * as http from 'node:http';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import * as express from 'express';
import { AppModule } from './app.module';
import {
  httpRequestDuration,
  initDefaultMetrics,
  normalizeRoute,
  register,
} from './shared/metrics/prometheus';

/**
 * Internal ops port (Week 3): every process serves /healthz + /metrics here.
 * NOT published to the host and NOT routed by Caddy, so /metrics stays private
 * — a metrics agent on the box scrapes it over the docker/private network.
 */
const OPS_PORT = Number(process.env.METRICS_PORT) || 9464;

type Mode = 'api' | 'worker' | 'scheduler';

const VALID_MODES: ReadonlyArray<Mode> = ['api', 'worker', 'scheduler'];

const WEBHOOK_RAW_PATH = /^\/webhooks\/ingest\//;

/**
 * Raw-body middleware used ONLY for `/webhooks/ingest/*`. The JSON parser
 * replaces `req.body` with a parsed object, which makes HMAC signature
 * verification impossible (Meta signs the original bytes). Mounting
 * `express.raw` before the global JSON parser preserves the Buffer.
 */
function mountRawBodyForWebhooks(app: NestExpressApplication): void {
  const raw = express.raw({ type: '*/*', limit: '1mb' });
  app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (WEBHOOK_RAW_PATH.test(req.path)) {
      raw(req, res, next);
    } else {
      next();
    }
  });
}

/**
 * Record every HTTP request into the prom-client histogram (Week 3). The
 * route label is normalised (ids → :id) to bound cardinality. Mounted before
 * routing; the timer stops on response 'finish'.
 */
function mountHttpMetrics(app: NestExpressApplication): void {
  app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
    const stop = httpRequestDuration.startTimer();
    res.on('finish', () => {
      const route = normalizeRoute(req.originalUrl || req.url || req.path);
      stop({
        method: req.method,
        route,
        status_code: String(res.statusCode),
      });
    });
    next();
  });
}

async function bootstrapApi(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: false,
  });
  app.enableShutdownHooks();
  // Allow the Next.js UI on :3001 (dev) to call the admin + public endpoints.
  // For PoC we accept any localhost origin.
  app.enableCors({
    origin: (origin, cb) => cb(null, !origin || /localhost:\d+$/.test(origin)),
    credentials: true,
  });
  mountHttpMetrics(app);
  mountRawBodyForWebhooks(app);
  const port = Number(process.env.API_PORT) || 3000;
  await app.listen(port);
  logger.log(`API listening on http://localhost:${port}`);
  // Internal ops server (/healthz + /metrics) on the private OPS_PORT.
  startOpsServer('api', logger);
}

/**
 * Internal ops HTTP server (Week 3) — runs in EVERY process (api / worker /
 * scheduler) on OPS_PORT. Serves:
 *   - GET /healthz → 200 liveness (so an orchestrator can health-check the
 *     otherwise-headless worker/scheduler and restart a hung container)
 *   - GET /metrics → Prometheus exposition (default Node metrics on every
 *     process; HTTP histogram on the api; connector gauges on the api)
 * Bound to a private port that Caddy never routes, so /metrics isn't public.
 */
function startOpsServer(mode: Mode, logger: Logger): http.Server {
  const server = http.createServer((req, res) => {
    const url = req.url ?? '';
    if (url === '/healthz' || url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          mode,
          uptime_s: Math.round(process.uptime()),
        }),
      );
      return;
    }
    if (url === '/metrics') {
      register
        .metrics()
        .then((body) => {
          res.writeHead(200, { 'content-type': register.contentType });
          res.end(body);
        })
        .catch((err) => {
          logger.error(`[${mode}] /metrics error: ${err instanceof Error ? err.message : String(err)}`);
          res.writeHead(500);
          res.end();
        });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.on('error', (err) => {
    logger.error(`[${mode}] ops server error: ${err.message}`);
  });
  server.listen(OPS_PORT, () => {
    logger.log(`[${mode}] ops server listening on :${OPS_PORT} (/healthz, /metrics)`);
  });
  return server;
}

/**
 * Worker + scheduler processes don't serve HTTP traffic — they only need
 * the DI container alive so their `onApplicationBootstrap` hooks fire.
 * `createApplicationContext` is the exact Nest primitive for this. We do run
 * a tiny liveness server (see startHealthServer) purely for health probes.
 */
async function bootstrapHeadless(mode: 'worker' | 'scheduler'): Promise<void> {
  const logger = new Logger('Bootstrap');
  const ctx = await NestFactory.createApplicationContext(AppModule, {
    bufferLogs: false,
  });
  ctx.enableShutdownHooks();
  const opsServer = startOpsServer(mode, logger);
  logger.log(`[${mode}] bootstrapped; waiting for jobs…`);

  const shutdown = (signal: string): void => {
    logger.log(`[${mode}] received ${signal}, shutting down`);
    opsServer.close();
    ctx
      .close()
      .catch((err) => {
        logger.error(
          `[${mode}] shutdown error: ${err instanceof Error ? err.message : String(err)}`,
        );
      })
      .finally(() => process.exit(0));
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

async function main(): Promise<void> {
  const logger = new Logger('Bootstrap');
  // Register default Node/process metrics on every process before bootstrap.
  initDefaultMetrics();
  const arg = process.argv[2];

  if (!arg || !VALID_MODES.includes(arg as Mode)) {
    logger.error(
      `Usage: ts-node src/main.ts <${VALID_MODES.join('|')}> (received: ${arg ?? 'nothing'})`,
    );
    process.exit(1);
  }

  const mode = arg as Mode;

  if (mode === 'api') {
    await bootstrapApi();
    return;
  }

  await bootstrapHeadless(mode);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[bootstrap] fatal error:', err);
  process.exit(1);
});
