import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import KpiStatsPanel from '../KpiStatsPanel';

// ── Mock useLive ───────────────────────────────────────────────────────────

type MockState = {
  data: unknown;
  error: string | null;
  loading: boolean;
  refresh: () => void;
};

const NOOP = () => {};

let mockOverview: MockState = { data: null, error: null, loading: false, refresh: NOOP };
let mockCalls: MockState = { data: null, error: null, loading: false, refresh: NOOP };

vi.mock('@/lib/useLive', () => ({
  POLL: { live: 3000, list: 5000, config: 15000, catalog: 30000 },
  useLive: (path: string) => {
    if (path.includes('/admin/overview')) return mockOverview;
    if (path.includes('/admin/api-calls')) return mockCalls;
    return { data: null, error: null, loading: false, refresh: NOOP };
  },
}));

vi.mock('@/lib/workspace-context', async () => {
  const { useLive } = await import('@/lib/useLive');
  return {
    useWorkspaceFilter: () => ({
      slug: null,
      set: NOOP,
      withQuery: (url: string) => url,
      hydrated: true,
    }),
    useScopedLive: (path: string, interval: number) => useLive(path, interval),
  };
});

// ── Types ─────────────────────────────────────────────────────────────────

type ApiCall = {
  called_at?: string;
  status_code?: number;
  expected?: boolean;
};

// ── Helpers ────────────────────────────────────────────────────────────────

function iso(offsetMs: number): string {
  return new Date(Date.now() - offsetMs).toISOString();
}

const FIVE_MIN = 5 * 60_000;
const THIRTY_MIN = 30 * 60_000;
const TWO_HOURS = 2 * 60 * 60_000;

function call(status_code: number, offsetMs: number, expected = false): ApiCall {
  return { called_at: iso(offsetMs), status_code, expected };
}

type Overview = {
  accounts_total?: number;
  accounts_by_platform?: Record<string, number>;
  dlq_depth?: number;
};

function setData(overview: Overview | null, calls: ApiCall[]) {
  mockOverview = { data: overview, error: null, loading: false, refresh: NOOP };
  mockCalls = { data: calls, error: null, loading: false, refresh: NOOP };
}

function setApiDown() {
  mockOverview = {
    data: null,
    error: '503 Service Unavailable',
    loading: false,
    refresh: NOOP,
  };
  mockCalls = {
    data: null,
    error: '503 Service Unavailable',
    loading: false,
    refresh: NOOP,
  };
}

function setLoading() {
  mockOverview = { data: null, error: null, loading: true, refresh: NOOP };
  mockCalls = { data: null, error: null, loading: true, refresh: NOOP };
}

// ── Tests ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  setData({ accounts_total: 0, dlq_depth: 0 }, []);
});

describe('KpiStatsPanel', () => {
  describe('api-down state', () => {
    it('renders API UNREACHABLE when both endpoints fail', () => {
      setApiDown();
      render(<KpiStatsPanel />);
      expect(screen.getByText(/API UNREACHABLE/i)).toBeInTheDocument();
    });

    it('shows the error message in the api-down state', () => {
      setApiDown();
      render(<KpiStatsPanel />);
      expect(screen.getByText(/503/)).toBeInTheDocument();
    });
  });

  describe('loading state', () => {
    it('renders connecting… while overview is loading', () => {
      setLoading();
      render(<KpiStatsPanel />);
      expect(screen.getByText(/connecting/i)).toBeInTheDocument();
    });
  });

  describe('stat blocks from overview data', () => {
    it('renders the accounts total from overview', () => {
      setData({ accounts_total: 42, dlq_depth: 0 }, []);
      render(<KpiStatsPanel />);
      expect(screen.getByText('42')).toBeInTheDocument();
      expect(screen.getByText('Accounts')).toBeInTheDocument();
    });

    it('renders DLQ depth of 0', () => {
      setData({ dlq_depth: 0 }, []);
      render(<KpiStatsPanel />);
      expect(screen.getByText('DLQ depth')).toBeInTheDocument();
    });

    it('renders DLQ depth > 0', () => {
      setData({ accounts_total: 5, dlq_depth: 7 }, []);
      render(<KpiStatsPanel />);
      expect(screen.getByText('7')).toBeInTheDocument();
    });

    it('renders platform sub-label when accounts_by_platform is present', () => {
      setData(
        {
          accounts_total: 3,
          accounts_by_platform: { instagram: 2, tiktok: 1 },
          dlq_depth: 0,
        },
        [],
      );
      render(<KpiStatsPanel />);
      expect(screen.getByText(/instagram 2/)).toBeInTheDocument();
    });
  });

  describe('stat blocks from api-calls data', () => {
    it('renders success rate computed from calls', () => {
      const calls: ApiCall[] = [
        call(200, FIVE_MIN),
        call(200, FIVE_MIN),
        call(500, FIVE_MIN),
        call(200, FIVE_MIN),
        call(200, FIVE_MIN),
      ];
      setData({ accounts_total: 1, dlq_depth: 0 }, calls);
      render(<KpiStatsPanel />);
      expect(screen.getByText('Success rate')).toBeInTheDocument();
      // 4 out of 5 real calls are 2xx → 80%
      const eightyPct = screen.getAllByText('80%');
      expect(eightyPct.length).toBeGreaterThan(0);
    });

    it('excludes expected non-2xx from success rate denominator', () => {
      const calls: ApiCall[] = [
        call(200, FIVE_MIN),
        call(200, FIVE_MIN),
        // expected: true — excluded from both numerator and denominator
        { called_at: iso(FIVE_MIN), status_code: 400, expected: true },
      ];
      setData({ accounts_total: 1, dlq_depth: 0 }, calls);
      render(<KpiStatsPanel />);
      // 2 real calls, both 2xx → 100%
      const hundredPct = screen.getAllByText('100%');
      expect(hundredPct.length).toBeGreaterThan(0);
    });

    it('renders calls/1h count for calls within the hour', () => {
      const calls: ApiCall[] = [
        call(200, FIVE_MIN),
        call(200, THIRTY_MIN),
        call(200, TWO_HOURS), // outside 1h window — not counted
      ];
      setData({ accounts_total: 1, dlq_depth: 0 }, calls);
      render(<KpiStatsPanel />);
      expect(screen.getByText('Calls / 1h')).toBeInTheDocument();
      expect(screen.getByText('2')).toBeInTheDocument();
    });

    it('renders errors/1h for error calls within the hour', () => {
      const calls: ApiCall[] = [
        call(500, FIVE_MIN),
        call(404, THIRTY_MIN),
        call(500, TWO_HOURS), // outside 1h window
      ];
      setData({ accounts_total: 1, dlq_depth: 0 }, calls);
      render(<KpiStatsPanel />);
      expect(screen.getByText('Errors / 1h')).toBeInTheDocument();
      // The 2 in-window errors should appear as a stat value
      const twos = screen.getAllByText('2');
      expect(twos.length).toBeGreaterThan(0);
    });
  });

  describe('layout and labels', () => {
    it('renders the KPI · LIVE section header', () => {
      setData({ accounts_total: 1, dlq_depth: 0 }, []);
      render(<KpiStatsPanel />);
      expect(screen.getByText(/KPI · LIVE/i)).toBeInTheDocument();
    });

    it('renders the sparkline label', () => {
      setData({ accounts_total: 1, dlq_depth: 0 }, [call(200, FIVE_MIN)]);
      render(<KpiStatsPanel />);
      expect(screen.getByText(/2xx \/ min/i)).toBeInTheDocument();
    });

    it('renders all five stat block labels', () => {
      setData({ accounts_total: 5, dlq_depth: 0 }, []);
      render(<KpiStatsPanel />);
      expect(screen.getByText('Accounts')).toBeInTheDocument();
      expect(screen.getByText('Success rate')).toBeInTheDocument();
      expect(screen.getByText('Errors / 1h')).toBeInTheDocument();
      expect(screen.getByText('Calls / 1h')).toBeInTheDocument();
      expect(screen.getByText('DLQ depth')).toBeInTheDocument();
    });
  });
});
