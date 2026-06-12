/**
 * Connect Studio (Ops Terminal phase 5a) — full-screen Mint Terminal takeover
 * for operator onboarding. Restyle-only rebuild of the legacy 974-line page:
 * EVERY endpoint call, payload and conditional is preserved. The only real
 * logic here is the two admin POSTs and the stage state machine; all rendering
 * is delegated to <components/term/connect/*>.
 *
 * Endpoints (unchanged):
 *   · POST /admin/connect/discover  { platform, access_token, [open_id] }
 *   · POST /admin/connect/seed      SeedBody (+ workspace_slug when selected)
 */

import { useState, useCallback } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import ThemeToggle from '@/components/ThemeToggle';
import WorkspaceSelect from '@/components/WorkspaceSelect';
import { adminPost } from '@/lib/api';
import { useWorkspaceFilter } from '@/lib/workspace-context';
import StageRail, { STAGES, type StageId } from '@/components/term/connect/StageRail';
import PlatformGalleryStage from '@/components/term/connect/PlatformGalleryStage';
import CredentialsStage from '@/components/term/connect/CredentialsStage';
import DiscoveryStage from '@/components/term/connect/DiscoveryStage';
import FirstSyncStage from '@/components/term/connect/FirstSyncStage';
import ManualForm from '@/components/term/connect/ManualForm';
import type {
  DiscoverResponse,
  SeedResponse,
  SeedBody,
  ConnectKey,
  DiscoverPlatform,
  ResultMap,
} from '@/components/term/connect/types';

const ALL_STAGE_IDS: StageId[] = STAGES.map((s) => s.id);

export default function ConnectStudioPage() {
  const { slug: wsSlug } = useWorkspaceFilter();

  // ── Stage machine ───────────────────────────────────────────────────────────
  const [stage, setStage] = useState<StageId>('platform');
  const [reachable, setReachable] = useState<Set<StageId>>(
    () => new Set<StageId>(['platform']),
  );
  const [manualOpen, setManualOpen] = useState(false);

  const goStage = useCallback((next: StageId) => {
    setStage(next);
    setReachable((prev) => {
      const merged = new Set(prev);
      merged.add(next);
      return merged;
    });
  }, []);

  // ── Discover state (ported verbatim) ─────────────────────────────────────────
  const [platform, setPlatform] = useState<DiscoverPlatform>('facebook');
  const [token, setToken] = useState('');
  const [openId, setOpenId] = useState('');
  const [refreshToken, setRefreshToken] = useState('');
  const [expiresInS, setExpiresInS] = useState('');
  const [discovering, setDiscovering] = useState(false);
  const [discovery, setDiscovery] = useState<DiscoverResponse | null>(null);
  const [discoverErr, setDiscoverErr] = useState<string | null>(null);

  const [busy, setBusy] = useState<ConnectKey | null>(null);
  const [results, setResults] = useState<ResultMap>({});

  // ── Discover — POST /admin/connect/discover (verbatim) ────────────────────────
  const onDiscover = useCallback(async () => {
    if (!token.trim()) return;
    if (platform === 'tiktok' && !openId.trim()) {
      setDiscoverErr(
        "TikTok needs the 'open_id' returned by the BC OAuth callback alongside the access_token.",
      );
      return;
    }
    setDiscovering(true);
    setDiscoverErr(null);
    setDiscovery(null);
    setResults({});
    try {
      const res = await adminPost<DiscoverResponse>('/admin/connect/discover', {
        platform,
        access_token: token.trim(),
        ...(platform === 'tiktok' && openId.trim()
          ? { open_id: openId.trim() }
          : {}),
      });
      setDiscovery(res);
      goStage('connect');
    } catch (e) {
      setDiscoverErr((e as Error).message);
    } finally {
      setDiscovering(false);
    }
  }, [token, platform, openId, goStage]);

  // ── Seed — POST /admin/connect/seed (verbatim) ────────────────────────────────
  const connect = useCallback(
    async (key: ConnectKey, body: SeedBody) => {
      setBusy(key);
      try {
        // Attach the workspace selected in the header so the new account lands
        // in the right tenant. Backend resolves slug → id.
        const enrichedBody: SeedBody = wsSlug
          ? { ...body, workspace_slug: wsSlug }
          : body;
        const res = await adminPost<SeedResponse>(
          '/admin/connect/seed',
          enrichedBody,
        );
        setResults((prev) => ({ ...prev, [key]: res }));
        // Advance to the first-sync view once at least one seed lands.
        setReachable((prev) => {
          const merged = new Set(prev);
          merged.add('sync');
          return merged;
        });
      } catch (e) {
        setResults((prev) => ({ ...prev, [key]: (e as Error).message }));
      } finally {
        setBusy(null);
      }
    },
    [wsSlug],
  );

  const resetFlow = useCallback(() => {
    setToken('');
    setOpenId('');
    setRefreshToken('');
    setExpiresInS('');
    setDiscovery(null);
    setDiscoverErr(null);
    setResults({});
    setReachable(new Set<StageId>(['platform']));
    setStage('platform');
  }, []);

  const connectToolUrl =
    process.env.NEXT_PUBLIC_CONNECT_TOOL_URL ?? 'http://localhost:3002';

  return (
    <div className="flex h-screen flex-col bg-term-bg font-mono text-term-text">
      <Head>
        <title>Connect Studio — Camaleonic Connect</title>
      </Head>

      {/* Header */}
      <header className="flex h-11 shrink-0 items-center gap-4 border-b border-term-line bg-term-bg px-3">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="grid h-4 w-4 place-items-center border-[1.5px] border-term-mint"
          />
          <div className="flex flex-col leading-none">
            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-term-mint">
              Connect Studio
            </span>
            <span className="text-[9px] uppercase tracking-[0.2em] text-term-faint">
              Operator onboarding
            </span>
          </div>
        </div>

        <Link
          href="/admin/terminal"
          className="ml-2 inline-flex h-7 items-center gap-1.5 border border-term-line-2 px-2 text-[11px] uppercase tracking-[0.08em] text-term-muted transition-colors duration-150 hover:border-term-faint hover:text-term-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-term-mint"
        >
          ← terminal
        </Link>

        <div className="ml-auto flex items-center gap-2">
          <WorkspaceSelect />
          <ThemeToggle />
        </div>
      </header>

      {/* Workspace gate banner */}
      {wsSlug ? (
        <div
          role="note"
          className="flex shrink-0 flex-wrap items-center gap-2 border-b border-term-mint/40 bg-term-mint/10 px-3 py-1.5 text-[11px]"
        >
          <span className="font-bold uppercase tracking-[0.12em] text-term-mint">
            target workspace
          </span>
          <code className="border border-term-line-2 bg-term-bg px-1.5 py-0.5 text-term-text">
            {wsSlug}
          </code>
          <span className="text-term-muted">
            — every account seeded here lands in this workspace. Change it from
            the header.
          </span>
        </div>
      ) : (
        <div
          role="alert"
          className="flex shrink-0 flex-wrap items-center gap-2 border-b border-term-warn/50 bg-term-warn/10 px-3 py-1.5 text-[11px]"
        >
          <span className="font-bold uppercase tracking-[0.12em] text-term-warn">
            pick a workspace
          </span>
          <span className="text-term-muted">
            from the header before connecting. Without one the seed step is
            disabled so accounts don&apos;t accidentally land in{' '}
            <code className="border border-term-line-2 bg-term-bg px-1 py-0.5 text-term-text">
              demo
            </code>
            .
          </span>
        </div>
      )}

      {/* Body: stage rail + stage canvas */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <StageRail active={stage} reachable={reachable} onSelect={goStage} />

        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-4xl px-4 py-6 lg:px-8 lg:py-10">
            {stage === 'platform' && (
              <PlatformGalleryStage
                selected={platform}
                onSelect={(p) => {
                  setPlatform(p);
                  setDiscovery(null);
                  setDiscoverErr(null);
                }}
                onContinue={() => goStage('credentials')}
                onManual={() => {
                  setManualOpen(true);
                  goStage('credentials');
                }}
                connectToolUrl={connectToolUrl}
              />
            )}

            {stage === 'credentials' && (
              <div className="flex flex-col gap-6">
                <CredentialsStage
                  platform={platform}
                  token={token}
                  openId={openId}
                  refreshToken={refreshToken}
                  expiresInS={expiresInS}
                  discovering={discovering}
                  discoverErr={discoverErr}
                  hasWorkspace={!!wsSlug}
                  onTokenChange={setToken}
                  onOpenIdChange={setOpenId}
                  onRefreshTokenChange={setRefreshToken}
                  onExpiresInChange={setExpiresInS}
                  onDiscover={onDiscover}
                  onBack={() => goStage('platform')}
                />

                {/* Manual connect — bypass discovery (collapsible). */}
                <section className="border border-term-line bg-term-surface">
                  <button
                    type="button"
                    aria-expanded={manualOpen}
                    onClick={() => setManualOpen((v) => !v)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left font-mono text-[11px] uppercase tracking-[0.12em] text-term-muted transition-colors hover:text-term-text"
                  >
                    <span aria-hidden="true" className="text-term-mint">
                      {manualOpen ? '▾' : '▸'}
                    </span>
                    manual connect (bypass discovery)
                  </button>
                  {manualOpen && (
                    <div className="border-t border-term-line px-3 py-4">
                      <ManualForm
                        onConnect={connect}
                        busy={busy}
                        results={results}
                      />
                    </div>
                  )}
                </section>
              </div>
            )}

            {stage === 'connect' &&
              (discovery ? (
                <DiscoveryStage
                  discovery={discovery}
                  token={token}
                  refreshToken={refreshToken}
                  expiresInS={expiresInS}
                  busy={busy}
                  results={results}
                  onConnect={connect}
                  onBack={() => goStage('credentials')}
                />
              ) : (
                <div className="font-mono text-xs text-term-faint">
                  — discover a token first —
                </div>
              ))}

            {stage === 'sync' && (
              <FirstSyncStage
                results={results}
                onBack={() => goStage('connect')}
                onReset={resetFlow}
              />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

// Re-exported for tests / external stage references.
export { ALL_STAGE_IDS };
