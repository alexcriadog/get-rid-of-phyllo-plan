import { Module } from '@nestjs/common';
import { AppConfigModule } from '@shared/config/config.module';
import { SharedDatabaseModule } from '@shared/database/database.module';
import { SharedCryptoModule } from '@shared/crypto/crypto.module';
import { AccountsModule } from '@modules/accounts/accounts.module';
import { AdminModule } from '@modules/admin/admin.module';

@Module({
  imports: [
    AppConfigModule,
    SharedDatabaseModule,
    SharedCryptoModule,
    AccountsModule,
    AdminModule,
  ],
})
export class AppModule {}
