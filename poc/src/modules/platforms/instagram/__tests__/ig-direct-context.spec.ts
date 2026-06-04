import { buildInstagramContext } from '../instagram.context';
import { profileFieldsFor } from '../fetcher/instagram-profile.fetcher';
import {
  IG_DIRECT_GRAPH_BASE,
  isIgDirect,
} from '../../shared/meta-graph/ig-direct';

describe('isIgDirect', () => {
  it('is true only for metadata.oauth_flow === "ig_direct"', () => {
    expect(isIgDirect({ oauth_flow: 'ig_direct' })).toBe(true);
    expect(isIgDirect({ oauth_flow: 'fb_login' })).toBe(false);
    expect(isIgDirect({})).toBe(false);
    expect(isIgDirect(undefined)).toBe(false);
    expect(isIgDirect(null)).toBe(false);
  });
});

describe('buildInstagramContext graph host routing', () => {
  it('FB-login accounts keep the default host (no graphBaseUrl)', () => {
    const ctx = buildInstagramContext('tok', '17841400000000000', {
      page_id: '123',
    });
    expect(ctx.graphBaseUrl).toBeUndefined();
    expect(ctx.pageId).toBe('123');
  });

  it('IG-direct accounts route to graph.instagram.com', () => {
    const ctx = buildInstagramContext('tok', '17841400000000000', {
      oauth_flow: 'ig_direct',
    });
    expect(ctx.graphBaseUrl).toBe(IG_DIRECT_GRAPH_BASE);
    expect(ctx.pageId).toBeUndefined();
    expect(ctx.igAccountId).toBe('17841400000000000');
  });
});

describe('profileFieldsFor', () => {
  // Regression: IG-Login rejects FB-graph-only fields with IGApiException
  // code 100 ("Tried accessing nonexisting field (is_published)") and one
  // bad field kills the whole identity call → circuit breaker → account
  // auto-pause. Seen in prod 2026-06-04 on account camaleonicanalytics.
  it('drops FB-graph-only fields for IG-direct accounts', () => {
    const fields = profileFieldsFor({ oauth_flow: 'ig_direct' });
    expect(fields).not.toContain('is_published');
    expect(fields).not.toContain('has_profile_pic');
    expect(fields).not.toContain('legacy_instagram_user_id');
    expect(fields).toContain('username');
    expect(fields).toContain('followers_count');
  });

  it('keeps the probe-confirmed extras for FB-login accounts', () => {
    const fields = profileFieldsFor({ page_id: '123' });
    expect(fields).toContain('is_published');
    expect(fields).toContain('has_profile_pic');
    expect(fields).toContain('legacy_instagram_user_id');
  });
});
