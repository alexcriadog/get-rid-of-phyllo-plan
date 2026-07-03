import { ALLOWED_EVENTS } from '../outbound-webhooks.service';

describe('ALLOWED_EVENTS token lifecycle', () => {
  it('includes the new re-auth lifecycle events', () => {
    expect(ALLOWED_EVENTS).toContain('token.reauth_required');
    expect(ALLOWED_EVENTS).toContain('token.recovered');
  });
});
