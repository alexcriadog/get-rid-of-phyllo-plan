import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ActionChip from '../ActionChip';

describe('ActionChip', () => {
  it('renders a button and fires onClick', async () => {
    const onClick = vi.fn();
    render(<ActionChip onClick={onClick}>retry dlq</ActionChip>);
    await userEvent.click(screen.getByRole('button', { name: 'retry dlq' }));
    expect(onClick).toHaveBeenCalledOnce();
  });
  it('applies the variant classes', () => {
    render(<ActionChip variant="destructive">purge</ActionChip>);
    expect(screen.getByRole('button', { name: 'purge' }).className).toContain('border-term-danger');
  });
  it('disables correctly', () => {
    render(<ActionChip disabled>noop</ActionChip>);
    expect(screen.getByRole('button', { name: 'noop' })).toBeDisabled();
  });
});
