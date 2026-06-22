// Read-only MCP tool implementations. Every tool is workspace-scoped: the
// workspaceId comes from the authenticated connection token (never from the
// model), and account/content access is resolved + tenancy-checked through the
// same ApiAccountResolver the /v1 API uses. Results are returned as Markdown
// text so they render consistently across MCP clients.

import { Injectable } from "@nestjs/common";
import {
  apiAccountId,
  type ApiProfile,
  type ApiContent,
  type ApiAudience,
  type ApiComment,
} from "@modules/data-schema";
import { ApiReadService } from "@modules/data-api/read.service";
import {
  ApiAccountResolver,
  type ResolvedAccount,
} from "@modules/data-api/account-resolver.service";
import { MCP_DEFAULT_PAGE_LIMIT, MCP_MAX_PAGE_LIMIT } from "./constants";

export interface ListContentOptions {
  fromDate?: string;
  toDate?: string;
  hashtag?: string;
  query?: string;
  limit?: number;
  offset?: number;
}

export interface PageOptions {
  limit?: number;
  offset?: number;
}

export interface OverviewOptions {
  period?: string;
  fromDate?: string;
  toDate?: string;
  platform?: string;
}

const DAY_MS = 86_400_000;

@Injectable()
export class McpToolsService {
  constructor(
    private readonly read: ApiReadService,
    private readonly resolver: ApiAccountResolver,
  ) {}

  async listWorkspaces(workspaceId: string): Promise<string> {
    const accounts = await this.resolver.accountsFor(workspaceId);
    const active = accounts.filter((a) => a.status !== "disconnected").length;
    return `Connected workspace \`${workspaceId}\` — ${active} active account(s) (${accounts.length} total).`;
  }

  async listAccounts(workspaceId: string, platform?: string): Promise<string> {
    const rows = await this.resolver.accountsFor(workspaceId);
    const filtered = platform
      ? rows.filter((r) => r.platform.toLowerCase() === platform.toLowerCase())
      : rows;
    if (filtered.length === 0) {
      return platform
        ? `No connected accounts on platform "${platform}".`
        : "No connected accounts in this workspace.";
    }
    const lines = filtered.map((r) => {
      const id = apiAccountId(r.id.toString());
      const name = r.displayName ?? r.handle ?? "(unknown)";
      return `- **${name}** · ${r.platform} · status=${r.status} · id=\`${id}\``;
    });
    return [`Connected accounts (${filtered.length}):`, ...lines].join("\n");
  }

  async getAccount(workspaceId: string, accountId: string): Promise<string> {
    const acc = await this.resolver.byAccountUuid(workspaceId, accountId);
    if (!acc) return notFound("account", accountId);
    const profile = await this.read.profileByAccountPk(acc.id.toString());
    if (!profile) {
      return `Account \`${accountId}\` (${acc.platform}) has no profile snapshot yet.`;
    }
    return formatProfile(profile, acc);
  }

  async getAccountAudience(
    workspaceId: string,
    accountId: string,
  ): Promise<string> {
    const acc = await this.resolver.byAccountUuid(workspaceId, accountId);
    if (!acc) return notFound("account", accountId);
    const audience = await this.read.audienceByAccountPk(acc.id.toString());
    if (!audience) {
      return `No audience demographics available for account \`${accountId}\` (${acc.platform}).`;
    }
    return formatAudience(audience, acc);
  }

  async listContent(
    workspaceId: string,
    accountId: string,
    opts: ListContentOptions,
  ): Promise<string> {
    const acc = await this.resolver.byAccountUuid(workspaceId, accountId);
    if (!acc) return notFound("account", accountId);
    const { offset, limit } = clampPage(opts);
    const items = await this.read.contents(acc.id.toString(), {
      offset,
      limit,
      fromDate: parseDate(opts.fromDate),
      toDate: parseDate(opts.toDate),
      hashtag: opts.hashtag,
      query: opts.query,
    });
    if (items.length === 0) {
      const filters = [
        opts.hashtag ? `hashtag ${opts.hashtag}` : null,
        opts.query ? `text "${opts.query}"` : null,
      ].filter(Boolean);
      return filters.length
        ? `No content found for account \`${accountId}\` matching ${filters.join(" + ")}.`
        : `No content found for account \`${accountId}\`.`;
    }
    const who = acc.displayName ?? acc.handle ?? acc.platform;
    return [
      `Content for ${who} (showing ${items.length}, offset ${offset}):`,
      ...items.map(formatContentRow),
    ].join("\n");
  }

  async getContentAnalytics(
    workspaceId: string,
    contentId: string,
  ): Promise<string> {
    const found = await this.read.contentById(contentId);
    if (!found || !(await this.ownsAccount(workspaceId, found.accountPk))) {
      return notFound("content", contentId);
    }
    return formatContentAnalytics(found.doc);
  }

  async getContentComments(
    workspaceId: string,
    accountId: string,
    contentId: string,
    opts: PageOptions,
  ): Promise<string> {
    const acc = await this.resolver.byAccountUuid(workspaceId, accountId);
    if (!acc) return notFound("account", accountId);
    const found = await this.read.contentById(contentId);
    if (!found || found.accountPk !== acc.id.toString()) {
      return notFound("content", contentId);
    }
    const { offset, limit } = clampPage(opts);
    const comments = await this.read.comments(
      acc.id.toString(),
      found.doc.external_id,
      { offset, limit },
    );
    if (comments.length === 0) {
      return `No comments found for content \`${contentId}\`.`;
    }
    return [`Comments (${comments.length}):`, ...comments.map(formatComment)].join(
      "\n",
    );
  }

  async getAnalyticsOverview(
    workspaceId: string,
    opts: OverviewOptions,
  ): Promise<string> {
    const all = await this.resolver.accountsFor(workspaceId);
    const platform = opts.platform;
    const accounts = platform
      ? all.filter((r) => r.platform.toLowerCase() === platform.toLowerCase())
      : all;
    if (accounts.length === 0) {
      return platform
        ? `No connected accounts on platform "${platform}".`
        : "No connected accounts to summarise.";
    }
    const win = resolveWindow(opts);
    const summary = await this.read.engagementSummary(
      accounts.map((a) => a.id.toString()),
      win.from,
      win.to,
    );
    const byPk = new Map(summary.map((s) => [s.accountPk, s]));
    const totals = zeroTotals();
    const perPlatform = new Map<string, Totals>();
    const accountLines: string[] = [];
    for (const a of accounts) {
      const s = byPk.get(a.id.toString());
      const t: Totals = s
        ? {
            posts: s.posts,
            likes: s.likes,
            comments: s.comments,
            shares: s.shares,
            saves: s.saves,
            views: s.views,
            impressions: s.impressions,
            reach: s.reach,
          }
        : zeroTotals();
      addTotals(totals, t);
      const pp = perPlatform.get(a.platform) ?? zeroTotals();
      addTotals(pp, t);
      perPlatform.set(a.platform, pp);
      const who = a.displayName ?? a.handle ?? "(account)";
      accountLines.push(
        `- ${who} (${a.platform}): ${t.posts} posts · 👁${fmtNum(t.views)} · 👍${fmtNum(t.likes)} · 💬${fmtNum(t.comments)} · 🔁${fmtNum(t.shares)} · ER ${engRate(t)}`,
      );
    }
    const out: string[] = [
      `**Analytics overview — ${win.label}** (${accounts.length} account(s))`,
      `Totals: ${totals.posts} posts · 👁${fmtNum(totals.views)} views · ${fmtNum(totals.impressions)} impressions · ${fmtNum(totals.reach)} reach · 👍${fmtNum(totals.likes)} · 💬${fmtNum(totals.comments)} · 🔁${fmtNum(totals.shares)} · 🔖${fmtNum(totals.saves)} · ER ${engRate(totals)}`,
      "By platform:",
    ];
    for (const [plat, pp] of [...perPlatform.entries()].sort(
      (x, y) => y[1].views - x[1].views,
    )) {
      out.push(
        `- ${plat}: ${pp.posts} posts · 👁${fmtNum(pp.views)} · 👍${fmtNum(pp.likes)} · 💬${fmtNum(pp.comments)} · ER ${engRate(pp)}`,
      );
    }
    out.push("By account:", ...accountLines);
    out.push(
      "",
      "_ER = (likes + comments + shares + saves) / views (or / impressions when views are 0)._",
    );
    return out.join("\n");
  }

  /** Tenancy guard: does this content's account belong to the workspace? */
  private async ownsAccount(
    workspaceId: string,
    accountPk: string,
  ): Promise<boolean> {
    const rows = await this.resolver.accountsFor(workspaceId);
    return rows.some((r) => r.id.toString() === accountPk);
  }
}

// ---- aggregation helpers ---------------------------------------------------

interface Totals {
  posts: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  views: number;
  impressions: number;
  reach: number;
}

function zeroTotals(): Totals {
  return {
    posts: 0,
    likes: 0,
    comments: 0,
    shares: 0,
    saves: 0,
    views: 0,
    impressions: 0,
    reach: 0,
  };
}

function addTotals(acc: Totals, t: Totals): void {
  acc.posts += t.posts;
  acc.likes += t.likes;
  acc.comments += t.comments;
  acc.shares += t.shares;
  acc.saves += t.saves;
  acc.views += t.views;
  acc.impressions += t.impressions;
  acc.reach += t.reach;
}

function engRate(t: Totals): string {
  const interactions = t.likes + t.comments + t.shares + t.saves;
  const denom = t.views > 0 ? t.views : t.impressions;
  return denom > 0 ? `${((interactions / denom) * 100).toFixed(1)}%` : "—";
}

function resolveWindow(
  opts: OverviewOptions,
): { from?: Date; to?: Date; label: string } {
  const from = parseDate(opts.fromDate);
  const to = parseDate(opts.toDate);
  if (from || to) {
    return {
      from,
      to,
      label: `${opts.fromDate ?? "start"} → ${opts.toDate ?? "now"}`,
    };
  }
  const days = opts.period === "7d" ? 7 : opts.period === "90d" ? 90 : 30;
  return { from: new Date(Date.now() - days * DAY_MS), label: `last ${days} days` };
}

// ---- formatting helpers ----------------------------------------------------

function notFound(kind: string, id: string): string {
  return `No ${kind} found for id \`${id}\` (it may not exist or may belong to another workspace).`;
}

function fmtNum(n: number | null | undefined): string {
  return typeof n === "number" ? n.toLocaleString("en-US") : "—";
}

function parseDate(s?: string): Date | undefined {
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function clampPage(opts: PageOptions): { offset: number; limit: number } {
  const offset = Math.max(0, Math.floor(opts.offset ?? 0));
  const rawLimit = Math.floor(opts.limit ?? MCP_DEFAULT_PAGE_LIMIT);
  const limit = Math.min(MCP_MAX_PAGE_LIMIT, Math.max(1, rawLimit));
  return { offset, limit };
}

function clip(s: string | null | undefined, n: number): string {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function pct(v: number): string {
  return `${v.toFixed(1)}%`;
}

function top<T>(arr: T[] | null | undefined, key: (t: T) => number, n: number): T[] {
  return [...(arr ?? [])].sort((a, b) => key(b) - key(a)).slice(0, n);
}

function formatProfile(p: ApiProfile, acc: ResolvedAccount): string {
  const r = p.reputation;
  const title =
    p.full_name ?? p.username ?? acc.displayName ?? acc.handle ?? "(account)";
  const out: string[] = [
    `**${title}** — ${acc.platform}${p.is_verified ? " ✓" : ""}`,
  ];
  if (p.username) out.push(`- Username: ${p.username}`);
  if (p.url) out.push(`- URL: ${p.url}`);
  const rep: Array<[string, number | null]> = [
    ["Followers", r.follower_count],
    ["Following", r.following_count],
    ["Subscribers", r.subscriber_count],
    ["Paid subscribers", r.paid_subscriber_count],
    ["Posts / content", r.content_count],
    ["Total likes", r.like_count],
    ["Connections", r.connection_count],
    ["Watch time (h)", r.watch_time_in_hours],
  ];
  for (const [label, value] of rep) {
    if (typeof value === "number") out.push(`- ${label}: ${fmtNum(value)}`);
  }
  if (p.category) out.push(`- Category: ${p.category}`);
  if (p.platform_account_type) out.push(`- Account type: ${p.platform_account_type}`);
  if (typeof p.is_business === "boolean") {
    out.push(`- Business account: ${p.is_business ? "yes" : "no"}`);
  }
  if (p.country) out.push(`- Country: ${p.country}`);
  if (p.website) out.push(`- Website: ${p.website}`);
  if (p.introduction) out.push(`- Bio: ${clip(p.introduction, 280)}`);
  return out.join("\n");
}

function formatAudience(a: ApiAudience, acc: ResolvedAccount): string {
  const out: string[] = [
    `**Audience** — ${acc.displayName ?? acc.handle ?? acc.platform}`,
  ];
  const countries = top(a.countries, (x) => x.value, 8);
  if (countries.length) {
    out.push("Top countries:");
    out.push(...countries.map((c) => `- ${c.code}: ${pct(c.value)}`));
  }
  const cities = top(a.cities, (x) => x.value, 8);
  if (cities.length) {
    out.push("Top cities:");
    out.push(...cities.map((c) => `- ${c.name}: ${pct(c.value)}`));
  }
  const ga = top(a.gender_age_distribution, (x) => x.value, 10);
  if (ga.length) {
    out.push("Gender × age:");
    out.push(...ga.map((b) => `- ${b.gender} ${b.age_range}: ${pct(b.value)}`));
  }
  const gd = top(a.gender_distribution, (x) => x.value, 5);
  if (gd.length) {
    out.push("Gender:");
    out.push(...gd.map((b) => `- ${b.label}: ${pct(b.value)}`));
  }
  const ad = top(a.age_distribution, (x) => x.value, 8);
  if (ad.length) {
    out.push("Age:");
    out.push(...ad.map((b) => `- ${b.label}: ${pct(b.value)}`));
  }
  return out.join("\n");
}

function formatContentRow(c: ApiContent): string {
  const e = c.engagement;
  const kind = c.type ?? c.format ?? "post";
  const when = (c.published_at ?? "").slice(0, 10) || "—";
  const caption = clip(c.title ?? c.description ?? "", 90) || "(no caption)";
  const tags = (c.hashtags ?? []).join(" ");
  const metrics = `👍${fmtNum(e.like_count)} 💬${fmtNum(e.comment_count)} 👁${fmtNum(e.view_count)} 🔁${fmtNum(e.share_count)}`;
  return `- \`${c.id}\` · ${kind} · ${when} · ${metrics} — "${caption}"${tags ? ` ${tags}` : ""}`;
}

function formatContentAnalytics(c: ApiContent): string {
  const e = c.engagement;
  const out: string[] = [`**Content \`${c.id}\`** — ${c.type ?? c.format ?? "post"}`];
  if (c.published_at) out.push(`- Published: ${c.published_at}`);
  if (c.url) out.push(`- URL: ${c.url}`);
  if (c.media_url) out.push(`- Media: ${c.media_url}`);
  if (typeof c.duration === "number") out.push(`- Duration: ${c.duration}s`);
  const caption = [c.title, c.description].filter(Boolean).join(" — ");
  if (caption) out.push(`- Caption: ${caption}`);
  if (c.hashtags?.length) out.push(`- Hashtags: ${c.hashtags.join(" ")}`);
  if (c.mentions?.length) out.push(`- Mentions: ${c.mentions.join(" ")}`);
  if (c.content_tags?.length) out.push(`- Tags: ${c.content_tags.join(", ")}`);

  const eng: Array<[string, number | null]> = [
    ["Likes", e.like_count],
    ["Dislikes", e.dislike_count],
    ["Comments", e.comment_count],
    ["Shares", e.share_count],
    ["Reposts", e.repost_count],
    ["Saves", e.save_count],
    ["Views", e.view_count],
    ["Replays", e.replay_count],
    ["Clicks", e.click_count],
    ["Organic impressions", e.impression_organic_count],
    ["Organic reach", e.reach_organic_count],
    ["Paid impressions", e.impression_paid_count],
    ["Paid reach", e.reach_paid_count],
    ["Watch time (h)", e.watch_time_in_hours],
    ["Avg watch (s)", e.avg_watch_time_in_sec],
  ];
  const engLines = eng.filter(([, v]) => typeof v === "number");
  if (engLines.length) {
    out.push("- Engagement:");
    out.push(...engLines.map(([l, v]) => `    · ${l}: ${fmtNum(v)}`));
  }

  const ai = e.additional_info;
  if (ai) {
    const extra: Array<[string, number | null | undefined]> = [
      ["Profile visits", ai.profile_visits],
      ["Bio link clicks", ai.bio_link_clicked],
      ["Followers gained", ai.followers_gained],
      ["Total interactions", ai.total_interactions],
      ["Reels skip rate", ai.reels_skip_rate],
      ["Completion rate", ai.completion_rate],
      ["Story replies", ai.story_replies],
    ];
    const extraLines = extra.filter(([, v]) => typeof v === "number");
    if (extraLines.length) {
      out.push("- Extra:");
      out.push(...extraLines.map(([l, v]) => `    · ${l}: ${fmtNum(v)}`));
    }
  }

  if (c.audience) {
    const a = c.audience;
    const parts: string[] = [];
    const co = top(a.countries, (x) => x.value, 5).map((x) => `${x.code} ${pct(x.value)}`);
    if (co.length) parts.push(`countries: ${co.join(", ")}`);
    const ga = top(a.gender_age_distribution, (x) => x.value, 5).map(
      (x) => `${x.gender} ${x.age_range} ${pct(x.value)}`,
    );
    if (ga.length) parts.push(`gender×age: ${ga.join(", ")}`);
    if (a.audience_types?.length) {
      parts.push(
        `types: ${a.audience_types.map((t) => `${t.label} ${pct(t.value)}`).join(", ")}`,
      );
    }
    if (parts.length) {
      out.push("- Post audience:");
      out.push(...parts.map((p) => `    · ${p}`));
    }
  }

  if (c.insights) {
    const i = c.insights;
    const parts: string[] = [];
    if (i.traffic_sources?.length) {
      parts.push(
        `traffic: ${i.traffic_sources.slice(0, 5).map((t) => `${t.source} ${fmtNum(t.views)}`).join(", ")}`,
      );
    }
    if (i.devices?.length) {
      parts.push(
        `devices: ${i.devices.slice(0, 5).map((d) => `${d.device_type} ${fmtNum(d.views)}`).join(", ")}`,
      );
    }
    if (i.sharing?.length) {
      parts.push(
        `sharing: ${i.sharing.slice(0, 5).map((s) => `${s.service} ${fmtNum(s.shares)}`).join(", ")}`,
      );
    }
    if (i.viewer_types?.length) {
      parts.push(
        `viewers: ${i.viewer_types.map((v) => `${v.label} ${pct(v.value)}`).join(", ")}`,
      );
    }
    if (parts.length) {
      out.push("- Deep insights:");
      out.push(...parts.map((p) => `    · ${p}`));
    }
  }

  return out.join("\n");
}

function formatComment(c: ApiComment): string {
  const who = c.commenter_display_name ?? c.commenter_username ?? "(anonymous)";
  const text = clip(c.text, 160);
  return `- **${who}** (👍${fmtNum(c.like_count)}, ↩${fmtNum(c.reply_count)}): ${text}`;
}
