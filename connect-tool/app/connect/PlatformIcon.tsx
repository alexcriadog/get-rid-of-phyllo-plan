import type { PlatformKey } from './shell-machine';

interface Brand {
  label: string;
  provider: string;
  bg: string;
  glyph: React.ReactNode;
}

const f = (d: string) => <svg viewBox="0 0 24 24" fill="#fff"><path d={d} /></svg>;

export const BRAND: Record<PlatformKey, Brand> = {
  facebook: {
    label: 'Facebook', provider: 'Facebook', bg: '#1877F2',
    glyph: f('M13.5 21v-7h2.3l.4-2.8h-2.7V9.4c0-.8.2-1.4 1.4-1.4h1.4V5.6c-.7-.1-1.5-.1-2.2-.1-2.2 0-3.7 1.3-3.7 3.8v2.1H8v2.8h2.4V21h3.1z'),
  },
  instagram: {
    label: 'Instagram', provider: 'Facebook',
    bg: 'linear-gradient(135deg,#feda75,#fa7e1e,#d62976,#962fbf)',
    glyph: (
      <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
        <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
        <circle cx="12" cy="12" r="3.7" />
        <circle cx="17.2" cy="6.8" r="1.1" fill="#fff" stroke="none" />
      </svg>
    ),
  },
  youtube: {
    label: 'YouTube', provider: 'Google', bg: '#FF0033',
    glyph: f('M9.5 8.5v7l6-3.5z'),
  },
  tiktok: {
    label: 'TikTok', provider: 'TikTok', bg: '#111118',
    glyph: f('M14.2 3.5c.3 2.1 1.8 3.6 3.9 3.9v2.5c-1.4 0-2.8-.4-3.9-1.2v5.6c0 2.8-2.3 5.1-5.1 5.1S4 17.1 4 14.3s2.3-5.1 5.1-5.1c.3 0 .6 0 .9.1v2.6c-.3-.1-.6-.2-.9-.2-1.4 0-2.6 1.2-2.6 2.6s1.2 2.6 2.6 2.6 2.6-1.2 2.6-2.6V3.5h2.5z'),
  },
  threads: {
    label: 'Threads', provider: 'Threads', bg: '#111118',
    glyph: (
      <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.9">
        <circle cx="12" cy="12" r="8.4" />
        <circle cx="12" cy="12.4" r="3" />
        <path d="M15 12.3c0 1.6-1 2.6-2.4 2.6-1.3 0-2-.7-2-1.6 0-1 .9-1.5 2.1-1.5 2 0 3.3 1 3.3 3" />
      </svg>
    ),
  },
  twitch: {
    label: 'Twitch', provider: 'Twitch', bg: '#9146FF',
    glyph: f('M5 3.5 3.7 7v11h3.6v2.5L9.8 18h3.4l4.1-4V3.5H5zm11 9.7L13.5 16h-3.4l-2.1 2.1V16H5.7V5.3H16v7.9zm-3.4-5.6v4.1h1.4V7.6h-1.4zm-3.7 0v4.1h1.4V7.6H8.9z'),
  },
};

export function PlatformIcon({ platform, large }: { platform: PlatformKey; large?: boolean }) {
  const b = BRAND[platform];
  return (
    <span
      className={large ? 'cml-ico cml-ico--lg' : 'cml-ico'}
      style={{ background: b.bg }}
      aria-hidden
    >
      {b.glyph}
    </span>
  );
}
