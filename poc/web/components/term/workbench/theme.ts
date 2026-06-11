import type { DockviewTheme } from 'dockview';

/**
 * The Mint Terminal dockview theme. dockview is CSS-variable themed: the
 * `className` is applied to the board root, and the matching `.dockview-theme-term`
 * rule in styles/globals.css overrides the `--dv-*` variables with term tokens
 * (hairline borders, sharp corners, 28px tab strip, mint active sash). Setting
 * `colorScheme` lets dockview adapt its own built-in widgets; the actual colors
 * are all driven by our CSS so a single object works for both light + dark
 * (the term tokens themselves flip via the `.dark` class on <html>).
 */
export const TERM_DOCKVIEW_THEME: DockviewTheme = {
  name: 'term',
  className: 'dockview-theme-term',
  // The term tokens flip with the app theme, so dockview's own colorScheme is
  // mostly cosmetic. 'dark' keeps any default scrollbar/overlay reasonable on
  // the flagship dark surface.
  colorScheme: 'dark',
  gap: 1,
  dndOverlayMounting: 'relative',
  dndPanelOverlay: 'group',
};
