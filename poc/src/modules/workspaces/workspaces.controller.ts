import { Controller, Get, Param } from '@nestjs/common';
import { WorkspaceBranding, WorkspacesService } from './workspaces.service';

/**
 * Internal endpoints used by connect.camaleonic.io to render the OAuth
 * landing with per-workspace branding. The hosted UI fetches this on SSR
 * and feeds it into the tile renderer.
 *
 * NOT a public /v1/* surface — auth happens via the SDK JWT carried in the
 * popup URL once the SdkJwtGuard lands in Phase 3. For Phase 1 the route
 * is reachable to internal callers only.
 */
@Controller('internal/workspaces')
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Get(':slug/branding')
  async getBranding(
    @Param('slug') slug: string,
  ): Promise<{ slug: string; branding: WorkspaceBranding | null; products: Record<string, string[]> | null }> {
    const ws = await this.workspaces.findBySlug(slug);
    return { slug: ws.slug, branding: ws.branding, products: ws.products };
  }
}
