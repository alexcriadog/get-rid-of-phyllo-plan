import {
  connectionFlowFor,
  CONNECTION_FLOW_DEFAULT,
  CONNECTION_FLOW_IG_DIRECT,
  CONNECTION_FLOW_IG_VIA_FB,
} from '../connection-flow';

describe('connectionFlowFor', () => {
  it('classifies an Instagram seed with oauth_flow=ig_direct as ig_direct', () => {
    expect(connectionFlowFor('instagram', { oauth_flow: 'ig_direct' })).toBe(
      CONNECTION_FLOW_IG_DIRECT,
    );
  });

  it('classifies an Instagram seed without the ig_direct flag as fb_login', () => {
    expect(connectionFlowFor('instagram', { page_id: '123' })).toBe(
      CONNECTION_FLOW_IG_VIA_FB,
    );
    expect(connectionFlowFor('instagram', null)).toBe(CONNECTION_FLOW_IG_VIA_FB);
    expect(connectionFlowFor('instagram', undefined)).toBe(
      CONNECTION_FLOW_IG_VIA_FB,
    );
  });

  it('keeps every other platform on the single default flow', () => {
    expect(connectionFlowFor('facebook', { page_id: '1' })).toBe(
      CONNECTION_FLOW_DEFAULT,
    );
    expect(connectionFlowFor('tiktok', null)).toBe(CONNECTION_FLOW_DEFAULT);
    // The ig_direct flag only discriminates within Instagram.
    expect(connectionFlowFor('threads', { oauth_flow: 'ig_direct' })).toBe(
      CONNECTION_FLOW_DEFAULT,
    );
  });
});
