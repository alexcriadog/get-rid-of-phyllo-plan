// Authentication for POC `/internal/*` calls.
//
// The POC `/internal/*` endpoints (sdk-tokens/verify, workspaces/branding,
// accounts, products-catalog) are an INTERNAL service zone: only trusted
// server-side services (this connect-tool, the admin web app) may call
// them, never a browser. POC enforces this with a guard that requires
// `Authorization: Bearer <CONNECT_TOOL_SECRET>` on every /internal route.
//
// Centralising the header here means every current and future internal
// call is authenticated consistently — add new /internal calls via this
// helper and they are protected by construction. If the secret is unset
// (local dev without a configured secret) we send no header and POC's
// guard runs in its permissive dev mode.
export function internalAuthHeader(): Record<string, string> {
  const secret = process.env.CONNECT_TOOL_SECRET;
  return secret ? { authorization: `Bearer ${secret}` } : {};
}
