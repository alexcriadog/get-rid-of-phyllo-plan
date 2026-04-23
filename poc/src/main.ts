import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';

type Mode = 'api' | 'worker' | 'scheduler';

const VALID_MODES: ReadonlyArray<Mode> = ['api', 'worker', 'scheduler'];

async function bootstrapApi(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const port = Number(process.env.API_PORT) || 3000;
  await app.listen(port);
  logger.log(`API listening on http://localhost:${port}`);
}

function notImplemented(mode: 'worker' | 'scheduler'): void {
  const logger = new Logger('Bootstrap');
  const day = mode === 'worker' ? 'Day 2' : 'Day 3';
  logger.log(`[${mode}] not implemented yet, ${day}`);
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

  notImplemented(mode);
  process.exit(0);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[bootstrap] fatal error:', err);
  process.exit(1);
});
