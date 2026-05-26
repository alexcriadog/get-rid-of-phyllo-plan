import { describe, it, expect, beforeEach, vi } from 'vitest';
import CamaleonicConnect from './index';

const BASE = 'https://connect.example.com';

function initWith(extra: Record<string, unknown> = {}) {
  return CamaleonicConnect.init({ sdkToken: 'jwt', workspace: 'demo', baseUrl: BASE, ...extra });
}

describe('CamaleonicConnect iframe modal', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('injects an overlay with an iframe pointing at /connect (no window.open)', () => {
    const openSpy = vi.spyOn(window, 'open');
    initWith().open();
    const iframe = document.querySelector('iframe') as HTMLIFrameElement;
    expect(iframe).toBeTruthy();
    const url = new URL(iframe.src);
    expect(url.origin + url.pathname).toBe(`${BASE}/connect`);
    expect(url.searchParams.get('ws')).toBe('demo');
    expect(url.searchParams.get('token')).toBe('jwt');
    expect(url.searchParams.get('embed')).toBe('1');
    expect(url.searchParams.get('platform')).toBeNull();
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('passes a single platform from the init option (skip chooser)', () => {
    initWith({ platform: 'tiktok' }).open();
    const iframe = document.querySelector('iframe') as HTMLIFrameElement;
    expect(new URL(iframe.src).searchParams.get('platform')).toBe('tiktok');
  });

  it('infers single platform from a 1-entry platforms allow-list', () => {
    initWith({ platforms: ['twitch'] }).open();
    const iframe = document.querySelector('iframe') as HTMLIFrameElement;
    expect(new URL(iframe.src).searchParams.get('platform')).toBe('twitch');
  });

  it('open(platform) arg overrides the init option', () => {
    initWith({ platform: 'tiktok' }).open('youtube');
    const iframe = document.querySelector('iframe') as HTMLIFrameElement;
    expect(new URL(iframe.src).searchParams.get('platform')).toBe('youtube');
  });

  it('fires onSuccess and tears down on a success message from baseUrl', () => {
    const onSuccess = vi.fn();
    initWith({ onSuccess }).open();
    window.dispatchEvent(new MessageEvent('message', {
      origin: BASE,
      data: { type: 'camaleonic.connect.success', accountIds: ['14'], platform: 'tiktok' },
    }));
    expect(onSuccess).toHaveBeenCalledWith({ accountIds: ['14'], platform: 'tiktok' });
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('ignores messages from a foreign origin', () => {
    const onSuccess = vi.fn();
    initWith({ onSuccess }).open();
    window.dispatchEvent(new MessageEvent('message', {
      origin: 'https://evil.example.com',
      data: { type: 'camaleonic.connect.success', accountIds: ['x'], platform: 'tiktok' },
    }));
    expect(onSuccess).not.toHaveBeenCalled();
    expect(document.querySelector('iframe')).toBeTruthy();
  });

  it('resizes the modal on a resize message', () => {
    initWith().open();
    window.dispatchEvent(new MessageEvent('message', {
      origin: BASE, data: { type: 'camaleonic.connect.resize', height: 640 },
    }));
    const modal = document.querySelector('[data-camaleonic-modal]') as HTMLElement;
    expect(modal.style.height).toBe('640px');
  });

  it('fires onExit and tears down on exit message', () => {
    const onExit = vi.fn();
    initWith({ onExit }).open();
    window.dispatchEvent(new MessageEvent('message', { origin: BASE, data: { type: 'camaleonic.connect.exit' } }));
    expect(onExit).toHaveBeenCalled();
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('close() is idempotent', () => {
    const handle = initWith();
    handle.open();
    handle.close();
    handle.close();
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('relays an error message to onError and keeps the modal open (recoverable)', () => {
    const onError = vi.fn();
    initWith({ onError }).open();
    window.dispatchEvent(new MessageEvent('message', {
      origin: BASE,
      data: { type: 'camaleonic.connect.error', code: 'popup_blocked', message: 'blocked' },
    }));
    expect(onError).toHaveBeenCalledWith({ code: 'popup_blocked', message: 'blocked' });
    expect(document.querySelector('iframe')).toBeTruthy(); // modal stays for retry
  });

  it('calls onSuccess only once even if two success messages arrive', () => {
    const onSuccess = vi.fn();
    initWith({ onSuccess }).open();
    const fire = () => window.dispatchEvent(new MessageEvent('message', {
      origin: BASE, data: { type: 'camaleonic.connect.success', accountIds: ['1'], platform: 'tiktok' },
    }));
    fire(); fire();
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('fires onExit once when Escape is pressed', () => {
    const onExit = vi.fn();
    initWith({ onExit }).open();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(document.querySelector('iframe')).toBeNull();
  });
});
