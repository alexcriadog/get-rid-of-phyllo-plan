import { Global, Module } from '@nestjs/common';
import { AesLocalService } from './aes-local.service';

@Global()
@Module({
  providers: [AesLocalService],
  exports: [AesLocalService],
})
export class SharedCryptoModule {}
