# ADR 0013: Connection portal — embedded in frontend-app + shared contract package

**Status:** Accepted
**Date:** 2026-04-23
**Corresponds to:** D-13

## Context

The Connect UI (platform picker + OAuth launcher + post-OAuth landing) needs a home. Team is 3 people. frontend-app is the only consumer at phase 1. Options span four: embedded in frontend-app, hosted portal served by connector, separate `connect-portal` repo, or monorepo.

Separately: connector and backend-api need shared TypeScript types for API + events to prevent silent drift.

## Decision

**Option A: Connect UI embedded in frontend-app. Three repos stay separate. Shared contract package `@camaleonic/connector-contract` published privately to GitHub Packages.**

- Frontend-app hosts platform picker + success/error landing pages.
- Connector exposes `POST /v1/connect/initiate` (returns OAuth URL) and `GET /oauth/callback/:platform` (handles redirect).
- Backend-api brokers — frontend never calls connector directly.
- Shared types + Zod schemas in a versioned npm package, published from connector's CI.

## Alternatives considered

- **B. Hosted portal from day 1** — rejected; one consumer in phase 1 doesn't justify a new subdomain + deploy target + ops burden.
- **C. Separate `connect-portal` repo** — rejected; premature. Same functionality, higher operational cost, no benefit today.
- **D. Monorepo (Turborepo/Nx/pnpm workspaces)** — rejected for 3-person team; build/CI complexity > shared-code benefit. Shared types fit in a small npm package without monorepo overhead.
- **Copy-paste types between repos** — rejected; silent drift risk; shared package is cheap insurance.
- **Frontend-app calls connector directly** — rejected; authz belongs in backend-api.

## Consequences

**Positive:**
- UX integrated with existing dashboard; no context switch for users.
- Minimal new infra.
- Shared contract package gives compile-time + runtime type safety across the boundary.
- Revisiting hosted portal later is additive — connector's endpoint doesn't change.

**Negative:**
- frontend-app learns platform names + logos + scope summary copy (acceptable).
- GitHub Packages needs auth configuration across repos (one-time).

**Mitigations:**
- Platform list in frontend-app is small and infrequently changed; not a maintenance burden.
- GitHub Packages auth is a solved problem (existing patterns in other Camaleonic repos apply).

## Related

- [`../connection-portal.md`](../connection-portal.md)
- [`../05-api-contract.md`](../05-api-contract.md) — endpoints frontend-app uses via backend-api
- [`../09-migration/backend-api-changes.md`](../09-migration/backend-api-changes.md) — shared package consumption
