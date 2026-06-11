import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

// ---------------------------------------------------------------------------
// Mock useLive — keyed by URL path so every call to useLive('/admin/rate-buckets')
// always gets the same state regardless of render count or tab state.
// ---------------------------------------------------------------------------
type LiveState<T> = {
  data: T | null;
  error: string | null;
  loading: boolean;
  refresh: () => void;
};

const mockRefresh = vi.fn();

// Map of path → state. Tests populate this via setMockForPath().
const mockByPath = new Map<string, LiveState<unknown>>();

const DEFAULT_LOADING: LiveState<unknown> = {
  data: null,
  error: null,
  loading: true,
  refresh: mockRefresh,
};

vi.mock('@/lib/useLive', () => ({
  POLL: { live: 3000, list: 5000, config: 15000, catalog: 30000 },
  useLive: (path: string) => {
    return mockByPath.get(path) ?? DEFAULT_LOADING;
  },
}));

// ---------------------------------------------------------------------------
// Mock @/lib/api — no mutations in this panel but imported transitively.
// ---------------------------------------------------------------------------
vi.mock('@/lib/api', () => ({
  CONNECTOR_API_URL: 'http://localhost:3000',
  adminPost: vi.fn().mockResolvedValue(undefined),
  adminPatch: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Mock next/link → plain <a> (no Next.js router needed in tests).
// ---------------------------------------------------------------------------
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
    [k: string]: unknown;
  }) => <a href={href} {...props}>{children}</a>,
}));

// ---------------------------------------------------------------------------
// Mock @/lib/term/platforms so PlatformTag renders in jsdom.
// ---------------------------------------------------------------------------
vi.mock('@/lib/term/platforms', () => ({
  platformTag: (platform: string) => ({
    abbr: platform.slice(0, 2).toUpperCase(),
    label: platform,
    className: 'text-term-faint',
  }),
}));

// ---------------------------------------------------------------------------
// Canned data — all synthetic, no production values.
// ---------------------------------------------------------------------------

// instagram bucket: 10% consumed (tokens=900/capacity=1000) → healthy
const BUCKET_HEALTHY = [
  {
    key: 'poc:rate:instagram:app',
    platform: 'instagram',
    scope: 'app',
    tokens: 900,
    capacity: 1000,
    hits: 100,
    denies: 0,
    account: null,
  },
];

// facebook bucket: 75% consumed → warn zone (0.7 ≤ x < 0.9)
const BUCKET_WARN = [
  {
    key: 'poc:rate:facebook:app',
    platform: 'facebook',
    scope: 'app',
    tokens: 250,
    capacity: 1000,
    hits: 750,
    denies: 5,
    account: null,
  },
];

// tiktok bucket: 95% consumed → danger zone (≥ 0.9)
const BUCKET_DANGER = [
  {
    key: 'poc:rate:tiktok:app',
    platform: 'tiktok',
    scope: 'app',
    tokens: 50,
    capacity: 1000,
    hits: 950,
    denies: 50,
    account: null,
  },
];

// BUC mirror: 95% call count with retry-after → danger
const MIRROR_SNAPSHOT_DANGER = {
  generated_at: new Date(Date.now() - 30_000).toISOString(),
  buckets: [
    {
      scopeKey: 'app:123456',
      source: 'app',
      type: 'instagram',
      callCountPct: 95,
      totalTimePct: 40,
      totalCpuPct: 20,
      retryAfterMs: 5000,
      lastSeenAt: Date.now() - 10_000,
    },
  ],
};

// One active lock
const LOCKS_ACTIVE = [
  {
    key: 'poc:throttle:instagram:identity:acct-42',
    account_id: 42,
    product: 'identity',
    ttl_remaining_ms: 300_000,
    ttl_total_ms: 600_000,
    acquired_at: new Date(Date.now() - 300_000).toISOString(),
  },
];

// ---------------------------------------------------------------------------
// Helper factories
// ---------------------------------------------------------------------------

function live<T>(
  data: T,
  overrides: Partial<LiveState<T>> = {},
): LiveState<T> {
  return { data, error: null, loading: false, refresh: mockRefresh, ...overrides };
}

const LOADING = DEFAULT_LOADING;

/** Populate the URL→state map for the three panel endpoints. */
function setMocks(
  buckets: LiveState<unknown>,
  mirror: LiveState<unknown>,
  locks: LiveState<unknown>,
) {
  mockByPath.clear();
  mockByPath.set('/admin/rate-buckets', buckets);
  mockByPath.set('/admin/rate-limits', mirror);
  mockByPath.set('/admin/throttle-locks', locks);
  mockRefresh.mockClear();
}

// ---------------------------------------------------------------------------
import RateLimitsPanel from '../RateLimitsPanel';

describe('RateLimitsPanel', () => {
  beforeEach(() => {
    // Default: all loading, no data
    setMocks(LOADING, LOADING, LOADING);
  });

  // ── Loading / connecting ─────────────────────────────────────────────────

  it('renders the connecting state when all sources are loading and have no data', () => {
    render(<RateLimitsPanel />);
    expect(screen.getByText(/connecting/i)).toBeInTheDocument();
  });

  // ── LIMITS tab: renders data ─────────────────────────────────────────────

  it('renders the LOCAL BUCKETS section when bucket data is present', () => {
    setMocks(live(BUCKET_HEALTHY), live(null), live([]));
    render(<RateLimitsPanel />);
    expect(screen.getByText('LOCAL BUCKETS')).toBeInTheDocument();
  });

  it('renders Meta BUC MIRROR section when mirror snapshot has buckets', () => {
    setMocks(live([]), live(MIRROR_SNAPSHOT_DANGER), live([]));
    render(<RateLimitsPanel />);
    expect(screen.getByText('META BUC MIRROR')).toBeInTheDocument();
  });

  it('renders empty state when no buckets and no mirror data', () => {
    setMocks(
      live([]),
      live({ generated_at: '', buckets: [] }),
      live([]),
    );
    render(<RateLimitsPanel />);
    expect(screen.getByText(/no rate buckets yet/i)).toBeInTheDocument();
  });

  it('renders Gauge meters (role=meter) for bucket rows', () => {
    setMocks(live(BUCKET_HEALTHY), live(null), live([]));
    render(<RateLimitsPanel />);
    const meters = screen.getAllByRole('meter');
    expect(meters.length).toBeGreaterThanOrEqual(1);
  });

  // ── Tone escalation ──────────────────────────────────────────────────────

  it('applies danger text class when bucket is 95% consumed (above 0.9 threshold)', () => {
    setMocks(live(BUCKET_DANGER), live(null), live([]));
    const { container } = render(<RateLimitsPanel />);
    const dangerEls = container.querySelectorAll('.text-term-danger');
    expect(dangerEls.length).toBeGreaterThan(0);
  });

  it('applies warn text class when bucket is 75% consumed (0.7–0.9 zone)', () => {
    setMocks(live(BUCKET_WARN), live(null), live([]));
    const { container } = render(<RateLimitsPanel />);
    const warnEls = container.querySelectorAll('.text-term-warn');
    expect(warnEls.length).toBeGreaterThan(0);
  });

  it('shows retry-after seconds in danger color when BUC retryAfterMs > 0', () => {
    setMocks(live([]), live(MIRROR_SNAPSHOT_DANGER), live([]));
    render(<RateLimitsPanel />);
    // retryAfterMs=5000 → "wait 5s"
    expect(screen.getByText(/wait 5s/i)).toBeInTheDocument();
  });

  // ── API-down state ───────────────────────────────────────────────────────

  it('renders API UNREACHABLE header when both limits endpoints error with no data', () => {
    setMocks(
      { data: null, error: '503 Service Unavailable', loading: false, refresh: mockRefresh },
      { data: null, error: '503 Service Unavailable', loading: false, refresh: mockRefresh },
      { data: null, error: null, loading: false, refresh: mockRefresh },
    );
    render(<RateLimitsPanel />);
    expect(screen.getByText('API UNREACHABLE')).toBeInTheDocument();
  });

  // ── Tab switch → LOCKS ───────────────────────────────────────────────────

  it('switches to the LOCKS tab and renders active lock rows', async () => {
    setMocks(live([]), live(null), live(LOCKS_ACTIVE));
    render(<RateLimitsPanel />);

    await userEvent.click(screen.getByRole('tab', { name: /locks/i }));

    expect(screen.getByText('identity')).toBeInTheDocument();
    expect(screen.getByText('#42')).toBeInTheDocument();
  });

  it('shows empty-locks state when locks array is empty', async () => {
    setMocks(live([]), live(null), live([]));
    render(<RateLimitsPanel />);

    await userEvent.click(screen.getByRole('tab', { name: /locks/i }));

    expect(screen.getByText(/no active locks/i)).toBeInTheDocument();
  });

  it('shows API UNREACHABLE on locks tab when locks endpoint errors with no data', async () => {
    setMocks(
      live([]),
      live(null),
      { data: null, error: '503', loading: false, refresh: mockRefresh },
    );
    render(<RateLimitsPanel />);

    await userEvent.click(screen.getByRole('tab', { name: /locks/i }));

    expect(screen.getByText('API UNREACHABLE')).toBeInTheDocument();
  });

  // ── Lock count badge ─────────────────────────────────────────────────────

  it('shows the active lock count as a badge next to the LOCKS chip', () => {
    setMocks(live([]), live(null), live(LOCKS_ACTIVE));
    render(<RateLimitsPanel />);
    // The count "1" is rendered inside the LOCKS tab chip
    expect(screen.getByText('1')).toBeInTheDocument();
  });
});
