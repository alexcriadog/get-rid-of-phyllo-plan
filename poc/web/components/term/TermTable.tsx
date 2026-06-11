import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface TermColumn<T> {
  key: string;
  header: string;
  align?: 'left' | 'right';
  render: (row: T) => ReactNode;
}

interface TermTableProps<T> {
  columns: TermColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** Row key to highlight with the mint active accent. */
  activeKey?: string | null;
  empty?: string;
  className?: string;
}

export default function TermTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  activeKey,
  empty = 'no rows',
  className,
}: TermTableProps<T>) {
  if (rows.length === 0) {
    return (
      <div className="px-3 py-6 text-center font-mono text-xs text-term-faint">
        &gt; {empty} <span className="animate-term-blink">▮</span>
      </div>
    );
  }
  return (
    <table className={cn('w-full border-collapse font-mono text-xs', className)}>
      <thead>
        <tr className="border-b border-term-line">
          {columns.map((c) => (
            <th
              key={c.key}
              scope="col"
              className={cn(
                'px-2 py-1.5 text-[10px] font-medium uppercase tracking-[0.1em] text-term-faint',
                c.align === 'right' ? 'text-right' : 'text-left',
              )}
            >
              {c.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const key = rowKey(row);
          const active = key === activeKey;
          return (
            <tr
              key={key}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onKeyDown={
                onRowClick
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onRowClick(row);
                      }
                    }
                  : undefined
              }
              tabIndex={onRowClick ? 0 : undefined}
              className={cn(
                'border-b border-term-line/60 last:border-b-0',
                onRowClick &&
                  'cursor-pointer transition-colors duration-150 hover:bg-term-raised focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-term-mint',
                active && 'bg-term-mint/5 shadow-[inset_2px_0_0_rgb(var(--term-mint))]',
              )}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={cn('px-2 py-1.5 text-term-text', c.align === 'right' && 'text-right')}
                >
                  {c.render(row)}
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
