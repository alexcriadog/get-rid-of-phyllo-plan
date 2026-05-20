import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

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
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [slug, setSlug] = useState<string | null>(null);

  // Hydrate from localStorage once on mount. Avoids the SSR/CSR mismatch
  // by deferring the initial value until after first paint.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw && raw.length > 0) setSlug(raw);
    } catch {
      // ignore (private mode etc.)
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
    () => ({ slug, set, withQuery }),
    [slug, set, withQuery],
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
    // see this. Return a safe no-op so the render doesn't throw.
    return {
      slug: null,
      set: () => {},
      withQuery: (url) => url,
    };
  }
  return ctx;
}
