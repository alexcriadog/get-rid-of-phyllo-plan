import { Global, Module } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { PrometheusCollectorsService } from './prometheus-collectors.service';

@Global()
@Module({
  providers: [MetricsService, PrometheusCollectorsService],
  exports: [MetricsService],
})
export class SharedMetricsModule {}
