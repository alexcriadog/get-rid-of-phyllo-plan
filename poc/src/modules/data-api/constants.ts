// Mount prefix for the InsightIQ-compatible surface. The consumer's base URL
// becomes `https://<host>/<API_PREFIX>` and it appends `/v1/...` —
// so changing only the base URL + credentials switches them off InsightIQ.
// In production a dedicated host (e.g. api-compat.camaleonic.io) can rewrite
// to strip this prefix, giving the consumer a clean `/v1`.
export const API_PREFIX = "v1";
