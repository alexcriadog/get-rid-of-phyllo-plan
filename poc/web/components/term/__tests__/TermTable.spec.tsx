import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TermTable, { type TermColumn } from '../TermTable';

interface Row {
  id: string;
  name: string;
  status: string;
}

const columns: TermColumn<Row>[] = [
  { key: 'name', header: 'Account', render: (r) => r.name },
  { key: 'status', header: 'Status', align: 'right', render: (r) => r.status },
];
const rows: Row[] = [
  { id: 'a', name: '@glossier', status: 'live' },
  { id: 'b', name: '@nike', status: 'expired' },
];

describe('TermTable', () => {
  it('renders headers and cells', () => {
    render(<TermTable columns={columns} rows={rows} rowKey={(r) => r.id} />);
    expect(screen.getByText('Account')).toBeInTheDocument();
    expect(screen.getByText('@glossier')).toBeInTheDocument();
    expect(screen.getByText('expired')).toBeInTheDocument();
  });
  it('renders the terminal empty state', () => {
    render(<TermTable columns={columns} rows={[]} rowKey={(r: Row) => r.id} empty="no accounts" />);
    expect(screen.getByText(/no accounts/)).toBeInTheDocument();
  });
  it('fires onRowClick with the row', async () => {
    const onRowClick = vi.fn();
    render(<TermTable columns={columns} rows={rows} rowKey={(r) => r.id} onRowClick={onRowClick} />);
    await userEvent.click(screen.getByText('@nike'));
    expect(onRowClick).toHaveBeenCalledWith(rows[1]);
  });
});
