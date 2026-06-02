import { Logger } from '@nestjs/common';
import { subscribePageToApp } from '../meta-webhook-subscribe';

function makeDeps(post: jest.Mock) {
  const incr = jest.fn();
  const logger = new Logger('test');
  jest.spyOn(logger, 'log').mockImplementation(() => undefined);
  jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
  return { deps: { post, metrics: { incr }, logger }, incr };
}

describe('subscribePageToApp', () => {
  const base = {
    platform: 'facebook',
    pageId: '104574205378123',
    fields: ['feed', 'mentions'],
    accessToken: 'PAGE_TOKEN',
  };

  it('POSTs to subscribed_apps and counts success', async () => {
    const post = jest
      .fn()
      .mockResolvedValue({ status: 200, data: { success: true } });
    const { deps, incr } = makeDeps(post);

    const result = await subscribePageToApp(deps, base);

    expect(result).toEqual({ subscribed: true });
    expect(post).toHaveBeenCalledTimes(1);
    const [url, params] = post.mock.calls[0];
    expect(url).toContain('/104574205378123/subscribed_apps');
    expect(params.subscribed_fields).toBe('feed,mentions');
    expect(params.access_token).toBe('PAGE_TOKEN');
    expect(incr).toHaveBeenCalledWith('webhook_subscribe_ok', {
      platform: 'facebook',
    });
  });

  it('never throws on a Graph error; counts failure', async () => {
    const post = jest.fn().mockRejectedValue(new Error('boom'));
    const { deps, incr } = makeDeps(post);

    const result = await subscribePageToApp(deps, base);

    expect(result.subscribed).toBe(false);
    expect(result.error).toContain('boom');
    expect(incr).toHaveBeenCalledWith('webhook_subscribe_failed', {
      platform: 'facebook',
    });
  });

  it('treats a non-2xx status as failure (no throw)', async () => {
    const post = jest
      .fn()
      .mockResolvedValue({ status: 400, data: { error: { message: 'bad' } } });
    const { deps, incr } = makeDeps(post);

    const result = await subscribePageToApp(deps, base);

    expect(result.subscribed).toBe(false);
    expect(incr).toHaveBeenCalledWith('webhook_subscribe_failed', {
      platform: 'facebook',
    });
  });

  it('skips the call entirely when there are no fields', async () => {
    const post = jest.fn();
    const { deps, incr } = makeDeps(post);

    const result = await subscribePageToApp(deps, { ...base, fields: [] });

    expect(result).toEqual({ subscribed: false });
    expect(post).not.toHaveBeenCalled();
    expect(incr).not.toHaveBeenCalled();
  });
});
