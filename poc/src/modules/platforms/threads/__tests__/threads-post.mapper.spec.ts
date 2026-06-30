// Threads quote/repost capture. A quote post (is_quote_post) or a repost
// (REPOST_FACADE) often has no text/media of its OWN — the content lives in the
// quoted/reposted post. We must fetch + surface that referenced post or the
// item renders blank (real case: @camaleonicanalytics/post/DNOAtm1IpWh).

import { threadsPostToContent } from '../mapper/threads-post.mapper';
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
