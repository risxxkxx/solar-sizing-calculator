import { describe, it, expect } from 'vitest';
import { fmt } from '../src/format.js';

describe('fmt', () => {
  it('uses decimal comma and NBSP thousands for mk', () => {
    expect(fmt(1234.56, 1, 'mk')).toBe('1 234,6');
    expect(fmt(1234567, 0, 'mk')).toBe('1 234 567');
  });
  it('uses decimal point and comma thousands for en', () => {
    expect(fmt(1234.56, 2, 'en')).toBe('1,234.56');
  });
  it('handles negatives, non-finite values and negative zero', () => {
    expect(fmt(-1500.25, 1, 'mk')).toBe('-1 500,3');
    expect(fmt(NaN, 1, 'mk')).toBe('0,0');
    expect(fmt(Infinity, 0, 'en')).toBe('0');
    expect(fmt(-0.01, 1, 'en')).toBe('0.0');
  });
});
