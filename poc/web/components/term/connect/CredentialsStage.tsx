/**
 * Stage 02 — CREDENTIALS. Ports the legacy "1. Discover" form 1:1:
 *   · token textarea (placeholder + helptext switch per platform)
 *   · TikTok-only extra fields: open_id (required) / refresh_token / expires_in
 *   · Discover button with the exact same disabled predicate
 *
 * No endpoint logic lives here — the studio owns onDiscover. This component
 * is a controlled view over the studio's credential state.
 */

import type { ReactNode } from 'react';
import TermInput from '@/components/term/TermInput';
import ActionChip from '@/components/term/ActionChip';
import { cn } from '@/lib/utils';
import type { DiscoverPlatform } from './types';

interface CredentialsStageProps {
  platform: DiscoverPlatform;
  token: string;
  openId: string;
  refreshToken: string;
  expiresInS: string;
  discovering: boolean;
  discoverErr: string | null;
  hasWorkspace: boolean;
  onTokenChange: (v: string) => void;
  onOpenIdChange: (v: string) => void;
  onRefreshTokenChange: (v: string) => void;
  onExpiresInChange: (v: string) => void;
  onDiscover: () => void;
  onBack: () => void;
}

function tokenPlaceholder(platform: DiscoverPlatform): string {
  if (platform === 'tiktok') return 'act.zI317…';
  if (platform === 'threads') return 'THAAxxxxxxxx…';
  return 'EAAxxxxxxxx…';
}

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-term-faint">
      {children}
    </span>
  );
}

export default function CredentialsStage({
  platform,
  token,
  openId,
  refreshToken,
  expiresInS,
  discovering,
  discoverErr,
  hasWorkspace,
  onTokenChange,
  onOpenIdChange,
  onRefreshTokenChange,
  onExpiresInChange,
  onDiscover,
  onBack,
}: CredentialsStageProps) {
  // Same disabled predicate as the legacy page.
  const discoverDisabled =
    discovering ||
    !token.trim() ||
    (platform === 'tiktok' && !openId.trim()) ||
    !hasWorkspace;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h2 className="font-display text-lg font-bold tracking-tight text-term-text">
          Paste credentials
        </h2>
        <p className="max-w-2xl text-xs leading-relaxed text-term-muted">
          {platform === 'tiktok' ? (
            <>
              Paste a TikTok <strong className="text-term-text">Business Center</strong>{' '}
              access token plus the <code className="text-term-text">open_id</code>{' '}
              returned by the BC OAuth callback. We&apos;ll call{' '}
              <code className="text-term-text">/business/get/</code> to validate
              and fetch the basic profile.
            </>
          ) : platform === 'threads' ? (
            <>
              Paste a long-lived <strong className="text-term-text">Threads</strong>{' '}
              user token (scopes <code className="text-term-text">threads_basic</code>{' '}
              + <code className="text-term-text">threads_manage_insights</code> +{' '}
              <code className="text-term-text">threads_read_replies</code> +{' '}
              <code className="text-term-text">threads_manage_mentions</code>).
              We&apos;ll call{' '}
              <code className="text-term-text">graph.threads.net/v1.0/me</code> to
              validate and fetch the connected user.
            </>
          ) : (
            <>
              Paste a Meta <strong className="text-term-text">User</strong> or{' '}
              <strong className="text-term-text">Page</strong> access token.
              We&apos;ll enumerate Pages this token can manage and (when present)
              the Instagram Business account linked to each Page.
            </>
          )}
        </p>
      </header>

      {!hasWorkspace && (
        <div
          role="alert"
          className="border border-term-warn/50 bg-term-warn/10 px-3 py-2 font-mono text-[11px] text-term-warn"
        >
          Pick a target workspace in the header before discovering. Without one
          the seed step is disabled so accounts don&apos;t accidentally land in{' '}
          <code>demo</code>.
        </div>
      )}

      <label className="flex flex-col gap-1.5">
        <FieldLabel>access token</FieldLabel>
        <textarea
          value={token}
          onChange={(e) => onTokenChange(e.target.value)}
          placeholder={tokenPlaceholder(platform)}
          spellCheck={false}
          rows={3}
          aria-label="Access token"
          className="w-full resize-y border border-term-line-2 bg-term-bg px-3 py-2 font-mono text-xs text-term-text outline-none transition-colors duration-150 placeholder:text-term-faint focus:border-term-mint"
        />
      </label>

      {platform === 'tiktok' && (
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1.5">
            <FieldLabel>open_id (required)</FieldLabel>
            <TermInput
              value={openId}
              onChange={(e) => onOpenIdChange(e.target.value)}
              placeholder="-000ZwowuI7N…"
              aria-label="open_id"
              spellCheck={false}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <FieldLabel>refresh_token (recommended)</FieldLabel>
            <TermInput
              value={refreshToken}
              onChange={(e) => onRefreshTokenChange(e.target.value)}
              placeholder="rft.6KRK…"
              aria-label="refresh_token"
              spellCheck={false}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <FieldLabel>expires_in seconds (optional)</FieldLabel>
            <TermInput
              value={expiresInS}
              onChange={(e) => onExpiresInChange(e.target.value)}
              placeholder="86400"
              inputMode="numeric"
              aria-label="expires_in seconds"
              spellCheck={false}
            />
          </label>
        </div>
      )}

      {discoverErr && (
        <div className="border border-term-danger/40 bg-term-danger/10 px-3 py-2 font-mono text-[11px] text-term-danger">
          {discoverErr}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <ActionChip
          variant="primary"
          disabled={discoverDisabled}
          onClick={onDiscover}
          className={cn(discovering && 'animate-pulse')}
        >
          {discovering ? 'discovering…' : 'discover ▸'}
        </ActionChip>
        <ActionChip variant="ghost" onClick={onBack}>
          ◂ platform
        </ActionChip>
      </div>
    </div>
  );
}
