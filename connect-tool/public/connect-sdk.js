/*!
 * Camaleonic Connect SDK — v1
 *
 * Embed:
 *   <script src="https://smconnector.camaleonicanalytics.com/connect-sdk.js"></script>
 *   <script>
 *     var handle = CamaleonicConnect.init({
 *       sdkToken: "<jwt minted server-side via POST /v1/sdk-tokens>",
 *       workspace: "<workspace slug, e.g. 'acme'>",
 *       platforms: ["twitch", "instagram"],       // optional whitelist
 *       baseUrl: "https://smconnector.camaleonicanalytics.com",
 *                                                  // optional, defaults to this script's origin
 *       onSuccess: function (data) { console.log(data); },
 *       onError:   function (err)  { console.warn(err); },
 *       onExit:    function ()     { console.log("user closed"); },
 *     });
 *     // Open from a click handler so popup-blockers don't bite.
 *     document.getElementById("connect-btn").onclick = function () {
 *       handle.open("twitch");        // or .open() to land on the chooser
 *     };
 *   </script>
 *
 * The popup talks to the hosted connect-ui at <baseUrl>. On success it
 * sends a postMessage { type: "camaleonic.connect.success", accountIds,
 * platform } back to the opener; we filter by origin === baseUrl so a
 * tab loaded from somewhere else can't spoof a success event.
 *
 * Distribution: served from the connect-ui's public/ folder so the SDK
 * URL has the same origin as the popup target. Pinned-version URLs come
 * once we wire a CDN.
 */
(function (global) {
  'use strict';

  if (global.CamaleonicConnect) return;

  var POPUP_WIDTH = 500;
  var POPUP_HEIGHT = 700;
  var MESSAGE_TYPE = 'camaleonic.connect.success';

  function resolveBaseUrl(opts) {
    if (opts && typeof opts.baseUrl === 'string' && opts.baseUrl.length > 0) {
      return opts.baseUrl.replace(/\/+$/, '');
    }
    // Discover the origin of the <script src> tag this file was loaded from.
    try {
      var scripts = document.getElementsByTagName('script');
      for (var i = scripts.length - 1; i >= 0; i--) {
        var s = scripts[i];
        if (s.src && s.src.indexOf('connect-sdk.js') !== -1) {
          var u = new URL(s.src);
          return u.origin;
        }
      }
    } catch (_e) {
      // Fall through to window origin.
    }
    return global.location && global.location.origin
      ? global.location.origin
      : '';
  }

  function buildPopupUrl(baseUrl, opts, platform) {
    var qs =
      'ws=' +
      encodeURIComponent(opts.workspace) +
      '&token=' +
      encodeURIComponent(opts.sdkToken) +
      '&origin=' +
      encodeURIComponent(global.location && global.location.origin);
    // /api/oauth/start/<platform> kicks off the authorize redirect. When no
    // platform is specified we land on the chooser at /?<qs> so the popup
    // shows the platform tiles.
    if (platform) {
      return baseUrl + '/api/oauth/start/' + encodeURIComponent(platform) + '?' + qs;
    }
    return baseUrl + '/?' + qs;
  }

  function centerFeatures() {
    var dualScreenLeft =
      typeof global.screenLeft !== 'undefined'
        ? global.screenLeft
        : global.screenX || 0;
    var dualScreenTop =
      typeof global.screenTop !== 'undefined'
        ? global.screenTop
        : global.screenY || 0;
    var width =
      global.innerWidth ||
      (global.document.documentElement && global.document.documentElement.clientWidth) ||
      global.screen.width;
    var height =
      global.innerHeight ||
      (global.document.documentElement && global.document.documentElement.clientHeight) ||
      global.screen.height;
    var left = (width - POPUP_WIDTH) / 2 + dualScreenLeft;
    var top = (height - POPUP_HEIGHT) / 2 + dualScreenTop;
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

  function requireOpt(opts, key) {
    if (typeof opts[key] !== 'string' || opts[key].length === 0) {
      throw new Error('CamaleonicConnect.init: missing option "' + key + '"');
    }
  }

  function init(opts) {
    opts = opts || {};
    requireOpt(opts, 'sdkToken');
    requireOpt(opts, 'workspace');

    var baseUrl = resolveBaseUrl(opts);
    if (!baseUrl) {
      throw new Error('CamaleonicConnect.init: could not resolve baseUrl');
    }

    var popup = null;
    var pollTimer = null;
    var messageListener = null;
    var done = false;

    function cleanup() {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      if (messageListener) {
        global.removeEventListener('message', messageListener);
        messageListener = null;
      }
    }

    function close() {
      try {
        if (popup && !popup.closed) popup.close();
      } catch (_e) {
        // window may be cross-origin; ignore.
      }
      cleanup();
    }

    function emitError(code, message) {
      if (done) return;
      done = true;
      cleanup();
      if (typeof opts.onError === 'function') {
        try {
          opts.onError({ code: code, message: message });
        } catch (_e) {
          // swallow client handler errors
        }
      }
    }

    function emitSuccess(payload) {
      if (done) return;
      done = true;
      cleanup();
      if (typeof opts.onSuccess === 'function') {
        try {
          opts.onSuccess(payload);
        } catch (_e) {
          // swallow client handler errors
        }
      }
    }

    function emitExit() {
      if (done) return;
      done = true;
      cleanup();
      if (typeof opts.onExit === 'function') {
        try {
          opts.onExit();
        } catch (_e) {
          // swallow client handler errors
        }
      }
    }

    function open(platform) {
      // Accept either a string platform key or an options object.
      if (platform && typeof platform === 'object') {
        platform = platform.platform;
      }
      if (opts.platforms && opts.platforms.length > 0 && platform) {
        if (opts.platforms.indexOf(platform) === -1) {
          throw new Error(
            'CamaleonicConnect.open: platform "' +
              platform +
              '" not in allow-list',
          );
        }
      }
      var url = buildPopupUrl(baseUrl, opts, platform);
      popup = global.open(url, 'camaleonic-connect', centerFeatures());
      if (!popup) {
        emitError('popup_blocked', 'Browser blocked the connect popup');
        return;
      }
      done = false;

      messageListener = function (ev) {
        // Strict origin check — only the hosted UI may signal success.
        if (ev.origin !== baseUrl) return;
        if (!ev.data || ev.data.type !== MESSAGE_TYPE) return;
        emitSuccess({
          accountIds: ev.data.accountIds || [],
          platform: ev.data.platform || platform || null,
        });
        // Popup will close itself, but we close defensively so a
        // user-blocked window.close still doesn't leak the window.
        setTimeout(close, 100);
      };
      global.addEventListener('message', messageListener);

      // Detect user-closes-the-popup-without-finishing.
      pollTimer = setInterval(function () {
        if (popup.closed) {
          emitExit();
        }
      }, 600);
    }

    return {
      open: open,
      close: close,
    };
  }

  global.CamaleonicConnect = { init: init, version: '1.0.0' };
})(typeof window !== 'undefined' ? window : this);
