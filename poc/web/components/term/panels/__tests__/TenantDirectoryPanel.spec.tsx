import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  resetSelection,
  getSelection,
  selectWorkspace,
} from '@/lib/term/selection';

// ---------------------------------------------------------------------------
// Mock useLive — returns canned data via a controllable ref.
// ---------------------------------------------------------------------------
type LiveState<T> = {
  data: T | null;
  error: string | null;
  loading: boolean;
  refresh: () => void;
};

const mockRefresh = vi.fn();
let mockLiveState: LiveState<unknown> = {
  data: null,
  error: null,
  loading: true,
  refresh: mockRefresh,
};

vi.mock('@/lib/useLive', () => ({
  POLL: { live: 3000, list: 5000, config: 15000, catalog: 30000 },
  useLive: () => mockLiveState,
}));

// ---------------------------------------------------------------------------
// Canned workspace data — synthetic only, no production values.
// ---------------------------------------------------------------------------
type Workspace = {
  id: string;
  slug: string;
  name: string;
  plan_tier: string;
  created_at: string;
  account_count: number;
  api_key_count: number;
};

const WORKSPACES: Workspace[] = [
  {
    id: 'uuid-1',
    slug: 'acme',
    name: 'ACME Corp',
    plan_tier: 'pro',
    created_at: '2025-01-01T00:00:00Z',
    account_count: 5,
    api_key_count: 2,
  },
  {
    id: 'uuid-2',
    slug: 'globex',
    name: 'Globex Inc',
    plan_tier: 'free',
    created_at: '2025-02-01T00:00:00Z',
    account_count: 1,
    api_key_count: 1,
  },
];

// ---------------------------------------------------------------------------
import TenantDirectoryPanel from '../TenantDirectoryPanel';

describe('TenantDirectoryPanel', () => {
  beforeEach(() => {
    mockRefresh.mockClear();
    resetSelection();
    mockLiveState = { data: null, error: null, loading: true, refresh: mockRefresh };
  });

  it('renders connecting state when loading with no data', () => {
    render(<TenantDirectoryPanel />);
    expect(screen.getByText(/connecting/i)).toBeInTheDocument();
  });

  it('renders workspace rows from data', () => {
    mockLiveState = { data: WORKSPACES, error: null, loading: false, refresh: mockRefresh };
    render(<TenantDirectoryPanel />);
    expect(screen.getByText('acme')).toBeInTheDocument();
    expect(screen.getByText('ACME Corp')).toBeInTheDocument();
    expect(screen.getByText('globex')).toBeInTheDocument();
    expect(screen.getByText('Globex Inc')).toBeInTheDocument();
  });

  it('renders account and key counts', () => {
    mockLiveState = { data: WORKSPACES, error: null, loading: false, refresh: mockRefresh };
    render(<TenantDirectoryPanel />);
    // ACME has 5 accounts — unique value, safe to use getByText
    expect(screen.getByText('5')).toBeInTheDocument();
    // Globex has 1 account and 1 key — multiple "1" cells are expected
    expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(1);
  });

  it('renders API unreachable state when error with no data', () => {
    mockLiveState = {
      data: null,
      error: '503 Service Unavailable',
      loading: false,
      refresh: mockRefresh,
    };
    render(<TenantDirectoryPanel />);
    expect(screen.getByText('API UNREACHABLE')).toBeInTheDocument();
    expect(screen.getByText(/503/)).toBeInTheDocument();
  });

  it('does not show API unreachable when data is present alongside error', () => {
    mockLiveState = {
      data: WORKSPACES,
      error: 'network timeout',
      loading: false,
      refresh: mockRefresh,
    };
    render(<TenantDirectoryPanel />);
    expect(screen.queryByText('API UNREACHABLE')).not.toBeInTheDocument();
    expect(screen.getByText('acme')).toBeInTheDocument();
  });

  it('narrows rows when the user types in the filter input', async () => {
    mockLiveState = { data: WORKSPACES, error: null, loading: false, refresh: mockRefresh };
    render(<TenantDirectoryPanel />);

    const input = screen.getByRole('textbox', { name: /filter workspaces/i });
    await userEvent.type(input, 'acme');

    expect(screen.getByText('acme')).toBeInTheDocument();
    expect(screen.queryByText('globex')).not.toBeInTheDocument();
  });

  it('filters by workspace name as well as slug', async () => {
    mockLiveState = { data: WORKSPACES, error: null, loading: false, refresh: mockRefresh };
    render(<TenantDirectoryPanel />);

    const input = screen.getByRole('textbox', { name: /filter workspaces/i });
    await userEvent.type(input, 'Globex');

    expect(screen.getByText('globex')).toBeInTheDocument();
    expect(screen.queryByText('acme')).not.toBeInTheDocument();
  });

  it('shows all rows when filter is cleared', async () => {
    mockLiveState = { data: WORKSPACES, error: null, loading: false, refresh: mockRefresh };
    render(<TenantDirectoryPanel />);

    const input = screen.getByRole('textbox', { name: /filter workspaces/i });
    await userEvent.type(input, 'acme');
    await userEvent.clear(input);

    expect(screen.getByText('acme')).toBeInTheDocument();
    expect(screen.getByText('globex')).toBeInTheDocument();
  });

  it('calls selectWorkspace with the slug when a row is clicked', async () => {
    mockLiveState = { data: WORKSPACES, error: null, loading: false, refresh: mockRefresh };
    render(<TenantDirectoryPanel />);

    const slugCell = screen.getByText('acme');
    const row = slugCell.closest('tr');
    expect(row).toBeTruthy();
    await userEvent.click(row!);

    expect(getSelection().workspaceSlug).toBe('acme');
  });

  it('applies active accent class to the selected row', async () => {
    mockLiveState = { data: WORKSPACES, error: null, loading: false, refresh: mockRefresh };
    // Pre-select acme before rendering so the initial render shows the accent.
    selectWorkspace('acme');
    render(<TenantDirectoryPanel />);

    const row = screen.getByText('acme').closest('tr');
    // TermTable applies bg-term-mint/5 when activeKey matches rowKey.
    expect(row?.className).toContain('bg-term-mint/5');
  });

  it('updates the active row when a different workspace is clicked', async () => {
    mockLiveState = { data: WORKSPACES, error: null, loading: false, refresh: mockRefresh };
    selectWorkspace('acme');
    render(<TenantDirectoryPanel />);

    const globexRow = screen.getByText('globex').closest('tr');
    await userEvent.click(globexRow!);

    expect(getSelection().workspaceSlug).toBe('globex');
  });

  it('shows "no workspaces" empty state when data is an empty array', () => {
    mockLiveState = { data: [], error: null, loading: false, refresh: mockRefresh };
    render(<TenantDirectoryPanel />);
    expect(screen.getByText(/no workspaces/i)).toBeInTheDocument();
  });

  it('shows the filter counter in the header', () => {
    mockLiveState = { data: WORKSPACES, error: null, loading: false, refresh: mockRefresh };
    render(<TenantDirectoryPanel />);
    // 2/2 when no filter is applied
    expect(screen.getByText('2/2')).toBeInTheDocument();
  });
});
