import { buildInstagramContext } from '../instagram.context';
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
