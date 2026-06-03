import { BadRequestException } from '@nestjs/common';
import { buildConnectionProductScope } from '../connection-products';

// Workspace ceiling used across cases.
const WS = {
  facebook: ['identity', 'audience', 'engagement_new', 'ads'],
  instagram: ['identity', 'audience'],
  tiktok: ['identity', 'audience'],
};

describe('buildConnectionProductScope', () => {
  it('returns the requested subset with identity injected first', () => {
    const out = buildConnectionProductScope({ facebook: ['audience'] }, WS);
    expect(out).toEqual({ facebook: ['identity', 'audience'] });
  });

  it('treats an empty product list as identity-only (the "basic" case)', () => {
    const out = buildConnectionProductScope({ facebook: [] }, WS);
    expect(out).toEqual({ facebook: ['identity'] });
  });

  it('drops a duplicate identity in the request and de-dupes products', () => {
    const out = buildConnectionProductScope(
      { facebook: ['identity', 'audience', 'audience'] },
      WS,
    );
    expect(out).toEqual({ facebook: ['identity', 'audience'] });
  });

  it('keeps multiple platforms independently', () => {
    const out = buildConnectionProductScope(
      { facebook: ['audience'], tiktok: [] },
      WS,
    );
    expect(out).toEqual({
      facebook: ['identity', 'audience'],
      tiktok: ['identity'],
    });
  });

  it('throws when a requested product exceeds the workspace ceiling', () => {
    expect(() =>
      buildConnectionProductScope({ facebook: ['ads', 'audience'] }, {
        facebook: ['identity', 'audience'], // no ads in ceiling
      }),
    ).toThrow(BadRequestException);
  });

  it('throws when a platform is not offered by the workspace', () => {
    expect(() =>
      buildConnectionProductScope({ youtube: ['audience'] }, WS),
    ).toThrow(BadRequestException);
  });
});
