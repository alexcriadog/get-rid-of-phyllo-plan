/**
 * TikTok + Threads single-account cards for Stage 03 (CONNECT). Term-restyled
 * ports of the legacy TikTokAccountCard / ThreadsAccountCard. Behaviour is
 * unchanged: render the discovered profile and fire the seed callback the
 * studio supplies (which builds the exact same SeedBody as before).
 */

import Link from 'next/link';
import PlatformTag from '@/components/term/PlatformTag';
import ActionChip from '@/components/term/ActionChip';
import { fmtNumber } from '@/lib/format';
import type {
  TikTokDiscoveredAccount,
  ThreadsDiscoveredAccount,
  SeedResponse,
} from './types';
import { asSeedSuccess, asSeedError } from './types';

function ResultLine({ ok, err }: { ok: SeedResponse | null; err: string | null }) {
  if (ok) {
    return (
      <div className="flex flex-col items-end gap-1 font-mono text-[10px]">
        <span className="text-term-mint">
          ✓ acc #{ok.account_id} · {ok.sync_jobs_created.length} sync_jobs
        </span>
        <Link
          href={`/account/${ok.account_id}`}
          className="text-term-mint underline-offset-2 hover:underline"
        >
          view account →
        </Link>
      </div>
    );
  }
  if (err) {
    return <span className="font-mono text-[10px] text-term-danger">{err}</span>;
  }
  return null;
}

function Avatar({ url, alt, fallback }: { url: string | null; alt: string; fallback: string }) {
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={alt}
        referrerPolicy="no-referrer"
        className="h-14 w-14 shrink-0 border border-term-line object-cover"
      />
    );
  }
  return (
    <div className="grid h-14 w-14 shrink-0 place-items-center border border-term-line bg-term-line/20 font-mono text-sm text-term-faint">
      {fallback}
    </div>
  );
}

export function TikTokAccountCard({
  account,
  busy,
  result,
  onConnect,
}: {
  account: TikTokDiscoveredAccount;
  busy: boolean;
  result?: SeedResponse | string;
  onConnect: () => Promise<void> | void;
}) {
  const handle = account.username
    ? `@${account.username}`
    : account.display_name ?? '—';
  const ok = asSeedSuccess(result);
  const err = asSeedError(result);

  return (
    <div className="grid gap-4 border border-term-line bg-term-surface p-4 md:grid-cols-[1fr_auto] md:items-center">
      <div className="flex items-center gap-4">
        <Avatar url={account.profile_image} alt={`${handle} avatar`} fallback="tt" />
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <PlatformTag platform="tiktok" />
            <span className="font-mono text-sm font-semibold text-term-text">
              {handle}
            </span>
            {account.is_verified && (
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-term-mint">
                verified
              </span>
            )}
            {account.already_connected && (
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-term-uv-tint">
                already connected
              </span>
            )}
          </div>
          <div className="font-mono text-[11px] text-term-muted">
            {account.display_name && account.username
              ? `${account.display_name} · `
              : ''}
            {fmtNumber(account.followers_count ?? 0)} followers
            {account.videos_count != null && (
              <> · {fmtNumber(account.videos_count)} videos</>
            )}
            {account.total_likes != null && (
              <> · {fmtNumber(account.total_likes)} ♥ lifetime</>
            )}
          </div>
          <div className="font-mono text-[10px] text-term-faint">
            open_id {account.open_id.slice(0, 14)}…
          </div>
        </div>
      </div>
      <div className="flex flex-col items-end gap-2">
        <ActionChip variant="primary" onClick={onConnect} disabled={busy}>
          {busy ? 'connecting…' : ok ? 'reseed' : 'connect ▸'}
        </ActionChip>
        <ResultLine ok={ok} err={err} />
      </div>
    </div>
  );
}

export function ThreadsAccountCard({
  account,
  busy,
  result,
  onConnect,
}: {
  account: ThreadsDiscoveredAccount;
  busy: boolean;
  result?: SeedResponse | string;
  onConnect: () => Promise<void> | void;
}) {
  const handle = account.username
    ? `@${account.username}`
    : account.name ?? '—';
  const ok = asSeedSuccess(result);
  const err = asSeedError(result);

  return (
    <div className="grid gap-4 border border-term-line bg-term-surface p-4 md:grid-cols-[1fr_auto] md:items-center">
      <div className="flex items-center gap-4">
        <Avatar
          url={account.profile_picture_url}
          alt={`${handle} avatar`}
          fallback="th"
        />
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <PlatformTag platform="threads" />
            <span className="font-mono text-sm font-semibold text-term-text">
              {handle}
            </span>
            {account.is_verified && (
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-term-mint">
                verified
              </span>
            )}
            {account.already_connected && (
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-term-uv-tint">
                already connected
              </span>
            )}
          </div>
          <div className="font-mono text-[11px] text-term-muted">
            {account.name && account.username ? `${account.name} · ` : ''}
            user_id {account.user_id}
          </div>
          {account.biography && (
            <div className="line-clamp-2 max-w-[480px] text-[11px] text-term-muted/80">
              {account.biography}
            </div>
          )}
        </div>
      </div>
      <div className="flex flex-col items-end gap-2">
        <ActionChip variant="primary" onClick={onConnect} disabled={busy}>
          {busy ? 'connecting…' : ok ? 'reseed' : 'connect ▸'}
        </ActionChip>
        <ResultLine ok={ok} err={err} />
      </div>
    </div>
  );
}
