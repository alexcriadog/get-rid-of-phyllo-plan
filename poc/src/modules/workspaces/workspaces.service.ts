import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '@shared/database/prisma.service';
import { AesLocalService } from '@shared/crypto/aes-local.service';

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
    planTier: string;
  }): WorkspaceView {
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      branding: this.parseBranding(row.branding),
      planTier: row.planTier,
    };
  }

  private parseBranding(raw: unknown): WorkspaceBranding | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    return raw as WorkspaceBranding;
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
