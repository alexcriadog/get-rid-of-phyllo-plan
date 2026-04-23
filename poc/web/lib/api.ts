export const CONNECTOR_API_URL =
  process.env.NEXT_PUBLIC_CONNECTOR_API_URL ||
  process.env.CONNECTOR_API_URL ||
  'http://localhost:3000';

// Public-UI convenience wrappers.
export async function refreshAccount(accountId: string | number, products?: string[]): Promise<Response> {
  return fetch(`${CONNECTOR_API_URL}/v1/accounts/${accountId}/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ products: products ?? [] }),
  });
}

// Admin-UI helper — POSTs JSON bodies to any admin endpoint.
export async function adminPost<T = unknown>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${CONNECTOR_API_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} @ ${path}`);
  try {
    return (await res.json()) as T;
  } catch {
    return undefined as unknown as T;
  }
}

export async function adminPatch<T = unknown>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${CONNECTOR_API_URL}${path}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} @ ${path}`);
  try {
    return (await res.json()) as T;
  } catch {
    return undefined as unknown as T;
  }
}

export async function adminDelete<T = unknown>(path: string): Promise<T> {
  const res = await fetch(`${CONNECTOR_API_URL}${path}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} @ ${path}`);
  try {
    return (await res.json()) as T;
  } catch {
    return undefined as unknown as T;
  }
}
