/**
 * GET /api/comments?accountId=<id>&contentId=<platformContentId>
 *
 * Returns the thread for one post. Reads from Mongo `connector_ui.comments`.
 * Top-level entries first (parentCommentId == null), most-recent first;
 * replies grouped under their parent in the same response.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getDb } from '../../lib/mongo';

interface CommentMetrics {
  likes?: number;
  replies?: number;
}

export interface CommentDoc {
  platformCommentId: string;
  platformContentId: string;
  parentCommentId?: string | null;
  authorHandle: string | null;
  authorDisplayName: string | null;
  text: string;
  publishedAt: string | null;     // ISO string after JSON-ification
  fetchedAt: string | null;
  metrics: CommentMetrics;
  pinned?: boolean;
  likedByCreator?: boolean;
  isOwnerReply?: boolean;
}

interface ApiResponse {
  contentId: string;
  total: number;
  comments: CommentDoc[];
  error?: string;
}

function toIso(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return null;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse>,
): Promise<void> {
  const accountId = typeof req.query.accountId === 'string' ? req.query.accountId : '';
  const contentId = typeof req.query.contentId === 'string' ? req.query.contentId : '';
  if (!accountId || !contentId) {
    res.status(400).json({
      contentId,
      total: 0,
      comments: [],
      error: 'accountId and contentId query params are required',
    });
    return;
  }

  try {
    const db = await getDb();
    const docs = await db
      .collection('comments')
      .find({
        $or: [{ account_id: accountId }, { account_id: Number(accountId) || accountId }],
        platform_content_id: contentId,
      })
      .sort({ 'data.publishedAt': -1 })
      .limit(500)
      .toArray();

    // Project to the wire shape — we keep the raw Mongo docs lightweight by
    // unwrapping `data` (where the worker stored the canonical `CommentData`).
    const comments: CommentDoc[] = docs.map((d) => {
      const data = (d.data ?? {}) as Record<string, unknown>;
      return {
        platformCommentId: String(data.platformCommentId ?? d.platform_comment_id ?? ''),
        platformContentId: String(data.platformContentId ?? d.platform_content_id ?? ''),
        parentCommentId: (data.parentCommentId as string | null | undefined) ?? null,
        authorHandle: (data.authorHandle as string | null | undefined) ?? null,
        authorDisplayName: (data.authorDisplayName as string | null | undefined) ?? null,
        text: String(data.text ?? ''),
        publishedAt: toIso(data.publishedAt),
        fetchedAt: toIso(data.fetchedAt),
        metrics: (data.metrics as CommentMetrics) ?? {},
        pinned: data.pinned === true ? true : undefined,
        likedByCreator: data.likedByCreator === true ? true : undefined,
        isOwnerReply: data.isOwnerReply === true ? true : undefined,
      };
    });

    // Group: pinned first, then top-level (parentCommentId == null) by date desc,
    // each followed by its replies (also by date desc within the group).
    const byParent = new Map<string, CommentDoc[]>();
    const topLevel: CommentDoc[] = [];
    for (const c of comments) {
      if (c.parentCommentId) {
        const arr = byParent.get(c.parentCommentId) ?? [];
        arr.push(c);
        byParent.set(c.parentCommentId, arr);
      } else {
        topLevel.push(c);
      }
    }
    topLevel.sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      const da = a.publishedAt ?? '';
      const db = b.publishedAt ?? '';
      return db.localeCompare(da);
    });

    const out: CommentDoc[] = [];
    for (const top of topLevel) {
      out.push(top);
      const replies = byParent.get(top.platformCommentId) ?? [];
      replies.sort((a, b) => {
        const da = a.publishedAt ?? '';
        const db = b.publishedAt ?? '';
        return db.localeCompare(da);
      });
      for (const r of replies) out.push(r);
    }

    // Surface orphan replies (parent missing from this page) at the bottom so
    // they're not silently dropped.
    const knownIds = new Set(out.map((c) => c.platformCommentId));
    for (const c of comments) {
      if (!knownIds.has(c.platformCommentId)) out.push(c);
    }

    res.status(200).json({ contentId, total: out.length, comments: out });
  } catch (err) {
    res.status(500).json({
      contentId,
      total: 0,
      comments: [],
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
