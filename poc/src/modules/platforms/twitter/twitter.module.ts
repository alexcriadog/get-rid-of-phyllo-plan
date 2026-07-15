// X (Twitter) DI wiring — deliberately minimal.
//
// No API client, no fetchers, no token-refresh service: the adapter is a
// login-only snapshot reader (see twitter.adapter.ts). If X ever gets a
// paid-tier live integration, this module grows the same shape as
// twitch.module.ts (bound client + per-product fetchers).

import { Module } from '@nestjs/common';
import { TwitterAdapter } from './twitter.adapter';

@Module({
  providers: [TwitterAdapter],
  exports: [TwitterAdapter],
})
export class TwitterModule {}
