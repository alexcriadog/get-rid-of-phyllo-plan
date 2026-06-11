import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

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
// Canned data — matches the real /admin/system/config response structure.
// ---------------------------------------------------------------------------
const CONFIG_DATA = {
  worker: {
    concurrency: { value: 3, source: 'env' as const, env: 'WORKER_CONCURRENCY' },
    engagement_lookback_days: {
      value: 30,
      source: 'default' as const,
      env: 'ENGAGEMENT_LOOKBACK_DAYS',
    },
  },
  scheduler: {
    tick_ms: { value: 5000, source: 'default' as const, env: 'SCHEDULER_TICK_MS' },
    backpressure_max: { value: 50, source: 'default' as const, env: 'SCHEDULER_BACKPRESSURE_MAX' },
  },
  retention: {
    inbound_log_days: { value: 30, source: 'default' as const, env: 'RETENTION_INBOUND_LOG_DAYS' },
    outbound_delivery_days: {
      value: 30,
      source: 'default' as const,
      env: 'RETENTION_OUTBOUND_DELIVERY_DAYS',
    },
    api_call_log_days: {
      value: 90,
      source: 'default' as const,
      env: 'RETENTION_API_CALL_LOG_DAYS',
    },
    mongo_raw_days: { value: 14, source: 'default' as const, env: 'RETENTION_MONGO_RAW_DAYS' },
    dry_run: false,
    schedule: '0 3 * * *',
  },
};

const CONFIG_DRY_RUN = {
  ...CONFIG_DATA,
  retention: { ...CONFIG_DATA.retention, dry_run: true },
};

// ---------------------------------------------------------------------------
import RuntimeSettingsPanel from '../RuntimeSettingsPanel';

describe('RuntimeSettingsPanel', () => {
  beforeEach(() => {
    mockRefresh.mockClear();
    mockLiveState = { data: null, error: null, loading: true, refresh: mockRefresh };
  });

  it('renders the connecting state when loading and no data', () => {
    mockLiveState = { data: null, error: null, loading: true, refresh: mockRefresh };
    render(<RuntimeSettingsPanel />);
    expect(screen.getByText(/connecting/i)).toBeInTheDocument();
  });

  it('renders the api-down state when error and no data', () => {
    mockLiveState = {
      data: null,
      error: '503 Service Unavailable',
      loading: false,
      refresh: mockRefresh,
    };
    render(<RuntimeSettingsPanel />);
    expect(screen.getByText('API UNREACHABLE')).toBeInTheDocument();
    expect(screen.getByText(/503/)).toBeInTheDocument();
  });

  it('does NOT render api-down when data is present alongside an error', () => {
    mockLiveState = {
      data: CONFIG_DATA,
      error: 'stale',
      loading: false,
      refresh: mockRefresh,
    };
    render(<RuntimeSettingsPanel />);
    expect(screen.queryByText('API UNREACHABLE')).not.toBeInTheDocument();
    expect(screen.getByText('WORKER')).toBeInTheDocument();
  });

  it('renders the panel header label', () => {
    mockLiveState = { data: CONFIG_DATA, error: null, loading: false, refresh: mockRefresh };
    render(<RuntimeSettingsPanel />);
    expect(screen.getByText('RUNTIME SETTINGS')).toBeInTheDocument();
  });

  it('renders Worker group with concurrency and lookback knobs', () => {
    mockLiveState = { data: CONFIG_DATA, error: null, loading: false, refresh: mockRefresh };
    render(<RuntimeSettingsPanel />);
    expect(screen.getByText('WORKER')).toBeInTheDocument();
    expect(screen.getByText('Concurrency')).toBeInTheDocument();
    expect(screen.getByText('Engagement lookback')).toBeInTheDocument();
    // concurrency value = 3, lookback = 30d (may appear multiple times across groups)
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getAllByText('30d').length).toBeGreaterThan(0);
  });

  it('renders Scheduler group with tick interval and backpressure max', () => {
    mockLiveState = { data: CONFIG_DATA, error: null, loading: false, refresh: mockRefresh };
    render(<RuntimeSettingsPanel />);
    expect(screen.getByText('SCHEDULER')).toBeInTheDocument();
    expect(screen.getByText('Tick interval')).toBeInTheDocument();
    expect(screen.getByText('Backpressure max')).toBeInTheDocument();
    // tick_ms = 5000 → '5s', backpressure_max = 50
    expect(screen.getByText('5s')).toBeInTheDocument();
    expect(screen.getByText('50')).toBeInTheDocument();
  });

  it('renders Retention group with all four day knobs', () => {
    mockLiveState = { data: CONFIG_DATA, error: null, loading: false, refresh: mockRefresh };
    render(<RuntimeSettingsPanel />);
    expect(screen.getByText('RETENTION')).toBeInTheDocument();
    expect(screen.getByText('Inbound webhook log')).toBeInTheDocument();
    expect(screen.getByText('Outbound deliveries')).toBeInTheDocument();
    expect(screen.getByText('API call log')).toBeInTheDocument();
    expect(screen.getByText('Mongo raw responses')).toBeInTheDocument();
    expect(screen.getByText('90d')).toBeInTheDocument();
    expect(screen.getByText('14d')).toBeInTheDocument();
  });

  it('renders the cron schedule string', () => {
    mockLiveState = { data: CONFIG_DATA, error: null, loading: false, refresh: mockRefresh };
    render(<RuntimeSettingsPanel />);
    expect(screen.getByText('0 3 * * *')).toBeInTheDocument();
  });

  it('shows live mode badge when dry_run is false', () => {
    mockLiveState = { data: CONFIG_DATA, error: null, loading: false, refresh: mockRefresh };
    render(<RuntimeSettingsPanel />);
    expect(screen.getByText('live')).toBeInTheDocument();
    expect(screen.queryByText('dry-run')).not.toBeInTheDocument();
  });

  it('shows dry-run mode badge when dry_run is true', () => {
    mockLiveState = { data: CONFIG_DRY_RUN, error: null, loading: false, refresh: mockRefresh };
    render(<RuntimeSettingsPanel />);
    expect(screen.getByText('dry-run')).toBeInTheDocument();
    expect(screen.queryByText('live')).not.toBeInTheDocument();
  });

  it('shows source tags for knobs (env and default)', () => {
    mockLiveState = { data: CONFIG_DATA, error: null, loading: false, refresh: mockRefresh };
    render(<RuntimeSettingsPanel />);
    // concurrency has source 'env', others have 'default'
    const envTags = screen.getAllByText('env');
    const defaultTags = screen.getAllByText('default');
    expect(envTags.length).toBeGreaterThan(0);
    expect(defaultTags.length).toBeGreaterThan(0);
  });

  it('renders env var names alongside each knob label', () => {
    mockLiveState = { data: CONFIG_DATA, error: null, loading: false, refresh: mockRefresh };
    render(<RuntimeSettingsPanel />);
    expect(screen.getByText('WORKER_CONCURRENCY')).toBeInTheDocument();
    expect(screen.getByText('SCHEDULER_TICK_MS')).toBeInTheDocument();
  });

  it('renders the read-only footer note', () => {
    mockLiveState = { data: CONFIG_DATA, error: null, loading: false, refresh: mockRefresh };
    render(<RuntimeSettingsPanel />);
    expect(screen.getByText(/read-only/i)).toBeInTheDocument();
  });
});
