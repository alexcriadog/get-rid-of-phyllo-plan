import { Module } from '@nestjs/common';
import { AccountsModule } from '@modules/accounts/accounts.module';
import { AdminController } from './admin.controller';

@Module({
  imports: [AccountsModule],
  controllers: [AdminController],
})
export class AdminModule {}
