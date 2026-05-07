// Global FB Watchlist — search + snapshot any public Page using ONLY the
// app access token (META_APP_ID|META_APP_SECRET). No per-user or per-page
// token required because PPCA (Page Public Content Access) is granted at
// the app level. Snapshots are global; we drop the old `owner_account_id`
// scoping that came from the per-account UI.

import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import {
  MONGO_COLLECTIONS,
  MongoService,
} from '@shared/database/mongo.service';

const GRAPH_BASE = 'https://graph.facebook.com/v22.0';
const POSTS_PER_PAGE = 12;

// Most fields are public per the Page reference; some (rating_count,
// overall_star_rating, hours, …) only return for Pages that publish them
// — the API silently omits absent fields.
const PAGE_FIELDS = [
  'id',
  'name',
  'username',
  'about',
  'description',
  'bio',
  'fan_count',
  'followers_count',
  'talking_about_count',
  'were_here_count',
  'category',
  'category_list',
  'link',
  'verification_status',
  'is_verified',
  // is_published / supports_instant_articles need pages_manage_*
  // permissions — skip; Pages Search API doesn't grant those.
  'picture.width(720).height(720)',
  'cover{source,offset_x,offset_y}',
  'location{city,country,state,zip,street,latitude,longitude}',
  'phone',
  'website',
  'emails',
  'company_overview',
  'founded',
  'mission',
  'products',
  'parent_page{id,name}',
  'rating_count',
  'overall_star_rating',
  'price_range',
].join(',');

const POST_FIELDS = [
  'id',
  'message',
  'story',
  'created_time',
  'permalink_url',
  'full_picture',
  'attachments{media_type,type,title,description,media,url}',
  'reactions.summary(true).limit(0)',
  'comments.summary(true).limit(0)',
  'shares',
].join(',');

const SEARCH_FIELDS = [
  'id',
  'name',
  'username',
  'category',
  'verification_status',
  'is_verified',
  'fan_count',
  'followers_count',
  'link',
  'picture.width(120).height(120)',
].join(',');

export interface SearchHit {
  id: string;
  name: string | null;
  username: string | null;
  category: string | null;
  verification_status: string | null;
  is_verified: boolean | null;
  fan_count: number | null;
  followers_count: number | null;
  link: string | null;
  picture_url: string | null;
  already_tracked: boolean;
}

export interface PublicPagePost {
  id: string;
  message: string | null;
  story: string | null;
  created_time: string | null;
  permalink_url: string | null;
  full_picture: string | null;
  attachments: unknown;
  reactions_total: number;
  comments_total: number;
  shares_total: number;
}

export interface WatchlistSnapshot {
  page_id: string;
  name: string | null;
  username: string | null;
  category: string | null;
  category_list: Array<{ id: string; name: string }> | null;
  about: string | null;
  description: string | null;
  bio: string | null;
  link: string | null;
  picture_url: string | null;
  cover_url: string | null;
  fan_count: number | null;
  followers_count: number | null;
  talking_about_count: number | null;
  were_here_count: number | null;
  verification_status: string | null;
  is_verified: boolean | null;
  location: Record<string, unknown> | null;
  phone: string | null;
  website: string | null;
  emails: string[] | null;
  company_overview: string | null;
  founded: string | null;
  mission: string | null;
  products: string | null;
  parent_page: { id: string; name: string } | null;
  rating_count: number | null;
  overall_star_rating: number | null;
  price_range: string | null;
  recent_posts: PublicPagePost[];
  captured_at: string | null;
  tracked_at: string | null;
}

@Injectable()
export class WatchlistService {
  private readonly logger = new Logger(WatchlistService.name);
  private readonly http: AxiosInstance;

  constructor(
    private readonly config: ConfigService,
    private readonly mongo: MongoService,
  ) {
    this.http = axios.create({
      baseURL: GRAPH_BASE,
      timeout: 20_000,
      validateStatus: () => true,
    });
  }

  private appToken(): string {
    const id = this.config.get<string>('META_APP_ID');
    const secret = this.config.get<string>('META_APP_SECRET');
    if (!id || !secret) {
      throw new BadRequestException(
        'META_APP_ID / META_APP_SECRET not configured — watchlist requires PPCA at the app level',
      );
    }
    return `${id}|${secret}`;
  }

  private async graphGet<T>(
    endpoint: string,
    params: Record<string, string | number>,
  ): Promise<T> {
    const res = await this.http.get(endpoint, {
      params: { ...params, access_token: this.appToken() },
    });
    if (res.status >= 400) {
      const msg =
        (res.data as { error?: { message?: string } })?.error?.message ||
        `Graph ${res.status}`;
      throw new BadRequestException(`Graph API: ${msg}`);
    }
    return res.data as T;
  }

  // ───────────────────────────────────────────────────────────── search

  async search(q: string, limit = 10): Promise<SearchHit[]> {
    if (!q || q.trim().length < 2) return [];
    const body = await this.graphGet<{
      data?: Array<Record<string, unknown>>;
    }>('/pages/search', {
      q: q.trim(),
      fields: SEARCH_FIELDS,
      limit: Math.min(Math.max(limit, 1), 25),
    });
    const hits = body.data ?? [];

    const ids = hits.map((p) => String(p.id ?? ''));
    const tracked = new Set<string>();
    if (ids.length > 0) {
      const col = this.mongo.getCollection(MONGO_COLLECTIONS.publicPageSnapshots);
      const docs = await col
        .find({ page_id: { $in: ids }, tracked_at: { $exists: true } })
        .project({ page_id: 1 })
        .toArray();
      for (const d of docs) tracked.add(String((d as { page_id?: string }).page_id ?? ''));
    }

    return hits.map((p) => {
      const pic = (p.picture as { data?: { url?: string } } | undefined)?.data?.url;
      return {
        id: String(p.id),
        name: (p.name as string) ?? null,
        username: (p.username as string) ?? null,
        category: (p.category as string) ?? null,
        verification_status: (p.verification_status as string) ?? null,
        is_verified: (p.is_verified as boolean) ?? null,
        fan_count: (p.fan_count as number) ?? null,
        followers_count: (p.followers_count as number) ?? null,
        link: (p.link as string) ?? null,
        picture_url: pic ?? null,
        already_tracked: tracked.has(String(p.id)),
      };
    });
  }

  // ───────────────────────────────────────────────────────────── snapshot

  async track(pageIdOrUsername: string): Promise<WatchlistSnapshot> {
    const meta = await this.graphGet<Record<string, unknown>>(
      `/${encodeURIComponent(pageIdOrUsername)}`,
      { fields: PAGE_FIELDS },
    );

    let posts: PublicPagePost[] = [];
    try {
      const postsBody = await this.graphGet<{ data?: Array<Record<string, unknown>> }>(
        `/${encodeURIComponent(String(meta.id))}/posts`,
        { fields: POST_FIELDS, limit: POSTS_PER_PAGE },
      );
      posts = (postsBody.data ?? []).map((p) => ({
        id: String(p.id),
        message: (p.message as string) ?? null,
        story: (p.story as string) ?? null,
        created_time: (p.created_time as string) ?? null,
        permalink_url: (p.permalink_url as string) ?? null,
        full_picture: (p.full_picture as string) ?? null,
        attachments: p.attachments ?? null,
        reactions_total:
          ((p.reactions as { summary?: { total_count?: number } })?.summary?.total_count) ?? 0,
        comments_total:
          ((p.comments as { summary?: { total_count?: number } })?.summary?.total_count) ?? 0,
        shares_total: ((p.shares as { count?: number })?.count) ?? 0,
      }));
    } catch (err) {
      this.logger.warn(
        `posts fetch failed for page ${meta.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    const now = new Date();
    const snap: WatchlistSnapshot = this.shape(meta, posts, now);

    const col = this.mongo.getCollection(MONGO_COLLECTIONS.publicPageSnapshots);
    // Mongo refuses if the same field appears in $set and $setOnInsert.
    // tracked_at MUST come from $setOnInsert (first track only); strip it
    // from the wider $set payload built by `shape()`.
    const { tracked_at: _omit, ...rest } = snap;
    void _omit;
    await col.updateOne(
      { page_id: snap.page_id },
      {
        $set: {
          ...rest,
          captured_at: now,
          owner_account_id: null,
        },
        $setOnInsert: { tracked_at: now },
      },
      { upsert: true },
    );

    return snap;
  }

  async refresh(pageId: string): Promise<WatchlistSnapshot> {
    return this.track(pageId);
  }

  // ───────────────────────────────────────────────────────────── reads

  async list(): Promise<WatchlistSnapshot[]> {
    const col = this.mongo.getCollection(MONGO_COLLECTIONS.publicPageSnapshots);
    // tracked_at marks the global watchlist (legacy per-account rows lack it).
    const docs = await col
      .find({ tracked_at: { $exists: true } })
      .sort({ tracked_at: -1 })
      .toArray();
    return docs.map((d) => this.deserialize(d));
  }

  async get(pageId: string): Promise<WatchlistSnapshot | null> {
    const col = this.mongo.getCollection(MONGO_COLLECTIONS.publicPageSnapshots);
    const doc = await col.findOne({ page_id: pageId });
    return doc ? this.deserialize(doc) : null;
  }

  async untrack(pageId: string): Promise<{ removed: boolean }> {
    const col = this.mongo.getCollection(MONGO_COLLECTIONS.publicPageSnapshots);
    const res = await col.deleteOne({ page_id: pageId });
    return { removed: res.deletedCount > 0 };
  }

  // ───────────────────────────────────────────────────────────── helpers

  private shape(
    meta: Record<string, unknown>,
    posts: PublicPagePost[],
    now: Date,
  ): WatchlistSnapshot {
    const pic = (meta.picture as { data?: { url?: string } })?.data?.url;
    const cov = (meta.cover as { source?: string })?.source;
    return {
      page_id: String(meta.id),
      name: (meta.name as string) ?? null,
      username: (meta.username as string) ?? null,
      category: (meta.category as string) ?? null,
      category_list:
        (meta.category_list as Array<{ id: string; name: string }>) ?? null,
      about: (meta.about as string) ?? null,
      description: (meta.description as string) ?? null,
      bio: (meta.bio as string) ?? null,
      link: (meta.link as string) ?? null,
      picture_url: pic ?? null,
      cover_url: cov ?? null,
      fan_count: (meta.fan_count as number) ?? null,
      followers_count: (meta.followers_count as number) ?? null,
      talking_about_count: (meta.talking_about_count as number) ?? null,
      were_here_count: (meta.were_here_count as number) ?? null,
      verification_status: (meta.verification_status as string) ?? null,
      is_verified: (meta.is_verified as boolean) ?? null,
      location: (meta.location as Record<string, unknown>) ?? null,
      phone: (meta.phone as string) ?? null,
      website: (meta.website as string) ?? null,
      emails: (meta.emails as string[]) ?? null,
      company_overview: (meta.company_overview as string) ?? null,
      founded: (meta.founded as string) ?? null,
      mission: (meta.mission as string) ?? null,
      products: (meta.products as string) ?? null,
      parent_page:
        (meta.parent_page as { id: string; name: string }) ?? null,
      rating_count: (meta.rating_count as number) ?? null,
      overall_star_rating: (meta.overall_star_rating as number) ?? null,
      price_range: (meta.price_range as string) ?? null,
      recent_posts: posts,
      captured_at: now.toISOString(),
      tracked_at: now.toISOString(),
    };
  }

  private deserialize(doc: Record<string, unknown>): WatchlistSnapshot {
    const iso = (v: unknown): string | null => {
      if (v instanceof Date) return v.toISOString();
      if (typeof v === 'string') return v;
      return null;
    };
    return {
      page_id: String(doc.page_id),
      name: (doc.name as string) ?? null,
      username: (doc.username as string) ?? null,
      category: (doc.category as string) ?? null,
      category_list:
        (doc.category_list as Array<{ id: string; name: string }>) ?? null,
      about: (doc.about as string) ?? null,
      description: (doc.description as string) ?? null,
      bio: (doc.bio as string) ?? null,
      link: (doc.link as string) ?? null,
      picture_url: (doc.picture_url as string) ?? null,
      cover_url: (doc.cover_url as string) ?? null,
      fan_count: (doc.fan_count as number) ?? null,
      followers_count: (doc.followers_count as number) ?? null,
      talking_about_count: (doc.talking_about_count as number) ?? null,
      were_here_count: (doc.were_here_count as number) ?? null,
      verification_status: (doc.verification_status as string) ?? null,
      is_verified: (doc.is_verified as boolean) ?? null,
      location: (doc.location as Record<string, unknown>) ?? null,
      phone: (doc.phone as string) ?? null,
      website: (doc.website as string) ?? null,
      emails: (doc.emails as string[]) ?? null,
      company_overview: (doc.company_overview as string) ?? null,
      founded: (doc.founded as string) ?? null,
      mission: (doc.mission as string) ?? null,
      products: (doc.products as string) ?? null,
      parent_page: (doc.parent_page as { id: string; name: string }) ?? null,
      rating_count: (doc.rating_count as number) ?? null,
      overall_star_rating: (doc.overall_star_rating as number) ?? null,
      price_range: (doc.price_range as string) ?? null,
      recent_posts: (doc.recent_posts as PublicPagePost[]) ?? [],
      captured_at: iso(doc.captured_at),
      tracked_at: iso(doc.tracked_at),
    };
  }
}
