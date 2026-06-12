/**
 * Stage 01 — PLATFORM. A term-styled gallery of the platforms the operator
 * can onboard. Maps 1:1 to the legacy Discover platform options:
 *   facebook → Meta (FB + IG) · tiktok → TikTok · threads → Threads
 *
 * Also surfaces the two real escape hatches the legacy page exposed:
 *   · connect-tool CTA (NEXT_PUBLIC_CONNECT_TOOL_URL ?? http://localhost:3002)
 *   · manual connect (bypass discovery)
 */

import PlatformTag from '@/components/term/PlatformTag';
import ActionChip from '@/components/term/ActionChip';
import { cn } from '@/lib/utils';
import type { DiscoverPlatform } from './types';

interface GalleryItem {
  platform: DiscoverPlatform;
  /** PlatformTag key for the glyph (Meta gallery card shows the FB tag). */
  tag: string;
  title: string;
  note: string;
  availability: string;
}

const GALLERY: GalleryItem[] = [
  {
    platform: 'facebook',
    tag: 'facebook',
    title: 'Meta · FB + IG',
    note: 'User or Page token → enumerate Pages + linked Instagram Business accounts.',
    availability: 'OAuth · discover',
  },
  {
    platform: 'tiktok',
    tag: 'tiktok',
    title: 'TikTok',
    note: 'Business Center access token + open_id → /business/get/ profile.',
    availability: 'BC token · discover',
  },
  {
    platform: 'threads',
    tag: 'threads',
    title: 'Threads',
    note: 'Long-lived user token → graph.threads.net/v1.0/me.',
    availability: 'user token · discover',
  },
];

interface PlatformGalleryStageProps {
  selected: DiscoverPlatform;
  onSelect: (platform: DiscoverPlatform) => void;
  onContinue: () => void;
  onManual: () => void;
  connectToolUrl: string;
}

export default function PlatformGalleryStage({
  selected,
  onSelect,
  onContinue,
  onManual,
  connectToolUrl,
}: PlatformGalleryStageProps) {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h2 className="font-display text-lg font-bold tracking-tight text-term-text">
          Choose a platform
        </h2>
        <p className="text-xs text-term-muted">
          Pick the network to onboard. We&apos;ll validate the token and
          enumerate connectable accounts in the next stages.
        </p>
      </header>

      <div
        role="radiogroup"
        aria-label="Platform"
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
      >
        {GALLERY.map((item) => {
          const isSelected = item.platform === selected;
          return (
            <button
              key={item.platform}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => onSelect(item.platform)}
              className={cn(
                'flex flex-col gap-3 border bg-term-surface p-4 text-left font-mono transition-colors duration-150',
                'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-term-mint',
                isSelected
                  ? 'border-term-mint bg-term-mint/5'
                  : 'border-term-line hover:border-term-mint/60 hover:bg-term-line/10',
              )}
            >
              <div className="flex items-center justify-between">
                <PlatformTag platform={item.tag} showLabel />
                <span
                  aria-hidden="true"
                  className={cn(
                    'grid h-4 w-4 place-items-center border text-[10px]',
                    isSelected
                      ? 'border-term-mint bg-term-mint text-term-mint-ink'
                      : 'border-term-line-2 text-transparent',
                  )}
                >
                  ✓
                </span>
              </div>
              <div className="text-sm font-semibold text-term-text">
                {item.title}
              </div>
              <p className="text-[11px] leading-relaxed text-term-muted">
                {item.note}
              </p>
              <div className="mt-auto text-[10px] uppercase tracking-[0.14em] text-term-faint">
                {item.availability}
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <ActionChip variant="primary" onClick={onContinue}>
          credentials ▸
        </ActionChip>
        <ActionChip variant="ghost" onClick={onManual}>
          manual connect (bypass)
        </ActionChip>
      </div>

      {/* connect-tool CTA — the primary, recommended path. The paste-token
          flow in the studio is the scripted/emergency fallback. */}
      <aside className="border border-term-line bg-term-surface p-4 font-mono text-[11px] leading-relaxed text-term-muted">
        <div className="mb-1 flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-term-mint">
            recommended
          </span>
          <span className="text-term-text">use connect-tool</span>
        </div>
        <p>
          The transient OAuth helper at{' '}
          <a
            href={connectToolUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-term-mint underline-offset-2 hover:underline"
          >
            {connectToolUrl} ↗
          </a>{' '}
          handles Facebook, Instagram, TikTok, Threads and YouTube end-to-end
          and POSTs the resulting tokens to{' '}
          <code className="text-term-text">/admin/connect/seed</code>. Click a
          platform, approve the OAuth dialog, done. See{' '}
          <code className="text-term-text">connect-tool/README.md</code> for the
          kill-switch.
        </p>
      </aside>
    </div>
  );
}
