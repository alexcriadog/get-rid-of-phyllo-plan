import axios from 'axios';
import { verifySdkToken } from '../../lib/oauth-context';
import { internalAuthHeader } from '../../lib/poc-internal';
import { sanitizeAccent } from '../../lib/css-color';
import { fetchConnections } from '../../lib/connections';
import { fetchWorkspaceProducts, offeredPlatforms } from '../../lib/workspace-config';
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
      { timeout: 5_000, proxy: false, validateStatus: () => true, headers: { ...internalAuthHeader() } },
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
  const theme: 'light' | 'dark' = first(sp.theme) === 'dark' ? 'dark' : 'light';

  if (!ws || !token) {
    return (
      <div className="v-canvas v-canvas--embed" data-theme={theme}>
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
  const productsConfig = await fetchWorkspaceProducts(ws);
  const offered = offeredPlatforms(productsConfig); // string[] | null
  // Gate #2 (UX): an iframe arrived with ?platform=X but the workspace's
  // configured platform set doesn't include X. Render an "unavailable" state
  // instead of consent → connections so the user never even sees a button
  // that would lead to provider OAuth.
  const platformUnavailable =
    !!platform && offered !== null && !offered.includes(platform);
  const connections = !error ? await fetchConnections(ws, endUserId) : [];

  const brandLogo =
    typeof branding?.logo_url === 'string' && /^https?:\/\//.test(branding.logo_url)
      ? branding.logo_url
      : null;
  const accent = sanitizeAccent(
    typeof branding?.primary_color === 'string' ? branding.primary_color : null,
  );

  return (
    <ConnectShell
      ws={ws}
      token={token}
      origin={origin ?? ''}
      fixedPlatform={platform}
      theme={theme}
      accent={accent}
      brandTitle={branding?.title ?? 'Camaleonic'}
      brandLogo={brandLogo}
      initialConnections={connections}
      tokenError={error}
      offeredPlatforms={offered}
      platformUnavailable={platformUnavailable}
    />
  );
}
