import { engagementChanged } from '../canonical-write.service';

const eng = (o: Partial<Record<string, number | null>>) => ({
  like_count: null, comment_count: null, view_count: null,
  share_count: null, save_count: null, dislike_count: null, ...o,
});

describe('engagementChanged', () => {
  it('true when a metric differs', () => {
    expect(engagementChanged({ engagement: eng({ like_count: 10 }) }, { engagement: eng({ like_count: 11 }) })).toBe(true);
  });
  it('false when all metrics equal', () => {
    expect(engagementChanged({ engagement: eng({ like_count: 10 }) }, { engagement: eng({ like_count: 10 }) })).toBe(false);
  });
  it('ignores non-engagement fields', () => {
    expect(engagementChanged({ engagement: eng({ like_count: 1 }), title: 'a' }, { engagement: eng({ like_count: 1 }), title: 'b' })).toBe(false);
  });
  it('true when prev has no engagement but fresh does', () => {
    expect(engagementChanged({}, { engagement: eng({ like_count: 5 }) })).toBe(true);
  });
  it('false when neither has engagement', () => {
    expect(engagementChanged({}, {})).toBe(false);
  });
});
