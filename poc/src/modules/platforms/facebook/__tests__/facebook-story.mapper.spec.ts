/**
 * Phase D pinning tests — targets exported pure functions in
 * mapper/facebook-story.mapper.ts.
 */
import {
  mapStoryInsights,
  parseCreationTime,
  storyToContent,
} from '../mapper/facebook-story.mapper';

const FROZEN_NOW = new Date('2026-04-28T12:00:00.000Z');

describe('Facebook story mapper (pinning)', () => {
  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(FROZEN_NOW);
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  describe('storyToContent', () => {
    it('numeric-string creation_time, video story', () => {
      expect(
        storyToContent({
          post_id: '12345_555',
          status: 'published',
          creation_time: '1777199988',
          media_type: 'video',
          media_id: '888',
          url: 'https://facebook.com/stories/555',
        }),
      ).toMatchSnapshot();
    });

    it('numeric creation_time, photo story', () => {
      expect(
        storyToContent({
          post_id: '12345_556',
          status: 'archived',
          creation_time: 1777200000,
          media_type: 'photo',
          media_id: '889',
          url: 'https://facebook.com/stories/556',
        }),
      ).toMatchSnapshot();
    });

    it('missing creation_time leaves publishedAt null', () => {
      expect(
        storyToContent({
          post_id: '12345_557',
          status: 'published',
          media_type: 'photo',
        }),
      ).toMatchSnapshot();
    });
  });

  describe('mapStoryInsights', () => {
    it('full 9-metric set', () => {
      expect(
        mapStoryInsights([
          {
            name: 'page_story_impressions_by_story_id',
            period: '',
            values: [{ value: 4400 }],
          },
          {
            name: 'page_story_impressions_by_story_id_unique',
            period: '',
            values: [{ value: 3300 }],
          },
          { name: 'pages_fb_story_replies', period: '', values: [{ value: 12 }] },
          { name: 'pages_fb_story_shares', period: '', values: [{ value: 6 }] },
          {
            name: 'pages_fb_story_thread_lightweight_reactions',
            period: '',
            values: [{ value: 88 }],
          },
          {
            name: 'pages_fb_story_sticker_interactions',
            period: '',
            values: [{ value: 21 }],
          },
          { name: 'story_interaction', period: '', values: [{ value: 117 }] },
          { name: 'story_media_view', period: '', values: [{ value: 4200 }] },
          { name: 'story_total_media_view_unique', period: '', values: [{ value: 3100 }] },
          { name: 'mystery_metric_x', period: '', values: [{ value: 9 }] },
        ]),
      ).toMatchSnapshot();
    });

    it('partial set — missing metrics are absent from output', () => {
      expect(
        mapStoryInsights([
          { name: 'page_story_impressions_by_story_id', period: '', values: [{ value: 100 }] },
          { name: 'pages_fb_story_replies', period: '', values: [{ value: 1 }] },
        ]),
      ).toMatchSnapshot();
    });

    it('non-numeric values are skipped', () => {
      expect(
        mapStoryInsights([
          {
            name: 'page_story_impressions_by_story_id',
            period: '',
            values: [{ value: { not: 'a-number' } as never }],
          },
        ]),
      ).toMatchSnapshot();
    });
  });

  describe('parseCreationTime', () => {
    it.each([
      ['numeric seconds', 1777199988],
      ['string of seconds', '1777199988'],
      ['ISO 8601', '2026-04-22T18:15:00+0000'],
      ['undefined', undefined],
      ['unparseable string', 'not-a-date'],
      ['empty string', ''],
    ])('%s', (_label, raw) => {
      const out = parseCreationTime(raw as string | number | undefined);
      expect(out === null ? null : out.toISOString()).toMatchSnapshot();
    });
  });
});
