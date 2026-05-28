import { Module } from '@nestjs/common';
import { SharedDatabaseModule } from '@shared/database/database.module';
import { SharedCryptoModule } from '@shared/crypto/crypto.module';
import { ConnectToolGuard } from '@modules/admin/connect-tool.guard';
import { WorkspacesController } from './workspaces.controller';
import { ProductsCatalogController } from './catalog.controller';
import { WorkspacesService } from './workspaces.service';

@Module({
  imports: [SharedDatabaseModule, SharedCryptoModule],
  controllers: [WorkspacesController, ProductsCatalogController],
  // ConnectToolGuard is provided locally to avoid a circular dependency with
  // AdminModule, which imports WorkspacesModule. The guard has no DI deps
  // beyond ConfigService (global), so co-providing here is safe.
  providers: [WorkspacesService, ConnectToolGuard],
  exports: [WorkspacesService],
})
export class WorkspacesModule {}
