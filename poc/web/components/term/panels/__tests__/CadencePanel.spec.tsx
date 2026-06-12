import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

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
// Mock @/lib/api — capture adminPatch for mutation assertions.
// ---------------------------------------------------------------------------
const mockAdminPatch = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/api', () => ({
  CONNECTOR_API_URL: 'http://localhost:3000',
  adminPost: vi.fn().mockResolvedValue(undefined),
  adminPatch: (...args: unknown[]) => mockAdminPatch(...args),
}));

// ---------------------------------------------------------------------------
// Mock next/link → plain <a>
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

// Two rows: instagram identity @ 1h, facebook audience @ 2h
const CADENCES_DEFAULT = [
  { platform: 'instagram', product: 'identity', default_interval_seconds: 3600 },
  { platform: 'facebook', product: 'audience', default_interval_seconds: 7200 },
];

// Single row: tiktok engagement_new @ 30m
const CADENCES_SINGLE = [
  { platform: 'tiktok', product: 'engagement_new', default_interval_seconds: 1800 },
];

// ---------------------------------------------------------------------------
import CadencePanel from '../CadencePanel';

function live<T>(data: T, overrides: Partial<LiveState<T>> = {}): LiveState<T> {
  return { data, error: null, loading: false, refresh: mockRefresh, ...overrides };
}

// ---------------------------------------------------------------------------

describe('CadencePanel', () => {
  beforeEach(() => {
    mockRefresh.mockClear();
    mockAdminPatch.mockClear();
    mockAdminPatch.mockResolvedValue(undefined);
    mockLiveState = { data: null, error: null, loading: true, refresh: mockRefresh };
  });

  // ── Loading / connecting ─────────────────────────────────────────────────

  it('renders connecting state when loading and no data', () => {
    mockLiveState = { data: null, error: null, loading: true, refresh: mockRefresh };
    render(<CadencePanel />);
    expect(screen.getByText(/connecting/i)).toBeInTheDocument();
  });

  // ── Data rendering ───────────────────────────────────────────────────────

  it('renders cadence rows from data', () => {
    mockLiveState = live(CADENCES_DEFAULT);
    render(<CadencePanel />);
    // Platform abbreviations from mock (first 2 chars upper-cased)
    expect(screen.getByText('[IN]')).toBeInTheDocument();
    expect(screen.getByText('[FA]')).toBeInTheDocument();
    // Product names
    expect(screen.getByText('identity')).toBeInTheDocument();
    expect(screen.getByText('audience')).toBeInTheDocument();
  });

  it('renders human-readable interval labels', () => {
    mockLiveState = live(CADENCES_DEFAULT);
    render(<CadencePanel />);
    // instagram: 3600s → 1h (label span + possibly a preset chip)
    expect(screen.getAllByText('1h').length).toBeGreaterThanOrEqual(1);
    // facebook: 7200s → 2h
    expect(screen.getAllByText('2h').length).toBeGreaterThanOrEqual(1);
  });

  it('renders preset chips for each cadence row', () => {
    mockLiveState = live(CADENCES_SINGLE);
    render(<CadencePanel />);
    expect(screen.getByRole('button', { name: /set interval to 30m/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /set interval to 24h/i })).toBeInTheDocument();
  });

  it('renders empty state when cadences array is empty', () => {
    mockLiveState = live([]);
    render(<CadencePanel />);
    expect(screen.getByText(/no cadences registered/i)).toBeInTheDocument();
  });

  // ── API-down state ───────────────────────────────────────────────────────

  it('renders API UNREACHABLE header when endpoint errors with no data', () => {
    mockLiveState = {
      data: null,
      error: '503 Service Unavailable',
      loading: false,
      refresh: mockRefresh,
    };
    render(<CadencePanel />);
    expect(screen.getByText('API UNREACHABLE')).toBeInTheDocument();
  });

  it('does NOT show API UNREACHABLE when stale data is present alongside an error', () => {
    mockLiveState = {
      data: CADENCES_DEFAULT,
      error: 'timeout',
      loading: false,
      refresh: mockRefresh,
    };
    render(<CadencePanel />);
    expect(screen.queryByText('API UNREACHABLE')).not.toBeInTheDocument();
    expect(screen.getByText('identity')).toBeInTheDocument();
  });

  // ── Preset chip interaction ───────────────────────────────────────────────

  it('marks the matching preset chip as active (primary variant) when its value matches the interval', () => {
    // tiktok default = 1800 = 30m → the "30m" preset chip should have primary variant (bg-term-mint)
    mockLiveState = live(CADENCES_SINGLE);
    render(<CadencePanel />);
    // With a single row there is exactly one "set interval to 30m" button
    const thirtyMinBtn = screen.getByRole('button', { name: /set interval to 30m/i });
    expect(thirtyMinBtn.className).toContain('bg-term-mint');
  });

  it('updates the displayed interval label when a preset chip is clicked', async () => {
    mockLiveState = live(CADENCES_SINGLE); // tiktok: 1800s = 30m
    render(<CadencePanel />);

    // Click the 6h preset (21600s)
    await userEvent.click(screen.getByRole('button', { name: /set interval to 6h/i }));

    // The human-interval label for this row should now show 6h
    expect(screen.getAllByText('6h').length).toBeGreaterThanOrEqual(1);
  });

  // ── Edit path: APPLY fires API ────────────────────────────────────────────

  it('fires adminPatch with correct endpoint and body when APPLY is clicked after a preset change', async () => {
    mockLiveState = live(CADENCES_SINGLE); // tiktok:engagement_new default=1800
    render(<CadencePanel />);

    // Change to 6h (21600s) using preset chip
    await userEvent.click(screen.getByRole('button', { name: /set interval to 6h/i }));

    // APPLY should now be enabled — click it
    const applyBtn = screen.getByRole('button', {
      name: /apply cadence for tiktok engagement_new/i,
    });
    await userEvent.click(applyBtn);

    expect(mockAdminPatch).toHaveBeenCalledWith(
      '/admin/cadences/tiktok/engagement_new',
      { interval_seconds: 21600 },
    );
  });

  it('calls refresh after a successful APPLY', async () => {
    mockAdminPatch.mockResolvedValueOnce(undefined);
    mockLiveState = live(CADENCES_SINGLE);
    render(<CadencePanel />);

    await userEvent.click(screen.getByRole('button', { name: /set interval to 6h/i }));
    await userEvent.click(
      screen.getByRole('button', { name: /apply cadence for tiktok engagement_new/i }),
    );

    await waitFor(() => {
      expect(mockRefresh).toHaveBeenCalledOnce();
    });
  });

  it('shows an inline error when adminPatch rejects', async () => {
    mockAdminPatch.mockRejectedValueOnce(new Error('422 Validation Failed'));
    mockLiveState = live(CADENCES_SINGLE);
    render(<CadencePanel />);

    await userEvent.click(screen.getByRole('button', { name: /set interval to 6h/i }));
    await userEvent.click(
      screen.getByRole('button', { name: /apply cadence for tiktok engagement_new/i }),
    );

    await waitFor(() => {
      expect(screen.getByText(/422 Validation Failed/)).toBeInTheDocument();
    });
  });

  it('APPLY button is disabled when value has not changed from the server value', () => {
    // CADENCES_SINGLE: tiktok default = 1800 = 30m. No preset click → value unchanged.
    mockLiveState = live(CADENCES_SINGLE);
    render(<CadencePanel />);
    const applyBtn = screen.getByRole('button', {
      name: /apply cadence for tiktok engagement_new/i,
    });
    expect(applyBtn).toBeDisabled();
  });

  // ── Footer link ──────────────────────────────────────────────────────────

  it('renders a link to the pipeline deck for schedule and overrides', () => {
    mockLiveState = live(CADENCES_DEFAULT);
    render(<CadencePanel />);
    const link = screen.getByRole('link', { name: /pipeline deck/i });
    expect(link).toHaveAttribute('href', '/admin?deck=pipeline');
  });
});
