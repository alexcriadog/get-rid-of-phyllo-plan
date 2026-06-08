import type { Platform } from "@modules/accounts/products.catalog";

/**
 * Everything a mapper needs to build the InsightIQ envelope around a piece of
 * normalized data. Sourced from the Prisma `accounts` row (+ workspace
 * end-user). Kept separate from the normalized payload so mappers stay pure.
 */
export interface SchemaContext {
  /** Our accounts table PK (BigInt as string). Drives all minted ids. */
  accountPk: string;
  /** Internal platform id (instagram, youtube, …). */
  platform: Platform;
  /** Workspace end-user identifier (nullable → synthetic fallback). */
  endUserId: string | null;
  /** End-user display name for the `user.name` envelope field. */
  endUserName: string | null;
  /** Account handle (accounts.handle) → platform_username / username. */
  platformUsername: string | null;
  /** Platform-native profile id (accounts.canonicalUserId) → external_id. */
  canonicalUserId: string | null;
  /** Row created_at (InsightIQ envelope created_at). */
  createdAt: Date;
  /** Row updated_at (InsightIQ envelope updated_at). */
  updatedAt: Date;
}
