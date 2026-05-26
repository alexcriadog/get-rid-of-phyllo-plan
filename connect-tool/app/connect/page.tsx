import axios from 'axios';
import { verifySdkToken } from '../../lib/oauth-context';
import { fetchConnections } from '../../lib/connections';
import { ConnectShell } from './ConnectShell';
import { isPlatformKey, type PlatformKey } from './shell-machine';

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
  const rawPlatform = first(sp.platform);
  const platform: PlatformKey | undefined = isPlatformKey(rawPlatform) ? rawPlatform : undefined;

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
    console.error('[connect] sdk token verify failed:', e);
    error = 'This connect link is invalid or has expired. Restart from the app you came from.';
  }

  const branding = await fetchBranding(ws);
  const connections = !error ? await fetchConnections(ws, endUserId) : [];

  const brandLogo =
    typeof branding?.logo_url === 'string' && /^https?:\/\//.test(branding.logo_url)
      ? branding.logo_url
      : null;

  return (
    <ConnectShell
      ws={ws}
      token={token}
      origin={origin ?? ''}
      fixedPlatform={platform}
      brandTitle={branding?.title ?? 'Camaleonic'}
      brandLogo={brandLogo}
      initialConnections={connections}
      tokenError={error}
    />
  );
}
