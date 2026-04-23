import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { AppConfigService } from '@shared/config/config.module';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12;
const AUTH_TAG_LENGTH_BYTES = 16;
const KEY_LENGTH_BYTES = 32;

/**
 * Local-only AES-256-GCM. PoC-grade only — in production this is replaced by a
 * KMS-backed envelope wrapper. The on-disk format is:
 *
 *   [12-byte IV][16-byte auth tag][N-byte ciphertext]
 *
 * Self-describing since both the IV and tag are fixed-width, so no length
 * prefix is needed.
 */
@Injectable()
export class AesLocalService implements OnModuleInit {
  private readonly logger = new Logger(AesLocalService.name);
  private key!: Buffer;

  constructor(private readonly config: AppConfigService) {}

  onModuleInit(): void {
    const hexKey = this.config.getOrThrow<string>('LOCAL_AES_KEY');
    const key = Buffer.from(hexKey, 'hex');

    if (key.length !== KEY_LENGTH_BYTES) {
      throw new Error(
        `LOCAL_AES_KEY must decode to ${KEY_LENGTH_BYTES} bytes (got ${key.length})`,
      );
    }

    this.key = key;
    this.logger.log('AES-256-GCM key loaded');
  }

  encrypt(plaintext: string): Buffer {
    const iv = randomBytes(IV_LENGTH_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, ciphertext]);
  }

  decrypt(sealed: Buffer): string {
    if (sealed.length < IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES) {
      throw new Error('Ciphertext too short to contain IV + auth tag');
    }

    const iv = sealed.subarray(0, IV_LENGTH_BYTES);
    const authTag = sealed.subarray(
      IV_LENGTH_BYTES,
      IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES,
    );
    const ciphertext = sealed.subarray(IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES);

    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(authTag);

    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return plaintext.toString('utf8');
  }
}
