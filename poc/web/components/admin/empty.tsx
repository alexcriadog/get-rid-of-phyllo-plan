import * as React from 'react';
import { cn } from '@/lib/utils';

interface EmptyProps {
  message: string;
  icon?: React.ReactNode;
  className?: string;
}

export function Empty({ message, icon, className }: EmptyProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border/70 bg-card/30 px-6 py-10 text-center text-xs text-muted-foreground',
        className,
      )}
    >
      {icon && <div className="text-muted-foreground/60">{icon}</div>}
      <span>{message}</span>
    </div>
  );
}
