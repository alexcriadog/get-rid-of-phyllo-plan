# ADR 0006: Connector database on existing RDS MySQL instance

**Status:** Accepted
**Date:** 2026-04-22
**Corresponds to:** D-06

## Context

Connector needs durable storage for accounts, encrypted tokens, sync state, event delivery ledger, audit. Team already runs MySQL on RDS via Prisma for backend-api's three DBs. Shape of connector data is relational with some JSON fields — clear relational fit.

## Decision

**New MySQL database `connector` on the existing RDS instance.** Separate user (`connector_user`), separate credentials, separate Prisma client. Logical isolation at the schema level; physical isolation deferred until measured need.

Complemented by D-14: raw platform responses go to S3 (not MySQL); MongoDB remains backend-api's responsibility.

## Alternatives considered

- **Reuse one of backend-api's existing DBs** — rejected; schema entanglement defeats the boundary.
- **New dedicated RDS instance** — rejected at launch; ~$30/month cost + one more DB to operate for zero observed benefit until interference happens.
- **DynamoDB / MongoDB for the connector** — rejected; wrong shape. We need joins, range scans on `next_run_at`, cheap secondary indexes. MySQL serves us on all three.

## Consequences

**Positive:**
- No new infrastructure.
- Team's existing tooling (Prisma, migrations, backup story) applies directly.
- Logical isolation via separate user + credentials — connector cannot touch backend-api's DBs and vice versa.
- Same-instance migration to dedicated RDS is a config-only change if contention ever observed.

**Negative:**
- Shares physical RDS resources with backend-api; noisy-neighbor risk under load.
- Backup/PITR coordination with backend-api (all four DBs restore from same instance snapshot).

**Mitigations:**
- Monitor connection pool, IOPS, CPU from sprint 0 with per-DB visibility.
- RDS migration playbook ready; trigger when metrics indicate interference.

## Related

- [`../04-data-model.md`](../04-data-model.md)
- D-14 two-tier storage (see plan file + `04-data-model.md` §Storage principle)
