import { useState } from 'react';
import type { GetServerSideProps } from 'next';
import { Copy, Plus, Send, Trash2, Webhook } from 'lucide-react';
import ClientLayout from '../../components/ClientLayout';
import { clientFetch, useClientLive } from '../../lib/useClientLive';
import { readApiKeyFromRequest } from '../../lib/client-session';
import { fmtRelative } from '../../lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Empty } from '@/components/admin/empty';

interface SessionProps {
  environment: 'live' | 'test';
}

export const getServerSideProps: GetServerSideProps<SessionProps> = async (
  ctx,
) => {
  const apiKey = readApiKeyFromRequest(ctx.req as never);
  if (!apiKey) {
    return { redirect: { destination: '/client/login', permanent: false } };
  }
  return {
    props: {
      environment: apiKey.startsWith('cmlk_test_') ? 'test' : 'live',
    },
  };
};

type Account = {
  id: string;
  platform: string;
  canonical_user_id: string;
  handle: string | null;
  display_name: string | null;
  status: string;
  end_user_id: string | null;
  is_test: boolean;
  connected_at: string;
  disconnected_at: string | null;
};

type WebhookEndpoint = {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  description: string | null;
  createdAt: string;
};

const EVENT_OPTIONS = [
  'account.connected',
  'account.disconnected',
  'account.refreshed',
  'token.refresh_failed',
  'token.expired',
];

export default function ClientDashboard({ environment }: SessionProps) {
  return (
    <ClientLayout title="Dashboard" environment={environment}>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <AccountsSection />
        <WebhooksSection />
      </div>
    </ClientLayout>
  );
}

// ─── Accounts ──────────────────────────────────────────────────────────────

function AccountsSection() {
  const accounts = useClientLive<Account[]>('v1/accounts?limit=200', 5000);
  const rows = accounts.data ?? [];
  const liveCount = rows.filter((r) => !r.is_test).length;
  const testCount = rows.filter((r) => r.is_test).length;

  return (
    <Card className="lg:col-span-2">
      <CardContent className="p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Connected accounts
            </div>
            <div className="text-[11px] text-muted-foreground">
              {liveCount} live · {testCount} test
            </div>
          </div>
        </div>

        {accounts.error && (
          <div className="mb-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
            ↯ {accounts.error}
          </div>
        )}

        {rows.length === 0 ? (
          <Empty
            icon={<Webhook className="h-6 w-6" />}
            message="No accounts connected yet. Use the Connect SDK in your app to onboard your first end-user."
          />
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="py-2">Platform</th>
                  <th className="py-2">Handle</th>
                  <th className="py-2">User ID</th>
                  <th className="py-2">Status</th>
                  <th className="py-2">Connected</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id} className="border-t border-border/40">
                    <td className="py-2 capitalize">{a.platform}</td>
                    <td className="py-2">
                      {a.handle ?? (
                        <span className="text-muted-foreground">—</span>
                      )}
                      {a.is_test && (
                        <Badge variant="warn" className="ml-2 text-[10px]">
                          test
                        </Badge>
                      )}
                    </td>
                    <td className="py-2 font-mono text-xs">
                      {a.end_user_id ?? (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-2">
                      <Badge variant={a.status === 'ready' ? 'ok' : 'warn'}>
                        {a.status}
                      </Badge>
                    </td>
                    <td className="py-2 text-xs">
                      {fmtRelative(a.connected_at)}
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

// ─── Webhooks ──────────────────────────────────────────────────────────────

function WebhooksSection() {
  const endpoints = useClientLive<WebhookEndpoint[]>(
    'v1/webhook-endpoints',
    5000,
  );
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<Set<string>>(
    new Set(['account.connected']),
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ secret: string; url: string } | null>(
    null,
  );

  const toggleEvent = (e: string) => {
    setEvents((prev) => {
      const next = new Set(prev);
      if (next.has(e)) next.delete(e);
      else next.add(e);
      return next;
    });
  };

  const onCreate = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await clientFetch<WebhookEndpoint & { secret: string }>(
        'v1/webhook-endpoints',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ url: url.trim(), events: Array.from(events) }),
        },
      );
      setIssued({ secret: res.secret, url: res.url });
      setUrl('');
      endpoints.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (id: string) => {
    if (
      !confirm("Delete this webhook endpoint? Future events won't be delivered.")
    )
      return;
    try {
      await fetch(`/api/client/proxy/v1/webhook-endpoints/${id}`, {
        method: 'DELETE',
      });
      endpoints.refresh();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <Card className="lg:col-span-2">
      <CardContent className="space-y-4 p-4">
        <div className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Webhook endpoints
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs uppercase tracking-wider text-muted-foreground">
              Endpoint URL
            </label>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://api.your-app.com/hooks/camaleonic"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs uppercase tracking-wider text-muted-foreground">
              Events
            </label>
            <div className="flex flex-wrap gap-1.5">
              {EVENT_OPTIONS.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => toggleEvent(e)}
                  className={
                    'rounded-full border px-2.5 py-1 text-[11px] transition-colors ' +
                    (events.has(e)
                      ? 'border-primary bg-primary/15 text-primary'
                      : 'border-border bg-secondary/30 text-muted-foreground hover:text-foreground')
                  }
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            disabled={busy || !url.trim() || events.size === 0}
            onClick={onCreate}
          >
            <Plus className="h-3.5 w-3.5" /> Add endpoint
          </Button>
          {err && <div className="text-sm text-danger">↯ {err}</div>}
        </div>

        {issued && (
          <div className="rounded-md border border-warn/40 bg-warn/10 p-3">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-warn">
              Save this signing secret — it will never be shown again.
            </div>
            <div className="mb-1 break-all font-mono text-[11px] text-muted-foreground">
              {issued.url}
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 overflow-auto rounded bg-background/60 px-2 py-1.5 font-mono text-xs">
                {issued.secret}
              </code>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => navigator.clipboard.writeText(issued.secret)}
              >
                <Copy className="h-3.5 w-3.5" /> Copy
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setIssued(null)}>
                ✕
              </Button>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Use it to verify the{' '}
              <code className="rounded bg-secondary/40 px-1 font-mono">
                X-Camaleonic-Signature
              </code>{' '}
              header on incoming deliveries — see /docs.html.
            </p>
          </div>
        )}

        {(endpoints.data ?? []).length === 0 ? (
          <Empty
            icon={<Send className="h-6 w-6" />}
            message="No webhook endpoints registered yet."
          />
        ) : (
          <div className="space-y-2">
            {(endpoints.data ?? []).map((e) => (
              <div
                key={e.id}
                className="flex items-start justify-between gap-3 rounded-md border border-border/40 bg-secondary/30 p-3 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <div className="break-all font-mono text-xs">{e.url}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {e.events.map((ev) => (
                      <Badge key={ev} variant="default" className="text-[10px]">
                        {ev}
                      </Badge>
                    ))}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-danger hover:text-danger"
                  onClick={() => onDelete(e.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
