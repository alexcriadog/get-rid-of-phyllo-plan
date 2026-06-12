import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import StageRail, { STAGES, type StageId } from '../StageRail';

function reachable(...ids: StageId[]): Set<StageId> {
  return new Set<StageId>(ids);
}

describe('StageRail', () => {
  it('renders all four numbered stages in mono uppercase', () => {
    render(
      <StageRail
        active="platform"
        reachable={reachable('platform')}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText('PLATFORM')).toBeInTheDocument();
    expect(screen.getByText('CREDENTIALS')).toBeInTheDocument();
    expect(screen.getByText('CONNECT')).toBeInTheDocument();
    expect(screen.getByText('FIRST SYNC')).toBeInTheDocument();
  });

  it('exposes exactly four stages with sequential indices', () => {
    expect(STAGES.map((s) => s.index)).toEqual(['01', '02', '03', '04']);
  });

  it('marks the active stage with aria-current="step"', () => {
    render(
      <StageRail
        active="credentials"
        reachable={reachable('platform', 'credentials')}
        onSelect={vi.fn()}
      />,
    );
    const active = screen.getByText('CREDENTIALS').closest('button')!;
    expect(active).toHaveAttribute('aria-current', 'step');
  });

  it('disables stages that are not yet reachable', () => {
    render(
      <StageRail
        active="platform"
        reachable={reachable('platform')}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText('CONNECT').closest('button')).toBeDisabled();
    expect(screen.getByText('FIRST SYNC').closest('button')).toBeDisabled();
  });

  it('calls onSelect when a reachable stage is clicked', () => {
    const onSelect = vi.fn();
    render(
      <StageRail
        active="connect"
        reachable={reachable('platform', 'credentials', 'connect')}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByText('PLATFORM').closest('button')!);
    expect(onSelect).toHaveBeenCalledWith('platform');
  });

  it('does not call onSelect for a disabled (unreachable) stage', () => {
    const onSelect = vi.fn();
    render(
      <StageRail
        active="platform"
        reachable={reachable('platform')}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByText('FIRST SYNC').closest('button')!);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('shows a checkmark on completed stages behind the active one', () => {
    render(
      <StageRail
        active="connect"
        reachable={reachable('platform', 'credentials', 'connect')}
        onSelect={vi.fn()}
      />,
    );
    // Two stages precede 'connect' → two checkmarks render in their index chips.
    expect(screen.getAllByText('✓').length).toBe(2);
  });
});
