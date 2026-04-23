import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';
import { BullmqService } from './bullmq.service';
import { RateBucketService } from './rate-bucket.service';

@Global()
@Module({
  providers: [RedisService, BullmqService, RateBucketService],
  exports: [RedisService, BullmqService, RateBucketService],
})
export class SharedRedisModule {}
