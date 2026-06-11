import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import LiveActivityPanel from '../LiveActivityPanel';

// ── Mock useLive ──────────────────────────────────────────────────────────────

vi.mock('@/lib/useLive', () => ({
  POLL: { live: 3000, list: 5000, config: 15000, catalog: 30000 },
  useLive: vi.fn(),
}));

vi.mock('@/lib/workspace-context', () => ({
  useWorkspaceFilter: () => ({ slug: null, set: vi.fn(), withQuery: (u: string) => u }),
}));

import { useLive } from '@/lib/useLive';
const mockUseLive = vi.mocked(useLive);

// Shorthand to set all four sources at once
function mockAllSources({
  calls = [],
  events = [],
  webhooks = [],
  deliveries = [],
}: {
  calls?: unknown[];
  events?: unknown[];
  webhooks?: unknown[];
  deliveries?: unknown[];
} = {}) {
  const sources = [calls, events, webhooks, deliveries];
  let call = 0;
  mockUseLive.mockImplementation(() => {
    const data = sources[call++ % 4] as object[];
    return { data, error: null, loading: false, refresh: vi.fn() };
  });
}

function mockAllErrors() {
  mockUseLive.mockImplementation(() => ({
    data: null,
    error: 'connection refused',
    loading: false,
    refresh: vi.fn(),
  }));
}

function mockAllLoading() {
  mockUseLive.mockImplementation(() => ({
    data: null,
    error: null,
    loading: true,
    refresh: vi.fn(),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

const sampleCall = {
  called_at: '2024-06-11T10:00:00.000Z',
  platform: 'instagram',
  endpoint: '/v14.0/me/media',
  status_code: 200,
  duration_ms: 142,
};

const sampleEvent = {
  id: 'evt-1',
  event_type: 'content.added',
  account_id: 'acc-1',
  emitted_at: '2024-06-11T09:58:00.000Z',
};

const sampleWebhook = {
  id: 'wh-1',
  platform: 'instagram',
  topic: 'feed',
  received_at: '2024-06-11T09:57:00.000Z',
  status: 'enqueued',
};

const sampleDelivery = {
  id: 'del-1',
  endpoint_url: 'https://example.com/hook',
  workspace_slug: 'acme',
  event: 'account.connected',
  status: 'delivered',
  attempts: 1,
  last_response_code: 200,
  last_error: null,
  created_at: '2024-06-11T09:54:00.000Z',
  delivered_at: '2024-06-11T09:54:01.000Z',
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('LiveActivityPanel', () => {
  it('shows loading state when all sources are still loading', () => {
    mockAllLoading();
    render(<LiveActivityPanel />);
    expect(screen.getAllByText(/connecting/i).length).toBeGreaterThan(0);
  });

  it('shows api-down state when all four sources error', () => {
    mockAllErrors();
    render(<LiveActivityPanel />);
    expect(screen.getByText(/ALL SOURCES UNREACHABLE/i)).toBeInTheDocument();
  });

  it('renders mixed-kind rows from all four sources', () => {
    mockAllSources({
      calls: [sampleCall],
      events: [sampleEvent],
      webhooks: [sampleWebhook],
      deliveries: [sampleDelivery],
    });
    render(<LiveActivityPanel />);

    // Kind tags
    expect(screen.getByText('[CALL]')).toBeInTheDocument();
    expect(screen.getByText('[EVT]')).toBeInTheDocument();
    expect(screen.getByText('[WHK]')).toBeInTheDocument();
    expect(screen.getByText('[DLV]')).toBeInTheDocument();
  });

  it('renders the call summary (endpoint) in the feed', () => {
    mockAllSources({ calls: [sampleCall] });
    render(<LiveActivityPanel />);
    expect(screen.getByText('/v14.0/me/media')).toBeInTheDocument();
  });

  it('facet chip CALLS filters to only call rows', () => {
    mockAllSources({
      calls: [sampleCall],
      events: [sampleEvent],
      webhooks: [sampleWebhook],
      deliveries: [sampleDelivery],
    });
    render(<LiveActivityPanel />);

    fireEvent.click(screen.getByRole('button', { name: /^CALLS$/i }));

    expect(screen.getByText('[CALL]')).toBeInTheDocument();
    expect(screen.queryByText('[EVT]')).not.toBeInTheDocument();
    expect(screen.queryByText('[WHK]')).not.toBeInTheDocument();
    expect(screen.queryByText('[DLV]')).not.toBeInTheDocument();
  });

  it('facet chip EVENTS filters to only event rows', () => {
    mockAllSources({
      calls: [sampleCall],
      events: [sampleEvent],
    });
    render(<LiveActivityPanel />);

    fireEvent.click(screen.getByRole('button', { name: /^EVENTS$/i }));

    expect(screen.queryByText('[CALL]')).not.toBeInTheDocument();
    expect(screen.getByText('[EVT]')).toBeInTheDocument();
  });

  it('filter input narrows by summary text', () => {
    mockAllSources({
      calls: [sampleCall],
      events: [sampleEvent],
    });
    render(<LiveActivityPanel />);

    const input = screen.getByRole('textbox', { name: /filter activity/i });
    fireEvent.change(input, { target: { value: 'me/media' } });

    expect(screen.getByText('[CALL]')).toBeInTheDocument();
    expect(screen.queryByText('[EVT]')).not.toBeInTheDocument();
  });

  it('clicking a row expands the raw JSON drawer', () => {
    mockAllSources({ calls: [sampleCall] });
    render(<LiveActivityPanel />);

    const row = screen.getByText('[CALL]').closest('[role="button"]')!;
    fireEvent.click(row);

    // The pre element with JSON should appear
    const pre = document.querySelector('pre');
    expect(pre).toBeTruthy();
    expect(pre?.textContent).toContain('/v14.0/me/media');
  });

  it('clicking an expanded row again collapses the drawer', () => {
    mockAllSources({ calls: [sampleCall] });
    render(<LiveActivityPanel />);

    const row = screen.getByText('[CALL]').closest('[role="button"]')!;
    fireEvent.click(row);
    expect(document.querySelector('pre')).toBeTruthy();

    fireEvent.click(row);
    expect(document.querySelector('pre')).toBeNull();
  });

  it('drawer contains a COPY button', () => {
    mockAllSources({ calls: [sampleCall] });
    render(<LiveActivityPanel />);

    const row = screen.getByText('[CALL]').closest('[role="button"]')!;
    fireEvent.click(row);

    expect(screen.getByRole('button', { name: /COPY/i })).toBeInTheDocument();
  });

  it('shows empty state when no items match filter', () => {
    mockAllSources({ calls: [sampleCall] });
    render(<LiveActivityPanel />);

    const input = screen.getByRole('textbox', { name: /filter activity/i });
    fireEvent.change(input, { target: { value: 'zzz-no-match' } });

    expect(screen.getByText(/no items match filter/i)).toBeInTheDocument();
  });

  it('stream container has aria-live="polite"', () => {
    mockAllSources();
    render(<LiveActivityPanel />);
    const live = document.querySelector('[aria-live="polite"][aria-label="Activity stream"]');
    expect(live).toBeTruthy();
  });
});
