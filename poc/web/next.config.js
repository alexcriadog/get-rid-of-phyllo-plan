/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
      { protocol: 'http', hostname: '**' },
    ],
    unoptimized: true,
  },
  // Phase 5b cutover: the Ops Terminal workbench is now /admin. The legacy
  // /admin/* pages are deleted; these redirects land each old route on the
  // workbench deck/panel that replaces it (or, for the two surviving editors,
  // on their new /admin/config/* home). All temporary (permanent:false → 307)
  // so the mappings can still be adjusted; flip to permanent once settled.
  //
  // Ordering matters: Next matches in array order, so the more specific
  // /admin/accounts/:id/sync-settings must precede /admin/accounts/:id.
  async redirects() {
    return [
      // ── Pipeline deck ──────────────────────────────────────────────────
      { source: '/admin/next-runs', destination: '/admin?deck=pipeline', permanent: false },
      { source: '/admin/queues', destination: '/admin?deck=pipeline', permanent: false },
      { source: '/admin/cadence', destination: '/admin?deck=pipeline', permanent: false },
      { source: '/admin/rate-limits', destination: '/admin?deck=pipeline', permanent: false },
      { source: '/admin/throttle-locks', destination: '/admin?deck=pipeline', permanent: false },

      // ── Live activity panel ────────────────────────────────────────────
      { source: '/admin/calls', destination: '/admin?panel=live-activity', permanent: false },
      { source: '/admin/events', destination: '/admin?panel=live-activity', permanent: false },
      { source: '/admin/webhooks', destination: '/admin?panel=live-activity', permanent: false },
      { source: '/admin/webhook-deliveries', destination: '/admin?panel=live-activity', permanent: false },

      // ── Single-panel jumps ─────────────────────────────────────────────
      { source: '/admin/raw', destination: '/admin?panel=raw-inspector', permanent: false },
      { source: '/admin/usage', destination: '/admin?panel=usage', permanent: false },
      { source: '/admin/support-matrix', destination: '/admin?panel=capability-matrix', permanent: false },
      { source: '/admin/settings', destination: '/admin?panel=runtime-settings', permanent: false },
      { source: '/admin/system-health', destination: '/admin?panel=vitals', permanent: false },

      // ── Tenant service deck + object permalinks ─────────────────────────
      // Specific (sync-settings) before the generic account redirect.
      { source: '/admin/accounts/:id/sync-settings', destination: '/admin/config/sync/:id', permanent: false },
      { source: '/admin/accounts/:id', destination: '/admin?account=:id', permanent: false },
      { source: '/admin/accounts', destination: '/admin?deck=tenant-service', permanent: false },
      { source: '/admin/workspaces/:slug', destination: '/admin?workspace=:slug', permanent: false },
      { source: '/admin/workspaces', destination: '/admin?deck=tenant-service', permanent: false },
      { source: '/admin/api-keys', destination: '/admin?deck=tenant-service', permanent: false },

      // ── Workbench rename ───────────────────────────────────────────────
      // Query string passes through automatically (no params in destination).
      { source: '/admin/terminal', destination: '/admin', permanent: false },
    ];
  },
};

module.exports = nextConfig;
