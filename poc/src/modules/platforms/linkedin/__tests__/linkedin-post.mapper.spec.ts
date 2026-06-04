import { linkedInPostToContent } from '../mapper/linkedin-post.mapper';

describe('linkedInPostToContent', () => {
  test('maps a share post with stats', () => {
    const content = linkedInPostToContent(
      {
        id: 'urn:li:share:7325786486870552578',
        author: 'urn:li:organization:2414183',
        commentary: 'Hello LinkedIn',
        publishedAt: 1714000000000,
        lifecycleState: 'PUBLISHED',
        visibility: 'PUBLIC',
      },
      {
        impressionCount: 1000,
        uniqueImpressionsCount: 800,
        clickCount: 50,
        likeCount: 20,
        commentCount: 5,
        shareCount: 3,
        engagement: 0.078,
      },
    );
    expect(content.platformContentId).toBe('urn:li:share:7325786486870552578');
    expect(content.permalink).toBe(
      'https://www.linkedin.com/feed/update/urn:li:share:7325786486870552578',
    );
    expect(content.caption).toBe('Hello LinkedIn');
    expect(content.publishedAt).toEqual(new Date(1714000000000));
    expect(content.metrics.views).toBe(1000);
    expect(content.metrics.reach).toBe(800);
    expect(content.metrics.likes).toBe(20);
    expect(content.metrics.comments).toBe(5);
    expect(content.metrics.shares).toBe(3);
    expect(content.metrics.extra?.['clicks']).toBe(50);
    expect(content.privacyStatus).toBe('PUBLIC');
    expect(content.rawResponse.collection).toBe('raw_platform_responses');
  });

  test('maps a post without stats', () => {
    const content = linkedInPostToContent(
      { id: 'urn:li:ugcPost:99', createdAt: 1714000000000 },
      null,
    );
    expect(content.metrics).toEqual({});
    expect(content.publishedAt).toEqual(new Date(1714000000000));
    expect(content.contentType).toBe('other');
  });
});
