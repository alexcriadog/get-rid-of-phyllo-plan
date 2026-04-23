# Connector Service — Documentation

Canonical project documentation for the **connector service** that replaces Phyllo/InsightIQ as the data gateway between `backend-api` and five creator platforms (Instagram, Facebook, YouTube, Twitch, TikTok).

All docs are in English. All docs are living — updated in the same PR as the behavior they describe. If you touch code under `src/modules/platforms/<x>/` and do not touch `docs/07-platforms/<x>.md`, you owe an update.

## Organization

```
docs/
├── README.md                   (this file — index)
│
├── 00-overview.md              Project purpose, scope boundary, targets
├── 01-requirements.md          Normalized functional + non-functional requirements
├── 02-architecture.md          System architecture overview
├── 03-extensibility.md         ★ Visual schema — 3-axis scalability
├── 04-data-model.md            Prisma schema + field mapping
├── 05-api-contract.md          Internal REST v1 OpenAPI
├── 06-event-catalog.md         Event types, schemas, versioning
│
├── rate-limiting.md            Rate-limit strategy per platform (Q1)
├── ingestion-modes.md          Webhook vs polling matrix per platform (Q3)
├── refresh-cadence.md          Tiers, overrides, admin API (Q2)
├── manual-refresh.md           On-demand trigger design (Q4)
├── connection-portal.md        Where the Connect UI lives (Q5)
│
├── 07-platforms/               Per-platform deep dives
│   ├── instagram.md
│   ├── facebook.md
│   ├── youtube.md
│   ├── twitch.md
│   └── tiktok.md
│
├── 08-operations/              Running the system
│   ├── deployment.md
│   ├── observability.md
│   ├── runbook.md
│   └── security.md
│
├── 09-migration/               Phyllo → connector cutover
│   ├── cutover-plan.md
│   └── backend-api-changes.md
│
└── adr/                        Architecture Decision Records
    ├── 0001-ec2-topology.md
    ├── 0002-single-image-three-processes.md
    ├── 0003-bullmq-on-redis.md
    ├── 0004-dedicated-scheduler.md
    ├── 0005-signed-webhook-events.md
    ├── 0006-connector-db-on-shared-rds.md
    ├── 0007-kms-envelope-tokens.md
    ├── 0008-token-bucket-rate-limits.md
    ├── 0009-rate-limit-strategy.md
    ├── 0010-refresh-cadence-tiers.md
    ├── 0011-hybrid-ingestion.md
    ├── 0012-manual-refresh.md
    └── 0013-connection-portal-placement.md
```

## Reading order

**First-time reader:**
1. `00-overview.md` — what this is and why
2. `03-extensibility.md` — how it scales (visual)
3. `02-architecture.md` — the moving parts
4. `07-platforms/*.md` — deep dive into one platform of interest

**Developer implementing a feature:**
1. `04-data-model.md` — what you persist
2. `05-api-contract.md` — what you expose
3. `06-event-catalog.md` — what you emit
4. `rate-limiting.md` / `refresh-cadence.md` / `ingestion-modes.md` — operational constraints

**Operator debugging an incident:**
1. `08-operations/runbook.md` — common tasks and playbooks
2. `08-operations/observability.md` — what to look at
3. `07-platforms/<relevant>.md` — platform-specific quirks

## Conventions

- **Prose is short.** A sentence beats a paragraph. A diagram beats a page of prose.
- **Decisions are recorded as ADRs.** Everything else is living docs that may change with the code.
- **"Living" label** at the top of a doc means it is updated continuously (04, 05, 06 especially). Others are stable reference.
- **Code snippets are illustrative**, not literal. The source of truth for types and schemas is the codebase itself (Prisma schema, OpenAPI spec, Zod schemas in the shared contract package).
- **Cross-references** use relative links: `[see §rate-limiting](rate-limiting.md)`.

## How to contribute

1. Open the doc that most closely matches what you're changing.
2. Edit in the same PR as the code change.
3. If no doc matches, add a stub and link it from this README.
4. New architecture decisions → new ADR in `adr/`, numbered sequentially.

## Reference material

Legacy seed material lives in `../context/` (kept as a historical archive):
- `phyllo-replacement-requirements.md` — original Spanish/English requirements doc
- `phyllo-replacement-structure.md` — original structural proposal
- `current-backend-api-phyllo.md` — behavior of the current Phyllo integration
- `db-rds-mongo.md` — current database inventory

These are **not** maintained going forward. `docs/01-requirements.md` and `docs/02-architecture.md` are the canonical, English-normalized, maintained equivalents.
