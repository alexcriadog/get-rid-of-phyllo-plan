import Link from 'next/link';
import type { GetServerSideProps } from 'next';
import { getDb } from '../../../lib/mongo';
import { fmtRelative, fmtNumber, truncate } from '../../../lib/format';

type Post = {
  account_id: number | string;
  post_id: string;
  platform?: string;
  caption?: string;
  media_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
  timestamp?: string;
  metrics?: Record<string, number>;
};

type PageProps = {
  id: string;
  posts: Post[];
};

export const getServerSideProps: GetServerSideProps<PageProps> = async (ctx) => {
  const id = String(ctx.params?.id || '');
  try {
    const db = await getDb();
    const filters = [{ account_id: id }, { account_id: Number(id) || id }];
    const raw = (await db
      .collection('posts')
      .find({ $or: filters })
      .sort({ timestamp: -1 })
      .limit(30)
      .toArray()) as unknown as Post[];
    const posts = JSON.parse(JSON.stringify(raw)) as Post[];
    return { props: { id, posts } };
  } catch (err) {
    console.error(err);
    return { props: { id, posts: [] } };
  }
};

export default function AccountPosts({ id, posts }: PageProps) {
  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: 'var(--space-6) var(--space-5)' }}>
      <header className="row" style={{ marginBottom: 'var(--space-5)' }}>
        <Link href={`/account/${id}`} className="muted">
          ← Account overview
        </Link>
        <div className="spacer" />
        <span className="badge">{posts.length} posts</span>
      </header>

      {posts.length === 0 ? (
        <div className="panel">
          <div className="panel-title">No posts synced yet</div>
          <p className="muted">Either the sync hasn&apos;t run or the account has no content.</p>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
            gap: 'var(--space-4)',
          }}
        >
          {posts.map((p) => {
            const thumb = p.thumbnail_url || p.media_url;
            const likes = p.metrics?.likes ?? p.metrics?.like_count;
            const comments = p.metrics?.comments ?? p.metrics?.comments_count;
            return (
              <a
                key={p.post_id}
                href={p.permalink || '#'}
                target="_blank"
                rel="noopener noreferrer"
                style={{ textDecoration: 'none' }}
              >
                <div className="panel" style={{ padding: 0, overflow: 'hidden', height: '100%' }}>
                  <div
                    style={{
                      aspectRatio: '1 / 1',
                      background: 'var(--bg-panel-hi)',
                      position: 'relative',
                      overflow: 'hidden',
                    }}
                  >
                    {thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={thumb}
                        alt={truncate(p.caption, 40) || p.post_id}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      <div
                        className="muted"
                        style={{
                          position: 'absolute',
                          inset: 0,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 11,
                        }}
                      >
                        {p.media_type || 'no media'}
                      </div>
                    )}
                    {p.media_type && (
                      <span
                        className="badge"
                        style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.6)' }}
                      >
                        {p.media_type}
                      </span>
                    )}
                  </div>
                  <div style={{ padding: 'var(--space-3)' }}>
                    <div style={{ fontSize: 12, lineHeight: 1.4, minHeight: 32 }}>
                      {truncate(p.caption || '', 80)}
                    </div>
                    <div
                      className="row"
                      style={{
                        marginTop: 'var(--space-2)',
                        gap: 10,
                        fontSize: 11,
                        color: 'var(--text-muted)',
                      }}
                    >
                      <span className="mono">♥ {fmtNumber(likes)}</span>
                      <span className="mono">💬 {fmtNumber(comments)}</span>
                      <div className="spacer" />
                      <span className="faint">{fmtRelative(p.timestamp)}</span>
                    </div>
                  </div>
                </div>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
