import * as React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface SectionProps {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
  bare?: boolean;
}

export function Section({
  title,
  description,
  actions,
  children,
  className,
  contentClassName,
  bare,
}: SectionProps) {
  const hasHeader = Boolean(title || description || actions);
  return (
    <Card className={cn('mb-5', className)}>
      {hasHeader && (
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0 pb-4">
          <div className="space-y-1">
            {title && <CardTitle>{title}</CardTitle>}
            {description && <CardDescription>{description}</CardDescription>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </CardHeader>
      )}
      <CardContent
        className={cn(
          bare ? 'p-0' : 'pt-0',
          !hasHeader && 'pt-5',
          contentClassName,
        )}
      >
        {children}
      </CardContent>
    </Card>
  );
}
