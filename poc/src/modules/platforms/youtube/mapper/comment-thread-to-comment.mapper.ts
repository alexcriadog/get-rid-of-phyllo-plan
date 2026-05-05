// commentThreads.list item → canonical CommentData[].
//
// Each commentThread carries the top-level comment plus optional inline
// replies (capped at 5 by the API; for full reply trees you'd call
// /comments?parentId=... separately — out of scope for the PoC).
//
// We emit one CommentData for the top-level + one per reply, all with the
// same platformContentId (the parent video) and parentCommentId set on
// replies so downstream consumers can rebuild the tree.

import type { CommentData } from '../../shared/platform-types';
import type {
  YoutubeComment,
  YoutubeCommentThread,
} from '../../shared/youtube-api/youtube-types';

export interface RawArchiveRef {
  collection: string;
  contentHash: string;
}

export function commentThreadToComments(
  thread: YoutubeCommentThread,
  raw: RawArchiveRef = { collection: 'raw_platform_responses', contentHash: '' },
): CommentData[] {
  const videoId = thread.snippet?.videoId ?? '';
  const top = thread.snippet?.topLevelComment;
  const out: CommentData[] = [];

  if (top) {
    out.push(commentToCanonical(top, videoId, null, raw));
  }

  const replies = thread.replies?.comments ?? [];
  const parentId = top?.id ?? null;
  for (const reply of replies) {
    out.push(commentToCanonical(reply, videoId, parentId, raw));
  }

  return out;
}

function commentToCanonical(
  c: YoutubeComment,
  videoId: string,
  parentId: string | null,
  raw: RawArchiveRef,
): CommentData {
  const s = c.snippet ?? {};
  return {
    platformCommentId: c.id ?? '',
    platformContentId: videoId,
    parentCommentId: parentId,
    authorHandle: s.authorChannelUrl ? extractHandleFromUrl(s.authorChannelUrl) : null,
    authorDisplayName: s.authorDisplayName ?? null,
    text: s.textOriginal ?? s.textDisplay ?? '',
    publishedAt: s.publishedAt ? safeDate(s.publishedAt) : null,
    fetchedAt: new Date(),
    metrics: { likes: typeof s.likeCount === 'number' ? s.likeCount : undefined },
    rawResponse: raw,
  };
}

function extractHandleFromUrl(url: string): string | null {
  const m = /\/@([A-Za-z0-9._-]+)/.exec(url);
  return m ? m[1] : null;
}

function safeDate(s: string): Date | null {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
