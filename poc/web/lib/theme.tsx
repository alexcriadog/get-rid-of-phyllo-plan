import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/**
 * Operator theme: 'light' | 'dark'. Persisted in localStorage; the initial
 * value is resolved before first paint by the inline script in _document.tsx
 * (so there is no flash). This provider re-syncs React state with whatever
 * the script already applied and exposes a toggle.
 */
export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'admin.theme.v1';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (next: Theme) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  // Enable transitions only after the first applied theme so the initial
  // paint doesn't animate. Done on a frame to dodge the first paint.
  window.requestAnimationFrame(() => root.classList.add('theme-ready'));
}

function readInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  // Trust the class the no-flash script already set on <html>.
  if (document.documentElement.classList.contains('dark')) return 'dark';
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // ignore
  }
  return 'light';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('dark');

  // Sync state with the pre-paint script result once mounted.
  useEffect(() => {
    setThemeState(readInitialTheme());
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    applyTheme(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // ignore (private mode etc.)
    }
  }, []);

  const toggle = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setTheme]);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, setTheme, toggle }),
    [theme, setTheme, toggle],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    return { theme: 'dark', setTheme: () => {}, toggle: () => {} };
  }
  return ctx;
}

/**
 * Inline script string injected into <head> before paint. Resolves the
 * stored theme (or the OS preference as the first-run default) and sets the
 * `dark` class on <html> so the correct palette is present on first paint.
 * Kept dependency-free and tiny.
 */
export const THEME_NO_FLASH_SCRIPT = `(function(){try{var k='${THEME_STORAGE_KEY}';var s=localStorage.getItem(k);var t=s==='light'||s==='dark'?s:(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');if(t==='dark')document.documentElement.classList.add('dark');}catch(e){}})();`;
