import { describe, it, expect } from 'vitest';
import { nightHours, worstMonth, ceilSafe, evaluate } from '../src/calc.js';
import { findCity } from '../src/data.js';

const skopje = findCity('skopje');

describe('nightHours', () => {
  it('wraps over midnight', () => {
    expect(nightHours(17, 8)).toBe(15);
    expect(nightHours(22, 6)).toBe(8);
  });
  it('handles windows that do not cross midnight', () => {
    expect(nightHours(1, 5)).toBe(4);
  });
});

describe('ceilSafe', () => {
  it('ignores floating-point noise', () => {
    expect(ceilSafe(5.0000000000001)).toBe(5);
    expect(ceilSafe(5.01)).toBe(6);
  });
});

describe('worstMonth', () => {
  it('picks December for the Skopje table (lowest kWh/kWp/day)', () => {
    const w = worstMonth(skopje.pvout);
    expect(w.index).toBe(11);
    expect(w.dailyPerKwp).toBeCloseTo(62.1 / 31, 6);
  });
});

describe('v1 engine (documents current behaviour)', () => {
  const base = { monthlyYield: skopje.pvout, panelWp: 590, dailyConsumption: 18, dodPct: 95 };

  it('auto-sized panels cover daytime load plus battery charge in the worst month', () => {
    const r = evaluate(base);
    expect(r.solarDailyWorst).toBeGreaterThanOrEqual(r.daytime + r.batteryGross - 1e-9);
  });

  it('FLAW: the verdict can never be red, whatever the inputs', () => {
    for (const dailyConsumption of [0.5, 5, 18, 80, 400]) {
      for (const dodPct of [70, 85, 100]) {
        expect(evaluate({ ...base, dailyConsumption, dodPct }).allPass).toBe(true);
      }
    }
  });
});
