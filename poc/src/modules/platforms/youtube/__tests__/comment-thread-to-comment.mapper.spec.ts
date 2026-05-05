import { commentThreadToComments } from '../mapper/comment-thread-to-comment.mapper';

describe('commentThreadToComments', () => {
  it('emits one CommentData per top-level + replies with parentCommentId', () => {
    const out = commentThreadToComments({
      id: 'thread1',
      snippet: {
        videoId: 'vid1',
        topLevelComment: {
          id: 'c1',
          snippet: {
            textOriginal: 'great video',
            authorDisplayName: 'fanA',
            authorChannelUrl: 'https://www.youtube.com/@fana',
            likeCount: 10,
            publishedAt: '2026-04-01T08:00:00Z',
          },
        },
        totalReplyCount: 1,
        canReply: true,
        isPublic: true,
      },
      replies: {
        comments: [
          {
            id: 'c2',
            snippet: {
              textOriginal: 'agree',
              authorDisplayName: 'fanB',
              likeCount: 0,
              publishedAt: '2026-04-01T09:00:00Z',
            },
          },
        ],
      },
    });

    expect(out).toHaveLength(2);
    const [top, reply] = out;
    expect(top.platformCommentId).toBe('c1');
    expect(top.platformContentId).toBe('vid1');
    expect(top.parentCommentId).toBeNull();
    expect(top.authorHandle).toBe('fana');
    expect(top.metrics.likes).toBe(10);

    expect(reply.platformCommentId).toBe('c2');
    expect(reply.parentCommentId).toBe('c1');
  });

  it('falls back to textDisplay when textOriginal missing', () => {
    const out = commentThreadToComments({
      id: 't',
      snippet: {
        videoId: 'v',
        topLevelComment: {
          id: 'c',
          snippet: { textDisplay: 'fallback', authorDisplayName: 'a' },
        },
      },
    });
    expect(out[0].text).toBe('fallback');
  });
});
