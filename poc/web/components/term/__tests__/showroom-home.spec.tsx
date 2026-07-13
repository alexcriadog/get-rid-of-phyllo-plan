/**
 * Light render tests for the showroom landing (pages/index.tsx Home).
 * Home is a pure render given static props, so we render it directly.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ShowroomCard } from '../../../lib/showroom';

vi.mock('next/router', () => ({
  useRouter: () => ({ push: vi.fn(), query: {} }),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode; [k: string]: unknown }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('../../../components/RelativeTime', () => ({
  RelativeTime: ({ value }: { value: string }) => <span>{value}</span>,
}));
vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ cards: [] }) }));

import Home from '../../../pages/index';

const CARD: ShowroomCard = {
  id: 'acc-001',
  platform: 'instagram',
  handle: 'testaccount',
  name: 'Test Account',
  biography: null,
  avatarUrl: null,
  verified: false,
  followers: 12000,
  following: 400,
  posts: 88,
  topCountry: { country: 'ES', pct: 45 },
  topCity: { city: 'Madrid', value: 5000 },
  updatedAt: '2026-07-13T00:00:00Z',
};

const BASE = { workspaces: [], selected: '', nextCursor: null };

describe('Home (showroom landing)', () => {
  it('renders the masthead and nav links', () => {
    render(<Home {...BASE} cards={[]} />);
    expect(screen.getByText('The Feed')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Data Guide/i })).toHaveAttribute('href', '/data-guide');
    expect(screen.getByRole('link', { name: /Watchlist/i })).toHaveAttribute('href', '/watchlist');
    expect(screen.getByRole('link', { name: /Admin console/i })).toHaveAttribute('href', '/admin');
  });

  it('renders a search box and workspace selector', () => {
    render(<Home {...BASE} cards={[]} />);
    expect(screen.getByLabelText(/Search accounts/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Workspace/i)).toBeInTheDocument();
  });

  it('renders an account tile linking to the account detail', () => {
    render(<Home {...BASE} cards={[CARD]} />);
    expect(screen.getByText('Test Account')).toBeInTheDocument();
    expect(screen.getByText('@testaccount')).toBeInTheDocument();
    expect(screen.getByText(/Madrid/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Test Account/i })).toHaveAttribute('href', '/account/acc-001');
  });

  it('renders the empty state when there are no accounts', () => {
    render(<Home {...BASE} cards={[]} />);
    expect(screen.getByText(/No accounts connected/i)).toBeInTheDocument();
  });
});
