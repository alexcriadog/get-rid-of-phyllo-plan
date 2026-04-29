// TikTok Business API v1.3 error classification.
// Verified codes:
//   0      success
//   40002  invalid params (one of the requested fields is unsupported)
//   40006  no schema found (path requires different shape/method)
//   40100  authentication failed (token expired/invalid)
//   40104  access_token is empty (header name wrong)
//   40105  rate limit exceeded
//   404    nginx-level path not found

export interface TikTokV13Error {
  code: number;
  message?: string;
  request_id?: string;
}

export function isOk(code: number | undefined): boolean {
  return code === 0;
}

export function isTokenError(code: number | undefined): boolean {
  return code === 40100 || code === 40104;
}

export function isQuotaError(code: number | undefined): boolean {
  return code === 40105;
}

export function extractTikTokError(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as {
      body?: { code?: number; message?: string; request_id?: string };
      message?: string;
    };
    const tk = e.body;
    if (tk && typeof tk.code === 'number') {
      const tag = `#${tk.code}`;
      const msg = tk.message ?? 'TikTok API error';
      return tk.request_id ? `(${tag} req=${tk.request_id}) ${msg}` : `(${tag}) ${msg}`;
    }
    if (typeof e.message === 'string') return e.message;
  }
  return String(err);
}
