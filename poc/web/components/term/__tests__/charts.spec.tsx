import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Gauge, MiniBar, Sparkline } from '../charts';

describe('MiniBar', () => {
  it('exposes meter semantics and clamps overflow to 100%', () => {
    render(<MiniBar value={150} max={100} />);
    const meter = screen.getByRole('meter');
    expect(meter).toHaveAttribute('aria-valuenow', '150');
    expect((meter.firstChild as HTMLElement).style.width).toBe('100%');
  });
  it('renders 0% for max=0', () => {
    render(<MiniBar value={5} max={0} />);
    expect((screen.getByRole('meter').firstChild as HTMLElement).style.width).toBe('0%');
  });
  it('exposes an accessible name when label is provided', () => {
    render(<MiniBar value={5} max={10} label="queue depth" />);
    expect(screen.getByRole('meter', { name: 'queue depth' })).toBeInTheDocument();
  });
});

describe('Sparkline', () => {
  it('renders an svg path for 2+ points', () => {
    const { container } = render(<Sparkline points={[1, 5, 3]} />);
    expect(container.querySelector('svg path')).not.toBeNull();
  });
  it('renders nothing for fewer than 2 points', () => {
    const { container } = render(<Sparkline points={[1]} />);
    expect(container.querySelector('svg')).toBeNull();
  });
  it('renders nothing for an empty series', () => {
    const { container } = render(<Sparkline points={[]} />);
    expect(container.querySelector('svg')).toBeNull();
  });
});

describe('Gauge', () => {
  it('shows label and rounded percentage', () => {
    render(<Gauge value={0.42} label="content queue" />);
    expect(screen.getByText('content queue')).toBeInTheDocument();
    expect(screen.getByText('42%')).toBeInTheDocument();
  });
  it('escalates tone at thresholds', () => {
    const { container } = render(<Gauge value={0.95} label="hot" />);
    expect(container.querySelector('.bg-term-danger')).not.toBeNull();
  });
});
