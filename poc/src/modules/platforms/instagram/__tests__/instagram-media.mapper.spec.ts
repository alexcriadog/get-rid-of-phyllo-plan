/**
 * Phase E pinning tests — targets exported pure functions in
 * mapper/instagram-media.mapper.ts.
 */
import {
  extractMetrics,
  mediaToContent,
} from '../mapper/instagram-media.mapper';

const FROZEN_NOW = new Date('2026-04-28T12:00:00.000Z');

describe('Instagram media mapper (pinning)', () => {
  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(FROZEN_NOW);
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  describe('mediaToContent', () => {
    it('IMAGE post with all fields', () => {
      expect(
        mediaToContent({
          id: 'ig-img-1',
          caption: 'Sunset',
          media_type: 'IMAGE',
          media_url: 'https://scontent.cdninstagram.example/img.jpg',
          permalink: 'https://instagram.com/p/abc123',
          timestamp: '2026-04-20T19:00:00+0000',
          like_count: 230,
          comments_count: 14,
          is_shared_to_feed: true,
          media_product_type: 'FEED',
          shortcode: 'abc123',
          owner: { id: 'ig-user-1', username: 'creator_one' },
        }),
      ).toMatchSnapshot();
    });

    it('VIDEO post with thumbnail', () => {
      expect(
        mediaToContent({
          id: 'ig-vid-1',
          caption: 'Behind the scenes',
          media_type: 'VIDEO',
          media_url: 'https://scontent.cdninstagram.example/v.mp4',
          thumbnail_url: 'https://scontent.cdninstagram.example/v-thumb.jpg',
          permalink: 'https://instagram.com/p/vid1',
          timestamp: '2026-04-21T10:30:00+0000',
          like_count: 1100,
          comments_count: 88,
          media_product_type: 'FEED',
          shortcode: 'vid1',
          owner: { id: 'ig-user-1', username: 'creator_one' },
        }),
      ).toMatchSnapshot();
    });

    it('REELS post', () => {
      expect(
        mediaToContent({
          id: 'ig-reel-1',
          caption: 'New trend',
          media_type: 'VIDEO',
          media_product_type: 'REELS',
          media_url: 'https://scontent.cdninstagram.example/r.mp4',
          thumbnail_url: 'https://scontent.cdninstagram.example/r-thumb.jpg',
          permalink: 'https://instagram.com/reel/r1',
          timestamp: '2026-04-22T09:00:00+0000',
          like_count: 5400,
          comments_count: 210,
          shortcode: 'r1',
          owner: { id: 'ig-user-1', username: 'creator_one' },
        }),
      ).toMatchSnapshot();
    });

    it('CAROUSEL_ALBUM with mixed children (image + video)', () => {
      expect(
        mediaToContent({
          id: 'ig-carousel-1',
          caption: 'Trip',
          media_type: 'CAROUSEL_ALBUM',
          permalink: 'https://instagram.com/p/car1',
          timestamp: '2026-04-23T08:00:00+0000',
          like_count: 320,
          comments_count: 17,
          media_product_type: 'FEED',
          shortcode: 'car1',
          owner: { id: 'ig-user-1', username: 'creator_one' },
          children: {
            data: [
              {
                id: 'c1',
                media_type: 'IMAGE',
                media_url: 'https://scontent.cdninstagram.example/c1.jpg',
                permalink: 'https://instagram.com/p/c1',
              },
              {
                id: 'c2',
                media_type: 'VIDEO',
                media_url: 'https://scontent.cdninstagram.example/c2.mp4',
                thumbnail_url: 'https://scontent.cdninstagram.example/c2-thumb.jpg',
                permalink: 'https://instagram.com/p/c2',
              },
            ],
          },
        }),
      ).toMatchSnapshot();
    });

    it('media with unknown media_type falls through to "other"', () => {
      expect(
        mediaToContent({
          id: 'ig-misc-1',
          media_type: 'WEIRD_NEW_TYPE',
          permalink: 'https://instagram.com/p/misc1',
          timestamp: '2026-04-24T07:00:00+0000',
        }),
      ).toMatchSnapshot();
    });
  });

  describe('extractMetrics', () => {
    it('like_count + comments_count present', () => {
      expect(
        extractMetrics({ id: 'x', like_count: 50, comments_count: 4 }),
      ).toMatchSnapshot();
    });

    it('only like_count', () => {
      expect(extractMetrics({ id: 'x', like_count: 7 })).toMatchSnapshot();
    });

    it('neither present returns empty', () => {
      expect(extractMetrics({ id: 'x' })).toEqual({});
    });

    it('Phase B.2: shares_count + saved_count promote to canonical', () => {
      expect(
        extractMetrics({
          id: 'x',
          like_count: 50,
          comments_count: 4,
          shares_count: 12,
          saved_count: 7,
        }),
      ).toEqual({ likes: 50, comments: 4, shares: 12, saves: 7 });
    });

    it('Phase B.2: numeric overflow fields land in extra', () => {
      expect(
        extractMetrics({
          id: 'x',
          like_count: 1,
          reposts_count: 3,
          total_like_count: 50,
          total_comments_count: 8,
          total_views_count: 220,
        }),
      ).toEqual({
        likes: 1,
        extra: {
          reposts: 3,
          total_like_count: 50,
          total_comments_count: 8,
          total_views_count: 220,
        },
      });
    });

    it('Phase B.2: non-numeric overflow fields are ignored (stay in raw)', () => {
      // boost_eligibility_info (object), boost_ads_list (array),
      // legacy_instagram_media_id (string) must NOT leak into extra,
      // which is contracted as Record<string, number>.
      expect(
        extractMetrics({
          id: 'x',
          like_count: 1,
          boost_eligibility_info: { eligible_to_boost: true },
          boost_ads_list: [],
          legacy_instagram_media_id: '123',
        }),
      ).toEqual({ likes: 1 });
    });
  });
});

// Max-capture extraction (docs/max-capture-all-platforms.md). Explicit
// assertions, no snapshots.
describe('Instagram media mapper (max-capture extraction)', () => {
  it('maps alt_text, is_comment_enabled and collaborators usernames', () => {
    const item = mediaToContent({
      id: 'ig-mc-1',
      media_type: 'IMAGE',
      media_url: 'https://scontent.cdninstagram.example/img.jpg',
      alt_text: 'a football stadium',
      is_comment_enabled: true,
      collaborators: {
        data: [
          { id: '1', username: 'colab.user' },
          { id: '2' }, // no username → filtered out
        ],
      },
    });
    expect(item.altText).toBe('a football stadium');
    expect(item.isCommentEnabled).toBe(true);
    expect(item.collaborators).toEqual(['colab.user']);
  });

  it('leaves the max-capture fields null when the media has none', () => {
    const item = mediaToContent({
      id: 'ig-mc-2',
      media_type: 'IMAGE',
      media_url: 'https://scontent.cdninstagram.example/img.jpg',
      collaborators: { data: [] },
    });
    expect(item.altText).toBeNull();
    expect(item.isCommentEnabled).toBeNull();
    expect(item.collaborators).toBeNull();
  });
});
