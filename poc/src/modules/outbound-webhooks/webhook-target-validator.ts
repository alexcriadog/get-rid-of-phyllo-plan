// SSRF + scheme + length validator for outbound webhook target URLs.
//
// Runs in TWO places (Phase A double-validation):
//   1. POST + PATCH /v1/webhook-endpoints — reject at registration time.
//   2. OutboundWebhooksService.handleDelivery() — re-resolve the host
//      immediately before axios.post, so DNS rebinding to a private IP
//      after registration still gets caught.
//
// Each rejection returns a stable `reason` string so the client (and our
// logs) can distinguish ssrf_blocked_link_local from https_required from
// scheme_invalid without parsing free-form prose.

import { lookup } from 'node:dns/promises';
import { Agent as HttpAgent } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';

export type WebhookTargetCheck =
  | { ok: true; canonicalUrl: string; resolvedAddresses: ReadonlyArray<string> }
  | { ok: false; reason: WebhookTargetRejection; detail?: string };

export type WebhookTargetRejection =
  | 'url_invalid'
  | 'scheme_invalid'
  | 'https_required'
  | 'embedded_credentials'
  | 'fragment_not_allowed'
  | 'url_too_long'
  | 'host_empty'
  | 'hostname_blocked'
  | 'dns_resolution_failed'
  | 'ssrf_blocked_loopback'
  | 'ssrf_blocked_private_ip'
  | 'ssrf_blocked_link_local'
  | 'ssrf_blocked_unspecified'
  | 'ssrf_blocked_unique_local_v6';

const MAX_URL_LENGTH = 2048;

// Hostnames that resolve to instance metadata services or other internal
// surfaces operators forget about. Matches case-insensitively on the
// hostname only (not the full URL).
const BLOCKED_HOSTNAMES: ReadonlySet<string> = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata',
  // AWS instance metadata can also be reached via its IP (handled by CIDR
  // check) but some setups expose a DNS alias.
  'instance-data',
]);

// .local suffix → mDNS / Bonjour, never something a public webhook should
// target.
const BLOCKED_SUFFIXES: ReadonlyArray<string> = ['.local', '.internal'];

// IPv4 CIDR ranges to refuse. Includes loopback, RFC1918 private, link-local
// (covers AWS/GCP/Azure metadata 169.254.169.254), and the unspecified
// 0.0.0.0/8 range.
interface Cidr4 {
  readonly addr: number;
  readonly mask: number;
  readonly reason: WebhookTargetRejection;
}

const IPV4_BLOCKS: ReadonlyArray<Cidr4> = [
  cidr4('127.0.0.0', 8, 'ssrf_blocked_loopback'),
  cidr4('10.0.0.0', 8, 'ssrf_blocked_private_ip'),
  cidr4('172.16.0.0', 12, 'ssrf_blocked_private_ip'),
  cidr4('192.168.0.0', 16, 'ssrf_blocked_private_ip'),
  cidr4('169.254.0.0', 16, 'ssrf_blocked_link_local'),
  cidr4('0.0.0.0', 8, 'ssrf_blocked_unspecified'),
];

function cidr4(
  base: string,
  prefix: number,
  reason: WebhookTargetRejection,
): Cidr4 {
  const parts = base.split('.').map(Number);
  if (
    parts.length !== 4 ||
    parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)
  ) {
    throw new Error(`Invalid CIDR base: ${base}`);
  }
  const addr =
    ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return { addr: (addr & mask) >>> 0, mask, reason };
}

function ipv4ToInt(ip: string): number | null {
  // Accepts decimal-only dotted quad. Leading zeros are read as decimal,
  // NOT octal — historically some libraries treat "010.0.0.1" as octal
  // (8.0.0.1) which lets an attacker route around a "blocks 10/8" check.
  // We normalise to decimal so "010.0.0.1" → 10.0.0.1 → falls in 10/8.
  // Hex ("0x7f.0.0.1") and shorthand ("127.1") forms are rejected.
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const nums: number[] = [];
  for (const part of parts) {
    if (!/^[0-9]+$/.test(part)) return null;
    const n = Number(part);
    if (n < 0 || n > 255) return null;
    nums.push(n);
  }
  return (
    ((nums[0] << 24) | (nums[1] << 16) | (nums[2] << 8) | nums[3]) >>> 0
  );
}

function ipv4Blocked(ip: string): WebhookTargetRejection | null {
  const v = ipv4ToInt(ip);
  if (v === null) return null;
  for (const block of IPV4_BLOCKS) {
    if ((v & block.mask) >>> 0 === block.addr) return block.reason;
  }
  return null;
}

function ipv6Blocked(ip: string): WebhookTargetRejection | null {
  if (ip === '::1' || ip === '0:0:0:0:0:0:0:1') return 'ssrf_blocked_loopback';
  if (ip === '::' || ip === '0:0:0:0:0:0:0:0') return 'ssrf_blocked_unspecified';
  const lower = ip.toLowerCase();
  // Link-local fe80::/10 — first 10 bits = 1111111010. The hex prefix of
  // such addresses is fe8x..feBx (binary 1111111010..xx).
  if (/^fe[89ab]/.test(lower)) {
    return 'ssrf_blocked_link_local';
  }
  // Unique local fc00::/7 → first byte 0xfc or 0xfd
  if (/^f[cd]/.test(lower)) {
    return 'ssrf_blocked_unique_local_v6';
  }
  // IPv4-mapped IPv6 in dotted form: ::ffff:127.0.0.1
  const mappedDotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mappedDotted) {
    return ipv4Blocked(mappedDotted[1]);
  }
  // IPv4-mapped IPv6 in hex form (which is the WHATWG URL canonical form):
  // ::ffff:7f00:1 == ::ffff:127.0.0.1
  const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (mappedHex) {
    const h1 = parseInt(mappedHex[1], 16);
    const h2 = parseInt(mappedHex[2], 16);
    const ipv4 = `${(h1 >> 8) & 0xff}.${h1 & 0xff}.${(h2 >> 8) & 0xff}.${h2 & 0xff}`;
    return ipv4Blocked(ipv4);
  }
  return null;
}

function hostnameBlocked(host: string): WebhookTargetRejection | null {
  const lower = host.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(lower)) return 'hostname_blocked';
  for (const suffix of BLOCKED_SUFFIXES) {
    if (lower.endsWith(suffix)) return 'hostname_blocked';
  }
  return null;
}

export interface ValidateOpts {
  readonly requireHttps: boolean;
}

export async function validateWebhookTarget(
  rawUrl: string,
  opts: ValidateOpts,
): Promise<WebhookTargetCheck> {
  if (typeof rawUrl !== 'string' || rawUrl.length === 0) {
    return { ok: false, reason: 'url_invalid', detail: 'empty' };
  }
  if (rawUrl.length > MAX_URL_LENGTH) {
    return { ok: false, reason: 'url_too_long' };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'url_invalid', detail: 'malformed' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'scheme_invalid', detail: parsed.protocol };
  }
  if (opts.requireHttps && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'https_required' };
  }
  if (parsed.username.length > 0 || parsed.password.length > 0) {
    return { ok: false, reason: 'embedded_credentials' };
  }
  if (parsed.hash.length > 0) {
    return { ok: false, reason: 'fragment_not_allowed' };
  }

  const host = parsed.hostname;
  if (host.length === 0 || /^\s*$/.test(host)) {
    return { ok: false, reason: 'host_empty' };
  }

  // URL strips surrounding brackets from IPv6 hostnames but the WHATWG
  // parser keeps them on `.hostname`. Strip explicitly so isIP works.
  const stripped = host.replace(/^\[/, '').replace(/\]$/, '');

  const hostnameReason = hostnameBlocked(stripped);
  if (hostnameReason) {
    return { ok: false, reason: hostnameReason, detail: host };
  }

  // If the hostname is already a literal IP, check it directly without DNS.
  const ipKind = isIP(stripped);
  if (ipKind === 4) {
    const reason = ipv4Blocked(stripped);
    if (reason) return { ok: false, reason, detail: stripped };
    return {
      ok: true,
      canonicalUrl: parsed.toString(),
      resolvedAddresses: [stripped],
    };
  }
  if (ipKind === 6) {
    const reason = ipv6Blocked(stripped);
    if (reason) return { ok: false, reason, detail: stripped };
    return {
      ok: true,
      canonicalUrl: parsed.toString(),
      resolvedAddresses: [stripped],
    };
  }

  // Hostname: resolve and reject if ANY answer is in a blocked range. This
  // catches DNS-pinning attacks that point a public hostname at a private
  // IP. `all: true` gives every A + AAAA the OS returns; `verbatim: true`
  // keeps the order so we don't bias toward IPv4.
  let resolved: { address: string; family: number }[];
  try {
    resolved = await lookup(stripped, { all: true, verbatim: true });
  } catch (err) {
    return {
      ok: false,
      reason: 'dns_resolution_failed',
      detail: err instanceof Error ? err.message : String(err),
    };
  }
  if (resolved.length === 0) {
    return { ok: false, reason: 'dns_resolution_failed', detail: 'empty answer' };
  }

  for (const entry of resolved) {
    const reason =
      entry.family === 4
        ? ipv4Blocked(entry.address)
        : ipv6Blocked(entry.address);
    if (reason) {
      return { ok: false, reason, detail: `${stripped} → ${entry.address}` };
    }
  }

  return {
    ok: true,
    canonicalUrl: parsed.toString(),
    resolvedAddresses: resolved.map((r) => r.address),
  };
}

/**
 * A `dns.lookup`-shaped function that ALWAYS resolves to a pre-validated IP,
 * ignoring the hostname it is asked about. Wiring this into the delivery agent
 * pins the TCP connection to the exact address `validateWebhookTarget` already
 * vetted — closing the DNS-rebinding TOCTOU where axios would otherwise
 * re-resolve the host itself, after our check.
 */
export function pinnedLookup(addresses: ReadonlyArray<string>): LookupFunction {
  const pin = addresses[0];
  const family = isIP(pin); // 4 | 6 for a validated literal IP
  return ((_hostname: string, options: unknown, callback?: unknown): void => {
    const cb = (typeof options === 'function' ? options : callback) as (
      err: NodeJS.ErrnoException | null,
      address: string | ReadonlyArray<{ address: string; family: number }>,
      family?: number,
    ) => void;
    const wantsAll =
      typeof options === 'object' &&
      options !== null &&
      (options as { all?: boolean }).all === true;
    if (wantsAll) {
      cb(null, [{ address: pin, family }]);
    } else {
      cb(null, pin, family);
    }
  }) as unknown as LookupFunction;
}

/**
 * http + https agents that pin every connection to `addresses` (see
 * `pinnedLookup`). Pass these into the delivery request together with
 * `maxRedirects: 0` so neither a redirect nor a racing DNS change can steer
 * the request to an internal address after validation.
 */
export function ssrfSafeAgents(addresses: ReadonlyArray<string>): {
  httpAgent: HttpAgent;
  httpsAgent: HttpsAgent;
} {
  const lookup = pinnedLookup(addresses);
  return {
    httpAgent: new HttpAgent({ lookup }),
    httpsAgent: new HttpsAgent({ lookup }),
  };
}

/** True when the env says webhook targets must be HTTPS. Centralised so
 *  both the controller and the service read the same toggle. */
export function shouldRequireHttps(env: NodeJS.ProcessEnv): boolean {
  const raw = env.WEBHOOKS_REQUIRE_HTTPS;
  if (raw === undefined) {
    // Default: required in production, optional otherwise. Keeps dev
    // (ngrok / http://localhost forwarders) working out of the box.
    return env.NODE_ENV === 'production';
  }
  return /^(1|true|yes|on)$/i.test(raw.trim());
}
