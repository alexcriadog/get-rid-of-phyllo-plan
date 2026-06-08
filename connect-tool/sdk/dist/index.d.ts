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
export type PlatformKey = 'facebook' | 'instagram' | 'youtube' | 'tiktok' | 'threads' | 'twitch';
export interface SuccessPayload {
    accountIds: string[];
    platform: PlatformKey | null;
}
export interface ErrorPayload {
    code: 'popup_blocked' | 'invalid_platform' | 'token' | 'unknown';
    message: string;
}
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
declare function init(opts: CamaleonicConnectOptions): CamaleonicConnectHandle;
export declare const version = "2.0.0";
declare const _default: {
    init: typeof init;
    version: string;
};
export default _default;
export { init };
