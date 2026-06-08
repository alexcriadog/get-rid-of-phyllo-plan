// Mount prefix for the Phyllo-compatible surface. The consumer's base URL
// becomes `https://<host>/<PHYLLO_API_PREFIX>` and it appends `/v1/...` —
// so changing only the base URL + credentials switches them off Phyllo.
// In production a dedicated host (e.g. api-compat.camaleonic.io) can rewrite
// to strip this prefix, giving the consumer a clean `/v1`.
export const PHYLLO_API_PREFIX = "phyllo";
