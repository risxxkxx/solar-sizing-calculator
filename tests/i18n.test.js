import { describe, it, expect, afterEach } from 'vitest';
import { STRINGS, t, setLang, detectLang, monthName } from '../src/i18n.js';

const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('i18n dictionary', () => {
  afterEach(() => setLang('en'));

  it('en and mk define exactly the same keys', () => {
    expect(Object.keys(STRINGS.mk).sort()).toEqual(Object.keys(STRINGS.en).sort());
  });

  it('every translation uses the same placeholders', () => {
    for (const key of Object.keys(STRINGS.en)) {
      expect(placeholders(STRINGS.mk[key]), key).toEqual(placeholders(STRINGS.en[key]));
    }
  });

  it('interpolates parameters and leaves unknown ones visible', () => {
    setLang('en');
    expect(t('stReserveDays', { n: '2.5' })).toBe('≈ 2.5 days');
    expect(t('stReserveDays')).toBe('≈ {n} days');
    setLang('mk');
    expect(t('stReserveDays', { n: '2,5' })).toBe('≈ 2,5 дена');
    expect(monthName(11)).toBe('Декември');
  });

  it('defaults to English unless the browser prefers Macedonian', () => {
    expect(detectLang(['en-US', 'de'])).toBe('en');
    expect(detectLang(['de-DE', 'mk-MK'])).toBe('mk');
    expect(detectLang(['MK'])).toBe('mk');
    expect(detectLang([])).toBe('en');
    expect(detectLang('mk')).toBe('mk');
  });
});
