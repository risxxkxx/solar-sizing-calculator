import { describe, it, expect } from 'vitest';
import {
  nightHours, worstMonth, ceilSafe, evaluate, loadSplit, batteryRequirement,
  reserveRefillDays, normalizeInputs, proportionalNightShare,
  roundUpInverter, sizeInverter, orientationFactor, fallbackYield, azimuthDeviation, isValidMonthly,
} from '../src/calc.js';
import { findCity } from '../src/data.js';

const skopje = findCity('skopje');

describe('nightHours', () => {
  it('wraps over midnight', () => {
    expect(nightHours(17, 8)).toBe(15);
    expect(nightHours(22, 6)).toBe(8);
  });
  it('handles windows that do not cross midnight', () => {
    expect(nightHours(1, 5)).toBe(4);
    expect(nightHours(0, 6)).toBe(6);
  });
  it('treats start === end as no night window', () => {
    expect(nightHours(8, 8)).toBe(0);
  });
});

describe('loadSplit', () => {
  it('defaults to a flat (proportional) load: 15/24 of the day at night for 17–08', () => {
    const l = loadSplit({ dailyConsumption: 24, nightStart: 17, nightEnd: 8, nightSharePct: null });
    expect(l.proportional).toBe(true);
    expect(l.nightSharePct).toBeCloseTo(62.5, 9);
    expect(l.night).toBeCloseTo(15, 9);
    expect(l.daytime).toBeCloseTo(9, 9);
    expect(proportionalNightShare(17, 8)).toBeCloseTo(62.5, 9);
  });
  it('uses an explicit night share when given', () => {
    const l = loadSplit({ dailyConsumption: 20, nightStart: 17, nightEnd: 8, nightSharePct: 40 });
    expect(l.proportional).toBe(false);
    expect(l.night).toBeCloseTo(8, 9);
    expect(l.daytime).toBeCloseTo(12, 9);
  });
});

describe('batteryRequirement (autonomy, DoD, round-trip efficiency)', () => {
  const base = { night: 10, daily: 18, dodPct: 90, efficiencyPct: 92 };

  it('1 day of autonomy = one night', () => {
    const b = batteryRequirement({ ...base, autonomyDays: 1 });
    expect(b.usableNeeded).toBeCloseTo(10, 9);
    expect(b.grossNeeded).toBeCloseTo(10 / 0.9, 9);
    expect(b.chargePerDay).toBeCloseTo(10 / 0.92, 9);
    expect(b.reserve).toBe(0);
  });
  it('N days = one night + (N-1) full days', () => {
    const b = batteryRequirement({ ...base, autonomyDays: 3 });
    expect(b.usableNeeded).toBeCloseTo(10 + 2 * 18, 9);
    expect(b.reserve).toBeCloseTo(36, 9);
    // daily recharge still only refills one night
    expect(b.chargePerDay).toBeCloseTo(10 / 0.92, 9);
  });
  it('0 days = no battery', () => {
    const b = batteryRequirement({ ...base, autonomyDays: 0 });
    expect(b.usableNeeded).toBe(0);
    expect(b.grossNeeded).toBe(0);
    expect(b.chargePerDay).toBe(0);
  });
  it('lower efficiency means more PV energy per kWh delivered', () => {
    const a = batteryRequirement({ ...base, autonomyDays: 1, efficiencyPct: 100 });
    const b = batteryRequirement({ ...base, autonomyDays: 1, efficiencyPct: 80 });
    expect(a.chargePerDay).toBeCloseTo(10, 9);
    expect(b.chargePerDay).toBeCloseTo(12.5, 9);
  });
});

describe('reserveRefillDays', () => {
  it('computes days from leftover surplus', () => {
    expect(reserveRefillDays({ reserve: 9.2, efficiency: 0.92, leftoverSurplus: 2 })).toBeCloseTo(5, 9);
  });
  it('returns 0 without a reserve and Infinity without leftover surplus', () => {
    expect(reserveRefillDays({ reserve: 0, efficiency: 0.92, leftoverSurplus: 2 })).toBe(0);
    expect(reserveRefillDays({ reserve: 5, efficiency: 0.92, leftoverSurplus: 0 })).toBe(Infinity);
  });
});

describe('normalizeInputs', () => {
  it('fills defaults, parses decimal commas and clamps ranges', () => {
    const n = normalizeInputs({ dailyConsumption: '12,5', autonomyDays: 7, dodPct: 20, nightStart: 30, nightSharePct: '' });
    expect(n.dailyConsumption).toBe(12.5);
    expect(n.autonomyDays).toBe(3);
    expect(n.dodPct).toBe(50);
    expect(n.nightStart).toBe(23);
    expect(n.nightSharePct).toBeNull();
    expect(n.panelWp).toBe(590);
    expect(n.efficiencyPct).toBe(92);
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
      for (const autonomyDays of [0, 1, 2, 3]) {
        for (const nightSharePct of [null, 30, 80]) {
          const opts = { ...base, dailyConsumption, autonomyDays, nightSharePct, efficiencyPct: 88 };
          const rec = evaluate({ ...opts, mode: 'size' });
          const chk = evaluate({ ...opts, mode: 'check', panels: rec.system.panels, batteryKwh: rec.system.batteryGross });
          expect(chk.verdict).toBe('pass');
        }
      }
    }
  });

  it('autonomy 0 marks the battery checks as not applicable', () => {
    const r = evaluate({ ...base, mode: 'check', panels: 10, batteryKwh: 0, autonomyDays: 0 });
    expect(r.checks.map((c) => c.status)).toEqual(['pass', 'na', 'na']);
  });

  it('efficiency losses are included in the recharge check', () => {
    const rec = evaluate({ ...base, mode: 'size', efficiencyPct: 100 });
    // same panels, worse efficiency -> recharge requirement grows
    const chk = evaluate({ ...base, mode: 'check', efficiencyPct: 60, panels: rec.system.panels, batteryKwh: rec.system.batteryGross });
    expect(chk.battery.chargePerDay).toBeGreaterThan(rec.battery.chargePerDay);
    expect(chk.checks.find((c) => c.id === 'recharge').status).toBe('fail');
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
    expect(r.battery.chargePerDay).toBeCloseTo(r.load.night / 0.92, 9);
    expect(r.battery.grossNeeded).toBeCloseTo(r.load.night / 0.8, 9);
  });
});

describe('inverter sizing', () => {
  it('rounds up to common sizes', () => {
    expect(roundUpInverter(2)).toBe(3);
    expect(roundUpInverter(3)).toBe(3);
    expect(roundUpInverter(3.2)).toBe(3.6);
    expect(roundUpInverter(5.0000000001)).toBe(5);
    expect(roundUpInverter(5.01)).toBe(6);
    expect(roundUpInverter(10.5)).toBe(12);
    expect(roundUpInverter(50)).toBe(50);
    expect(roundUpInverter(51)).toBe(60);
    expect(roundUpInverter(0)).toBe(3);
  });

  it('is driven by the PV array when kWp / ratio exceeds peak load', () => {
    const inv = sizeInverter({ peakLoadKw: 5, kWp: 12, dcAcRatio: 1.2 });
    expect(inv.fromPv).toBeCloseTo(10, 9);
    expect(inv.raw).toBeCloseTo(10, 9);
    expect(inv.size).toBe(10);
    expect(inv.drivenBy).toBe('pv');
  });

  it('is driven by peak load for small arrays', () => {
    const inv = sizeInverter({ peakLoadKw: 7, kWp: 6, dcAcRatio: 1.2 });
    expect(inv.size).toBe(8);
    expect(inv.drivenBy).toBe('load');
  });

  it('no longer oversizes relative to PV (v1 used kWp * 1.1, rounded to 5 kW steps)', () => {
    const kWp = 18 * 0.59; // 10.62 kWp
    const v1 = Math.ceil(Math.max(18 / 6, kWp * 1.1) / 5) * 5; // 11.68 -> 15 kW
    const v2 = sizeInverter({ peakLoadKw: 5, kWp, dcAcRatio: 1.2 }).size; // 8.85 -> 10 kW
    expect(v1).toBe(15);
    expect(v2).toBe(10);
  });
});

describe('offline orientation model (fallback)', () => {
  it('is 1.0 at the table reference (34°, south)', () => {
    expect(orientationFactor(34, 180)).toBeCloseTo(1, 6);
  });
  it('flat roof ≈ 0.85–0.90 regardless of azimuth', () => {
    for (const az of [0, 90, 180, 270]) {
      const f = orientationFactor(0, az);
      expect(f).toBeGreaterThanOrEqual(0.85);
      expect(f).toBeLessThanOrEqual(0.9);
    }
  });
  it('vertical south facade ≈ 0.60–0.65', () => {
    const f = orientationFactor(90, 180);
    expect(f).toBeGreaterThanOrEqual(0.6);
    expect(f).toBeLessThanOrEqual(0.65);
  });
  it('east and west at 34° ≈ 0.80–0.85 and symmetric', () => {
    const e = orientationFactor(34, 90);
    const w = orientationFactor(34, 270);
    expect(e).toBeCloseTo(w, 9);
    expect(e).toBeGreaterThanOrEqual(0.8);
    expect(e).toBeLessThanOrEqual(0.85);
  });
  it('north at 34° ≈ 0.55–0.60 (v1 clamped this to 0.05)', () => {
    const f = orientationFactor(34, 0);
    expect(f).toBeGreaterThanOrEqual(0.55);
    expect(f).toBeLessThanOrEqual(0.6);
  });
  it('stays within [0.2, 1] over the whole input grid', () => {
    for (let t = 0; t <= 90; t += 5) {
      for (let az = 0; az < 360; az += 15) {
        const f = orientationFactor(t, az);
        expect(f).toBeGreaterThanOrEqual(0.2);
        expect(f).toBeLessThanOrEqual(1);
      }
    }
  });
  it('decreases as a 34° array turns away from south', () => {
    let prev = Infinity;
    for (let d = 0; d <= 180; d += 10) {
      const f = orientationFactor(34, 180 + d);
      expect(f).toBeLessThanOrEqual(prev + 1e-12);
      prev = f;
    }
  });
  it('normalises azimuth', () => {
    expect(azimuthDeviation(-90)).toBe(90);
    expect(azimuthDeviation(540)).toBe(0);
  });
  it('fallbackYield scales the table and validates', () => {
    const r = fallbackYield(skopje.pvout, 0, 180);
    expect(r.monthly[0]).toBeCloseTo(skopje.pvout[0] * r.factor, 9);
    expect(isValidMonthly(r.monthly)).toBe(true);
    expect(isValidMonthly([1, 2, 3])).toBe(false);
    expect(isValidMonthly(new Array(12).fill(0))).toBe(false);
  });
});

describe('theoretical annual coverage', () => {
  it('is capped at 100% and labelled as theoretical', () => {
    const r = evaluate({ monthlyYield: skopje.pvout, panelWp: 590, dailyConsumption: 1, mode: 'check', panels: 20, batteryKwh: 5 });
    expect(r.theoreticalCoverage).toBe(100);
    expect(r).not.toHaveProperty('selfSufficiency');
  });
});
