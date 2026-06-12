import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// Mock useLive — two separate controllable states (account + calls)
// useLive is called twice per render. We distinguish by the path string:
//   calls path contains "account_id"; account path does not.
// ---------------------------------------------------------------------------
type LiveState<T> = {
  data: T | null;
  error: string | null;
  loading: boolean;
  refresh: () => void;
};

const mockAccountRefresh = vi.fn();
let mockAccountState: LiveState<unknown> = {
  data: null,
  error: null,
  loading: true,
  refresh: mockAccountRefresh,
};
let mockCallsState: LiveState<unknown> = {
  data: null,
  error: null,
  loading: false,
  refresh: vi.fn(),
};

vi.mock('@/lib/useLive', () => ({
  POLL: { live: 3000, list: 5000, config: 15000, catalog: 30000 },
  useLive: (path: string | null) => {
    if (path === null) {
      return { data: null, error: null, loading: false, refresh: vi.fn() };
    }
    if (path.includes('account_id')) return mockCallsState;
    return mockAccountState;
  },
}));

// ---------------------------------------------------------------------------
// Mock adminPost
// ---------------------------------------------------------------------------
const mockAdminPost = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/api', () => ({
  CONNECTOR_API_URL: 'http://localhost:3000',
  adminPost: (...args: unknown[]) => mockAdminPost(...args),
}));

// ---------------------------------------------------------------------------
// Selection store — real store, reset between tests
// ---------------------------------------------------------------------------
import { resetSelection, selectAccount } from '@/lib/term/selection';

// ---------------------------------------------------------------------------
// Canned data
// ---------------------------------------------------------------------------
const FUTURE_DATE = new Date(Date.now() + 30 * 86_400_000).toISOString();
const PAST_DATE = new Date(Date.now() - 2 * 86_400_000).toISOString();

const ACCOUNT_DATA = {
  id: '42',
  platform: 'instagram',
  handle: '@demo',
  status: 'ready',
  sync_tier: 'standard',
  token_expires_at: FUTURE_DATE,
  token_refreshable: true,
  workspace_slug: 'acme',
  canonical_user_id: 'IG_12345',
  connected_at: PAST_DATE,
  products: [
    { product: 'identity', last_success_at: PAST_DATE, freshness: 'green' },
    { product: 'engagement_new', last_success_at: PAST_DATE, freshness: 'green' },
  ],
  sync_jobs: [
    {
      id: 'job-1',
      product: 'identity',
      status: 'active',
      last_success_at: PAST_DATE,
      next_run_at: FUTURE_DATE,
      failure_count: 0,
    },
    {
      id: 'job-2',
      product: 'engagement_new',
      status: 'active',
      last_success_at: null,
      next_run_at: FUTURE_DATE,
      failure_count: 3,
      last_error: 'upstream 429 Too Many Requests',
    },
  ],
};

const CALLS_DATA = [
  {
    called_at: PAST_DATE,
    platform: 'instagram',
    endpoint: '/v1/me/media',
    status_code: 200,
    duration_ms: 143,
    account_id: '42',
  },
  {
    called_at: PAST_DATE,
    platform: 'instagram',
    endpoint: '/v1/me/insights',
    status_code: 429,
    duration_ms: 55,
    account_id: '42',
  },
];

// ---------------------------------------------------------------------------
import AccountInspectorPanel from '../AccountInspectorPanel';

describe('AccountInspectorPanel', () => {
  beforeEach(() => {
    resetSelection();
    mockAccountRefresh.mockClear();
    mockAdminPost.mockClear();
    mockAccountState = {
      data: null,
      error: null,
      loading: true,
      refresh: mockAccountRefresh,
    };
    mockCallsState = {
      data: null,
      error: null,
      loading: false,
      refresh: vi.fn(),
    };
  });

  // ── Empty state ─────────────────────────────────────────────────────────

  it('shows empty state when no account is selected', () => {
    render(<AccountInspectorPanel />);
    expect(screen.getByText(/select an account/i)).toBeInTheDocument();
    expect(screen.getByText('▮')).toBeInTheDocument();
  });

  it('shows loading state when account is selected but data is in flight', () => {
    selectAccount('42');
    mockAccountState = {
      data: null,
      error: null,
      loading: true,
      refresh: mockAccountRefresh,
    };
    render(<AccountInspectorPanel />);
    expect(screen.getByText(/loading account/i)).toBeInTheDocument();
  });

  it('shows API-down state when error and no data', () => {
    selectAccount('42');
    mockAccountState = {
      data: null,
      error: '503 Service Unavailable',
      loading: false,
      refresh: mockAccountRefresh,
    };
    render(<AccountInspectorPanel />);
    expect(screen.getByText('API UNREACHABLE')).toBeInTheDocument();
    expect(screen.getByText(/503/)).toBeInTheDocument();
  });

  // ── Overview tab ─────────────────────────────────────────────────────────

  it('renders identity strip with platform tag and handle on overview', () => {
    selectAccount('42');
    mockAccountState = {
      data: ACCOUNT_DATA,
      error: null,
      loading: false,
      refresh: mockAccountRefresh,
    };
    render(<AccountInspectorPanel />);

    expect(screen.getByText('[IG]')).toBeInTheDocument();
    expect(screen.getByText('@demo')).toBeInTheDocument();
    expect(screen.getByText('· acme')).toBeInTheDocument();
  });

  it('shows token health status as LIVE when expiry is far in the future', () => {
    selectAccount('42');
    mockAccountState = {
      data: ACCOUNT_DATA,
      error: null,
      loading: false,
      refresh: mockAccountRefresh,
    };
    render(<AccountInspectorPanel />);

    expect(screen.getByText('LIVE')).toBeInTheDocument();
    expect(screen.getByText('YES')).toBeInTheDocument();
  });

  it('renders headline StatBlocks on overview', () => {
    selectAccount('42');
    mockAccountState = {
      data: ACCOUNT_DATA,
      error: null,
      loading: false,
      refresh: mockAccountRefresh,
    };
    render(<AccountInspectorPanel />);

    expect(screen.getByText('Products synced')).toBeInTheDocument();
    expect(screen.getByText('Last sync')).toBeInTheDocument();
    expect(screen.getByText('Status')).toBeInTheDocument();
  });

  it('renders the products grid section on overview', () => {
    selectAccount('42');
    mockAccountState = {
      data: ACCOUNT_DATA,
      error: null,
      loading: false,
      refresh: mockAccountRefresh,
    };
    render(<AccountInspectorPanel />);

    expect(screen.getByText('PRODUCTS')).toBeInTheDocument();
    expect(screen.getByText('identity')).toBeInTheDocument();
  });

  // ── Tab switching ─────────────────────────────────────────────────────────

  it('switches to SYNC tab and shows sync jobs', async () => {
    selectAccount('42');
    mockAccountState = {
      data: ACCOUNT_DATA,
      error: null,
      loading: false,
      refresh: mockAccountRefresh,
    };
    render(<AccountInspectorPanel />);

    await userEvent.click(screen.getByRole('tab', { name: /^sync$/i }));

    expect(screen.getByText('identity')).toBeInTheDocument();
    expect(screen.getByText('engagement_new')).toBeInTheDocument();
    expect(screen.getByText(/upstream 429/i)).toBeInTheDocument();
  });

  it('switches to CALLS tab and shows call rows', async () => {
    selectAccount('42');
    mockAccountState = {
      data: ACCOUNT_DATA,
      error: null,
      loading: false,
      refresh: mockAccountRefresh,
    };
    mockCallsState = {
      data: CALLS_DATA,
      error: null,
      loading: false,
      refresh: vi.fn(),
    };
    render(<AccountInspectorPanel />);

    await userEvent.click(screen.getByRole('tab', { name: /^calls$/i }));

    expect(screen.getByText('/v1/me/media')).toBeInTheDocument();
    expect(screen.getByText('/v1/me/insights')).toBeInTheDocument();
    expect(screen.getByText('200')).toBeInTheDocument();
    expect(screen.getByText('429')).toBeInTheDocument();
  });

  it('switches to ACTIONS tab and shows pause chip and DATA link', async () => {
    selectAccount('42');
    mockAccountState = {
      data: ACCOUNT_DATA,
      error: null,
      loading: false,
      refresh: mockAccountRefresh,
    };
    render(<AccountInspectorPanel />);

    await userEvent.click(screen.getByRole('tab', { name: /^actions$/i }));

    expect(screen.getByRole('button', { name: /pause account/i })).toBeInTheDocument();
    expect(screen.getByText('DATA →')).toBeInTheDocument();
  });

  // ── Pause mutation ────────────────────────────────────────────────────────

  it('fires adminPost to pause endpoint when PAUSE chip is clicked', async () => {
    selectAccount('42');
    mockAccountState = {
      data: ACCOUNT_DATA,
      error: null,
      loading: false,
      refresh: mockAccountRefresh,
    };
    render(<AccountInspectorPanel />);

    await userEvent.click(screen.getByRole('tab', { name: /^actions$/i }));
    await userEvent.click(screen.getByRole('button', { name: /pause account/i }));

    await waitFor(() => {
      expect(mockAdminPost).toHaveBeenCalledWith('/admin/accounts/42/pause', {});
    });
  });

  it('calls refresh after a successful pause', async () => {
    mockAdminPost.mockResolvedValueOnce(undefined);
    selectAccount('42');
    mockAccountState = {
      data: ACCOUNT_DATA,
      error: null,
      loading: false,
      refresh: mockAccountRefresh,
    };
    render(<AccountInspectorPanel />);

    await userEvent.click(screen.getByRole('tab', { name: /^actions$/i }));
    await userEvent.click(screen.getByRole('button', { name: /pause account/i }));

    await waitFor(() => {
      expect(mockAccountRefresh).toHaveBeenCalledOnce();
    });
  });

  it('shows inline error when pause mutation fails', async () => {
    mockAdminPost.mockRejectedValueOnce(new Error('403 Forbidden'));
    selectAccount('42');
    mockAccountState = {
      data: ACCOUNT_DATA,
      error: null,
      loading: false,
      refresh: mockAccountRefresh,
    };
    render(<AccountInspectorPanel />);

    await userEvent.click(screen.getByRole('tab', { name: /^actions$/i }));
    await userEvent.click(screen.getByRole('button', { name: /pause account/i }));

    await waitFor(() => {
      expect(screen.getByText(/403 Forbidden/i)).toBeInTheDocument();
    });
  });

  it('shows UNPAUSE chip when account status is paused', async () => {
    selectAccount('42');
    mockAccountState = {
      data: { ...ACCOUNT_DATA, status: 'paused' },
      error: null,
      loading: false,
      refresh: mockAccountRefresh,
    };
    render(<AccountInspectorPanel />);

    await userEvent.click(screen.getByRole('tab', { name: /^actions$/i }));
    expect(screen.getByRole('button', { name: /unpause account/i })).toBeInTheDocument();
  });

  it('fires adminPost to unpause endpoint when UNPAUSE chip is clicked', async () => {
    selectAccount('42');
    mockAccountState = {
      data: { ...ACCOUNT_DATA, status: 'paused' },
      error: null,
      loading: false,
      refresh: mockAccountRefresh,
    };
    render(<AccountInspectorPanel />);

    await userEvent.click(screen.getByRole('tab', { name: /^actions$/i }));
    await userEvent.click(screen.getByRole('button', { name: /unpause account/i }));

    await waitFor(() => {
      expect(mockAdminPost).toHaveBeenCalledWith(
        '/admin/accounts/42/unpause',
        {},
      );
    });
  });

  // ── SYNC tab deferred link ────────────────────────────────────────────────

  it('shows the SYNC tab link pointing to the config sync editor', async () => {
    selectAccount('42');
    mockAccountState = {
      data: ACCOUNT_DATA,
      error: null,
      loading: false,
      refresh: mockAccountRefresh,
    };
    render(<AccountInspectorPanel />);

    await userEvent.click(screen.getByRole('tab', { name: /^sync$/i }));

    const link = screen.getByText(/edit cadence overrides/i);
    expect(link).toBeInTheDocument();
    expect(link.closest('a')).toHaveAttribute(
      'href',
      '/admin/config/sync/42',
    );
  });
});
