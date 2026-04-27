import { useState } from 'react';
import AdminLayout from '../../components/AdminLayout';
import { useLive } from '../../lib/useLive';
import { adminPost } from '../../lib/api';
import { fmtRelative } from '../../lib/format';
import { TtlBar } from '../../components/charts';
import { Section } from '@/components/admin/section';
import { Empty } from '@/components/admin/empty';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

type Lock = {
  key: string;
  account_id?: number | string;
  product?: string;
  ttl_remaining_ms?: number;
  ttl_total_ms?: number;
  acquired_at?: string;
};

const DEFAULT_TTL_TOTAL_MS = 600_000; // 10-min cooldown is the standard window

export default function ThrottleLocksPage() {
  const { data, error, refresh } = useLive<Lock[]>('/admin/throttle-locks', 3000);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const release = async (key: string) => {
    setBusy(key);
    setErr(null);
    try {
      await adminPost('/admin/throttle-locks/release', { key });
      refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const locks = data ?? [];

  return (
    <AdminLayout title="Throttle locks">
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

      <Section
        title="Active throttle locks"
        description="10-min cool-down windows held after a successful sync. Bar drains in real time."
      >
        {locks.length === 0 ? (
          <Empty message="No active throttle locks. Workers run as soon as their cadence is due." />
        ) : (
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(380px,1fr))]">
            {locks.map((lock) => (
              <LockCard
                key={lock.key}
                lock={lock}
                busy={busy === lock.key}
                onRelease={() => release(lock.key)}
              />
            ))}
          </div>
        )}
      </Section>
    </AdminLayout>
  );
}

function LockCard({
  lock,
  busy,
  onRelease,
}: {
  lock: Lock;
  busy: boolean;
  onRelease: () => void;
}) {
  const ttlMs = lock.ttl_remaining_ms ?? 0;
  const totalMs = lock.ttl_total_ms ?? DEFAULT_TTL_TOTAL_MS;
  const ttlSeconds = Math.max(0, Math.round(ttlMs / 1000));
  const totalSeconds = Math.max(1, Math.round(totalMs / 1000));

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-secondary/40 p-4">
      <div className="flex items-center gap-2">
        <Badge variant="outline">#{lock.account_id ?? '—'}</Badge>
        <span className="font-mono text-sm">{lock.product ?? '—'}</span>
        <Button
          variant="outline"
          size="sm"
          onClick={onRelease}
          disabled={busy}
          className="ml-auto text-danger hover:bg-danger/10 hover:text-danger"
        >
          {busy ? '…' : '✕ Release'}
        </Button>
      </div>
      <TtlBar ttlSeconds={ttlSeconds} totalSeconds={totalSeconds} />
      <div className="flex items-center justify-between font-mono text-[10px] text-muted-foreground">
        <span title={lock.key}>
          {lock.key.split(':').slice(-3).join(':')}
        </span>
        <span>acquired {fmtRelative(lock.acquired_at)}</span>
      </div>
    </div>
  );
}
