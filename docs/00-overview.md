# 00 · Overview

**Status:** Living
**Last updated:** 2026-04-23

## Purpose

Replace Phyllo/InsightIQ as the data gateway between `backend-api` and creator platforms. The connector is an internal NestJS service that owns OAuth flows, token lifecycle, platform-API calls, data normalization, and event emission. It consumes nothing from `backend-api`; `backend-api` is the only caller.

Three reasons to build it:
1. **Cost** — Phyllo/InsightIQ subscription eliminated.
2. **Control** — platform roadmap, data products, cadences all in-house.
3. **Extensibility** — adding a platform or data product is days, not weeks.

## Scope

Five platforms, all with full official OAuth integration:

| Platform | Identity | Audience | Engagement | Live/Stories | Notes |
|---|---|---|---|---|---|
| Instagram | ✓ | ✓ | ✓ | ✓ (Stories 1h cadence) | Business via FB Page **and** IG Direct — both flows |
| Facebook | ✓ | ✓ | ✓ | — | Pages only |
| YouTube | ✓ | ✓* | ✓ | — | *Analytics requires `yt-analytics.readonly` scope |
| Twitch | ✓ | ⚠ lim | ✓ | ✓ (EventSub) | Audience data limited by platform |
| TikTok | ✓ | ⚠ lim | ✓ | — | Business/Creator API |

Data products in phase 1: **Identity, Audience, Engagement**. Phase 2 (not built, but architecture must accept): Comments, Income, Publish.

## Out of scope

- **X/Twitter** — handled 100% by the existing scraper. Not in the connector, ever.
- **Unofficial YouTube accounts** (no OAuth) — handled by the existing scraper. Official YouTube accounts go through the connector.
- **All business logic** — brand detection, paid-post detection, virality scoring, media→S3, multi-org visibility, bilingual notifications. Lives in `backend-api`.
- **Public/anonymous analytics** — creator discovery, public-profile scraping. Not this service.
- **BYOC (customer-provided credentials)** — all OAuth uses our platform apps.

## Responsibility boundary with `backend-api`

The new service **owns**:
- OAuth flows (initiate, callback, token refresh, revocation)
- Token encryption and storage (envelope-encrypted with KMS)
- Platform API calls + response normalization
- Sync scheduling, rate limiting, retries, DLQ
- Event emission with signed HMAC webhooks

The new service **never touches** (stays in `backend-api`):
- Organization / contract / visibility model
- Brand keyword matching, paid-hashtag detection, promotional-language regex
- Virality scoring, engagement-rate averaging
- Media durable copy to S3 (yt-dlp, TikAPI, RapidAPI, ffmpeg fallbacks)
- City → country resolution (Groq LLM call)
- MongoDB — `accounts`, `posts`, `accounts_stats_history`, `process_logs`, etc. remain owned by `backend-api`. Connector emits events; `backend-api` persists what it wants in Mongo.
- Bilingual notifications (token expiry cron, etc.)
- Scraper coexistence logic (connection_method handover)

**One-line rule:** platform-normalized data and events out; business enrichment, multi-org policy, durable media, and notifications stay in `backend-api`.

## Growth targets

| Horizon | Connected accounts | Structural change | Capacity change |
|---|---|---|---|
| Launch | ~50 | — | `t3.small` EC2, 1 API / 1 worker / 1 scheduler |
| 12 months | **5,000** | — | `t3.medium`, 3-5 workers |
| 24 months | ~20,000 | Optional: scheduler HA via leader lock | `t3.large` or 2×EC2 behind small LB, 10+ workers |
| 36 months | **50,000** | Optional: `connector` DB → dedicated RDS; optional ECS/Fargate | 20+ workers, multi-AZ RDS |

Promise: **no re-architecture on the curve.** Decisions hold at 50k; only capacity changes.

## Tenancy model

- **Single-tenant at the credentials level** — one set of platform app credentials per platform (Meta app, YouTube GCP project, TikTok app, Twitch app). No BYOC.
- **Multi-tenant at the data level** — a single connected creator account may be shared across multiple internal organizations. The connector stores the "owning" org (the one that initiated OAuth) and a many-to-many reference; `backend-api` enforces visibility policy.

## Links

- Detailed requirements: [`01-requirements.md`](01-requirements.md)
- Architecture overview: [`02-architecture.md`](02-architecture.md)
- Visual schema (start here): [`03-extensibility.md`](03-extensibility.md)
- Legacy source docs: [`../context/`](../context/)
