import axios from 'axios';
import { verifySdkToken } from '../../lib/oauth-context';
import { fetchConnections } from '../../lib/connections';
import { ConnectShell } from './ConnectShell';
import type { PlatformKey } from './shell-machine';

export const dynamic = 'force-dynamic';

interface Branding { logo_url?: string; primary_color?: string; title?: string; }

function first(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return typeof v === 'string' ? v : undefined;
}

async function fetchBranding(slug: string): Promise<Branding | null> {
  const baseUrl = process.env.POC_API_URL;
  if (!baseUrl) return null;
  try {
    const res = await axios.get<{ branding: Branding | null }>(
      `${baseUrl}/internal/workspaces/${encodeURIComponent(slug)}/branding`,
      { timeout: 5_000, proxy: false, validateStatus: () => true },
    );
    return res.status === 200 ? res.data.branding : null;
  } catch {
    return null;
  }
}

export default async function ConnectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const ws = first(sp.ws);
  const token = first(sp.token);
  const origin = first(sp.origin);
  const platform = first(sp.platform) as PlatformKey | undefined;

  if (!ws || !token) {
    return (
      <div className="v-canvas v-canvas--embed">
        <div className="v-shell">
          <p className="v-body">Missing connect context. Restart from the app you came from.</p>
        </div>
      </div>
    );
  }

  let endUserId = '';
  let error: string | null = null;
  try {
    const claims = await verifySdkToken(token);
    endUserId = claims.sub;
  } catch (e) {
    error = e instanceof Error ? e.message : 'Invalid connect token';
  }

  const branding = await fetchBranding(ws);
  const connections = !error && platform ? await fetchConnections(ws, endUserId, platform) : [];

  return (
    <ConnectShell
      ws={ws}
      token={token}
      origin={origin ?? ''}
      fixedPlatform={platform}
      brandTitle={branding?.title ?? 'Camaleonic'}
      brandLogo={branding?.logo_url ?? null}
      initialConnections={connections}
      tokenError={error}
    />
  );
}
