import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  resetSelection,
  getSelection,
  selectWorkspace,
} from '@/lib/term/selection';

// ---------------------------------------------------------------------------
// Mock useLive — multi-endpoint version. Each useLive call is matched by path
// fragment so individual tests can arm different endpoints independently.
// ---------------------------------------------------------------------------
type LiveState<T> = {
  data: T | null;
  error: string | null;
  loading: boolean;
  refresh: () => void;
};

const mockRefresh = vi.fn();

const defaultState: LiveState<unknown> = {
  data: null,
  error: null,
  loading: true,
  refresh: mockRefresh,
};

// Keys are partial path strings. Longest key wins so "/admin/workspaces/acme"
// does not accidentally match "/admin/workspaces/acme/accounts".
type PathStates = Record<string, LiveState<unknown>>;
let pathStates: PathStates = {};

vi.mock('@/lib/useLive', () => ({
  POLL: { live: 3000, list: 5000, config: 15000, catalog: 30000 },
  useLive: (path: string | null) => {
    if (!path) return defaultState;
    // Sort by key length descending so more specific paths match first.
    const sorted = Object.entries(pathStates).sort(([a], [b]) => b.length - a.length);
    for (const [fragment, state] of sorted) {
      if (path.includes(fragment)) return state;
    }
    return defaultState;
  },
}));

// ---------------------------------------------------------------------------
// Mock workspace-context — default: no global filter (slug: null).
// ---------------------------------------------------------------------------
vi.mock('@/lib/workspace-context', () => ({
  useWorkspaceFilter: () => ({ slug: null, set: vi.fn(), withQuery: (u: string) => u }),
}));

// ---------------------------------------------------------------------------
// Canned data — synthetic only, no production values.
// ---------------------------------------------------------------------------
const WS_DETAIL = {
  id: 'ws-uuid-1',
  slug: 'acme',
  name: 'ACME Corp',
  plan_tier: 'pro',
  account_count: 3,
  active_api_key_count: 2,
  webhook_endpoint_count: 1,
};

const ACCOUNTS = [
  { id: 'acc-1', handle: '@alice', platform: 'instagram', status: 'active' },
  { id: 'acc-2', handle: '@bob', platform: 'tiktok', status: 'inactive' },
];

const KEYS = [
  {
    id: 'key-1',
    key_prefix: 'ck_live_abc',
    scope: 'full',
    label: 'prod',
    last_used_at: null,
    revoked_at: null,
    created_at: '2025-01-01T00:00:00Z',
  },
  {
    id: 'key-2',
    key_prefix: 'ck_test_xyz',
    scope: 'test',
    label: null,
    last_used_at: null,
    revoked_at: '2025-03-01T00:00:00Z',
    created_at: '2025-02-01T00:00:00Z',
  },
];

const WEBHOOKS = [
  {
    id: 'wh-1',
    url: 'https://app.example.com/hooks',
    events: ['account.connected'],
    active: true,
    description: null,
    createdAt: '2025-01-01T00:00:00Z',
  },
];

// ---------------------------------------------------------------------------
import TenantInspectorPanel from '../TenantInspectorPanel';

describe('TenantInspectorPanel', () => {
  beforeEach(() => {
    mockRefresh.mockClear();
    resetSelection();
    pathStates = {};
  });

  // ── Empty state ────────────────────────────────────────────────────────────

  it('shows empty state when no workspace is selected', () => {
    render(<TenantInspectorPanel />);
    expect(
      screen.getByText(/select a workspace from the directory/i),
    ).toBeInTheDocument();
  });

  it('includes the blinking caret in the empty state', () => {
    render(<TenantInspectorPanel />);
    // The ▮ character is present in the empty-state container
    const el = screen.getByText(/select a workspace from the directory/i);
    expect(el.textContent).toContain('▮');
  });

  // ── Loading / error states ─────────────────────────────────────────────────

  it('shows workspace loading state when selection is set but data not yet arrived', () => {
    selectWorkspace('acme');
    // All paths return the default loading state (no pathStates set)
    render(<TenantInspectorPanel />);
    expect(screen.getByText(/loading acme/i)).toBeInTheDocument();
  });

  it('shows API unreachable when workspace endpoint errors with no data', () => {
    selectWorkspace('acme');
    pathStates['/admin/workspaces/acme/accounts'] = { data: null, error: null, loading: false, refresh: mockRefresh };
    pathStates['/admin/workspaces/acme/api-keys'] = { data: null, error: null, loading: false, refresh: mockRefresh };
    pathStates['/admin/workspaces/acme/webhook-endpoints'] = { data: null, error: null, loading: false, refresh: mockRefresh };
    pathStates['/admin/workspaces/acme'] = {
      data: null,
      error: '404 Not Found',
      loading: false,
      refresh: mockRefresh,
    };
    render(<TenantInspectorPanel />);
    expect(screen.getByText('API UNREACHABLE')).toBeInTheDocument();
  });

  // ── Overview tab ───────────────────────────────────────────────────────────

  it('renders the overview tab by default with workspace stats', () => {
    selectWorkspace('acme');
    pathStates['/admin/workspaces/acme/accounts'] = { data: null, error: null, loading: false, refresh: mockRefresh };
    pathStates['/admin/workspaces/acme/api-keys'] = { data: null, error: null, loading: false, refresh: mockRefresh };
    pathStates['/admin/workspaces/acme/webhook-endpoints'] = { data: null, error: null, loading: false, refresh: mockRefresh };
    pathStates['/admin/workspaces/acme'] = {
      data: WS_DETAIL,
      error: null,
      loading: false,
      refresh: mockRefresh,
    };
    render(<TenantInspectorPanel />);

    // StatBlock renders labels in title case (CSS uppercases them visually)
    expect(screen.getByText('Accounts')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('Active keys')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('Webhooks')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('shows the workspace id and plan in overview', () => {
    selectWorkspace('acme');
    pathStates['/admin/workspaces/acme/accounts'] = { data: null, error: null, loading: false, refresh: mockRefresh };
    pathStates['/admin/workspaces/acme/api-keys'] = { data: null, error: null, loading: false, refresh: mockRefresh };
    pathStates['/admin/workspaces/acme/webhook-endpoints'] = { data: null, error: null, loading: false, refresh: mockRefresh };
    pathStates['/admin/workspaces/acme'] = {
      data: WS_DETAIL,
      error: null,
      loading: false,
      refresh: mockRefresh,
    };
    render(<TenantInspectorPanel />);

    expect(screen.getByText('ws-uuid-1')).toBeInTheDocument();
    // 'pro' appears in both the header plan badge and the overview row
    expect(screen.getAllByText('pro').length).toBeGreaterThanOrEqual(1);
  });

  it('shows workspace name and slug in the header', () => {
    selectWorkspace('acme');
    pathStates['/admin/workspaces/acme/accounts'] = { data: null, error: null, loading: false, refresh: mockRefresh };
    pathStates['/admin/workspaces/acme/api-keys'] = { data: null, error: null, loading: false, refresh: mockRefresh };
    pathStates['/admin/workspaces/acme/webhook-endpoints'] = { data: null, error: null, loading: false, refresh: mockRefresh };
    pathStates['/admin/workspaces/acme'] = {
      data: WS_DETAIL,
      error: null,
      loading: false,
      refresh: mockRefresh,
    };
    render(<TenantInspectorPanel />);

    // Name appears in header
    expect(screen.getAllByText('ACME Corp').length).toBeGreaterThan(0);
    // Slug also appears in header
    expect(screen.getAllByText('acme').length).toBeGreaterThan(0);
  });

  // ── Tab switching ──────────────────────────────────────────────────────────

  it('switches to the accounts tab when the ACCOUNTS chip is clicked', async () => {
    selectWorkspace('acme');
    pathStates['/admin/workspaces/acme/accounts'] = {
      data: ACCOUNTS,
      error: null,
      loading: false,
      refresh: mockRefresh,
    };
    pathStates['/admin/workspaces/acme/api-keys'] = { data: null, error: null, loading: false, refresh: mockRefresh };
    pathStates['/admin/workspaces/acme/webhook-endpoints'] = { data: null, error: null, loading: false, refresh: mockRefresh };
    pathStates['/admin/workspaces/acme'] = {
      data: WS_DETAIL,
      error: null,
      loading: false,
      refresh: mockRefresh,
    };
    render(<TenantInspectorPanel />);

    await userEvent.click(screen.getByRole('tab', { name: /accounts/i }));

    expect(screen.getByText('@alice')).toBeInTheDocument();
    expect(screen.getByText('@bob')).toBeInTheDocument();
  });

  it('switches to the keys tab and shows masked key prefix', async () => {
    selectWorkspace('acme');
    pathStates['/admin/workspaces/acme/api-keys'] = {
      data: KEYS,
      error: null,
      loading: false,
      refresh: mockRefresh,
    };
    pathStates['/admin/workspaces/acme/accounts'] = { data: null, error: null, loading: false, refresh: mockRefresh };
    pathStates['/admin/workspaces/acme/webhook-endpoints'] = { data: null, error: null, loading: false, refresh: mockRefresh };
    pathStates['/admin/workspaces/acme'] = {
      data: WS_DETAIL,
      error: null,
      loading: false,
      refresh: mockRefresh,
    };
    render(<TenantInspectorPanel />);

    await userEvent.click(screen.getByRole('tab', { name: /keys/i }));

    // Prefix shown with trailing ellipsis — never the full key
    expect(screen.getByText('ck_live_abc…')).toBeInTheDocument();
    expect(screen.getByText('ck_test_xyz…')).toBeInTheDocument();
  });

  it('never renders the raw key prefix without the ellipsis mask', async () => {
    selectWorkspace('acme');
    pathStates['/admin/workspaces/acme/api-keys'] = {
      data: KEYS,
      error: null,
      loading: false,
      refresh: mockRefresh,
    };
    pathStates['/admin/workspaces/acme/accounts'] = { data: null, error: null, loading: false, refresh: mockRefresh };
    pathStates['/admin/workspaces/acme/webhook-endpoints'] = { data: null, error: null, loading: false, refresh: mockRefresh };
    pathStates['/admin/workspaces/acme'] = {
      data: WS_DETAIL,
      error: null,
      loading: false,
      refresh: mockRefresh,
    };
    render(<TenantInspectorPanel />);
    await userEvent.click(screen.getByRole('tab', { name: /keys/i }));

    // The bare prefix text must not appear; only the masked form with "…"
    expect(screen.queryByText('ck_live_abc')).not.toBeInTheDocument();
    expect(screen.getByText('ck_live_abc…')).toBeInTheDocument();
  });

  it('shows "revoked" status for a revoked key', async () => {
    selectWorkspace('acme');
    pathStates['/admin/workspaces/acme/api-keys'] = {
      data: KEYS,
      error: null,
      loading: false,
      refresh: mockRefresh,
    };
    pathStates['/admin/workspaces/acme/accounts'] = { data: null, error: null, loading: false, refresh: mockRefresh };
    pathStates['/admin/workspaces/acme/webhook-endpoints'] = { data: null, error: null, loading: false, refresh: mockRefresh };
    pathStates['/admin/workspaces/acme'] = {
      data: WS_DETAIL,
      error: null,
      loading: false,
      refresh: mockRefresh,
    };
    render(<TenantInspectorPanel />);
    await userEvent.click(screen.getByRole('tab', { name: /keys/i }));

    expect(screen.getByText('revoked')).toBeInTheDocument();
  });

  it('switches to the webhooks tab and shows endpoint URL', async () => {
    selectWorkspace('acme');
    pathStates['/admin/workspaces/acme/webhook-endpoints'] = {
      data: WEBHOOKS,
      error: null,
      loading: false,
      refresh: mockRefresh,
    };
    pathStates['/admin/workspaces/acme/accounts'] = { data: null, error: null, loading: false, refresh: mockRefresh };
    pathStates['/admin/workspaces/acme/api-keys'] = { data: null, error: null, loading: false, refresh: mockRefresh };
    pathStates['/admin/workspaces/acme'] = {
      data: WS_DETAIL,
      error: null,
      loading: false,
      refresh: mockRefresh,
    };
    render(<TenantInspectorPanel />);

    await userEvent.click(screen.getByRole('tab', { name: /webhooks/i }));

    expect(screen.getByText('https://app.example.com/hooks')).toBeInTheDocument();
  });

  // ── Account row → selectAccount ────────────────────────────────────────────

  it('calls selectAccount when an account row is clicked', async () => {
    selectWorkspace('acme');
    pathStates['/admin/workspaces/acme/accounts'] = {
      data: ACCOUNTS,
      error: null,
      loading: false,
      refresh: mockRefresh,
    };
    pathStates['/admin/workspaces/acme/api-keys'] = { data: null, error: null, loading: false, refresh: mockRefresh };
    pathStates['/admin/workspaces/acme/webhook-endpoints'] = { data: null, error: null, loading: false, refresh: mockRefresh };
    pathStates['/admin/workspaces/acme'] = {
      data: WS_DETAIL,
      error: null,
      loading: false,
      refresh: mockRefresh,
    };
    render(<TenantInspectorPanel />);
    await userEvent.click(screen.getByRole('tab', { name: /accounts/i }));

    const aliceRow = screen.getByText('@alice').closest('tr');
    expect(aliceRow).toBeTruthy();
    await userEvent.click(aliceRow!);

    expect(getSelection().accountId).toBe('acc-1');
  });

  it('applies active accent to clicked account row', async () => {
    selectWorkspace('acme');
    pathStates['/admin/workspaces/acme/accounts'] = {
      data: ACCOUNTS,
      error: null,
      loading: false,
      refresh: mockRefresh,
    };
    pathStates['/admin/workspaces/acme/api-keys'] = { data: null, error: null, loading: false, refresh: mockRefresh };
    pathStates['/admin/workspaces/acme/webhook-endpoints'] = { data: null, error: null, loading: false, refresh: mockRefresh };
    pathStates['/admin/workspaces/acme'] = {
      data: WS_DETAIL,
      error: null,
      loading: false,
      refresh: mockRefresh,
    };
    render(<TenantInspectorPanel />);
    await userEvent.click(screen.getByRole('tab', { name: /accounts/i }));
    await userEvent.click(screen.getByText('@alice').closest('tr')!);

    const row = screen.getByText('@alice').closest('tr');
    expect(row?.className).toContain('bg-term-mint/5');
  });

  // ── Empty sub-tabs ─────────────────────────────────────────────────────────

  it('shows "no accounts connected" empty state when accounts list is empty', async () => {
    selectWorkspace('acme');
    pathStates['/admin/workspaces/acme/accounts'] = {
      data: [],
      error: null,
      loading: false,
      refresh: mockRefresh,
    };
    pathStates['/admin/workspaces/acme/api-keys'] = { data: null, error: null, loading: false, refresh: mockRefresh };
    pathStates['/admin/workspaces/acme/webhook-endpoints'] = { data: null, error: null, loading: false, refresh: mockRefresh };
    pathStates['/admin/workspaces/acme'] = {
      data: WS_DETAIL,
      error: null,
      loading: false,
      refresh: mockRefresh,
    };
    render(<TenantInspectorPanel />);
    await userEvent.click(screen.getByRole('tab', { name: /accounts/i }));

    expect(screen.getByText(/no accounts connected/i)).toBeInTheDocument();
  });

  it('shows "no keys issued" empty state when keys list is empty', async () => {
    selectWorkspace('acme');
    pathStates['/admin/workspaces/acme/api-keys'] = {
      data: [],
      error: null,
      loading: false,
      refresh: mockRefresh,
    };
    pathStates['/admin/workspaces/acme/accounts'] = { data: null, error: null, loading: false, refresh: mockRefresh };
    pathStates['/admin/workspaces/acme/webhook-endpoints'] = { data: null, error: null, loading: false, refresh: mockRefresh };
    pathStates['/admin/workspaces/acme'] = {
      data: WS_DETAIL,
      error: null,
      loading: false,
      refresh: mockRefresh,
    };
    render(<TenantInspectorPanel />);
    await userEvent.click(screen.getByRole('tab', { name: /keys/i }));

    expect(screen.getByText(/no keys issued/i)).toBeInTheDocument();
  });

  it('shows "no webhook endpoints registered" empty state when list is empty', async () => {
    selectWorkspace('acme');
    pathStates['/admin/workspaces/acme/webhook-endpoints'] = {
      data: [],
      error: null,
      loading: false,
      refresh: mockRefresh,
    };
    pathStates['/admin/workspaces/acme/accounts'] = { data: null, error: null, loading: false, refresh: mockRefresh };
    pathStates['/admin/workspaces/acme/api-keys'] = { data: null, error: null, loading: false, refresh: mockRefresh };
    pathStates['/admin/workspaces/acme'] = {
      data: WS_DETAIL,
      error: null,
      loading: false,
      refresh: mockRefresh,
    };
    render(<TenantInspectorPanel />);
    await userEvent.click(screen.getByRole('tab', { name: /webhooks/i }));

    expect(screen.getByText(/no webhook endpoints registered/i)).toBeInTheDocument();
  });
});
