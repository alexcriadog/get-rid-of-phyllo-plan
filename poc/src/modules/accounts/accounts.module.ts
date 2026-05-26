import { Module } from '@nestjs/common';
import { SharedDatabaseModule } from '@shared/database/database.module';
import { SharedCryptoModule } from '@shared/crypto/crypto.module';
import { OutboundWebhooksModule } from '@modules/outbound-webhooks/outbound-webhooks.module';
import { WorkspacesModule } from '@modules/workspaces/workspaces.module';
import { AccountsController } from './accounts.controller';
import { AccountsService } from './accounts.service';
import { InternalAccountsController } from './internal-accounts.controller';

@Module({
  imports: [SharedDatabaseModule, SharedCryptoModule, OutboundWebhooksModule, WorkspacesModule],
  controllers: [AccountsController, InternalAccountsController],
  providers: [AccountsService],
  exports: [AccountsService],
})
export class AccountsModule {}
