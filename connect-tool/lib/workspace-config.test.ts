import { describe, it, expect } from 'vitest';
import {
  offeredPlatforms,
  displayProducts,
  platformReachableAtOAuthStart,
  intersectConnectionProducts,
  clampProductsToScope,
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

describe('intersectConnectionProducts', () => {
  const WS = {
    facebook: ['identity', 'audience', 'engagement_new', 'ads'],
    instagram: ['identity', 'audience'],
  };

  it('returns the workspace config unchanged when no scope is given', () => {
    expect(intersectConnectionProducts(WS, undefined)).toBe(WS);
    expect(intersectConnectionProducts(WS, {})).toBe(WS);
  });

  it('narrows only the platforms the scope lists, keeping the rest', () => {
    const eff = intersectConnectionProducts(WS, { facebook: ['audience'] });
    expect(eff).toEqual({
      facebook: ['identity', 'audience'],
      instagram: ['identity', 'audience'], // untouched
    });
  });

  it('drops scope products the workspace has since removed (defensive)', () => {
    const eff = intersectConnectionProducts(
      { facebook: ['identity', 'audience'] }, // ads tightened away after mint
      { facebook: ['audience', 'ads'] },
    );
    expect(eff).toEqual({ facebook: ['identity', 'audience'] });
  });

  it('uses the scope directly when workspace config is null (legacy)', () => {
    const eff = intersectConnectionProducts(null, { tiktok: ['audience'] });
    expect(eff).toEqual({ tiktok: ['identity', 'audience'] });
  });

  it('an empty scope list yields identity-only for that platform', () => {
    const eff = intersectConnectionProducts(WS, { facebook: [] });
    expect(eff && eff.facebook).toEqual(['identity']);
  });
});

describe('clampProductsToScope', () => {
  it('returns products unchanged when scope is undefined', () => {
    expect(clampProductsToScope(['identity', 'ads'], undefined)).toEqual([
      'identity',
      'ads',
    ]);
  });

  it('intersects products with the scope', () => {
    expect(
      clampProductsToScope(['identity', 'audience', 'ads'], [
        'identity',
        'audience',
      ]),
    ).toEqual(['identity', 'audience']);
  });

  it('guarantees identity even if the input omitted it', () => {
    expect(clampProductsToScope(['audience'], ['identity', 'audience'])).toEqual(
      ['identity', 'audience'],
    );
  });
});
