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
