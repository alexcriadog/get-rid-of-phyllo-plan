import { useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { ArrowLeft, Copy, KeyRound, Plus, Trash2, Webhook } from 'lucide-react';
import AdminLayout from '../../../components/AdminLayout';
import { useLive } from '../../../lib/useLive';
import { adminPatch, adminPost } from '../../../lib/api';
import { fmtRelative } from '../../../lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Empty } from '@/components/admin/empty';

type WorkspaceDetail = {
  id: string;
  slug: string;
  name: string;
  plan_tier: string;
  branding: Branding | null;
  products?: Record<string, string[]> | null;
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

export default function WorkspaceDetail() {
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
        <ProductsSection slug={slug} ws={ws.data} onSaved={ws.refresh} />
        <SummarySection ws={ws.data} />
        <ApiKeysSection slug={slug} keys={keys.data ?? []} onChange={keys.refresh} />
        <WebhooksSection endpoints={endpoints.data ?? []} />
      </div>
    </AdminLayout>
  );
}

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

// ─── Products ─────────────────────────────────────────────────────────────

const PRODUCT_CATALOG: Record<string, { id: string; label: string }[]> = {
  facebook: [{ id: 'identity', label: 'Profile' }, { id: 'audience', label: 'Audience' }, { id: 'engagement_new', label: 'Posts + metrics' }, { id: 'stories', label: 'Stories' }, { id: 'mentions', label: 'Tagged posts' }, { id: 'comments', label: 'Comments' }, { id: 'ratings', label: 'Page reviews' }, { id: 'ads', label: 'Ad insights' }],
  instagram: [{ id: 'identity', label: 'Profile' }, { id: 'audience', label: 'Audience' }, { id: 'engagement_new', label: 'Posts + metrics' }, { id: 'stories', label: 'Stories' }],
  youtube: [{ id: 'identity', label: 'Profile' }, { id: 'audience', label: 'Audience' }, { id: 'engagement_new', label: 'Videos + metrics' }, { id: 'engagement_deep', label: 'Per-video analytics' }, { id: 'comments', label: 'Comments' }, { id: 'ads', label: 'Ad insights' }],
  tiktok: [{ id: 'identity', label: 'Profile' }, { id: 'audience', label: 'Audience' }, { id: 'engagement_new', label: 'Posts + metrics' }, { id: 'comments', label: 'Comments' }],
  threads: [{ id: 'identity', label: 'Profile' }, { id: 'audience', label: 'Audience' }, { id: 'engagement_new', label: 'Posts + metrics' }, { id: 'comments', label: 'Comments' }, { id: 'mentions', label: 'Mentions' }],
  twitch: [{ id: 'identity', label: 'Profile' }, { id: 'engagement_new', label: 'Streams + metrics' }],
};

type PlatformState = {
  enabled: boolean;
  products: Record<string, boolean>;
};

function buildInitialState(ws: WorkspaceDetail | null): Record<string, PlatformState> {
  const saved = ws?.products ?? null;
  return Object.fromEntries(
    Object.keys(PRODUCT_CATALOG).map((platform) => {
      const catalog = PRODUCT_CATALOG[platform];
      if (saved === null) {
        // No config saved yet — all platforms disabled by default in editor
        return [platform, { enabled: false, products: Object.fromEntries(catalog.map((p) => [p.id, false])) }];
      }
      const enabled = platform in saved;
      const savedProducts = saved[platform] ?? [];
      return [
        platform,
        {
          enabled,
          products: Object.fromEntries(
            catalog.map((p) => [p.id, p.id === 'identity' ? true : savedProducts.includes(p.id)]),
          ),
        },
      ];
    }),
  );
}

function ProductsSection({
  slug,
  ws,
  onSaved,
}: {
  slug: string;
  ws: WorkspaceDetail | null;
  onSaved: () => void;
}) {
  const [state, setState] = useState<Record<string, PlatformState>>({});
  const [hydrated, setHydrated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Hydrate once when ws loads, mirror BrandingSection's guard pattern
  if (!busy && ws && !hydrated) {
    setState(buildInitialState(ws));
    setHydrated(true);
  }

  const togglePlatform = (platform: string, enabled: boolean) => {
    setState((prev) => ({
      ...prev,
      [platform]: { ...prev[platform], enabled },
    }));
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
      const payload: Record<string, string[]> = {};
      for (const [platform, ps] of Object.entries(state)) {
        if (!ps.enabled) continue;
        payload[platform] = Object.entries(ps.products)
          .filter(([id, on]) => on && id !== 'identity')
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
      setState(buildInitialState(null));
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Platforms &amp; Products
        </div>
        {Object.keys(PRODUCT_CATALOG).map((platform) => {
          const ps = state[platform];
          if (!ps) return null;
          const catalog = PRODUCT_CATALOG[platform];
          return (
            <div key={platform} className="rounded-md border border-border/40 bg-secondary/20 p-3">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={ps.enabled}
                  onChange={(e) => togglePlatform(platform, e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-border accent-primary"
                />
                <span className="text-sm font-medium capitalize">{platform}</span>
              </label>
              {ps.enabled && (
                <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 pl-5">
                  {catalog.map((product) => (
                    <label
                      key={product.id}
                      className={`flex items-center gap-1.5 text-xs ${product.id === 'identity' ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
                    >
                      <input
                        type="checkbox"
                        checked={product.id === 'identity' ? true : (ps.products[product.id] ?? false)}
                        disabled={product.id === 'identity'}
                        onChange={(e) => toggleProduct(platform, product.id, e.target.checked)}
                        className="h-3 w-3 rounded border-border accent-primary"
                      />
                      {product.label}
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
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

function WebhooksSection({ endpoints }: { endpoints: WebhookEndpoint[] }) {
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
              <div
                key={e.id}
                className="flex items-start justify-between gap-3 rounded-md border border-border/40 bg-secondary/30 p-3 text-sm"
              >
                <div className="min-w-0">
                  <div className="break-all font-mono text-xs">{e.url}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {e.events.map((ev) => (
                      <Badge key={ev} variant="default" className="text-[10px]">
                        {ev}
                      </Badge>
                    ))}
                  </div>
                  {e.description && (
                    <div className="mt-1 text-xs text-muted-foreground">{e.description}</div>
                  )}
                </div>
                <div className="shrink-0">
                  <Badge variant={e.active ? 'ok' : 'default'}>
                    {e.active ? 'active' : 'inactive'}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
