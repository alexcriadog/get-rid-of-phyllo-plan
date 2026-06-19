/**
 * Break-glass recovery CLI: decrypt a token from `oauth_token_history`.
 *
 *   node dist/src/scripts/decrypt-token.js --account <accountId>
 *   node dist/src/scripts/decrypt-token.js --canonical <id> [--platform instagram] [--flow ig_direct]
 *
 * Prints the DECRYPTED token(s) of the most recent history row that matches.
 * Reuses the connector's AES-256-GCM keyring (LOCAL_AES_KEY + LOCAL_AES_KEYS_OLD),
 * so it decrypts across key rotations as long as the retired key is still listed.
 *
 * SECURITY: prints plaintext secrets to stdout. Run only on a trusted host, by an
 * operator who needs to recover a token. Do not casually log/redirect the output.
 */
import { PrismaClient } from '@prisma/client';
import { AesLocalService } from '../shared/crypto/aes-local.service';
import type { AppConfigService } from '../shared/config/config.module';

// Minimal AppConfigService shim — AesLocalService only reads LOCAL_AES_KEY +
// LOCAL_AES_KEYS_OLD via get/getOrThrow, both backed by process.env here.
const configShim = {
  get<T = string>(key: string, fallback?: T): T | undefined {
    const v = process.env[key];
    return (v as unknown as T) ?? fallback;
  },
  getOrThrow<T = string>(key: string): T {
    const v = process.env[key];
    if (v === undefined || v === '') {
      throw new Error(`Missing required env "${key}"`);
    }
    return v as unknown as T;
  },
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const accountArg = arg('account');
  const canonical = arg('canonical');
  const platform = arg('platform');
  const flow = arg('flow');

  if (!accountArg && !canonical) {
    console.error(
      'usage: decrypt-token --account <id> | --canonical <id> [--platform <p>] [--flow <f>]',
    );
    process.exit(2);
    return;
  }

  const aes = new AesLocalService(configShim as unknown as AppConfigService);
  aes.onModuleInit();

  const prisma = new PrismaClient();
  try {
    const where = accountArg
      ? { accountId: BigInt(accountArg) }
      : {
          canonicalUserId: canonical,
          ...(platform ? { platform } : {}),
          ...(flow ? { connectionFlow: flow } : {}),
        };

    const row = await prisma.oAuthTokenHistory.findFirst({
      where,
      orderBy: { capturedAt: 'desc' },
    });
    if (!row) {
      console.error('No history row matched the given selector.');
      process.exit(1);
      return;
    }

    const dec = (b: Uint8Array | null): string | null =>
      b ? aes.decrypt(Buffer.from(b)) : null;

    const out = {
      historyId: row.id.toString(),
      accountId: row.accountId.toString(),
      canonicalUserId: row.canonicalUserId,
      platform: row.platform,
      connectionFlow: row.connectionFlow,
      source: row.source,
      keyVersion: row.keyVersion,
      capturedAt: row.capturedAt,
      expiresAt: row.expiresAt,
      expired: row.expiresAt ? row.expiresAt.getTime() < Date.now() : null,
      accessToken: dec(row.accessTokenCiphertext),
      userAccessToken: dec(row.userAccessTokenCiphertext),
      refreshToken: dec(row.refreshTokenCiphertext),
    };
    console.log(JSON.stringify(out, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
