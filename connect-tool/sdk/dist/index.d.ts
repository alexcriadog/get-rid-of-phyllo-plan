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
export type PlatformKey = 'facebook' | 'instagram' | 'youtube' | 'tiktok' | 'threads' | 'twitch';
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
declare function init(opts: CamaleonicConnectOptions): CamaleonicConnectHandle;
export declare const version = "1.0.0";
declare const _default: {
    init: typeof init;
    version: string;
};
export default _default;
export { init };
