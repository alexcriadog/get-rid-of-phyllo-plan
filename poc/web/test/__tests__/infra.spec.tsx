import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

describe('test infra', () => {
  it('renders React into jsdom', () => {
    render(<button>ping</button>);
    expect(screen.getByRole('button', { name: 'ping' })).toBeInTheDocument();
  });
});
