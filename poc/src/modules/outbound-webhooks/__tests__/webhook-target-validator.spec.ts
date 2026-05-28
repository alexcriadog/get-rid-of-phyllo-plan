// Cubre cada CIDR bloqueado, cada rejection reason, y los happy paths
// (IPv4 literal público, IPv6 literal público, hostname con resolución
// mockeada). dns/promises.lookup se mockea para que el spec sea
// determinista sin red.

jest.mock('node:dns/promises', () => ({ lookup: jest.fn() }));

import { lookup as lookupReal } from 'node:dns/promises';
import {
  shouldRequireHttps,
  validateWebhookTarget,
} from '../webhook-target-validator';

const lookup = lookupReal as unknown as jest.Mock;

function resolves(...addrs: Array<{ address: string; family: 4 | 6 }>): void {
  lookup.mockResolvedValueOnce(addrs);
}

beforeEach(() => {
  lookup.mockReset();
});

describe('shouldRequireHttps', () => {
  it('defaults to true in production', () => {
    expect(shouldRequireHttps({ NODE_ENV: 'production' })).toBe(true);
  });
  it('defaults to false outside production', () => {
    expect(shouldRequireHttps({ NODE_ENV: 'development' })).toBe(false);
    expect(shouldRequireHttps({})).toBe(false);
  });
  it('honours WEBHOOKS_REQUIRE_HTTPS override', () => {
    expect(shouldRequireHttps({ WEBHOOKS_REQUIRE_HTTPS: 'true' })).toBe(true);
    expect(shouldRequireHttps({ WEBHOOKS_REQUIRE_HTTPS: '1' })).toBe(true);
    expect(shouldRequireHttps({ WEBHOOKS_REQUIRE_HTTPS: 'false' })).toBe(false);
    expect(
      shouldRequireHttps({
        NODE_ENV: 'production',
        WEBHOOKS_REQUIRE_HTTPS: 'false',
      }),
    ).toBe(false);
  });
});

describe('validateWebhookTarget — surface validation', () => {
  it('rejects empty url', async () => {
    const r = await validateWebhookTarget('', { requireHttps: false });
    expect(r).toMatchObject({ ok: false, reason: 'url_invalid' });
  });

  it('rejects url over 2048 chars', async () => {
    const url = 'https://example.com/' + 'a'.repeat(2048);
    const r = await validateWebhookTarget(url, { requireHttps: false });
    expect(r).toMatchObject({ ok: false, reason: 'url_too_long' });
  });

  it('rejects malformed url', async () => {
    const r = await validateWebhookTarget('not a url', { requireHttps: false });
    expect(r).toMatchObject({ ok: false, reason: 'url_invalid' });
  });

  it('rejects non-http schemes', async () => {
    const r = await validateWebhookTarget('ftp://example.com/hook', {
      requireHttps: false,
    });
    expect(r).toMatchObject({ ok: false, reason: 'scheme_invalid' });
  });

  it('rejects javascript:', async () => {
    const r = await validateWebhookTarget('javascript:alert(1)', {
      requireHttps: false,
    });
    expect(r).toMatchObject({ ok: false, reason: 'scheme_invalid' });
  });

  it('rejects http when requireHttps=true', async () => {
    const r = await validateWebhookTarget('http://example.com/hook', {
      requireHttps: true,
    });
    expect(r).toMatchObject({ ok: false, reason: 'https_required' });
  });

  it('rejects embedded credentials', async () => {
    const r = await validateWebhookTarget('https://user:pass@example.com/x', {
      requireHttps: false,
    });
    expect(r).toMatchObject({ ok: false, reason: 'embedded_credentials' });
  });

  it('rejects fragments', async () => {
    const r = await validateWebhookTarget('https://example.com/hook#frag', {
      requireHttps: false,
    });
    expect(r).toMatchObject({ ok: false, reason: 'fragment_not_allowed' });
  });
});

describe('validateWebhookTarget — hostname blocklist', () => {
  it('rejects localhost by name', async () => {
    const r = await validateWebhookTarget('http://localhost:3000/x', {
      requireHttps: false,
    });
    expect(r).toMatchObject({ ok: false, reason: 'hostname_blocked' });
  });

  it('rejects metadata.google.internal', async () => {
    const r = await validateWebhookTarget(
      'http://metadata.google.internal/computeMetadata/v1/',
      { requireHttps: false },
    );
    expect(r).toMatchObject({ ok: false, reason: 'hostname_blocked' });
  });

  it('rejects .local suffix', async () => {
    const r = await validateWebhookTarget('http://my-printer.local/x', {
      requireHttps: false,
    });
    expect(r).toMatchObject({ ok: false, reason: 'hostname_blocked' });
  });

  it('rejects .internal suffix', async () => {
    const r = await validateWebhookTarget('https://api.foo.internal/x', {
      requireHttps: false,
    });
    expect(r).toMatchObject({ ok: false, reason: 'hostname_blocked' });
  });
});

describe('validateWebhookTarget — IPv4 literal blocks', () => {
  it.each([
    ['127.0.0.1', 'ssrf_blocked_loopback'],
    ['127.5.5.5', 'ssrf_blocked_loopback'],
    ['10.0.0.1', 'ssrf_blocked_private_ip'],
    ['10.255.255.254', 'ssrf_blocked_private_ip'],
    ['172.16.0.1', 'ssrf_blocked_private_ip'],
    ['172.31.255.254', 'ssrf_blocked_private_ip'],
    ['192.168.1.1', 'ssrf_blocked_private_ip'],
    ['169.254.169.254', 'ssrf_blocked_link_local'],
    ['169.254.0.1', 'ssrf_blocked_link_local'],
    ['0.0.0.0', 'ssrf_blocked_unspecified'],
  ])('rejects %s', async (ip, reason) => {
    const r = await validateWebhookTarget(`https://${ip}/hook`, {
      requireHttps: false,
    });
    expect(r).toMatchObject({ ok: false, reason });
  });

  it.each(['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.0.1', '172.32.0.1'])(
    'allows public IP %s',
    async (ip) => {
      const r = await validateWebhookTarget(`https://${ip}/hook`, {
        requireHttps: false,
      });
      expect(r.ok).toBe(true);
    },
  );

  it('catches octal-encoded loopback (0177.0.0.1 → 127.0.0.1)', async () => {
    // WHATWG URL parser normalises octal/hex IPv4 components, so by the
    // time we see `parsed.hostname` it's already in canonical decimal form.
    // "0177.0.0.1" → "127.0.0.1" → blocked as loopback. Verifies we rely
    // on WHATWG's normalisation rather than rolling our own.
    const r = await validateWebhookTarget('https://0177.0.0.1/x', {
      requireHttps: false,
    });
    expect(r).toMatchObject({ ok: false, reason: 'ssrf_blocked_loopback' });
  });

  it('catches hex-encoded loopback (0x7f.0.0.1 → 127.0.0.1)', async () => {
    const r = await validateWebhookTarget('https://0x7f.0.0.1/x', {
      requireHttps: false,
    });
    expect(r).toMatchObject({ ok: false, reason: 'ssrf_blocked_loopback' });
  });
});

describe('validateWebhookTarget — IPv6 literal blocks', () => {
  it.each([
    ['::1', 'ssrf_blocked_loopback'],
    ['::', 'ssrf_blocked_unspecified'],
    ['fe80::1', 'ssrf_blocked_link_local'],
    ['febf::1', 'ssrf_blocked_link_local'],
    ['fc00::1', 'ssrf_blocked_unique_local_v6'],
    ['fdff::1', 'ssrf_blocked_unique_local_v6'],
    ['::ffff:127.0.0.1', 'ssrf_blocked_loopback'],
    ['::ffff:10.0.0.1', 'ssrf_blocked_private_ip'],
    ['::ffff:169.254.169.254', 'ssrf_blocked_link_local'],
  ])('rejects [%s]', async (ip, reason) => {
    const r = await validateWebhookTarget(`https://[${ip}]/hook`, {
      requireHttps: false,
    });
    expect(r).toMatchObject({ ok: false, reason });
  });

  it('allows public IPv6 [2606:4700:4700::1111]', async () => {
    const r = await validateWebhookTarget(
      'https://[2606:4700:4700::1111]/hook',
      { requireHttps: false },
    );
    expect(r.ok).toBe(true);
  });
});

describe('validateWebhookTarget — DNS resolution path', () => {
  it('rejects when DNS resolves to a private IP', async () => {
    resolves({ address: '10.0.0.5', family: 4 });
    const r = await validateWebhookTarget('https://customer.example.com/hook', {
      requireHttps: false,
    });
    expect(r).toMatchObject({
      ok: false,
      reason: 'ssrf_blocked_private_ip',
    });
  });

  it('rejects when ANY of multiple A records is private', async () => {
    resolves(
      { address: '8.8.8.8', family: 4 },
      { address: '169.254.169.254', family: 4 },
    );
    const r = await validateWebhookTarget('https://multi.example.com/x', {
      requireHttps: false,
    });
    expect(r).toMatchObject({
      ok: false,
      reason: 'ssrf_blocked_link_local',
    });
  });

  it('rejects when AAAA resolves to link-local', async () => {
    resolves({ address: 'fe80::1', family: 6 });
    const r = await validateWebhookTarget('https://v6host.example.com/x', {
      requireHttps: false,
    });
    expect(r).toMatchObject({ ok: false, reason: 'ssrf_blocked_link_local' });
  });

  it('rejects when DNS lookup fails', async () => {
    lookup.mockRejectedValueOnce(new Error('ENOTFOUND example.invalid'));
    const r = await validateWebhookTarget('https://example.invalid/x', {
      requireHttps: false,
    });
    expect(r).toMatchObject({ ok: false, reason: 'dns_resolution_failed' });
  });

  it('rejects when DNS returns empty answer', async () => {
    lookup.mockResolvedValueOnce([]);
    const r = await validateWebhookTarget('https://nothing.example.com/x', {
      requireHttps: false,
    });
    expect(r).toMatchObject({ ok: false, reason: 'dns_resolution_failed' });
  });

  it('accepts when all addresses are public', async () => {
    resolves(
      { address: '93.184.216.34', family: 4 },
      { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
    );
    const r = await validateWebhookTarget('https://example.com/hook', {
      requireHttps: true,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.resolvedAddresses).toContain('93.184.216.34');
    }
  });
});
