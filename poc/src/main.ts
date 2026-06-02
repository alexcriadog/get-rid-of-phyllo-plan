import 'reflect-metadata';
import * as http from 'node:http';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import * as express from 'express';
import { AppModule } from './app.module';

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
  mountRawBodyForWebhooks(app);
  const port = Number(process.env.API_PORT) || 3000;
  await app.listen(port);
  logger.log(`API listening on http://localhost:${port}`);
}

/**
 * Minimal liveness HTTP server for the headless (worker / scheduler)
 * processes (Week 3). They serve no app traffic, so an orchestrator had no
 * way to health-check them directly. This answers `GET /healthz` with 200 —
 * proof the process is up and its event loop is responsive — so the
 * docker-compose healthcheck (and any future k8s liveness probe) can restart
 * a hung container. Bound to HEALTH_PORT (default 3000, the port already
 * exposed on these containers).
 */
function startHealthServer(
  mode: 'worker' | 'scheduler',
  logger: Logger,
): http.Server {
  const port = Number(process.env.HEALTH_PORT) || 3000;
  const server = http.createServer((req, res) => {
    if (req.url === '/healthz' || req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          mode,
          uptime_s: Math.round(process.uptime()),
        }),
      );
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  server.on('error', (err) => {
    logger.error(`[${mode}] health server error: ${err.message}`);
  });
  server.listen(port, () => {
    logger.log(`[${mode}] health server listening on :${port}/healthz`);
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
  const healthServer = startHealthServer(mode, logger);
  logger.log(`[${mode}] bootstrapped; waiting for jobs…`);

  const shutdown = (signal: string): void => {
    logger.log(`[${mode}] received ${signal}, shutting down`);
    healthServer.close();
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
