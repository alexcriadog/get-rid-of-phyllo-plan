// Per-user rate-limit buckets must key by the STABLE canonical user id (same
// across workspaces AND token refreshes), NOT the access-token hash. Every
// platform meters its per-user limit by the user identity (TikTok open_id,
// YouTube channel/principal, Twitch user, LinkedIn member, Threads user) — so
// token-hash keying double-counts the budget when one user is connected in two
// workspaces (two tokens → two buckets) and silently resets on every token
// refresh. See the 2026-06-30 rate-limit research.

import type { PlatformAdapterContext } from '../platform-adapter.port';
import { TikTokRateLimitStrategy } from '../../tiktok/tiktok.rate-limit.strategy';
import { YoutubeRateLimitStrategy } from '../../youtube/youtube.rate-limit.strategy';
import { TwitchRateLimitStrategy } from '../../twitch/twitch.rate-limit.strategy';
import { LinkedInRateLimitStrategy } from '../../linkedin/linkedin.rate-limit.strategy';
import { ThreadsRateLimitStrategy } from '../../threads/threads.rate-limit.strategy';

// canonical id is identical for the same user across workspaces; the token hash
// differs per workspace + per refresh.
const CTX: PlatformAdapterContext = {
  channelId: 'CANON-1',
  pageId: 'CANON-1',
  tokenHash: 'TOK-abc',
};
const TOKEN_ONLY: PlatformAdapterContext = { tokenHash: 'TOK-abc' };

describe('per-user rate buckets key by canonical id, not token hash', () => {
  it('TikTok: daily-user bucket keys by {channel_id}, gated on canonical id', () => {
    const hints = new TikTokRateLimitStrategy().hints(CTX);
    const user = hints.find((h) => h.scope === 'daily_user');
    expect(user).toBeDefined();
    expect(user!.keyTemplate).toContain('{channel_id}');
    expect(user!.keyTemplate).not.toContain('{hash}');
    expect(
      new TikTokRateLimitStrategy()
        .hints(TOKEN_ONLY)
        .find((h) => h.scope === 'daily_user'),
    ).toBeUndefined();
  });

  it('YouTube: per-user analytics bucket keys by {channel_id}', () => {
    const user = new YoutubeRateLimitStrategy()
      .hints(CTX)
      .find((h) => h.scope === 'qps_analytics_user');
    expect(user!.keyTemplate).toContain('{channel_id}');
    expect(user!.keyTemplate).not.toContain('{hash}');
    expect(
      new YoutubeRateLimitStrategy()
        .hints(TOKEN_ONLY)
        .find((h) => h.scope === 'qps_analytics_user'),
    ).toBeUndefined();
  });

  it('Twitch: per-user helix bucket keys by {channel_id}', () => {
    const user = new TwitchRateLimitStrategy()
      .hints(CTX)
      .find((h) => h.scope === 'helix_user');
    expect(user!.keyTemplate).toContain('{channel_id}');
    expect(user!.keyTemplate).not.toContain('{hash}');
  });

  it('LinkedIn: per-member bucket keys by {channel_id}', () => {
    const user = new LinkedInRateLimitStrategy()
      .hints(CTX)
      .find((h) => h.scope === 'linkedin_member');
    expect(user!.keyTemplate).toContain('{channel_id}');
    expect(user!.keyTemplate).not.toContain('{hash}');
  });

  it('Threads: drops the per-token bucket, keeps per-user {page_id}', () => {
    const hints = new ThreadsRateLimitStrategy().hints(CTX);
    expect(hints.find((h) => h.scope === 'user_token')).toBeUndefined();
    const user = hints.find((h) => h.scope === 'user');
    expect(user!.keyTemplate).toContain('{page_id}');
    expect(hints.every((h) => !h.keyTemplate.includes('{hash}'))).toBe(true);
  });
});
