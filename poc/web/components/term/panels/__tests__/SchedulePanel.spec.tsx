import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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
// Mock workspace-context — no-op withQuery (no workspace selected by default)
// ---------------------------------------------------------------------------
vi.mock('@/lib/workspace-context', async () => {
  // useScopedLive delegates to the (mocked) useLive so the panel renders the
  // same canned state; hydrated:true so the gate lets the fetch through.
  const { useLive } = await import('@/lib/useLive');
  return {
    useWorkspaceFilter: () => ({
      slug: null,
      set: vi.fn(),
      withQuery: (url: string) => url,
      hydrated: true,
    }),
    useScopedLive: (path: string, interval: number) => useLive(path, interval),
  };
});

// ---------------------------------------------------------------------------
// Canned data — timestamps computed at module load time from real Date.now()
// so they are always in the future when the tests execute.  No fake timers
// needed: we just need the rows to survive the `t >= now` filter inside the
// panel's useMemo; skewing them 1 h ahead gives plenty of slack.
// ---------------------------------------------------------------------------
const T = Date.now();
const IN_30M = new Date(T + 30 * 60_000).toISOString();
const IN_90M = new Date(T + 90 * 60_000).toISOString();
const IN_25M = new Date(T + 25 * 60_000).toISOString();

const SAMPLE_RUNS = [
  {
    id: '1',
    accountId: 'acc-001',
    accountHandle: '@alice',
    platform: 'instagram',
    product: 'engagement_new',
    next_run_at: IN_30M,
    status: 'idle',
    failure_count: 0,
  },
  {
    id: '2',
    accountId: 'acc-002',
    accountHandle: '@bob',
    platform: 'tiktok',
    product: 'audience',
    next_run_at: IN_90M,
    status: 'idle',
    failure_count: 0,
  },
  {
    id: '3',
    accountId: 'acc-003',
    accountHandle: '@carol',
    platform: 'youtube',
    product: 'identity',
    next_run_at: IN_25M,
    status: 'failing',
    failure_count: 4,
  },
];

// ---------------------------------------------------------------------------
import SchedulePanel from '../SchedulePanel';

describe('SchedulePanel', () => {
  beforeEach(() => {
    mockRefresh.mockClear();
    mockLiveState = { data: null, error: null, loading: true, refresh: mockRefresh };
  });

  it('renders the connecting state when loading and no data', () => {
    mockLiveState = { data: null, error: null, loading: true, refresh: mockRefresh };
    render(<SchedulePanel />);
    expect(screen.getByText(/connecting/i)).toBeInTheDocument();
  });

  it('renders the api-down state when error and no data', () => {
    mockLiveState = { data: null, error: '502 Bad Gateway', loading: false, refresh: mockRefresh };
    render(<SchedulePanel />);
    expect(screen.getByText('API UNREACHABLE')).toBeInTheDocument();
    expect(screen.getByText(/502/)).toBeInTheDocument();
  });

  it('does NOT render api-down when data is present alongside an error', () => {
    mockLiveState = { data: SAMPLE_RUNS, error: 'stale', loading: false, refresh: mockRefresh };
    render(<SchedulePanel />);
    expect(screen.queryByText('API UNREACHABLE')).not.toBeInTheDocument();
  });

  it('renders rows from data with account handles', () => {
    mockLiveState = { data: SAMPLE_RUNS, error: null, loading: false, refresh: mockRefresh };
    render(<SchedulePanel />);
    expect(screen.getByText('@alice')).toBeInTheDocument();
    expect(screen.getByText('@bob')).toBeInTheDocument();
    expect(screen.getByText('@carol')).toBeInTheDocument();
  });

  it('renders product names in each row', () => {
    mockLiveState = { data: SAMPLE_RUNS, error: null, loading: false, refresh: mockRefresh };
    render(<SchedulePanel />);
    expect(screen.getByText('engagement_new')).toBeInTheDocument();
    expect(screen.getByText('audience')).toBeInTheDocument();
    expect(screen.getByText('identity')).toBeInTheDocument();
  });

  it('renders a relative countdown for each row (fmtRelative "in Xm" format)', () => {
    mockLiveState = { data: SAMPLE_RUNS, error: null, loading: false, refresh: mockRefresh };
    render(<SchedulePanel />);
    // fmtRelative returns "in Xm" for future times — all three rows are 25–90 min ahead
    expect(screen.getAllByText(/in \d+m/).length).toBeGreaterThanOrEqual(2);
  });

  it('renders PlatformTag elements for each row', () => {
    mockLiveState = { data: SAMPLE_RUNS, error: null, loading: false, refresh: mockRefresh };
    render(<SchedulePanel />);
    // PlatformTag renders abbr in brackets like [IG], [TT], [YT]
    expect(screen.getByText('[IG]')).toBeInTheDocument();
    expect(screen.getByText('[TT]')).toBeInTheDocument();
    expect(screen.getByText('[YT]')).toBeInTheDocument();
  });

  it('shows failure count badge when failure_count > 0', () => {
    mockLiveState = { data: SAMPLE_RUNS, error: null, loading: false, refresh: mockRefresh };
    render(<SchedulePanel />);
    // carol has failure_count=4 → badge "4f"
    expect(screen.getByText('4f')).toBeInTheDocument();
  });

  it('does NOT show failure badge when failure_count is 0', () => {
    mockLiveState = {
      data: [SAMPLE_RUNS[0]], // alice, failure_count=0
      error: null,
      loading: false,
      refresh: mockRefresh,
    };
    render(<SchedulePanel />);
    expect(screen.queryByText(/\df/)).not.toBeInTheDocument();
  });

  it('renders MiniBar meter elements for each row', () => {
    mockLiveState = { data: SAMPLE_RUNS, error: null, loading: false, refresh: mockRefresh };
    render(<SchedulePanel />);
    const meters = screen.getAllByRole('meter');
    expect(meters.length).toBeGreaterThanOrEqual(SAMPLE_RUNS.length);
  });

  it('renders a filter input', () => {
    mockLiveState = { data: SAMPLE_RUNS, error: null, loading: false, refresh: mockRefresh };
    render(<SchedulePanel />);
    expect(screen.getByRole('textbox', { name: /filter schedule rows/i })).toBeInTheDocument();
  });

  it('filters rows by account handle', async () => {
    mockLiveState = { data: SAMPLE_RUNS, error: null, loading: false, refresh: mockRefresh };
    render(<SchedulePanel />);

    const input = screen.getByRole('textbox', { name: /filter schedule rows/i });
    await userEvent.type(input, 'bob');

    expect(screen.getByText('@bob')).toBeInTheDocument();
    expect(screen.queryByText('@alice')).not.toBeInTheDocument();
    expect(screen.queryByText('@carol')).not.toBeInTheDocument();
  });

  it('filters rows by platform', async () => {
    mockLiveState = { data: SAMPLE_RUNS, error: null, loading: false, refresh: mockRefresh };
    render(<SchedulePanel />);

    const input = screen.getByRole('textbox', { name: /filter schedule rows/i });
    await userEvent.type(input, 'tiktok');

    expect(screen.getByText('@bob')).toBeInTheDocument();
    expect(screen.queryByText('@alice')).not.toBeInTheDocument();
  });

  it('shows "no matches" when filter yields no results', async () => {
    mockLiveState = { data: SAMPLE_RUNS, error: null, loading: false, refresh: mockRefresh };
    render(<SchedulePanel />);

    const input = screen.getByRole('textbox', { name: /filter schedule rows/i });
    await userEvent.type(input, 'zzznomatch');

    expect(screen.getByText(/no matches/i)).toBeInTheDocument();
  });

  it('shows "nothing scheduled" when data is empty', () => {
    mockLiveState = { data: [], error: null, loading: false, refresh: mockRefresh };
    render(<SchedulePanel />);
    expect(screen.getByText(/nothing scheduled in the next 24h/i)).toBeInTheDocument();
  });

  it('shows job count in the header row', () => {
    mockLiveState = { data: SAMPLE_RUNS, error: null, loading: false, refresh: mockRefresh };
    render(<SchedulePanel />);
    // Header shows "· next 24h · 3 jobs"
    expect(screen.getByText(/3 jobs/)).toBeInTheDocument();
  });
});
