import { Module } from '@nestjs/common';
import { LinkedInClient } from './linkedin-client';
import { LinkedInTokenRefreshService } from './linkedin-token-refresh.service';

@Module({
  providers: [LinkedInClient, LinkedInTokenRefreshService],
  exports: [LinkedInClient, LinkedInTokenRefreshService],
})
export class LinkedInApiModule {}
