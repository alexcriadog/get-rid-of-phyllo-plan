import { describe, it, expect } from 'vitest';
import { offeredPlatforms, displayProducts } from './workspace-config';

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
});
