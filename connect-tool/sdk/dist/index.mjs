/*! Camaleonic Connect SDK v2.0.0 — 2026-05-26 */

// sdk/src/index.ts
var VERSION = "2.0.0";
var MSG = {
  resize: "camaleonic.connect.resize",
  exit: "camaleonic.connect.exit",
  success: "camaleonic.connect.success",
  error: "camaleonic.connect.error"
};
var DEFAULT_HEIGHT = 480;
var MODAL_WIDTH = 440;
var MIN_HEIGHT = 140;
function resolveBaseUrl(opts) {
  if (typeof opts.baseUrl === "string" && opts.baseUrl.length > 0) {
    return opts.baseUrl.replace(/\/+$/, "");
  }
  try {
    const scripts = document.getElementsByTagName("script");
    for (let i = scripts.length - 1; i >= 0; i--) {
      const s = scripts[i];
      if (s.src && s.src.indexOf("connect-sdk.js") !== -1) return new URL(s.src).origin;
    }
  } catch {
  }
  return typeof window !== "undefined" ? window.location.origin : "";
}
function requireOpt(opts, key) {
  const v = opts[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new Error('CamaleonicConnect.init: missing option "' + String(key) + '"');
  }
}
function effectivePlatform(opts, arg) {
  if (arg) return arg;
  if (opts.platform) return opts.platform;
  if (opts.platforms && opts.platforms.length === 1) return opts.platforms[0];
  return void 0;
}
function buildConnectUrl(baseUrl, opts, platform) {
  const qs = new URLSearchParams({
    ws: opts.workspace,
    token: opts.sdkToken,
    origin: window.location.origin,
    embed: "1"
  });
  if (platform) qs.set("platform", platform);
  return baseUrl + "/connect?" + qs.toString();
}
function init(opts) {
  if (!opts || typeof opts !== "object") {
    throw new Error("CamaleonicConnect.init: options object is required");
  }
  requireOpt(opts, "sdkToken");
  requireOpt(opts, "workspace");
  const baseUrl = resolveBaseUrl(opts);
  if (!baseUrl) throw new Error("CamaleonicConnect.init: could not resolve baseUrl");
  let overlay = null;
  let modal = null;
  let messageListener = null;
  let keyListener = null;
  let done = false;
  function teardown() {
    if (messageListener) {
      window.removeEventListener("message", messageListener);
      messageListener = null;
    }
    if (keyListener) {
      window.removeEventListener("keydown", keyListener);
      keyListener = null;
    }
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    overlay = null;
    modal = null;
  }
  function close() {
    teardown();
  }
  function emitExit() {
    if (done) return;
    done = true;
    teardown();
    if (typeof opts.onExit === "function") {
      try {
        opts.onExit();
      } catch {
      }
    }
  }
  function emitSuccess(p) {
    if (done) return;
    done = true;
    teardown();
    if (typeof opts.onSuccess === "function") {
      try {
        opts.onSuccess(p);
      } catch {
      }
    }
  }
  function emitError(code, message) {
    if (done) return;
    if (typeof opts.onError === "function") {
      try {
        opts.onError({ code, message });
      } catch {
      }
    }
  }
  function buildOverlay(url) {
    overlay = document.createElement("div");
    overlay.setAttribute("data-camaleonic-overlay", "");
    overlay.style.cssText = "position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(8,8,12,0.6);backdrop-filter:blur(4px);";
    modal = document.createElement("div");
    modal.setAttribute("data-camaleonic-modal", "");
    modal.style.cssText = "position:relative;width:" + MODAL_WIDTH + "px;max-width:calc(100vw - 32px);height:" + DEFAULT_HEIGHT + "px;max-height:calc(100vh - 48px);border-radius:18px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,0.5);background:#fff;";
    const closeBtn = document.createElement("button");
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.textContent = "\u2715";
    closeBtn.style.cssText = "position:absolute;top:10px;right:10px;z-index:2;width:28px;height:28px;border:0;border-radius:50%;background:rgba(0,0,0,0.06);cursor:pointer;font-size:14px;line-height:28px;";
    closeBtn.onclick = () => emitExit();
    const iframe = document.createElement("iframe");
    iframe.src = url;
    iframe.title = "Camaleonic Connect";
    iframe.allow = "clipboard-write";
    iframe.style.cssText = "width:100%;height:100%;border:0;display:block;";
    modal.appendChild(closeBtn);
    modal.appendChild(iframe);
    overlay.appendChild(modal);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) emitExit();
    });
    document.body.appendChild(overlay);
  }
  function open(platform) {
    if (overlay) return;
    done = false;
    const plat = effectivePlatform(opts, platform);
    if (plat && opts.platforms && opts.platforms.length > 1 && opts.platforms.indexOf(plat) === -1) {
      emitError("invalid_platform", 'platform "' + plat + '" is not in the configured allow-list');
      return;
    }
    buildOverlay(buildConnectUrl(baseUrl, opts, plat));
    messageListener = (ev) => {
      if (ev.origin !== baseUrl) return;
      const data = ev.data;
      if (!data || typeof data.type !== "string") return;
      if (data.type === MSG.resize && modal && typeof data.height === "number") {
        modal.style.height = Math.max(MIN_HEIGHT, data.height) + "px";
      } else if (data.type === MSG.success) {
        emitSuccess({ accountIds: Array.isArray(data.accountIds) ? data.accountIds : [], platform: data.platform ?? plat ?? null });
      } else if (data.type === MSG.exit) {
        emitExit();
      } else if (data.type === MSG.error) {
        emitError(data.code ?? "unknown", data.message ?? "Connect error");
      }
    };
    window.addEventListener("message", messageListener);
    keyListener = (ev) => {
      if (ev.key === "Escape") emitExit();
    };
    window.addEventListener("keydown", keyListener);
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
