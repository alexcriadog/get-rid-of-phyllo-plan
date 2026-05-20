/**
 * Camaleonic Connect SDK — v1.
 *
 * Embed:
 *   <script src="https://smconnector.camaleonicanalytics.com/connect-sdk.js"></script>
 *   <script>
 *     const handle = CamaleonicConnect.init({
 *       sdkToken: "<jwt minted server-side via POST /v1/sdk-tokens>",
 *       workspace: "<workspace slug, e.g. 'acme'>",
 *       platforms: ["twitch", "instagram"],   // optional whitelist
 *       onSuccess: (data) => console.log(data),
 *       onError:   (err)  => console.warn(err),
 *       onExit:    ()     => console.log("user closed"),
 *     });
 *     button.onclick = () => handle.open("twitch");
 *   </script>
 *
 * Or as an npm package:
 *   import CamaleonicConnect from "@camaleonic/connect";
 *
 * The popup talks to the hosted connect-ui at <baseUrl>. On success it
 * sends a postMessage { type, accountIds, platform } back to the opener;
 * we filter by `event.origin === baseUrl` so a tab loaded from somewhere
 * else can't spoof a success event.
 */

export type PlatformKey =
  | 'facebook'
  | 'instagram'
  | 'youtube'
  | 'tiktok'
  | 'threads'
  | 'twitch';

export interface SuccessPayload {
  accountIds: string[];
  platform: PlatformKey | null;
}

export interface ErrorPayload {
  code: 'popup_blocked' | 'invalid_platform' | 'unknown';
  message: string;
}

export interface CamaleonicConnectOptions {
  /** Ephemeral HS256 JWT minted via `POST /v1/sdk-tokens`. */
  sdkToken: string;
  /** Workspace slug — must match the slug claim in the SDK token. */
  workspace: string;
  /** Allow-list of platforms the popup may target. */
  platforms?: ReadonlyArray<PlatformKey>;
  /** Override the connect-ui origin. Defaults to the script's origin. */
  baseUrl?: string;
  onSuccess?: (data: SuccessPayload) => void;
  onError?: (err: ErrorPayload) => void;
  onExit?: () => void;
}

export interface CamaleonicConnectHandle {
  /** Open the popup. Pass a platform key to skip the chooser. */
  open: (platform?: PlatformKey) => void;
  /** Force-close the popup. */
  close: () => void;
}

const POPUP_WIDTH = 500;
const POPUP_HEIGHT = 700;
const MESSAGE_TYPE = 'camaleonic.connect.success';
const VERSION = '1.0.0';

function resolveBaseUrl(opts: CamaleonicConnectOptions): string {
  if (typeof opts.baseUrl === 'string' && opts.baseUrl.length > 0) {
    return opts.baseUrl.replace(/\/+$/, '');
  }
  try {
    const scripts = document.getElementsByTagName('script');
    for (let i = scripts.length - 1; i >= 0; i--) {
      const s = scripts[i];
      if (s.src && s.src.indexOf('connect-sdk.js') !== -1) {
        return new URL(s.src).origin;
      }
    }
  } catch {
    // fall through to window origin
  }
  return typeof window !== 'undefined' ? window.location.origin : '';
}

function buildPopupUrl(
  baseUrl: string,
  opts: CamaleonicConnectOptions,
  platform: PlatformKey | undefined,
): string {
  const qs =
    'ws=' +
    encodeURIComponent(opts.workspace) +
    '&token=' +
    encodeURIComponent(opts.sdkToken) +
    '&origin=' +
    encodeURIComponent(window.location.origin);
  if (platform) {
    return (
      baseUrl + '/api/oauth/start/' + encodeURIComponent(platform) + '?' + qs
    );
  }
  return baseUrl + '/?' + qs;
}

function centerFeatures(): string {
  const w = window;
  const dualScreenLeft =
    typeof w.screenLeft !== 'undefined' ? w.screenLeft : w.screenX || 0;
  const dualScreenTop =
    typeof w.screenTop !== 'undefined' ? w.screenTop : w.screenY || 0;
  const width =
    w.innerWidth ||
    (document.documentElement && document.documentElement.clientWidth) ||
    screen.width;
  const height =
    w.innerHeight ||
    (document.documentElement && document.documentElement.clientHeight) ||
    screen.height;
  const left = (width - POPUP_WIDTH) / 2 + dualScreenLeft;
  const top = (height - POPUP_HEIGHT) / 2 + dualScreenTop;
  return (
    'popup=yes,width=' +
    POPUP_WIDTH +
    ',height=' +
    POPUP_HEIGHT +
    ',top=' +
    top +
    ',left=' +
    left
  );
}

function requireOpt(
  opts: CamaleonicConnectOptions,
  key: 'sdkToken' | 'workspace',
): void {
  const v = opts[key];
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error(
      'CamaleonicConnect.init: missing option "' + String(key) + '"',
    );
  }
}

function init(opts: CamaleonicConnectOptions): CamaleonicConnectHandle {
  if (!opts || typeof opts !== 'object') {
    throw new Error('CamaleonicConnect.init: options object is required');
  }
  requireOpt(opts, 'sdkToken');
  requireOpt(opts, 'workspace');

  const baseUrl = resolveBaseUrl(opts);
  if (!baseUrl) {
    throw new Error('CamaleonicConnect.init: could not resolve baseUrl');
  }

  let popup: Window | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let messageListener: ((ev: MessageEvent) => void) | null = null;
  let lastPlatform: PlatformKey | undefined;
  let done = false;

  function cleanup(): void {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (messageListener) {
      window.removeEventListener('message', messageListener);
      messageListener = null;
    }
  }

  function close(): void {
    try {
      if (popup && !popup.closed) popup.close();
    } catch {
      // popup may be cross-origin; ignore
    }
    cleanup();
  }

  function emitError(code: ErrorPayload['code'], message: string): void {
    if (done) return;
    done = true;
    cleanup();
    if (typeof opts.onError === 'function') {
      try {
        opts.onError({ code, message });
      } catch {
        // swallow handler errors so we never explode the host app
      }
    }
  }

  function emitSuccess(payload: SuccessPayload): void {
    if (done) return;
    done = true;
    cleanup();
    if (typeof opts.onSuccess === 'function') {
      try {
        opts.onSuccess(payload);
      } catch {
        // swallow
      }
    }
  }

  function emitExit(): void {
    if (done) return;
    done = true;
    cleanup();
    if (typeof opts.onExit === 'function') {
      try {
        opts.onExit();
      } catch {
        // swallow
      }
    }
  }

  function open(platform?: PlatformKey): void {
    if (
      platform &&
      opts.platforms &&
      opts.platforms.length > 0 &&
      opts.platforms.indexOf(platform) === -1
    ) {
      emitError(
        'invalid_platform',
        'platform "' + platform + '" is not in the configured allow-list',
      );
      return;
    }

    lastPlatform = platform;
    done = false;

    const url = buildPopupUrl(baseUrl, opts, platform);
    popup = window.open(url, 'camaleonic-connect', centerFeatures());
    if (!popup) {
      emitError('popup_blocked', 'Browser blocked the connect popup');
      return;
    }

    messageListener = (ev: MessageEvent) => {
      // Strict origin check — only the hosted UI may signal success.
      if (ev.origin !== baseUrl) return;
      const data = ev.data as {
        type?: string;
        accountIds?: string[];
        platform?: PlatformKey;
      };
      if (!data || data.type !== MESSAGE_TYPE) return;
      emitSuccess({
        accountIds: Array.isArray(data.accountIds) ? data.accountIds : [],
        platform: data.platform ?? lastPlatform ?? null,
      });
      // Popup self-closes, but defensively close so a user-blocked
      // window.close() doesn't leak the window.
      setTimeout(close, 100);
    };
    window.addEventListener('message', messageListener);

    pollTimer = setInterval(() => {
      if (popup && popup.closed) emitExit();
    }, 600);
  }

  return { open, close };
}

export const version = VERSION;
export default { init, version };
export { init };
