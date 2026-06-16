import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Capture every path `useLive` is asked to fetch. The whole point of the
// hydration gate is that a workspace-scoped panel NEVER fires the bare,
// cross-workspace request — so we assert on the exact paths that reach
// useLive across the render lifecycle.
// ---------------------------------------------------------------------------
const livePaths: (string | null)[] = [];

vi.mock('@/lib/useLive', () => ({
  POLL: { live: 3000, list: 5000, config: 15000, catalog: 30000 },
  useLive: (path: string | null) => {
    livePaths.push(path);
    return { data: null, error: null, loading: true, refresh: () => {} };
  },
}));

import { WorkspaceProvider, useScopedLive } from '@/lib/workspace-context';

const STORAGE_KEY = 'admin.workspaceFilter.v1';

function Consumer() {
  useScopedLive('/admin/next-runs', 5000);
  return null;
}

describe('useScopedLive hydration gate', () => {
  beforeEach(() => {
    livePaths.length = 0;
    window.localStorage.clear();
  });

  it('never fires an unscoped request when a workspace is persisted', async () => {
    window.localStorage.setItem(STORAGE_KEY, 'acme');

    render(
      <WorkspaceProvider>
        <Consumer />
      </WorkspaceProvider>,
    );

    // After hydration the scoped path must appear…
    await waitFor(() =>
      expect(livePaths).toContain('/admin/next-runs?workspace=acme'),
    );
    // …and the bare path (which the backend answers with EVERY workspace's
    // rows) must never have been requested. This is the regression guard for
    // the "other workspaces flash on refresh" bug.
    expect(livePaths).not.toContain('/admin/next-runs');
  });

  it('gates the first (pre-hydration) render to null — no fetch', () => {
    window.localStorage.setItem(STORAGE_KEY, 'acme');

    render(
      <WorkspaceProvider>
        <Consumer />
      </WorkspaceProvider>,
    );

    // The very first render happens before the localStorage read effect runs,
    // so the scoped path is null (useLive no-ops on a null path).
    expect(livePaths[0]).toBeNull();
  });

  it('fetches the unscoped path only for the "All workspaces" view', async () => {
    // No persisted slug → after hydration slug stays null → the unscoped
    // request is correct (that IS "all workspaces"), and only happens then.
    render(
      <WorkspaceProvider>
        <Consumer />
      </WorkspaceProvider>,
    );

    await waitFor(() => expect(livePaths).toContain('/admin/next-runs'));
    // Still gated on the first render.
    expect(livePaths[0]).toBeNull();
  });
});
