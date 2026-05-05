import { YoutubeRateLimitStrategy } from '../youtube.rate-limit.strategy';

describe('YoutubeRateLimitStrategy', () => {
  const strategy = new YoutubeRateLimitStrategy();

  it('always returns daily_quota + qps_analytics hints', () => {
    const hints = strategy.hints({});
    expect(hints.map((h) => h.scope)).toEqual(['daily_quota', 'qps_analytics']);
    const daily = hints.find((h) => h.scope === 'daily_quota')!;
    expect(daily.capacity).toBe(10_000);
    expect(daily.refillPerMs).toBe(0);
    expect(daily.strategy).toBe('daily-counter');
    const qps = hints.find((h) => h.scope === 'qps_analytics')!;
    expect(qps.capacity).toBe(720);
    expect(qps.strategy).toBe('token-bucket');
  });

  it('adds qps_analytics_user when context has tokenHash', () => {
    const hints = strategy.hints({ tokenHash: 'abcdef' });
    expect(hints.map((h) => h.scope)).toEqual([
      'daily_quota',
      'qps_analytics',
      'qps_analytics_user',
    ]);
    const userHint = hints.find((h) => h.scope === 'qps_analytics_user')!;
    expect(userHint.capacity).toBe(60);
    expect(userHint.keyTemplate).toContain('{hash}');
  });
});
