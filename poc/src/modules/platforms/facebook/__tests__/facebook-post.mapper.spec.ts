/**
 * Phase D pinning tests — see docs/platform-refactor.md §7 Phase D.
 * Targets the exported pure functions in mapper/facebook-post.mapper.ts
 * directly. Same fixtures, same snapshots as Phase 0; ensures behaviour
 * is preserved across the move.
 */
import {
  detectPostContentType,
  extractMediaUrls,
  extractPictureUrl,
  extractPostMetrics,
  mergePostInsights,
  postToContent,
} from '../mapper/facebook-post.mapper';
import { mergeVideoInsights } from '../mapper/facebook-video.mapper';
import type { ContentData } from '../../shared/platform-types';

const FROZEN_NOW = new Date('2026-04-28T12:00:00.000Z');

describe('Facebook post mapper (pinning)', () => {
  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(FROZEN_NOW);
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  describe('postToContent', () => {
    it('image post with full_picture and a single image attachment', () => {
      expect(
        postToContent({
          id: '12345_67890',
          message: 'Check out this view',
          created_time: '2026-04-20T10:30:00+0000',
          permalink_url: 'https://facebook.com/12345/posts/67890',
          full_picture: 'https://scontent.example/img.jpg',
          attachments: {
            data: [
              {
                media_type: 'photo',
                media: { image: { src: 'https://scontent.example/img-large.jpg' } },
                type: 'photo',
              },
            ],
          },
          comments: { summary: { total_count: 12 } },
          reactions: { summary: { total_count: 84 } },
        }),
      ).toMatchSnapshot();
    });

    it('text-only post (no media)', () => {
      expect(
        postToContent({
          id: '12345_111',
          message: 'Just a text update.',
          created_time: '2026-04-21T09:00:00+0000',
          permalink_url: 'https://facebook.com/12345/posts/111',
          comments: { summary: { total_count: 0 } },
          reactions: { summary: { total_count: 3 } },
        }),
      ).toMatchSnapshot();
    });

    it('carousel/album post with subattachments', () => {
      expect(
        postToContent({
          id: '12345_222',
          message: 'Trip recap',
          created_time: '2026-04-22T18:15:00+0000',
          permalink_url: 'https://facebook.com/12345/posts/222',
          full_picture: 'https://scontent.example/cover.jpg',
          attachments: {
            data: [
              {
                media_type: 'album',
                type: 'album',
                subattachments: {
                  data: [
                    { media: { image: { src: 'https://scontent.example/c1.jpg' } } },
                    { media: { source: 'https://scontent.example/c2.mp4' } },
                    { url: 'https://scontent.example/c3.jpg' },
                  ],
                },
              },
            ],
          },
          comments: { summary: { total_count: 5 } },
          reactions: { summary: { total_count: 27 } },
        }),
      ).toMatchSnapshot();
    });

    it('video post (attachments.media_type=video, no full_picture)', () => {
      expect(
        postToContent({
          id: '12345_333',
          message: undefined,
          created_time: '2026-04-23T08:00:00+0000',
          permalink_url: 'https://facebook.com/12345/posts/333',
          attachments: {
            data: [
              {
                media_type: 'video',
                media: { source: 'https://scontent.example/v.mp4' },
                type: 'video_inline',
              },
            ],
          },
          comments: { summary: { total_count: 1 } },
          reactions: { summary: { total_count: 9 } },
        }),
      ).toMatchSnapshot();
    });
  });

  describe('extractPostMetrics', () => {
    it('summary counts only (no insights)', () => {
      expect(
        extractPostMetrics({
          id: 'x',
          comments: { summary: { total_count: 7 } },
          reactions: { summary: { total_count: 22 } },
        }),
      ).toMatchSnapshot();
    });

    it('with reactions_by_type insights overlay', () => {
      expect(
        extractPostMetrics({
          id: 'x',
          comments: { summary: { total_count: 4 } },
          reactions: { summary: { total_count: 30 } },
          insights: {
            data: [
              { name: 'post_impressions', period: '', values: [{ value: 1200 }] },
              {
                name: 'post_reactions_by_type_total',
                period: '',
                values: [{ value: { like: 20, love: 8, wow: 2 } }],
              },
              { name: 'post_clicks', period: '', values: [{ value: 75 }] },
            ],
          },
        }),
      ).toMatchSnapshot();
    });
  });

  describe('extractMediaUrls', () => {
    it('attachments with sources + subattachments', () => {
      expect(
        extractMediaUrls({
          id: 'x',
          attachments: {
            data: [
              {
                media: { source: 'https://a/x.mp4' },
                subattachments: {
                  data: [
                    { media: { image: { src: 'https://a/sub1.jpg' } } },
                    { url: 'https://a/sub2.jpg' },
                  ],
                },
              },
            ],
          },
        }),
      ).toMatchSnapshot();
    });

    it('falls back to full_picture when attachments empty', () => {
      expect(
        extractMediaUrls({ id: 'x', full_picture: 'https://a/cover.jpg' }),
      ).toMatchSnapshot();
    });

    it('returns empty when no media at all', () => {
      expect(extractMediaUrls({ id: 'x' })).toEqual([]);
    });
  });

  describe('detectPostContentType', () => {
    it.each([
      ['image attachment', { id: 'x', attachments: { data: [{ media_type: 'photo' }] } }],
      ['video attachment', { id: 'x', attachments: { data: [{ media_type: 'video' }] } }],
      ['album attachment', { id: 'x', attachments: { data: [{ media_type: 'album' }] } }],
      ['no attachment, full_picture present', { id: 'x', full_picture: 'https://x' }],
      ['no attachment, no full_picture', { id: 'x' }],
      ['type=video_inline only', { id: 'x', attachments: { data: [{ type: 'video_inline' }] } }],
    ])('%s', (_label, post) => {
      expect(detectPostContentType(post)).toMatchSnapshot();
    });
  });

  describe('mergePostInsights', () => {
    it('reactions + clicks + activity flatten into metrics + extra', () => {
      const item: ContentData = {
        platformContentId: '12345_67890',
        contentType: 'image',
        caption: null,
        permalink: null,
        mediaUrls: [],
        thumbnailUrl: null,
        metrics: {},
        publishedAt: null,
        fetchedAt: FROZEN_NOW,
        rawResponse: { collection: 'raw_platform_responses', contentHash: 'h' },
      };
      mergePostInsights(item, [
        { name: 'post_media_view', period: '', values: [{ value: 5500 }] },
        {
          name: 'post_reactions_by_type_total',
          period: '',
          values: [{ value: { like: 80, love: 20, haha: 4, wow: 1 } }],
        },
        {
          name: 'post_clicks_by_type',
          period: '',
          values: [{ value: { 'photo view': 30, 'link clicks': 10 } }],
        },
        {
          name: 'post_activity_by_action_type',
          period: '',
          values: [{ value: { share: 7, comment: 12 } }],
        },
        { name: 'post_video_views', period: '', values: [{ value: 0 }] },
      ]);
      expect(item.metrics).toMatchSnapshot();
    });
  });

  describe('mergeVideoInsights', () => {
    it('total_video_views/_unique/_impressions/reactions feed canonical metrics', () => {
      const item: ContentData = {
        platformContentId: '999',
        contentType: 'video',
        caption: null,
        permalink: null,
        mediaUrls: [],
        thumbnailUrl: null,
        metrics: {},
        publishedAt: null,
        fetchedAt: FROZEN_NOW,
        rawResponse: { collection: 'raw_platform_responses', contentHash: 'h' },
      };
      mergeVideoInsights(item, [
        { name: 'total_video_views', period: '', values: [{ value: 12345 }] },
        { name: 'total_video_views_unique', period: '', values: [{ value: 9100 }] },
        { name: 'total_video_impressions', period: '', values: [{ value: 14200 }] },
        {
          name: 'total_video_reactions_by_type_total',
          period: '',
          values: [{ value: { like: 100, love: 40 } }],
        },
      ]);
      expect(item.metrics).toMatchSnapshot();
    });
  });

  describe('extractPictureUrl', () => {
    it.each([
      ['nested data.url', { data: { url: 'https://cdn.fb/pic.jpg' } }],
      ['no data', {}],
      ['null', null],
      ['string (invalid)', 'not-an-object'],
    ])('%s', (_label, picture) => {
      expect(extractPictureUrl(picture)).toMatchSnapshot();
    });
  });
});

// Max-capture extraction against realistic Graph payload shapes
// (docs/max-capture-all-platforms.md). Explicit assertions, no snapshots.
describe('Facebook post mapper (max-capture extraction)', () => {
  it('maps shares, status_type, message_tags and place', () => {
    const item = postToContent({
      id: '12345_111',
      message: 'match day with Acme Co',
      created_time: '2026-07-10T10:00:00+0000',
      permalink_url: 'https://facebook.com/12345/posts/111',
      full_picture: 'https://scontent.example/img.jpg',
      shares: { count: 7 },
      status_type: 'added_photos',
      message_tags: [
        { id: '99', name: 'Acme Co', type: 'page' },
        { id: '98', name: 'Acme Co', type: 'page' },
        { id: '97', name: '', type: 'page' },
      ],
      place: {
        id: '111222333',
        name: 'Miami, Florida',
        location: {
          city: 'Miami',
          country: 'United States',
          latitude: 25.7752,
          longitude: -80.192,
          street: '123 Ocean Dr',
          zip: '33139',
        },
      },
    });
    expect(item.metrics.shares).toBe(7);
    expect(item.mediaProductType).toBe('ADDED_PHOTOS');
    expect(item.mentions).toEqual(['Acme Co']); // deduped, empty names dropped
    expect(item.location).toEqual({
      id: '111222333',
      name: 'Miami, Florida',
      city: 'Miami',
      country: 'United States',
      latitude: 25.7752,
      longitude: -80.192,
      address: '123 Ocean Dr',
      postalCode: '33139',
    });
  });

  it('maps link-share attachments to linkAttachmentUrl/Title, never media posts', () => {
    const linkPost = postToContent({
      id: '12345_222',
      message: 'read this',
      created_time: '2026-07-10T10:00:00+0000',
      attachments: {
        data: [
          {
            type: 'share',
            title: 'Quarterly results',
            unshimmed_url: 'https://example.com/article',
            url: 'https://l.facebook.com/l.php?u=...',
          },
        ],
      },
    });
    expect(linkPost.linkAttachmentUrl).toBe('https://example.com/article');
    expect(linkPost.linkAttachmentTitle).toBe('Quarterly results');

    const photoPost = postToContent({
      id: '12345_333',
      created_time: '2026-07-10T10:00:00+0000',
      attachments: {
        data: [
          {
            media_type: 'photo',
            url: 'https://facebook.com/photo/123',
            media: { image: { src: 'https://scontent.example/p.jpg' } },
          },
        ],
      },
    });
    expect(photoPost.linkAttachmentUrl).toBeNull();
    expect(photoPost.linkAttachmentTitle).toBeNull();
  });

  it('place without id yields no location; absent extras stay null', () => {
    const item = postToContent({
      id: '12345_444',
      created_time: '2026-07-10T10:00:00+0000',
      place: { name: 'Nowhere' },
    });
    expect(item.location).toBeNull();
    expect(item.metrics.shares).toBeUndefined();
    expect(item.mediaProductType).toBeNull();
    expect(item.mentions).toBeNull();
  });
});
