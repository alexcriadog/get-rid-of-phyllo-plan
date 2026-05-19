/**
 * Issue a workspace API key from the CLI.
 *
 * Usage:
 *   npm run issue-key -- <workspace-slug> [--env live|test] [--label "<text>"]
 *
 * Prints the raw key exactly ONCE — there's no way to retrieve it later
 * (we store only its SHA-256 hash). Save it immediately.
 *
 * Intended for operator-driven onboarding; replaced by an admin UI later.
 */

import { createHash, randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import * as fs from 'node:fs';
import * as path from 'node:path';

const KEY_PREFIX_LIVE = 'cmlk_live_';
const KEY_PREFIX_TEST = 'cmlk_test_';
const RANDOM_BYTES = 24;

function loadDotenv(): void {
  const envPath = path.resolve(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

interface Args {
  slug: string;
  env: 'live' | 'test';
  label?: string;
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  let env: 'live' | 'test' = 'live';
  let label: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--env') {
      const v = argv[++i];
      if (v !== 'live' && v !== 'test') {
        throw new Error(`--env must be 'live' or 'test' (got ${v})`);
      }
      env = v;
    } else if (a === '--label') {
      label = argv[++i];
    } else if (a.startsWith('--')) {
      throw new Error(`Unknown flag: ${a}`);
    } else {
      positional.push(a);
    }
  }
  if (positional.length !== 1) {
    throw new Error('Expected exactly one positional arg: workspace slug');
  }
  return { slug: positional[0], env, label };
}

async function main(): Promise<void> {
  loadDotenv();
  const args = parseArgs(process.argv.slice(2));

  const prisma = new PrismaClient();
  try {
    const workspace = await prisma.workspace.findUnique({
      where: { slug: args.slug },
      select: { id: true, name: true },
    });
    if (!workspace) {
      throw new Error(`Workspace not found: ${args.slug}`);
    }

    const random = randomBytes(RANDOM_BYTES).toString('base64url');
    const rawKey = `${args.env === 'live' ? KEY_PREFIX_LIVE : KEY_PREFIX_TEST}${random}`;
    const keyPrefix = rawKey.slice(0, KEY_PREFIX_LIVE.length + 8);
    const keyHash = createHash('sha256').update(rawKey).digest('hex');

    const row = await prisma.apiKey.create({
      data: {
        workspaceId: workspace.id,
        keyPrefix,
        keyHash,
        scope: 'read_write',
        label: args.label ?? null,
      },
    });

    process.stdout.write(
      [
        '',
        `Workspace:  ${workspace.name} (${args.slug}, ${workspace.id})`,
        `Key id:     ${row.id}`,
        `Prefix:     ${keyPrefix}`,
        `Environment: ${args.env}`,
        `Label:      ${args.label ?? '(none)'}`,
        '',
        '┌────────────────────────────────────────────────────────────────────┐',
        '│ Save this NOW — only the hash is stored, the raw key is shown ONCE │',
        '└────────────────────────────────────────────────────────────────────┘',
        '',
        rawKey,
        '',
      ].join('\n'),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(
    `\n[issue-api-key] ${err instanceof Error ? err.message : String(err)}\n\n`,
  );
  process.exit(1);
});
