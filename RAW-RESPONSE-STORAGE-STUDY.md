# Raw Response Storage: MongoDB vs S3

**Date:** 2026-06-02
**Question:** Should `raw_platform_responses` (the archived raw bodies of every
platform API call) stay in MongoDB, or move to S3?
**Scope:** Analysis only — no code changes. Grounded in the current
implementation and measured prod data.

---

## TL;DR — Recommendation

**Move the blob to S3; keep a small metadata index in the operational DB
(hybrid).** Storing the full body inline in Mongo does not scale: at the
current rate it is ~10 MB/account/day, it is already ~100% of the Mongo
dataset, and the single prod box is 79% full at just **10 accounts**. The
access pattern (write on every call, read one blob at a time on demand) is the
textbook fit for object storage.

**One critical caveat:** raw bodies are written on *every* API call (~1,000
writes/account/day, ~9 KB each). A naïve "one S3 PUT per response" makes S3
**request fees**, not storage, the dominant cost (~$1.6k/mo at 10k accounts).
So S3 only wins if writes are **batched** (one object per sync-job run or an
hourly NDJSON rollup) — which cuts PUTs ~10–45×. With batching, S3 is both
cheaper and operationally far simpler at scale.

Pure Mongo is only defensible while tiny (today's PoC), and it is *already*
hitting the disk wall.

The schema already anticipates this: every row carries an unused
`s3uri_stub` field (`graph-raw-archive.ts`, `tiktok-raw-archive.ts`).

---

## Current state (measured 2026-06-02, prod)

| Metric | Value |
|---|---|
| `raw_platform_responses` documents | **150,334** |
| Collection storage size | **1.46 GB** |
| Avg document size | **9.21 KB** |
| Share of total Mongo dataset | ~**100%** (total Mongo dataSize ≈ 1.36 GB) |
| Accounts | **10** |
| Retention window | **14 days** (`MONGO_RAW_RETENTION_DAYS`, daily sweep on `fetchedAt`) |
| Prod EC2 root disk | **29 GB total, 23 GB used (79%), 5.2 GB free** |

Derived: **~1,074 writes/account/day**, **~10.4 MB/account/day**,
**~146 MB/account** resident in the 14-day window.

> The single EC2 hosts MySQL + Mongo + Redis on one 29 GB disk. Raw responses
> are essentially the whole database, and they alone will fill the disk at
> roughly **40–50 accounts**. This is a near-term wall, not a hypothetical.

### Projected resident volume (14-day steady state)

| Accounts | Resident raw data |
|---|---|
| 10 (today) | 1.46 GB |
| 100 | ~14.6 GB |
| 1,000 | ~146 GB |
| 10,000 | ~1.46 TB |
| 100,000 | ~14.6 TB |

---

## How raw responses are actually used

This is the deciding factor, so it is worth stating precisely.

**Write path (`persistRaw`** — `meta-graph/graph-raw-archive.ts`, shared by
facebook/instagram/threads/twitch/youtube/google-ads, plus
`tiktok-api/tiktok-raw-archive.ts`)**:**
- Fires on **every** platform HTTP call, success *and* 4xx/5xx.
- Fire-and-forget: a write failure logs a warning and never breaks a sync.
- Stores: `accountId`, `platform`, `endpoint`, `contentHash` (sha256),
  `sizeBytes`, `httpStatus`, `fetchedAt`, **`body`** (the full blob, inline),
  and `s3uri_stub: null`.

**Read path (only two, both admin-only):**
1. `listRawResponses` (admin `/raw` page) — `find(...).project({ body: 0 })`,
   sorted by `fetchedAt desc`, limit ≤ 200. **Explicitly excludes the body** —
   the browse view reads metadata only.
2. `getRawResponse(id)` — fetches **one** document (by `_id` or `contentHash`),
   **including** the body. On-demand, single-document, operator debugging.

Mappers reference raw only as a pointer (`RawArchiveRef = { collection,
contentHash }`), never the blob.

**Profile: write-heavy, append-only, read-rarely-and-one-at-a-time, never
scanned or aggregated by body content.** The queryable surface is the small
metadata (contentHash, endpoint, httpStatus, fetchedAt, accountId). The body
is a cold blob. This is precisely what object storage is designed for and what
a document DB is *over*-qualified (and over-priced) to hold at scale.

---

## Dimension-by-dimension comparison

| Dimension | MongoDB (inline body) | S3 (blob) + DB metadata |
|---|---|---|
| **Access-pattern fit** | Over-qualified: rich query engine wasted on write-once cold blobs | Ideal: PUT once, GET by key on demand |
| **Per-GB storage cost** (us-east-1) | EBS gp3 **$0.08/GB-mo** (the Mongo data volume) | S3 Standard **$0.023/GB-mo** (~3.5× cheaper) |
| **Per-write cost** | None (write hits EBS; IOPS in gp3 baseline) | **PUT $0.005/1k** — dominant at this write count unless batched |
| **Read cost** | None | GET $0.0004/1k; **egress free** S3→EC2 same region |
| **Scale ceiling (single node)** | Hard: 1.5 GB WiredTiger cache vs multi-GB→TB working set = cache thrash; backups balloon; competes for the 29 GB disk | Effectively unbounded; independent of the operational DB |
| **Operational DB health** | Raw growth bloats Mongo → slower snapshots, bigger backups, disk pressure | Mongo stays small (just snapshots + metadata) and fast |
| **Backups / DR** | Raw included in every Mongo backup (multi-TB) | S3 is already 11-nines durable + versioning/replication; no separate backup |
| **Retention** | Daily `deleteMany` by `fetchedAt` (works, but delete load on the hot DB) | **S3 lifecycle rule** expires objects automatically, zero app load |
| **GDPR erase** | Already handled (`eraseAccount` deletes the Mongo docs) | Adds a step: must also delete the account's S3 objects (prefix delete) |
| **Operational complexity** | One datastore; simplest | Adds aws-sdk, IAM role, bucket + lifecycle, a fetch indirection |
| **Consistency** | Read-after-write within Mongo | S3 is strongly read-after-write now, but the metadata↔blob link can dangle if one write fails |
| **Query on body content** | Possible (not used today) | Not possible without fetching (not needed today) |
| **Security** | Inside the VPC DB | Bucket must be private + SSE; one more surface to lock down |

---

## Cost models

Assumes us-east-1, 14-day retention, ~1,074 writes/account/day, ~9.2 KB/blob,
reads negligible (admin debugging only).

### At 10,000 accounts (~1.46 TB resident, ~322M writes/mo)

| Option | Storage | Requests | Notes |
|---|---|---|---|
| **Mongo inline** | 1.46 TB × $0.08 = **~$117/mo** (EBS) | $0 | …but a single node can't serve a 1.46 TB working set on 1.5 GB cache. Realistically needs a managed cluster (Atlas M40+/sharding) → **~$1,500–2,500/mo** all-in, plus multi-TB backups |
| **S3 naïve (1 PUT/response)** | 1.46 TB × $0.023 = **~$34/mo** | 322M PUT × $0.005/1k = **~$1,610/mo** | Request fees dominate — the trap |
| **S3 batched (≈1 object/sync-job, ~10× fewer PUTs)** | ~$34/mo | ~$160/mo | **~$195/mo** total |
| **S3 batched hourly (≈45× fewer PUTs)** | ~$34/mo | ~$36/mo | **~$70/mo** total |

### At 100,000 accounts (~14.6 TB)

- Mongo inline: storage ~$1.2k/mo on EBS but operationally requires a serious
  sharded/managed cluster → **multiple $k/mo**, multi-TB backups, real DBA load.
- S3 batched: storage ~$340/mo + batched PUTs ~$0.4–1.6k/mo (batch ratio
  dependent) → **~$0.7–1.9k/mo**, no cluster, lifecycle-managed retention.

**Takeaway:** storage cost favors S3 ~3.5×, but the headline is *operational*:
Mongo at TB scale forces a managed cluster; S3 does not. The one place S3 can
lose is **request fees on tiny per-call objects** — entirely solved by batching.

---

## Important caveats / nuances

1. **Request cost is the real S3 variable, not storage.** 9 KB blobs written
   ~1,000×/account/day make PUT fees dominate. Batching (one object per
   sync-job run, or an hourly per-account NDJSON rollup) is essentially
   mandatory for S3 to be cheap. This also means the current
   one-`persistRaw`-per-call shape would change to a buffered flush.

2. **14-day retention interacts badly with S3 IA/Glacier tiers.** S3
   Standard-IA has a 30-day minimum billing and Glacier a 90-day minimum — both
   *longer* than the 14-day window, so colder tiers would cost *more*, not less.
   Use **S3 Standard** (or One-Zone-IA if a single AZ is acceptable) with a
   14-day lifecycle-expiry rule. Don't tier.

3. **Do you even need every call?** A large share of raw bodies are
   uninteresting 200s that are never read. Archiving raw only for **errors +
   a sampled fraction of successes** (or compressing bodies — gzip on ~9 KB
   JSON typically saves 70–85%) would shrink *both* options dramatically and is
   orthogonal to the Mongo-vs-S3 choice. Worth considering regardless.

4. **GDPR erase gets a second store.** `AdminService.eraseAccount` currently
   purges the Mongo docs; with S3 it must also delete the account's objects
   (e.g. a per-account key prefix → bulk delete). Keep the metadata row in the
   DB so erase can enumerate what to delete.

5. **Dangling-pointer failure mode.** Today `persistRaw` is fire-and-forget; a
   failed Mongo write just drops the record. With the hybrid, a failed S3 PUT
   after a successful metadata insert (or vice-versa) leaves a dangling
   pointer. Mitigate by writing the blob first, then the metadata row with the
   final `s3uri`, and treating a missing object as "expired/unavailable" on read.

---

## Recommended design (hybrid) — for reference, not implemented here

- **Metadata stays in the DB** (Mongo or even a MySQL table): `accountId`,
  `platform`, `endpoint`, `contentHash`, `sizeBytes`, `httpStatus`,
  `fetchedAt`, and `s3uri` (the field already exists as `s3uri_stub`). The
  admin `/raw` list view is unchanged — it already reads metadata only.
- **Body goes to S3** under a key like
  `raw/{accountId}/{YYYY-MM-DD}/{contentHash}.json(.gz)`, ideally batched per
  sync-job run or hourly per account to control PUT count.
- **`getRawResponse`** resolves the `s3uri` and streams the object on demand
  (same-region egress is free).
- **Retention** becomes an S3 lifecycle rule (14-day expiry) instead of a daily
  `deleteMany` on the hot DB.
- **Erase** deletes the per-account S3 prefix alongside the metadata rows.

This decouples unbounded raw growth from the operational database, frees the
prod disk (raw is ~100% of it today), and keeps the queryable surface fast.

---

## Addressability — how do we locate the right raw?

A practical question that the storage choice must serve: *"give me the raw for
account A's post P on day X."* This section studies how raw is addressable
today and what the **best-possible** retrieval design looks like. It applies
equally to Mongo and S3 — addressability is about the **index + keys**, not
where the bytes sit.

### Key fact: a raw record is a whole response *page*, not a post

`persistRaw` stores one document per **API response** — a page of N items
(e.g. `/{ig-user-id}/media` returns ~25 posts + a paging cursor), not one
document per post. Today's raw doc is keyed/queryable only by
`{ accountId, fetchedAt }` (the sole index) plus `platform`, `endpoint`,
`httpStatus`, `contentHash`.

### Current state (and a real gap)

- **"Account A on day X"** works: query `{ accountId, fetchedAt: <day X> }`
  → the page(s) fetched that day → the post lives inside the body array.
- **"The exact raw for post P"** does **not** work today. The data model has a
  `rawResponse: { collection, contentHash }` pointer on each normalized record,
  but:
  - Facebook sets `contentHash = sha256(individual post)`, while the raw doc
    stores `contentHash = sha256(whole page)` → **the two never match**.
  - YouTube leaves it `''` (unpopulated).
  - `contentHash` is **not indexed** on the raw collection anyway.
  So the post→raw link is currently decorative. The only reliable path is
  "account + time window → scan the page bodies."

This is a property of page-level archiving, independent of Mongo vs S3.

### Design options for addressability

| Option | How you retrieve post P | Write cost | Notes |
|---|---|---|---|
| **A — Page objects + metadata index** | account+time → candidate page(s) → scan body | Low (1 write/page, batchable) | Works for "account/day"; post P still needs a scan. Minimal change. |
| **B — Page objects + per-post pointer** ✅ | post doc → `raw_ref{ s3uri, itemIndex }` → GET object → `body.data[itemIndex]` | Low | **Exact, O(1), one GET.** Fixes today's broken pointer. |
| **C — Per-item objects** | direct GET by deterministic key `…/{content_id}.json` | **High** (N writes/page → re-introduces the per-call PUT-cost problem) | Simplest retrieval but loses page fidelity (cursors, page-level errors), duplicates items seen in multiple pages. Overkill for rarely-read audit data. |
| **D — Content-addressed pages (dedup)** | via hash key `…/sha256/{hash}` | Lowest (identical pages dedup) | Great add-on: slow-changing responses (identity/audience re-fetched unchanged) collapse to one object. Combine with B. |

### Recommended "best possible" design: **B + D over the hybrid**

Page-level (or sync-job-batched) objects, content-addressed for dedup, with a
metadata index **and** a working per-post pointer:

1. **Object in S3**, gzipped, content-addressed:
   `raw/{platform}/{accountId}/{YYYY-MM-DD}/{sha256}.json.gz`
   - `accountId` prefix → cheap GDPR erase (`DELETE raw/{platform}/{accountId}/`) and clean retention partitioning.
   - date segment → S3 lifecycle expiry (14-day rule) with no app-side deletes.
   - `sha256` filename → identical pages written once (dedup).

2. **Metadata row** in the DB (the existing `raw_platform_responses` collection,
   minus the inline `body`, plus `s3uri`): `accountId, platform, endpoint,
   fetchedAt, httpStatus, sizeBytes, contentHash, s3uri, itemCount`. This is
   what the admin `/raw` list already reads (`project({ body: 0 })`) — unchanged.
   - Answers "account A on day X" via the existing `{ accountId, fetchedAt }`
     index → returns rows → each has `s3uri`.

3. **Per-post pointer** on each normalized record (`posts`/`*_snapshots`):
   `raw_ref = { s3uri, itemIndex }` — the page object the item came from plus
   its index in that page's array. Set at map time (you hold the page key right
   after the PUT, and the index as you iterate the page). This is the fix for
   today's mismatched-hash pointer.
   - Answers "exact raw for post P": read the post → `raw_ref.s3uri` → one S3
     GET → `body.data[itemIndex]`. O(1), no scan, no body indexing.

### Retrieval flows in the recommended design

```
"Account A, day X"   → DB: find({accountId:A, fetchedAt: day X})
                     → rows → s3uri(s) → GET object(s) → inspect pages

"Exact raw of post P"→ DB: posts.findOne({account_id, platform_content_id:P})
                     → data.raw_ref {s3uri, itemIndex}
                     → GET s3uri → body.data[itemIndex]   (one object, exact)

Admin /raw list      → DB metadata only (no S3 hit) — unchanged
```

### Why this is better than what exists, and store-agnostic

- It **fixes the broken pointer** (exact post→raw) that doesn't resolve today —
  a correctness win regardless of Mongo or S3.
- The **find step is always metadata** (DB index + the pointer); only the
  **fetch step** touches the blob store. So moving bodies to S3 changes nothing
  about *how you know which raw to grab* — you would implement the exact same
  index and pointer if you kept bodies in Mongo.
- Content-addressing + batching keep S3 PUT volume (the real cost driver) low,
  and the `accountId/date` key layout makes GDPR-erase and 14-day retention
  trivial (prefix delete / lifecycle rule).

**Net:** the best-possible addressability is "metadata index + per-post
`{ s3uri, itemIndex }` pointer + content-addressed page objects." It gives O(1)
exact retrieval, cheap browse-by-account/day, dedup, and clean erase/retention
— and it is the natural shape of the hybrid (S3 body + DB metadata), which is
why the hybrid is the recommended target.

---

## When pure-Mongo is the right call

- The deployment stays small (tens of accounts) **and** retention stays short —
  but note today's 10 accounts already fill 79% of the disk, so this window is
  effectively closed for production.
- You want exactly one datastore and zero AWS-IAM/bucket surface, and are
  willing to cap scale hard.
- You need ad-hoc queries *over body content* (not the case today).

For anything approaching production scale, **S3 (hybrid) is the better choice.**

---

## Bottom line

| | Verdict |
|---|---|
| **Small / PoC, short retention** | Mongo inline is simpler — but already at the disk limit |
| **Production scale (≥ a few hundred accounts)** | **S3 + DB metadata (hybrid), with batched writes + S3 Standard + 14-day lifecycle** |
| **Either way** | Consider sampling/compressing raw bodies — biggest single lever, independent of store |
