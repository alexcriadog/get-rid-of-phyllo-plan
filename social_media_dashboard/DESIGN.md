# Cassettine — Design system

Style brief reconstructed from the [Cassettine reference][ref] (a custom
mixtape / playlist creator). Use this file as the visual contract for the
`social_media_dashboard` UI.

[ref]: https://getdesign.md/design-md/cassettine

---

## 1. Concept & vibe

- **Genre**: Y2K + retro-cassette + early-rave flyers. Neo-brutalist with
  a pop, not industrial.
- **Mood**: Playful, loud, confident. The UI is a poster you can click.
- **Anti-patterns**: No gradients. No drop-shadow blur. No glass / blur
  effects. No subtle pastel palettes. No "professional SaaS" greys.
- **Always**: Flat saturated colour blocks, thick black outlines, hard
  offset shadows, chunky display type, sunburst / ray textures as
  background motif.

---

## 2. Colour palette

All colours are flat — no gradients. Sections are edge-to-edge **solid**
fills. Black is *the* hardline; white is reserved for negative space and
text on dark blocks.

| Token              | Hex        | Use                                                    |
| ------------------ | ---------- | ------------------------------------------------------ |
| `--ink`            | `#0B0B0B`  | All borders, text on bright fills, hard shadows         |
| `--paper`          | `#FFFFFF`  | Cards, modals, button surfaces, text on `--ink`        |
| `--yellow`         | `#F5EE2E`  | Primary section fill — energy / CTA blocks             |
| `--electric-blue`  | `#3A2BFF`  | Primary section fill — hero, navigation                |
| `--mint`           | `#3CFFB8`  | Section fill — "customize" / interaction blocks        |
| `--bubblegum`      | `#FF7FD3`  | Section fill — "share" / social blocks                 |
| `--lilac`          | `#A06CFF`  | Cassette label accent, secondary buttons               |
| `--tangerine`      | `#FF8B3C`  | Cassette label accent, badges                          |
| `--lime`           | `#C4F84A`  | Cassette label accent                                  |

### Rules

- Every full-bleed section picks **one** fill from `{yellow, electric-blue,
  mint, bubblegum}`. Stack contrasting blocks vertically — never blend.
- Headlines on bright fills (`yellow`, `mint`, `bubblegum`) are always
  `--ink`. Headlines on `--electric-blue` are always `--paper`.
- Accent colours (`--lilac`, `--tangerine`, `--lime`) appear only on
  decorative objects (cassette stickers, badges), never as section fills.

---

## 3. Typography

Two-family stack. The display face is **mandatory in caps**.

| Role         | Family                                          | Weight | Case          | Tracking | Notes                                 |
| ------------ | ----------------------------------------------- | ------ | ------------- | -------- | ------------------------------------- |
| Display      | `"Druk Wide", "Anton", "Bowlby One", sans-serif`| 900    | `UPPERCASE`   | `-0.01em`| Tight, chunky, condensed-ish. Heroic. |
| Section step | Same as Display                                 | 700    | `UPPERCASE`   | `0.18em` | Tiny — 11–13px — acts as a kicker.    |
| Body         | `"Geist", "Inter", system-ui, sans-serif`       | 400/500| Sentence      | normal   | 15–17px, generous leading (1.55).     |
| UI / labels  | Same as Body                                    | 500/600| Sentence      | normal   | 13–14px.                              |
| Mono         | `"Geist Mono", "Space Mono", ui-monospace`      | 400    | as-is         | normal   | Only inside `<pre>` / `<code>` blocks.|

### Scale (display / body)

```text
Hero       clamp(56px, 8vw, 96px)   / line-height 0.95
H1         clamp(40px, 5vw, 64px)   / line-height 1.0
H2         32px                     / line-height 1.1
H3         22px                     / line-height 1.25
Body lg    17px                     / line-height 1.55
Body       15px                     / line-height 1.55
Step kicker 12px                    / line-height 1
```

### Rules

- Display type only ever wraps over **two** lines. Headlines that need a
  third line should be edited shorter or shrunk.
- Never use display weight for body copy — it stops feeling like a poster.
- Mono is allowed for tape labels and inline IDs only.

---

## 4. Spacing scale

8-point base, but blocks of empty space are generous because every section
is its own poster panel.

```text
--space-1   4px
--space-2   8px
--space-3   12px
--space-4   16px
--space-5   24px
--space-6   32px
--space-7   48px
--space-8   64px
--space-9   96px
--space-10  128px
```

- Inner padding of a coloured section block: `clamp(64px, 8vw, 128px)` top
  and bottom; `clamp(24px, 6vw, 96px)` left and right.
- Gap between cassette / card cluster items: `--space-5` (24px) minimum.
- Form field gap: `--space-4`.

---

## 5. Border radius

Medium-chunky. Nothing pill-shaped unless explicitly a pill.

| Token            | Value | Use                                       |
| ---------------- | ----- | ----------------------------------------- |
| `--radius-card`  | `18px`| Cassette cards, modals, surface blocks    |
| `--radius-btn`   | `12px`| Rectangular buttons                       |
| `--radius-pill`  | `999px`| Tag pills, status chips, "Step 1" markers|
| `--radius-input` | `12px`| Text inputs, selects                      |

---

## 6. Borders & outlines

The outline is the design. Treat every interactive surface like a
sticker.

```css
--border-hair: 1.5px solid var(--ink);   /* dividers between blocks         */
--border-card: 3px solid var(--ink);     /* cards, modals, tape illustrations*/
--border-btn:  3px solid var(--ink);     /* all buttons + inputs            */
```

- Outlines are always `--ink`. Never a subtle grey, never a paler version
  of the fill.
- Focus state: outline doubles to `5px` and gains a `4px 4px 0` shadow in
  `--electric-blue` (always blue, regardless of the surrounding fill).

---

## 7. Shadows (neo-brutalist)

Hard offset, no blur, always `--ink`. The shadow IS the depth cue.

```css
--shadow-sm: 4px 4px 0 var(--ink);
--shadow-md: 6px 6px 0 var(--ink);
--shadow-lg: 10px 10px 0 var(--ink);
```

- Cards: `--shadow-md`.
- Buttons resting: `--shadow-sm`. Hover: shift `transform: translate(-2px,-2px)` and bump shadow to `--shadow-md`. Active: collapse to `transform: translate(2px,2px)` and shadow to `0 0 0`.
- Modals: `--shadow-lg`.
- Never blur. `box-shadow` with non-zero blur radius is banned.

---

## 8. Background motif — sunburst rays

Every coloured section has a faint white **sunburst** behind the content.
It anchors the era without being noisy.

```css
.sunburst {
  background-image: repeating-conic-gradient(
    from -20deg at 20% 30%,
    rgba(255, 255, 255, 0.12) 0deg 4deg,
    transparent 4deg 14deg
  );
}
```

Or use a static SVG: 24 white rays emanating from a single corner
(`top-left` or `bottom-right`), ~6% opacity, behind content.

- The motif sits on **every** coloured section (`--yellow`, `--mint`,
  `--bubblegum`, `--electric-blue`). On dark blue the rays are pure white
  at ~18% opacity; on light fills they're pure white at ~22%. They are
  always visible, never decorative-only.
- Never overlay the motif on top of cards / buttons — only on the section
  fill underneath.

---

## 9. Components

### 9.1 Section block

A full-bleed coloured rectangle that hosts one piece of content. Two-column
layout on desktop (label + headline on the left; product visual on the
right), one column on mobile.

```text
┌─────────────────────────────────────────────┐
│  STEP 2                                     │  ← kicker, 12px UPPERCASE
│  CUSTOMIZE YOUR                             │  ← display, hero scale
│  TAPE                                       │
│                                             │
│  Body copy goes here. Two short sentences   │
│  is the maximum.                            │
│                                             │
│              [cassette card art →]          │
└─────────────────────────────────────────────┘
```

### 9.2 Cassette card

The hero illustration. Reusable as a unit summary tile.

- Surface: `--paper` background, `--border-card`, `--radius-card`, `--shadow-md`.
- Cassette body: rounded rect inside, filled with one of the accent colours
  (`--lilac`, `--tangerine`, `--lime`, `--bubblegum`).
- Two black reels (circles, ~22px radius) centred on the cassette.
- Header strip: bold display caps label, e.g. `8-BIT VIBES`.
- Optional sticker tag in `--yellow`.

### 9.3 Button

```css
.btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 12px 22px;
  background: var(--paper);
  color: var(--ink);
  border: var(--border-btn);
  border-radius: var(--radius-btn);
  box-shadow: var(--shadow-sm);
  font-family: var(--font-display);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  cursor: pointer;
  transition: transform 80ms ease, box-shadow 80ms ease;
}
.btn:hover  { transform: translate(-2px, -2px); box-shadow: var(--shadow-md); }
.btn:active { transform: translate(2px, 2px);   box-shadow: 0 0 0 var(--ink); }

.btn--primary  { background: var(--yellow); }
.btn--accent   { background: var(--electric-blue); color: var(--paper); }
.btn--danger   { background: var(--bubblegum); }
.btn--ghost    { background: transparent; box-shadow: none; }
```

### 9.4 Pill / tag

Same outline rules, but pill-shaped and one line:

```css
.pill {
  padding: 6px 12px;
  border: 2px solid var(--ink);
  border-radius: var(--radius-pill);
  background: var(--paper);
  font: 600 12px/1 var(--font-body);
  text-transform: uppercase;
  letter-spacing: 0.1em;
}
.pill--step { background: var(--yellow); }      /* "STEP 1"            */
.pill--ready { background: var(--mint); }       /* status: connected   */
.pill--error { background: var(--bubblegum); }  /* status: needs_reauth*/
```

### 9.5 Input

```css
.input {
  width: 100%;
  padding: 12px 14px;
  background: var(--paper);
  color: var(--ink);
  border: var(--border-btn);
  border-radius: var(--radius-input);
  font: 500 15px var(--font-body);
  box-shadow: var(--shadow-sm);
}
.input:focus {
  outline: 0;
  box-shadow: 4px 4px 0 var(--electric-blue);
  border-color: var(--electric-blue);
}
```

### 9.6 Modal / dialog

```css
dialog {
  background: var(--paper);
  color: var(--ink);
  border: var(--border-card);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-lg);
  padding: 0;
  max-width: min(720px, 92vw);
}
dialog::backdrop { background: rgba(11, 11, 11, 0.6); }
```

The modal header strip is filled with `--yellow` (or another bright tone),
a `--border-hair` bottom border, and uses display-weight caps for the title.

### 9.7 Navigation / top bar

- Full-bleed background `--ink`.
- Brand wordmark in display caps, white text.
- Right side: user chip with `--mint` background, `--border-hair`, pill
  radius. Logout = ghost button.

---

## 10. Motion

Minimal but deliberate. Motion is mostly the *shadow snap* on press.

- Buttons: `translate` + `box-shadow` swap on hover/active (see 9.3). Total
  duration ≤120ms.
- Card hover (e.g. account cards): `transform: translate(-3px, -3px)`,
  shadow → `--shadow-lg`.
- Modal open: instant. No fade. No scale.
- No parallax. No scroll-triggered fades.
- Respect `@media (prefers-reduced-motion)` — disable transforms, keep
  hover colour changes only.

---

## 11. Iconography

- Use **outline icons** with a 2px stroke (Lucide / Feather). No filled
  glyphs.
- Platform logos (Spotify, Apple Music, IG, etc.) keep their brand colour
  on `--paper` backgrounds; recolour to `--ink` only on coloured fills.
- Recurring motif: cassette icon for empty states and section headers.

---

## 12. Imagery

- Photography of UI screenshots is allowed inside cassette frames or
  bordered cards only — never edge-bleed.
- Decorative SVGs: sunburst, halftone dots, stars (3-point, sharp).
- No stock photos of people. No abstract gradients.

---

## 13. Do / Don't

| Do | Don't |
| --- | --- |
| Stack full-bleed colour blocks | Mix two fills inside one section |
| Outline every interactive surface | Use subtle hairline borders |
| Hard offset black shadow | Soft blurred shadow |
| Display type IN CAPS for headlines | Title-case the hero display |
| Sunburst behind, never on top | Apply sunburst over text or cards |
| `translate` + shadow swap on click | Use scale or opacity for press states |

---

## 14. Implementation checklist

When porting an existing screen to Cassettine, work through this list:

- [ ] Replace every `box-shadow` with a hard `Npx Npx 0 var(--ink)` offset.
- [ ] Replace every grey border with `var(--border-hair)` or `var(--border-btn)`.
- [ ] Replace every gradient with a flat fill from §2.
- [ ] Swap headline font-family to the display stack from §3 and uppercase it.
- [ ] Inject the sunburst motif on each section background.
- [ ] Verify hover states use `translate` + shadow swap (no scale).
- [ ] Verify focus rings are `4px 4px 0 var(--electric-blue)`.
- [ ] Run through `prefers-reduced-motion` — motion still off, palette still on.

---

## 15. CSS variable bundle (drop-in)

Paste at the top of `style.css`:

```css
:root {
  /* palette */
  --ink:           #0b0b0b;
  --paper:         #ffffff;
  --yellow:        #f5ee2e;
  --electric-blue: #3a2bff;
  --mint:          #3cffb8;
  --bubblegum:     #ff7fd3;
  --lilac:         #a06cff;
  --tangerine:     #ff8b3c;
  --lime:          #c4f84a;

  /* type */
  --font-display: "Druk Wide", "Anton", "Bowlby One", "Archivo Black", sans-serif;
  --font-body:    "Geist", "Inter", system-ui, -apple-system, sans-serif;
  --font-mono:    "Geist Mono", "Space Mono", ui-monospace, monospace;

  /* radius */
  --radius-card:  18px;
  --radius-btn:   12px;
  --radius-pill:  999px;
  --radius-input: 12px;

  /* borders */
  --border-hair: 1.5px solid var(--ink);
  --border-card: 3px solid var(--ink);
  --border-btn:  3px solid var(--ink);

  /* shadows */
  --shadow-sm: 4px 4px 0 var(--ink);
  --shadow-md: 6px 6px 0 var(--ink);
  --shadow-lg: 10px 10px 0 var(--ink);

  /* spacing */
  --space-1: 4px; --space-2: 8px;  --space-3: 12px; --space-4: 16px;
  --space-5: 24px; --space-6: 32px; --space-7: 48px; --space-8: 64px;
  --space-9: 96px; --space-10: 128px;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--paper);
  color: var(--ink);
  font-family: var(--font-body);
  font-size: 16px;
  line-height: 1.55;
}

h1, h2, h3, .display {
  font-family: var(--font-display);
  font-weight: 900;
  letter-spacing: -0.01em;
  line-height: 1;
  text-transform: uppercase;
  margin: 0;
}
```
