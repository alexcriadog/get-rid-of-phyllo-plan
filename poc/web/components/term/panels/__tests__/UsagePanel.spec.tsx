import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// Mock useLive — controllable ref so individual tests can vary the payload.
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
// Canned data — matches the real /admin/usage?days=<n> response structure.
// ---------------------------------------------------------------------------
const USAGE_DATA = {
  days: ['2026-06-05', '2026-06-06', '2026-06-07'],
  workspaces: [
    {
      id: 'ws_aaa',
      slug: 'acme',
      name: 'Acme Corp',
      counts: [12, 0, 45],
      total: 57,
    },
    {
      id: 'ws_bbb',
      slug: 'globex',
      name: 'Globex',
      counts: [5, 80, 20],
      total: 105,
    },
  ],
};

const EMPTY_USAGE = {
  days: [] as string[],
  workspaces: [] as typeof USAGE_DATA.workspaces,
};

// ---------------------------------------------------------------------------
import UsagePanel from '../UsagePanel';

describe('UsagePanel', () => {
  beforeEach(() => {
    mockRefresh.mockClear();
    mockLiveState = { data: null, error: null, loading: true, refresh: mockRefresh };
  });

  it('renders the connecting state when loading and no data', () => {
    mockLiveState = { data: null, error: null, loading: true, refresh: mockRefresh };
    render(<UsagePanel />);
    expect(screen.getByText(/connecting/i)).toBeInTheDocument();
  });

  it('renders the api-down state when error and no data', () => {
    mockLiveState = {
      data: null,
      error: '503 Service Unavailable',
      loading: false,
      refresh: mockRefresh,
    };
    render(<UsagePanel />);
    expect(screen.getByText('API UNREACHABLE')).toBeInTheDocument();
    expect(screen.getByText(/503/)).toBeInTheDocument();
  });

  it('does NOT render api-down when data is present alongside an error', () => {
    mockLiveState = {
      data: USAGE_DATA,
      error: 'stale',
      loading: false,
      refresh: mockRefresh,
    };
    render(<UsagePanel />);
    expect(screen.queryByText('API UNREACHABLE')).not.toBeInTheDocument();
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
  });

  it('renders workspace names and slugs', () => {
    mockLiveState = { data: USAGE_DATA, error: null, loading: false, refresh: mockRefresh };
    render(<UsagePanel />);
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    expect(screen.getByText('acme')).toBeInTheDocument();
    expect(screen.getByText('Globex')).toBeInTheDocument();
    expect(screen.getByText('globex')).toBeInTheDocument();
  });

  it('renders date columns in MM-DD format', () => {
    mockLiveState = { data: USAGE_DATA, error: null, loading: false, refresh: mockRefresh };
    render(<UsagePanel />);
    expect(screen.getByText('06-05')).toBeInTheDocument();
    expect(screen.getByText('06-06')).toBeInTheDocument();
    expect(screen.getByText('06-07')).toBeInTheDocument();
  });

  it('renders a · placeholder for zero-count cells', () => {
    mockLiveState = { data: USAGE_DATA, error: null, loading: false, refresh: mockRefresh };
    render(<UsagePanel />);
    // Acme Corp has a 0 on 06-06
    const dots = screen.getAllByText('·');
    expect(dots.length).toBeGreaterThan(0);
  });

  it('renders heat cells for non-zero counts', () => {
    mockLiveState = { data: USAGE_DATA, error: null, loading: false, refresh: mockRefresh };
    render(<UsagePanel />);
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('45')).toBeInTheDocument();
    expect(screen.getByText('80')).toBeInTheDocument();
  });

  it('renders total column values', () => {
    mockLiveState = { data: USAGE_DATA, error: null, loading: false, refresh: mockRefresh };
    render(<UsagePanel />);
    expect(screen.getByText('57')).toBeInTheDocument();
    expect(screen.getByText('105')).toBeInTheDocument();
  });

  it('renders MiniBar meters for totals', () => {
    mockLiveState = { data: USAGE_DATA, error: null, loading: false, refresh: mockRefresh };
    render(<UsagePanel />);
    const meters = screen.getAllByRole('meter');
    expect(meters.length).toBeGreaterThanOrEqual(2);
  });

  it('shows empty state when workspaces array is empty', () => {
    mockLiveState = { data: EMPTY_USAGE, error: null, loading: false, refresh: mockRefresh };
    render(<UsagePanel />);
    expect(screen.getByText(/no telemetry yet/i)).toBeInTheDocument();
  });

  it('renders the range selector buttons', () => {
    mockLiveState = { data: USAGE_DATA, error: null, loading: false, refresh: mockRefresh };
    render(<UsagePanel />);
    expect(screen.getByText('7d')).toBeInTheDocument();
    expect(screen.getByText('14d')).toBeInTheDocument();
    expect(screen.getByText('30d')).toBeInTheDocument();
    expect(screen.getByText('90d')).toBeInTheDocument();
  });

  it('marks the default range (7d) as active on first render', () => {
    mockLiveState = { data: USAGE_DATA, error: null, loading: false, refresh: mockRefresh };
    render(<UsagePanel />);
    const btn7d = screen.getByText('7d').closest('button');
    expect(btn7d).toHaveAttribute('aria-pressed', 'true');
  });

  it('changes the active range when a range button is clicked', async () => {
    mockLiveState = { data: USAGE_DATA, error: null, loading: false, refresh: mockRefresh };
    render(<UsagePanel />);
    const btn30d = screen.getByText('30d');
    await userEvent.click(btn30d);
    expect(btn30d.closest('button')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('7d').closest('button')).toHaveAttribute('aria-pressed', 'false');
  });

  it('renders the footer note about Redis retention', () => {
    mockLiveState = { data: USAGE_DATA, error: null, loading: false, refresh: mockRefresh };
    render(<UsagePanel />);
    expect(screen.getByText(/retained 90 d in Redis/i)).toBeInTheDocument();
  });
});
