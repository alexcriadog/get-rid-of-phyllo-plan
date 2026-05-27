/**
 * Camaleonic Connect SDK — v2.
 *
 * Renders the connect flow as an in-page iframe modal (not a popup window).
 * Only the real provider login breaks out to its own window; the iframe
 * relays the result back and the modal shows confirm → success in place.
 *
 *   const handle = CamaleonicConnect.init({
 *     sdkToken: "<jwt>", workspace: "<slug>",
 *     platform: "tiktok",                 // optional — skip the chooser
 *     onSuccess, onError, onExit,
 *   });
 *   button.onclick = () => handle.open();  // or handle.open("tiktok")
 */

export type PlatformKey =
  | 'facebook' | 'instagram' | 'youtube' | 'tiktok' | 'threads' | 'twitch';

export interface SuccessPayload { accountIds: string[]; platform: PlatformKey | null; }
export interface ErrorPayload { code: 'popup_blocked' | 'invalid_platform' | 'token' | 'unknown'; message: string; }

export interface CamaleonicConnectOptions {
  sdkToken: string;
  workspace: string;
  /** Skip the chooser and start at this platform. */
  platform?: PlatformKey;
  /** Allow-list; if exactly one entry and no `platform`, treated as the single platform. */
  platforms?: ReadonlyArray<PlatformKey>;
  /** Colour theme. 'auto' (default) follows the host's prefers-color-scheme. */
  theme?: 'light' | 'dark' | 'auto';
  baseUrl?: string;
  onSuccess?: (data: SuccessPayload) => void;
  onError?: (err: ErrorPayload) => void;
  onExit?: () => void;
}

export interface CamaleonicConnectHandle {
  open: (platform?: PlatformKey) => void;
  close: () => void;
}

const VERSION = '2.0.0';
const MSG = {
  resize: 'camaleonic.connect.resize',
  exit: 'camaleonic.connect.exit',
  success: 'camaleonic.connect.success',
  error: 'camaleonic.connect.error',
} as const;
const DEFAULT_HEIGHT = 480;
const MODAL_WIDTH = 440;
const MIN_HEIGHT = 140;

function resolveTheme(opts: CamaleonicConnectOptions): 'light' | 'dark' {
  if (opts.theme === 'light' || opts.theme === 'dark') return opts.theme;
  try {
    if (typeof window !== 'undefined' && window.matchMedia &&
        window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
  } catch {
    /* ignore */
  }
  return 'light';
}
const SURFACE: Record<'light' | 'dark', string> = { light: '#ffffff', dark: '#1a1a1f' };
const CLOSE_FG: Record<'light' | 'dark', string> = { light: '#71717a', dark: '#a1a1aa' };
const CLOSE_BG: Record<'light' | 'dark', string> = { light: 'rgba(0,0,0,0.04)', dark: 'rgba(255,255,255,0.08)' };

function resolveBaseUrl(opts: CamaleonicConnectOptions): string {
  if (typeof opts.baseUrl === 'string' && opts.baseUrl.length > 0) {
    return opts.baseUrl.replace(/\/+$/, '');
  }
  try {
    const scripts = document.getElementsByTagName('script');
    for (let i = scripts.length - 1; i >= 0; i--) {
      const s = scripts[i];
      if (s.src && s.src.indexOf('connect-sdk.js') !== -1) return new URL(s.src).origin;
    }
  } catch {
    /* fall through */
  }
  return typeof window !== 'undefined' ? window.location.origin : '';
}

function requireOpt(opts: CamaleonicConnectOptions, key: 'sdkToken' | 'workspace'): void {
  const v = opts[key];
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error('CamaleonicConnect.init: missing option "' + String(key) + '"');
  }
}

function effectivePlatform(
  opts: CamaleonicConnectOptions,
  arg: PlatformKey | undefined,
): PlatformKey | undefined {
  if (arg) return arg;
  if (opts.platform) return opts.platform;
  if (opts.platforms && opts.platforms.length === 1) return opts.platforms[0];
  return undefined;
}

function buildConnectUrl(
  baseUrl: string,
  opts: CamaleonicConnectOptions,
  platform: PlatformKey | undefined,
): string {
  const qs = new URLSearchParams({
    ws: opts.workspace,
    token: opts.sdkToken,
    origin: window.location.origin,
    embed: '1',
  });
  if (platform) qs.set('platform', platform);
  qs.set('theme', resolveTheme(opts));
  return baseUrl + '/connect?' + qs.toString();
}

function init(opts: CamaleonicConnectOptions): CamaleonicConnectHandle {
  if (!opts || typeof opts !== 'object') {
    throw new Error('CamaleonicConnect.init: options object is required');
  }
  requireOpt(opts, 'sdkToken');
  requireOpt(opts, 'workspace');
  const baseUrl = resolveBaseUrl(opts);
  if (!baseUrl) throw new Error('CamaleonicConnect.init: could not resolve baseUrl');

  let overlay: HTMLDivElement | null = null;
  let modal: HTMLDivElement | null = null;
  let messageListener: ((ev: MessageEvent) => void) | null = null;
  let keyListener: ((ev: KeyboardEvent) => void) | null = null;
  let done = false;

  function teardown(): void {
    if (messageListener) { window.removeEventListener('message', messageListener); messageListener = null; }
    if (keyListener) { window.removeEventListener('keydown', keyListener); keyListener = null; }
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    overlay = null;
    modal = null;
  }

  function close(): void { teardown(); }

  function emitExit(): void {
    if (done) return;
    done = true;
    teardown();
    if (typeof opts.onExit === 'function') { try { opts.onExit(); } catch { /* swallow */ } }
  }
  function emitSuccess(p: SuccessPayload): void {
    if (done) return; done = true; teardown();
    if (typeof opts.onSuccess === 'function') { try { opts.onSuccess(p); } catch { /* swallow */ } }
  }
  function emitError(code: ErrorPayload['code'], message: string): void {
    if (done) return;
    if (typeof opts.onError === 'function') { try { opts.onError({ code, message }); } catch { /* swallow */ } }
  }

  function buildOverlay(url: string): void {
    const theme = resolveTheme(opts);

    overlay = document.createElement('div');
    overlay.setAttribute('data-camaleonic-overlay', '');
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;' +
      'justify-content:center;background:rgba(8,8,12,0.55);backdrop-filter:blur(3px);';

    modal = document.createElement('div');
    modal.setAttribute('data-camaleonic-modal', '');
    modal.style.cssText =
      'position:relative;width:' + MODAL_WIDTH + 'px;max-width:calc(100vw - 32px);' +
      'height:' + DEFAULT_HEIGHT + 'px;max-height:calc(100vh - 48px);' +
      'border-radius:18px;overflow:hidden;box-shadow:0 24px 70px rgba(0,0,0,0.35);background:' +
      SURFACE[theme] + ';';

    // Single, neutral close affordance owned by the modal chrome — present and
    // consistent on every screen (works even if the iframe fails to load).
    const closeBtn = document.createElement('button');
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.innerHTML = '&#10005;';
    const closeBg = CLOSE_BG[theme];
    const closeFg = CLOSE_FG[theme];
    closeBtn.style.cssText =
      'position:absolute;top:14px;right:14px;z-index:2;width:28px;height:28px;border:0;' +
      'border-radius:8px;background:transparent;color:' + closeFg + ';cursor:pointer;' +
      'font-size:13px;line-height:28px;text-align:center;padding:0;transition:background .15s;';
    closeBtn.onmouseenter = () => { closeBtn.style.background = closeBg; };
    closeBtn.onmouseleave = () => { closeBtn.style.background = 'transparent'; };
    closeBtn.onclick = () => emitExit();

    const iframe = document.createElement('iframe');
    iframe.src = url;
    iframe.title = 'Camaleonic Connect';
    iframe.allow = 'clipboard-write';
    iframe.style.cssText = 'width:100%;height:100%;border:0;display:block;';

    modal.appendChild(closeBtn);
    modal.appendChild(iframe);
    overlay.appendChild(modal);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) emitExit(); });
    document.body.appendChild(overlay);
  }

  function open(platform?: PlatformKey): void {
    if (overlay) return; // already open
    done = false;
    const plat = effectivePlatform(opts, platform);
    if (plat && opts.platforms && opts.platforms.length > 1 && opts.platforms.indexOf(plat) === -1) {
      emitError('invalid_platform', 'platform "' + plat + '" is not in the configured allow-list');
      return;
    }
    buildOverlay(buildConnectUrl(baseUrl, opts, plat));

    messageListener = (ev: MessageEvent) => {
      if (ev.origin !== baseUrl) return;
      const data = ev.data as { type?: string; height?: number; accountIds?: string[]; platform?: PlatformKey; code?: string; message?: string };
      if (!data || typeof data.type !== 'string') return;
      if (data.type === MSG.resize && modal && typeof data.height === 'number') {
        modal.style.height = Math.max(MIN_HEIGHT, data.height) + 'px';
      } else if (data.type === MSG.success) {
        emitSuccess({ accountIds: Array.isArray(data.accountIds) ? data.accountIds : [], platform: data.platform ?? plat ?? null });
      } else if (data.type === MSG.exit) {
        emitExit();
      } else if (data.type === MSG.error) {
        emitError((data.code as ErrorPayload['code']) ?? 'unknown', data.message ?? 'Connect error');
      }
    };
    window.addEventListener('message', messageListener);

    keyListener = (ev: KeyboardEvent) => { if (ev.key === 'Escape') emitExit(); };
    window.addEventListener('keydown', keyListener);
  }

  return { open, close };
}

export const version = VERSION;
export default { init, version };
export { init };
