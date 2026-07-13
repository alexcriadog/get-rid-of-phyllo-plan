import { useState } from 'react';
import Link from 'next/link';
import { Building2, Pencil, Plus } from 'lucide-react';
import AdminLayout from '../../components/AdminLayout';
import { useLive } from '../../lib/useLive';
import { adminPost, adminPatch } from '../../lib/api';
import { fmtRelative } from '../../lib/format';
import { Empty } from '@/components/admin/empty';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

type Workspace = {
  id: string;
  slug: string;
  name: string;
  plan_tier: string;
  created_at: string;
  account_count: number;
  api_key_count: number;
};

export default function WorkspacesPage() {
  const { data, error, loading, refresh } = useLive<Workspace[]>(
    '/admin/workspaces',
    5000,
  );
  const [showForm, setShowForm] = useState(false);
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onCreate = async () => {
    setBusy(true);
    setErr(null);
    try {
      await adminPost('/admin/workspaces', {
        slug: slug.trim(),
        name: name.trim(),
      });
      setSlug('');
      setName('');
      setShowForm(false);
      refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminLayout
      title="Workspaces"
      actions={
        <Button size="sm" onClick={() => setShowForm((v) => !v)}>
          <Plus className="h-3.5 w-3.5" /> New workspace
        </Button>
      }
    >
      {showForm && (
        <Card className="mb-6">
          <CardContent className="space-y-3 p-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs uppercase tracking-wider text-muted-foreground">
                  Slug (URL-safe)
                </label>
                <Input
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder="acme"
                  pattern="[a-z0-9-]+"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs uppercase tracking-wider text-muted-foreground">
                  Display name
                </label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="ACME Inc."
                />
              </div>
            </div>
            {err && <div className="text-sm text-danger">↯ {err}</div>}
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={busy || !slug || !name}
                onClick={onCreate}
              >
                {busy ? 'Creating…' : 'Create'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setShowForm(false);
                  setErr(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {error && (
        <div className="mb-4 rounded-md border border-danger/40 bg-danger/10 px-4 py-2 text-sm text-danger">
          ↯ {error}
        </div>
      )}

      {!loading && (!data || data.length === 0) ? (
        <Empty
          icon={<Building2 className="h-6 w-6" />}
          message="No workspaces yet. Each client of the Camaleonic Connect SaaS gets a workspace. Create one to issue an API key and start onboarding."
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {(data ?? []).map((w) => (
            <Link
              key={w.id}
              href={`/admin/workspaces/${w.slug}`}
              className="block transition-transform hover:-translate-y-0.5"
            >
              <Card className="h-full hover:border-primary/40">
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold">{w.name}</div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {w.slug}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        aria-label={`Rename ${w.name}`}
                        title="Rename workspace"
                        className="text-muted-foreground transition-colors hover:text-foreground"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          const next = window.prompt(
                            `Rename workspace "${w.name}" (${w.slug})`,
                            w.name,
                          );
                          const trimmed = next?.trim();
                          if (!trimmed || trimmed === w.name) return;
                          adminPatch(`/admin/workspaces/${w.slug}/name`, {
                            name: trimmed,
                          })
                            .then(() => refresh())
                            .catch((err) =>
                              window.alert(
                                `Rename failed: ${(err as Error).message}`,
                              ),
                            );
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <Badge variant="default" className="capitalize">
                        {w.plan_tier}
                      </Badge>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <Stat label="Accounts" value={w.account_count} />
                    <Stat label="API keys" value={w.api_key_count} />
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    created {fmtRelative(w.created_at)}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </AdminLayout>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border/40 bg-secondary/30 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="font-mono text-sm">{value}</div>
    </div>
  );
}
