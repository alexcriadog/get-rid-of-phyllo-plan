import { describe, it, expect } from 'vitest';
import { initialStep, nextAfterConsent, type Step } from './shell-machine';

describe('connect shell machine', () => {
  it('starts at consent', () => {
    expect(initialStep(undefined).step).toBe<Step>('consent');
  });
  it('after consent with a fixed platform goes straight to connections', () => {
    expect(nextAfterConsent('tiktok')).toBe<Step>('connections');
  });
  it('after consent with no platform goes to the chooser', () => {
    expect(nextAfterConsent(undefined)).toBe<Step>('chooser');
  });
  it('initialStep records the fixed platform', () => {
    expect(initialStep('twitch').platform).toBe('twitch');
  });
});
