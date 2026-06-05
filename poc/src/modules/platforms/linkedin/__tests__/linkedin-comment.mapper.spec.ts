import { linkedInCommentToComment } from '../mapper/linkedin-comment.mapper';

describe('linkedInCommentToComment', () => {
  test('maps a top-level comment', () => {
    const c = linkedInCommentToComment(
      {
        $URN: 'urn:li:comment:(urn:li:ugcPost:123,456)',
        actor: 'urn:li:person:abc',
        message: { text: 'Great post!' },
        created: { time: 1714000000000 },
        likesSummary: { totalLikes: 3 },
      },
      'urn:li:ugcPost:123',
    );
    expect(c.platformCommentId).toBe('urn:li:comment:(urn:li:ugcPost:123,456)');
    expect(c.platformContentId).toBe('urn:li:ugcPost:123');
    expect(c.parentCommentId).toBeNull();
    expect(c.authorHandle).toBe('urn:li:person:abc');
    expect(c.text).toBe('Great post!');
    expect(c.publishedAt).toEqual(new Date(1714000000000));
    expect(c.metrics.likes).toBe(3);
    expect(c.rawResponse.collection).toBe('raw_platform_responses');
  });

  test('maps a reply with parent and falls back to numeric id', () => {
    const c = linkedInCommentToComment(
      {
        id: 789,
        actor: 'urn:li:organization:55',
        message: { text: 'Thanks!' },
        parentComment: 'urn:li:comment:(urn:li:ugcPost:123,456)',
      },
      'urn:li:ugcPost:123',
    );
    expect(c.platformCommentId).toBe('789');
    expect(c.parentCommentId).toBe('urn:li:comment:(urn:li:ugcPost:123,456)');
    expect(c.isOwnerReply).toBeUndefined();
    expect(c.publishedAt).toBeNull();
  });
});
