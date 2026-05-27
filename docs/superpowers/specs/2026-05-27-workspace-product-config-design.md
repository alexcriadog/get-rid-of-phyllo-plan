# Per-workspace platform + product configuration

**Date:** 2026-05-27
**Status:** Approved (design)
**Owner:** Alex

## Problem

The set of data **products** a connected account can sync (`identity`, `audience`,
`engagement_new`, `stories`, `comments`, `mentions`, `ratings`, `ads`,
`engagement_deep`) is a fixed per-platform catalog (`PRODUCTS_BY_PLATFORM` in
`poc/src/modules/accounts/accounts.service.ts`, mirrored in
`connect-tool/lib/products.ts`). Every workspace gets the full catalog, and the
connect picker lets the end-user choose any of them.

We want each **workspace** to define, per platform, which products it offers (and
therefore which platforms it offers at all). Then, when an end-user connects an
account, they are only granted that workspace's products — the connect step shows
those products as a read-only list, and only those sync jobs are created.

## Goal

- A workspace can configure, per platform, the products it offers.
- Configuring products for a platform also means "offer this platform"; omitting a
  platform hides it from the connect chooser.
- At connect time the confirm step shows the workspace's products for the chosen
  platform as a **read-only list** (no per-account product picking) and seeds
  exactly those.
- The POC enforces the allow-list on seed (the real guarantee; UI is convenience).

## Non-goals

- **Narrowing OAuth scopes** per workspace. The OAuth consent keeps requesting the
  full platform scopes (as today); only the data products / sync jobs are limited.
  Scope narrowing is a documented phase-2 follow-up.
- Per-end-user or per-account product overrides. Config is per workspace.
- Changing cadence (still global per `[platform, product]`).

## Decisions (from brainstorming)

- **Picker behavior:** read-only list, no per-account choosing.
- **Granularity:** per-platform map (`platform → [products]`); platform presence
  also controls platform availability.
- **OAuth scopes:** unchanged (phase 2).
- **Storage:** new nullable `Workspace.products` JSON column (mirrors `branding`),
  not a normalized table, not folded into `branding`.
- **`identity`:** always implicitly included for any offered platform.
- **Default:** `null`/absent config → all env-enabled platforms, full catalog
  (backwards compatible).
- **Enforcement:** POC `seedAccount` intersects requested products with the
  workspace config — defense in depth.

## Data model

`Workspace.products Json?` — shape:

```jsonc
{
  "instagram": ["audience", "engagement_new"],
  "facebook":  ["audience", "ads"],
  "tiktok":    []            // offered, identity-only
  // platforms not present here are NOT offered
}
```

- Keys are `PlatformKey` (`facebook|instagram|youtube|tiktok|threads|twitch`).
- Values are product keys from that platform's catalog. Invalid keys for a
  platform are ignored. `identity` is auto-added on resolution (never required in
  the stored value).
- `null` / column absent → treat as "all env-enabled platforms, full catalog".
- Prisma migration adds the nullable column (safe `migrate deploy`; no backfill).

### Resolution helper (POC)

`resolveWorkspaceProducts(workspace, platform): string[] | null`
- If `workspace.products == null` → return `null` (meaning "no restriction, full
  catalog").
- Else if `platform` not a key → return `[]` (platform not offered).
- Else → `unique(['identity', ...stored[platform].filter(valid-for-platform)])`.

## Components & data flow

| Unit | Responsibility |
|------|----------------|
| `Workspace.products` column + `resolveWorkspaceProducts` | source of truth + resolution |
| `WorkspacesService` | read/write `products`; expose via internal endpoint |
| `PATCH /admin/workspaces/:slug/products` (admin-saas) | save config |
| Admin `/admin/workspaces/[slug]` Products card | configure per-platform toggles + product checkboxes |
| `GET /internal/workspaces/:slug/branding` (extended, additive) | also return `products` to connect-ui (no new endpoint) |
| `SessionContext.workspaceSlug` | lets confirm/picker resolve config after OAuth |
| `ConnectShell` chooser | show only configured platforms |
| `ConfirmClient` / `FacebookPagesClient` | render read-only product list |
| POC `seedAccount` | enforce: requested ∩ resolved (∪ identity) |

### Connect happy path

```
/connect (ws slug known) → fetch workspace config (branding + products)
  → chooser shows only configured platforms
  → user picks platform → "Login with X"
  → provider OAuth (full scopes, unchanged) → callback attaches ctx
     (now incl. workspaceSlug) to the session
  → confirm/page-picker resolves products = resolveWorkspaceProducts(ws, platform)
     → renders them READ-ONLY + Continue
  → seed-confirm/seed-pages POST those products
  → POC seedAccount intersects requested ∩ resolved → creates only those SyncJobs
```

## Admin UI

On `/admin/workspaces/[slug]`, a "Platforms & Products" card alongside Branding:
- One row per platform (`facebook, instagram, youtube, tiktok, threads, twitch`),
  each with an **enable** toggle.
- When enabled, show that platform's catalog products as checkboxes; `identity`
  is shown locked/always-on.
- Save → `PATCH /admin/workspaces/:slug/products` with the `Record<platform,
  string[]>` (only enabled platforms included). "Clear" removes the config
  (revert to defaults).

## Error handling / edge cases

- Workspace has config but the chosen platform isn't in it → connect treats it as
  not offered (chooser hides it; if reached directly, confirm shows "platform not
  available for this workspace" and the seed is rejected).
- Config present but a platform's product list is empty → identity-only.
- Unknown product keys in stored config → ignored on resolution.
- Legacy `branding.hide_platforms` → superseded by `products` when `products` is
  set; when `products` is null, `hide_platforms` still applies (back-compat).
- POC seed receives products beyond the allow-list → trimmed to the intersection;
  if the intersection is empty for a configured-but-empty platform, seed identity
  only (never zero — identity is mandatory).

## Testing

- **POC unit:** `resolveWorkspaceProducts` (null→null, missing platform→[],
  filters invalid, always adds identity); `seedAccount` enforcement (requested ⊃
  allowed → trimmed; no config → full catalog; un-offered platform → rejected).
- **POC integration:** `PATCH /admin/workspaces/:slug/products` round-trip;
  `/internal/workspaces/:slug/branding` returns `products`.
- **connect-ui unit:** chooser filtering by configured platforms; read-only
  product list rendering (keys → catalog labels).
- **Admin:** products editor save/clear round-trip.

## Rollout / compatibility

- Nullable column + null-means-default → zero impact on existing workspaces until
  someone configures one. The connect flow and seed behave exactly as today when
  `products` is null.
