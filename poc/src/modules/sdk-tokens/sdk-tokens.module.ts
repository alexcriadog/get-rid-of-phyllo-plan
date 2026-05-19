import { Module } from '@nestjs/common';
import { SharedRedisModule } from '@shared/redis/redis.module';
import { WorkspacesModule } from '@modules/workspaces/workspaces.module';
import { ApiKeysModule } from '@modules/api-keys/api-keys.module';
import { RateLimitInterceptor } from '@/common/interceptors/rate-limit.interceptor';
import { SdkTokensService } from './sdk-tokens.service';
import { SdkTokensController } from './sdk-tokens.controller';
import { InternalSdkTokensController } from './internal-sdk-tokens.controller';

@Module({
  imports: [SharedRedisModule, WorkspacesModule, ApiKeysModule],
  controllers: [SdkTokensController, InternalSdkTokensController],
  providers: [SdkTokensService, RateLimitInterceptor],
  exports: [SdkTokensService],
})
export class SdkTokensModule {}
