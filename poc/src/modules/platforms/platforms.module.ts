import { Module } from '@nestjs/common';
import { InstagramAdapter } from './instagram/instagram.adapter';
import { InstagramModule } from './instagram/instagram.module';
import {
  ADAPTER_REGISTRY,
  AdapterRegistry,
} from './shared/platform-adapter.port';

// Re-export the DI token + type so consumers can @Inject from this module path.
export { ADAPTER_REGISTRY };
export type { AdapterRegistry };

/**
 * Central platform registry. Add new adapters here when onboarding a platform
 * (Day 6 ships Facebook — same shape).
 */
@Module({
  imports: [InstagramModule],
  providers: [
    {
      provide: ADAPTER_REGISTRY,
      useFactory: (ig: InstagramAdapter): AdapterRegistry => ({
        instagram: ig,
      }),
      inject: [InstagramAdapter],
    },
  ],
  exports: [ADAPTER_REGISTRY, InstagramModule],
})
export class PlatformsModule {}
