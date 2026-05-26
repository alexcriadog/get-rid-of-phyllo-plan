export type Step = 'consent' | 'chooser' | 'connections' | 'guidance';

export type PlatformKey =
  | 'facebook' | 'instagram' | 'youtube' | 'tiktok' | 'threads' | 'twitch';

export const PLATFORM_KEYS: readonly PlatformKey[] = [
  'facebook', 'instagram', 'youtube', 'tiktok', 'threads', 'twitch',
];

export function isPlatformKey(v: unknown): v is PlatformKey {
  return typeof v === 'string' && (PLATFORM_KEYS as readonly string[]).includes(v);
}

export function initialStep(fixedPlatform: PlatformKey | undefined): {
  step: Step;
  platform: PlatformKey | undefined;
} {
  return { step: 'consent', platform: fixedPlatform };
}

/** A fixed platform skips the chooser; otherwise show it. */
export function nextAfterConsent(fixedPlatform: PlatformKey | undefined): Step {
  return fixedPlatform ? 'connections' : 'chooser';
}
