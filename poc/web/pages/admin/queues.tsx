import { useLive, POLL } from '../../lib/useLive';
import AdminLayout from '../../components/AdminLayout';
import ScopeBadge from '../../components/ScopeBadge';
import { Section } from '@/components/admin/section';
import { Empty } from '@/components/admin/empty';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * BullMQ queue depths. The /admin/queues endpoint returns one entry per
 * queue with the standard job-count buckets. This surfaces the async
 * machinery (sync / events / delivery) that was previously only observable
 * by shelling into Redis — including the failed (DLQ) count, which is the
 * operator's first signal that work is silently piling up.
 */
type JobCounts = {
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
  paused: number;
};

type QueueStats = Record<string, Partial<JobCounts>>;

const QUEUE_LABELS: Record<string, { label: string; hint: string }> = {
  sync: { label: 'Sync', hint: 'Platform data sync jobs' },
  events: { label: 'Events', hint: 'Inbound platform events' },
  'sync-delivery': { label: 'Delivery', hint: 'Outbound webhook deliveries' },
  delivery: { label: 'Delivery', hint: 'Outbound webhook deliveries' },
};

const BUCKETS: { key: keyof JobCounts; label: string; tone: 'muted' | 'ok' | 'warn' | 'danger' }[] = [
  { key: 'active', label: 'Active', tone: 'ok' },
  { key: 'waiting', label: 'Waiting', tone: 'muted' },
  { key: 'delayed', label: 'Delayed', tone: 'warn' },
  { key: 'failed', label: 'Failed (DLQ)', tone: 'danger' },
  { key: 'paused', label: 'Paused', tone: 'warn' },
  { key: 'completed', label: 'Completed', tone: 'muted' },
];

function toneClass(tone: string, value: number): string {
  if (value === 0) return 'text-muted-foreground';
  switch (tone) {
    case 'ok':
      return 'text-ok';
    case 'warn':
      return 'text-warn';
    case 'danger':
      return 'text-danger';
    default:
      return 'text-foreground';
  }
}

export default function QueuesPage() {
  const queues = useLive<QueueStats>('/admin/queues', POLL.live);
  const data = queues.data ?? {};
  const names = Object.keys(data);

  return (
    <AdminLayout title="Queues">
      <ScopeBadge
        scope="global"
        reason="BullMQ queues are shared infrastructure across all tenants."
      />
      <Section
        title="Queue depths"
        description="Live job counts per queue. A growing Failed (DLQ) or Waiting count is the first sign of backpressure."
      >
        {names.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {names.map((name) => {
              const counts = data[name] ?? {};
              const meta = QUEUE_LABELS[name] ?? { label: name, hint: '' };
              return (
                <Card key={name}>
                  <CardContent className="p-5">
                    <div className="mb-3 flex items-baseline justify-between">
                      <h3 className="text-sm font-semibold">{meta.label}</h3>
                      <span className="font-mono text-[11px] text-muted-foreground">{name}</span>
                    </div>
                    {meta.hint && (
                      <p className="mb-4 text-xs text-muted-foreground">{meta.hint}</p>
                    )}
                    <dl className="grid grid-cols-3 gap-3">
                      {BUCKETS.map((b) => {
                        const value = counts[b.key] ?? 0;
                        return (
                          <div key={b.key} className="space-y-0.5">
                            <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
                              {b.label}
                            </dt>
                            <dd className={cn('font-mono text-xl font-semibold', toneClass(b.tone, value))}>
                              {value}
                            </dd>
                          </div>
                        );
                      })}
                    </dl>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <Empty
            message={queues.error ? `Unable to load queues: ${queues.error}` : 'No queue data available.'}
          />
        )}
      </Section>
    </AdminLayout>
  );
}
