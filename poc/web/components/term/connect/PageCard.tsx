/**
 * PageCard — Stage 03 (CONNECT) Meta result row. Term-restyled port of the
 * legacy PageCard + ConnectableCell. Each Page yields a Facebook cell and,
 * when present, the linked Instagram Business cell. The seed bodies are built
 * exactly as before:
 *   · facebook  → page_token_ref, canonical_user_id=page_id, metadata.page_id
 *   · instagram → page_token_ref, canonical_user_id=ig_business_id, metadata.page_id
 */

import Link from 'next/link';
import PlatformTag from '@/components/term/PlatformTag';
import ActionChip from '@/components/term/ActionChip';
import { fmtNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import type {
  DiscoveredPage,
  ConnectKey,
  ConnectFn,
  ResultMap,
  SeedResponse,
} from './types';
import { asSeedSuccess, asSeedError } from './types';

interface PageCardProps {
  page: DiscoveredPage;
  busy: ConnectKey | null;
  results: ResultMap;
  onConnect: ConnectFn;
}

export default function PageCard({ page, busy, results, onConnect }: PageCardProps) {
  const fbKey: ConnectKey = `facebook:${page.page_id}`;
  const igKey: ConnectKey | null = page.instagram
    ? `instagram:${page.instagram.ig_business_id}`
    : null;

  return (
    <div className="grid gap-3 border border-term-line bg-term-surface p-4 md:grid-cols-2">
      <ConnectableCell
        platform="facebook"
        primary={page.page_name}
        secondary={`page_id · ${page.page_id}`}
        avatar={null}
        connected={page.page_already_connected}
        busy={busy === fbKey}
        result={results[fbKey]}
        onClick={() =>
          onConnect(fbKey, {
            platform: 'facebook',
            page_token_ref: page.page_token_ref,
            canonical_user_id: page.page_id,
            handle: page.page_name,
            metadata: { page_id: page.page_id },
          })
        }
      />

      {igKey && page.instagram ? (
        <ConnectableCell
          platform="instagram"
          primary={
            page.instagram.username
              ? `@${page.instagram.username}`
              : page.instagram.name ?? '—'
          }
          secondary={
            page.instagram.followers_count != null
              ? `${fmtNumber(page.instagram.followers_count)} followers · IG ${page.instagram.ig_business_id}`
              : `IG ${page.instagram.ig_business_id}`
          }
          avatar={page.instagram.profile_picture_url}
          connected={page.instagram.already_connected}
          busy={busy === igKey}
          result={results[igKey]}
          onClick={() =>
            onConnect(igKey, {
              platform: 'instagram',
              page_token_ref: page.page_token_ref,
              canonical_user_id: page.instagram!.ig_business_id,
              handle:
                page.instagram!.username ?? page.instagram!.name ?? undefined,
              metadata: { page_id: page.page_id },
            })
          }
        />
      ) : (
        <div className="grid place-items-center border border-dashed border-term-line-2 bg-term-bg/40 p-4 text-center font-mono text-[11px] text-term-faint">
          No Instagram Business account linked to this Page.
        </div>
      )}
    </div>
  );
}

function ConnectableCell({
  platform,
  primary,
  secondary,
  avatar,
  connected,
  busy,
  result,
  onClick,
}: {
  platform: 'facebook' | 'instagram';
  primary: string;
  secondary: string;
  avatar: string | null;
  connected: boolean;
  busy: boolean;
  result: SeedResponse | string | undefined;
  onClick: () => void;
}) {
  const ok = asSeedSuccess(result);
  const err = asSeedError(result);
  const succeeded = !!ok;
  const failed = !!err;

  return (
    <div
      className={cn(
        'flex flex-col gap-3 border bg-term-bg/40 p-3',
        connected || succeeded ? 'border-term-mint/40 bg-term-mint/5' : 'border-term-line',
      )}
    >
      <div className="flex items-center gap-2">
        <PlatformTag platform={platform} showLabel />
      </div>

      <div className="flex items-center gap-3">
        {avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatar}
            alt={primary}
            referrerPolicy="no-referrer"
            width={40}
            height={40}
            className="h-10 w-10 shrink-0 border border-term-line object-cover"
          />
        ) : (
          <div className="grid h-10 w-10 shrink-0 place-items-center border border-term-line bg-term-surface font-mono text-sm font-bold text-term-mint">
            {primary.replace(/^@/, '').charAt(0).toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <div className="truncate font-mono text-sm font-semibold text-term-text">
            {primary}
          </div>
          <div className="truncate font-mono text-[11px] text-term-muted">
            {secondary}
          </div>
        </div>
      </div>

      <div className="mt-auto space-y-2">
        {connected && !succeeded && (
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-term-mint">
            already connected
          </span>
        )}
        {succeeded && ok && (
          <div className="space-y-1 font-mono text-[10px]">
            <span className="text-term-mint">
              ✓ connected · acc #{ok.account_id} · {ok.sync_jobs_created.length} jobs
            </span>
            <Link
              href={`/account/${ok.account_id}`}
              className="block text-term-mint underline-offset-2 hover:underline"
            >
              view account →
            </Link>
          </div>
        )}
        {failed && (
          <div className="border border-term-danger/40 bg-term-danger/10 px-2 py-1.5 font-mono text-[10px] text-term-danger">
            {err}
          </div>
        )}

        {!connected && !succeeded && !failed && (
          <ActionChip
            variant="primary"
            className="w-full justify-center"
            onClick={onClick}
            disabled={busy}
          >
            {busy
              ? 'connecting…'
              : `connect ${platform === 'instagram' ? 'instagram' : 'facebook'} ▸`}
          </ActionChip>
        )}
        {(connected || succeeded || failed) && (
          <ActionChip
            variant="ghost"
            size="sm"
            className="w-full justify-center"
            onClick={onClick}
            disabled={busy}
          >
            {busy
              ? '…'
              : connected && !succeeded
                ? 'reconnect / refresh token'
                : 're-run'}
          </ActionChip>
        )}
      </div>
    </div>
  );
}
