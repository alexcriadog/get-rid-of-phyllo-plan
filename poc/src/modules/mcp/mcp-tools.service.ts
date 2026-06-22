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
  limit?: number;
  offset?: number;
}

export interface PageOptions {
  limit?: number;
  offset?: number;
}

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
    });
    if (items.length === 0) {
      return `No content found for account \`${accountId}\`.`;
    }
    const lines = items.map(formatContentRow);
    const who = acc.displayName ?? acc.handle ?? acc.platform;
    return [
      `Content for ${who} (showing ${items.length}, offset ${offset}):`,
      ...lines,
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

  /** Tenancy guard: does this content's account belong to the workspace? */
  private async ownsAccount(
    workspaceId: string,
    accountPk: string,
  ): Promise<boolean> {
    const rows = await this.resolver.accountsFor(workspaceId);
    return rows.some((r) => r.id.toString() === accountPk);
  }
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

function formatProfile(p: ApiProfile, acc: ResolvedAccount): string {
  const r = p.reputation;
  const title =
    p.full_name ?? p.username ?? acc.displayName ?? acc.handle ?? "(account)";
  const out: string[] = [
    `**${title}** — ${acc.platform}`,
    `- Username: ${p.username ?? "—"}`,
    `- Followers: ${fmtNum(r.follower_count)}`,
    `- Following: ${fmtNum(r.following_count)}`,
  ];
  if (typeof r.subscriber_count === "number") {
    out.push(`- Subscribers: ${fmtNum(r.subscriber_count)}`);
  }
  out.push(`- Content count: ${fmtNum(r.content_count)}`);
  out.push(`- Verified: ${p.is_verified ? "yes" : "no"}`);
  if (p.url) out.push(`- URL: ${p.url}`);
  return out.join("\n");
}

function formatAudience(a: ApiAudience, acc: ResolvedAccount): string {
  const out: string[] = [
    `**Audience** — ${acc.displayName ?? acc.handle ?? acc.platform}`,
  ];
  const countries = [...a.countries].sort((x, y) => y.value - x.value).slice(0, 5);
  if (countries.length) {
    out.push("Top countries:");
    out.push(...countries.map((c) => `- ${c.code}: ${c.value.toFixed(1)}%`));
  }
  const cities = [...a.cities].sort((x, y) => y.value - x.value).slice(0, 5);
  if (cities.length) {
    out.push("Top cities:");
    out.push(...cities.map((c) => `- ${c.name}: ${c.value.toFixed(1)}%`));
  }
  const ga = [...a.gender_age_distribution]
    .sort((x, y) => y.value - x.value)
    .slice(0, 8);
  if (ga.length) {
    out.push("Gender × age:");
    out.push(...ga.map((b) => `- ${b.gender} ${b.age_range}: ${b.value.toFixed(1)}%`));
  }
  return out.join("\n");
}

function formatContentRow(c: ApiContent): string {
  const e = c.engagement;
  const kind = c.type ?? c.format ?? "post";
  const when = c.published_at ?? "—";
  const caption =
    (c.title ?? c.description ?? "").replace(/\s+/g, " ").trim().slice(0, 60) ||
    "(no caption)";
  return `- \`${c.id}\` · ${kind} · ${when} · 👍${fmtNum(e.like_count)} 💬${fmtNum(e.comment_count)} 👁${fmtNum(e.view_count)} — ${caption}`;
}

function formatContentAnalytics(c: ApiContent): string {
  const e = c.engagement;
  const out: Array<string | null> = [
    `**Content \`${c.id}\`** — ${c.type ?? c.format ?? "post"}`,
    c.published_at ? `- Published: ${c.published_at}` : null,
    c.url ? `- URL: ${c.url}` : null,
    `- Likes: ${fmtNum(e.like_count)}`,
    `- Comments: ${fmtNum(e.comment_count)}`,
    `- Shares: ${fmtNum(e.share_count)}`,
    `- Saves: ${fmtNum(e.save_count)}`,
    `- Views: ${fmtNum(e.view_count)}`,
    `- Organic impressions: ${fmtNum(e.impression_organic_count)}`,
    `- Organic reach: ${fmtNum(e.reach_organic_count)}`,
    `- Paid impressions: ${fmtNum(e.impression_paid_count)}`,
  ];
  return out.filter((x): x is string => x !== null).join("\n");
}

function formatComment(c: ApiComment): string {
  const who = c.commenter_display_name ?? c.commenter_username ?? "(anonymous)";
  const text = c.text.replace(/\s+/g, " ").trim().slice(0, 140);
  return `- **${who}** (👍${fmtNum(c.like_count)}, ↩${fmtNum(c.reply_count)}): ${text}`;
}
