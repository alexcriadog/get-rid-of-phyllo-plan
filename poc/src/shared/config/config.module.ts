import { Global, Injectable, Logger, Module, OnModuleInit } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

/**
 * Env vars that must be present at boot. Missing any of these is a hard error —
 * we fail fast rather than discover the problem on the first token decrypt.
 */
const REQUIRED_ENV_VARS = ['DATABASE_URL', 'LOCAL_AES_KEY'] as const;

type RequiredEnvVar = (typeof REQUIRED_ENV_VARS)[number];

@Injectable()
export class AppConfigService implements OnModuleInit {
  private readonly logger = new Logger(AppConfigService.name);

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const missing: RequiredEnvVar[] = REQUIRED_ENV_VARS.filter(
      (key) => !this.config.get<string>(key),
    );

    if (missing.length > 0) {
      const msg = `Missing required env vars: ${missing.join(', ')}`;
      this.logger.error(msg);
      throw new Error(msg);
    }

    const aesHex = this.config.get<string>('LOCAL_AES_KEY') ?? '';
    if (!/^[0-9a-fA-F]{64}$/.test(aesHex)) {
      const msg = 'LOCAL_AES_KEY must be a 64-char hex string (32 bytes)';
      this.logger.error(msg);
      throw new Error(msg);
    }

    this.logger.log('Configuration validated');
  }

  get<T = string>(key: string, fallback?: T): T | undefined {
    const value = this.config.get<T>(key);
    return value ?? fallback;
  }

  getOrThrow<T = string>(key: string): T {
    const value = this.config.get<T>(key);
    if (value === undefined || value === null || value === '') {
      throw new Error(`Missing required env var: ${key}`);
    }
    return value;
  }
}

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
  ],
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class AppConfigModule {}
