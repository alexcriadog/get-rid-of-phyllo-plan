# ADR 0002: Single Docker image, three process types

**Status:** Accepted
**Date:** 2026-04-22
**Corresponds to:** D-02

## Context

The service needs three distinct workloads: HTTP API (OAuth callbacks + internal endpoints), async workers (platform fetchers), and scheduler (due-job enqueuer). Three questions: one process or many? One image or many?

## Decision

**One repository, one Docker image, three processes: `connector-api`, `connector-worker`, `connector-scheduler`. Same image, different command (`argv[2]` selects the entrypoint).** Three declarations in `docker-compose.yml`; independent replica counts.

## Alternatives considered

- **Monolith (single process)** — rejected; couples API latency to worker load; can't scale API separately.
- **Three separate repos, three separate images** — rejected; duplicates platform adapters, DB access, KMS, event code across repos. Version skew risk at runtime. Triples CI.
- **Microservices** — rejected; enormous overhead for 3 people. Platform adapters are the only thing that benefits from boundaries, and they're already encapsulated via the port interface.

## Consequences

**Positive:**
- API can scale (2→4 replicas) independently from workers (3→20 replicas).
- Scheduler is a distinct failure domain — API/worker crashes don't stop sync scheduling.
- Single codebase; adapters shared across all three processes.
- Single CI pipeline; single ECR push; lower deploy complexity.

**Negative:**
- Docker Compose has a slightly busier service list.
- Worker and scheduler ship with the HTTP layer they don't need (small image-size cost).

**Mitigations:**
- The image-size cost is marginal (~10MB) — fine at our scale.
- `argv`-based dispatch is documented in `main.ts` to prevent confusion.

## Related

- [`../02-architecture.md`](../02-architecture.md) §Component inventory
- [`../08-operations/deployment.md`](../08-operations/deployment.md) §Docker image
