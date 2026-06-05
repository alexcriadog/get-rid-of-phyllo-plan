import {
  decodeLittleText,
  linkedInPostToContent,
} from '../mapper/linkedin-post.mapper';

describe('decodeLittleText', () => {
  test('decodes hashtags, mentions and escapes', () => {
    const { text, hashtags } = decodeLittleText(
      'Great match with @[ATP Tour](urn:li:organization:559836) \\(wow\\)\n' +
        '{hashtag|\\#|ATPTour} {hashtag|\\#|Tennis}',
    );
    expect(text).toBe('Great match with @ATP Tour (wow)\n#ATPTour #Tennis');
    expect(hashtags).toEqual(['ATPTour', 'Tennis']);
  });

  test('passes plain text through untouched', () => {
    const { text, hashtags } = decodeLittleText('Just a plain caption');
    expect(text).toBe('Just a plain caption');
    expect(hashtags).toEqual([]);
  });
});

describe('linkedInPostToContent', () => {
  test('maps a share post with stats and decoded caption', () => {
    const content = linkedInPostToContent(
      {
        id: 'urn:li:share:7325786486870552578',
        author: 'urn:li:organization:2414183',
        commentary: 'Hello {hashtag|\\#|LinkedIn}',
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
    expect(content.caption).toBe('Hello #LinkedIn');
    expect(content.tags).toEqual(['LinkedIn']);
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

  test('resolves image media via the mediaByUrn map', () => {
    const content = linkedInPostToContent(
      {
        id: 'urn:li:ugcPost:1',
        commentary: 'pic',
        content: { media: { id: 'urn:li:image:abc' } },
        createdAt: 1714000000000,
      },
      null,
      undefined,
      new Map([
        ['urn:li:image:abc', { url: 'https://media.licdn.com/img.jpg' }],
      ]),
    );
    expect(content.contentType).toBe('image');
    expect(content.mediaUrls).toEqual(['https://media.licdn.com/img.jpg']);
    expect(content.thumbnailUrl).toBe('https://media.licdn.com/img.jpg');
  });

  test('detects video by URN prefix and uses thumbnail', () => {
    const content = linkedInPostToContent(
      {
        id: 'urn:li:ugcPost:2',
        content: { media: { id: 'urn:li:video:xyz' } },
        createdAt: 1714000000000,
      },
      null,
      undefined,
      new Map([
        [
          'urn:li:video:xyz',
          { url: 'https://dms.licdn.com/v.mp4', thumbnail: 'https://t.jpg' },
        ],
      ]),
    );
    expect(content.contentType).toBe('video');
    expect(content.mediaUrls).toEqual(['https://dms.licdn.com/v.mp4']);
    expect(content.thumbnailUrl).toBe('https://t.jpg');
  });

  test('maps multiImage to carousel with children', () => {
    const content = linkedInPostToContent(
      {
        id: 'urn:li:ugcPost:3',
        content: {
          multiImage: {
            images: [{ id: 'urn:li:image:a' }, { id: 'urn:li:image:b' }],
          },
        },
        createdAt: 1714000000000,
      },
      null,
      undefined,
      new Map([
        ['urn:li:image:a', { url: 'https://a.jpg' }],
        ['urn:li:image:b', { url: 'https://b.jpg' }],
      ]),
    );
    expect(content.contentType).toBe('carousel');
    expect(content.mediaUrls).toEqual(['https://a.jpg', 'https://b.jpg']);
    expect(content.children).toEqual([
      {
        id: 'urn:li:image:a',
        mediaType: 'image',
        mediaUrl: 'https://a.jpg',
        thumbnailUrl: 'https://a.jpg',
      },
      {
        id: 'urn:li:image:b',
        mediaType: 'image',
        mediaUrl: 'https://b.jpg',
        thumbnailUrl: 'https://b.jpg',
      },
    ]);
  });

  test('maps a post without stats or media map', () => {
    const content = linkedInPostToContent(
      { id: 'urn:li:ugcPost:99', createdAt: 1714000000000 },
      null,
    );
    expect(content.metrics).toEqual({});
    expect(content.publishedAt).toEqual(new Date(1714000000000));
    expect(content.contentType).toBe('other');
    expect(content.mediaUrls).toEqual([]);
  });
});
