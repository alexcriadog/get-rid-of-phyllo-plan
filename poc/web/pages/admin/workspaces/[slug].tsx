import { useEffect, useState } from 'react';
import type { GetServerSideProps } from 'next';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { ArrowLeft, Copy, KeyRound, Plus, Trash2, Webhook } from 'lucide-react';
import AdminLayout from '../../../components/AdminLayout';
import { useLive } from '../../../lib/useLive';
import { adminPatch, adminPost, CONNECTOR_API_URL } from '../../../lib/api';
import { fmtRelative } from '../../../lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Empty } from '@/components/admin/empty';

type ProductDef = {
  id: string;
  label: string;
  hint?: string;
  required?: boolean;
  default?: boolean;
  scopes: string[];
};
type CatalogResponse = {
  platforms: string[];
  products: string[];
  catalog: Record<string, ProductDef[]>;
};

type Cadence = 'immediate' | 'hourly' | 'daily';

type WorkspaceDetail = {
  id: string;
  slug: string;
  name: string;
  plan_tier: string;
  branding: Branding | null;
  products?: Record<string, string[]> | null;
  webhook_cadence?: Record<string, Cadence> | null;
  // Sec-4: origin allow-list. null/absent → no restriction (legacy behaviour).
  allowed_origins?: string[] | null;
  account_count: number;
  active_api_key_count: number;
  webhook_endpoint_count: number;
};

type Branding = {
  logo_url?: string;
  primary_color?: string;
  secondary_color?: string;
  accent_color?: string;
  font_family?: string;
  title?: string;
  subtitle?: string;
  hide_platforms?: string[];
};

type ApiKey = {
  id: string;
  key_prefix: string;
  scope: string;
  label: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

type WebhookEndpoint = {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  description: string | null;
  createdAt: string;
};

type PageProps = { catalog: CatalogResponse };

export default function WorkspaceDetail({ catalog }: PageProps) {
  const router = useRouter();
  const slug = typeof router.query.slug === 'string' ? router.query.slug : null;

  const ws = useLive<WorkspaceDetail>(slug ? `/admin/workspaces/${slug}` : null, 5000);
  const keys = useLive<ApiKey[]>(slug ? `/admin/workspaces/${slug}/api-keys` : null, 5000);
  const endpoints = useLive<WebhookEndpoint[]>(
    slug ? `/admin/workspaces/${slug}/webhook-endpoints` : null,
    5000,
  );

  if (!slug) return <AdminLayout title="Workspace">Loading…</AdminLayout>;

  return (
    <AdminLayout
      title={ws.data?.name ?? slug}
      actions={
        <Link href="/admin/workspaces">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </Button>
        </Link>
      }
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <BrandingSection slug={slug} ws={ws.data} onSaved={ws.refresh} />
        <ProductsSection slug={slug} ws={ws.data} catalog={catalog} onSaved={ws.refresh} />
        <SummarySection ws={ws.data} />
        <ApiKeysSection slug={slug} keys={keys.data ?? []} onChange={keys.refresh} />
        <WebhooksSection slug={slug} endpoints={endpoints.data ?? []} />
        <CadenceSection slug={slug} ws={ws.data} catalog={catalog} onSaved={ws.refresh} />
        <AllowedOriginsSection slug={slug} ws={ws.data} onSaved={ws.refresh} />
      </div>
    </AdminLayout>
  );
}

// SSR: pull the single-source-of-truth catalog from POC so the platforms ×
// products grid never drifts from what the OAuth flow actually computes
// scopes against.
//
// URL resolution differs from CONNECTOR_API_URL in lib/api.ts: that one is
// optimised for browser-side and prefers NEXT_PUBLIC_* (bakeable at build
// time), which points at the public domain. SSR runs inside the docker
// network and should hit api:3000 directly, so we prefer the server-only
// CONNECTOR_API_URL env (set on the web service to `http://api:3000`).
export const getServerSideProps: GetServerSideProps<PageProps> = async () => {
  const baseUrl =
    process.env.CONNECTOR_API_URL ||
    process.env.NEXT_PUBLIC_CONNECTOR_API_URL ||
    'http://localhost:3000';
  const url = `${baseUrl}/internal/products-catalog`;
  // /internal/* is a guarded service zone — present the shared service
  // bearer. SSR runs server-side so the secret never reaches the browser.
  const internalSecret = process.env.CONNECT_TOOL_SECRET;
  const res = await fetch(url, {
    headers: {
      accept: 'application/json',
      ...(internalSecret ? { authorization: `Bearer ${internalSecret}` } : {}),
    },
  });
  if (!res.ok) {
    throw new Error(
      `Failed to load products catalog from ${url}: ${res.status} ${res.statusText}`,
    );
  }
  const catalog = (await res.json()) as CatalogResponse;
  return { props: { catalog } };
};

// ─── Summary ───────────────────────────────────────────────────────────────

function SummarySection({ ws }: { ws: WorkspaceDetail | null }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Summary
        </div>
        <div className="grid grid-cols-3 gap-3">
          <SummaryStat label="Accounts" value={ws?.account_count ?? '—'} />
          <SummaryStat label="Active keys" value={ws?.active_api_key_count ?? '—'} />
          <SummaryStat label="Webhooks" value={ws?.webhook_endpoint_count ?? '—'} />
        </div>
        <div className="mt-3 text-xs">
          <span className="text-muted-foreground">Workspace id: </span>
          <code className="rounded bg-secondary/40 px-1.5 py-0.5 font-mono">{ws?.id}</code>
        </div>
        <div className="mt-1 text-xs">
          <span className="text-muted-foreground">Plan: </span>
          <Badge variant="default" className="capitalize">
            {ws?.plan_tier ?? '—'}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}

function SummaryStat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md border border-border/40 bg-secondary/30 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-mono text-lg">{value}</div>
    </div>
  );
}

// ─── Branding ──────────────────────────────────────────────────────────────

function BrandingSection({
  slug,
  ws,
  onSaved,
}: {
  slug: string;
  ws: WorkspaceDetail | null;
  onSaved: () => void;
}) {
  const b: Branding = ws?.branding ?? {};
  const [title, setTitle] = useState<string>('');
  const [subtitle, setSubtitle] = useState<string>('');
  const [primary, setPrimary] = useState<string>('');
  const [logo, setLogo] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Hydrate the form once the workspace loads (no useEffect because we
  // want to keep editing-state independent from the live poll loop).
  if (!busy && ws && title === '' && subtitle === '' && primary === '' && logo === '') {
    if (b.title) setTitle(b.title);
    if (b.subtitle) setSubtitle(b.subtitle);
    if (b.primary_color) setPrimary(b.primary_color);
    if (b.logo_url) setLogo(b.logo_url);
  }

  const onSave = async () => {
    setBusy(true);
    setErr(null);
    try {
      const payload: Branding = {};
      if (title.trim()) payload.title = title.trim();
      if (subtitle.trim()) payload.subtitle = subtitle.trim();
      if (primary.trim()) payload.primary_color = primary.trim();
      if (logo.trim()) payload.logo_url = logo.trim();
      await adminPatch(`/admin/workspaces/${slug}/branding`, payload);
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onClear = async () => {
    setBusy(true);
    setErr(null);
    try {
      await adminPatch(`/admin/workspaces/${slug}/branding`, {});
      setTitle('');
      setSubtitle('');
      setPrimary('');
      setLogo('');
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Branding
        </div>
        <Field label="Title">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Connect your account to ACME" />
        </Field>
        <Field label="Subtitle">
          <Input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} placeholder="One click, one token." />
        </Field>
        <Field label="Primary color (hex / css)">
          <Input value={primary} onChange={(e) => setPrimary(e.target.value)} placeholder="#3cffd0" />
        </Field>
        <Field label="Logo URL">
          <Input value={logo} onChange={(e) => setLogo(e.target.value)} placeholder="https://cdn.acme.com/logo.svg" />
        </Field>
        {err && <div className="text-sm text-danger">↯ {err}</div>}
        <div className="flex gap-2 pt-1">
          <Button size="sm" disabled={busy} onClick={onSave}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={onClear}>
            Clear branding
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

// ─── Allowed origins (Sec-4) ────────────────────────────────────────────────

// Normalise an admin-entered origin to scheme://host[:port]. Mirrors the
// server-side validator (workspace-origins.ts) so the UI rejects the same
// inputs the API would — fail fast, before the round-trip. Returns null on
// anything that isn't a bare http(s) origin.
function normalizeOriginInput(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    // Expression kept literally identical to the server-side mirrors
    // (workspace-origins.ts / origin-allowlist.ts) so the three can't drift.
    if (u.pathname !== '/' && u.pathname !== '') return null;
    if (u.search || u.hash || u.username || u.password) return null;
    if (u.hostname.endsWith('.')) return null;
    return u.origin;
  } catch {
    return null;
  }
}

function AllowedOriginsSection({
  slug,
  ws,
  onSaved,
}: {
  slug: string;
  ws: WorkspaceDetail | null;
  onSaved: () => void;
}) {
  const [origins, setOrigins] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Hydrate once from the live workspace (kept out of the poll loop, matching
  // the other editors on this page).
  if (!busy && !hydrated && ws) {
    setOrigins(ws.allowed_origins ?? []);
    setHydrated(true);
  }

  const add = () => {
    const normalized = normalizeOriginInput(draft);
    if (!normalized) {
      setErr('Enter a full origin like https://app.example.com (scheme + host, no path).');
      return;
    }
    setErr(null);
    setDraft('');
    if (!origins.includes(normalized)) setOrigins([...origins, normalized]);
  };

  const remove = (o: string) => setOrigins(origins.filter((x) => x !== o));

  const save = async (next: string[]) => {
    setBusy(true);
    setErr(null);
    try {
      await adminPatch(`/admin/workspaces/${slug}/allowed-origins`, next);
      setOrigins(next);
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Allowed origins
        </div>
        <p className="text-xs text-muted-foreground">
          Web origins permitted to embed the Connect SDK for this workspace. OAuth
          launches and results are only ever scoped to a listed origin. Empty = no
          restriction (the origin the SDK runs on is trusted as-is).
        </p>
        {origins.length > 0 ? (
          <div className="space-y-1.5">
            {origins.map((o) => (
              <div
                key={o}
                className="flex items-center justify-between rounded-md bg-secondary/20 px-2.5 py-1.5 text-xs"
              >
                <code className="flex-1 break-all font-mono">{o}</code>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => remove(o)}
                  aria-label={`Remove ${o}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs italic text-muted-foreground">
            No origins configured — no restriction applied.
          </div>
        )}
        <div className="flex gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
            placeholder="https://app.example.com"
          />
          <Button size="sm" variant="secondary" disabled={busy || !draft.trim()} onClick={add}>
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
        </div>
        {err && <div className="text-sm text-danger">↯ {err}</div>}
        <div className="flex gap-2 pt-1">
          <Button size="sm" disabled={busy} onClick={() => save(origins)}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => save([])}>
            Clear origins
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Products ─────────────────────────────────────────────────────────────

type PlatformState = {
  enabled: boolean;
  products: Record<string, boolean>;
};

function buildInitialState(
  ws: WorkspaceDetail | null,
  catalog: CatalogResponse,
): Record<string, PlatformState> {
  const saved = ws?.products ?? null;
  return Object.fromEntries(
    catalog.platforms.map((platform) => {
      const defs = catalog.catalog[platform];
      if (saved === null) {
        // No config saved yet — all platforms disabled by default in editor
        return [
          platform,
          { enabled: false, products: Object.fromEntries(defs.map((p) => [p.id, false])) },
        ];
      }
      const enabled = platform in saved;
      const savedProducts = saved[platform] ?? [];
      return [
        platform,
        {
          enabled,
          products: Object.fromEntries(
            defs.map((p) => [p.id, p.required ? true : savedProducts.includes(p.id)]),
          ),
        },
      ];
    }),
  );
}

function ProductsSection({
  slug,
  ws,
  catalog,
  onSaved,
}: {
  slug: string;
  ws: WorkspaceDetail | null;
  catalog: CatalogResponse;
  onSaved: () => void;
}) {
  const [state, setState] = useState<Record<string, PlatformState>>({});
  const [activeTab, setActiveTab] = useState<string>(catalog.platforms[0] ?? '');
  const [hydrated, setHydrated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Hydrate once when ws loads, mirror BrandingSection's guard pattern.
  // Default active tab to the first enabled platform so the operator lands
  // on a meaningful panel; fall back to the first catalog platform.
  if (!busy && ws && !hydrated) {
    const initial = buildInitialState(ws, catalog);
    setState(initial);
    const firstEnabled = catalog.platforms.find((p) => initial[p]?.enabled);
    setActiveTab(firstEnabled ?? catalog.platforms[0] ?? '');
    setHydrated(true);
  }

  const togglePlatform = (platform: string, enabled: boolean) => {
    setState((prev) => {
      if (!enabled) {
        // Disable: keep the products map intact so a re-enable restores
        // the prior selection.
        return { ...prev, [platform]: { ...prev[platform], enabled: false } };
      }
      // Enable: if nothing's currently checked (first time enabling, or
      // user had previously cleared everything), pre-select required +
      // default:true products from the catalog. If some products are
      // already checked, preserve that selection.
      const current = prev[platform]?.products ?? {};
      const anyChecked = Object.values(current).some(Boolean);
      if (anyChecked) {
        return { ...prev, [platform]: { ...prev[platform], enabled: true } };
      }
      const defs = catalog.catalog[platform] ?? [];
      const products = Object.fromEntries(
        defs.map((p) => [p.id, !!(p.required || p.default)]),
      );
      return { ...prev, [platform]: { enabled: true, products } };
    });
  };

  const toggleProduct = (platform: string, productId: string, checked: boolean) => {
    setState((prev) => ({
      ...prev,
      [platform]: {
        ...prev[platform],
        products: { ...prev[platform].products, [productId]: checked },
      },
    }));
  };

  const onSave = async () => {
    setBusy(true);
    setErr(null);
    try {
      // Include identity explicitly — server-side Zod schema requires every
      // enabled platform to list identity (it's the implicit minimum for
      // every account, but the wire format makes it explicit so the OAuth
      // scope computation can iterate over `products[platform]` directly).
      const payload: Record<string, string[]> = {};
      for (const [platform, ps] of Object.entries(state)) {
        if (!ps.enabled) continue;
        payload[platform] = Object.entries(ps.products)
          .filter(([, on]) => on)
          .map(([id]) => id);
      }
      await adminPatch(`/admin/workspaces/${slug}/products`, payload);
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onClear = async () => {
    setBusy(true);
    setErr(null);
    try {
      await adminPatch(`/admin/workspaces/${slug}/products`, {});
      setState(buildInitialState(null, catalog));
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const activePs = activeTab ? state[activeTab] : undefined;
  const activeDefs = activeTab ? (catalog.catalog[activeTab] ?? []) : [];
  const activeSelected = activePs
    ? activeDefs.filter((p) => p.required || activePs.products[p.id]).length
    : 0;

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Platforms &amp; Products
        </div>

        {/* Tab strip: one pill per platform. Enabled platforms get a filled
            dot + count; the active tab is highlighted. */}
        <div className="-mb-px flex flex-wrap gap-1 border-b border-border/40">
          {catalog.platforms.map((platform) => {
            const ps = state[platform];
            if (!ps) return null;
            const defs = catalog.catalog[platform] ?? [];
            const count = defs.filter(
              (p) => p.required || ps.products[p.id],
            ).length;
            const isActive = platform === activeTab;
            return (
              <button
                type="button"
                key={platform}
                onClick={() => setActiveTab(platform)}
                className={
                  'flex items-center gap-1.5 rounded-t-md border px-2.5 py-1 text-xs transition-colors ' +
                  (isActive
                    ? 'border-border/60 border-b-card bg-card text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground')
                }
              >
                <span
                  className={
                    'inline-block h-1.5 w-1.5 rounded-full ' +
                    (ps.enabled ? 'bg-primary' : 'bg-border')
                  }
                  aria-hidden
                />
                <span className="capitalize">{platform}</span>
                {ps.enabled && (
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {count}/{defs.length}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Active panel */}
        {activePs ? (
          <div className="min-h-[112px] space-y-2">
            <label className="flex cursor-pointer items-center justify-between gap-3 rounded-md bg-secondary/20 px-2.5 py-1.5">
              <span className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={activePs.enabled}
                  onChange={(e) => togglePlatform(activeTab, e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-border accent-primary"
                />
                <span className="text-sm font-medium">
                  Offer{' '}
                  <span className="capitalize">{activeTab}</span>
                </span>
              </span>
              {activePs.enabled && (
                <span className="font-mono text-[10px] text-muted-foreground">
                  {activeSelected}/{activeDefs.length} selected
                </span>
              )}
            </label>

            {activePs.enabled ? (
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 md:grid-cols-3">
                {activeDefs.map((product) => (
                  <label
                    key={product.id}
                    className={`flex items-center gap-1.5 text-xs ${product.required ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
                    title={product.hint}
                  >
                    <input
                      type="checkbox"
                      checked={
                        product.required
                          ? true
                          : (activePs.products[product.id] ?? false)
                      }
                      disabled={product.required}
                      onChange={(e) =>
                        toggleProduct(activeTab, product.id, e.target.checked)
                      }
                      className="h-3 w-3 rounded border-border accent-primary"
                    />
                    <span className="truncate">{product.label}</span>
                  </label>
                ))}
              </div>
            ) : (
              <div className="px-2 py-4 text-center text-xs text-muted-foreground">
                <span className="capitalize">{activeTab}</span> isn't offered
                to this workspace. Toggle &ldquo;Offer{' '}
                <span className="capitalize">{activeTab}</span>&rdquo; above
                to configure its products.
              </div>
            )}
          </div>
        ) : (
          <div className="px-2 py-4 text-center text-xs text-muted-foreground">
            Loading…
          </div>
        )}

        {err && <div className="text-sm text-danger">↯ {err}</div>}
        <div className="flex gap-2 pt-1">
          <Button size="sm" disabled={busy} onClick={onSave}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={onClear}>
            Clear products
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── API keys ──────────────────────────────────────────────────────────────

function ApiKeysSection({
  slug,
  keys,
  onChange,
}: {
  slug: string;
  keys: ApiKey[];
  onChange: () => void;
}) {
  const [env, setEnv] = useState<'live' | 'test'>('live');
  const [label, setLabel] = useState('');
  const [issued, setIssued] = useState<{ rawKey: string; prefix: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onIssue = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await adminPost<{ rawKey: string; prefix: string; id: string }>(
        `/admin/workspaces/${slug}/api-keys`,
        { environment: env, label: label.trim() || undefined },
      );
      setIssued({ rawKey: res.rawKey, prefix: res.prefix });
      setLabel('');
      onChange();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onRevoke = async (id: string) => {
    if (!confirm('Revoke this API key? The client will get 401 on the next call.')) return;
    await adminPost(`/admin/api-keys/${id}/revoke`, {});
    onChange();
  };

  return (
    <Card className="lg:col-span-2">
      <CardContent className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            API keys
          </div>
          <div className="flex items-center gap-2">
            <select
              value={env}
              onChange={(e) => setEnv(e.target.value as 'live' | 'test')}
              className="rounded border border-border bg-background px-2 py-1 text-xs"
            >
              <option value="live">live</option>
              <option value="test">test</option>
            </select>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="label (optional)"
              className="h-8 w-48"
            />
            <Button size="sm" disabled={busy} onClick={onIssue}>
              <Plus className="h-3.5 w-3.5" /> Issue
            </Button>
          </div>
        </div>

        {issued && (
          <div className="mb-3 rounded-md border border-warn/40 bg-warn/10 p-3">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-warn">
              Save this key now — it will never be shown again.
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 overflow-auto rounded bg-background/60 px-2 py-1.5 font-mono text-xs">
                {issued.rawKey}
              </code>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => navigator.clipboard.writeText(issued.rawKey)}
              >
                <Copy className="h-3.5 w-3.5" /> Copy
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setIssued(null)}>
                ✕
              </Button>
            </div>
          </div>
        )}

        {err && <div className="mb-3 text-sm text-danger">↯ {err}</div>}

        {keys.length === 0 ? (
          <Empty icon={<KeyRound className="h-6 w-6" />} message="No keys issued — click Issue to mint the first one." />
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="py-2">Prefix</th>
                  <th className="py-2">Label</th>
                  <th className="py-2">Scope</th>
                  <th className="py-2">Last used</th>
                  <th className="py-2">Created</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id} className="border-t border-border/40">
                    <td className="py-2 font-mono">{k.key_prefix}…</td>
                    <td className="py-2">{k.label ?? <span className="text-muted-foreground">—</span>}</td>
                    <td className="py-2">{k.scope}</td>
                    <td className="py-2 text-xs">{k.last_used_at ? fmtRelative(k.last_used_at) : '—'}</td>
                    <td className="py-2 text-xs">{fmtRelative(k.created_at)}</td>
                    <td className="py-2 text-right">
                      {k.revoked_at ? (
                        <Badge variant="default">revoked</Badge>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-danger hover:text-danger"
                          onClick={() => onRevoke(k.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" /> Revoke
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Webhook endpoints (read-only here; CRUD is the client's job via /v1) ──

type EndpointHealth = {
  endpoint_id: string;
  window_hours: number;
  total: number;
  delivered: number;
  failed: number;
  pending: number;
  abandoned: number;
  success_rate: number | null;
  avg_duration_ms: number | null;
  p95_duration_ms: number | null;
  last_delivery_at: string | null;
  last_success_at: string | null;
  consecutive_failures: number;
};

function WebhooksSection({
  slug,
  endpoints,
}: {
  slug: string;
  endpoints: WebhookEndpoint[];
}) {
  return (
    <Card className="lg:col-span-2">
      <CardContent className="p-4">
        <div className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Webhook endpoints
        </div>
        {endpoints.length === 0 ? (
          <Empty
            icon={<Webhook className="h-6 w-6" />}
            message="No webhook endpoints registered. Clients register their own via POST /v1/webhook-endpoints with their API key."
          />
        ) : (
          <div className="space-y-2">
            {endpoints.map((e) => (
              <EndpointRow key={e.id} slug={slug} endpoint={e} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EndpointRow({
  slug,
  endpoint,
}: {
  slug: string;
  endpoint: WebhookEndpoint;
}) {
  const [health, setHealth] = useState<EndpointHealth | null>(null);
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(
          `${CONNECTOR_API_URL}/admin/workspaces/${slug}/webhook-endpoints/${endpoint.id}/health`,
        );
        if (!res.ok) return;
        const json = (await res.json()) as EndpointHealth;
        if (!cancelled) setHealth(json);
      } catch {
        // best-effort — health is informational
      }
    };
    load();
    const t = setInterval(load, 15_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [slug, endpoint.id]);

  const sendTest = async () => {
    setSending(true);
    setFeedback(null);
    try {
      await adminPost(
        `/admin/workspaces/${slug}/webhook-endpoints/${endpoint.id}/test`,
      );
      setFeedback('test queued');
      setTimeout(() => setFeedback(null), 4000);
    } catch (e) {
      setFeedback(`failed: ${(e as Error).message}`);
    } finally {
      setSending(false);
    }
  };

  const failingHard = (health?.consecutive_failures ?? 0) >= 3;

  return (
    <div className="rounded-md border border-border/40 bg-secondary/30 p-3 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="break-all font-mono text-xs">{endpoint.url}</div>
          <div className="mt-1 flex flex-wrap gap-1">
            {endpoint.events.map((ev) => (
              <Badge key={ev} variant="default" className="text-[10px]">
                {ev}
              </Badge>
            ))}
          </div>
          {endpoint.description && (
            <div className="mt-1 text-xs text-muted-foreground">
              {endpoint.description}
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <Badge variant={endpoint.active ? 'ok' : 'default'}>
            {endpoint.active ? 'active' : 'inactive'}
          </Badge>
          <Button size="sm" variant="ghost" disabled={sending} onClick={sendTest}>
            {sending ? 'Sending…' : 'Send test'}
          </Button>
          {feedback && (
            <div className="text-[10px] text-muted-foreground">{feedback}</div>
          )}
        </div>
      </div>

      {/* Health rollup — last 24 h */}
      {health && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/40 pt-2 text-[11px] text-muted-foreground">
          <span>
            <span className="font-mono">24h:</span>{' '}
            <span className={failingHard ? 'text-danger' : 'text-foreground'}>
              {health.total > 0
                ? `${Math.round((health.success_rate ?? 0) * 100)}% ok`
                : 'no traffic'}
            </span>{' '}
            ({health.delivered}✓ {health.failed}↻ {health.abandoned}✕)
          </span>
          {health.last_delivery_at && (
            <span>
              last <span className="font-mono">{fmtRelative(health.last_delivery_at)}</span>
            </span>
          )}
          {health.avg_duration_ms != null && (
            <span>
              avg <span className="font-mono">{health.avg_duration_ms}ms</span>
              {health.p95_duration_ms != null && (
                <> · p95 <span className="font-mono">{health.p95_duration_ms}ms</span></>
              )}
            </span>
          )}
          {failingHard && (
            <Badge variant="danger">
              {health.consecutive_failures} consecutive failures
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Webhook delivery cadence (operator-set per-product) ──────────────────

// Products whose `data.<product>.updated` event is a snapshot rather than
// a list of new items. They always emit immediately regardless of cadence
// config (no items_added delta to digest), so the UI greys those rows out.
const SNAPSHOT_PRODUCTS: ReadonlySet<string> = new Set([
  'identity',
  'audience',
  'engagement_deep',
  'ratings',
  'ads',
]);
const CADENCES: Cadence[] = ['immediate', 'hourly', 'daily'];

function CadenceSection({
  slug,
  ws,
  catalog,
  onSaved,
}: {
  slug: string;
  ws: WorkspaceDetail | null;
  catalog: CatalogResponse;
  onSaved: () => void;
}) {
  const [state, setState] = useState<Record<string, Cadence>>({});
  const [hydrated, setHydrated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!busy && ws && !hydrated) {
    const initial: Record<string, Cadence> = {};
    for (const product of catalog.products) {
      const v = ws.webhook_cadence?.[product];
      initial[product] =
        v === 'hourly' || v === 'daily' ? v : 'immediate';
    }
    setState(initial);
    setHydrated(true);
  }

  const onChange = (product: string, cadence: Cadence) => {
    setState((prev) => ({ ...prev, [product]: cadence }));
  };

  const onSave = async () => {
    setBusy(true);
    setErr(null);
    try {
      // Send only non-default entries so the stored JSON stays compact.
      // Snapshot products are coerced to immediate server-side; sending
      // anything else for them is just noise.
      const payload: Record<string, Cadence> = {};
      for (const [product, cadence] of Object.entries(state)) {
        if (SNAPSHOT_PRODUCTS.has(product)) continue;
        if (cadence === 'immediate') continue;
        payload[product] = cadence;
      }
      await adminPatch(`/admin/workspaces/${slug}/webhook-cadence`, payload);
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onReset = async () => {
    setBusy(true);
    setErr(null);
    try {
      await adminPatch(`/admin/workspaces/${slug}/webhook-cadence`, {});
      const cleared: Record<string, Cadence> = {};
      for (const product of catalog.products) cleared[product] = 'immediate';
      setState(cleared);
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="lg:col-span-2">
      <CardContent className="space-y-3 p-4">
        <div>
          <div className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Webhook delivery cadence
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            How often <span className="font-mono">data.&lt;product&gt;.updated</span> events
            reach this workspace's webhook endpoints. Snapshot products
            (identity, audience, engagement_deep, ratings, ads) always
            fire immediately — only list products can be digested.
          </p>
        </div>

        <div className="overflow-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="py-1 pr-3">Product</th>
                {CADENCES.map((c) => (
                  <th key={c} className="py-1 px-2 text-center">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {catalog.products.map((product) => {
                const isSnapshot = SNAPSHOT_PRODUCTS.has(product);
                const current = isSnapshot ? 'immediate' : (state[product] ?? 'immediate');
                return (
                  <tr key={product} className="border-t border-border/30">
                    <td className="py-1.5 pr-3 font-mono">
                      {product}
                      {isSnapshot && (
                        <span className="ml-1 text-[9px] uppercase tracking-wider text-muted-foreground">
                          snapshot
                        </span>
                      )}
                    </td>
                    {CADENCES.map((c) => {
                      const disabled = isSnapshot && c !== 'immediate';
                      return (
                        <td key={c} className="py-1.5 px-2 text-center">
                          <input
                            type="radio"
                            name={`cad-${product}`}
                            checked={current === c}
                            disabled={disabled}
                            onChange={() => onChange(product, c)}
                            className="h-3 w-3 accent-primary disabled:opacity-30"
                            title={
                              disabled
                                ? 'snapshot products always fire immediately'
                                : undefined
                            }
                          />
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {err && <div className="text-sm text-danger">↯ {err}</div>}
        <div className="flex gap-2 pt-1">
          <Button size="sm" disabled={busy} onClick={onSave}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={onReset}>
            Reset all to immediate
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
