/**
 * Stage 03 — CONNECT. Renders discover results and fires seeds. Term-restyled
 * port of the legacy "Authenticated as" + "Pages found / TikTok / Threads"
 * sections. The seed-body construction (including the TikTok expires_in →
 * expires_at ISO conversion) is copied verbatim from the legacy page so the
 * /admin/connect/seed payloads are byte-for-byte identical.
 */

import type { ReactNode } from 'react';
import PlatformTag from '@/components/term/PlatformTag';
import ActionChip from '@/components/term/ActionChip';
import PageCard from './PageCard';
import { TikTokAccountCard, ThreadsAccountCard } from './AccountCards';
import type {
  DiscoverResponse,
  ConnectKey,
  ConnectFn,
  ResultMap,
} from './types';

interface DiscoveryStageProps {
  discovery: DiscoverResponse;
  /** Raw token pasted in stage 02 — reused verbatim for threads/tiktok seeds. */
  token: string;
  refreshToken: string;
  expiresInS: string;
  busy: ConnectKey | null;
  results: ResultMap;
  onConnect: ConnectFn;
  onBack: () => void;
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 border-b border-term-line pb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-term-faint">
      <span aria-hidden="true">⫿</span> {children}
    </div>
  );
}

export default function DiscoveryStage({
  discovery,
  token,
  refreshToken,
  expiresInS,
  busy,
  results,
  onConnect,
  onBack,
}: DiscoveryStageProps) {
  const showPages =
    discovery.token_type !== 'tiktok-business' &&
    discovery.token_type !== 'threads-user';

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h2 className="font-display text-lg font-bold tracking-tight text-term-text">
          Connect accounts
        </h2>
        <p className="text-xs text-term-muted">
          Validated. Pick the accounts to seed into the target workspace.
        </p>
      </header>

      {/* Authenticated-as */}
      <section className="flex flex-col gap-2">
        <SectionTitle>
          authenticated as ·{' '}
          <span className="text-term-mint">{discovery.token_type} token</span>
        </SectionTitle>
        <div className="font-mono text-sm text-term-text">
          {discovery.me.name ?? '—'}{' '}
          <span className="text-term-muted">({discovery.me.id ?? '—'})</span>
        </div>
        {discovery.warnings.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {discovery.warnings.map((w, i) => (
              <div
                key={i}
                className="border border-term-warn/40 bg-term-warn/10 px-3 py-2 font-mono text-[11px] text-term-warn"
              >
                {w}
              </div>
            ))}
          </div>
        )}
      </section>

      {showPages && (
        <section className="flex flex-col gap-3">
          <SectionTitle>pages found ({discovery.pages.length})</SectionTitle>
          {discovery.pages.length === 0 ? (
            <div className="border border-dashed border-term-line-2 bg-term-bg/40 p-4 text-center font-mono text-[11px] text-term-faint">
              No pages returned. The token may lack pages_show_list or no Pages
              are managed by this user.
            </div>
          ) : (
            discovery.pages.map((p) => (
              <PageCard
                key={p.page_id}
                page={p}
                busy={busy}
                results={results}
                onConnect={onConnect}
              />
            ))
          )}
        </section>
      )}

      {discovery.threads_account && (
        <section className="flex flex-col gap-3">
          <SectionTitle>
            <PlatformTag platform="threads" /> threads account
          </SectionTitle>
          <ThreadsAccountCard
            account={discovery.threads_account}
            busy={busy === `threads:${discovery.threads_account.user_id}`}
            result={results[`threads:${discovery.threads_account.user_id}`]}
            onConnect={() => {
              const acc = discovery.threads_account;
              if (!acc) return;
              return onConnect(`threads:${acc.user_id}`, {
                platform: 'threads',
                access_token: token.trim(),
                canonical_user_id: acc.user_id,
                handle: acc.username
                  ? `@${acc.username}`
                  : acc.name ?? undefined,
                metadata: {
                  user_id: acc.user_id,
                },
              });
            }}
          />
        </section>
      )}

      {discovery.tiktok_account && (
        <section className="flex flex-col gap-3">
          <SectionTitle>
            <PlatformTag platform="tiktok" /> tiktok account
          </SectionTitle>
          <TikTokAccountCard
            account={discovery.tiktok_account}
            busy={busy === `tiktok:${discovery.tiktok_account.open_id}`}
            result={results[`tiktok:${discovery.tiktok_account.open_id}`]}
            onConnect={() => {
              const acc = discovery.tiktok_account;
              if (!acc) return;
              const expiresAt = (() => {
                const n = Number(expiresInS);
                if (!Number.isFinite(n) || n <= 0) return undefined;
                return new Date(Date.now() + n * 1000).toISOString();
              })();
              return onConnect(`tiktok:${acc.open_id}`, {
                platform: 'tiktok',
                access_token: token.trim(),
                refresh_token: refreshToken.trim() || undefined,
                expires_at: expiresAt,
                canonical_user_id: acc.open_id,
                handle: acc.username
                  ? `@${acc.username}`
                  : acc.display_name ?? undefined,
                metadata: {
                  business_id: acc.open_id,
                  open_id: acc.open_id,
                },
              });
            }}
          />
        </section>
      )}

      <div>
        <ActionChip variant="ghost" onClick={onBack}>
          ◂ credentials
        </ActionChip>
      </div>
    </div>
  );
}
