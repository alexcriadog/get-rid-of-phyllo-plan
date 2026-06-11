import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import CmdPalette from '../CmdPalette';
import { ThemeProvider } from '@/lib/theme';
import { DECKS } from '@/lib/term/decks';
import { panelTitle } from '@/components/term/panels/registry';

// CmdPalette navigates via next/router; stub it so the component mounts.
vi.mock('next/router', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), pathname: '/admin/terminal', query: {} }),
}));

function renderPalette(open = true) {
  const actions = { switchDeck: vi.fn(), openPanel: vi.fn() };
  render(
    <ThemeProvider>
      <CmdPalette open={open} onOpenChange={() => {}} actions={actions} />
    </ThemeProvider>,
  );
  return actions;
}

describe('CmdPalette', () => {
  it('renders the group headings and a command per deck when open', () => {
    renderPalette(true);
    expect(screen.getByText('DECKS')).toBeInTheDocument();
    expect(screen.getByText('PANELS')).toBeInTheDocument();
    expect(screen.getByText('ACTIONS')).toBeInTheDocument();
    // One deck command per deck.
    expect(screen.getByText(`deck: ${DECKS['morning-check'].label}`)).toBeInTheDocument();
    expect(screen.getByText(`deck: ${DECKS.incident.label}`)).toBeInTheDocument();
  });

  it('lists an open-panel command for the vitals panel', () => {
    renderPalette(true);
    expect(screen.getByText(`open: ${panelTitle('vitals')}`)).toBeInTheDocument();
  });

  it('exposes the theme toggle action', () => {
    renderPalette(true);
    expect(screen.getByText('toggle theme')).toBeInTheDocument();
  });

  it('renders nothing visible when closed', () => {
    renderPalette(false);
    expect(screen.queryByText('DECKS')).not.toBeInTheDocument();
  });
});
