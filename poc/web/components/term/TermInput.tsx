import * as React from 'react';
import { cn } from '@/lib/utils';

export type TermInputProps = React.InputHTMLAttributes<HTMLInputElement>;

const TermInput = React.forwardRef<HTMLInputElement, TermInputProps>(
  ({ className, ...props }, ref) => (
    <span
      className={cn(
        'inline-flex w-full items-center gap-1.5 border border-term-line-2 bg-term-bg px-2 font-mono text-xs text-term-text transition-colors duration-150 focus-within:border-term-mint',
        className,
      )}
    >
      <span aria-hidden="true" className="select-none text-term-mint">
        &gt;
      </span>
      <input
        ref={ref}
        className="h-7 w-full bg-transparent outline-none placeholder:text-term-faint"
        {...props}
      />
    </span>
  ),
);
TermInput.displayName = 'TermInput';

export default TermInput;
