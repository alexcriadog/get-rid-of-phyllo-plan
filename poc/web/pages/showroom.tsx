// Public operator path for the showroom. In prod, `/` is connect-tool's OAuth
// landing (Caddy catch-all), so the showroom is exposed at /showroom (Caddy
// `handle /showroom*` → web:3001). Reuses index's component + gSSP verbatim.
export { default, getServerSideProps } from './index';
