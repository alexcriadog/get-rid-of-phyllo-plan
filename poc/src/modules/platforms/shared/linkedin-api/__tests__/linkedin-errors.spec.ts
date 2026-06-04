import {
  AdapterFetchError,
  RateLimitedError,
  TokenRevokedError,
} from '../../platform-adapter.port';
import { mapLinkedInError } from '../linkedin-errors';

function axiosLike(status: number, data: unknown) {
  return { response: { status, data }, message: `HTTP ${status}` };
}

describe('mapLinkedInError', () => {
  test('401 → TokenRevokedError', () => {
    const err = mapLinkedInError(
      'linkedin',
      '/v2/me',
      axiosLike(401, {
        status: 401,
        message: 'Invalid access token',
        serviceErrorCode: 65600,
      }),
      'bucket',
    );
    expect(err).toBeInstanceOf(TokenRevokedError);
  });

  test('REVOKED_ACCESS_TOKEN serviceErrorCode → TokenRevokedError even on 400', () => {
    const err = mapLinkedInError(
      'linkedin',
      '/rest/posts',
      axiosLike(400, {
        status: 400,
        message: 'The token used in the request has been revoked',
        serviceErrorCode: 65601,
      }),
      'bucket',
    );
    expect(err).toBeInstanceOf(TokenRevokedError);
  });

  test('429 → RateLimitedError with positive reset', () => {
    const err = mapLinkedInError(
      'linkedin',
      '/rest/posts',
      axiosLike(429, {
        status: 429,
        message: 'Resource level throttle limit reached',
      }),
      'bucket',
    );
    expect(err).toBeInstanceOf(RateLimitedError);
    expect((err as RateLimitedError).resetInMs).toBeGreaterThan(0);
  });

  test('403 ACCESS_DENIED → AdapterFetchError (NOT revoked)', () => {
    const err = mapLinkedInError(
      'linkedin',
      '/rest/posts',
      axiosLike(403, {
        status: 403,
        message: 'Not enough permissions to access this resource',
        serviceErrorCode: 100,
      }),
      'bucket',
    );
    expect(err).toBeInstanceOf(AdapterFetchError);
  });
});
