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
    // Canonical comment wrappers ({account_pk, content_external_id,
    // external_id, doc}) — the live store since the 2026-06-08 canonical
    // cutover. Threading/publish-time/owner signals arrive as additive doc
    // keys; comments synced before 2026-07-15 lack them until re-synced.
    const canonicalDocs = await db
      .collection('comments')
      .find({ account_pk: accountId, content_external_id: contentId })
      .limit(500)
      .toArray();

    let comments: CommentDoc[];
    if (canonicalDocs.length > 0) {
      comments = canonicalDocs.map((d) => {
        const doc = (d.doc ?? {}) as Record<string, unknown>;
        return {
          platformCommentId: String(d.external_id ?? doc.external_id ?? ''),
          platformContentId: String(d.content_external_id ?? contentId),
          parentCommentId:
            (doc.parent_comment_id as string | undefined) ?? null,
          authorHandle:
            (doc.commenter_username as string | null | undefined) ?? null,
          authorDisplayName:
            (doc.commenter_display_name as string | null | undefined) ?? null,
          text: String(doc.text ?? ''),
          publishedAt: toIso(doc.published_at),
          fetchedAt: toIso(doc.updated_at ?? d.updated_at),
          metrics: {
            likes:
              typeof doc.like_count === 'number' ? doc.like_count : undefined,
            replies:
              typeof doc.reply_count === 'number' ? doc.reply_count : undefined,
          },
          pinned: doc.pinned === true ? true : undefined,
          likedByCreator: doc.liked_by_creator === true ? true : undefined,
          isOwnerReply: doc.is_owner_reply === true ? true : undefined,
        };
      });
    } else {
      // Legacy fallback — accounts whose comments never re-synced after the
      // canonical cutover still have only raw {account_id, data} docs.
      const docs = await db
        .collection('comments')
        .find({
          $or: [{ account_id: accountId }, { account_id: Number(accountId) || accountId }],
          platform_content_id: contentId,
        })
        .sort({ 'data.publishedAt': -1 })
        .limit(500)
        .toArray();
      comments = docs.map((d) => {
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
    }

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
