# ADR 0001: Deployment topology — dedicated EC2 per environment

**Status:** Accepted
**Date:** 2026-04-22
**Corresponds to:** D-01

## Context

The connector is a new service needing its own runtime environment. Four reasonable options exist: share backend-api's EC2, new dedicated EC2s, managed containers (ECS/Fargate), or serverless (Lambda).

Constraints:
- 1-2 backend devs + 1 infra engineer
- Existing ops model is Docker Compose on EC2 with GitHub Actions → ECR → SSM-driven deploys
- NF-10 requires infrastructure isolation from backend-api
- Scale target: 50 → 50k accounts without re-architecting

## Decision

**New dedicated EC2 per environment (dev + prod), Docker Compose stack, matching the existing backend-api ops pattern.**

## Alternatives considered

- **Same EC2 as backend-api** — rejected; violates NF-10 (shared failure domain) and saturates the host as load grows.
- **ECS Fargate** — rejected for launch; the team doesn't run Fargate today. Tooling, networking, observability patterns all differ. Migration later is straightforward (workload is already containerized).
- **Lambda + EventSchedule** — rejected; cold starts hurt OAuth callbacks (5s Meta timeout). Long-running workers don't fit Lambda's execution model. Over-engineered for the workload.

## Consequences

**Positive:**
- Isolated at process level from backend-api.
- Reuses the team's established ops muscle (SSM, compose, ECR).
- Vertical scaling covers up to ~20k accounts (t3.small → t3.medium → t3.large).
- Simple to operate; team can own incident response from day 1.

**Negative:**
- Two more EC2s to patch, monitor, back up (one per env).
- Horizontal scaling requires adding a load balancer later.
- Not the "cloud-native" option; some may view it as legacy.

**Mitigations:**
- When we reach ~20k accounts, evaluate ECS Fargate migration. Same Docker image, config-level change.
- Observability agents (Prometheus, Promtail) deployed on the EC2 same as backend-api.

## Related

- [`../02-architecture.md`](../02-architecture.md) §System topology
- [`../08-operations/deployment.md`](../08-operations/deployment.md)
