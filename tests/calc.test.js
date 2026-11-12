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

describe('evaluate: size mode vs check mode', () => {
  const base = { monthlyYield: skopje.pvout, panelWp: 590, dailyConsumption: 18, dodPct: 95 };

  it('size mode returns a recommendation, not a pass/fail verdict', () => {
    const r = evaluate({ ...base, mode: 'size' });
    expect(r.verdict).toBe('recommendation');
    expect(r.system.panels).toBeGreaterThan(0);
  });

  it('the auto-sized system passes all checks when entered in check mode', () => {
    for (const dailyConsumption of [2, 18, 60]) {
      const rec = evaluate({ ...base, dailyConsumption, mode: 'size' });
      const chk = evaluate({
        ...base, dailyConsumption, mode: 'check',
        panels: rec.system.panels, batteryKwh: rec.system.batteryGross,
      });
      expect(chk.verdict).toBe('pass');
    }
  });

  it('check mode fails when the battery is undersized', () => {
    const r = evaluate({ ...base, mode: 'check', panels: 40, batteryKwh: 2 });
    expect(r.checks.find((c) => c.id === 'night').status).toBe('fail');
    expect(r.verdict).toBe('fail');
  });

  it('check mode fails when the array is undersized', () => {
    const r = evaluate({ ...base, mode: 'check', panels: 3, batteryKwh: 20 });
    expect(r.checks.find((c) => c.id === 'daytime').status).toBe('fail');
    expect(r.checks.find((c) => c.id === 'recharge').status).toBe('fail');
    expect(r.verdict).toBe('fail');
  });

  it('daily recharge requirement is the discharged (usable) energy, not gross capacity', () => {
    const r = evaluate({ ...base, mode: 'size', dodPct: 80 });
    expect(r.battery.chargePerDay).toBeCloseTo(r.load.night, 9);
    expect(r.battery.grossNeeded).toBeCloseTo(r.load.night / 0.8, 9);
  });
});
