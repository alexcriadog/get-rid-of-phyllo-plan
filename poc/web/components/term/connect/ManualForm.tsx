/**
 * ManualForm — "bypass discovery" paste flow. Term-restyled port of the legacy
 * ManualForm. Behaviour is unchanged: same fields, same key (`platform:id`),
 * same SeedBody (access_token + canonical_user_id + optional handle + optional
 * metadata.page_id). Used as the scripted/emergency fallback path.
 */

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import TermInput from '@/components/term/TermInput';
import ActionChip from '@/components/term/ActionChip';
import { cn } from '@/lib/utils';
import type { ConnectKey, ConnectFn, ResultMap } from './types';
import { asSeedSuccess, asSeedError } from './types';

interface ManualFormProps {
  onConnect: ConnectFn;
  busy: ConnectKey | null;
  results: ResultMap;
}

type ManualPlatform = 'instagram' | 'facebook';

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-term-faint">
      {children}
    </span>
  );
}

export default function ManualForm({ onConnect, busy, results }: ManualFormProps) {
  const [platform, setPlatform] = useState<ManualPlatform>('instagram');
  const [accessToken, setAccessToken] = useState('');
  const [canonicalId, setCanonicalId] = useState('');
  const [handle, setHandle] = useState('');
  const [pageId, setPageId] = useState('');

  const key: ConnectKey = `${platform}:${canonicalId}`;
  const result = results[key];
  const ok = asSeedSuccess(result);
  const err = asSeedError(result);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <FieldLabel>platform</FieldLabel>
        <div className="flex gap-1.5" role="group" aria-label="Manual platform">
          {(['instagram', 'facebook'] as ManualPlatform[]).map((p) => (
            <ActionChip
              key={p}
              size="sm"
              variant={platform === p ? 'primary' : 'ghost'}
              aria-pressed={platform === p}
              onClick={() => setPlatform(p)}
            >
              {p}
            </ActionChip>
          ))}
        </div>
      </div>

      <label className="flex flex-col gap-1.5">
        <FieldLabel>canonical user id</FieldLabel>
        <TermInput
          value={canonicalId}
          onChange={(e) => setCanonicalId(e.target.value)}
          placeholder={platform === 'instagram' ? '17841401234567890' : '105...'}
          aria-label="Canonical user ID"
        />
        <span className="font-mono text-[10px] text-term-faint">
          {platform === 'instagram'
            ? 'IG Business account id (e.g. 17841401234567890)'
            : 'Facebook Page id'}
        </span>
      </label>

      <label className="flex flex-col gap-1.5">
        <FieldLabel>access token</FieldLabel>
        <textarea
          rows={2}
          value={accessToken}
          onChange={(e) => setAccessToken(e.target.value)}
          placeholder="EAA…"
          aria-label="Manual access token"
          className="w-full resize-y border border-term-line-2 bg-term-bg px-3 py-2 font-mono text-xs text-term-text outline-none transition-colors duration-150 placeholder:text-term-faint focus:border-term-mint"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <FieldLabel>handle (optional)</FieldLabel>
        <TermInput
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          placeholder="@brand"
          aria-label="Handle"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <FieldLabel>page id (optional, recommended for IG)</FieldLabel>
        <TermInput
          value={pageId}
          onChange={(e) => setPageId(e.target.value)}
          placeholder="105..."
          aria-label="Page ID"
        />
      </label>

      <div>
        <ActionChip
          variant="primary"
          disabled={!accessToken || !canonicalId || busy === key}
          onClick={() =>
            onConnect(key, {
              platform,
              access_token: accessToken.trim(),
              canonical_user_id: canonicalId.trim(),
              handle: handle.trim() || undefined,
              metadata: pageId.trim() ? { page_id: pageId.trim() } : undefined,
            })
          }
          className={cn(busy === key && 'animate-pulse')}
        >
          {busy === key ? 'connecting…' : 'connect manually ▸'}
        </ActionChip>
      </div>

      {ok && (
        <div className="font-mono text-[11px] text-term-mint">
          ✓ account #{ok.account_id} · {ok.sync_jobs_created.length} jobs queued ·{' '}
          <Link
            href={`/account/${ok.account_id}`}
            className="underline-offset-2 hover:underline"
          >
            view account →
          </Link>
        </div>
      )}
      {err && (
        <div className="border border-term-danger/40 bg-term-danger/10 px-3 py-2 font-mono text-[11px] text-term-danger">
          {err}
        </div>
      )}
    </div>
  );
}
