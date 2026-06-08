import { Module } from '@nestjs/common';
import { SharedDatabaseModule } from '@shared/database/database.module';
import { SharedCryptoModule } from '@shared/crypto/crypto.module';
import { PlatformsModule } from '@modules/platforms/platforms.module';
import { MetaGraphModule } from '@modules/platforms/shared/meta-graph/meta-graph.module';
import { OutboundWebhooksModule } from '@modules/outbound-webhooks/outbound-webhooks.module';
import { CadenceService } from './cadence.service';
import { ThrottleLockService } from './throttle-lock.service';
import { SchedulerService } from './scheduler.service';
import { SyncWorker } from './sync.worker';
import { CanonicalWriteService } from './canonical-write.service';

/**
 * Wires the scheduler + worker + supporting services.
 *
 * Redis, BullMQ, Mongo, Metrics and the platform adapter registry are
 * expected to be globally-exposed from shared modules (that's the other
 * agent's scope). We import `PlatformsModule` explicitly because the
 * `ADAPTER_REGISTRY` token is defined there. `MetaGraphModule` is imported
 * so SchedulerService can inject BucTelemetryService for app-level
 * preflight (see scheduler.service.ts:preflightCheck).
 */
@Module({
  imports: [
    SharedDatabaseModule,
    SharedCryptoModule,
    PlatformsModule,
    MetaGraphModule,
    OutboundWebhooksModule,
  ],
  providers: [
    CadenceService,
    ThrottleLockService,
    SchedulerService,
    SyncWorker,
    CanonicalWriteService,
  ],
  exports: [CadenceService, ThrottleLockService],
})
export class SyncModule {}
