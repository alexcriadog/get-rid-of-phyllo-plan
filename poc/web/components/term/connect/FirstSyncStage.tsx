/**
 * Stage 04 — FIRST SYNC. The legacy page has no dedicated polling step; the
 * seed response already tells us how many sync_jobs were queued. This stage
 * surfaces every seed result (success + error) from the studio's `results`
 * map as FeedLine rows — the term-native completion view.
 *
 * No new endpoints: it reads the same `results` the CONNECT stage wrote.
 */

import Link from 'next/link';
import FeedLine from '@/components/term/FeedLine';
import ActionChip from '@/components/term/ActionChip';
import type { ResultMap } from './types';
import { asSeedSuccess, asSeedError } from './types';

interface FirstSyncStageProps {
  results: ResultMap;
  onBack: () => void;
  onReset: () => void;
}

/** Split a `${platform}:${id}` connect-key into its parts. */
function parseKey(key: string): { platform: string; id: string } {
  const idx = key.indexOf(':');
  if (idx < 0) return { platform: key, id: '' };
  return { platform: key.slice(0, idx), id: key.slice(idx + 1) };
}

export default function FirstSyncStage({ results, onBack, onReset }: FirstSyncStageProps) {
  const entries = Object.entries(results);
  const successes = entries.filter(([, r]) => asSeedSuccess(r));
  const failures = entries.filter(([, r]) => asSeedError(r));

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h2 className="font-display text-lg font-bold tracking-tight text-term-text">
          First sync
        </h2>
        <p className="text-xs text-term-muted">
          {entries.length === 0
            ? 'No accounts seeded yet. Connect one in the previous stage to queue its first sync.'
            : `${successes.length} seeded · ${failures.length} failed · sync jobs queued on the connector.`}
        </p>
      </header>

      <section className="border border-term-line bg-term-surface">
        <div className="flex items-center gap-2 border-b border-term-line px-3 py-2">
          <span aria-hidden="true" className="text-term-mint">
            ●
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-term-faint">
            seed results
          </span>
          <span className="ml-auto font-mono text-[10px] text-term-faint">
            {entries.length} total
          </span>
        </div>

        <div className="px-3 py-2">
          {entries.length === 0 && (
            <div className="font-mono text-xs text-term-faint">
              — no seeds yet —
            </div>
          )}

          {entries.map(([key, result]) => {
            const { platform, id } = parseKey(key);
            const ok = asSeedSuccess(result);
            const err = asSeedError(result);
            if (ok) {
              return (
                <FeedLine
                  key={key}
                  time={`acc #${ok.account_id}`}
                  platform={platform}
                  status={{
                    text: `OK · ${ok.sync_jobs_created.length} sync_jobs`,
                    tone: 'ok',
                  }}
                >
                  <Link
                    href={`/account/${ok.account_id}`}
                    className="text-term-text/90 underline-offset-2 hover:text-term-mint hover:underline"
                  >
                    {id || ok.account_id} → view account
                  </Link>
                </FeedLine>
              );
            }
            return (
              <FeedLine
                key={key}
                time={id ? id.slice(0, 12) : '—'}
                platform={platform}
                status={{ text: 'ERR', tone: 'danger' }}
              >
                {err}
              </FeedLine>
            );
          })}
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <ActionChip variant="ghost" onClick={onBack}>
          ◂ connect
        </ActionChip>
        <ActionChip onClick={onReset}>connect another ▸</ActionChip>
      </div>
    </div>
  );
}
