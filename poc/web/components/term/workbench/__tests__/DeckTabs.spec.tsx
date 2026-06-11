import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DeckTabs from '../DeckTabs';
import { DECKS, DECK_IDS } from '@/lib/term/decks';

describe('DeckTabs', () => {
  it('renders a tab for every deck plus the disabled + DECK stub', () => {
    render(<DeckTabs active="morning-check" onSelect={() => {}} />);
    for (const id of DECK_IDS) {
      expect(screen.getByRole('tab', { name: DECKS[id].label })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: '+ DECK' })).toBeDisabled();
  });

  it('marks the active deck with aria-selected', () => {
    render(<DeckTabs active="incident" onSelect={() => {}} />);
    expect(screen.getByRole('tab', { name: DECKS.incident.label })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', { name: DECKS.pipeline.label })).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });

  it('calls onSelect with the deck id when a tab is clicked', async () => {
    const onSelect = vi.fn();
    render(<DeckTabs active="morning-check" onSelect={onSelect} />);
    await userEvent.click(screen.getByRole('tab', { name: DECKS.pipeline.label }));
    expect(onSelect).toHaveBeenCalledWith('pipeline');
  });
});
