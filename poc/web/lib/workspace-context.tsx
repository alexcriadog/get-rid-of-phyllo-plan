import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useLive, type LiveState } from './useLive';

// localStorage key. Versioned so we can reset semantics later without
// stranding users on a stale value.
const STORAGE_KEY = 'admin.workspaceFilter.v1';

interface WorkspaceContextValue {
  /**
   * Currently selected workspace slug, or `null` for "All workspaces".
   * Component-tree consumers should treat null as "no filter".
   */
  slug: string | null;
  /** Update the selection. Pass null to switch back to "All workspaces". */
  set: (next: string | null) => void;
  /**
   * Compose a URL with `?workspace=<slug>` appended when a workspace is
   * selected. Returns the path unchanged when no slug is set. Use this
   * in every admin fetch so list endpoints honour the topbar selection.
   */
  withQuery: (url: string) => string;
  /**
   * False until the provider has read the persisted selection from
   * localStorage (one tick after mount). Workspace-scoped fetches MUST wait
   * for this — otherwise the first render fires with `slug=null` (the
   * pre-hydration default), the request goes out WITHOUT `?workspace=`, and
   * the backend returns every workspace's rows. The selection then hydrates
   * and the data swaps, but the cross-tenant flash is already on screen.
   * Use `useScopedLive` (below), which gates on this flag for you.
   */
  hydrated: boolean;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [slug, setSlug] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from localStorage once on mount. Avoids the SSR/CSR mismatch
  // by deferring the initial value until after first paint. `hydrated` flips
  // true once this has run (whether or not a value was found) so scoped
  // fetches can wait for the real selection instead of firing unfiltered.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw && raw.length > 0) setSlug(raw);
    } catch {
      // ignore (private mode etc.)
    } finally {
      setHydrated(true);
    }
  }, []);

  const set = useCallback((next: string | null) => {
    setSlug(next);
    try {
      if (next == null) window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
  }, []);

  const withQuery = useCallback(
    (url: string) => {
      if (slug == null) return url;
      const sep = url.includes('?') ? '&' : '?';
      return `${url}${sep}workspace=${encodeURIComponent(slug)}`;
    },
    [slug],
  );

  const value = useMemo<WorkspaceContextValue>(
    () => ({ slug, set, withQuery, hydrated }),
    [slug, set, withQuery, hydrated],
  );

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspaceFilter(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    // Outside a provider — pages pre-rendered before mount may briefly
    // see this. Return a safe no-op so the render doesn't throw. `hydrated`
    // is true here: with no provider there's no persisted selection to wait
    // for, so scoped fetches should run immediately (unscoped, as before).
    return {
      slug: null,
      set: () => {},
      withQuery: (url) => url,
      hydrated: true,
    };
  }
  return ctx;
}

/**
 * Workspace-scoped `useLive`. Appends the topbar selection (`?workspace=`)
 * AND defers the fetch until the provider has hydrated the persisted
 * selection — so a browser refresh never fires an unfiltered request that
 * briefly shows other workspaces' rows. Pass `null` to disable the fetch
 * entirely (same semantics as `useLive`). Use this instead of
 * `useLive(withQuery(path), ...)` for any list scoped to the selected
 * workspace.
 */
export function useScopedLive<T = unknown>(
  path: string | null,
  intervalMs: number,
): LiveState<T> {
  const { withQuery, hydrated } = useWorkspaceFilter();
  const scopedPath = hydrated && path != null ? withQuery(path) : null;
  return useLive<T>(scopedPath, intervalMs);
}
