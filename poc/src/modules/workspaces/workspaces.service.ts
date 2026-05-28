import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '@shared/database/prisma.service';
import { AesLocalService } from '@shared/crypto/aes-local.service';
import { resolveWorkspaceProducts } from './workspace-products';
import { PRODUCTS_BY_PLATFORM } from '../accounts/products.catalog';

const WORKSPACE_SECRET_BYTES = 32;
const DEMO_WORKSPACE_ID = 'wkspc_demo';

/**
 * Branding theme stored on `Workspace.branding`. Read by connect.camaleonic.io
 * to render the hosted OAuth landing in the client's colours. All fields are
 * optional; `null` branding means "use platform defaults".
 */
export interface WorkspaceBranding {
  logo_url?: string;
  primary_color?: string;
  secondary_color?: string;
  accent_color?: string;
  font_family?: string;
  title?: string;
  subtitle?: string;
  hide_platforms?: ReadonlyArray<string>;
  per_platform_label?: Record<string, string>;
}

export interface WorkspaceView {
  id: string;
  slug: string;
  name: string;
  branding: WorkspaceBranding | null;
  // Phase C: products is NOT NULL in the DB. The empty object `{}` is the
  // "no platforms enabled" sentinel; absence of a platform key in the
  // object means "that platform is not offered".
  products: Record<string, string[]>;
  // Operator-set per-product webhook delivery cadence. null → all products
  // default to "immediate". See data-event-dispatcher.service.ts for the
  // dispatch logic. Schema: Record<product, "immediate"|"hourly"|"daily">.
  webhookCadence: Record<string, string> | null;
  planTier: string;
}

/**
 * Workspace registry + lifecycle. Owns the per-tenant HMAC secret used to
 * sign SDK JWTs — the secret is auto-provisioned the first time the
 * workspace is touched, so callers never have to remember to bootstrap it.
 */
@Injectable()
export class WorkspacesService implements OnModuleInit {
  private readonly logger = new Logger(WorkspacesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aes: AesLocalService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Guarantee the demo workspace has a secret so the legacy connect-tool
    // path continues to work end-to-end on a fresh deploy.
    try {
      await this.ensureSecret(DEMO_WORKSPACE_ID);
    } catch (err: unknown) {
      this.logger.warn(
        `Demo workspace secret bootstrap skipped: ${describe(err)}`,
      );
    }
  }

  async findBySlug(slug: string): Promise<WorkspaceView> {
    const row = await this.prisma.workspace.findUnique({ where: { slug } });
    if (!row) {
      throw new NotFoundException(`Workspace not found: ${slug}`);
    }
    return this.toView(row);
  }

  async findById(id: string): Promise<WorkspaceView> {
    const row = await this.prisma.workspace.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundException(`Workspace not found: ${id}`);
    }
    return this.toView(row);
  }

  /**
   * Resolve this workspace's allowed products for a platform.
   * Returns [] if the platform isn't offered; ['identity', ...] otherwise.
   */
  async resolveProducts(workspaceId: string, platform: string): Promise<string[]> {
    const ws = await this.findById(workspaceId);
    return resolveWorkspaceProducts(ws.products, platform, PRODUCTS_BY_PLATFORM);
  }

  /**
   * Returns the workspace branding JSON (or null) for the hosted OAuth UI.
   */
  async getBranding(slug: string): Promise<WorkspaceBranding | null> {
    const ws = await this.findBySlug(slug);
    return ws.branding;
  }

  /**
   * Returns the raw HMAC secret bytes, generating + persisting one on first
   * access. The plaintext never leaves this method — callers receive it
   * and use it transiently to sign or verify a JWT.
   */
  async getSecret(workspaceId: string): Promise<Buffer> {
    await this.ensureSecret(workspaceId);
    const row = await this.prisma.workspaceSecret.findUnique({
      where: { workspaceId },
    });
    if (!row) {
      throw new NotFoundException(`Workspace secret missing: ${workspaceId}`);
    }
    return Buffer.from(this.aes.decrypt(row.secretCiphertext), 'utf8');
  }

  private async ensureSecret(workspaceId: string): Promise<void> {
    const existing = await this.prisma.workspaceSecret.findUnique({
      where: { workspaceId },
      select: { id: true },
    });
    if (existing) return;

    const ws = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true },
    });
    if (!ws) {
      // Don't auto-create a workspace just because a secret was requested —
      // that would silently mask configuration bugs.
      throw new NotFoundException(`Workspace not found: ${workspaceId}`);
    }

    const plaintext = randomBytes(WORKSPACE_SECRET_BYTES).toString('hex');
    const ciphertext = this.aes.encrypt(plaintext);
    await this.prisma.workspaceSecret.create({
      data: { workspaceId, secretCiphertext: ciphertext },
    });
    this.logger.log(`Provisioned workspace secret for ${workspaceId}`);
  }

  private toView(row: {
    id: string;
    slug: string;
    name: string;
    branding: unknown;
    products: unknown;
    webhookCadence: unknown;
    planTier: string;
  }): WorkspaceView {
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      branding: this.parseBranding(row.branding),
      products: this.parseProducts(row.products),
      webhookCadence: this.parseCadence(row.webhookCadence),
      planTier: row.planTier,
    };
  }

  private parseCadence(raw: unknown): Record<string, string> | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === 'string' && (v === 'immediate' || v === 'hourly' || v === 'daily')) {
        out[k] = v;
      }
    }
    return Object.keys(out).length > 0 ? out : null;
  }

  private parseBranding(raw: unknown): WorkspaceBranding | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    return raw as WorkspaceBranding;
  }

  private parseProducts(raw: unknown): Record<string, string[]> {
    // Phase C migration guarantees the DB stores a JSON object. Defensive
    // fallback to `{}` if a row somehow contains something else (e.g. a
    // future manual edit gone wrong) — better than crashing the service.
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (Array.isArray(v)) out[k] = v.filter((x): x is string => typeof x === 'string');
    }
    return out;
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
