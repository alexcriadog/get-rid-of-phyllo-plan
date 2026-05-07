// Public feed alias of `pages/index.tsx`.
// In production, `/` is owned by connect-tool (Caddy catchall), so the
// public feed needs a stable URL outside `/admin/*`. Reuses index's
// component + getServerSideProps verbatim.
export { default, getServerSideProps } from './index';
