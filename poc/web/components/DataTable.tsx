import { ReactNode, useMemo, useState } from 'react';

export type Column<T> = {
  key: string;
  label: string;
  sortable?: boolean;
  width?: number | string;
  render?: (row: T) => ReactNode;
  accessor?: (row: T) => string | number | null | undefined;
};

type Props<T> = {
  rows: T[];
  columns: Column<T>[];
  emptyLabel?: string;
  onRowClick?: (row: T) => void;
  rowKey?: (row: T, i: number) => string | number;
};

export default function DataTable<T>({
  rows,
  columns,
  emptyLabel = 'No rows.',
  onRowClick,
  rowKey,
}: Props<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const sortedRows = useMemo(() => {
    if (!sortKey) return rows;
    const col = columns.find((c) => c.key === sortKey);
    if (!col) return rows;
    const accessor =
      col.accessor ??
      ((r: T) =>
        (r as unknown as Record<string, unknown>)[sortKey] as
          | string
          | number
          | null
          | undefined);
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = accessor(a);
      const bv = accessor(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }, [rows, columns, sortKey, sortDir]);

  const onSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  if (!rows.length) {
    return (
      <div className="muted" style={{ padding: 'var(--space-4)', textAlign: 'center' }}>
        {emptyLabel}
      </div>
    );
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                style={{
                  width: c.width,
                  cursor: c.sortable ? 'pointer' : undefined,
                  userSelect: 'none',
                }}
                onClick={() => c.sortable && onSort(c.key)}
              >
                {c.label}
                {c.sortable && sortKey === c.key && (
                  <span style={{ marginLeft: 4, color: 'var(--accent)' }}>
                    {sortDir === 'asc' ? '▲' : '▼'}
                  </span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row, i) => (
            <tr
              key={rowKey ? rowKey(row, i) : i}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              style={{ cursor: onRowClick ? 'pointer' : undefined }}
            >
              {columns.map((c) => (
                <td key={c.key} style={{ width: c.width }}>
                  {c.render
                    ? c.render(row)
                    : (((row as unknown) as Record<string, unknown>)[c.key] as ReactNode) ?? '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
