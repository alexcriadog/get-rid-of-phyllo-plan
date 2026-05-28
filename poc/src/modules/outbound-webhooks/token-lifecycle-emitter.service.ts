// Token-lifecycle event emitter.
//
// The platforms/ token-refresh services each have a success path and a
// transient-error path. Without a shared helper they'd each need to inject
// OutboundWebhooksService, load the account row, build the right payload,
// and remember to suppress test-mode accounts — ample surface for drift.
//
// This service is the single place those three events get assembled:
//   - tokenRefreshed     → account.refreshed
//   - tokenRefreshFailed → token.refresh_failed     (transient, will retry)
//   - tokenExpired       → token.expired            (terminal, needs reauth)
//
// Callers pass an accountId; we load the workspace + canonical fields and
// emit. If the account is test-mode (isTest=true) we drop silently — the
// guard lives here so a future caller can't forget it.

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@shared/database/prisma.service';
import { OutboundWebhooksService } from './outbound-webhooks.service';

@Injectable()
export class TokenLifecycleEmitter {
  private readonly logger = new Logger(TokenLifecycleEmitter.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly webhooks: OutboundWebhooksService,
  ) {}

  /** Access-token was successfully refreshed via refresh-token grant. */
  async tokenRefreshed(
    accountId: bigint,
    opts: { expiresAt?: Date | null } = {},
  ): Promise<void> {
    const acc = await this.loadAccount(accountId);
    if (!acc) return;
    if (acc.isTest) return;
    await this.webhooks.emit(acc.workspaceId, 'account.refreshed', {
      account_id: acc.id.toString(),
      platform: acc.platform,
      workspace_id: acc.workspaceId,
      expires_at: (opts.expiresAt ?? null)?.toISOString() ?? null,
      occurred_at: new Date().toISOString(),
    });
  }

  /**
   * Refresh-token grant failed but the worker WILL retry (transient
   * network error, 5xx upstream, rate-limit). Clients use this to surface
   * a "live sync may be delayed" UI without prompting the end-user to
   * reconnect yet.
   */
  async tokenRefreshFailed(
    accountId: bigint,
    opts: { reason: string; retryInSeconds?: number | null } = {
      reason: 'unknown',
    },
  ): Promise<void> {
    const acc = await this.loadAccount(accountId);
    if (!acc) return;
    if (acc.isTest) return;
    await this.webhooks.emit(acc.workspaceId, 'token.refresh_failed', {
      account_id: acc.id.toString(),
      platform: acc.platform,
      workspace_id: acc.workspaceId,
      reason: opts.reason,
      retry_in_seconds: opts.retryInSeconds ?? null,
      occurred_at: new Date().toISOString(),
    });
  }

  /**
   * Account moved to status='needs_reauth' — the refresh-token grant
   * returned a permanent error (revoked, deleted user, scopes withdrawn).
   * The client MUST send the end-user back through OAuth; no automated
   * retry will recover this.
   */
  async tokenExpired(
    accountId: bigint,
    opts: { reason: string },
  ): Promise<void> {
    const acc = await this.loadAccount(accountId);
    if (!acc) return;
    if (acc.isTest) return;
    await this.webhooks.emit(acc.workspaceId, 'token.expired', {
      account_id: acc.id.toString(),
      platform: acc.platform,
      workspace_id: acc.workspaceId,
      end_user_id: acc.endUserId ?? null,
      canonical_user_id: acc.canonicalUserId,
      reason: opts.reason,
      occurred_at: new Date().toISOString(),
    });
  }

  private async loadAccount(accountId: bigint): Promise<{
    id: bigint;
    workspaceId: string;
    platform: string;
    canonicalUserId: string;
    endUserId: string | null;
    isTest: boolean;
  } | null> {
    try {
      const row = await this.prisma.account.findUnique({
        where: { id: accountId },
        select: {
          id: true,
          workspaceId: true,
          platform: true,
          canonicalUserId: true,
          endUserId: true,
          isTest: true,
        },
      });
      return row;
    } catch (err) {
      this.logger.warn(
        `TokenLifecycleEmitter: account ${accountId.toString()} lookup failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }
}
