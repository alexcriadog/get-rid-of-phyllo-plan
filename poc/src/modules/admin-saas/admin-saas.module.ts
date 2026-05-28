import { Module } from '@nestjs/common';
import { SharedDatabaseModule } from '@shared/database/database.module';
import { SharedRedisModule } from '@shared/redis/redis.module';
import { WorkspacesModule } from '@modules/workspaces/workspaces.module';
import { ApiKeysModule } from '@modules/api-keys/api-keys.module';
import { OutboundWebhooksModule } from '@modules/outbound-webhooks/outbound-webhooks.module';
import { AccountsModule } from '@modules/accounts/accounts.module';
import { ConnectToolGuard } from '@modules/admin/connect-tool.guard';
import { RateLimitInterceptor } from '@/common/interceptors/rate-limit.interceptor';
import { AdminSaasController } from './admin-saas.controller';

/**
 * SaaS-tenant operator surface. Distinct from the existing AdminModule
 * (which owns sync-job / cadence / rate-bucket operations on the legacy
 * single-tenant connector) so the two can evolve independently.
 *
 * Read endpoints (list, get, usage, webhook deliveries) are reachable from
 * inside the cluster without auth — the operational model is "the /admin/*
 * URL space is operator-trust; add Caddy Basic Auth at the ingress when
 * stricter control is needed." Mutations + sensitive reads (workspace
 * create, branding/products patch, API key issue/revoke/list-all,
 * access-token decrypt) carry @UseGuards(ConnectToolGuard) so they require
 * the shared bearer from any caller outside loopback.
 */
@Module({
  imports: [
    SharedDatabaseModule,
    SharedRedisModule,
    WorkspacesModule,
    ApiKeysModule,
    OutboundWebhooksModule,
    AccountsModule,
  ],
  controllers: [AdminSaasController],
  providers: [ConnectToolGuard, RateLimitInterceptor],
})
export class AdminSaasModule {}
