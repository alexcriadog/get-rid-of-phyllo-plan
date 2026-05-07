// Global FB Watchlist endpoints. PPCA-backed; no per-user token required.
//
//   GET    /admin/watchlist                    list all tracked pages
//   GET    /admin/watchlist/search?q=…         Pages Search API (live)
//   GET    /admin/watchlist/:pageId            single snapshot detail
//   POST   /admin/watchlist                    body: { page }  → track + snapshot
//   POST   /admin/watchlist/:pageId/refresh    re-snapshot
//   DELETE /admin/watchlist/:pageId            untrack

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { WatchlistService } from './watchlist.service';

interface TrackBody {
  /** Page id, vanity username, or full Page URL. */
  page: string;
}

@Controller('admin/watchlist')
export class WatchlistController {
  constructor(private readonly watchlist: WatchlistService) {}

  @Get()
  async list(): Promise<Record<string, unknown>> {
    const items = await this.watchlist.list();
    return { items };
  }

  @Get('search')
  async search(
    @Query('q') q: string,
    @Query('limit') limitRaw?: string,
  ): Promise<Record<string, unknown>> {
    const limit = limitRaw ? Math.max(1, Math.min(25, Number(limitRaw))) : 10;
    const items = await this.watchlist.search(q ?? '', limit);
    return { items };
  }

  @Get(':pageId')
  async detail(
    @Param('pageId') pageId: string,
  ): Promise<Record<string, unknown>> {
    const snap = await this.watchlist.get(pageId);
    if (!snap) return { item: null };
    return { item: snap };
  }

  @Post()
  async track(
    @Body() body: TrackBody,
  ): Promise<Record<string, unknown>> {
    const raw = (body?.page ?? '').trim();
    if (!raw) throw new BadRequestException('page is required');
    // Accept full FB URLs by extracting the slug.
    const cleaned = raw
      .replace(/^https?:\/\/(www\.|m\.)?facebook\.com\//i, '')
      .replace(/^@/, '')
      .replace(/\/.*$/, '');
    const snap = await this.watchlist.track(cleaned);
    return { item: snap };
  }

  @Post(':pageId/refresh')
  async refresh(
    @Param('pageId') pageId: string,
  ): Promise<Record<string, unknown>> {
    const snap = await this.watchlist.refresh(pageId);
    return { item: snap };
  }

  @Delete(':pageId')
  async untrack(
    @Param('pageId') pageId: string,
  ): Promise<Record<string, unknown>> {
    return this.watchlist.untrack(pageId);
  }
}
