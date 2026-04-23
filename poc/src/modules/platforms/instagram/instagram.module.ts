import { Module } from '@nestjs/common';
import { InstagramAdapter } from './instagram.adapter';

/**
 * All shared deps (Mongo, Redis, Metrics, Prisma, Config) come from the
 * Global() shared modules registered in AppModule — we only need to provide
 * the adapter itself here.
 */
@Module({
  providers: [InstagramAdapter],
  exports: [InstagramAdapter],
})
export class InstagramModule {}
