import { describe, it, expect } from 'vitest';
import {
  offeredPlatforms,
  displayProducts,
  platformReachableAtOAuthStart,
} from './workspace-config';

describe('workspace-config resolvers', () => {
  it('offeredPlatforms returns null (=all) when config is null', () => {
    expect(offeredPlatforms(null)).toBeNull();
  });
  it('offeredPlatforms returns the configured platform keys', () => {
    expect(offeredPlatforms({ instagram: ['audience'], tiktok: [] })).toEqual(['instagram', 'tiktok']);
  });
  it('displayProducts returns null (=full catalog) when config is null', () => {
    expect(displayProducts(null, 'instagram')).toBeNull();
  });
  it('displayProducts includes identity + the configured keys for the platform', () => {
    expect(displayProducts({ instagram: ['audience'] }, 'instagram')).toEqual(['identity', 'audience']);
  });
  it('displayProducts returns [] when platform is not offered', () => {
    expect(displayProducts({ facebook: ['ads'] }, 'instagram')).toEqual([]);
  });

  it('platformReachableAtOAuthStart returns true for unconfigured workspaces', () => {
    expect(platformReachableAtOAuthStart(null, 'tiktok')).toBe(true);
  });
  it('platformReachableAtOAuthStart accepts the platform when its key is configured', () => {
    expect(platformReachableAtOAuthStart({ tiktok: [] }, 'tiktok')).toBe(true);
  });
  it('platformReachableAtOAuthStart rejects platforms not in the configured set', () => {
    expect(platformReachableAtOAuthStart({ facebook: ['ads'] }, 'tiktok')).toBe(false);
  });
  it('platformReachableAtOAuthStart accepts facebook OAuth when only instagram is offered (IG uses FB OAuth)', () => {
    expect(platformReachableAtOAuthStart({ instagram: [] }, 'facebook')).toBe(true);
  });
  it('platformReachableAtOAuthStart rejects facebook OAuth when neither facebook nor instagram is offered', () => {
    expect(platformReachableAtOAuthStart({ youtube: [] }, 'facebook')).toBe(false);
  });
});
