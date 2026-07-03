// Liveness probe verdict for the canary cron. Reuses each platform adapter's
// cheapest real read (fetchProfile) as ground truth, and classifies the error
// with the codebase's default-to-transient policy: only a genuine
// TokenRevokedError flips an account to needs_reauth.
import {
  PlatformAdapter,
  TokenRevokedError,
} from '@modules/platforms/shared/platform-adapter.port';

export type ProbeVerdict = 'healthy' | 'reauth' | 'transient';

export async function probeAccount(
  adapter: Pick<PlatformAdapter, 'fetchProfile'>,
  accessToken: string,
  canonicalId: string,
  metadata?: Record<string, unknown> | null,
): Promise<ProbeVerdict> {
  try {
    await adapter.fetchProfile(accessToken, canonicalId, metadata ?? undefined);
    return 'healthy';
  } catch (err) {
    if (err instanceof TokenRevokedError) return 'reauth';
    return 'transient';
  }
}
