import { describe, expect, it } from 'vitest';
import { isGated } from '../gated-paths';

describe('isGated', () => {
  it('gates showroom, account, watchlist, admin, and their APIs', () => {
    for (const p of [
      '/',
      '/showroom',
      '/showroom/x',
      '/account/2',
      '/account/2/posts',
      '/watchlist',
      '/admin',
      '/admin/connect',
      '/api/admin/foo',
      '/api/showroom/accounts',
    ]) {
      expect(isGated(p), p).toBe(true);
    }
  });
  it('never gates login, auth endpoints, client, or assets', () => {
    for (const p of [
      '/login',
      '/api/auth/gate',
      '/api/auth/callback/credentials',
      '/client',
      '/client/login',
      '/api/client/proxy/x',
      '/_next/static/chunk.js',
      '/favicon.ico',
    ]) {
      expect(isGated(p), p).toBe(false);
    }
  });
});
