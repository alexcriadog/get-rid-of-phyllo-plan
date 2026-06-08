// Basic-auth credential store for the Phyllo-compatible read API.
// The consumer authenticates exactly like Phyllo:
//   Authorization: Basic base64(client_id:client_secret)
// We persist only the SHA-256 of the secret and verify in constant time.

import { Injectable, Logger } from "@nestjs/common";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { PrismaService } from "@shared/database/prisma.service";

function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

export interface IssuedCredential {
  clientId: string;
  /** Returned ONCE on issue; only the hash is stored. */
  clientSecret: string;
  label: string | null;
  createdAt: string;
}

@Injectable()
export class PhylloCredentialsService {
  private readonly logger = new Logger(PhylloCredentialsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Issue a new (client_id, client_secret) pair for a workspace. */
  async issue(workspaceId: string, label?: string): Promise<IssuedCredential> {
    const clientId = `ciqk_${randomBytes(12).toString("hex")}`;
    const clientSecret = `ciqs_${randomBytes(24).toString("base64url")}`;
    const row = await this.prisma.phylloCompatCredential.create({
      data: {
        workspaceId,
        clientId,
        clientSecretHash: sha256Hex(clientSecret),
        label: label ?? null,
      },
    });
    return {
      clientId,
      clientSecret,
      label: row.label,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /**
   * Verify Basic-auth credentials. Returns the workspaceId on success, null
   * otherwise. Constant-time secret comparison; revoked credentials fail.
   */
  async verify(clientId: string, clientSecret: string): Promise<string | null> {
    const row = await this.prisma.phylloCompatCredential.findUnique({
      where: { clientId },
    });
    if (!row || row.revokedAt) return null;
    const expected = Buffer.from(row.clientSecretHash, "utf8");
    const actual = Buffer.from(sha256Hex(clientSecret), "utf8");
    if (
      expected.length !== actual.length ||
      !timingSafeEqual(expected, actual)
    ) {
      return null;
    }
    // Best-effort last-used stamp (don't block the request on it).
    this.prisma.phylloCompatCredential
      .update({ where: { clientId }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);
    return row.workspaceId;
  }
}
