import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DiscoveryStage from '../DiscoveryStage';
import type { DiscoverResponse } from '../types';

// Mock @/lib/api so no real network coupling can leak through the seed path.
vi.mock('@/lib/api', () => ({
  adminPost: vi.fn(),
}));

function metaDiscovery(): DiscoverResponse {
  return {
    me: { id: 'user-1', name: 'Operator' },
    token_type: 'user',
    pages: [
      {
        page_id: '1050',
        page_name: 'Brand Page',
        page_token_ref: 'ref-abc',
        page_already_connected: false,
        instagram: {
          ig_business_id: '17841',
          username: 'brand',
          name: null,
          followers_count: 1000,
          profile_picture_url: null,
          already_connected: false,
        },
      },
    ],
    warnings: [],
  };
}

function baseProps() {
  return {
    token: '  EAA-token  ',
    refreshToken: '',
    expiresInS: '',
    busy: null,
    results: {},
    onConnect: vi.fn(),
    onBack: vi.fn(),
  };
}

describe('DiscoveryStage', () => {
  it('renders the authenticated-as identity and token type', () => {
    render(<DiscoveryStage discovery={metaDiscovery()} {...baseProps()} />);
    expect(screen.getByText(/Operator/)).toBeInTheDocument();
    expect(screen.getByText(/user token/)).toBeInTheDocument();
  });

  it('renders the Pages found section with the page name', () => {
    render(<DiscoveryStage discovery={metaDiscovery()} {...baseProps()} />);
    expect(screen.getByText(/pages found \(1\)/i)).toBeInTheDocument();
    expect(screen.getByText('Brand Page')).toBeInTheDocument();
  });

  it('builds the Facebook seed body with the page_token_ref (no raw token)', () => {
    const props = baseProps();
    render(<DiscoveryStage discovery={metaDiscovery()} {...props} />);

    fireEvent.click(screen.getByRole('button', { name: /connect facebook/i }));

    expect(props.onConnect).toHaveBeenCalledWith('facebook:1050', {
      platform: 'facebook',
      page_token_ref: 'ref-abc',
      canonical_user_id: '1050',
      handle: 'Brand Page',
      metadata: { page_id: '1050' },
    });
  });

  it('builds the Instagram seed body from the linked IG account', () => {
    const props = baseProps();
    render(<DiscoveryStage discovery={metaDiscovery()} {...props} />);

    fireEvent.click(screen.getByRole('button', { name: /connect instagram/i }));

    expect(props.onConnect).toHaveBeenCalledWith('instagram:17841', {
      platform: 'instagram',
      page_token_ref: 'ref-abc',
      canonical_user_id: '17841',
      handle: 'brand',
      metadata: { page_id: '1050' },
    });
  });

  it('builds the TikTok seed with trimmed token + computed expires_at', () => {
    const discovery: DiscoverResponse = {
      me: { id: 'tt-me', name: 'BC' },
      token_type: 'tiktok-business',
      pages: [],
      tiktok_account: {
        open_id: 'open-xyz',
        username: 'brandtt',
        display_name: 'Brand TT',
        profile_image: null,
        followers_count: 5,
        following_count: 1,
        videos_count: 2,
        total_likes: 9,
        is_verified: true,
        already_connected: false,
      },
      warnings: [],
    };
    const props = { ...baseProps(), refreshToken: ' rft-1 ', expiresInS: '3600' };
    render(<DiscoveryStage discovery={discovery} {...props} />);

    fireEvent.click(screen.getByRole('button', { name: /connect/i }));

    expect(props.onConnect).toHaveBeenCalledTimes(1);
    const [key, body] = (props.onConnect as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(key).toBe('tiktok:open-xyz');
    expect(body.platform).toBe('tiktok');
    expect(body.access_token).toBe('EAA-token'); // trimmed
    expect(body.refresh_token).toBe('rft-1'); // trimmed
    expect(body.canonical_user_id).toBe('open-xyz');
    expect(body.metadata).toEqual({ business_id: 'open-xyz', open_id: 'open-xyz' });
    // expires_at is an ISO 8601 string when expires_in is a positive number.
    expect(typeof body.expires_at).toBe('string');
    expect(() => new Date(body.expires_at).toISOString()).not.toThrow();
  });

  it('omits the Pages section for a threads-user token', () => {
    const discovery: DiscoverResponse = {
      me: { id: 'th-me', name: 'TH' },
      token_type: 'threads-user',
      pages: [],
      threads_account: {
        user_id: 'th-1',
        username: 'brandth',
        name: 'Brand TH',
        profile_picture_url: null,
        biography: null,
        is_verified: false,
        already_connected: false,
      },
      warnings: [],
    };
    render(<DiscoveryStage discovery={discovery} {...baseProps()} />);
    expect(screen.queryByText(/pages found/i)).not.toBeInTheDocument();
    expect(screen.getByText(/threads account/i)).toBeInTheDocument();
  });
});
