import { useSyncExternalStore } from 'react';

/**
 * Cross-panel selection store for the workbench. Directory panels select an
 * object; inspector panels subscribe and render it. Module-level store (not
 * React context) so it works identically across dockview panels, the mobile
 * stacked mode, and the command palette.
 */
export interface TermSelection {
  workspaceSlug: string | null;
  accountId: string | null;
}

let state: TermSelection = { workspaceSlug: null, accountId: null };
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((l) => l());
}

export function selectWorkspace(slug: string | null): void {
  if (state.workspaceSlug === slug) return;
  state = { ...state, workspaceSlug: slug };
  emit();
}

export function selectAccount(id: string | null): void {
  if (state.accountId === id) return;
  state = { ...state, accountId: id };
  emit();
}

export function getSelection(): TermSelection {
  return state;
}

export function subscribeSelection(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTermSelection(): TermSelection {
  return useSyncExternalStore(subscribeSelection, getSelection, getSelection);
}

/** Test-only helper: reset to the empty selection. */
export function resetSelection(): void {
  state = { workspaceSlug: null, accountId: null };
  emit();
}
