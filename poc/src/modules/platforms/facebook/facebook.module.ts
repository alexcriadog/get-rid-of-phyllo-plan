import { Module } from '@nestjs/common';
import { FacebookAdapter } from './facebook.adapter';

/**
 * All shared deps (Mongo, Redis, Metrics, Prisma, Config) come from the
 * Global() shared modules registered in AppModule — we only need to provide
 * the adapter itself here. Mirrors the Instagram module structure.
 */
@Module({
  providers: [FacebookAdapter],
  exports: [FacebookAdapter],
})
export class FacebookModule {}
