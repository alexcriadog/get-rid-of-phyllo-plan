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
