import Link from 'next/link';
import { KeyRound, Trash2 } from 'lucide-react';
import AdminLayout from '../../components/AdminLayout';
import { useLive } from '../../lib/useLive';
import { adminPost } from '../../lib/api';
import { fmtRelative } from '../../lib/format';
import { Empty } from '@/components/admin/empty';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

type ApiKeyRow = {
  id: string;
  workspace_slug: string;
  workspace_name: string;
  key_prefix: string;
  scope: string;
  label: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

export default function ApiKeysPage() {
  const { data, error, loading, refresh } = useLive<ApiKeyRow[]>(
    '/admin/api-keys',
    5000,
  );

  const onRevoke = async (k: ApiKeyRow) => {
    if (k.revoked_at) return;
    if (
      !confirm(
        `Revoke ${k.key_prefix}… for workspace ${k.workspace_slug}? The client will get 401 on the next call.`,
      )
    )
      return;
    await adminPost(`/admin/api-keys/${k.id}/revoke`, {});
    refresh();
  };

  return (
    <AdminLayout title="API keys">
      {error && (
        <div className="mb-4 rounded-md border border-danger/40 bg-danger/10 px-4 py-2 text-sm text-danger">
          ↯ {error}
        </div>
      )}

      {!loading && (!data || data.length === 0) ? (
        <Empty
          icon={<KeyRound className="h-6 w-6" />}
          message="No API keys yet. Issue one from /admin/workspaces/<slug>."
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-secondary/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Workspace</th>
                    <th className="px-3 py-2">Prefix</th>
                    <th className="px-3 py-2">Label</th>
                    <th className="px-3 py-2">Scope</th>
                    <th className="px-3 py-2">Last used</th>
                    <th className="px-3 py-2">Created</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {(data ?? []).map((k) => (
                    <tr key={k.id} className="border-b border-border/40">
                      <td className="px-3 py-2">
                        <Link
                          href={`/admin/workspaces/${k.workspace_slug}`}
                          className="font-medium hover:underline"
                        >
                          {k.workspace_name}
                        </Link>
                        <div className="font-mono text-[11px] text-muted-foreground">
                          {k.workspace_slug}
                        </div>
                      </td>
                      <td className="px-3 py-2 font-mono">{k.key_prefix}…</td>
                      <td className="px-3 py-2">
                        {k.label ?? <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-3 py-2">{k.scope}</td>
                      <td className="px-3 py-2 text-xs">
                        {k.last_used_at ? fmtRelative(k.last_used_at) : 'never'}
                      </td>
                      <td className="px-3 py-2 text-xs">{fmtRelative(k.created_at)}</td>
                      <td className="px-3 py-2">
                        {k.revoked_at ? (
                          <Badge variant="default">revoked</Badge>
                        ) : isStale(k.last_used_at) ? (
                          <Badge variant="warn">stale</Badge>
                        ) : (
                          <Badge variant="ok">active</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {!k.revoked_at && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-danger hover:text-danger"
                            onClick={() => onRevoke(k)}
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
          </CardContent>
        </Card>
      )}
    </AdminLayout>
  );
}

const STALE_DAYS = 30;

function isStale(lastUsedAt: string | null): boolean {
  if (!lastUsedAt) return true;
  const ms = Date.now() - new Date(lastUsedAt).getTime();
  return ms > STALE_DAYS * 24 * 60 * 60 * 1000;
}
