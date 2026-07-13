# Data Guide — what we extract per platform

**Live explorer:** https://smconnector.camaleonicanalytics.com/data-guide
(operator login required once the unified login ships — see the auth plan).

The Data Guide is our Airtable-style capability matrix: for every InsightIQ-
shaped field it shows, per platform, whether we offer it (`✓`), offer it with a
caveat (`✓△`), or don't (`—`), plus a Products grid and a token-lifecycle table.
It is the "show the CEOs what we can extract" material.

## How to read it

- `✓` supported · `✓△` supported but may be empty (hover for the caveat) · `—` not offered.
- Capability is **declarative**: derived from the per-platform support matrices
  (`poc/src/modules/platforms/<platform>/<platform>.support-matrix.ts`) — the
  single source of truth — baked into `connect-tool/app/data-guide/guide.json`.

## Not the same as the admin Capability Matrix

The admin Ops Terminal has a **Capability Matrix** panel that reads the *live*
`GET /admin/support-matrix`. That is operator diagnostics. The public
`/data-guide` is the curated, shareable view. They are intentionally separate.

## Regenerating `guide.json`

The kit lives in `connect-tool/data-guide/`. `build.js` joins the field
universe (`seed-empirical.json`) + curated types/overrides with a
`capability-map.json` (support-matrices resolved through the mappers to
InsightIQ field names) and writes `../app/data-guide/guide.json`:

```bash
cd connect-tool/data-guide && node build.js
```

> ⚠️ **Review status (2026-07-13).** The guide is **accurate to its current
> InsightIQ-shaped taxonomy and the declared support matrices** — `build.js`
> reproduces the committed `guide.json` with no diff, and the matrices have not
> changed since it was built. Two things block extending it to *everything we
> now ship*, and neither is a mechanical regen:
>
> 1. **Broken regen pipeline.** `build.js` reads `capability-map.json`, but no
>    script regenerates it — `parse-support.js` writes a different-shaped
>    `capability.json` (platform→product→sourceKey) to a mockup path. The
>    resolver that pivots that into the table→field→platform, InsightIQ-named
>    `capability-map.json` is missing and must be reconstructed before the guide
>    can be rebuilt from source. Until then, edit capability via
>    `derived-overrides.json` (applied as an upgrade-only reconciliation) rather
>    than by regenerating.
> 2. **Our custom fields are outside the guide's taxonomy.** The Threads
>    max-capture fields (topic_tag, location, polls, GIF, link, spoiler) that
>    shipped to prod on 2026-07-10 are **not present in the field universe**
>    (`seed-empirical.json`) — they are Camaleonic extensions, not standard
>    InsightIQ fields, so they cannot appear until someone decides how they map
>    into the guide's InsightIQ taxonomy (or adds a dedicated section) and gives
>    each a verified `supported` / `empty_possible` state. This is a curation
>    decision, deliberately not guessed here.
