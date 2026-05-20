/*! Camaleonic Connect SDK v1.0.0 — 2026-05-20 */

// sdk/src/index.ts
var POPUP_WIDTH = 500;
var POPUP_HEIGHT = 700;
var MESSAGE_TYPE = "camaleonic.connect.success";
var VERSION = "1.0.0";
function resolveBaseUrl(opts) {
  if (typeof opts.baseUrl === "string" && opts.baseUrl.length > 0) {
    return opts.baseUrl.replace(/\/+$/, "");
  }
  try {
    const scripts = document.getElementsByTagName("script");
    for (let i = scripts.length - 1; i >= 0; i--) {
      const s = scripts[i];
      if (s.src && s.src.indexOf("connect-sdk.js") !== -1) {
        return new URL(s.src).origin;
      }
    }
  } catch {
  }
  return typeof window !== "undefined" ? window.location.origin : "";
}
function buildPopupUrl(baseUrl, opts, platform) {
  const qs = "ws=" + encodeURIComponent(opts.workspace) + "&token=" + encodeURIComponent(opts.sdkToken) + "&origin=" + encodeURIComponent(window.location.origin);
  if (platform) {
    return baseUrl + "/api/oauth/start/" + encodeURIComponent(platform) + "?" + qs;
  }
  return baseUrl + "/?" + qs;
}
function centerFeatures() {
  const w = window;
  const dualScreenLeft = typeof w.screenLeft !== "undefined" ? w.screenLeft : w.screenX || 0;
  const dualScreenTop = typeof w.screenTop !== "undefined" ? w.screenTop : w.screenY || 0;
  const width = w.innerWidth || document.documentElement && document.documentElement.clientWidth || screen.width;
  const height = w.innerHeight || document.documentElement && document.documentElement.clientHeight || screen.height;
  const left = (width - POPUP_WIDTH) / 2 + dualScreenLeft;
  const top = (height - POPUP_HEIGHT) / 2 + dualScreenTop;
  return "popup=yes,width=" + POPUP_WIDTH + ",height=" + POPUP_HEIGHT + ",top=" + top + ",left=" + left;
}
function requireOpt(opts, key) {
  const v = opts[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(
      'CamaleonicConnect.init: missing option "' + String(key) + '"'
    );
  }
}
function init(opts) {
  if (!opts || typeof opts !== "object") {
    throw new Error("CamaleonicConnect.init: options object is required");
  }
  requireOpt(opts, "sdkToken");
  requireOpt(opts, "workspace");
  const baseUrl = resolveBaseUrl(opts);
  if (!baseUrl) {
    throw new Error("CamaleonicConnect.init: could not resolve baseUrl");
  }
  let popup = null;
  let pollTimer = null;
  let messageListener = null;
  let lastPlatform;
  let done = false;
  function cleanup() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (messageListener) {
      window.removeEventListener("message", messageListener);
      messageListener = null;
    }
  }
  function close() {
    try {
      if (popup && !popup.closed) popup.close();
    } catch {
    }
    cleanup();
  }
  function emitError(code, message) {
    if (done) return;
    done = true;
    cleanup();
    if (typeof opts.onError === "function") {
      try {
        opts.onError({ code, message });
      } catch {
      }
    }
  }
  function emitSuccess(payload) {
    if (done) return;
    done = true;
    cleanup();
    if (typeof opts.onSuccess === "function") {
      try {
        opts.onSuccess(payload);
      } catch {
      }
    }
  }
  function emitExit() {
    if (done) return;
    done = true;
    cleanup();
    if (typeof opts.onExit === "function") {
      try {
        opts.onExit();
      } catch {
      }
    }
  }
  function open(platform) {
    if (platform && opts.platforms && opts.platforms.length > 0 && opts.platforms.indexOf(platform) === -1) {
      emitError(
        "invalid_platform",
        'platform "' + platform + '" is not in the configured allow-list'
      );
      return;
    }
    lastPlatform = platform;
    done = false;
    const url = buildPopupUrl(baseUrl, opts, platform);
    popup = window.open(url, "camaleonic-connect", centerFeatures());
    if (!popup) {
      emitError("popup_blocked", "Browser blocked the connect popup");
      return;
    }
    messageListener = (ev) => {
      if (ev.origin !== baseUrl) return;
      const data = ev.data;
      if (!data || data.type !== MESSAGE_TYPE) return;
      emitSuccess({
        accountIds: Array.isArray(data.accountIds) ? data.accountIds : [],
        platform: data.platform ?? lastPlatform ?? null
      });
      setTimeout(close, 100);
    };
    window.addEventListener("message", messageListener);
    pollTimer = setInterval(() => {
      if (popup && popup.closed) emitExit();
    }, 600);
  }
  return { open, close };
}
var version = VERSION;
var index_default = { init, version };
export {
  index_default as default,
  init,
  version
};
