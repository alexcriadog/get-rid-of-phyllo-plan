import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Pause, Play, Plus, RefreshCw } from 'lucide-react';
import AdminLayout from '../../components/AdminLayout';
import { useLive } from '../../lib/useLive';
import { useWorkspaceFilter } from '../../lib/workspace-context';
import { adminPatch, adminPost } from '../../lib/api';
import { fmtRelative } from '../../lib/format';
import { Sparkline, STATUS_COLORS } from '../../components/charts';
import { Empty } from '@/components/admin/empty';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { orderProducts } from '@/lib/products';

type ProductHealth = {
  product?: string;
  last_success_at?: string | null;
  next_run_at?: string | null;
  failure_count?: number;
  freshness?: 'green' | 'yellow' | 'red';
  status?: string;
  last_error?: string | null;
  override_active?: boolean;
};

type AdminAccount = {
  id: number | string;
  platform: string;
  connection_flow?: string | null;
  handle?: string | null;
  display_name?: string | null;
  sync_tier?: string;
  status?: string;
  token_expires_at?: string | null;
  workspace_slug?: string | null;
  workspace_name?: string | null;
  products?: ProductHealth[] | Record<string, ProductHealth>;
  webhook?: {
    subscribed?: boolean;
    via_page?: string;
    fields?: string[];
    subscribed_at?: string;
    error?: string;
  };
};

type ApiCall = {
  called_at?: string;
  status_code?: number;
  account_id?: string | null;
};

const TIERS = ['vip', 'standard', 'lite', 'demo', 'paused'];
const PLATFORMS = ['all', 'instagram', 'facebook'];
const STATUSES = ['all', 'ready', 'paused', 'needs_reauth'];

export default function AccountsPage() {
  const router = useRouter();
  const { slug: wsSlug, withQuery } = useWorkspaceFilter();
  const { data, error, refresh } = useLive<AdminAccount[]>(
    withQuery('/admin/accounts'),
    5000,
  );
  const callsLive = useLive<ApiCall[]>(
    withQuery('/admin/api-calls?limit=500'),
    5000,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [platform, setPlatform] = useState('all');
  const [status, setStatus] = useState('all');

  const accounts = data ?? [];
  const calls = callsLive.data ?? [];

  const filtered = useMemo(() => {
    return accounts.filter((a) => {
      if (platform !== 'all' && a.platform !== platform) return false;
      if (status !== 'all') {
        const s = a.status ?? 'ready';
        if (s !== status) return false;
      }
      if (search) {
        const q = search.toLowerCase();
        const hay = `${a.handle ?? ''} ${a.display_name ?? ''} ${a.id}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [accounts, search, platform, status]);

  const callsByAccount = useMemo(() => {
    const map = new Map<string, ApiCall[]>();
    for (const c of calls) {
      if (!c.account_id) continue;
      const k = String(c.account_id);
      const arr = map.get(k) ?? [];
      arr.push(c);
      map.set(k, arr);
    }
    return map;
  }, [calls]);

  const call = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setErr(null);
    try {
      await fn();
      refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <AdminLayout
      title="Accounts"
      actions={
        <Button asChild size="sm">
          <Link href="/admin/connect">
            <Plus className="h-4 w-4" />
            Connect new
          </Link>
        </Button>
      }
    >
      {error && !data && (
        <div className="mb-5 rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}
      {err && (
        <div className="mb-5 rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
          {err}
        </div>
      )}

      {/* Filters */}
      <Card className="mb-5">
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <Input
            placeholder="Search handle, name, id…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 min-w-[220px] flex-1"
          />
          <FilterSelect
            label="Platform"
            value={platform}
            onChange={setPlatform}
            options={PLATFORMS}
          />
          <FilterSelect
            label="Status"
            value={status}
            onChange={setStatus}
            options={STATUSES}
          />
          <span className="ml-auto font-mono text-[10.5px] text-muted-foreground">
            {filtered.length} of {accounts.length}
          </span>
        </CardContent>
      </Card>

      {filtered.length === 0 ? (
        <Empty message="No accounts match these filters." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((a) => (
            <AccountCard
              key={String(a.id)}
              account={a}
              recentCalls={callsByAccount.get(String(a.id)) ?? []}
              busyKey={busy}
              showWorkspace={wsSlug == null}
              onRefresh={() =>
                // Route through /admin/next-runs?account=<id> so the
                // operator goes through the 2-step risk-check dialog
                // (target review → risk signals → confirm) instead of
                // a blind POST to refresh-now.
                router.push(`/admin/next-runs?account=${a.id}`)
              }
              onPause={() =>
                call(`pause:${a.id}`, () =>
                  adminPost(
                    `/admin/accounts/${a.id}/${a.status === 'paused' ? 'unpause' : 'pause'}`,
                    {},
                  ),
                )
              }
              onTier={(tier) =>
                call(`tier:${a.id}`, () =>
                  adminPatch(`/admin/accounts/${a.id}/sync-tier`, { tier }),
                )
              }
            />
          ))}
        </div>
      )}
    </AdminLayout>
  );
}

// ── Card ──────────────────────────────────────────────────────────────────

function AccountCard({
  account,
  recentCalls,
  busyKey,
  onRefresh,
  onPause,
  onTier,
  showWorkspace,
}: {
  account: AdminAccount;
  recentCalls: ApiCall[];
  busyKey: string | null;
  onRefresh: () => void;
  onPause: () => void;
  onTier: (t: string) => void;
  showWorkspace: boolean;
}) {
  const id = String(account.id);
  const products = normalizeProducts(account.products);
  const paused = account.status === 'paused' || account.sync_tier === 'paused';
  const needsReauth = account.status === 'needs_reauth';

  const sparkPoints = useMemo(() => buildSuccessSpark(recentCalls), [recentCalls]);
  const successPct = useMemo(() => {
    const cutoff = Date.now() - 24 * 3600_000;
    const recent = recentCalls.filter(
      (c) => c.called_at && new Date(c.called_at).getTime() >= cutoff,
    );
    if (!recent.length) return null;
    const ok = recent.filter(
      (c) =>
        typeof c.status_code === 'number' && c.status_code >= 200 && c.status_code < 300,
    ).length;
    return Math.round((ok / recent.length) * 100);
  }, [recentCalls]);

  const sparkColor =
    successPct == null
      ? STATUS_COLORS.muted
      : successPct >= 95
        ? STATUS_COLORS.ok
        : successPct >= 80
          ? STATUS_COLORS.warn
          : STATUS_COLORS.danger;

  return (
    <Card
      className={cn(
        'flex flex-col gap-4 p-5 transition-opacity hover:bg-accent/30',
        paused && 'opacity-70',
        needsReauth && 'ring-1 ring-danger/40',
      )}
    >
      <div className="flex items-center gap-3">
        <Avatar
          handle={account.handle ?? account.display_name ?? `#${id}`}
          platform={account.platform}
        />
        <div className="min-w-0 flex-1">
          <Link
            href={`/admin/accounts/${id}`}
            className="block truncate text-sm font-semibold text-foreground hover:text-primary"
          >
            {account.handle || account.display_name || `Account ${id}`}
          </Link>
          <div className="font-mono text-[10.5px] text-muted-foreground/70">
            {account.platform} · #{id}
            {(account.connection_flow === 'ig_direct' ||
              account.connection_flow === 'fb_login') && (
              <span
                title={
                  account.connection_flow === 'ig_direct'
                    ? 'Instagram Login (IG-direct)'
                    : 'Facebook Login'
                }
                className="ml-2 inline-flex items-center rounded-full border border-border/80 bg-card/60 px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-wider text-muted-foreground"
              >
                {account.connection_flow === 'ig_direct' ? 'IG Login' : 'FB Login'}
              </span>
            )}
            {showWorkspace && account.workspace_slug && (
              <span className="ml-2 inline-flex items-center rounded-full border border-border/80 bg-card/60 px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-wider text-muted-foreground">
                {account.workspace_slug}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {needsReauth && (
            <Badge
              variant="danger"
              className="gap-1 px-2 py-0.5 text-[10px] tracking-wider"
              title="Platform rejected the access token. Re-OAuth from /admin/connect."
            >
              ↺ NEEDS REAUTH
            </Badge>
          )}
          {(account.platform === 'facebook' ||
            account.platform === 'instagram') &&
            (account.webhook?.subscribed ? (
              <Badge
                variant="ok"
                className="gap-1 px-2 py-0.5 text-[10px] tracking-wider"
                title={
                  account.webhook.via_page
                    ? `Webhooks delivered via Page ${account.webhook.via_page}`
                    : `Subscribed fields: ${(account.webhook.fields ?? []).join(', ') || '—'}${
                        account.webhook.subscribed_at
                          ? ` · since ${new Date(account.webhook.subscribed_at).toLocaleString()}`
                          : ''
                      }`
                }
              >
                🔔 WEBHOOKS
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="gap-1 px-2 py-0.5 text-[10px] tracking-wider opacity-70"
                title={
                  account.webhook?.error
                    ? `Last subscribe error: ${account.webhook.error}`
                    : 'Not subscribed — reconnect from /admin/connect to enable webhooks'
                }
              >
                🔕 NO WEBHOOK
              </Badge>
            ))}
          <Badge variant={paused ? 'danger' : 'ok'}>{account.sync_tier ?? '—'}</Badge>
        </div>
      </div>

      {/* Show this account's ACTUAL enrolled products (varies per account, and
          now per connection via the SDK token's products scope) rather than a
          fixed list — so a basic identity-only account doesn't render phantom
          "missing" pills, and ads / comments / engagement_deep show when present. */}
      {orderProducts(products.keys()).length > 0 && (
        <div className="grid grid-cols-4 gap-1.5">
          {orderProducts(products.keys()).map((p) => (
            <ProductPill
              key={p}
              product={p}
              health={products.get(p)}
              paused={paused || needsReauth}
            />
          ))}
        </div>
      )}

      <div>
        <div className="mb-1 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70">
          <span>Success rate · 24h</span>
          <span style={{ color: sparkColor }}>
            {successPct == null ? '—' : `${successPct}%`}
          </span>
        </div>
        <Sparkline points={sparkPoints} color={sparkColor} height={36} />
      </div>

      <div className="flex items-center gap-3 font-mono text-[11px] text-muted-foreground">
        <span>
          token: <TokenBadge at={account.token_expires_at ?? null} />
        </span>
      </div>

      <div className="mt-auto flex items-center gap-2">
        <Button asChild variant="outline" size="sm" className="flex-1">
          <Link href={`/admin/accounts/${id}`}>Open detail →</Link>
        </Button>
        <Button
          variant="outline"
          size="icon"
          onClick={onRefresh}
          disabled={busyKey === `refresh:${id}`}
          title="Refresh now (all products)"
          className="h-8 w-8"
        >
          {busyKey === `refresh:${id}` ? (
            <span className="text-xs">…</span>
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
        </Button>
        <Button
          variant="outline"
          size="icon"
          onClick={onPause}
          disabled={busyKey === `pause:${id}`}
          title={paused ? 'Unpause' : 'Pause'}
          className="h-8 w-8"
        >
          {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
        </Button>
        <Select
          value={account.sync_tier ?? 'standard'}
          onValueChange={onTier}
          disabled={busyKey === `tier:${id}`}
        >
          <SelectTrigger className="h-8 w-[96px] font-mono text-xs" title="Sync tier">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIERS.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </Card>
  );
}

function ProductPill({
  product,
  health,
  paused,
}: {
  product: string;
  health: ProductHealth | undefined;
  paused: boolean;
}) {
  let tone: 'ok' | 'warn' | 'danger' | 'muted' = 'muted';
  let label = '—';
  if (paused) {
    tone = 'muted';
    label = 'paused';
  } else if (!health) {
    tone = 'muted';
    label = 'n/a';
  } else if ((health.failure_count ?? 0) >= 3) {
    tone = 'danger';
    label = `${health.failure_count} fails`;
  } else if (health.freshness === 'green') {
    tone = 'ok';
    label = fmtRelative(health.last_success_at);
  } else if (health.freshness === 'yellow') {
    tone = 'warn';
    label = fmtRelative(health.last_success_at);
  } else if (health.last_success_at) {
    tone = 'warn';
    label = fmtRelative(health.last_success_at);
  } else {
    tone = 'danger';
    label = 'never';
  }
  const color = STATUS_COLORS[tone];
  return (
    <div
      title={health?.last_error ?? ''}
      className="flex flex-col items-center gap-1 rounded-md border bg-secondary/40 px-1 py-1.5"
      style={{ borderColor: `${color}33` }}
    >
      <span className="font-mono text-[9px] uppercase tracking-[0.06em] text-muted-foreground/70">
        {product.replace('_', ' ').slice(0, 4)}
      </span>
      <span
        className="h-2 w-2 rounded-full"
        style={{ background: color, boxShadow: `0 0 6px ${color}` }}
      />
      <span className="max-w-full truncate font-mono text-[9px] text-muted-foreground">
        {label}
      </span>
    </div>
  );
}

function Avatar({ handle, platform }: { handle: string; platform: string }) {
  const accent =
    platform === 'instagram'
      ? 'bg-pink-400'
      : platform === 'facebook'
        ? 'bg-primary'
        : 'bg-emerald-400';
  const initial = handle.replace(/^@/, '').charAt(0).toUpperCase() || '?';
  return (
    <div
      className={cn(
        'grid h-10 w-10 shrink-0 place-items-center rounded-full text-base font-bold text-black',
        accent,
      )}
    >
      {initial}
    </div>
  );
}

function TokenBadge({ at }: { at: string | null }) {
  if (!at) return <span className="text-muted-foreground/60">—</span>;
  const ms = new Date(at).getTime() - Date.now();
  const days = Math.floor(ms / 86_400_000);
  if (days < 0) return <span className="text-danger">expired</span>;
  if (days < 7) return <span className="text-warn">{days}d</span>;
  return <span>{days}d</span>;
}

function FilterSelect({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  label: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-9 w-[140px] font-mono text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o} value={o}>
              {o}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────

function normalizeProducts(
  raw: AdminAccount['products'],
): Map<string, ProductHealth> {
  const m = new Map<string, ProductHealth>();
  if (!raw) return m;
  if (Array.isArray(raw)) {
    for (const p of raw) {
      if (p.product) m.set(p.product, p);
    }
  } else {
    for (const [k, v] of Object.entries(raw)) {
      m.set(k, v);
    }
  }
  return m;
}

function buildSuccessSpark(calls: ApiCall[]) {
  const now = Date.now();
  const start = now - 24 * 3600_000;
  const buckets: Array<{ ts: number; ok: number; total: number }> = [];
  for (let i = 0; i < 24; i++) {
    buckets.push({ ts: start + i * 3600_000, ok: 0, total: 0 });
  }
  for (const c of calls) {
    if (!c.called_at) continue;
    const t = new Date(c.called_at).getTime();
    if (t < start || t > now) continue;
    const idx = Math.floor((t - start) / 3600_000);
    if (idx < 0 || idx >= buckets.length) continue;
    buckets[idx].total += 1;
    if (
      typeof c.status_code === 'number' &&
      c.status_code >= 200 &&
      c.status_code < 300
    ) {
      buckets[idx].ok += 1;
    }
  }
  return buckets.map((b) => ({
    x: b.ts,
    y: b.total === 0 ? 100 : Math.round((b.ok / b.total) * 100),
  }));
}
