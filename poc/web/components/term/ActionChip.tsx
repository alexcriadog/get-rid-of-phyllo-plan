import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const actionChipVariants = cva(
  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-none font-mono text-[11px] font-medium uppercase tracking-[0.08em] transition-[background-color,border-color,color,transform] duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-term-mint focus-visible:ring-offset-1 focus-visible:ring-offset-term-bg active:translate-y-px disabled:pointer-events-none disabled:opacity-40',
  {
    variants: {
      variant: {
        primary: 'bg-term-mint font-bold text-term-mint-ink hover:bg-term-mint/85',
        action: 'border border-term-mint text-term-mint hover:bg-term-mint hover:text-term-mint-ink',
        ghost: 'border border-term-line-2 text-term-muted hover:border-term-faint hover:text-term-text',
        destructive: 'border border-term-danger text-term-danger hover:bg-term-danger hover:text-term-bg',
      },
      size: {
        sm: 'h-6 px-2',
        md: 'h-7 px-3',
      },
    },
    defaultVariants: { variant: 'action', size: 'md' },
  },
);

export interface ActionChipProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof actionChipVariants> {}

const ActionChip = React.forwardRef<HTMLButtonElement, ActionChipProps>(
  ({ className, variant, size, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(actionChipVariants({ variant, size, className }))}
      {...props}
    />
  ),
);
ActionChip.displayName = 'ActionChip';

export default ActionChip;
