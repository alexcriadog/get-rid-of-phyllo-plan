// Build script for the CamaleonicConnect SDK.
//
// Outputs:
//   ../public/connect-sdk.js       — IIFE, minified, served from connect-ui
//   ../public/connect-sdk.d.ts     — sibling types for TS consumers
//   ./dist/index.mjs               — ESM build for npm consumers
//   ./dist/index.d.ts              — types for npm consumers
//
// Source of truth is sdk/src/index.ts. Run via `npm run build:sdk`.

import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const PUBLIC = resolve(ROOT, 'public');
const DIST = resolve(HERE, 'dist');

mkdirSync(DIST, { recursive: true });
mkdirSync(PUBLIC, { recursive: true });

const pkg = JSON.parse(readFileSync(resolve(HERE, 'package.json'), 'utf8'));
const banner = `/*! Camaleonic Connect SDK v${pkg.version} — ${new Date().toISOString().slice(0, 10)} */`;

// 1) IIFE for <script> tag consumers.
//    Exposes window.CamaleonicConnect = { init, version }.
await build({
  entryPoints: [resolve(HERE, 'src/index.ts')],
  outfile: resolve(PUBLIC, 'connect-sdk.js'),
  bundle: true,
  format: 'iife',
  globalName: '__CamaleonicConnectBundle',
  target: ['es2018'],
  minify: true,
  // No source map for the public bundle — we don't want to ship the full
  // TS source (and the sourceMappingURL comment that auto-loads it) to
  // every visitor. The dist/ build (for npm consumers) is unaffected.
  sourcemap: false,
  banner: { js: banner },
  footer: {
    // Promote the default export so `CamaleonicConnect.init(...)` works
    // exactly like the legacy hand-written IIFE.
    js: 'window.CamaleonicConnect = __CamaleonicConnectBundle.default;',
  },
  legalComments: 'inline',
});

// 2) ESM for npm consumers.
await build({
  entryPoints: [resolve(HERE, 'src/index.ts')],
  outfile: resolve(DIST, 'index.mjs'),
  bundle: true,
  format: 'esm',
  target: ['es2020'],
  minify: false,
  sourcemap: false,
  banner: { js: banner },
});

// 3) Type declarations. Emit once with tsc and copy to both locations so a
//    `<script>` tag + `.d.ts` next to it works the same as `npm install`.
execSync('npx tsc --project tsconfig.json', { cwd: HERE, stdio: 'inherit' });
copyFileSync(resolve(DIST, 'index.d.ts'), resolve(PUBLIC, 'connect-sdk.d.ts'));

// 4) Size check — keep us honest about the popup widget budget.
const sizeBytes = readFileSync(resolve(PUBLIC, 'connect-sdk.js')).byteLength;
const sizeKb = (sizeBytes / 1024).toFixed(1);
writeFileSync(
  resolve(PUBLIC, 'connect-sdk.js.size'),
  `${sizeBytes} bytes (${sizeKb} KB)\n`,
);
console.log(`✓ connect-sdk.js ${sizeKb} KB`);
if (sizeBytes > 15 * 1024) {
  console.warn(`⚠ SDK exceeds 15 KB budget (${sizeKb} KB)`);
}
