import { Module } from '@nestjs/common';
import { SharedDatabaseModule } from '@shared/database/database.module';
import { WorkspacesModule } from '@modules/workspaces/workspaces.module';
import { ApiKeysModule } from '@modules/api-keys/api-keys.module';
import { OutboundWebhooksModule } from '@modules/outbound-webhooks/outbound-webhooks.module';
import { AccountsModule } from '@modules/accounts/accounts.module';
import { AdminSaasController } from './admin-saas.controller';

/**
 * SaaS-tenant operator surface. Distinct from the existing AdminModule
 * (which owns sync-job / cadence / rate-bucket operations on the legacy
 * single-tenant connector) so the two can evolve independently.
 *
 * Routes are unguarded externally to match the existing /admin/* pattern
 * — the operational model is "the /admin/* URL space is operator-trust;
 * add Caddy Basic Auth at the ingress when stricter control is needed."
 */
@Module({
  imports: [
    SharedDatabaseModule,
    WorkspacesModule,
    ApiKeysModule,
    OutboundWebhooksModule,
    AccountsModule,
  ],
  controllers: [AdminSaasController],
})
export class AdminSaasModule {}
