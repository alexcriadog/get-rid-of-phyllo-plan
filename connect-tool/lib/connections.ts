import 'server-only';
import axios from 'axios';

export interface Connection {
  id: string;
  platform: string;
  handle: string | null;
  display_name: string | null;
  status: string;
  /** Optional — the POC internal accounts endpoint does not currently return this. */
  profile_image_url?: string | null;
}

/**
 * Fetch the end-user's existing accounts for a workspace (optionally one
 * platform) from POC's internal endpoint. Server-only — uses POC_API_URL,
 * which is reachable from the connect-ui server but never the browser.
 * Returns [] on any failure (the connections screen degrades gracefully).
 */
export async function fetchConnections(
  wsSlug: string,
  endUserId: string,
  platform?: string,
): Promise<Connection[]> {
  const baseUrl = process.env.POC_API_URL;
  if (!baseUrl) return [];
  try {
    const res = await axios.get<{ data: Connection[] }>(`${baseUrl}/internal/accounts`, {
      params: { ws_slug: wsSlug, end_user_id: endUserId, ...(platform ? { platform } : {}) },
      timeout: 5_000,
      proxy: false,
      validateStatus: () => true,
    });
    if (res.status !== 200) return [];
    return res.data.data ?? [];
  } catch {
    return [];
  }
}
