import { Module } from '@nestjs/common';
import { SharedDatabaseModule } from '@shared/database/database.module';
import { ConnectToolGuard } from '@modules/admin/connect-tool.guard';
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
 * ConnectToolGuard is registered as a local provider so this module
 * doesn't have to depend on AdminModule's internals — it only needs the
 * bearer guard's shape, not the rest of the admin DI graph.
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
  providers: [ConnectToolGuard],
})
export class AdminSaasModule {}
