/**
 * Phase D pinning tests — targets exported functions in
 * mapper/facebook-video.mapper.ts.
 */
import {
  extractVideoMetrics,
  videoToContent,
} from '../mapper/facebook-video.mapper';

const FROZEN_NOW = new Date('2026-04-28T12:00:00.000Z');

describe('Facebook video mapper (pinning)', () => {
  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(FROZEN_NOW);
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  describe('videoToContent', () => {
    it('typical video with description, source and insights', () => {
      expect(
        videoToContent({
          id: 'vid-1',
          description: 'Highlight reel',
          source: 'https://video.example/v.mp4',
          created_time: '2026-04-15T12:00:00+0000',
          permalink_url: 'https://facebook.com/videos/vid-1',
          video_insights: {
            data: [
              { name: 'total_video_views', period: '', values: [{ value: 9876 }] },
            ],
          },
        }),
      ).toMatchSnapshot();
    });

    it('video without description or insights', () => {
      expect(
        videoToContent({
          id: 'vid-2',
          source: 'https://video.example/v2.mp4',
          created_time: '2026-04-16T15:00:00+0000',
          permalink_url: 'https://facebook.com/videos/vid-2',
        }),
      ).toMatchSnapshot();
    });
  });

  describe('extractVideoMetrics', () => {
    it('total_video_views maps to views; rest go to extra', () => {
      expect(
        extractVideoMetrics({
          id: 'vid-1',
          video_insights: {
            data: [
              { name: 'total_video_views', period: '', values: [{ value: 100 }] },
              {
                name: 'total_video_avg_time_watched',
                period: '',
                values: [{ value: 7.5 }],
              },
            ],
          },
        }),
      ).toMatchSnapshot();
    });

    it('non-numeric values are filtered out', () => {
      expect(
        extractVideoMetrics({
          id: 'vid-2',
          video_insights: {
            data: [
              {
                name: 'total_video_views',
                period: '',
                values: [{ value: { object: 'not-numeric' } as never }],
              },
            ],
          },
        }),
      ).toMatchSnapshot();
    });

    it('no insights returns empty', () => {
      expect(extractVideoMetrics({ id: 'vid-3' })).toEqual({});
    });
  });
});
