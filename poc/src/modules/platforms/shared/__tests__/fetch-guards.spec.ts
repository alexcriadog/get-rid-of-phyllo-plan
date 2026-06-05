import {
  AdapterFetchError,
  RateLimitedError,
  TokenRevokedError,
} from '../platform-adapter.port';
import { rethrowCritical } from '../fetch-guards';

describe('rethrowCritical', () => {
  test('rethrows RateLimitedError', () => {
    const err = new RateLimitedError('linkedin', 60_000, 'bucket');
    expect(() => rethrowCritical(err)).toThrow(err);
  });

  test('rethrows TokenRevokedError', () => {
    const err = new TokenRevokedError('twitch', '123');
    expect(() => rethrowCritical(err)).toThrow(err);
  });

  test('passes through AdapterFetchError (soft error)', () => {
    const err = new AdapterFetchError('youtube', '/videos', new Error('403'));
    expect(() => rethrowCritical(err)).not.toThrow();
  });

  test('passes through generic errors', () => {
    expect(() => rethrowCritical(new Error('boom'))).not.toThrow();
    expect(() => rethrowCritical('string error')).not.toThrow();
    expect(() => rethrowCritical(undefined)).not.toThrow();
  });
});
