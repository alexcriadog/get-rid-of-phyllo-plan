// Threads quote/repost capture. A quote post (is_quote_post) or a repost
// (REPOST_FACADE) often has no text/media of its OWN — the content lives in the
// quoted/reposted post. We must fetch + surface that referenced post or the
// item renders blank (real case: @camaleonicanalytics/post/DNOAtm1IpWh).

import {
  mergeThreadsPostInsights,
  threadsPostToContent,
} from '../mapper/threads-post.mapper';
import type { ThreadsPost } from '../../shared/threads-api/threads-types';

describe('threadsPostToContent — quotes & reposts', () => {
  it('captures the quoted post as a structured quotedPost reference', () => {
    const post: ThreadsPost = {
      id: '18310795768244686',
      media_type: 'TEXT_POST',
      is_quote_post: true,
      permalink: 'https://www.threads.com/@camaleonicanalytics/post/DNOAtm1IpWh',
      shortcode: 'DNOAtm1IpWh',
      username: 'camaleonicanalytics',
      quoted_post: {
        id: '999',
        media_type: 'IMAGE',
        text: 'the original post being quoted',
        media_url: 'https://cdn/img.jpg',
        permalink: 'https://www.threads.com/@someone/post/ABC',
        username: 'someone',
        timestamp: '2026-06-20T10:00:00Z',
      },
    };
    const c = threadsPostToContent(post);
    expect(c.quotedPost).toMatchObject({
      platformContentId: '999',
      ownerHandle: 'someone',
      caption: 'the original post being quoted',
      contentType: 'image',
      mediaUrls: ['https://cdn/img.jpg'],
      permalink: 'https://www.threads.com/@someone/post/ABC',
    });
    expect(c.repostedPost).toBeUndefined();
  });

  it('captures a reposted post as repostedPost', () => {
    const post: ThreadsPost = {
      id: '1',
      media_type: 'REPOST_FACADE',
      reposted_post: {
        id: '777',
        username: 'orig',
        text: 'reposted text',
        media_type: 'VIDEO',
        media_url: 'https://cdn/v.mp4',
        permalink: 'https://t/p',
      },
    };
    const c = threadsPostToContent(post);
    expect(c.repostedPost).toMatchObject({
      platformContentId: '777',
      ownerHandle: 'orig',
      caption: 'reposted text',
      contentType: 'video',
    });
  });

  it('leaves quotedPost/repostedPost undefined for a plain post', () => {
    const c = threadsPostToContent({ id: '2', media_type: 'TEXT_POST', text: 'hi' });
    expect(c.quotedPost).toBeUndefined();
    expect(c.repostedPost).toBeUndefined();
    expect(c.caption).toBe('hi');
  });
});

// Max-capture pass (2026-07-10): topic_tag, location (edge shape), link/GIF
// attachments, polls, spoiler flag, per-child alt_text — verified live on
// @i.am.pito ("World cup quarter finals" post, Miami-tagged).
describe('threadsPostToContent — max-capture fields', () => {
  it('maps topic tag, location edge, attachments and spoiler flag', () => {
    const post: ThreadsPost = {
      id: '18181270933410270',
      media_type: 'IMAGE',
      text: 'World cup quarter finals',
      media_url: 'https://cdn/img.jpg',
      topic_tag: 'World Cup 2026',
      location: {
        data: [
          {
            id: '1209084156595889',
            name: 'Miami, Florida',
            city: 'Miami',
            country: 'US',
            latitude: 25.7752,
            longitude: -80.192,
          },
        ],
      },
      link_attachment_url: 'https://example.com/article',
      gif_url: 'https://cdn/fun.gif',
      alt_text: 'a football stadium',
      is_spoiler_media: false,
    };
    const c = threadsPostToContent(post);
    expect(c.topicTag).toBe('World Cup 2026');
    expect(c.location).toEqual({
      id: '1209084156595889',
      name: 'Miami, Florida',
      city: 'Miami',
      country: 'US',
      latitude: 25.7752,
      longitude: -80.192,
      address: null,
      postalCode: null,
    });
    expect(c.linkAttachmentUrl).toBe('https://example.com/article');
    expect(c.gifUrl).toBe('https://cdn/fun.gif');
    expect(c.altText).toBe('a football stadium');
    expect(c.isSpoilerMedia).toBe(false);
  });

  it('compacts the flat poll_attachment options into an options array', () => {
    const c = threadsPostToContent({
      id: '3',
      media_type: 'TEXT_POST',
      text: 'poll',
      poll_attachment: {
        option_a: 'Yes',
        option_b: 'No',
        option_a_votes_percentage: 75,
        option_b_votes_percentage: 25,
        expiration_timestamp: '2026-07-11T11:54:19+0000',
        total_votes: 4,
      },
    });
    expect(c.poll).toEqual({
      options: [
        { label: 'Yes', votesPercentage: 75 },
        { label: 'No', votesPercentage: 25 },
      ],
      expiresAt: '2026-07-11T11:54:19+0000',
      totalVotes: 4,
    });
  });

  it('leaves the new fields undefined when the post has none', () => {
    const c = threadsPostToContent({ id: '4', media_type: 'TEXT_POST', text: 'plain' });
    expect(c.topicTag).toBeUndefined();
    expect(c.location).toBeUndefined();
    expect(c.linkAttachmentUrl).toBeUndefined();
    expect(c.gifUrl).toBeUndefined();
    expect(c.poll).toBeUndefined();
  });

  it('captures per-child alt_text on carousels', () => {
    const c = threadsPostToContent({
      id: '5',
      media_type: 'CAROUSEL_ALBUM',
      children: {
        data: [
          {
            id: 'c1',
            media_type: 'IMAGE',
            media_url: 'https://cdn/1.jpg',
            alt_text: 'first slide',
          },
          { id: 'c2', media_type: 'IMAGE', media_url: 'https://cdn/2.jpg' },
        ],
      },
    });
    expect(c.children?.[0].altText).toBe('first slide');
    expect(c.children?.[1].altText).toBeNull();
  });
});

describe('mergeThreadsPostInsights — shares/clicks/reposts routing', () => {
  it('keeps reposts on metrics.shares AND mirrors it into extra.reposts', () => {
    const c = threadsPostToContent({ id: '6', media_type: 'IMAGE' });
    mergeThreadsPostInsights(c, [
      { name: 'reposts', values: [{ value: 7 }] },
      { name: 'shares', values: [{ value: 3 }] },
      { name: 'clicks', values: [{ value: 11 }] },
    ]);
    expect(c.metrics.shares).toBe(7);
    expect(c.metrics.extra).toMatchObject({ reposts: 7, shares: 3, clicks: 11 });
  });
});
