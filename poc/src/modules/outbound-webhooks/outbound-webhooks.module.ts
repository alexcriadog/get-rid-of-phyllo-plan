import { Module } from '@nestjs/common';
import { SharedDatabaseModule } from '@shared/database/database.module';
import { SharedRedisModule } from '@shared/redis/redis.module';
import { ApiKeysModule } from '@modules/api-keys/api-keys.module';
import { RateLimitInterceptor } from '@/common/interceptors/rate-limit.interceptor';
import { OutboundWebhooksService } from './outbound-webhooks.service';
import { OutboundWebhooksController } from './outbound-webhooks.controller';
import { WebhookDeliveriesController } from './webhook-deliveries.controller';
import { RefreshController } from './refresh.controller';
import { TokenLifecycleEmitter } from './token-lifecycle-emitter.service';
import { DataEventDispatcher } from './data-event-dispatcher.service';
import { WebhooksDigestService } from './webhooks-digest.service';
import { StandardWebhookEmitter } from './standard-webhook-emitter.service';
import { RefreshCadenceService } from './refresh-cadence.service';
import { EngagementRefreshService } from './engagement-refresh.service';

@Module({
  imports: [SharedDatabaseModule, SharedRedisModule, ApiKeysModule],
  controllers: [
    OutboundWebhooksController,
    WebhookDeliveriesController,
    RefreshController,
  ],
  providers: [
    OutboundWebhooksService,
    TokenLifecycleEmitter,
    DataEventDispatcher,
    WebhooksDigestService,
    StandardWebhookEmitter,
    RefreshCadenceService,
    EngagementRefreshService,
    RateLimitInterceptor,
  ],
  exports: [
    OutboundWebhooksService,
    TokenLifecycleEmitter,
    DataEventDispatcher,
    StandardWebhookEmitter,
  ],
})
export class OutboundWebhooksModule {}
