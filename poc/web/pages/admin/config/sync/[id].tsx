/**
 * Admin → per-account sync settings.
 *
 * Knobs that override the platform defaults for one (account, product) pair:
 *   - Cadence override (in hours) -> POST /admin/accounts/:id/cadence-overrides
 *   - Per-product runtime knobs   -> PATCH /admin/sync-jobs/:id/settings
 *
 * One card per sync_job. Each card resolves its `effective_settings` via
 * /admin/sync-jobs/:id so the operator sees the computed value (after
 * merging row override + env + defaults), not just the sparse override.
 */

import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import ConfigLayout from '@/components/term/ConfigLayout';
import {
  adminPost,
  adminPatch,
  CONNECTOR_API_URL,
} from '../../../../lib/api';
import { Section } from '@/components/admin/section';
import { Empty } from '@/components/admin/empty';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';

type SyncJobLite = {
  id: string;
  accountId: string;
  product: string;
  status: string;
  next_run_at?: string | null;
  last_success_at?: string | null;
  failure_count?: number;
};

type SyncJobDetail = {
  id: string;
  account_id: string;
  account_handle: string | null;
  platform: string;
  product: string;
  status: string;
  priority: string;
  next_run_at: string | null;
  last_success_at: string | null;
  last_attempt_at: string | null;
  last_error: string | null;
  failure_count: number;
  settings: Record<string, unknown> | null;
  effective_settings: Record<string, unknown>;
};

export default function AccountSyncSettingsAdminPage() {
  const router = useRouter();
  const id = typeof router.query.id === 'string' ? router.query.id : '';
  const [jobs, setJobs] = useState<SyncJobLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    fetch(`${CONNECTOR_API_URL}/admin/sync-jobs?account_id=${id}&limit=50`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((body) => {
        if (cancelled) return;
        const items: unknown = Array.isArray(body)
          ? body
          : body?.items ?? body?.sync_jobs ?? [];
        setJobs(items as SyncJobLite[]);
        setErr(null);
      })
      .catch((e) => {
        if (!cancelled) setErr((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, tick]);

  if (!id) return <ConfigLayout title="Sync settings">Loading…</ConfigLayout>;

  return (
    <ConfigLayout
      title={`Sync settings · #${id}`}
      actions={
        <Button asChild variant="ghost" size="sm">
          <Link href={`/admin?account=${id}`}>
            <ArrowLeft className="h-3.5 w-3.5" />
            Account
          </Link>
        </Button>
      }
    >
      {err && (
        <div className="mb-4 rounded-md border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
          {err}
        </div>
      )}

      {loading ? (
        <Card className="p-6 text-sm text-muted-foreground">Loading…</Card>
      ) : jobs.length === 0 ? (
        <Empty message="No sync_jobs for this account yet." />
      ) : (
        <Section
          title="Per-product knobs"
          description="Cadence overrides and runtime settings for this account's sync jobs. Anything left blank falls back to the platform default."
        >
          <div className="flex flex-col gap-3">
            {jobs.map((j) => (
              <SyncJobSettingsCard
                key={j.id}
                accountId={id}
                jobId={j.id}
                product={j.product}
                refresh={() => setTick((n) => n + 1)}
              />
            ))}
          </div>
        </Section>
      )}
    </ConfigLayout>
  );
}

function SyncJobSettingsCard({
  accountId,
  jobId,
  product,
  refresh,
}: {
  accountId: string;
  jobId: string;
  product: string;
  refresh: () => void;
}) {
  const [detail, setDetail] = useState<SyncJobDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const [lookbackDays, setLookbackDays] = useState('');
  const [maxPostsPerSync, setMaxPostsPerSync] = useState('');
  const [videoLookback, setVideoLookback] = useState('');
  const [perVideo, setPerVideo] = useState('');
  const [cadenceHours, setCadenceHours] = useState('');

  const load = async () => {
    setBusy(true);
    setErrMsg(null);
    try {
      const r = await fetch(`${CONNECTOR_API_URL}/admin/sync-jobs/${jobId}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const body = (await r.json()) as SyncJobDetail;
      setDetail(body);
      const s = (body.settings ?? {}) as Record<string, unknown>;
      setLookbackDays(s.lookbackDays != null ? String(s.lookbackDays) : '');
      setMaxPostsPerSync(s.maxPostsPerSync != null ? String(s.maxPostsPerSync) : '');
      setVideoLookback(s.videoLookback != null ? String(s.videoLookback) : '');
      setPerVideo(s.perVideo != null ? String(s.perVideo) : '');
    } catch (e) {
      setErrMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const saveSettings = async () => {
    setBusy(true);
    setErrMsg(null);
    setOkMsg(null);
    try {
      const settings: Record<string, number> = {};
      if (product === 'engagement_new') {
        const a = Number(lookbackDays);
        const b = Number(maxPostsPerSync);
        if (Number.isFinite(a) && a > 0) settings.lookbackDays = Math.floor(a);
        if (Number.isFinite(b) && b > 0) settings.maxPostsPerSync = Math.floor(b);
      } else if (product === 'comments') {
        const a = Number(videoLookback);
        const b = Number(perVideo);
        if (Number.isFinite(a) && a > 0) settings.videoLookback = Math.floor(a);
        if (Number.isFinite(b) && b > 0) settings.perVideo = Math.floor(b);
      }
      const payload =
        Object.keys(settings).length === 0 ? { settings: null } : { settings };
      await adminPatch(`/admin/sync-jobs/${jobId}/settings`, payload);
      setOkMsg('Saved.');
      await load();
    } catch (e) {
      setErrMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const resetSettings = async () => {
    setBusy(true);
    setErrMsg(null);
    setOkMsg(null);
    try {
      await adminPatch(`/admin/sync-jobs/${jobId}/settings`, { settings: null });
      setOkMsg('Reset to defaults.');
      setLookbackDays('');
      setMaxPostsPerSync('');
      setVideoLookback('');
      setPerVideo('');
      await load();
    } catch (e) {
      setErrMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveCadence = async () => {
    setBusy(true);
    setErrMsg(null);
    setOkMsg(null);
    try {
      const hours = Number(cadenceHours);
      if (!Number.isFinite(hours) || hours <= 0) {
        throw new Error('Cadence must be a positive number of hours.');
      }
      const seconds = Math.floor(hours * 3600);
      await adminPost(`/admin/accounts/${accountId}/cadence-overrides`, {
        product,
        interval_seconds: seconds,
      });
      setOkMsg(`Cadence override set to ${hours}h.`);
      setCadenceHours('');
      refresh();
    } catch (e) {
      setErrMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-5">
      <CardContent className="p-0">
        <div className="mb-3 flex items-center gap-3">
          <Badge variant="outline">{detail?.platform ?? ''}</Badge>
          <span className="font-mono text-sm font-semibold">{product}</span>
          <Badge>{detail?.status ?? ''}</Badge>
          <span className="ml-auto font-mono text-[10px] text-muted-foreground">
            sync_job #{jobId}
          </span>
        </div>

        {detail?.last_error && (
          <div className="mb-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 font-mono text-[11px] text-danger">
            last_error: {detail.last_error}
          </div>
        )}

        <div className="mb-4">
          <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Cadence override (hours)
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="number"
              min={1}
              step="any"
              placeholder="e.g. 8"
              value={cadenceHours}
              onChange={(e) => setCadenceHours(e.target.value)}
              className="max-w-[160px] font-mono text-xs"
            />
            <Button onClick={saveCadence} disabled={busy || !cadenceHours.trim()} size="sm">
              Set override
            </Button>
            <span className="font-mono text-[10px] text-muted-foreground">
              (use the Pipeline deck to clear or change defaults)
            </span>
          </div>
        </div>

        {product === 'engagement_new' && (
          <div className="mb-4 grid gap-3 sm:grid-cols-2">
            <SettingField
              label="lookbackDays"
              description={
                detail?.effective_settings?.lookbackDays != null
                  ? `effective: ${String(detail.effective_settings.lookbackDays)} d`
                  : ''
              }
              value={lookbackDays}
              onChange={setLookbackDays}
              placeholder="default 90"
            />
            <SettingField
              label="maxPostsPerSync"
              description={
                detail?.effective_settings?.maxPostsPerSync != null
                  ? `effective: ${String(detail.effective_settings.maxPostsPerSync)}`
                  : ''
              }
              value={maxPostsPerSync}
              onChange={setMaxPostsPerSync}
              placeholder="default 500"
            />
          </div>
        )}
        {product === 'comments' && (
          <div className="mb-4 grid gap-3 sm:grid-cols-2">
            <SettingField
              label="videoLookback"
              description="how many recent videos to scan for comments"
              value={videoLookback}
              onChange={setVideoLookback}
              placeholder="default 50"
            />
            <SettingField
              label="perVideo"
              description="max comments per video, capped at 30 by TikTok"
              value={perVideo}
              onChange={setPerVideo}
              placeholder="default 30"
            />
          </div>
        )}
        {product !== 'engagement_new' && product !== 'comments' && (
          <div className="mb-3 rounded-md border border-border/60 px-3 py-2 font-mono text-[11px] text-muted-foreground">
            No tunable knobs for this product yet — only cadence is configurable.
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {(product === 'engagement_new' || product === 'comments') && (
            <>
              <Button onClick={saveSettings} disabled={busy} size="sm">
                {busy ? 'Saving…' : 'Save settings'}
              </Button>
              <Button onClick={resetSettings} disabled={busy} size="sm" variant="outline">
                Reset to defaults
              </Button>
            </>
          )}
          {okMsg && <span className="font-mono text-[11px] text-ok">{okMsg}</span>}
          {errMsg && <span className="font-mono text-[11px] text-danger">{errMsg}</span>}
        </div>
      </CardContent>
    </Card>
  );
}

function SettingField({
  label,
  description,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  description?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
      <Input
        type="number"
        min={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="font-mono text-xs"
      />
      {description && (
        <span className="font-mono text-[10px] text-muted-foreground/70">
          {description}
        </span>
      )}
    </label>
  );
}
