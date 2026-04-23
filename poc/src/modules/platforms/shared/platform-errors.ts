// Re-export surface. Canonical definitions live in `platform-adapter.port.ts`
// alongside the PlatformAdapter interface. This file exists so consumers can
// import errors from a dedicated file when that reads more cleanly.
export {
  TokenRevokedError,
  RateLimitedError,
  AdapterFetchError,
} from './platform-adapter.port';
