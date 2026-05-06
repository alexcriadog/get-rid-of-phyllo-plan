import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { ArrowRight } from 'lucide-react';
import AdminLayout from '../../components/AdminLayout';
import { CONNECTOR_API_URL, adminPost } from '../../lib/api';
import { fmtNumber } from '../../lib/format';
import { Section } from '@/components/admin/section';
import { Empty } from '@/components/admin/empty';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

type DiscoveredPage = {
  page_id: string;
  page_name: string;
  page_access_token: string;
  page_already_connected: boolean;
  instagram?: {
    ig_business_id: string;
    username: string | null;
    name: string | null;
    followers_count: number | null;
    profile_picture_url: string | null;
    already_connected: boolean;
  };
};

type TikTokDiscoveredAccount = {
  open_id: string;
  username: string | null;
  display_name: string | null;
  profile_image: string | null;
  followers_count: number | null;
  following_count: number | null;
  videos_count: number | null;
  total_likes: number | null;
  is_verified: boolean | null;
  already_connected: boolean;
};

type ThreadsDiscoveredAccount = {
  user_id: string;
  username: string | null;
  name: string | null;
  profile_picture_url: string | null;
  biography: string | null;
  is_verified: boolean | null;
  already_connected: boolean;
};

type DiscoverResponse = {
  me: { id: string | null; name: string | null };
  token_type:
    | 'user'
    | 'page'
    | 'unknown'
    | 'tiktok-business'
    | 'threads-user';
  pages: DiscoveredPage[];
  tiktok_account?: TikTokDiscoveredAccount;
  threads_account?: ThreadsDiscoveredAccount;
  warnings: string[];
};

type SeedResponse = {
  account_id: string;
  sync_jobs_created: string[];
};

type ConnectKey = string; // `${platform}:${id}`

type SeedBody = {
  platform: 'instagram' | 'facebook' | 'tiktok' | 'threads';
  access_token: string;
  refresh_token?: string;
  expires_at?: string; // ISO 8601 with offset
  canonical_user_id: string;
  handle?: string;
  metadata?: Record<string, unknown>;
};

type DiscoverPlatform = 'facebook' | 'tiktok' | 'threads';

// Result of the YouTube OAuth callback, encoded as query params on the
// post-exchange 302 from the Nest API back to /admin/connect.
type OauthResult =
  | {
      kind: 'success';
      accountId: string;
      channelId: string;
      handle: string;
      title: string;
      subs: string;
      videos: string;
      views: string;
      alreadyConnected: boolean;
    }
  | { kind: 'error'; message: string }
  | null;

export default function ConnectPage() {
  const router = useRouter();
  const [oauthResult, setOauthResult] = useState<OauthResult>(null);
  const [platform, setPlatform] = useState<DiscoverPlatform>('facebook');
  const [token, setToken] = useState('');
  const [openId, setOpenId] = useState('');
  const [refreshToken, setRefreshToken] = useState('');
  const [expiresInS, setExpiresInS] = useState('');
  const [discovering, setDiscovering] = useState(false);
  const [discovery, setDiscovery] = useState<DiscoverResponse | null>(null);
  const [discoverErr, setDiscoverErr] = useState<string | null>(null);

  const [busy, setBusy] = useState<ConnectKey | null>(null);
  const [results, setResults] = useState<Record<ConnectKey, SeedResponse | string>>({});

  // YouTube OAuth callback lands back here as /admin/connect?yt=success&...
  // (or ?yt=error&message=...). Capture the params into local state, then
  // strip them from the URL so a refresh doesn't re-show the banner.
  useEffect(() => {
    if (!router.isReady) return;
    const yt = router.query.yt;
    if (yt === 'success') {
      setOauthResult({
        kind: 'success',
        accountId: String(router.query.account_id ?? ''),
        channelId: String(router.query.channel_id ?? ''),
        handle: String(router.query.handle ?? ''),
        title: String(router.query.title ?? ''),
        subs: String(router.query.subs ?? ''),
        videos: String(router.query.videos ?? ''),
        views: String(router.query.views ?? ''),
        alreadyConnected: router.query.already_connected === '1',
      });
      void router.replace('/admin/connect', undefined, { shallow: true });
    } else if (yt === 'error') {
      setOauthResult({
        kind: 'error',
        message: String(router.query.message ?? 'Unknown error'),
      });
      void router.replace('/admin/connect', undefined, { shallow: true });
    }
    // router.replace clears the query, which retriggers this effect with
    // yt === undefined; the early no-op handles that case naturally.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady, router.query.yt]);

  const onDiscover = async () => {
    if (!token.trim()) return;
    if (platform === 'tiktok' && !openId.trim()) {
      setDiscoverErr(
        "TikTok needs the 'open_id' returned by the BC OAuth callback alongside the access_token.",
      );
      return;
    }
    setDiscovering(true);
    setDiscoverErr(null);
    setDiscovery(null);
    setResults({});
    try {
      const res = await adminPost<DiscoverResponse>('/admin/connect/discover', {
        platform,
        access_token: token.trim(),
        ...(platform === 'tiktok' && openId.trim()
          ? { open_id: openId.trim() }
          : {}),
      });
      setDiscovery(res);
    } catch (e) {
      setDiscoverErr((e as Error).message);
    } finally {
      setDiscovering(false);
    }
  };

  const connect = async (key: ConnectKey, body: SeedBody) => {
    setBusy(key);
    try {
      const res = await adminPost<SeedResponse>('/admin/connect/seed', body);
      setResults((prev) => ({ ...prev, [key]: res }));
    } catch (e) {
      setResults((prev) => ({ ...prev, [key]: (e as Error).message }));
    } finally {
      setBusy(null);
    }
  };

  const connectToolUrl =
    process.env.NEXT_PUBLIC_CONNECT_TOOL_URL ?? 'http://localhost:3002';

  return (
    <AdminLayout title="Connect new accounts">
      {/* connect-tool CTA — primary path. The paste-token UI below is the
          fallback for emergencies or scripts. */}
      <Section
        title={
          <span className="flex items-center gap-2">
            <Badge variant="ok">Recommended</Badge>
            <span>Use connect-tool</span>
          </span>
        }
        description="Click a platform, approve the OAuth dialog, done. The paste-token form below is kept as a fallback."
        actions={
          <Button asChild>
            <a href={connectToolUrl} target="_blank" rel="noopener noreferrer">
              Open connect-tool ↗
            </a>
          </Button>
        }
      >
        <p className="text-sm text-muted-foreground">
          The transient OAuth helper at <code>{connectToolUrl}</code> handles
          Facebook, Instagram, TikTok, Threads and YouTube end-to-end and POSTs
          the resulting tokens to <code>/admin/connect/seed</code> with the
          configured bearer token. See <code>connect-tool/README.md</code> for
          the kill-switch.
        </p>
      </Section>
      {oauthResult?.kind === 'success' && (
        <Section
          title={
            <span className="flex items-center gap-2">
              <Badge variant="ok">
                {oauthResult.alreadyConnected ? 'Reconnected' : 'Connected'}
              </Badge>
              <span>{oauthResult.title || 'YouTube channel'}</span>
            </span>
          }
          description={
            oauthResult.alreadyConnected
              ? 'Channel was already connected — access token refreshed.'
              : `Account ${oauthResult.accountId} seeded with 4 sync jobs (identity, audience, engagement_new, comments).`
          }
          actions={
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setOauthResult(null)}
            >
              Dismiss
            </Button>
          }
        >
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
            {[
              ['Handle', oauthResult.handle],
              ['Subscribers', oauthResult.subs],
              ['Videos', oauthResult.videos],
              ['Total views', oauthResult.views],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                  {label}
                </dt>
                <dd className="mt-1 font-mono text-xs">{value || '—'}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {oauthResult.accountId && (
              <Button asChild size="sm">
                <Link href={`/admin/accounts/${oauthResult.accountId}`}>
                  View account
                </Link>
              </Button>
            )}
            <Button asChild size="sm" variant="outline">
              <Link href="/admin/accounts">All accounts</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href="/admin">Admin overview</Link>
            </Button>
            {oauthResult.channelId && (
              <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                {oauthResult.channelId}
              </span>
            )}
          </div>
        </Section>
      )}

      {oauthResult?.kind === 'error' && (
        <Section
          title={
            <span className="flex items-center gap-2">
              <Badge variant="danger">Failed</Badge>
              <span>YouTube connection</span>
            </span>
          }
          description="The OAuth callback returned an error. Check the message below and try again."
          actions={
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setOauthResult(null)}
            >
              Dismiss
            </Button>
          }
        >
          <pre className="overflow-x-auto rounded-md border border-border bg-secondary/40 p-3 font-mono text-xs">
            {oauthResult.message}
          </pre>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button asChild size="sm">
              <a href={`${CONNECTOR_API_URL}/oauth/start/youtube`}>
                Try again
              </a>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href="/admin">Admin overview</Link>
            </Button>
          </div>
        </Section>
      )}

      <Section
        title="Quick connect (browser OAuth)"
        description="One-click flow for platforms that handle OAuth in the browser. We redirect you to the provider's consent screen and seed the account + sync_jobs on return."
      >
        <div className="flex flex-wrap items-center gap-3">
          <Button asChild>
            <a href={`${CONNECTOR_API_URL}/oauth/start/youtube`}>
              Connect YouTube
            </a>
          </Button>
          <span className="text-xs text-muted-foreground">
            Requests <code>youtube.readonly</code> + <code>yt-analytics.readonly</code> +{' '}
            <code>yt-analytics-monetary.readonly</code>.
          </span>
        </div>
      </Section>
      <Section
        title="1. Discover"
        description={
          platform === 'tiktok' ? (
            <>
              Paste a TikTok <strong>Business Center</strong> access token plus
              the <code>open_id</code> returned by the BC OAuth callback.
              We&apos;ll call <code>/business/get/</code> to validate and fetch
              the basic profile.
            </>
          ) : platform === 'threads' ? (
            <>
              Paste a long-lived <strong>Threads</strong> user token (scopes{' '}
              <code>threads_basic</code> + <code>threads_manage_insights</code>{' '}
              + <code>threads_read_replies</code> +{' '}
              <code>threads_manage_mentions</code>). We&apos;ll call{' '}
              <code>graph.threads.net/v1.0/me</code> to validate and fetch the
              connected user.
            </>
          ) : (
            <>
              Paste a Meta <strong>User</strong> or <strong>Page</strong>{' '}
              access token. We&apos;ll enumerate Pages this token can manage
              and (when present) the Instagram Business account linked to each
              Page.
            </>
          )
        }
      >
        <div className="mb-3 flex items-center gap-2">
          <span className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
            Platform
          </span>
          <Select
            value={platform}
            onValueChange={(v) => {
              setPlatform(v as DiscoverPlatform);
              setDiscovery(null);
              setDiscoverErr(null);
            }}
          >
            <SelectTrigger className="w-[180px] font-mono text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="facebook" className="font-mono text-xs">
                Meta (FB + IG)
              </SelectItem>
              <SelectItem value="tiktok" className="font-mono text-xs">
                TikTok
              </SelectItem>
              <SelectItem value="threads" className="font-mono text-xs">
                Threads
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
          <textarea
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={
              platform === 'tiktok'
                ? 'act.zI317…'
                : platform === 'threads'
                  ? 'THAAxxxxxxxx…'
                  : 'EAAxxxxxxxx…'
            }
            spellCheck={false}
            rows={3}
            className="flex-1 resize-y rounded-md border border-input bg-card px-3 py-2 font-mono text-xs text-foreground shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <Button
            onClick={onDiscover}
            disabled={
              discovering ||
              !token.trim() ||
              (platform === 'tiktok' && !openId.trim())
            }
            className="min-w-[140px] sm:self-stretch"
          >
            {discovering ? 'Discovering…' : 'Discover'}
          </Button>
        </div>
        {platform === 'tiktok' && (
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                open_id (required)
              </span>
              <Input
                value={openId}
                onChange={(e) => setOpenId(e.target.value)}
                placeholder="-000ZwowuI7N…"
                className="font-mono text-xs"
                spellCheck={false}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                refresh_token (recommended)
              </span>
              <Input
                value={refreshToken}
                onChange={(e) => setRefreshToken(e.target.value)}
                placeholder="rft.6KRK…"
                className="font-mono text-xs"
                spellCheck={false}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                expires_in seconds (optional)
              </span>
              <Input
                value={expiresInS}
                onChange={(e) => setExpiresInS(e.target.value)}
                placeholder="86400"
                inputMode="numeric"
                className="font-mono text-xs"
                spellCheck={false}
              />
            </label>
          </div>
        )}
        {discoverErr && (
          <div className="mt-3 rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
            {discoverErr}
          </div>
        )}
      </Section>

      {discovery && (
        <>
          <Section
            title={
              <span className="flex items-center gap-2">
                Authenticated as
                <Badge
                  variant={
                    discovery.token_type === 'user'
                      ? 'ok'
                      : discovery.token_type === 'page'
                        ? 'primary'
                        : 'default'
                  }
                >
                  {discovery.token_type} token
                </Badge>
              </span>
            }
          >
            <div className="font-mono text-sm">
              {discovery.me.name ?? '—'}{' '}
              <span className="text-muted-foreground">
                ({discovery.me.id ?? '—'})
              </span>
            </div>
            {discovery.warnings.length > 0 && (
              <div className="mt-3 flex flex-col gap-2">
                {discovery.warnings.map((w, i) => (
                  <div
                    key={i}
                    className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn"
                  >
                    {w}
                  </div>
                ))}
              </div>
            )}
          </Section>

          {discovery.token_type !== 'tiktok-business' &&
            discovery.token_type !== 'threads-user' && (
            <Section
              title={`2. Pages found (${discovery.pages.length})`}
              description="Each Page can be connected as Facebook, and (when present) as the linked Instagram Business account."
            >
              {discovery.pages.length === 0 ? (
                <Empty message="No pages returned. The token may lack pages_show_list or no Pages are managed by this user." />
              ) : (
                <div className="flex flex-col gap-3">
                  {discovery.pages.map((p) => (
                    <PageCard
                      key={p.page_id}
                      page={p}
                      busy={busy}
                      results={results}
                      onConnect={connect}
                    />
                  ))}
                </div>
              )}
            </Section>
          )}

          {discovery.threads_account && (
            <Section
              title="2. Threads account"
              description="Verified by graph.threads.net/v1.0/me. Click Connect to seed it with the long-lived user token above."
            >
              <ThreadsAccountCard
                account={discovery.threads_account}
                busy={busy === `threads:${discovery.threads_account.user_id}`}
                result={
                  results[`threads:${discovery.threads_account.user_id}`]
                }
                onConnect={() => {
                  const acc = discovery.threads_account;
                  if (!acc) return;
                  return connect(`threads:${acc.user_id}`, {
                    platform: 'threads',
                    access_token: token.trim(),
                    canonical_user_id: acc.user_id,
                    handle: acc.username
                      ? `@${acc.username}`
                      : acc.name ?? undefined,
                    metadata: {
                      user_id: acc.user_id,
                    },
                  });
                }}
              />
            </Section>
          )}

          {discovery.tiktok_account && (
            <Section
              title="2. TikTok account"
              description="Verified by /business/get/. Click Connect to seed it with the access + refresh tokens you provided above."
            >
              <TikTokAccountCard
                account={discovery.tiktok_account}
                busy={busy === `tiktok:${discovery.tiktok_account.open_id}`}
                result={
                  results[`tiktok:${discovery.tiktok_account.open_id}`]
                }
                onConnect={() => {
                  const acc = discovery.tiktok_account;
                  if (!acc) return;
                  const expiresAt = (() => {
                    const n = Number(expiresInS);
                    if (!Number.isFinite(n) || n <= 0) return undefined;
                    return new Date(Date.now() + n * 1000).toISOString();
                  })();
                  return connect(`tiktok:${acc.open_id}`, {
                    platform: 'tiktok',
                    access_token: token.trim(),
                    refresh_token: refreshToken.trim() || undefined,
                    expires_at: expiresAt,
                    canonical_user_id: acc.open_id,
                    handle: acc.username
                      ? `@${acc.username}`
                      : acc.display_name ?? undefined,
                    metadata: {
                      business_id: acc.open_id,
                      open_id: acc.open_id,
                    },
                  });
                }}
              />
            </Section>
          )}
        </>
      )}

      <Card className="mb-5">
        <details>
          <summary className="cursor-pointer select-none px-6 py-4 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
            Manual connect (bypass discovery)
          </summary>
          <div className="border-t border-border px-6 py-5">
            <ManualForm onConnect={connect} busy={busy} results={results} />
          </div>
        </details>
      </Card>
    </AdminLayout>
  );
}

function TikTokAccountCard({
  account,
  busy,
  result,
  onConnect,
}: {
  account: TikTokDiscoveredAccount;
  busy: boolean;
  result?: SeedResponse | string;
  onConnect: () => Promise<void> | void;
}) {
  const handle = account.username ? `@${account.username}` : account.display_name ?? '—';
  const ok =
    result && typeof result === 'object' && 'account_id' in result
      ? result
      : null;
  const errMsg = result && typeof result === 'string' ? result : null;

  return (
    <Card className="grid gap-4 p-5 md:grid-cols-[1fr_auto] md:items-center">
      <div className="flex items-center gap-4">
        {account.profile_image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={account.profile_image}
            alt={`${handle} avatar`}
            referrerPolicy="no-referrer"
            className="h-14 w-14 rounded-full border border-border object-cover"
          />
        ) : (
          <div className="flex h-14 w-14 items-center justify-center rounded-full border border-border bg-muted font-mono text-sm text-muted-foreground">
            tt
          </div>
        )}
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-semibold">{handle}</span>
            {account.is_verified && <Badge variant="primary">verified</Badge>}
            {account.already_connected && (
              <Badge variant="ok">already connected</Badge>
            )}
          </div>
          <div className="font-mono text-[11px] text-muted-foreground">
            {account.display_name && account.username
              ? `${account.display_name} · `
              : ''}
            {fmtNumber(account.followers_count ?? 0)} followers
            {account.videos_count != null && (
              <> · {fmtNumber(account.videos_count)} videos</>
            )}
            {account.total_likes != null && (
              <> · {fmtNumber(account.total_likes)} ♥ lifetime</>
            )}
          </div>
          <div className="font-mono text-[10px] text-muted-foreground/70">
            open_id {account.open_id.slice(0, 14)}…
          </div>
        </div>
      </div>
      <div className="flex flex-col items-end gap-2">
        <Button onClick={onConnect} disabled={busy}>
          {busy ? 'Connecting…' : ok ? 'Reseed' : 'Connect'}
          {!busy && !ok && <ArrowRight className="ml-1 h-3.5 w-3.5" />}
        </Button>
        {ok && (
          <span className="font-mono text-[10px] text-ok">
            ✓ acc #{ok.account_id} · {ok.sync_jobs_created.length} sync_jobs
          </span>
        )}
        {errMsg && (
          <span className="font-mono text-[10px] text-danger">{errMsg}</span>
        )}
      </div>
    </Card>
  );
}

function ThreadsAccountCard({
  account,
  busy,
  result,
  onConnect,
}: {
  account: ThreadsDiscoveredAccount;
  busy: boolean;
  result?: SeedResponse | string;
  onConnect: () => Promise<void> | void;
}) {
  const handle = account.username ? `@${account.username}` : account.name ?? '—';
  const ok =
    result && typeof result === 'object' && 'account_id' in result
      ? result
      : null;
  const errMsg = result && typeof result === 'string' ? result : null;

  return (
    <Card className="grid gap-4 p-5 md:grid-cols-[1fr_auto] md:items-center">
      <div className="flex items-center gap-4">
        {account.profile_picture_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={account.profile_picture_url}
            alt={`${handle} avatar`}
            referrerPolicy="no-referrer"
            className="h-14 w-14 rounded-full border border-border object-cover"
          />
        ) : (
          <div className="flex h-14 w-14 items-center justify-center rounded-full border border-border bg-muted font-mono text-sm text-muted-foreground">
            th
          </div>
        )}
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-semibold">{handle}</span>
            {account.is_verified && <Badge variant="primary">verified</Badge>}
            {account.already_connected && (
              <Badge variant="ok">already connected</Badge>
            )}
          </div>
          <div className="font-mono text-[11px] text-muted-foreground">
            {account.name && account.username ? `${account.name} · ` : ''}
            user_id {account.user_id}
          </div>
          {account.biography && (
            <div className="line-clamp-2 max-w-[480px] text-[11px] text-muted-foreground/80">
              {account.biography}
            </div>
          )}
        </div>
      </div>
      <div className="flex flex-col items-end gap-2">
        <Button onClick={onConnect} disabled={busy}>
          {busy ? 'Connecting…' : ok ? 'Reseed' : 'Connect'}
          {!busy && !ok && <ArrowRight className="ml-1 h-3.5 w-3.5" />}
        </Button>
        {ok && (
          <span className="font-mono text-[10px] text-ok">
            ✓ acc #{ok.account_id} · {ok.sync_jobs_created.length} sync_jobs
          </span>
        )}
        {errMsg && (
          <span className="font-mono text-[10px] text-danger">{errMsg}</span>
        )}
      </div>
    </Card>
  );
}

function PageCard({
  page,
  busy,
  results,
  onConnect,
}: {
  page: DiscoveredPage;
  busy: ConnectKey | null;
  results: Record<ConnectKey, SeedResponse | string>;
  onConnect: (key: ConnectKey, body: SeedBody) => Promise<void>;
}) {
  const fbKey: ConnectKey = `facebook:${page.page_id}`;
  const igKey: ConnectKey | null = page.instagram
    ? `instagram:${page.instagram.ig_business_id}`
    : null;

  return (
    <Card className="grid gap-4 p-5 md:grid-cols-2">
      <ConnectableCell
        platform="facebook"
        title="Facebook Page"
        primary={page.page_name}
        secondary={`Page ID · ${page.page_id}`}
        avatar={null}
        connected={page.page_already_connected}
        busy={busy === fbKey}
        result={results[fbKey]}
        onClick={() =>
          onConnect(fbKey, {
            platform: 'facebook',
            access_token: page.page_access_token,
            canonical_user_id: page.page_id,
            handle: page.page_name,
            metadata: { page_id: page.page_id },
          })
        }
      />

      {igKey && page.instagram ? (
        <ConnectableCell
          platform="instagram"
          title="Instagram Business"
          primary={
            page.instagram.username
              ? `@${page.instagram.username}`
              : page.instagram.name ?? '—'
          }
          secondary={
            page.instagram.followers_count != null
              ? `${fmtNumber(page.instagram.followers_count)} followers · IG ${page.instagram.ig_business_id}`
              : `IG ${page.instagram.ig_business_id}`
          }
          avatar={page.instagram.profile_picture_url}
          connected={page.instagram.already_connected}
          busy={busy === igKey}
          result={results[igKey]}
          onClick={() =>
            onConnect(igKey, {
              platform: 'instagram',
              access_token: page.page_access_token,
              canonical_user_id: page.instagram!.ig_business_id,
              handle:
                page.instagram!.username ?? page.instagram!.name ?? undefined,
              metadata: { page_id: page.page_id },
            })
          }
        />
      ) : (
        <div className="flex items-center justify-center rounded-md border border-dashed border-border/70 bg-card/40 p-5 text-center text-xs text-muted-foreground">
          No Instagram Business account linked to this Page.
        </div>
      )}
    </Card>
  );
}

function ConnectableCell({
  platform,
  title,
  primary,
  secondary,
  avatar,
  connected,
  busy,
  result,
  onClick,
}: {
  platform: 'facebook' | 'instagram';
  title: string;
  primary: string;
  secondary: string;
  avatar: string | null;
  connected: boolean;
  busy: boolean;
  result: SeedResponse | string | undefined;
  onClick: () => void;
}) {
  const succeeded = !!result && typeof result !== 'string';
  const failed = typeof result === 'string';
  const titleTone =
    platform === 'instagram' ? 'text-primary' : 'text-info';

  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-md border bg-secondary/30 p-4',
        connected || succeeded
          ? 'border-ok/40 bg-ok/5'
          : 'border-border',
      )}
    >
      <div
        className={cn(
          'font-mono text-[10.5px] font-semibold uppercase tracking-[0.16em]',
          titleTone,
        )}
      >
        {title}
      </div>

      <div className="flex items-center gap-3">
        {avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatar}
            alt={primary}
            referrerPolicy="no-referrer"
            width={42}
            height={42}
            className="h-[42px] w-[42px] flex-shrink-0 rounded-full object-cover"
          />
        ) : (
          <div
            className={cn(
              'flex h-[42px] w-[42px] flex-shrink-0 items-center justify-center rounded-full border border-border bg-card font-bold',
              titleTone,
            )}
          >
            {primary.replace(/^@/, '').charAt(0).toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <div className="truncate font-semibold text-foreground">{primary}</div>
          <div className="font-mono text-[11px] text-muted-foreground">
            {secondary}
          </div>
        </div>
      </div>

      <div className="mt-auto space-y-2">
        {connected && !succeeded && (
          <Badge variant="ok">already connected</Badge>
        )}
        {succeeded && typeof result !== 'string' && result && (
          <div className="space-y-1.5 text-xs leading-relaxed">
            <Badge variant="ok">connected</Badge>
            <div className="font-mono text-muted-foreground">
              account #{result.account_id} ·{' '}
              {result.sync_jobs_created.length} jobs queued
            </div>
            <Link
              href={`/account/${result.account_id}`}
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              View account <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        )}
        {failed && (
          <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-[11px] text-danger">
            {result as string}
          </div>
        )}
        {!connected && !succeeded && !failed && (
          <Button
            onClick={onClick}
            disabled={busy}
            className="w-full"
          >
            {busy
              ? 'Connecting…'
              : `Connect ${platform === 'instagram' ? 'Instagram' : 'Facebook'}`}
          </Button>
        )}
        {(connected || succeeded || failed) && (
          <Button
            onClick={onClick}
            disabled={busy}
            variant="outline"
            size="sm"
            className="w-full"
          >
            {busy
              ? '…'
              : connected && !succeeded
                ? 'Reconnect / refresh token'
                : 'Re-run'}
          </Button>
        )}
      </div>
    </div>
  );
}

function ManualForm({
  onConnect,
  busy,
  results,
}: {
  onConnect: (key: ConnectKey, body: SeedBody) => Promise<void>;
  busy: ConnectKey | null;
  results: Record<ConnectKey, SeedResponse | string>;
}) {
  const [platform, setPlatform] = useState<'instagram' | 'facebook'>('instagram');
  const [accessToken, setAccessToken] = useState('');
  const [canonicalId, setCanonicalId] = useState('');
  const [handle, setHandle] = useState('');
  const [pageId, setPageId] = useState('');

  const key: ConnectKey = `${platform}:${canonicalId}`;
  const result = results[key];

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label className="text-xs font-medium">Platform</label>
        <Select
          value={platform}
          onValueChange={(v) => setPlatform(v as 'instagram' | 'facebook')}
        >
          <SelectTrigger className="w-[220px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="instagram">instagram</SelectItem>
            <SelectItem value="facebook">facebook</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium">Canonical user ID</label>
        <Input
          value={canonicalId}
          onChange={(e) => setCanonicalId(e.target.value)}
          placeholder={platform === 'instagram' ? '17841401234567890' : '105...'}
          className="font-mono text-xs"
        />
        <p className="text-[11px] text-muted-foreground">
          {platform === 'instagram'
            ? 'IG Business account id (e.g. 17841401234567890)'
            : 'Facebook Page id'}
        </p>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium">Access token</label>
        <textarea
          rows={2}
          value={accessToken}
          onChange={(e) => setAccessToken(e.target.value)}
          placeholder="EAA…"
          className="w-full resize-y rounded-md border border-input bg-card px-3 py-2 font-mono text-xs text-foreground shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium">Handle (optional)</label>
        <Input
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          placeholder="@brand"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium">
          Page ID (optional, recommended for IG)
        </label>
        <Input
          value={pageId}
          onChange={(e) => setPageId(e.target.value)}
          placeholder="105..."
          className="font-mono text-xs"
        />
      </div>

      <Button
        disabled={!accessToken || !canonicalId || busy === key}
        onClick={() =>
          onConnect(key, {
            platform,
            access_token: accessToken.trim(),
            canonical_user_id: canonicalId.trim(),
            handle: handle.trim() || undefined,
            metadata: pageId.trim() ? { page_id: pageId.trim() } : undefined,
          })
        }
        className="min-w-[160px]"
      >
        {busy === key ? 'Connecting…' : 'Connect manually'}
      </Button>

      {result && typeof result !== 'string' && (
        <div className="font-mono text-xs text-ok">
          ✓ account #{result.account_id} ·{' '}
          {result.sync_jobs_created.length} jobs queued
        </div>
      )}
      {typeof result === 'string' && (
        <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {result}
        </div>
      )}
    </div>
  );
}
