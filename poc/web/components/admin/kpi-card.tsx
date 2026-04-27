import * as React from 'react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'primary' | 'muted';

interface KpiCardProps {
  label: string;
  value: React.ReactNode;
  sublabel?: React.ReactNode;
  tone?: Tone;
  icon?: React.ReactNode;
  className?: string;
}

const TONE: Record<Tone, { accent: string; text: string }> = {
  ok: { accent: 'before:bg-ok', text: 'text-ok' },
  warn: { accent: 'before:bg-warn', text: 'text-warn' },
  danger: { accent: 'before:bg-danger', text: 'text-danger' },
  info: { accent: 'before:bg-info', text: 'text-info' },
  primary: { accent: 'before:bg-primary', text: 'text-primary' },
  muted: { accent: 'before:bg-muted-foreground/40', text: 'text-foreground' },
};

export function KpiCard({
  label,
  value,
  sublabel,
  tone = 'primary',
  icon,
  className,
}: KpiCardProps) {
  const t = TONE[tone];
  return (
    <Card
      className={cn(
        'relative overflow-hidden p-5 before:absolute before:left-0 before:top-0 before:h-full before:w-[3px] before:content-[""]',
        t.accent,
        className,
      )}
    >
      <div className="flex items-start justify-between">
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          {label}
        </div>
        {icon && <div className="text-muted-foreground/70">{icon}</div>}
      </div>
      <div
        className={cn(
          'mt-2 font-mono text-[28px] font-semibold leading-none tracking-tight',
          t.text,
        )}
      >
        {value}
      </div>
      {sublabel && (
        <div className="mt-2 font-mono text-[10.5px] text-muted-foreground/80">
          {sublabel}
        </div>
      )}
    </Card>
  );
}
