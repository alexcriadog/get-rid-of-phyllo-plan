import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import PlatformTag from './PlatformTag';

export type FeedTone = 'ok' | 'queued' | 'warn' | 'danger';

const TONE_CLASS: Record<FeedTone, string> = {
  ok: 'text-term-mint',
  queued: 'text-term-uv-tint',
  warn: 'text-term-warn',
  danger: 'text-term-danger',
};

interface FeedLineProps {
  time: string;
  platform?: string;
  status?: { text: string; tone: FeedTone };
  children: ReactNode;
  className?: string;
}

export default function FeedLine({ time, platform, status, children, className }: FeedLineProps) {
  return (
    <div className={cn('flex items-baseline gap-2 font-mono text-xs leading-7', className)}>
      <span className="shrink-0 text-term-mint">{time}</span>
      {platform && <PlatformTag platform={platform} />}
      <span className="min-w-0 flex-1 truncate text-term-text/90">{children}</span>
      {status && <span className={cn('shrink-0', TONE_CLASS[status.tone])}>{status.text}</span>}
    </div>
  );
}
