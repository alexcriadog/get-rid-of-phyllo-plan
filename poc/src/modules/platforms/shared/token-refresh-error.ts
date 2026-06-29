// Typed failure thrown by every per-platform token *refresh* service when the
// OAuth token endpoint rejects a refresh. `permanent` separates the two
// outcomes the proactive cron (token-refresh.cron.service) must treat very
// differently:
//
//   - permanent=true  → the refresh grant is dead (revoked, expired,
//     invalid_grant, app removed, token-dead OAuthException). Re-authentication
//     is the ONLY recovery, so the caller flags needs_reauth immediately
//     instead of retrying for the full lead window.
//   - permanent=false → transient upstream failure (5xx, network, timeout,
//     rate-limit, or anything we can't confidently classify). The token may
//     still be perfectly valid; the caller retries later and must NOT flag
//     needs_reauth — otherwise a passing outage would force a needless
//     end-user reconnect on a healthy account.
//
// Default-to-transient is deliberate: misclassifying a transient blip as
// permanent bounces a healthy account to needs_reauth (sticky — the cron then
// excludes it, so it can't self-heal), which is strictly worse than retrying a
// dead token a few more times.

export class TokenRefreshError extends Error {
  constructor(
    public readonly reason: string,
    public readonly permanent: boolean,
  ) {
    super(reason);
    this.name = 'TokenRefreshError';
  }
}
