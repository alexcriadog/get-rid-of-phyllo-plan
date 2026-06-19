import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@shared/database/prisma.service';
import { AesLocalService } from '@shared/crypto/aes-local.service';

/** Minimal client surface shared by PrismaService and an interactive tx client. */
type TokenHistoryClient = Pick<
  Prisma.TransactionClient,
  'oAuthToken' | 'account' | 'oAuthTokenHistory'
>;

export type TokenHistorySource = 'connect' | 'refresh';

/**
 * Append-only recorder for OAuth tokens. Every time a token is sealed for an
 * account (initial connect or a refresh rotation) we snapshot the CURRENT
 * `oauth_tokens` row into `oauth_token_history`.
 *
 * The history table has NO foreign key to Account, so it SURVIVES account
 * deletion / overwrite — it's a break-glass recovery store: if an account is
 * removed from the product (or its token is overwritten by another flow) the
 * encrypted token is still here, recoverable via `scripts/decrypt-token.ts`
 * without forcing the user to re-authenticate.
 *
 * Best-effort by design: a history-write failure NEVER breaks the primary token
 * persistence (the connect/refresh already succeeded). On MySQL a failed
 * statement is contained, so calling this inside the connect transaction is safe.
 */
@Injectable()
export class TokenHistoryService {
  private readonly logger = new Logger(TokenHistoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aes: AesLocalService,
  ) {}

  /**
   * Snapshot the account's current token into history. Pass the interactive
   * transaction client when recording inside the connect tx; otherwise the
   * default PrismaService is used.
   */
  async record(
    accountId: bigint,
    source: TokenHistorySource,
    client: TokenHistoryClient = this.prisma,
  ): Promise<void> {
    try {
      const [token, account] = await Promise.all([
        client.oAuthToken.findUnique({ where: { accountId } }),
        client.account.findUnique({
          where: { id: accountId },
          select: {
            canonicalUserId: true,
            platform: true,
            connectionFlow: true,
          },
        }),
      ]);
      if (!token) return; // nothing sealed for this account yet — nothing to snapshot

      await client.oAuthTokenHistory.create({
        data: {
          accountId,
          canonicalUserId: account?.canonicalUserId ?? null,
          platform: account?.platform ?? null,
          connectionFlow: account?.connectionFlow ?? null,
          accessTokenCiphertext: token.accessTokenCiphertext,
          userAccessTokenCiphertext: token.userAccessTokenCiphertext,
          refreshTokenCiphertext: token.refreshTokenCiphertext,
          scopes: token.scopes as Prisma.InputJsonValue,
          expiresAt: token.expiresAt,
          keyVersion: this.aes.keyId(),
          source,
        },
      });
    } catch (err) {
      // The safety net must never break the primary flow.
      this.logger.warn(
        `token-history snapshot failed for account ${accountId.toString()} (${source}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
