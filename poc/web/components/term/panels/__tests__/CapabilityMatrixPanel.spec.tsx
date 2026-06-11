import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

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
// Canned data — matches the real /admin/support-matrix response structure.
// ---------------------------------------------------------------------------
const MATRIX_DATA = {
  platforms: {
    instagram: {
      identity: {
        username: 'supported',
        followers_count: 'supported',
        bio: 'empty_possible',
      },
      content_engagement: {
        likes: 'supported',
        comments: 'supported',
        reach: 'empty_possible',
      },
      audience: {
        age_groups: 'not_supported',
        countries: 'not_supported',
      },
    },
    tiktok: {
      identity: {
        username: 'supported',
        followers_count: 'supported',
        bio: 'not_supported',
      },
      content_engagement: {
        likes: 'supported',
        comments: 'not_supported',
        reach: 'not_supported',
      },
    },
  },
};

const SINGLE_PLATFORM = {
  platforms: {
    youtube: {
      identity: {
        channel_name: 'supported',
        subscriber_count: 'supported',
        description: 'empty_possible',
      },
    },
  },
};

// ---------------------------------------------------------------------------
import CapabilityMatrixPanel from '../CapabilityMatrixPanel';

describe('CapabilityMatrixPanel', () => {
  beforeEach(() => {
    mockRefresh.mockClear();
    mockLiveState = { data: null, error: null, loading: true, refresh: mockRefresh };
  });

  it('renders the connecting state when loading and no data', () => {
    mockLiveState = { data: null, error: null, loading: true, refresh: mockRefresh };
    render(<CapabilityMatrixPanel />);
    expect(screen.getByText(/connecting/i)).toBeInTheDocument();
  });

  it('renders the api-down state when error and no data', () => {
    mockLiveState = {
      data: null,
      error: '503 Service Unavailable',
      loading: false,
      refresh: mockRefresh,
    };
    render(<CapabilityMatrixPanel />);
    expect(screen.getByText('API UNREACHABLE')).toBeInTheDocument();
    expect(screen.getByText(/503/)).toBeInTheDocument();
  });

  it('does NOT render api-down state when data is present alongside an error', () => {
    mockLiveState = {
      data: SINGLE_PLATFORM,
      error: 'stale',
      loading: false,
      refresh: mockRefresh,
    };
    render(<CapabilityMatrixPanel />);
    expect(screen.queryByText('API UNREACHABLE')).not.toBeInTheDocument();
  });

  it('renders the header label when data is present', () => {
    mockLiveState = { data: SINGLE_PLATFORM, error: null, loading: false, refresh: mockRefresh };
    render(<CapabilityMatrixPanel />);
    expect(screen.getByText('CAPABILITY MATRIX')).toBeInTheDocument();
  });

  it('renders platform tab buttons when multiple platforms present', () => {
    mockLiveState = { data: MATRIX_DATA, error: null, loading: false, refresh: mockRefresh };
    render(<CapabilityMatrixPanel />);
    const tabs = screen.getAllByRole('tab');
    const labels = tabs.map((t) => t.textContent?.toLowerCase());
    expect(labels.some((l) => l?.includes('instagram'))).toBe(true);
    expect(labels.some((l) => l?.includes('tiktok'))).toBe(true);
  });

  it('does NOT render platform tabs when only one platform', () => {
    mockLiveState = { data: SINGLE_PLATFORM, error: null, loading: false, refresh: mockRefresh };
    render(<CapabilityMatrixPanel />);
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  });

  it('renders product columns as table headers', () => {
    mockLiveState = { data: MATRIX_DATA, error: null, loading: false, refresh: mockRefresh };
    render(<CapabilityMatrixPanel />);
    expect(screen.getByText(/identity/i)).toBeInTheDocument();
    expect(screen.getByText(/content engagement/i)).toBeInTheDocument();
  });

  it('renders field names as table row headers', () => {
    mockLiveState = { data: MATRIX_DATA, error: null, loading: false, refresh: mockRefresh };
    render(<CapabilityMatrixPanel />);
    expect(screen.getByText('username')).toBeInTheDocument();
    expect(screen.getByText('followers_count')).toBeInTheDocument();
  });

  it('renders ● symbol for supported cells', () => {
    mockLiveState = { data: SINGLE_PLATFORM, error: null, loading: false, refresh: mockRefresh };
    render(<CapabilityMatrixPanel />);
    const supportedCells = document.querySelectorAll('[data-support="supported"]');
    expect(supportedCells.length).toBeGreaterThan(0);
    supportedCells.forEach((cell) => expect(cell.textContent).toBe('●'));
  });

  it('renders ◐ symbol for empty_possible cells', () => {
    mockLiveState = { data: SINGLE_PLATFORM, error: null, loading: false, refresh: mockRefresh };
    render(<CapabilityMatrixPanel />);
    const partialCells = document.querySelectorAll('[data-support="empty_possible"]');
    expect(partialCells.length).toBeGreaterThan(0);
    partialCells.forEach((cell) => expect(cell.textContent).toBe('◐'));
  });

  it('renders · symbol for not_supported cells', () => {
    mockLiveState = { data: MATRIX_DATA, error: null, loading: false, refresh: mockRefresh };
    render(<CapabilityMatrixPanel />);
    const unsupportedCells = document.querySelectorAll('[data-support="not_supported"]');
    expect(unsupportedCells.length).toBeGreaterThan(0);
    unsupportedCells.forEach((cell) => expect(cell.textContent).toBe('·'));
  });

  it('all three cell states are visually distinct (different symbols)', () => {
    mockLiveState = { data: MATRIX_DATA, error: null, loading: false, refresh: mockRefresh };
    render(<CapabilityMatrixPanel />);
    const supported = document.querySelectorAll('[data-support="supported"]');
    const partial = document.querySelectorAll('[data-support="empty_possible"]');
    const unsupported = document.querySelectorAll('[data-support="not_supported"]');
    expect(supported.length).toBeGreaterThan(0);
    expect(partial.length).toBeGreaterThan(0);
    expect(unsupported.length).toBeGreaterThan(0);
    const symbols = new Set([
      supported[0].textContent,
      partial[0].textContent,
      unsupported[0].textContent,
    ]);
    expect(symbols.size).toBe(3);
  });

  it('renders the legend row with all three states', () => {
    mockLiveState = { data: SINGLE_PLATFORM, error: null, loading: false, refresh: mockRefresh };
    render(<CapabilityMatrixPanel />);
    expect(screen.getByText(/legend/i)).toBeInTheDocument();
    // Use exact legend span text — "● supported", "◐ empty possible", "· not supported"
    expect(screen.getByText('● supported')).toBeInTheDocument();
    expect(screen.getByText('◐ empty possible')).toBeInTheDocument();
    expect(screen.getByText('· not supported')).toBeInTheDocument();
  });

  it('switches active platform when a tab is clicked', async () => {
    mockLiveState = { data: MATRIX_DATA, error: null, loading: false, refresh: mockRefresh };
    render(<CapabilityMatrixPanel />);
    const tiktokTab = screen.getByRole('tab', { name: /tiktok/i });
    await userEvent.click(tiktokTab);
    expect(tiktokTab).toHaveAttribute('aria-selected', 'true');
  });
});
