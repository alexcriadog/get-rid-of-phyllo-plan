# Ops Terminal — Phase 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Mint Terminal design foundation — tokens, fonts, test infra, and the data-display primitives in `components/term/` — capped by a specimen page, without touching any existing page.

**Architecture:** New `--term-*` RGB-triplet CSS variables live alongside the existing `--sh-*` system in `styles/globals.css` (light values in `:root`, dark in `.dark` — same class mechanism, no ThemeProvider changes). Tailwind exposes them as `term-*`/`tag-*` colors. Primitives are small cva/cn components following the existing `components/ui/button.tsx` pattern, but in a new `components/term/` directory. A specimen page at `/admin/term-specimen` renders everything for visual verification in both themes.

**Tech Stack:** Next.js 14 (pages router), Tailwind, class-variance-authority, next/font (Space Grotesk + JetBrains Mono), Vitest + Testing Library (new).

**Spec:** `docs/superpowers/specs/2026-06-11-admin-ops-terminal-redesign-design.md` (§3 is this phase). Later phases (shell, panels, cutover, data inspector, showroom) get their own plans.

**Working directory for all commands:** `poc/web/`

---

### Task 1: Vitest + Testing Library infrastructure

poc/web has no test runner (repo backend uses ts-jest, which is too heavy — see memory note). Vitest is the lightweight standard for component/unit tests here.

**Files:**
- Modify: `poc/web/package.json` (devDeps + scripts)
- Create: `poc/web/vitest.config.mts`
- Create: `poc/web/test/setup.ts`
- Test: `poc/web/test/__tests__/infra.spec.tsx`

- [ ] **Step 1: Install dev dependencies**

Run: `npm i -D vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/jest-dom`
Expected: package.json devDependencies gains all five; install exits 0.

- [ ] **Step 2: Add npm scripts**

In `package.json` `"scripts"`, add (keep existing scripts):

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Create vitest config**

`vitest.config.mts`:

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    include: ['**/__tests__/**/*.spec.{ts,tsx}'],
    exclude: ['node_modules', '.next'],
  },
  resolve: {
    // Mirror tsconfig "@/*" → "./*"
    alias: { '@': path.resolve(__dirname, '.') },
  },
});
```

- [ ] **Step 4: Create test setup**

`test/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 5: Write the infra smoke test**

`test/__tests__/infra.spec.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

describe('test infra', () => {
  it('renders React into jsdom', () => {
    render(<button>ping</button>);
    expect(screen.getByRole('button', { name: 'ping' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run the test**

Run: `npm test`
Expected: 1 passed.

- [ ] **Step 7: Verify the type gate still passes**

Run: `npx tsc --noEmit`
Expected: 0 errors (vitest/jest-dom types resolve via the explicit imports).

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json vitest.config.mts test/
git commit -m "test(web): add vitest + testing-library infrastructure"
```

---

### Task 2: Mint Terminal tokens (`--term-*`) + Tailwind wiring

RGB triplets (not HSL) — derived 1:1 from the spec hex values, so no conversion can drift. Light values in `:root`, dark in `.dark`, exactly like the `--sh-*` system. Platform tag colors get deepened light-mode variants for AA contrast on paper.

**Files:**
- Modify: `poc/web/styles/globals.css` (append inside the existing `@layer base` block, after the `.dark` ruleset)
- Modify: `poc/web/tailwind.config.ts`

- [ ] **Step 1: Append term tokens to globals.css**

Inside the existing `@layer base { ... }`, after the `.dark { ... }` ruleset, add:

```css
  /* ── Mint Terminal (--term-*) — Ops Terminal design system v2.
     Spec: docs/superpowers/specs/2026-06-11-admin-ops-terminal-redesign-design.md §3.
     Bare R G B triplets so Tailwind's `rgb(var(--x) / <alpha-value>)` works.
     Light = "paper terminal"; .dark = "terminal" (the flagship). */
  :root {
    --term-bg: 244 242 236;        /* paper  #f4f2ec */
    --term-surface: 252 251 248;   /* card   #fcfbf8 */
    --term-raised: 255 255 255;
    --term-line: 216 213 204;      /* #d8d5cc */
    --term-line-2: 203 199 187;
    --term-text: 26 26 26;         /* ink #1a1a1a */
    --term-muted: 85 82 74;
    --term-faint: 138 134 120;
    --term-mint: 0 184 138;        /* #00b88a — AA on paper */
    --term-mint-ink: 252 251 248;  /* text on mint */
    --term-uv: 82 0 255;           /* #5200ff */
    --term-uv-tint: 124 58 237;
    --term-warn: 217 119 6;
    --term-danger: 220 38 38;
    --term-tag-ig: 214 31 134;
    --term-tag-tt: 14 159 132;
    --term-tag-yt: 217 38 38;
    --term-tag-li: 37 99 235;
    --term-tag-th: 180 83 9;
    --term-tag-fb: 29 78 216;
    --term-tag-tw: 124 58 237;
  }

  .dark {
    --term-bg: 14 14 14;           /* #0e0e0e */
    --term-surface: 18 18 18;      /* #121212 */
    --term-raised: 26 26 26;       /* #1a1a1a */
    --term-line: 35 35 35;         /* #232323 */
    --term-line-2: 42 42 42;       /* #2a2a2a */
    --term-text: 230 230 230;      /* #e6e6e6 */
    --term-muted: 153 153 153;
    --term-faint: 102 102 102;
    --term-mint: 60 255 208;       /* #3cffd0 */
    --term-mint-ink: 14 14 14;
    --term-uv: 82 0 255;
    --term-uv-tint: 183 148 255;   /* #b794ff */
    --term-warn: 255 178 36;       /* #ffb224 */
    --term-danger: 255 92 92;      /* #ff5c5c */
    --term-tag-ig: 255 107 203;    /* #ff6bcb */
    --term-tag-tt: 142 242 221;    /* #8ef2dd */
    --term-tag-yt: 255 92 92;
    --term-tag-li: 122 162 255;    /* #7aa2ff */
    --term-tag-th: 255 178 36;
    --term-tag-fb: 91 141 239;    /* #5b8def */
    --term-tag-tw: 169 112 255;    /* #a970ff */
  }
```

- [ ] **Step 2: Wire Tailwind colors, display font slot, and blink keyframe**

In `tailwind.config.ts` under `theme.extend.colors`, add after the existing `info` entry:

```ts
        term: {
          bg: 'rgb(var(--term-bg) / <alpha-value>)',
          surface: 'rgb(var(--term-surface) / <alpha-value>)',
          raised: 'rgb(var(--term-raised) / <alpha-value>)',
          line: 'rgb(var(--term-line) / <alpha-value>)',
          'line-2': 'rgb(var(--term-line-2) / <alpha-value>)',
          text: 'rgb(var(--term-text) / <alpha-value>)',
          muted: 'rgb(var(--term-muted) / <alpha-value>)',
          faint: 'rgb(var(--term-faint) / <alpha-value>)',
          mint: 'rgb(var(--term-mint) / <alpha-value>)',
          'mint-ink': 'rgb(var(--term-mint-ink) / <alpha-value>)',
          uv: 'rgb(var(--term-uv) / <alpha-value>)',
          'uv-tint': 'rgb(var(--term-uv-tint) / <alpha-value>)',
          warn: 'rgb(var(--term-warn) / <alpha-value>)',
          danger: 'rgb(var(--term-danger) / <alpha-value>)',
        },
        tag: {
          ig: 'rgb(var(--term-tag-ig) / <alpha-value>)',
          tt: 'rgb(var(--term-tag-tt) / <alpha-value>)',
          yt: 'rgb(var(--term-tag-yt) / <alpha-value>)',
          li: 'rgb(var(--term-tag-li) / <alpha-value>)',
          th: 'rgb(var(--term-tag-th) / <alpha-value>)',
          fb: 'rgb(var(--term-tag-fb) / <alpha-value>)',
          tw: 'rgb(var(--term-tag-tw) / <alpha-value>)',
        },
```

Replace `theme.extend.fontFamily` with (adds `display`, prepends the mono variable — legacy pages upgrade to JetBrains Mono intentionally):

```ts
      fontFamily: {
        display: ['var(--font-display)', 'Manrope', 'system-ui', 'sans-serif'],
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          'Inter',
          'Segoe UI',
          'Roboto',
          'Helvetica',
          'Arial',
          'sans-serif',
        ],
        mono: [
          'var(--font-mono)',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Monaco',
          'Consolas',
          'monospace',
        ],
      },
```

In `theme.extend.keyframes` add:

```ts
        'term-blink': {
          '0%, 49%': { opacity: '1' },
          '50%, 100%': { opacity: '0' },
        },
```

In `theme.extend.animation` add:

```ts
        'term-blink': 'term-blink 1.1s step-end infinite',
```

- [ ] **Step 2b: Extend the reduced-motion guard to animations**

The existing guard in `styles/globals.css` (~line 207) only neutralizes transitions; spec §9 requires animations (blink, pulse) silenced too. Replace the media query body with:

```css
@media (prefers-reduced-motion: reduce) {
  html.theme-ready * {
    transition: none !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
  }
}
```

- [ ] **Step 3: Verify gates**

Run: `npx tsc --noEmit && npm run build`
Expected: 0 type errors; build completes (tokens are additive, no page changed).

- [ ] **Step 4: Commit**

```bash
git add styles/globals.css tailwind.config.ts
git commit -m "feat(web): Mint Terminal --term-* tokens + tailwind wiring (Ops Terminal phase 1)"
```

---

### Task 3: Brand fonts via next/font

**Files:**
- Modify: `poc/web/pages/_app.tsx`

- [ ] **Step 1: Load Space Grotesk + JetBrains Mono and expose as CSS variables on `<html>`**

The variables go on `html` via a global style (not a wrapper div) so Radix portals — which mount on `<body>` — inherit them.

In `pages/_app.tsx`, add imports at the top:

```tsx
import { JetBrains_Mono, Space_Grotesk } from 'next/font/google';

const displayFont = Space_Grotesk({ subsets: ['latin'], weight: ['500', '700'], display: 'swap' });
const monoFont = JetBrains_Mono({ subsets: ['latin'], weight: ['400', '700'], display: 'swap' });
```

Inside the returned fragment, directly after `</Head>`, add:

```tsx
      {/* Font variables on <html> so Radix portals (mounted on body) inherit. */}
      <style jsx global>{`
        html {
          --font-display: ${displayFont.style.fontFamily};
          --font-mono: ${monoFont.style.fontFamily};
        }
      `}</style>
```

- [ ] **Step 2: Verify gates**

Run: `npx tsc --noEmit && npm run build`
Expected: 0 errors; build downloads/inlines the two Google font subsets.

- [ ] **Step 3: Commit**

```bash
git add pages/_app.tsx
git commit -m "feat(web): load Space Grotesk + JetBrains Mono via next/font"
```

---

### Task 4: `fmtStatNumber` — thin-space stat formatting

Extends the existing `lib/format.ts` (do NOT create a parallel format module).

**Files:**
- Modify: `poc/web/lib/format.ts` (append)
- Test: `poc/web/lib/__tests__/format.spec.ts`

- [ ] **Step 1: Write the failing test**

`lib/__tests__/format.spec.ts` (the group separator is U+202F — always written as the '\u202f' escape, never as a literal character):

```ts
import { describe, expect, it } from 'vitest';
import { fmtStatNumber } from '../format';

const NNBSP = '\u202f';

describe('fmtStatNumber', () => {
  it('groups thousands with narrow no-break space', () => {
    expect(fmtStatNumber(48204)).toBe(`48${NNBSP}204`);
    expect(fmtStatNumber(1234567)).toBe(`1${NNBSP}234${NNBSP}567`);
  });
  it('keeps small numbers ungrouped', () => {
    expect(fmtStatNumber(942)).toBe('942');
    expect(fmtStatNumber(0)).toBe('0');
  });
  it('handles negatives', () => {
    expect(fmtStatNumber(-48204)).toBe(`-48${NNBSP}204`);
  });
  it('renders em-dash for null/undefined/non-finite', () => {
    expect(fmtStatNumber(null)).toBe('—');
    expect(fmtStatNumber(undefined)).toBe('—');
    expect(fmtStatNumber(Number.NaN)).toBe('—');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- lib/__tests__/format.spec.ts`
Expected: FAIL — `fmtStatNumber` is not exported.

- [ ] **Step 3: Implement**

Append to `lib/format.ts`:

```ts
/**
 * Stat-block numeral: integer grouped with U+202F narrow no-break space
 * ("48 204") — the Mint Terminal signature numeral format. Decimals are
 * truncated; stats are counts.
 */
export function fmtStatNumber(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const sign = n < 0 ? '-' : '';
  const digits = Math.trunc(Math.abs(n)).toString();
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- lib/__tests__/format.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/format.ts lib/__tests__/format.spec.ts
git commit -m "feat(web): fmtStatNumber thin-space numeral formatting"
```

---

### Task 5: Platform tag registry

Canonical map of the 7 connector platforms (matches `poc/src/modules/platforms/`: facebook, instagram, linkedin, threads, tiktok, twitch, youtube) to tag abbr/label/color class.

**Files:**
- Create: `poc/web/lib/term/platforms.ts`
- Test: `poc/web/lib/term/__tests__/platforms.spec.ts`

- [ ] **Step 1: Write the failing test**

`lib/term/__tests__/platforms.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { PLATFORM_TAGS, platformTag } from '../platforms';

describe('platformTag', () => {
  it('maps every connector platform', () => {
    expect(Object.keys(PLATFORM_TAGS).sort()).toEqual([
      'facebook', 'instagram', 'linkedin', 'threads', 'tiktok', 'twitch', 'youtube',
    ]);
  });
  it('returns the spec for a known platform', () => {
    expect(platformTag('tiktok')).toEqual({ abbr: 'TT', label: 'tiktok', className: 'text-tag-tt' });
    expect(platformTag('instagram').abbr).toBe('IG');
  });
  it('falls back gracefully for unknown platforms', () => {
    expect(platformTag('myspace')).toEqual({ abbr: 'MY', label: 'myspace', className: 'text-term-muted' });
    expect(platformTag('')).toEqual({ abbr: '??', label: 'unknown', className: 'text-term-muted' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- lib/term/__tests__/platforms.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`lib/term/platforms.ts`:

```ts
export type PlatformId =
  | 'facebook'
  | 'instagram'
  | 'linkedin'
  | 'threads'
  | 'tiktok'
  | 'twitch'
  | 'youtube';

export interface PlatformTagSpec {
  abbr: string;
  label: string;
  /** Tailwind text color class — tag colors are theme-aware tokens. */
  className: string;
}

export const PLATFORM_TAGS: Record<PlatformId, PlatformTagSpec> = {
  instagram: { abbr: 'IG', label: 'instagram', className: 'text-tag-ig' },
  tiktok: { abbr: 'TT', label: 'tiktok', className: 'text-tag-tt' },
  youtube: { abbr: 'YT', label: 'youtube', className: 'text-tag-yt' },
  linkedin: { abbr: 'LI', label: 'linkedin', className: 'text-tag-li' },
  threads: { abbr: 'TH', label: 'threads', className: 'text-tag-th' },
  facebook: { abbr: 'FB', label: 'facebook', className: 'text-tag-fb' },
  twitch: { abbr: 'TW', label: 'twitch', className: 'text-tag-tw' },
};

export function platformTag(platform: string): PlatformTagSpec {
  const spec = PLATFORM_TAGS[platform as PlatformId];
  if (spec) return spec;
  return {
    abbr: platform ? platform.slice(0, 2).toUpperCase() : '??',
    label: platform || 'unknown',
    className: 'text-term-muted',
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- lib/term/__tests__/platforms.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/term/platforms.ts lib/term/__tests__/platforms.spec.ts
git commit -m "feat(web): platform tag registry for term primitives"
```

---

### Task 6: `PlatformTag` component

**Files:**
- Create: `poc/web/components/term/PlatformTag.tsx`
- Test: `poc/web/components/term/__tests__/PlatformTag.spec.tsx`

- [ ] **Step 1: Write the failing test**

`components/term/__tests__/PlatformTag.spec.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import PlatformTag from '../PlatformTag';

describe('PlatformTag', () => {
  it('renders the bracketed abbr', () => {
    render(<PlatformTag platform="tiktok" />);
    expect(screen.getByText('[TT]')).toBeInTheDocument();
  });
  it('appends the label when showLabel is set', () => {
    render(<PlatformTag platform="instagram" showLabel />);
    expect(screen.getByText('[IG] instagram')).toBeInTheDocument();
  });
  it('renders fallback for unknown platforms', () => {
    render(<PlatformTag platform="myspace" />);
    expect(screen.getByText('[MY]')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- components/term/__tests__/PlatformTag.spec.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`components/term/PlatformTag.tsx`:

```tsx
import { cn } from '@/lib/utils';
import { platformTag } from '@/lib/term/platforms';

interface PlatformTagProps {
  platform: string;
  showLabel?: boolean;
  className?: string;
}

export default function PlatformTag({ platform, showLabel = false, className }: PlatformTagProps) {
  const spec = platformTag(platform);
  return (
    <span className={cn('whitespace-nowrap font-mono text-xs', spec.className, className)}>
      {showLabel ? `[${spec.abbr}] ${spec.label}` : `[${spec.abbr}]`}
    </span>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- components/term/__tests__/PlatformTag.spec.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add components/term/PlatformTag.tsx components/term/__tests__/PlatformTag.spec.tsx
git commit -m "feat(web): PlatformTag term primitive"
```

---

### Task 7: `ActionChip` component

The term-world button: uppercase mono, radius 0, four variants (spec §3.3 states).

**Files:**
- Create: `poc/web/components/term/ActionChip.tsx`
- Test: `poc/web/components/term/__tests__/ActionChip.spec.tsx`

- [ ] **Step 1: Install user-event, then write the failing test**

Run: `npm i -D @testing-library/user-event`

`components/term/__tests__/ActionChip.spec.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ActionChip from '../ActionChip';

describe('ActionChip', () => {
  it('renders a button and fires onClick', async () => {
    const onClick = vi.fn();
    render(<ActionChip onClick={onClick}>retry dlq</ActionChip>);
    await userEvent.click(screen.getByRole('button', { name: 'retry dlq' }));
    expect(onClick).toHaveBeenCalledOnce();
  });
  it('applies the variant classes', () => {
    render(<ActionChip variant="destructive">purge</ActionChip>);
    expect(screen.getByRole('button', { name: 'purge' }).className).toContain('border-term-danger');
  });
  it('disables correctly', () => {
    render(<ActionChip disabled>noop</ActionChip>);
    expect(screen.getByRole('button', { name: 'noop' })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- components/term/__tests__/ActionChip.spec.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`components/term/ActionChip.tsx`:

```tsx
import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const actionChipVariants = cva(
  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-none font-mono text-[11px] font-medium uppercase tracking-[0.08em] transition-[background-color,border-color,color] duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-term-mint focus-visible:ring-offset-1 focus-visible:ring-offset-term-bg active:translate-y-px disabled:pointer-events-none disabled:opacity-40',
  {
    variants: {
      variant: {
        primary: 'bg-term-mint font-bold text-term-mint-ink hover:bg-term-mint/85',
        action: 'border border-term-mint text-term-mint hover:bg-term-mint hover:text-term-mint-ink',
        ghost: 'border border-term-line-2 text-term-muted hover:border-term-faint hover:text-term-text',
        destructive: 'border border-term-danger text-term-danger hover:bg-term-danger hover:text-term-bg',
      },
      size: {
        sm: 'h-6 px-2',
        md: 'h-7 px-3',
      },
    },
    defaultVariants: { variant: 'action', size: 'md' },
  },
);

export interface ActionChipProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof actionChipVariants> {}

const ActionChip = React.forwardRef<HTMLButtonElement, ActionChipProps>(
  ({ className, variant, size, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(actionChipVariants({ variant, size, className }))}
      {...props}
    />
  ),
);
ActionChip.displayName = 'ActionChip';

export default ActionChip;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- components/term/__tests__/ActionChip.spec.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add components/term/ActionChip.tsx components/term/__tests__/ActionChip.spec.tsx package.json package-lock.json
git commit -m "feat(web): ActionChip term primitive"
```

---

### Task 8: `StatBlock` component

**Files:**
- Create: `poc/web/components/term/StatBlock.tsx`
- Test: `poc/web/components/term/__tests__/StatBlock.spec.tsx`

- [ ] **Step 1: Write the failing test**

`components/term/__tests__/StatBlock.spec.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { getDefaultNormalizer, render, screen } from '@testing-library/react';
import StatBlock from '../StatBlock';
import { fmtStatNumber } from '@/lib/format';

// Testing-library's default normalizer collapses ALL whitespace (incl. U+202F)
// in DOM text to ASCII spaces before string comparison, so the numeral must be
// queried with a non-collapsing normalizer to match the real U+202F output.
describe('StatBlock', () => {
  it('renders label and thin-space formatted numeral', () => {
    render(<StatBlock label="syncs / 24h" value={48204} />);
    expect(screen.getByText('syncs / 24h')).toBeInTheDocument();
    expect(
      screen.getByText(fmtStatNumber(48204), {
        normalizer: getDefaultNormalizer({ collapseWhitespace: false }),
      }),
    ).toBeInTheDocument();
  });
  it('renders string values verbatim', () => {
    render(<StatBlock label="success" value="99.4%" />);
    expect(screen.getByText('99.4%')).toBeInTheDocument();
  });
  it('renders delta with direction arrow and sub text', () => {
    render(
      <StatBlock label="syncs" value={1} delta={{ text: '12% vs prev', tone: 'up' }} sub="stable" />,
    );
    expect(screen.getByText('▲ 12% vs prev')).toBeInTheDocument();
    expect(screen.getByText(/stable/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- components/term/__tests__/StatBlock.spec.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`components/term/StatBlock.tsx`:

```tsx
import { cn } from '@/lib/utils';
import { fmtStatNumber } from '@/lib/format';

export interface StatDelta {
  text: string;
  tone: 'up' | 'down' | 'flat';
}

interface StatBlockProps {
  label: string;
  value: number | string;
  delta?: StatDelta;
  sub?: string;
  className?: string;
}

const DELTA_ARROW: Record<StatDelta['tone'], string> = { up: '▲', down: '▼', flat: '—' };
const DELTA_CLASS: Record<StatDelta['tone'], string> = {
  up: 'text-term-mint',
  down: 'text-term-danger',
  flat: 'text-term-faint',
};

export default function StatBlock({ label, value, delta, sub, className }: StatBlockProps) {
  const display = typeof value === 'number' ? fmtStatNumber(value) : value;
  return (
    <div className={cn('font-mono', className)}>
      <div className="text-[10px] uppercase tracking-[0.12em] text-term-faint">{label}</div>
      <div className="font-display text-2xl font-bold leading-tight text-term-text">{display}</div>
      {(delta || sub) && (
        <div className="text-[11px] text-term-muted">
          {delta && (
            <span className={DELTA_CLASS[delta.tone]}>
              {DELTA_ARROW[delta.tone]} {delta.text}
            </span>
          )}
          {delta && sub ? ' · ' : ''}
          {sub}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- components/term/__tests__/StatBlock.spec.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add components/term/StatBlock.tsx components/term/__tests__/StatBlock.spec.tsx
git commit -m "feat(web): StatBlock term primitive"
```

---

### Task 9: `FeedLine` component

**Files:**
- Create: `poc/web/components/term/FeedLine.tsx`
- Test: `poc/web/components/term/__tests__/FeedLine.spec.tsx`

- [ ] **Step 1: Write the failing test**

`components/term/__tests__/FeedLine.spec.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import FeedLine from '../FeedLine';

describe('FeedLine', () => {
  it('renders time, platform tag, message and status', () => {
    render(
      <FeedLine time="12:04:11" platform="instagram" status={{ text: 'OK 142ms', tone: 'ok' }}>
        @glossier profile_sync
      </FeedLine>,
    );
    expect(screen.getByText('12:04:11')).toBeInTheDocument();
    expect(screen.getByText('[IG]')).toBeInTheDocument();
    expect(screen.getByText('@glossier profile_sync')).toBeInTheDocument();
    expect(screen.getByText('OK 142ms')).toBeInTheDocument();
  });
  it('applies the danger tone class to status', () => {
    render(
      <FeedLine time="12:03:39" status={{ text: 'ERR 429', tone: 'danger' }}>
        audience_demo
      </FeedLine>,
    );
    expect(screen.getByText('ERR 429').className).toContain('text-term-danger');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- components/term/__tests__/FeedLine.spec.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`components/term/FeedLine.tsx`:

```tsx
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import PlatformTag from './PlatformTag';

export type FeedTone = 'ok' | 'queued' | 'warn' | 'danger';

const TONE_CLASS: Record<FeedTone, string> = {
  ok: 'text-term-mint',
  queued: 'text-term-uv-tint',
  warn: 'text-term-warn',
  danger: 'text-term-danger',
};

interface FeedLineProps {
  time: string;
  platform?: string;
  status?: { text: string; tone: FeedTone };
  children: ReactNode;
  className?: string;
}

export default function FeedLine({ time, platform, status, children, className }: FeedLineProps) {
  return (
    <div className={cn('flex items-baseline gap-2 font-mono text-xs leading-7', className)}>
      <span className="shrink-0 text-term-mint">{time}</span>
      {platform && <PlatformTag platform={platform} />}
      <span className="min-w-0 flex-1 truncate text-term-text/90">{children}</span>
      {status && <span className={cn('shrink-0', TONE_CLASS[status.tone])}>{status.text}</span>}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- components/term/__tests__/FeedLine.spec.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add components/term/FeedLine.tsx components/term/__tests__/FeedLine.spec.tsx
git commit -m "feat(web): FeedLine term primitive"
```

---

### Task 10: `TermTable` component

Dense generic table. Virtualization is deliberately NOT here (Phase 3 adds it where row counts demand it — YAGNI now).

**Files:**
- Create: `poc/web/components/term/TermTable.tsx`
- Test: `poc/web/components/term/__tests__/TermTable.spec.tsx`

- [ ] **Step 1: Write the failing test**

`components/term/__tests__/TermTable.spec.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TermTable, { type TermColumn } from '../TermTable';

interface Row {
  id: string;
  name: string;
  status: string;
}

const columns: TermColumn<Row>[] = [
  { key: 'name', header: 'Account', render: (r) => r.name },
  { key: 'status', header: 'Status', align: 'right', render: (r) => r.status },
];
const rows: Row[] = [
  { id: 'a', name: '@glossier', status: 'live' },
  { id: 'b', name: '@nike', status: 'expired' },
];

describe('TermTable', () => {
  it('renders headers and cells', () => {
    render(<TermTable columns={columns} rows={rows} rowKey={(r) => r.id} />);
    expect(screen.getByText('Account')).toBeInTheDocument();
    expect(screen.getByText('@glossier')).toBeInTheDocument();
    expect(screen.getByText('expired')).toBeInTheDocument();
  });
  it('renders the terminal empty state', () => {
    render(<TermTable columns={columns} rows={[]} rowKey={(r: Row) => r.id} empty="no accounts" />);
    expect(screen.getByText(/no accounts/)).toBeInTheDocument();
  });
  it('fires onRowClick with the row', async () => {
    const onRowClick = vi.fn();
    render(<TermTable columns={columns} rows={rows} rowKey={(r) => r.id} onRowClick={onRowClick} />);
    await userEvent.click(screen.getByText('@nike'));
    expect(onRowClick).toHaveBeenCalledWith(rows[1]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- components/term/__tests__/TermTable.spec.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`components/term/TermTable.tsx`:

```tsx
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface TermColumn<T> {
  key: string;
  header: string;
  align?: 'left' | 'right';
  render: (row: T) => ReactNode;
}

interface TermTableProps<T> {
  columns: TermColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** Row key to highlight with the mint active accent. */
  activeKey?: string | null;
  empty?: string;
  className?: string;
}

export default function TermTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  activeKey,
  empty = 'no rows',
  className,
}: TermTableProps<T>) {
  if (rows.length === 0) {
    return (
      <div className="px-3 py-6 text-center font-mono text-xs text-term-faint">
        &gt; {empty} <span className="animate-term-blink">▮</span>
      </div>
    );
  }
  return (
    <table className={cn('w-full border-collapse font-mono text-xs', className)}>
      <thead>
        <tr className="border-b border-term-line">
          {columns.map((c) => (
            <th
              key={c.key}
              className={cn(
                'px-2 py-1.5 text-[10px] font-medium uppercase tracking-[0.1em] text-term-faint',
                c.align === 'right' ? 'text-right' : 'text-left',
              )}
            >
              {c.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const key = rowKey(row);
          const active = key === activeKey;
          return (
            <tr
              key={key}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn(
                'border-b border-term-line/60 last:border-b-0',
                onRowClick && 'cursor-pointer transition-colors duration-150 hover:bg-term-raised',
                active && 'border-l-2 border-l-term-mint bg-term-mint/5',
              )}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={cn('px-2 py-1.5 text-term-text', c.align === 'right' && 'text-right')}
                >
                  {c.render(row)}
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- components/term/__tests__/TermTable.spec.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add components/term/TermTable.tsx components/term/__tests__/TermTable.spec.tsx
git commit -m "feat(web): TermTable term primitive"
```

---

### Task 11: Term charts — `MiniBar`, `Sparkline`, `Gauge`

**Files:**
- Create: `poc/web/components/term/charts.tsx`
- Test: `poc/web/components/term/__tests__/charts.spec.tsx`

- [ ] **Step 1: Write the failing test**

`components/term/__tests__/charts.spec.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Gauge, MiniBar, Sparkline } from '../charts';

describe('MiniBar', () => {
  it('exposes meter semantics and clamps overflow to 100%', () => {
    render(<MiniBar value={150} max={100} />);
    const meter = screen.getByRole('meter');
    expect(meter).toHaveAttribute('aria-valuenow', '150');
    expect((meter.firstChild as HTMLElement).style.width).toBe('100%');
  });
  it('renders 0% for max=0', () => {
    render(<MiniBar value={5} max={0} />);
    expect((screen.getByRole('meter').firstChild as HTMLElement).style.width).toBe('0%');
  });
});

describe('Sparkline', () => {
  it('renders an svg path for 2+ points', () => {
    const { container } = render(<Sparkline points={[1, 5, 3]} />);
    expect(container.querySelector('svg path')).not.toBeNull();
  });
  it('renders nothing for fewer than 2 points', () => {
    const { container } = render(<Sparkline points={[1]} />);
    expect(container.querySelector('svg')).toBeNull();
  });
});

describe('Gauge', () => {
  it('shows label and rounded percentage', () => {
    render(<Gauge value={0.42} label="content queue" />);
    expect(screen.getByText('content queue')).toBeInTheDocument();
    expect(screen.getByText('42%')).toBeInTheDocument();
  });
  it('escalates tone at thresholds', () => {
    const { container } = render(<Gauge value={0.95} label="hot" />);
    expect(container.querySelector('.bg-term-danger')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- components/term/__tests__/charts.spec.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`components/term/charts.tsx`:

```tsx
import { cn } from '@/lib/utils';

export type ChartTone = 'mint' | 'uv' | 'warn' | 'danger';

const STROKE: Record<ChartTone, string> = {
  mint: 'rgb(var(--term-mint))',
  uv: 'rgb(var(--term-uv-tint))',
  warn: 'rgb(var(--term-warn))',
  danger: 'rgb(var(--term-danger))',
};

const FILL_CLASS: Record<ChartTone, string> = {
  mint: 'bg-term-mint',
  uv: 'bg-term-uv-tint',
  warn: 'bg-term-warn',
  danger: 'bg-term-danger',
};

export function MiniBar({
  value,
  max,
  tone = 'mint',
  className,
}: {
  value: number;
  max: number;
  tone?: ChartTone;
  className?: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <span
      role="meter"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className={cn('inline-block h-1 w-12 bg-term-raised align-middle', className)}
    >
      <span className={cn('block h-1', FILL_CLASS[tone])} style={{ width: `${pct}%` }} />
    </span>
  );
}

export function Sparkline({
  points,
  tone = 'mint',
  width = 120,
  height = 22,
  className,
}: {
  points: number[];
  tone?: ChartTone;
  width?: number;
  height?: number;
  className?: string;
}) {
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const step = width / (points.length - 1);
  const d = points
    .map((p, i) => {
      const x = (i * step).toFixed(1);
      const y = (height - 2 - ((p - min) / span) * (height - 4)).toFixed(1);
      return `${i === 0 ? 'M' : 'L'}${x},${y}`;
    })
    .join(' ');
  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      className={className}
    >
      <path d={d} fill="none" stroke={STROKE[tone]} strokeWidth="1.3" />
    </svg>
  );
}

export function Gauge({
  value,
  label,
  className,
}: {
  /** 0..1 — tone escalates: ≥0.7 warn, ≥0.9 danger. */
  value: number;
  label?: string;
  className?: string;
}) {
  const pct = Math.min(1, Math.max(0, value));
  const tone: ChartTone = pct >= 0.9 ? 'danger' : pct >= 0.7 ? 'warn' : 'mint';
  return (
    <div className={cn('font-mono', className)}>
      {label && (
        <div className="mb-1 flex justify-between text-[10px] uppercase tracking-[0.1em] text-term-faint">
          <span>{label}</span>
          <span>{Math.round(pct * 100)}%</span>
        </div>
      )}
      <MiniBar value={pct} max={1} tone={tone} className="w-full" />
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- components/term/__tests__/charts.spec.tsx`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add components/term/charts.tsx components/term/__tests__/charts.spec.tsx
git commit -m "feat(web): MiniBar/Sparkline/Gauge term chart primitives"
```

---

### Task 12: `TermInput` component

**Files:**
- Create: `poc/web/components/term/TermInput.tsx`
- Test: `poc/web/components/term/__tests__/TermInput.spec.tsx`

- [ ] **Step 1: Write the failing test**

`components/term/__tests__/TermInput.spec.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TermInput from '../TermInput';

describe('TermInput', () => {
  it('renders the prompt glyph and accepts typing', async () => {
    render(<TermInput placeholder="filter: platform=tiktok" />);
    expect(screen.getByText('>')).toBeInTheDocument();
    const input = screen.getByPlaceholderText('filter: platform=tiktok');
    await userEvent.type(input, 'queues');
    expect(input).toHaveValue('queues');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- components/term/__tests__/TermInput.spec.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`components/term/TermInput.tsx`:

```tsx
import * as React from 'react';
import { cn } from '@/lib/utils';

export type TermInputProps = React.InputHTMLAttributes<HTMLInputElement>;

const TermInput = React.forwardRef<HTMLInputElement, TermInputProps>(
  ({ className, ...props }, ref) => (
    <span
      className={cn(
        'inline-flex w-full items-center gap-1.5 border border-term-line-2 bg-term-bg px-2 font-mono text-xs text-term-text transition-colors duration-150 focus-within:border-term-mint',
        className,
      )}
    >
      <span aria-hidden="true" className="select-none text-term-mint">
        &gt;
      </span>
      <input
        ref={ref}
        className="h-7 w-full bg-transparent outline-none placeholder:text-term-faint"
        {...props}
      />
    </span>
  ),
);
TermInput.displayName = 'TermInput';

export default TermInput;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- components/term/__tests__/TermInput.spec.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add components/term/TermInput.tsx components/term/__tests__/TermInput.spec.tsx
git commit -m "feat(web): TermInput term primitive"
```

---

### Task 13: Specimen page

A living styleguide at `/admin/term-specimen` exercising every primitive in real markup — the visual verification surface for this phase and the reference for panel builders in Phases 2–3. It intentionally does NOT use `AdminLayout`; the term world stands on its own. (Removed or kept at Phase 5 cutover — decided then.)

**Files:**
- Create: `poc/web/pages/admin/term-specimen.tsx`

- [ ] **Step 1: Create the page**

`pages/admin/term-specimen.tsx`:

```tsx
import Head from 'next/head';
import type { ReactNode } from 'react';
import ThemeToggle from '@/components/ThemeToggle';
import ActionChip from '@/components/term/ActionChip';
import FeedLine from '@/components/term/FeedLine';
import PlatformTag from '@/components/term/PlatformTag';
import StatBlock from '@/components/term/StatBlock';
import TermInput from '@/components/term/TermInput';
import TermTable, { type TermColumn } from '@/components/term/TermTable';
import { Gauge, MiniBar, Sparkline } from '@/components/term/charts';
import { PLATFORM_TAGS } from '@/lib/term/platforms';

interface SpecimenRow {
  id: string;
  account: string;
  platform: string;
  status: 'live' | 'expired';
}

const TABLE_ROWS: SpecimenRow[] = [
  { id: '1', account: '@glossier', platform: 'instagram', status: 'live' },
  { id: '2', account: '@duolingo', platform: 'tiktok', status: 'live' },
  { id: '3', account: '@nike', platform: 'instagram', status: 'expired' },
];

const TABLE_COLUMNS: TermColumn<SpecimenRow>[] = [
  { key: 'account', header: 'Account', render: (r) => r.account },
  {
    key: 'platform',
    header: 'Platform',
    render: (r) => <PlatformTag platform={r.platform} showLabel />,
  },
  {
    key: 'status',
    header: 'Status',
    align: 'right',
    render: (r) => (
      <span className={r.status === 'live' ? 'text-term-mint' : 'text-term-danger'}>
        ● {r.status}
      </span>
    ),
  },
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="border border-term-line bg-term-surface">
      <div className="border-b border-term-line px-3 py-2 text-[10px] font-medium uppercase tracking-[0.12em] text-term-muted">
        ⫿ {title}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

export default function TermSpecimen() {
  return (
    <main className="min-h-screen bg-term-bg p-6 font-mono text-term-text lg:p-10">
      <Head>
        <title>Term Specimen — Camaleonic Connect</title>
      </Head>

      <header className="mb-8 flex items-center gap-4">
        <span className="grid h-8 w-8 place-items-center border-2 border-term-mint" aria-hidden="true" />
        <div>
          <h1 className="font-display text-xl font-bold tracking-tight">
            MINT TERMINAL <span className="text-term-mint">SPECIMEN</span>
          </h1>
          <p className="text-xs text-term-faint">Ops Terminal design system v2 — phase 1 primitives</p>
        </div>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="StatBlock">
          <div className="flex flex-wrap gap-8">
            <StatBlock label="syncs / 24h" value={48204} delta={{ text: '12% vs prev', tone: 'up' }} />
            <StatBlock label="success" value="99.4%" sub="stable" />
            <StatBlock label="needs attention" value={3} delta={{ text: '2 reauth · 1 DLQ', tone: 'down' }} />
          </div>
        </Section>

        <Section title="ActionChip">
          <div className="flex flex-wrap items-center gap-2">
            <ActionChip variant="primary">primary ▸</ActionChip>
            <ActionChip>action</ActionChip>
            <ActionChip variant="ghost">ghost</ActionChip>
            <ActionChip variant="destructive">destructive</ActionChip>
            <ActionChip disabled>disabled</ActionChip>
            <ActionChip size="sm">sm</ActionChip>
          </div>
        </Section>

        <Section title="PlatformTag">
          <div className="flex flex-wrap gap-3 text-sm">
            {Object.keys(PLATFORM_TAGS).map((p) => (
              <PlatformTag key={p} platform={p} showLabel />
            ))}
            <PlatformTag platform="myspace" showLabel />
          </div>
        </Section>

        <Section title="TermInput">
          <TermInput placeholder="filter: platform=tiktok status=err" />
        </Section>

        <Section title="FeedLine">
          <FeedLine time="12:04:11" platform="instagram" status={{ text: 'OK 142ms', tone: 'ok' }}>
            @glossier profile_sync
          </FeedLine>
          <FeedLine time="12:04:02" platform="linkedin" status={{ text: 'QUEUED', tone: 'queued' }}>
            token_refresh org:camaleonic
          </FeedLine>
          <FeedLine time="12:03:39" platform="tiktok" status={{ text: 'ERR 429 → backoff 2m', tone: 'danger' }}>
            @ryanair audience_demo
          </FeedLine>
          <div className="text-xs text-term-faint">
            tail -f · streaming<span className="animate-term-blink">▮</span>
          </div>
        </Section>

        <Section title="Charts">
          <div className="space-y-4">
            <div className="flex items-center gap-3 text-xs">
              <span className="w-24 text-term-muted">sync:profile</span>
              <MiniBar value={12} max={400} /> <span>12</span>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="w-24 text-term-muted">sync:content</span>
              <MiniBar value={347} max={400} tone="warn" /> <span>347</span>
            </div>
            <Sparkline points={[10, 14, 12, 22, 18, 30, 26, 34]} />
            <Gauge value={0.42} label="content queue" />
            <Gauge value={0.95} label="rate limit: tiktok" />
          </div>
        </Section>

        <Section title="TermTable">
          <TermTable columns={TABLE_COLUMNS} rows={TABLE_ROWS} rowKey={(r) => r.id} activeKey="2" />
        </Section>

        <Section title="Empty state">
          <TermTable
            columns={TABLE_COLUMNS}
            rows={[]}
            rowKey={(r: SpecimenRow) => r.id}
            empty="no accounts match"
          />
        </Section>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Verify the route serves**

Run: `npm run dev` (background), then `curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/admin/term-specimen`
Expected: `200`.

- [ ] **Step 3: Visual check, both themes**

Open `http://localhost:3001/admin/term-specimen`. Verify against spec §3: dark = near-black with mint/UV, sharp corners, hairlines; toggle theme → paper terminal with deepened mint; platform tags legible in BOTH themes; blink animation on cursors; Tab onto chips shows a mint focus ring. Stop the dev server after.

- [ ] **Step 4: Commit**

```bash
git add pages/admin/term-specimen.tsx
git commit -m "feat(web): term-specimen styleguide page (phase 1 verification surface)"
```

---

### Task 14: Final gates

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all suites pass (infra + format + platforms + 7 component suites).

- [ ] **Step 2: Type + build gates**

Run: `npx tsc --noEmit && npm run build`
Expected: 0 type errors; production build clean; `/admin/term-specimen` in the route list.

- [ ] **Step 3: Legacy regression spot-check**

Run: `npm run dev` (background), then:

```bash
for r in /admin /admin/queues /admin/accounts /admin/system-health; do
  echo "$r: $(curl -s -o /dev/null -w "%{http_code}" http://localhost:3001$r)"; done
```

Expected: all `200` — Phase 1 must not change any existing page's behavior (tokens are additive; the only shared-surface change is the mono font upgrade).

- [ ] **Step 4: Commit the checked-off plan**

```bash
git status --short   # expect clean except this plan file
git add docs/superpowers/plans/2026-06-11-ops-terminal-phase1-foundation.md
git commit -m "docs: check off ops-terminal phase 1 plan"
```

---

## Deferred to later phase plans (explicitly NOT here)

- Phase 6/7: remove the legacy "Verge" CDN font link (Anton / Space Grotesk / Space Mono) from `pages/_document.tsx` when the `/account/[id]*` and public pages are redesigned. Until then both font systems intentionally coexist: legacy surfaces render the CDN families (`--v-display`/`--v-sans`/`--v-mono`), term surfaces render the next/font families — font binaries only download where their family is actually used, so this is not a per-page double-load. (Raised in Task 3 quality review; removal now would break account-explorer typography and violate the Phase 1 no-behavior-change constraint.)
- Phase 2: dockview shell, `PanelChrome`, `DeckTabs`, `StatusBar`, `CmdPalette`, `Drawer`, deck/URL state, mobile stacked mode — needs the dockview spike first.
- Phase 3+: panels, unified activity endpoint, palette actions, redirects/cutover, Data Inspector, client portal, showroom.
- Playwright visual-regression harness (spec §10) — lands with Phase 2 when there are decks to screenshot.
