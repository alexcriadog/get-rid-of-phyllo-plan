import { describe, expect, it } from 'vitest';
import { fmtStatNumber } from '../format';

const NNBSP = '\u202f';

describe('fmtStatNumber', () => {
  it('groups thousands with narrow no-break space', () => {
    expect(fmtStatNumber(48204)).toBe(`48${NNBSP}204`);
    expect(fmtStatNumber(1234567)).toBe(`1${NNBSP}234${NNBSP}567`);
  });
  it('keeps small numbers ungrouped', () => {
    expect(fmtStatNumber(942)).toBe('942');
    expect(fmtStatNumber(0)).toBe('0');
  });
  it('handles negatives', () => {
    expect(fmtStatNumber(-48204)).toBe(`-48${NNBSP}204`);
  });
  it('renders em-dash for null/undefined/non-finite', () => {
    expect(fmtStatNumber(null)).toBe('—');
    expect(fmtStatNumber(undefined)).toBe('—');
    expect(fmtStatNumber(Number.NaN)).toBe('—');
  });
});
