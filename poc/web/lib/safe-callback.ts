/**
 * Only accept a same-origin relative path as the post-login target. Anything
 * absolute (`https://…`, `javascript:`) or protocol-relative (`//evil.com`) is
 * rejected to a safe default — prevents a `?callbackUrl=` open-redirect after
 * auth. Pure + unit-testable.
 */
export function safeCallback(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (
    typeof value === 'string' &&
    value.startsWith('/') &&
    !value.startsWith('//')
  ) {
    return value;
  }
  return '/showroom';
}
