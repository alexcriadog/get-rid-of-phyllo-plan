import {
  isCommentsDisabled,
  mapYoutubeError,
  msUntilPacificMidnight,
} from '../../shared/youtube-api/youtube-errors';
import {
  AdapterFetchError,
  RateLimitedError,
  TokenRevokedError,
} from '../../shared/platform-adapter.port';

function gaxios(status: number, errors: Array<{ reason?: string }>) {
  return { response: { status, data: { error: { errors } } } };
}

describe('mapYoutubeError', () => {
  it('returns TokenRevokedError on 401', () => {
    const out = mapYoutubeError('youtube', '/channels', gaxios(401, []), 'rate:yt:x');
    expect(out).toBeInstanceOf(TokenRevokedError);
  });

  it('returns TokenRevokedError on 403 authError', () => {
    const out = mapYoutubeError(
      'youtube',
      '/channels',
      gaxios(403, [{ reason: 'authError' }]),
      'rate:yt:x',
    );
    expect(out).toBeInstanceOf(TokenRevokedError);
  });

  it('returns RateLimitedError on quotaExceeded', () => {
    const out = mapYoutubeError(
      'youtube',
      '/videos',
      gaxios(403, [{ reason: 'quotaExceeded' }]),
      'rate:yt:daily_quota:2026-05-04',
    );
    expect(out).toBeInstanceOf(RateLimitedError);
    if (out instanceof RateLimitedError) {
      expect(out.bucketKey).toBe('rate:yt:daily_quota:2026-05-04');
      expect(out.resetInMs).toBeGreaterThan(0);
    }
  });

  it('returns RateLimitedError on 429', () => {
    const out = mapYoutubeError('youtube', '/videos', gaxios(429, []), 'rate:yt:qps');
    expect(out).toBeInstanceOf(RateLimitedError);
  });

  it('returns AdapterFetchError on 500', () => {
    const out = mapYoutubeError('youtube', '/videos', gaxios(500, []), 'rate:yt:x');
    expect(out).toBeInstanceOf(AdapterFetchError);
  });
});

describe('isCommentsDisabled', () => {
  it('detects the commentsDisabled reason', () => {
    expect(isCommentsDisabled(gaxios(403, [{ reason: 'commentsDisabled' }]))).toBe(
      true,
    );
    expect(isCommentsDisabled(gaxios(403, [{ reason: 'authError' }]))).toBe(false);
  });
});

describe('msUntilPacificMidnight', () => {
  it('returns >0 and ≤25h', () => {
    const ms = msUntilPacificMidnight(new Date('2026-05-04T18:00:00Z'));
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThanOrEqual(25 * 3_600_000);
  });
});
