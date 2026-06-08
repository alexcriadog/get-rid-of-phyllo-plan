import { Module } from '@nestjs/common';
import { SharedDatabaseModule } from '@shared/database/database.module';
import { SharedRedisModule } from '@shared/redis/redis.module';
import { ApiKeysModule } from '@modules/api-keys/api-keys.module';
import { RateLimitInterceptor } from '@/common/interceptors/rate-limit.interceptor';
import { OutboundWebhooksService } from './outbound-webhooks.service';
import { OutboundWebhooksController } from './outbound-webhooks.controller';
import { WebhookDeliveriesController } from './webhook-deliveries.controller';
import { TokenLifecycleEmitter } from './token-lifecycle-emitter.service';
import { DataEventDispatcher } from './data-event-dispatcher.service';
import { WebhooksDigestService } from './webhooks-digest.service';
import { PhylloWebhookEmitter } from './phyllo-webhook-emitter.service';

@Module({
  imports: [SharedDatabaseModule, SharedRedisModule, ApiKeysModule],
  controllers: [OutboundWebhooksController, WebhookDeliveriesController],
  providers: [
    OutboundWebhooksService,
    TokenLifecycleEmitter,
    DataEventDispatcher,
    WebhooksDigestService,
    PhylloWebhookEmitter,
    RateLimitInterceptor,
  ],
  exports: [
    OutboundWebhooksService,
    TokenLifecycleEmitter,
    DataEventDispatcher,
    PhylloWebhookEmitter,
  ],
})
export class OutboundWebhooksModule {}
