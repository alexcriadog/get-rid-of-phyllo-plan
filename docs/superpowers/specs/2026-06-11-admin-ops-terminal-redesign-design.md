# Admin "Ops Terminal" Redesign — Design Spec

**Date:** 2026-06-11
**Status:** Approved by Alex (brainstorm 2026-06-11, visual companion session `.superpowers/brainstorm/61306-1781170840`)
**Scope owner:** poc/web (all surfaces), small additive poc/src endpoints

---

## 1. Context & goals

The connector's web UI (admin panel, account data explorer, client portal, public
pages) must become a world-class product surface: it is simultaneously the real
daily operations tool and the face shown publicly against competitors
(Phyllo/InsightIQ). The previous redesign round (branch `feat/admin-console-redesign`,
merged) delivered a capabilities-first IA, dual themes, and shadcn-style primitives —
solid but conventional. This redesign replaces convention with a distinctive,
opinionated product identity.

**Decisions made during brainstorm:**

| Question | Decision |
|---|---|
| Primary setting | Daily ops tool AND public face — every page beautiful and usable |
| Scope | Everything: `/admin`, `/account/[id]*`, `/client`, public pages |
| Brand | Camaleonic; grows the existing "Camaleonic Connect" favicon identity |
| Visual direction | **Mint Terminal** (chosen over Iridescent Command, Swiss Precision) |
| Structure | **Radical workbench** (chosen over reskin-in-place and mission-hub pages) |

## 2. Concept & architecture

### 2.1 The workbench

`/admin` becomes a single workbench surface ("Ops Terminal"). There are no fixed
admin pages. Every capability is a **panel**: dockable, resizable, splittable,
closable, stackable into tabs. The tiling layout *is* the visual identity —
hairline borders act as the window manager.

- **Engine:** `dockview` (battle-tested VS Code-style docking for React) — do not
  hand-roll docking. Panels are plain React components.
- **Data:** panels consume existing admin REST endpoints through the existing
  `useLive`/SWR polling layer and the Next proxy. No data-layer rewrite.
- **Mobile (<1024px):** stacked single-panel mode with a panel switcher; decks
  become a vertical sequence. No tiling on small screens.

### 2.2 Decks (learnability)

A **deck** is a named, preset panel layout — the "pages" of this world. Ship four
defaults, each answering an operator question the old pages answered:

| Deck | Panels (default layout) | Replaces the job of |
|---|---|---|
| MORNING CHECK | vitals · needs-attention · live-activity (focused) · schedule · queues · tenant inspector | old Home |
| PIPELINE | schedule · queues · cadence · rate-limits+locks · activity (errors filter) | Operations group |
| INCIDENT | activity (errors) · queues/DLQ · rate-limits · raw inspector · vitals | ad-hoc triage |
| TENANT SERVICE | tenant directory · tenant inspector · account inspector · api keys · usage | Tenants group |

Users can rearrange any deck and save custom decks. Deck state persists to
localStorage (v1); named-deck sync to backend is a later option, not in scope.

### 2.3 URL model (deep-linkability)

- `/admin?deck=morning-check` restores a named deck.
- Custom layouts serialize to localStorage keyed by deck id; the URL carries deck
  id + focused panel only (keep URLs short).
- Object permalinks remain: `/admin/account/[id]`, `/admin/workspace/[slug]` open
  the workbench with that inspector panel focused.
- All 17 legacy admin routes 301-redirect to the equivalent deck/panel URL at
  cutover (Phase 5). Nothing 404s.

### 2.4 Command palette (⌘K)

The universal entry, built on `cmdk`:

- **Jump:** any account, workspace, queue, deck, panel.
- **Open:** any panel type into the current deck.
- **Act:** real mutations reusing existing endpoints — retry DLQ, pause/resume
  queue, trigger sync, copy reauth link, switch theme/workspace.
- Search index v1 assembles from existing list endpoints (accounts, workspaces,
  queues); a dedicated `/admin/search` endpoint is a later optimization.

## 3. Design system — "Mint Terminal"

### 3.1 Tokens

**Dark — terminal (default):**

| Token | Value | Use |
|---|---|---|
| bg | `#0e0e0e` | app background |
| surface | `#121212` | panel body |
| raised | `#1a1a1a` | hover lift, popovers |
| hairline | `#232323` / `#2a2a2a` | all borders |
| text | `#e6e6e6` | primary text |
| muted | `#999` / `#666` | secondary / tertiary |
| **mint** | `#3cffd0` | signal: ok, primary action, focus, brand |
| **UV** | `#5200ff` (tint `#b794ff`) | queued, info, secondary accent |
| warn | `#ffb224` | warnings |
| danger | `#ff5c5c` | errors, destructive |

**Light — paper terminal:** paper `#f4f2ec`, card `#fcfbf8`, ink `#1a1a1a`,
hairlines `#d8d5cc`, mint deepened to `#00b88a` (AA on paper), UV unchanged,
warn `#d97706`, danger `#dc2626`. Same geometry, same density.

**Platform tag colors (fixed, both themes):** IG `#ff6bcb` · TT `#8ef2dd` ·
YT `#ff5c5c` · LI `#7aa2ff` · TH `#ffb224` · FB `#5b8def` · TW (Twitch) `#a970ff`.
(Light theme may deepen for contrast; keep hue.)

Implementation: replace/extend the `--sh-*` HSL triplet system in
`styles/globals.css` + `tailwind.config.ts`; keep the no-flash theme script and
`lib/theme.tsx` mechanism as-is.

### 3.2 Typography

- **Space Grotesk** (700) — display numerals, panel headlines, hero.
- **JetBrains Mono** (400/700) — everything data: tables, feeds, labels, badges.
- Loaded via `next/font` (Google), subset latin, `display: swap`. Two families max.
- Signature: uppercase tracked labels (10–11px, `letter-spacing: .12em`),
  `⫿` glyph prefix on panel titles.

### 3.3 Geometry, motion, states

- Radius 0 (sharp corners), 1px hairlines, 4px spacing grid, dense.
- Flat surfaces; the only shadow/glow is the mint focus ring on the active panel.
- Motion: 120–160ms ease-out, `transform`/`opacity` only; live rows pulse subtly;
  `prefers-reduced-motion` disables pulses/transitions.
- Hover = raised surface; press = inverted (mint bg, black text); focus = mint ring.
- Loading: ASCII-flavored skeletons (`▮▮▮▯▯ loading…`, blinking cursor), not gray
  boxes. Empty states are terminal prompts with a suggested action.

### 3.4 Primitives (~12, in `components/term/`)

`PanelChrome` (title bar: ⫿ label, controls, filter slot) · `TermTable` (dense,
virtualized option) · `StatBlock` (big numeral + delta) · `PlatformTag` ·
`ActionChip` (uppercase bordered button) · `FeedLine` · `MiniBar` / `Sparkline` /
`Gauge` (mint/UV, mono axes) · `CmdPalette` · `DeckTabs` · `StatusBar` ·
`Drawer` (in-panel detail) · `TermInput`. Every panel composes these — no bespoke
one-off styling per panel. Existing `components/ui/*` (shadcn) primitives are
retired surface-by-surface as panels migrate.

## 4. Panel catalog

| Panel | Absorbs (legacy route) | Notes |
|---|---|---|
| System Vitals | `system-health` + header badge | store latencies, worker idle, syncs/24h |
| Live Activity | `calls`, `events`, `webhooks`, `webhook-deliveries`, `raw` | unified stream, facet filters (type/platform/tenant/status/time), detail drawer shows raw payload |
| Queues & DLQ | `queues` | depths, DLQ, retry/pause actions |
| Schedule | `next-runs` | next runs with countdown bars |
| Cadence | `cadence` | policy view/editor |
| Rate Limits & Locks | `rate-limits`, `throttle-locks` | one panel, two tabs |
| Needs Attention | (Home panel) | reauth/failing/DLQ/paused, deep-links |
| KPI Stats | `index` KPIs | syncs, success rate, headline usage |
| Tenant Directory | `workspaces` | list + search |
| Tenant Inspector | `workspaces/[slug]`, `api-keys` (tenant scope) | tabbed object view: overview, accounts, keys, usage, webhooks |
| Account Directory | `accounts` | global list + facets |
| Account Inspector | `accounts/[id]`, `accounts/[id]/sync-settings` | tabs: overview, sync settings, calls, link to Data Inspector |
| Capability Matrix | `support-matrix` | platform × product availability |
| Usage & Storage | `usage` | per-store usage |
| Runtime Settings | `settings` | effective runtime config |
| Raw Inspector | `raw` | standalone payload browser (also drawer in Activity) |

**Connect Studio** is the one non-panel: a full-screen guided takeover (wizard
needs room), launched from ⌘K or a deck button. Replaces the 974-line
`connect.tsx` with staged steps: platform gallery → credentials/seed → embed
preview → first sync with live progress.

## 5. Other surfaces (same world, page form)

- **Account Data Explorer** (`/account/[id]` + `posts|ads|mentions|reviews`):
  restyled as **Data Inspector** — identity strip (platform tag, canonical ID,
  token health), tabs: Overview / Content / Audience / Engagement / Ads /
  Mentions / Reviews. Charts in mint/UV with mono axes. The inner component is
  shared so it renders as a standalone page *and* as the Account Inspector
  panel's data tab.
- **Client Portal** (`/client`): NOT a workbench. Paper-terminal light-default,
  calm density: connected accounts, data freshness, webhook deliveries.
- **Public pages** (`/`, `/feed`, `/watchlist`): the "showroom" — same brand,
  hero backed by the real live activity feed, restyled lists. Final phase.

## 6. Data flow & backend (additive only)

- Panels reuse existing admin REST endpoints via `useLive` polling (existing
  POLL policy) through the Next proxy. Only mounted panels poll.
- **New endpoint:** `GET /admin/activity` — unified, cursor-paginated stream
  merging API calls + events + inbound webhooks + outbound deliveries
  server-side, with facet filters (`type`, `platform`, `workspace_id`, `status`,
  `since`/`until`). Backed by existing tables; no schema change.
  - Interim: the Activity panel may ship reading the 4 existing endpoints with a
    client-side merge, then switch to the unified endpoint. Do not let the
    interim become permanent.
- Palette actions reuse existing mutation endpoints (DLQ retry, queue
  pause/resume, sync trigger, reauth link). No new mutation endpoints in v1.
- Deck persistence: localStorage. No backend.

## 7. Error handling

- **PanelBoundary** (generalized from existing `ErrorBoundary`): a crashing or
  failing panel renders a terminal-style error block with retry inside its own
  chrome; the board never goes down with a panel.
- API unreachable → red status-bar state (`▮ API UNREACHABLE — retrying in Ns`)
  replacing the old full-width banner; panels show stale-data timestamps.
- Mutations are optimistic with rollback + status-bar toast on failure
  (`✗ retry dlq failed — rolled back`).
- `useLive` error backoff retained.

## 8. Performance

- Panel components lazy-load per type (`next/dynamic`); initial JS within the
  300kb-gz app budget (dockview ≈40kb gz, cmdk ≈10kb gz).
- Activity feed + large tables virtualized.
- Deck switch unmounts old panels (stops their polling).
- Fonts: 2 families, subset, `display: swap`, preload critical weights only.
- Compositor-only animation (`transform`/`opacity`).

## 9. Accessibility

- Keyboard-first: ⌘K palette; ⌘1–9 panel focus cycling; arrows within panels;
  every interactive element reachable; visible mint focus ring (never removed).
- Panels are `role="region"` + `aria-label`; activity feed `aria-live="polite"`;
  drawer/palette use proper dialog semantics (Radix/cmdk built-ins).
- Color never the sole carrier (status = dot + word; platform = tag + text).
- AA contrast both themes (mint on `#0e0e0e` ≈13:1; light-mode mint deepened to
  `#00b88a` ≈4.6:1 on paper).
- `prefers-reduced-motion` honored globally.

## 10. Testing

- **Build gates (every phase):** `tsc --noEmit` 0 errors, `next build` clean,
  all routes 200. (Repo convention; full ts-jest suite is too heavy locally —
  use transpile-only targeted specs.)
- **Unit:** token utilities, deck serialization/restore, activity merge logic,
  palette action registry.
- **E2E (Playwright):** deck switch restores layout; palette jump → panel
  focused; palette action → mutation fired + optimistic UI; panel
  open/close/resize persists across reload; legacy-route redirects; mobile
  stacked mode renders all panels.
- **Visual regression (Playwright screenshots):** each default deck × dark+light
  × 1440/1024/768/375 (768 and 375 render the stacked mobile mode, per the
  <1024px rule), plus Connect Studio steps and Data Inspector tabs.

## 11. Rollout phases (each ships build-green; old admin works until Phase 5)

1. **Foundation:** Mint Terminal tokens (extend `globals.css` /
   `tailwind.config.ts`), fonts, `components/term/` primitives. Old pages keep
   rendering on re-derived legacy tokens.
2. **Shell:** workbench at `/admin/terminal` — dockview integration,
   PanelChrome, DeckTabs, StatusBar, deck state + URL serialization, ⌘K palette
   (jump/open only), mobile stacked fallback.
3. **Core panels:** vitals, queues, schedule, needs-attention, KPI stats,
   live activity (interim client merge → unified endpoint), palette actions.
4. **Object panels:** tenant directory/inspector, account directory/inspector,
   capability matrix, usage, runtime settings, rate-limits+locks, cadence,
   raw inspector.
5. **Cutover:** Connect Studio takeover; workbench moves to `/admin`; 17 legacy
   routes 301; `AdminLayout` + legacy admin pages deleted.
6. **Data Inspector:** `/account/[id]*` restyle, shared with Account Inspector
   panel.
7. **Showroom:** client portal + public pages.

## 12. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Workbench learnability for new operators | Default decks as "pages"; deck tabs always visible; first-run opens MORNING CHECK; palette discoverable via visible ⌘K chip |
| dockview styling fights the aesthetic | dockview is headless-ish (CSS-variable themed); we own all chrome via PanelChrome; spike it in Phase 2 before committing panels |
| Bundle growth | per-panel dynamic import; budget check in CI (Phase 2 onward) |
| Mobile workbench impractical | dedicated stacked mode, not shrunken tiling |
| Activity unification needs backend work | interim client-side merge keeps Phase 3 unblocked |
| Daily-ops regression during migration | old admin untouched until Phase 5 cutover; redirects preserve every bookmark |

## 13. Out of scope (this redesign)

- Backend-dependent admin surfaces deferred previously (`ops/workers`,
  `ops/retention`, `settings/security`, `settings/env`) — still need endpoints;
  add as panels later.
- Named-deck server-side sync / multi-user deck sharing.
- Embed/connect modal theming (separate spec: 2026-05-26-connect-iframe-modal).
- Real-time push (SSE/WS) — polling stays; panel architecture is transport-agnostic
  so push can swap in later.

## 14. Reference mockups

Brainstorm artifacts (gitignored, local):
`.superpowers/brainstorm/61306-1781170840/content/` — `style-direction.html`
(three directions), `ia-restructure.html` (IA options), `workbench-concept.html`
(Morning Check deck + palette), `design-system.html` (token specimen).
