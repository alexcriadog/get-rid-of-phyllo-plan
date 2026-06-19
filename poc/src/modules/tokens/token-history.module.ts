import { Global, Module } from '@nestjs/common';
import { TokenHistoryService } from './token-history.service';

/**
 * Global so any token-persisting service (accounts connect, per-platform refresh
 * crons) can inject TokenHistoryService without importing this module. Relies on
 * the global SharedDatabaseModule (PrismaService) + SharedCryptoModule (AES).
 */
@Global()
@Module({
  providers: [TokenHistoryService],
  exports: [TokenHistoryService],
})
export class TokenHistoryModule {}
