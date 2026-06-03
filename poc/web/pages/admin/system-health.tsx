import { Database, Server, Activity } from 'lucide-react';
import { useLive, POLL } from '../../lib/useLive';
import AdminLayout from '../../components/AdminLayout';
import ScopeBadge from '../../components/ScopeBadge';
import { Section } from '@/components/admin/section';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { fmtRelative } from '../../lib/format';

/**
 * Full system-health detail. The same /admin/system/health payload powers
 * the always-visible header badge; this page is its drill-down — per-store
 * latency and the worker's last activity, so an operator can confirm which
 * dependency is degraded rather than reading a one-word summary.
 */
type StoreHealth = { ok: boolean; latency_ms: number | null; error?: string };

type SystemHealth = {
  mysql: StoreHealth;
  mongo: StoreHealth;
  redis: StoreHealth;
  worker: {
    last_attempt_at: string | null;
    idle_seconds: number | null;
    overdue_active_jobs?: number;
  };
  summary: 'ok' | 'warn' | 'danger';
};

const STORES: { key: 'mysql' | 'mongo' | 'redis'; label: string; icon: typeof Database }[] = [
  { key: 'mysql', label: 'MySQL', icon: Database },
  { key: 'mongo', label: 'MongoDB', icon: Database },
  { key: 'redis', label: 'Redis', icon: Server },
];

function StoreCard({
  label,
  icon: Icon,
  store,
}: {
  label: string;
  icon: typeof Database;
  store: StoreHealth | undefined;
}) {
  const ok = store?.ok ?? false;
  return (
    <Card>
      <CardContent className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">{label}</h3>
          </div>
          <Badge variant={ok ? 'ok' : 'danger'}>{ok ? 'up' : 'down'}</Badge>
        </div>
        <div className="font-mono text-2xl font-semibold">
          {store?.latency_ms != null ? `${store.latency_ms}ms` : '—'}
        </div>
        <p className="mt-1 text-[11px] uppercase tracking-wider text-muted-foreground">
          latency
        </p>
        {store?.error && <p className="mt-2 text-xs text-danger">{store.error}</p>}
      </CardContent>
    </Card>
  );
}

export default function SystemHealthPage() {
  const health = useLive<SystemHealth>('/admin/system/health', POLL.config);
  const h = health.data;

  const summaryVariant =
    h?.summary === 'ok' ? 'ok' : h?.summary === 'warn' ? 'warn' : 'danger';

  return (
    <AdminLayout title="System health">
      <ScopeBadge scope="global" reason="Infrastructure health spans the whole platform." />

      <div className="space-y-6">
        <Section title="Overall" description="Aggregate status across data stores and the worker.">
          <div className="flex items-center gap-3">
            <Badge variant={summaryVariant}>{(h?.summary ?? 'unknown').toUpperCase()}</Badge>
            {health.error && <span className="text-xs text-danger">{health.error}</span>}
          </div>
        </Section>

        <Section title="Data stores" description="Connectivity and round-trip latency.">
          <div className="grid gap-4 md:grid-cols-3">
            {STORES.map((s) => (
              <StoreCard key={s.key} label={s.label} icon={s.icon} store={h?.[s.key]} />
            ))}
          </div>
        </Section>

        <Section title="Worker" description="Last time the sync worker attempted a job.">
          <Card>
            <CardContent className="flex items-center gap-3 p-5">
              <Activity className="h-4 w-4 text-muted-foreground" />
              <div>
                <div className="text-sm">
                  {h?.worker.last_attempt_at
                    ? `Last attempt ${fmtRelative(h.worker.last_attempt_at)}`
                    : 'No attempts recorded'}
                </div>
                {h?.worker.idle_seconds != null && (
                  <div className="text-xs text-muted-foreground">idle {h.worker.idle_seconds}s</div>
                )}
                {h?.worker.overdue_active_jobs != null && (
                  <div
                    className={
                      h.worker.overdue_active_jobs > 0
                        ? 'text-xs text-danger'
                        : 'text-xs text-muted-foreground'
                    }
                  >
                    {h.worker.overdue_active_jobs > 0
                      ? `${h.worker.overdue_active_jobs} active job(s) overdue — worker/scheduler not draining`
                      : 'no active backlog'}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </Section>
      </div>
    </AdminLayout>
  );
}
