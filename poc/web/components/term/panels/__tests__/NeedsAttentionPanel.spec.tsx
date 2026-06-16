import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import NeedsAttentionPanel from '../NeedsAttentionPanel';

// ── Mock useLive ───────────────────────────────────────────────────────────
//
// We intercept `@/lib/useLive` so the panel never hits the network. Each test
// configures the mock via helpers before rendering. The mock returns the same
// LiveState<T> shape as the real hook.

type MockState = {
  data: unknown;
  error: string | null;
  loading: boolean;
  refresh: () => void;
};

const NOOP = () => {};

// Shared mutable state updated by each test.
let mockOverview: MockState = { data: null, error: null, loading: false, refresh: NOOP };
let mockAccounts: MockState = { data: null, error: null, loading: false, refresh: NOOP };

vi.mock('@/lib/useLive', () => ({
  POLL: { live: 3000, list: 5000, config: 15000, catalog: 30000 },
  useLive: (path: string) => {
    if (path.includes('/admin/overview')) return mockOverview;
    if (path.includes('/admin/accounts')) return mockAccounts;
    return { data: null, error: null, loading: false, refresh: NOOP };
  },
}));

// workspace-context just passes through URLs unchanged in tests.
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

// next/link renders as a plain anchor in tests.
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

// ── Helpers ────────────────────────────────────────────────────────────────

type AttentionAccount = {
  id: string;
  platform: string;
  handle?: string | null;
  status: string;
  sync_tier: string;
  products: { product: string; failure_count?: number }[];
};

function setData(
  overview: { dlq_depth?: number } | null,
  accounts: AttentionAccount[],
) {
  mockOverview = { data: overview, error: null, loading: false, refresh: NOOP };
  mockAccounts = { data: accounts, error: null, loading: false, refresh: NOOP };
}

function setApiDown() {
  mockOverview = {
    data: null,
    error: '503 Service Unavailable',
    loading: false,
    refresh: NOOP,
  };
  mockAccounts = {
    data: null,
    error: '503 Service Unavailable',
    loading: false,
    refresh: NOOP,
  };
}

function setLoading() {
  mockOverview = { data: null, error: null, loading: true, refresh: NOOP };
  mockAccounts = { data: null, error: null, loading: true, refresh: NOOP };
}

// ── Tests ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  setData({ dlq_depth: 0 }, []);
});

describe('NeedsAttentionPanel', () => {
  describe('empty state', () => {
    it('renders all-clear when there are no issues', () => {
      setData({ dlq_depth: 0 }, []);
      render(<NeedsAttentionPanel />);
      expect(screen.getByText(/all clear/i)).toBeInTheDocument();
    });

    it('does not render an issue list in the all-clear state', () => {
      setData({ dlq_depth: 0 }, []);
      render(<NeedsAttentionPanel />);
      expect(screen.queryByRole('list')).not.toBeInTheDocument();
    });
  });

  describe('api-down state', () => {
    it('renders API UNREACHABLE when both endpoints fail', () => {
      setApiDown();
      render(<NeedsAttentionPanel />);
      expect(screen.getByText(/API UNREACHABLE/i)).toBeInTheDocument();
    });

    it('shows the error message text in the api-down state', () => {
      setApiDown();
      render(<NeedsAttentionPanel />);
      expect(screen.getByText(/503/)).toBeInTheDocument();
    });
  });

  describe('loading state', () => {
    it('renders connecting… while data is loading', () => {
      setLoading();
      render(<NeedsAttentionPanel />);
      expect(screen.getByText(/connecting/i)).toBeInTheDocument();
    });
  });

  describe('issue rows', () => {
    it('renders a DLQ danger row when dlq_depth > 0', () => {
      setData({ dlq_depth: 3 }, []);
      render(<NeedsAttentionPanel />);
      expect(screen.getByText(/3 jobs in dead-letter queue/i)).toBeInTheDocument();
    });

    it('renders singular "job" label when dlq_depth === 1', () => {
      setData({ dlq_depth: 1 }, []);
      render(<NeedsAttentionPanel />);
      expect(screen.getByText(/1 job in dead-letter queue/i)).toBeInTheDocument();
    });

    it('renders a reauth danger row for needs_reauth accounts', () => {
      const accounts: AttentionAccount[] = [
        {
          id: 'acc-1',
          platform: 'instagram',
          handle: '@brand',
          status: 'needs_reauth',
          sync_tier: 'standard',
          products: [],
        },
      ];
      setData({ dlq_depth: 0 }, accounts);
      render(<NeedsAttentionPanel />);
      expect(screen.getByText(/@brand needs re-authentication/i)).toBeInTheDocument();
    });

    it('renders a failing products danger row when failure_count >= 3', () => {
      const accounts: AttentionAccount[] = [
        {
          id: 'acc-2',
          platform: 'tiktok',
          handle: '@creator',
          status: 'active',
          sync_tier: 'standard',
          products: [
            { product: 'engagement_new', failure_count: 5 },
            { product: 'audience', failure_count: 1 },
          ],
        },
      ];
      setData({ dlq_depth: 0 }, accounts);
      render(<NeedsAttentionPanel />);
      expect(screen.getByText(/@creator — 1 failing product/i)).toBeInTheDocument();
    });

    it('renders a warn row for paused accounts', () => {
      const accounts: AttentionAccount[] = [
        {
          id: 'acc-3',
          platform: 'linkedin',
          handle: null,
          status: 'active',
          sync_tier: 'paused',
          products: [],
        },
        {
          id: 'acc-4',
          platform: 'facebook',
          handle: null,
          status: 'active',
          sync_tier: 'paused',
          products: [],
        },
      ];
      setData({ dlq_depth: 0 }, accounts);
      render(<NeedsAttentionPanel />);
      expect(screen.getByText(/2 accounts paused/i)).toBeInTheDocument();
    });

    it('applies danger tone class to danger items', () => {
      const accounts: AttentionAccount[] = [
        {
          id: 'acc-5',
          platform: 'instagram',
          handle: '@test',
          status: 'needs_reauth',
          sync_tier: 'standard',
          products: [],
        },
      ];
      setData({ dlq_depth: 0 }, accounts);
      render(<NeedsAttentionPanel />);
      const dangerDots = document.querySelectorAll('.text-term-danger');
      expect(dangerDots.length).toBeGreaterThan(0);
    });

    it('applies warn tone class to paused items', () => {
      const accounts: AttentionAccount[] = [
        {
          id: 'acc-6',
          platform: 'tiktok',
          handle: null,
          status: 'active',
          sync_tier: 'paused',
          products: [],
        },
      ];
      setData({ dlq_depth: 0 }, accounts);
      render(<NeedsAttentionPanel />);
      const warnDots = document.querySelectorAll('.text-term-warn');
      expect(warnDots.length).toBeGreaterThan(0);
    });

    it('renders deep-link href for account items', () => {
      const accounts: AttentionAccount[] = [
        {
          id: 'abc-123',
          platform: 'instagram',
          handle: '@handle',
          status: 'needs_reauth',
          sync_tier: 'standard',
          products: [],
        },
      ];
      setData({ dlq_depth: 0 }, accounts);
      render(<NeedsAttentionPanel />);
      const link = screen.getByRole('link', {
        name: /@handle needs re-authentication/i,
      });
      expect(link).toHaveAttribute('href', '/admin?account=abc-123');
    });

    it('renders deep-link href for DLQ row pointing to the pipeline deck', () => {
      setData({ dlq_depth: 1 }, []);
      render(<NeedsAttentionPanel />);
      const link = screen.getByRole('link', { name: /in dead-letter queue/i });
      expect(link).toHaveAttribute('href', '/admin?deck=pipeline');
    });

    it('caps rendered items at 8 even with many issues', () => {
      const accounts: AttentionAccount[] = Array.from({ length: 10 }, (_, i) => ({
        id: `acc-${i}`,
        platform: 'instagram',
        handle: `@user${i}`,
        status: 'needs_reauth',
        sync_tier: 'standard',
        products: [],
      }));
      setData({ dlq_depth: 2 }, accounts);
      render(<NeedsAttentionPanel />);
      const items = screen.getAllByRole('listitem');
      expect(items.length).toBeLessThanOrEqual(8);
    });

    it('does not show a failing row for a paused account even with failing products', () => {
      const accounts: AttentionAccount[] = [
        {
          id: 'acc-7',
          platform: 'facebook',
          handle: '@paused-failing',
          status: 'active',
          sync_tier: 'paused',
          products: [{ product: 'identity', failure_count: 10 }],
        },
      ];
      setData({ dlq_depth: 0 }, accounts);
      render(<NeedsAttentionPanel />);
      // Should only show the paused warn, not a failing danger
      expect(screen.getByText(/1 account paused/i)).toBeInTheDocument();
      expect(screen.queryByText(/failing product/i)).not.toBeInTheDocument();
    });
  });
});
