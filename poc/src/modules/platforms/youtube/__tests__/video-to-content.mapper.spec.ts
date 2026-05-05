import {
  parseIso8601DurationSeconds,
  videoToContent,
} from '../mapper/video-to-content.mapper';

describe('parseIso8601DurationSeconds', () => {
  it.each([
    ['PT3M14S', 194],
    ['PT1H', 3600],
    ['PT1H2M3S', 3723],
    ['PT45S', 45],
    ['P1DT2H', 93600],
  ])('parses %s → %d s', (input, expected) => {
    expect(parseIso8601DurationSeconds(input)).toBe(expected);
  });

  it('returns null on garbage', () => {
    expect(parseIso8601DurationSeconds('not iso')).toBeNull();
    expect(parseIso8601DurationSeconds(null)).toBeNull();
  });
});

describe('videoToContent', () => {
  it('classifies a Short (≤60s + #shorts tag) as reel', () => {
    const out = videoToContent({
      id: 'abc',
      snippet: {
        title: 'Quick clip',
        description: 'short video',
        publishedAt: '2026-04-01T12:00:00Z',
        tags: ['#shorts', 'fun'],
        thumbnails: { high: { url: 'https://yt/x.jpg' } },
      },
      statistics: { viewCount: '1000', likeCount: '50', commentCount: '7' },
      contentDetails: { duration: 'PT45S' },
    });
    expect(out.contentType).toBe('reel');
    expect(out.mediaProductType).toBe('SHORTS');
    expect(out.metrics.views).toBe(1000);
    expect(out.metrics.likes).toBe(50);
    expect(out.metrics.comments).toBe(7);
    expect(out.metrics.extra?.['durationSeconds']).toBe(45);
    expect(out.permalink).toBe('https://www.youtube.com/watch?v=abc');
    expect(out.embedUrl).toBe('https://www.youtube.com/embed/abc');
  });

  it('classifies a regular video', () => {
    const out = videoToContent({
      id: 'longvid',
      snippet: { title: 'Long form', publishedAt: '2026-03-01T00:00:00Z' },
      statistics: { viewCount: '100000', likeCount: '5000' },
      contentDetails: { duration: 'PT12M30S' },
    });
    expect(out.contentType).toBe('video');
    expect(out.mediaProductType).toBe('VIDEO');
    expect(out.metrics.extra?.['durationSeconds']).toBe(750);
  });

  it('classifies a live stream as live and surfaces concurrent viewers', () => {
    const out = videoToContent({
      id: 'live1',
      snippet: { title: 'LIVE NOW', liveBroadcastContent: 'live' },
      statistics: {},
      contentDetails: { duration: 'PT1H' },
      liveStreamingDetails: {
        actualStartTime: '2026-05-04T10:00:00Z',
        concurrentViewers: '12345',
      },
    });
    expect(out.contentType).toBe('live');
    expect(out.metrics.extra?.['concurrentViewers']).toBe(12345);
  });
});
