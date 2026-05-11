// Resolve the public base URL of this service.
//
// Order: PUBLIC_BASE_URL env → X-Forwarded headers → Host header →
// localhost fallback. Same logic as connect-tool/lib/seed-client.ts.

export function publicBaseUrl(
  headers: Record<string, string | string[] | undefined>,
): string {
  const fromEnv = process.env.PUBLIC_BASE_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  const proto = (headers['x-forwarded-proto'] as string | undefined) ?? 'http';
  const host =
    (headers['x-forwarded-host'] as string | undefined) ??
    (headers.host as string | undefined) ??
    'localhost:3003';
  return `${proto}://${host}`;
}
