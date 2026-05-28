import { useMemo, useState, useEffect } from 'react';
import { Send, X, RefreshCcw } from 'lucide-react';
import AdminLayout from '../../components/AdminLayout';
import { useLive } from '../../lib/useLive';
import { fmtRelative } from '../../lib/format';
import { adminPost, CONNECTOR_API_URL } from '../../lib/api';
import { Empty } from '@/components/admin/empty';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

type Delivery = {
  id: string;
  endpoint_id: string;
  endpoint_url: string;
  workspace_slug: string;
  event: string;
  status: string;
  attempts: number;
  last_response_code: number | null;
  last_error: string | null;
  next_retry_at: string | null;
  created_at: string;
  delivered_at: string | null;
};

type DeliveryDetail = Delivery & {
  workspace_name?: string;
  payload: unknown;
  response_body: string | null;
  response_headers: Record<string, unknown> | null;
  duration_ms: number | null;
};

const STATUSES = ['all', 'pending', 'delivered', 'failed', 'abandoned'];

export default function WebhookDeliveriesPage() {
  const [workspace, setWorkspace] = useState('');
  const [status, setStatus] = useState('all');
  const [event, setEvent] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (workspace.trim()) params.set('workspace', workspace.trim());
    if (status && status !== 'all') params.set('status', status);
    if (event.trim()) params.set('event', event.trim());
    params.set('limit', '200');
    const s = params.toString();
    return s ? `/admin/webhook-deliveries?${s}` : '/admin/webhook-deliveries';
  }, [workspace, status, event]);

  const { data, error, loading } = useLive<Delivery[]>(query, 3000);

  return (
    <AdminLayout title="Webhook deliveries">
      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-4">
        <FilterField label="Workspace slug">
          <Input
            value={workspace}
            onChange={(e) => setWorkspace(e.target.value)}
            placeholder="any"
          />
        </FilterField>
        <FilterField label="Status">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="h-9 w-full rounded border border-border bg-background px-2 text-sm"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Event">
          <Input
            value={event}
            onChange={(e) => setEvent(e.target.value)}
            placeholder="account.connected"
          />
        </FilterField>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-danger/40 bg-danger/10 px-4 py-2 text-sm text-danger">
          ↯ {error}
        </div>
      )}

      {!loading && (!data || data.length === 0) ? (
        <Empty
          icon={<Send className="h-6 w-6" />}
          message="No deliveries match. Outgoing webhook attempts will appear here once a client registers an endpoint and an account.connected event fires."
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-secondary/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">When</th>
                    <th className="px-3 py-2">Workspace</th>
                    <th className="px-3 py-2">Event</th>
                    <th className="px-3 py-2">URL</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Attempts</th>
                    <th className="px-3 py-2">Last code</th>
                    <th className="px-3 py-2">Next retry</th>
                  </tr>
                </thead>
                <tbody>
                  {(data ?? []).map((d) => (
                    <tr
                      key={d.id}
                      onClick={() => setSelectedId(d.id)}
                      className="cursor-pointer border-b border-border/40 transition-colors hover:bg-secondary/20"
                    >
                      <td className="px-3 py-2 text-xs">{fmtRelative(d.created_at)}</td>
                      <td className="px-3 py-2 font-mono text-xs">{d.workspace_slug}</td>
                      <td className="px-3 py-2 font-mono text-xs">{d.event}</td>
                      <td className="px-3 py-2 max-w-[280px] truncate font-mono text-xs">
                        {d.endpoint_url}
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant={statusVariant(d.status)}>{d.status}</Badge>
                        {d.last_error && (
                          <div
                            className="mt-1 max-w-[260px] truncate text-[10px] text-danger"
                            title={d.last_error}
                          >
                            {d.last_error}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono">{d.attempts}</td>
                      <td className="px-3 py-2 font-mono">
                        {d.last_response_code ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {d.next_retry_at ? fmtRelative(d.next_retry_at) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {selectedId && (
        <DeliveryDetailModal id={selectedId} onClose={() => setSelectedId(null)} />
      )}
    </AdminLayout>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

function statusVariant(status: string): 'ok' | 'warn' | 'danger' | 'default' {
  switch (status) {
    case 'delivered':
      return 'ok';
    case 'failed':
      return 'warn';
    case 'abandoned':
      return 'danger';
    default:
      return 'default';
  }
}

function DeliveryDetailModal({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<DeliveryDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<'payload' | 'response' | 'meta'>('payload');
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(
          `${CONNECTOR_API_URL}/admin/webhook-deliveries/${id}`,
        );
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const json = (await res.json()) as DeliveryDetail;
        if (!cancelled) setDetail(json);
      } catch (e) {
        if (!cancelled) setErr((e as Error).message);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const onRetry = async () => {
    setRetrying(true);
    setErr(null);
    try {
      await adminPost(`/admin/webhook-deliveries/${id}/retry`);
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setRetrying(false);
    }
  };

  const canRetry = detail && detail.status !== 'delivered';

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-md border border-border bg-card shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              Webhook delivery
            </div>
            <div className="truncate font-mono text-sm">{id}</div>
          </div>
          <div className="flex items-center gap-2">
            {canRetry && (
              <Button size="sm" disabled={retrying} onClick={onRetry}>
                <RefreshCcw className="h-3.5 w-3.5" />
                {retrying ? 'Retrying…' : 'Retry now'}
              </Button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 hover:bg-secondary/40"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        {err && (
          <div className="border-b border-danger/40 bg-danger/10 px-4 py-2 text-sm text-danger">
            ↯ {err}
          </div>
        )}

        {!detail ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            Loading…
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 border-b border-border px-4 py-3 text-xs md:grid-cols-4">
              <Field label="Workspace" value={detail.workspace_slug} />
              <Field label="Event" value={detail.event} mono />
              <Field label="Status">
                <Badge variant={statusVariant(detail.status)}>{detail.status}</Badge>
              </Field>
              <Field label="Attempts" value={String(detail.attempts)} mono />
              <Field
                label="Last code"
                value={detail.last_response_code?.toString() ?? '—'}
                mono
              />
              <Field
                label="Duration"
                value={
                  detail.duration_ms != null ? `${detail.duration_ms} ms` : '—'
                }
                mono
              />
              <Field
                label="Next retry"
                value={
                  detail.next_retry_at ? fmtRelative(detail.next_retry_at) : '—'
                }
              />
              <Field
                label="Delivered at"
                value={
                  detail.delivered_at ? fmtRelative(detail.delivered_at) : '—'
                }
              />
            </div>

            <nav className="flex gap-1 border-b border-border bg-secondary/10 px-2">
              {(['payload', 'response', 'meta'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={
                    'rounded-t border-b-2 px-3 py-2 text-xs capitalize transition-colors ' +
                    (tab === t
                      ? 'border-primary text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground')
                  }
                >
                  {t}
                </button>
              ))}
            </nav>

            <div className="flex-1 overflow-auto p-4">
              {tab === 'payload' && (
                <pre className="overflow-auto whitespace-pre-wrap rounded bg-secondary/20 p-3 font-mono text-xs">
                  {JSON.stringify(detail.payload, null, 2)}
                </pre>
              )}
              {tab === 'response' && (
                <>
                  <div className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
                    Headers
                  </div>
                  <pre className="mb-4 overflow-auto whitespace-pre-wrap rounded bg-secondary/20 p-3 font-mono text-xs">
                    {detail.response_headers
                      ? JSON.stringify(detail.response_headers, null, 2)
                      : '(none captured)'}
                  </pre>
                  <div className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
                    Body (truncated at 4 KB)
                  </div>
                  <pre className="overflow-auto whitespace-pre-wrap rounded bg-secondary/20 p-3 font-mono text-xs">
                    {detail.response_body ?? '(none)'}
                  </pre>
                  {detail.last_error && (
                    <div className="mt-4">
                      <div className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
                        Last error
                      </div>
                      <pre className="overflow-auto whitespace-pre-wrap rounded bg-danger/10 p-3 font-mono text-xs text-danger">
                        {detail.last_error}
                      </pre>
                    </div>
                  )}
                </>
              )}
              {tab === 'meta' && (
                <div className="space-y-2 font-mono text-xs">
                  <div>
                    <span className="text-muted-foreground">URL:</span>{' '}
                    {detail.endpoint_url}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Endpoint id:</span>{' '}
                    {detail.endpoint_id}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Created:</span>{' '}
                    {detail.created_at}
                  </div>
                  {detail.delivered_at && (
                    <div>
                      <span className="text-muted-foreground">Delivered:</span>{' '}
                      {detail.delivered_at}
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  mono,
  children,
}: {
  label: string;
  value?: string;
  mono?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      {children ?? <div className={mono ? 'font-mono' : ''}>{value}</div>}
    </div>
  );
}
