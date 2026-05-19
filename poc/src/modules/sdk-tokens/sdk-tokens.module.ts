import { Module } from '@nestjs/common';
import { WorkspacesModule } from '@modules/workspaces/workspaces.module';
import { ApiKeysModule } from '@modules/api-keys/api-keys.module';
import { SdkTokensService } from './sdk-tokens.service';
import { SdkTokensController } from './sdk-tokens.controller';
import { InternalSdkTokensController } from './internal-sdk-tokens.controller';

@Module({
  imports: [WorkspacesModule, ApiKeysModule],
  controllers: [SdkTokensController, InternalSdkTokensController],
  providers: [SdkTokensService],
  exports: [SdkTokensService],
})
export class SdkTokensModule {}
