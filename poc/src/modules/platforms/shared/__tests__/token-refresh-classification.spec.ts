// Per-platform refresh-failure classification.
//
// Every token-refresh service must translate an OAuth token-endpoint rejection
// into a TokenRefreshError carrying `permanent`:
//   - permanent=true  on a dead grant (invalid_grant / revoked / token-dead
//     OAuthException) — and it must NOT emit the transient `token.refresh_failed`
//     webhook (the cron will fire the terminal `token.expired` instead).
//   - permanent=false on a transient upstream failure (5xx) — and it SHOULD
//     emit `token.refresh_failed` so clients can surface "sync delayed".

jest.mock('axios', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));
import axios from 'axios';

import { TokenRefreshError } from '../token-refresh-error';
import { TikTokTokenRefreshService } from '../tiktok-api/tiktok-token-refresh.service';
import { TwitchTokenRefreshService } from '../twitch-api/twitch-token-refresh.service';
import { YoutubeTokenRefreshService } from '../youtube-api/youtube-token-refresh.service';
import { ThreadsTokenRefreshService } from '../threads-api/threads-token-refresh.service';
import { InstagramDirectTokenRefreshService } from '../instagram-api/instagram-direct-token-refresh.service';
import { LinkedInTokenRefreshService } from '../linkedin-api/linkedin-token-refresh.service';

const post = axios.post as jest.Mock;
const get = axios.get as jest.Mock;

interface Deps {
  prisma: { oAuthToken: { update: jest.Mock } };
  aes: { encrypt: jest.Mock; decrypt: jest.Mock };
  config: { get: jest.Mock };
  lifecycle: { tokenRefreshFailed: jest.Mock; tokenRefreshed: jest.Mock };
}

function deps(): Deps {
  return {
    prisma: { oAuthToken: { update: jest.fn().mockResolvedValue({}) } },
    aes: { encrypt: jest.fn(() => Buffer.from('c')), decrypt: jest.fn(() => 'plain') },
    config: { get: jest.fn(() => 'cred') },
    lifecycle: {
      tokenRefreshFailed: jest.fn().mockResolvedValue(undefined),
      tokenRefreshed: jest.fn().mockResolvedValue(undefined),
    },
  };
}

async function catchErr(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return undefined;
  } catch (e) {
    return e;
  }
}

beforeEach(() => {
  post.mockReset();
  get.mockReset();
});

type Case = {
  name: string;
  invoke: (d: Deps) => Promise<unknown>;
  method: 'get' | 'post';
  permanentBody: unknown;
  permanentStatus: number;
};

const CASES: Case[] = [
  {
    name: 'YouTube',
    method: 'post',
    permanentStatus: 400,
    permanentBody: { error: 'invalid_grant', error_description: 'Token revoked' },
    invoke: (d) =>
      new YoutubeTokenRefreshService(
        d.prisma as never,
        d.aes as never,
        d.config as never,
        d.lifecycle as never,
      ).refresh(1n, 'rt'),
  },
  {
    name: 'TikTok',
    method: 'post',
    permanentStatus: 400,
    permanentBody: { error: 'invalid_grant', error_description: 'Refresh token invalid or expired' },
    invoke: (d) =>
      new TikTokTokenRefreshService(
        d.prisma as never,
        d.aes as never,
        d.config as never,
        d.lifecycle as never,
      ).refresh(1n, Buffer.from('rt')),
  },
  {
    name: 'Twitch',
    method: 'post',
    permanentStatus: 400,
    permanentBody: { status: 400, message: 'Invalid refresh token' },
    invoke: (d) =>
      new TwitchTokenRefreshService(
        d.prisma as never,
        d.aes as never,
        d.config as never,
        d.lifecycle as never,
      ).refresh(1n, 'rt'),
  },
  {
    name: 'LinkedIn',
    method: 'post',
    permanentStatus: 400,
    permanentBody: { error: 'invalid_grant', error_description: 'refresh token expired' },
    invoke: (d) =>
      new LinkedInTokenRefreshService(
        d.prisma as never,
        d.aes as never,
        d.config as never,
        d.lifecycle as never,
      ).refresh(1n, 'rt'),
  },
  {
    name: 'Threads',
    method: 'get',
    permanentStatus: 400,
    permanentBody: {
      error: { message: 'Error validating access token', code: 190, error_subcode: 463 },
    },
    invoke: (d) =>
      new ThreadsTokenRefreshService(
        d.prisma as never,
        d.aes as never,
        d.config as never,
        d.lifecycle as never,
      ).refresh(1n, 'long-lived'),
  },
  {
    name: 'IG-direct',
    method: 'get',
    permanentStatus: 400,
    permanentBody: { error: { message: 'Invalid OAuth access token', code: 190 } },
    invoke: (d) =>
      new InstagramDirectTokenRefreshService(
        d.prisma as never,
        d.aes as never,
        d.lifecycle as never,
      ).refresh(1n, 'long-lived'),
  },
];

describe('token-refresh failure classification', () => {
  for (const c of CASES) {
    describe(c.name, () => {
      it('throws permanent=true on a dead-grant rejection and does NOT emit token.refresh_failed', async () => {
        const mock = c.method === 'get' ? get : post;
        mock.mockResolvedValue({ status: c.permanentStatus, data: c.permanentBody });
        const d = deps();

        const err = await catchErr(c.invoke(d));

        expect(err).toBeInstanceOf(TokenRefreshError);
        expect((err as TokenRefreshError).permanent).toBe(true);
        expect(d.lifecycle.tokenRefreshFailed).not.toHaveBeenCalled();
        expect(d.prisma.oAuthToken.update).not.toHaveBeenCalled();
      });

      it('throws permanent=false on a 5xx and emits token.refresh_failed', async () => {
        const mock = c.method === 'get' ? get : post;
        mock.mockResolvedValue({ status: 503, data: {} });
        const d = deps();

        const err = await catchErr(c.invoke(d));

        expect(err).toBeInstanceOf(TokenRefreshError);
        expect((err as TokenRefreshError).permanent).toBe(false);
        expect(d.lifecycle.tokenRefreshFailed).toHaveBeenCalledTimes(1);
        expect(d.prisma.oAuthToken.update).not.toHaveBeenCalled();
      });
    });
  }
});
