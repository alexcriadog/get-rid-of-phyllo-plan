import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// Mock useLive
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
// Mock workspace-context — no workspace selected by default
// ---------------------------------------------------------------------------
vi.mock('@/lib/workspace-context', () => ({
  useWorkspaceFilter: () => ({
    slug: null,
    set: vi.fn(),
    withQuery: (url: string) => url,
  }),
}));

// ---------------------------------------------------------------------------
// Real selection store so selectAccount wires up correctly
// ---------------------------------------------------------------------------
import { resetSelection, getSelection } from '@/lib/term/selection';

// ---------------------------------------------------------------------------
// Canned data
// ---------------------------------------------------------------------------
const FUTURE_DATE = new Date(Date.now() + 30 * 86_400_000).toISOString();
const PAST_DATE = new Date(Date.now() - 2 * 86_400_000).toISOString();

const ACCOUNTS = [
  {
    id: '1',
    platform: 'instagram',
    handle: '@alice',
    status: 'ready',
    sync_tier: 'standard',
    token_expires_at: FUTURE_DATE,
    workspace_slug: 'acme',
    products: [
      { product: 'identity', last_success_at: PAST_DATE, freshness: 'green' },
    ],
  },
  {
    id: '2',
    platform: 'facebook',
    handle: '@bob',
    status: 'ready',
    sync_tier: 'standard',
    token_expires_at: null,
    workspace_slug: 'widgets',
    products: [],
  },
  {
    id: '3',
    platform: 'tiktok',
    handle: '@carol',
    status: 'paused',
    sync_tier: 'paused',
    token_expires_at: null,
    workspace_slug: 'acme',
    products: [],
  },
];

// ---------------------------------------------------------------------------
import AccountDirectoryPanel from '../AccountDirectoryPanel';

describe('AccountDirectoryPanel', () => {
  beforeEach(() => {
    resetSelection();
    mockRefresh.mockClear();
    mockLiveState = { data: null, error: null, loading: true, refresh: mockRefresh };
  });

  it('renders the connecting state when loading and no data', () => {
    render(<AccountDirectoryPanel />);
    expect(screen.getByText(/connecting/i)).toBeInTheDocument();
  });

  it('renders the API-down state when error and no data', () => {
    mockLiveState = {
      data: null,
      error: '503 Service Unavailable',
      loading: false,
      refresh: mockRefresh,
    };
    render(<AccountDirectoryPanel />);
    expect(screen.getByText('API UNREACHABLE')).toBeInTheDocument();
    expect(screen.getByText(/503/)).toBeInTheDocument();
  });

  it('renders account rows from data', () => {
    mockLiveState = {
      data: ACCOUNTS,
      error: null,
      loading: false,
      refresh: mockRefresh,
    };
    render(<AccountDirectoryPanel />);
    expect(screen.getByText('@alice')).toBeInTheDocument();
    expect(screen.getByText('@bob')).toBeInTheDocument();
    expect(screen.getByText('@carol')).toBeInTheDocument();
  });

  it('shows platform tag abbreviations for each account', () => {
    mockLiveState = {
      data: ACCOUNTS,
      error: null,
      loading: false,
      refresh: mockRefresh,
    };
    render(<AccountDirectoryPanel />);
    expect(screen.getByText('[IG]')).toBeInTheDocument();
    expect(screen.getByText('[FB]')).toBeInTheDocument();
  });

  it('shows the workspace column when no workspace is scoped', () => {
    mockLiveState = {
      data: ACCOUNTS,
      error: null,
      loading: false,
      refresh: mockRefresh,
    };
    render(<AccountDirectoryPanel />);
    expect(screen.getByText('Workspace')).toBeInTheDocument();
    // Two accounts share 'acme', so multiple elements are expected
    expect(screen.getAllByText('acme').length).toBeGreaterThanOrEqual(1);
  });

  it('filters rows by free text', async () => {
    mockLiveState = {
      data: ACCOUNTS,
      error: null,
      loading: false,
      refresh: mockRefresh,
    };
    render(<AccountDirectoryPanel />);

    const input = screen.getByRole('textbox', { name: /filter accounts/i });
    await userEvent.type(input, 'alice');

    expect(screen.getByText('@alice')).toBeInTheDocument();
    expect(screen.queryByText('@bob')).not.toBeInTheDocument();
    expect(screen.queryByText('@carol')).not.toBeInTheDocument();
  });

  it('filters rows by platform facet', async () => {
    mockLiveState = {
      data: ACCOUNTS,
      error: null,
      loading: false,
      refresh: mockRefresh,
    };
    render(<AccountDirectoryPanel />);

    const fbChip = screen.getByRole('button', { name: /^FB$/i });
    await userEvent.click(fbChip);

    expect(screen.getByText('@bob')).toBeInTheDocument();
    expect(screen.queryByText('@alice')).not.toBeInTheDocument();
    expect(screen.queryByText('@carol')).not.toBeInTheDocument();
  });

  it('restores all rows when ALL facet is clicked after a platform facet', async () => {
    mockLiveState = {
      data: ACCOUNTS,
      error: null,
      loading: false,
      refresh: mockRefresh,
    };
    render(<AccountDirectoryPanel />);

    await userEvent.click(screen.getByRole('button', { name: /^IG$/i }));
    expect(screen.queryByText('@bob')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /^ALL$/i }));
    expect(screen.getByText('@bob')).toBeInTheDocument();
  });

  it('calls selectAccount with the account id when a row is clicked', async () => {
    mockLiveState = {
      data: ACCOUNTS,
      error: null,
      loading: false,
      refresh: mockRefresh,
    };
    render(<AccountDirectoryPanel />);

    const row = screen.getByText('@alice').closest('tr');
    expect(row).not.toBeNull();
    await userEvent.click(row!);

    expect(getSelection().accountId).toBe('1');
  });

  it('highlights the active row with the mint accent class after selection', async () => {
    mockLiveState = {
      data: ACCOUNTS,
      error: null,
      loading: false,
      refresh: mockRefresh,
    };
    render(<AccountDirectoryPanel />);

    const row = screen.getByText('@alice').closest('tr');
    await userEvent.click(row!);

    // TermTable applies shadow-[inset_2px_0_0_rgb(var(--term-mint))] on the active row
    await waitFor(() => {
      expect(row!.className).toMatch(/shadow-\[inset/);
    });
  });

  it('shows the count badge updating after filter text is typed', async () => {
    mockLiveState = {
      data: ACCOUNTS,
      error: null,
      loading: false,
      refresh: mockRefresh,
    };
    render(<AccountDirectoryPanel />);

    expect(screen.getByText('3/3')).toBeInTheDocument();

    const input = screen.getByRole('textbox', { name: /filter accounts/i });
    await userEvent.type(input, 'alice');

    expect(screen.getByText('1/3')).toBeInTheDocument();
  });

  it('renders ACCOUNTS header when data is loaded', () => {
    mockLiveState = {
      data: ACCOUNTS,
      error: null,
      loading: false,
      refresh: mockRefresh,
    };
    render(<AccountDirectoryPanel />);
    expect(screen.getByText('ACCOUNTS')).toBeInTheDocument();
  });

  it('shows empty state message when no rows match filter', async () => {
    mockLiveState = {
      data: ACCOUNTS,
      error: null,
      loading: false,
      refresh: mockRefresh,
    };
    render(<AccountDirectoryPanel />);

    const input = screen.getByRole('textbox', { name: /filter accounts/i });
    await userEvent.type(input, 'zzznomatch');

    expect(screen.getByText(/no accounts match filter/i)).toBeInTheDocument();
  });

  it('does not render API-down when stale data is present alongside an error', () => {
    mockLiveState = {
      data: ACCOUNTS,
      error: 'timeout',
      loading: false,
      refresh: mockRefresh,
    };
    render(<AccountDirectoryPanel />);
    expect(screen.queryByText('API UNREACHABLE')).not.toBeInTheDocument();
    expect(screen.getByText('@alice')).toBeInTheDocument();
  });
});
