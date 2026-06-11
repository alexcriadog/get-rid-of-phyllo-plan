import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import PlatformTag from '../PlatformTag';

describe('PlatformTag', () => {
  it('renders the bracketed abbr', () => {
    render(<PlatformTag platform="tiktok" />);
    expect(screen.getByText('[TT]')).toBeInTheDocument();
  });
  it('appends the label when showLabel is set', () => {
    render(<PlatformTag platform="instagram" showLabel />);
    expect(screen.getByText('[IG] instagram')).toBeInTheDocument();
  });
  it('renders fallback for unknown platforms', () => {
    render(<PlatformTag platform="myspace" />);
    expect(screen.getByText('[MY]')).toBeInTheDocument();
  });
});
