import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import RawInspectorPanel from '../RawInspectorPanel';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/useLive', () => ({
  POLL: { live: 3000, list: 5000, config: 15000, catalog: 30000 },
  useLive: vi.fn(),
}));

vi.mock('@/lib/workspace-context', () => ({
  useWorkspaceFilter: () => ({ slug: null, set: vi.fn(), withQuery: (u: string) => u }),
}));

vi.mock('@/lib/api', () => ({
  CONNECTOR_API_URL: 'http://localhost:3000',
}));

import { useLive } from '@/lib/useLive';
const mockUseLive = vi.mocked(useLive);

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ── Fixtures ──────────────────────────────────────────────────────────────────

const sampleRows = [
  {
    id: 'raw-1',
    accountId: 'acc-1',
    platform: 'instagram',
    endpoint: '/v14.0/me/media',
    sizeBytes: 1024,
    fetchedAt: '2024-06-11T10:00:00.000Z',
  },
  {
    id: 'raw-2',
    accountId: 'acc-2',
    platform: 'facebook',
    endpoint: '/v14.0/me/accounts',
    sizeBytes: 512,
    fetchedAt: '2024-06-11T09:58:00.000Z',
  },
];

const sampleDetail = {
  ...sampleRows[0],
  body: { data: [{ id: 'post-1', media_type: 'IMAGE' }] },
};

function mockList(rows = sampleRows) {
  mockUseLive.mockReturnValue({
    data: rows,
    error: null,
    loading: false,
    refresh: vi.fn(),
  });
}

function mockListError() {
  mockUseLive.mockReturnValue({
    data: null,
    error: 'connection refused',
    loading: false,
    refresh: vi.fn(),
  });
}

function mockDetailFetch(detail = sampleDetail) {
  mockFetch.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(detail),
  } as Response);
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('RawInspectorPanel', () => {
  it('renders the list of raw responses', () => {
    mockList();
    render(<RawInspectorPanel />);

    expect(screen.getByText('/v14.0/me/media')).toBeInTheDocument();
    expect(screen.getByText('/v14.0/me/accounts')).toBeInTheDocument();
  });

  it('shows api-down header when list endpoint errors', () => {
    mockListError();
    render(<RawInspectorPanel />);
    expect(screen.getByText(/API UNREACHABLE/i)).toBeInTheDocument();
  });

  it('shows placeholder text before any row is selected', () => {
    mockList();
    render(<RawInspectorPanel />);
    expect(screen.getByText(/select a row/i)).toBeInTheDocument();
  });

  it('clicking a row fetches the detail and shows JSON', async () => {
    mockList();
    mockDetailFetch();
    render(<RawInspectorPanel />);

    fireEvent.click(screen.getByText('/v14.0/me/media'));

    await waitFor(() => {
      const pre = document.querySelector('pre');
      expect(pre).toBeTruthy();
      expect(pre?.textContent).toContain('post-1');
    });
  });

  it('detail view shows a COPY button', async () => {
    mockList();
    mockDetailFetch();
    render(<RawInspectorPanel />);

    fireEvent.click(screen.getByText('/v14.0/me/media'));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /COPY/i })).toBeInTheDocument();
    });
  });

  it('filter input narrows list by endpoint substring', () => {
    mockList();
    render(<RawInspectorPanel />);

    const input = screen.getByRole('textbox', { name: /filter raw responses/i });
    fireEvent.change(input, { target: { value: 'accounts' } });

    expect(screen.queryByText('/v14.0/me/media')).not.toBeInTheDocument();
    expect(screen.getByText('/v14.0/me/accounts')).toBeInTheDocument();
  });

  it('shows row count in footer', () => {
    mockList();
    render(<RawInspectorPanel />);
    // Footer: "2 / 2"
    expect(screen.getByText('2 / 2')).toBeInTheDocument();
  });

  it('renders RAW INSPECTOR header in normal state', () => {
    mockList();
    render(<RawInspectorPanel />);
    expect(screen.getByText('RAW INSPECTOR')).toBeInTheDocument();
  });

  it('shows loading indicator when detail fetch is in-flight', async () => {
    mockList();
    // Return a pending promise so the loading state persists
    mockFetch.mockReturnValue(new Promise(() => {}));
    render(<RawInspectorPanel />);

    fireEvent.click(screen.getByText('/v14.0/me/media'));

    // The inspector pane should show loading text
    await waitFor(() => {
      expect(screen.getByText(/loading/i)).toBeInTheDocument();
    });
  });

  it('shows error text when detail fetch fails', async () => {
    mockList();
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    } as Response);
    render(<RawInspectorPanel />);

    fireEvent.click(screen.getByText('/v14.0/me/media'));

    await waitFor(() => {
      expect(screen.getByText(/404 Not Found/i)).toBeInTheDocument();
    });
  });
});
