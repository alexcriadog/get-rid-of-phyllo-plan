import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TermInput from '../TermInput';

describe('TermInput', () => {
  it('renders the prompt glyph and accepts typing', async () => {
    render(<TermInput placeholder="filter: platform=tiktok" />);
    expect(screen.getByText('>')).toBeInTheDocument();
    const input = screen.getByPlaceholderText('filter: platform=tiktok');
    await userEvent.type(input, 'queues');
    expect(input).toHaveValue('queues');
  });
});
