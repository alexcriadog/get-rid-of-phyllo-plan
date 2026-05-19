import { useMemo, useState } from 'react';
import { Send } from 'lucide-react';
import AdminLayout from '../../components/AdminLayout';
import { useLive } from '../../lib/useLive';
import { fmtRelative } from '../../lib/format';
import { Empty } from '@/components/admin/empty';
import { Badge } from '@/components/ui/badge';
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

const STATUSES = ['all', 'pending', 'delivered', 'failed', 'abandoned'];

export default function WebhookDeliveriesPage() {
  const [workspace, setWorkspace] = useState('');
  const [status, setStatus] = useState('all');
  const [event, setEvent] = useState('');

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
                    <tr key={d.id} className="border-b border-border/40">
                      <td className="px-3 py-2 text-xs">{fmtRelative(d.created_at)}</td>
                      <td className="px-3 py-2 font-mono text-xs">{d.workspace_slug}</td>
                      <td className="px-3 py-2 font-mono text-xs">{d.event}</td>
                      <td className="px-3 py-2 max-w-[280px] truncate font-mono text-xs">
                        {d.endpoint_url}
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant={statusVariant(d.status)}>{d.status}</Badge>
                        {d.last_error && (
                          <div className="mt-1 max-w-[260px] truncate text-[10px] text-danger" title={d.last_error}>
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
