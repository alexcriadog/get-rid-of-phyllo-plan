import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// Mock useLive — returns canned data via a controllable ref so individual tests
// can vary the payload without re-importing the module.
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
// Mock adminPost — captured so we can assert it was called with the right args.
// ---------------------------------------------------------------------------
const mockAdminPost = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/api', () => ({
  CONNECTOR_API_URL: 'http://localhost:3000',
  adminPost: (...args: unknown[]) => mockAdminPost(...args),
}));

// ---------------------------------------------------------------------------
// Canned data shapes — matches the real /admin/queues response structure.
// ---------------------------------------------------------------------------
const HEALTHY_QUEUES = {
  sync: { waiting: 2, active: 1, delayed: 0, failed: 0, completed: 50, paused: 0 },
  events: { waiting: 0, active: 0, delayed: 0, failed: 0, completed: 120, paused: 0 },
};

const QUEUES_WITH_FAILED = {
  sync: { waiting: 5, active: 2, delayed: 1, failed: 3, completed: 40, paused: 0 },
  delivery: { waiting: 0, active: 0, delayed: 0, failed: 0, completed: 30, paused: 0 },
};

// ---------------------------------------------------------------------------
import QueuesPanel from '../QueuesPanel';

describe('QueuesPanel', () => {
  beforeEach(() => {
    mockRefresh.mockClear();
    mockAdminPost.mockClear();
    // Reset to loading state before each test
    mockLiveState = { data: null, error: null, loading: true, refresh: mockRefresh };
  });

  it('renders the connecting state when loading and no data', () => {
    mockLiveState = { data: null, error: null, loading: true, refresh: mockRefresh };
    render(<QueuesPanel />);
    expect(screen.getByText(/connecting/i)).toBeInTheDocument();
  });

  it('renders queue rows from data', () => {
    mockLiveState = { data: HEALTHY_QUEUES, error: null, loading: false, refresh: mockRefresh };
    render(<QueuesPanel />);
    // Both queue names should appear (uppercased labels)
    expect(screen.getByText('SYNC')).toBeInTheDocument();
    expect(screen.getByText('EVENTS')).toBeInTheDocument();
    // Bucket detail letters
    expect(screen.getAllByText('W').length).toBeGreaterThan(0);
    expect(screen.getAllByText('A').length).toBeGreaterThan(0);
    expect(screen.getAllByText('F').length).toBeGreaterThan(0);
  });

  it('renders the api-down state when error and no data', () => {
    mockLiveState = { data: null, error: '503 Service Unavailable', loading: false, refresh: mockRefresh };
    render(<QueuesPanel />);
    expect(screen.getByText('API UNREACHABLE')).toBeInTheDocument();
    expect(screen.getByText(/503/)).toBeInTheDocument();
  });

  it('does NOT render api-down state when data is present alongside an error', () => {
    // Stale data scenario: previous poll succeeded, new poll errored
    mockLiveState = { data: HEALTHY_QUEUES, error: 'network timeout', loading: false, refresh: mockRefresh };
    render(<QueuesPanel />);
    expect(screen.queryByText('API UNREACHABLE')).not.toBeInTheDocument();
    expect(screen.getByText('SYNC')).toBeInTheDocument();
  });

  it('shows danger-toned failed count when failed > 0', () => {
    mockLiveState = { data: QUEUES_WITH_FAILED, error: null, loading: false, refresh: mockRefresh };
    render(<QueuesPanel />);
    // The retry ActionChip should be present for the sync queue (3 failed)
    const retryBtn = screen.getByRole('button', { name: /retry dlq for sync/i });
    expect(retryBtn).toBeInTheDocument();
    // The button should carry the destructive variant class
    expect(retryBtn.className).toContain('border-term-danger');
  });

  it('does NOT show a retry chip when failed is 0', () => {
    mockLiveState = { data: HEALTHY_QUEUES, error: null, loading: false, refresh: mockRefresh };
    render(<QueuesPanel />);
    expect(screen.queryByRole('button', { name: /retry dlq/i })).not.toBeInTheDocument();
  });

  it('fires adminPost to the correct endpoint when retry chip is clicked', async () => {
    mockLiveState = { data: QUEUES_WITH_FAILED, error: null, loading: false, refresh: mockRefresh };
    render(<QueuesPanel />);

    const retryBtn = screen.getByRole('button', { name: /retry dlq for sync/i });
    await userEvent.click(retryBtn);

    expect(mockAdminPost).toHaveBeenCalledWith('/admin/queues/sync/retry-failed', {});
  });

  it('calls refresh after a successful retry', async () => {
    mockAdminPost.mockResolvedValueOnce(undefined);
    mockLiveState = { data: QUEUES_WITH_FAILED, error: null, loading: false, refresh: mockRefresh };
    render(<QueuesPanel />);

    await userEvent.click(screen.getByRole('button', { name: /retry dlq for sync/i }));

    await waitFor(() => {
      expect(mockRefresh).toHaveBeenCalledOnce();
    });
  });

  it('shows an inline error message when adminPost fails', async () => {
    mockAdminPost.mockRejectedValueOnce(new Error('429 Too Many Requests'));
    mockLiveState = { data: QUEUES_WITH_FAILED, error: null, loading: false, refresh: mockRefresh };
    render(<QueuesPanel />);

    await userEvent.click(screen.getByRole('button', { name: /retry dlq for sync/i }));

    await waitFor(() => {
      expect(screen.getByText(/429 Too Many Requests/)).toBeInTheDocument();
    });
  });

  it('shows "no queue data" when data is an empty object', () => {
    mockLiveState = { data: {}, error: null, loading: false, refresh: mockRefresh };
    render(<QueuesPanel />);
    expect(screen.getByText(/no queue data/i)).toBeInTheDocument();
  });

  it('renders MiniBar meter elements for each queue', () => {
    mockLiveState = { data: HEALTHY_QUEUES, error: null, loading: false, refresh: mockRefresh };
    render(<QueuesPanel />);
    // Each queue row has one meter (MiniBar has role="meter")
    const meters = screen.getAllByRole('meter');
    expect(meters.length).toBeGreaterThanOrEqual(2);
  });
});
