import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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
// Canned data — all synthetic, no production values. `cad` fills the full
// matrix shape the backend now returns (sync + refresh + configured flags).
// ---------------------------------------------------------------------------
type CadenceInput = {
  platform: string;
  product: string;
  default_interval_seconds: number;
  sync_configured?: boolean;
  refresh_interval_seconds?: number;
  refresh_window_days?: number;
  refresh_configured?: boolean;
  updated_at?: string | null;
};

function cad(o: CadenceInput) {
  return {
    sync_configured: true,
    refresh_interval_seconds: 21600,
    refresh_window_days: 90,
    refresh_configured: false,
    updated_at: null,
    ...o,
  };
}

// instagram identity @ 1h, facebook audience @ 2h
const CADENCES_DEFAULT = [
  cad({ platform: 'instagram', product: 'identity', default_interval_seconds: 3600 }),
  cad({ platform: 'facebook', product: 'audience', default_interval_seconds: 7200 }),
];

// Single row: tiktok engagement_new, sync 30m, refresh 6h, window 90d.
const CADENCES_SINGLE = [
  cad({ platform: 'tiktok', product: 'engagement_new', default_interval_seconds: 1800 }),
];

// ---------------------------------------------------------------------------
import CadencePanel from '../CadencePanel';

function live<T>(data: T, overrides: Partial<LiveState<T>> = {}): LiveState<T> {
  return { data, error: null, loading: false, refresh: mockRefresh, ...overrides };
}

const applyName = /apply cadence for tiktok engagement_new/i;

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

  it('renders cadence rows grouped by platform', () => {
    mockLiveState = live(CADENCES_DEFAULT);
    render(<CadencePanel />);
    // Platform abbreviations from mock (first 2 chars upper-cased)
    expect(screen.getByText('[IN]')).toBeInTheDocument();
    expect(screen.getByText('[FA]')).toBeInTheDocument();
    // Product names
    expect(screen.getByText('identity')).toBeInTheDocument();
    expect(screen.getByText('audience')).toBeInTheDocument();
  });

  // ── Accordion (scalability) ────────────────────────────────────────────────

  it('collapses every platform by default and toggles on header click', async () => {
    mockLiveState = live(CADENCES_SINGLE);
    render(<CadencePanel />);
    const header = screen.getByRole('button', {
      name: /toggle tiktok cadences/i,
    });
    expect(header).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'false');
  });

  it('force-expands matching platforms while a filter is active', () => {
    mockLiveState = live(CADENCES_SINGLE);
    render(<CadencePanel />);
    const header = screen.getByRole('button', {
      name: /toggle tiktok cadences/i,
    });
    expect(header).toHaveAttribute('aria-expanded', 'false');
    fireEvent.change(screen.getByLabelText(/filter cadences/i), {
      target: { value: 'engagement' },
    });
    expect(header).toHaveAttribute('aria-expanded', 'true');
  });

  it('shows "no matches" when the filter matches nothing', () => {
    mockLiveState = live(CADENCES_SINGLE);
    render(<CadencePanel />);
    fireEvent.change(screen.getByLabelText(/filter cadences/i), {
      target: { value: 'zzz-nope' },
    });
    expect(screen.getByText(/no matches/i)).toBeInTheDocument();
  });

  it('shows a custom count on the platform header', () => {
    mockLiveState = live([
      cad({
        platform: 'tiktok',
        product: 'identity',
        default_interval_seconds: 1800,
        sync_configured: true,
      }),
      cad({
        platform: 'tiktok',
        product: 'engagement_new',
        default_interval_seconds: 3600,
        sync_configured: false,
        refresh_configured: false,
      }),
    ]);
    render(<CadencePanel />);
    expect(screen.getByText(/1 custom/i)).toBeInTheDocument();
  });

  it('renders human-readable interval labels', () => {
    mockLiveState = live(CADENCES_DEFAULT);
    render(<CadencePanel />);
    // instagram sync 3600s → 1h
    expect(screen.getAllByText('1h').length).toBeGreaterThanOrEqual(1);
    // facebook sync 7200s → 2h
    expect(screen.getAllByText('2h').length).toBeGreaterThanOrEqual(1);
  });

  it('renders sync and refresh preset chips for each row', () => {
    mockLiveState = live(CADENCES_SINGLE);
    render(<CadencePanel />);
    expect(
      screen.getByRole('button', { name: /set sync interval to 30m/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /set refresh interval to 15m/i }),
    ).toBeInTheDocument();
  });

  it('marks an unconfigured row "default" and a configured row "custom"', () => {
    mockLiveState = live([
      cad({
        platform: 'threads',
        product: 'engagement_new',
        default_interval_seconds: 86400,
        sync_configured: false,
        refresh_configured: false,
      }),
      cad({
        platform: 'tiktok',
        product: 'identity',
        default_interval_seconds: 1800,
        sync_configured: true,
      }),
    ]);
    render(<CadencePanel />);
    expect(screen.getByText('default')).toBeInTheDocument();
    expect(screen.getByText('custom')).toBeInTheDocument();
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

  it('marks the matching sync preset chip as active when its value matches', () => {
    // tiktok sync default = 1800 = 30m → the sync "30m" chip is primary.
    mockLiveState = live(CADENCES_SINGLE);
    render(<CadencePanel />);
    const thirtyMin = screen.getByRole('button', {
      name: /set sync interval to 30m/i,
    });
    expect(thirtyMin.className).toContain('bg-term-mint');
  });

  // ── Edit path: sync interval ───────────────────────────────────────────────

  it('PATCHes only interval_seconds when the sync interval changes', async () => {
    mockLiveState = live(CADENCES_SINGLE);
    render(<CadencePanel />);

    await userEvent.click(
      screen.getByRole('button', { name: /set sync interval to 6h/i }),
    );
    await userEvent.click(screen.getByRole('button', { name: applyName }));

    expect(mockAdminPatch).toHaveBeenCalledWith(
      '/admin/cadences/tiktok/engagement_new',
      { interval_seconds: 21600 },
    );
  });

  // ── Edit path: refresh interval ────────────────────────────────────────────

  it('PATCHes only refresh_interval_seconds when the refresh interval changes', async () => {
    mockLiveState = live(CADENCES_SINGLE);
    render(<CadencePanel />);

    await userEvent.click(
      screen.getByRole('button', { name: /set refresh interval to 15m/i }),
    );
    await userEvent.click(screen.getByRole('button', { name: applyName }));

    expect(mockAdminPatch).toHaveBeenCalledWith(
      '/admin/cadences/tiktok/engagement_new',
      { refresh_interval_seconds: 900 },
    );
  });

  // ── Edit path: refresh window ──────────────────────────────────────────────

  it('PATCHes only refresh_window_days when the window changes', async () => {
    mockLiveState = live(CADENCES_SINGLE);
    render(<CadencePanel />);

    const windowInput = screen.getByLabelText(
      /tiktok engagement_new refresh window in days/i,
    );
    fireEvent.change(windowInput, { target: { value: '30' } });
    await userEvent.click(screen.getByRole('button', { name: applyName }));

    expect(mockAdminPatch).toHaveBeenCalledWith(
      '/admin/cadences/tiktok/engagement_new',
      { refresh_window_days: 30 },
    );
  });

  it('calls refresh after a successful APPLY', async () => {
    mockAdminPatch.mockResolvedValueOnce(undefined);
    mockLiveState = live(CADENCES_SINGLE);
    render(<CadencePanel />);

    await userEvent.click(
      screen.getByRole('button', { name: /set sync interval to 6h/i }),
    );
    await userEvent.click(screen.getByRole('button', { name: applyName }));

    await waitFor(() => {
      expect(mockRefresh).toHaveBeenCalledOnce();
    });
  });

  it('shows an inline error when adminPatch rejects', async () => {
    mockAdminPatch.mockRejectedValueOnce(new Error('422 Validation Failed'));
    mockLiveState = live(CADENCES_SINGLE);
    render(<CadencePanel />);

    await userEvent.click(
      screen.getByRole('button', { name: /set sync interval to 6h/i }),
    );
    await userEvent.click(screen.getByRole('button', { name: applyName }));

    await waitFor(() => {
      expect(screen.getByText(/422 Validation Failed/)).toBeInTheDocument();
    });
  });

  it('APPLY button is disabled when nothing has changed from server values', () => {
    mockLiveState = live(CADENCES_SINGLE);
    render(<CadencePanel />);
    expect(screen.getByRole('button', { name: applyName })).toBeDisabled();
  });

  // ── Footer link ──────────────────────────────────────────────────────────

  it('renders a link to the pipeline deck for schedule and overrides', () => {
    mockLiveState = live(CADENCES_DEFAULT);
    render(<CadencePanel />);
    const link = screen.getByRole('link', { name: /pipeline deck/i });
    expect(link).toHaveAttribute('href', '/admin?deck=pipeline');
  });
});
