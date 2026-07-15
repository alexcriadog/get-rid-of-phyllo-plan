export type PlatformInfo = {
  key:
    | 'facebook'
    | 'tiktok'
    | 'threads'
    | 'youtube'
    | 'twitch'
    | 'linkedin'
    | 'twitter';
  label: string;
  subtitle: string;
  accent: 'blue' | 'red' | 'cyan' | 'mint' | 'purple' | 'linkedin' | 'x';
  enabled: boolean;
  /** Name of the missing env var, when enabled === false. */
  missing?: string;
};

const ACCENT_HEX: Record<PlatformInfo['accent'], string> = {
  blue: '#5288ff',
  red: '#ff3c5e',
  cyan: '#3cb6ff',
  mint: '#3cffd0',
  // Twitch brand purple.
  purple: '#9146ff',
  // LinkedIn brand blue.
  linkedin: '#0A66C2',
  // X is monochrome black; the tile accent needs contrast against the dark
  // canvas, so use the off-white side of the brand instead.
  x: '#e7e9ea',
};

export function PlatformTile({
  platform,
  query,
}: {
  platform: PlatformInfo;
  /** Already-encoded URLSearchParams to append to the start route (`ws=...&token=...`). */
  query?: string;
}) {
  const accent = ACCENT_HEX[platform.accent];
  const inner = (
    <div
      className="v-tile"
      style={{
        padding: 28,
        borderRadius: 22,
        border: `1px solid ${platform.enabled ? '#ffffff' : 'rgba(255,255,255,0.18)'}`,
        background:
          'radial-gradient(110% 80% at 0% 0%, ' +
          (platform.enabled ? `${accent}26` : 'rgba(255,255,255,0.04)') +
          ' 0%, rgba(19,19,19,0) 55%), linear-gradient(180deg, #161616 0%, #0e0e0e 100%)',
        opacity: platform.enabled ? 1 : 0.55,
        minHeight: 200,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        transition: 'transform 160ms ease, border-color 160ms ease',
      }}
    >
      <span className="v-kicker" style={{ color: accent }}>
        {platform.label}
      </span>
      <div
        className="v-display"
        style={{ fontSize: 36, lineHeight: 1, color: '#fff' }}
      >
        Connect
      </div>
      <p className="v-body" style={{ fontSize: 13, marginTop: 6 }}>
        {platform.subtitle}
      </p>
      <div style={{ flex: 1 }} />
      {platform.enabled ? (
        <span className="v-pill-outline-mint" style={{ alignSelf: 'flex-start' }}>
          Start →
        </span>
      ) : (
        <span
          className="v-meta"
          title={`Missing ${platform.missing} in connect-tool/.env`}
        >
          ⚠ missing {platform.missing}
        </span>
      )}
    </div>
  );

  if (!platform.enabled) {
    return <div style={{ cursor: 'not-allowed' }}>{inner}</div>;
  }
  // Plain <a>, NOT next/link: the href is an OAuth-init API route that sets a
  // CSRF `state` cookie and 302s to the provider. next/link probe-fetches the
  // route during client navigation, executing /start twice and racing two
  // Set-Cookie writes against the `state` carried to the provider → "state
  // verification failed" at the callback. A plain anchor does exactly one
  // top-level navigation, so cookie and state always agree.
  return (
    <a
      href={`/api/oauth/start/${platform.key}${query ? `?${query}` : ''}`}
      style={{ textDecoration: 'none' }}
    >
      {inner}
    </a>
  );
}
