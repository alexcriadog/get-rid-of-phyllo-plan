import { Module } from '@nestjs/common';
import { SharedDatabaseModule } from '@shared/database/database.module';
import { SharedRedisModule } from '@shared/redis/redis.module';
import { ApiKeysModule } from '@modules/api-keys/api-keys.module';
import { RateLimitInterceptor } from '@/common/interceptors/rate-limit.interceptor';
import { OutboundWebhooksService } from './outbound-webhooks.service';
import { OutboundWebhooksController } from './outbound-webhooks.controller';

@Module({
  imports: [SharedDatabaseModule, SharedRedisModule, ApiKeysModule],
  controllers: [OutboundWebhooksController],
  providers: [OutboundWebhooksService, RateLimitInterceptor],
  exports: [OutboundWebhooksService],
})
export class OutboundWebhooksModule {}
