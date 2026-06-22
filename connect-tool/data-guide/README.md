# Data Guide — capability kit

The **Data Guide** explorer (`/data-guide`, rendered by
`connect-tool/app/data-guide/`) is a platform × product × field capability
matrix: for every InsightIQ-shaped field it shows, per platform, whether we
offer it (`✓`), offer it with a caveat (`✓△`), or don't (`—`), plus a
Products grid and a token-lifecycle table.

## Where capability comes from

Capability is **not** sampled from live data. It is derived from the team's
declarative per-platform support matrices:

```
poc/src/modules/platforms/<platform>/<platform>.support-matrix.ts
```

Each field in those matrices is tagged with one of three states, which map
directly to the explorer's tri-state cell:

| Support-matrix state | Cell  | Meaning                                  |
| -------------------- | ----- | ---------------------------------------- |
| `supported`          | `✓`   | offered                                  |
| `empty_possible`     | `✓△`  | offered, but may be empty (caveat shown) |
| `not_supported`      | `—`   | not offered                              |

Descriptions and `maturity` (e.g. `planned`) are **human-curated overrides**
layered on top of the matrices — they are documentation, not capability.

## Regenerating `app/data-guide/guide.json`

The data the page imports lives at `connect-tool/app/data-guide/guide.json`.
It is produced by the kit in this folder:

1. **`parse-support.js`** — parses the 7 `<platform>.support-matrix.ts` files
   into clean per-platform capability states, producing **`capability-map.json`**
   (support-matrices × mappers, resolved to InsightIQ field names).
2. **`derived-overrides.json`** — manual reconciliation for derived fields
   (upgrade-only) plus the caveat reasons shown in tooltips.
3. **`build.js`** — joins the field universe + `productsByPlatform` with
   `capability-map.json`, applies `derived-overrides.json`, attaches curated
   descriptions / data types (`field-types.json`) / maturity, and emits the
   final guide object.

Run them from this folder (`connect-tool/data-guide/`):

```bash
node parse-support.js   # → capability-map.json
node build.js           # → guide object (move/copy to ../app/data-guide/guide.json)
```

> Note: `build.js` currently writes the guide as `data-guide.js`
> (`window.DATA_GUIDE = …`) for the standalone HTML prototype. To refresh the
> Next.js page, take that same object and write it to
> `../app/data-guide/guide.json` (JSON, no `window.` wrapper). Keep the shape
> defined in `connect-tool/app/data-guide/types.ts` (`GuideData`).

## Shape

See `connect-tool/app/data-guide/types.ts` for the authoritative `GuideData`
type. In short:

```jsonc
{
  "generatedAt": "YYYY-MM-DD",
  "productsByPlatform": { "YouTube": ["identity", "audience", "…"] },
  "tables": {
    "Identity": {
      "product": "identity",
      "offered": { "YouTube": true, "…": false },
      "fields": [
        {
          "name": "full_name",
          "desc": "Full name of the user profile.",
          "type": "string",
          "family": "core",
          "maturity": "production",
          "support": { "YouTube": true, "…": false },
          "caveat": { "LinkedIn": "reason shown in the ✓△ tooltip" }
        }
      ]
    }
  },
  "audienceNote": "…"
}
```

The static **Tokens** tab data is curated separately, directly in
`connect-tool/app/data-guide/types.ts` (`TOKENS`).
