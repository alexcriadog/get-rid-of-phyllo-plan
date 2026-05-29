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
 *
 * Key rotation (still PoC-grade — real prod migrates to KMS):
 *   - LOCAL_AES_KEY        the ACTIVE key. Used for encrypt and tried first
 *                          on decrypt.
 *   - LOCAL_AES_KEYS_OLD   optional comma-separated list of retired keys,
 *                          used for decrypt-fallback ONLY. Lets you rotate
 *                          the active key without a big-bang re-encrypt: old
 *                          ciphertext still decrypts via a retired key, and
 *                          each token gets re-sealed with the active key on
 *                          its next refresh, so the old keys age out
 *                          naturally. GCM's auth tag makes "wrong key" an
 *                          unambiguous failure, so trying keys in order is
 *                          safe (a wrong key can't produce a false positive).
 */
@Injectable()
export class AesLocalService implements OnModuleInit {
  private readonly logger = new Logger(AesLocalService.name);
  private key!: Buffer;
  // Retired keys — decrypt fallback only, never used to encrypt.
  private oldKeys: Buffer[] = [];

  constructor(private readonly config: AppConfigService) {}

  onModuleInit(): void {
    this.key = parseAesKey(
      this.config.getOrThrow<string>('LOCAL_AES_KEY'),
      'LOCAL_AES_KEY',
    );

    const oldRaw = this.config.get<string>('LOCAL_AES_KEYS_OLD');
    this.oldKeys = (oldRaw ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((hex, i) => parseAesKey(hex, `LOCAL_AES_KEYS_OLD[${i}]`));

    this.logger.log(
      this.oldKeys.length > 0
        ? `AES-256-GCM key loaded (+${this.oldKeys.length} retired key(s) for decrypt fallback)`
        : 'AES-256-GCM key loaded',
    );
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

    // Try the active key first, then each retired key. GCM verifies the auth
    // tag in decipher.final(), so a wrong key throws — we move on. Only when
    // every key fails do we surface the error.
    let lastErr: unknown;
    for (const key of [this.key, ...this.oldKeys]) {
      try {
        const decipher = createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(authTag);
        return Buffer.concat([
          decipher.update(ciphertext),
          decipher.final(),
        ]).toString('utf8');
      } catch (err) {
        lastErr = err;
      }
    }
    throw new Error(
      `AES decrypt failed against the active key and ${this.oldKeys.length} retired key(s): ` +
        (lastErr instanceof Error ? lastErr.message : String(lastErr)),
    );
  }
}

/** Decode + validate a hex AES key to a 32-byte buffer, or throw. */
function parseAesKey(hex: string, envName: string): Buffer {
  const key = Buffer.from(hex, 'hex');
  if (key.length !== KEY_LENGTH_BYTES) {
    throw new Error(
      `${envName} must decode to ${KEY_LENGTH_BYTES} bytes (got ${key.length})`,
    );
  }
  return key;
}
