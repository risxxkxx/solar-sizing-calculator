/**
 * Solar PV + battery sizing engine.
 *
 * Pure functions only: no DOM, no fetch, no globals. Everything the UI shows is
 * computed here so it can be unit-tested.
 *
 * Units: energy kWh, power kW, angles degrees, percentages 0–100.
 */
import { DAYS_IN_MONTH } from './data.js';

const EPS = 1e-9;

export const MODE_SIZE = 'size';
export const MODE_CHECK = 'check';

/** Default inputs. Night share `null` means "proportional to night hours". */
export const DEFAULTS = Object.freeze({
  mode: MODE_SIZE,
  panelWp: 590,
  dailyConsumption: 18,
  dodPct: 95,
  efficiencyPct: 92,
  autonomyDays: 1,
  nightStart: 17,
  nightEnd: 8,
  nightSharePct: null,
  panels: 12,
  batteryKwh: 10,
  peakLoadKw: 5,
  dcAcRatio: 1.2,
});

/** Common inverter AC ratings (kW). */
export const INVERTER_SIZES = [3, 3.6, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50];

function num(v, fallback) {
  const n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : v;
  return Number.isFinite(n) ? n : fallback;
}
function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

/** Coerce raw (possibly string / missing) UI values into a safe input object. */
export function normalizeInputs(raw = {}) {
  const d = DEFAULTS;
  const share = raw.nightSharePct;
  return {
    ...raw,
    mode: raw.mode === MODE_CHECK ? MODE_CHECK : MODE_SIZE,
    panelWp: clamp(num(raw.panelWp, d.panelWp), 50, 1000),
    dailyConsumption: clamp(num(raw.dailyConsumption, d.dailyConsumption), 0, 100000),
    dodPct: clamp(num(raw.dodPct, d.dodPct), 50, 100),
    efficiencyPct: clamp(num(raw.efficiencyPct, d.efficiencyPct), 50, 100),
    autonomyDays: clamp(Math.round(num(raw.autonomyDays, d.autonomyDays)), 0, 3),
    nightStart: clamp(Math.round(num(raw.nightStart, d.nightStart)), 0, 23),
    nightEnd: clamp(Math.round(num(raw.nightEnd, d.nightEnd)), 0, 23),
    nightSharePct: share === null || share === undefined || share === '' ? null : clamp(num(share, 0), 0, 100),
    panels: clamp(Math.round(num(raw.panels, d.panels)), 0, 100000),
    batteryKwh: clamp(num(raw.batteryKwh, d.batteryKwh), 0, 100000),
    peakLoadKw: clamp(num(raw.peakLoadKw, d.peakLoadKw), 0, 10000),
    dcAcRatio: clamp(num(raw.dcAcRatio, d.dcAcRatio), 0.8, 1.6),
  };
}

/** ceil() that ignores floating-point noise (5.0000000001 -> 5). */
export function ceilSafe(x) {
  return Math.ceil(x - 1e-9);
}

/**
 * Hours in the night window [start, end), wrapping over midnight.
 * start === end is treated as "no night window" (0 h).
 */
export function nightHours(start, end) {
  if (end < start) return 24 - start + end;
  return end - start;
}

/** Night share if load were flat over 24 h (v1 behaviour), in %. */
export function proportionalNightShare(start, end) {
  return (nightHours(start, end) / 24) * 100;
}

/**
 * APPROXIMATE OFFLINE orientation model (used only when PVGIS is unavailable).
 *
 * Returns annual yield relative to the table reference (34° tilt, south),
 * calibrated for ~41–42° N. Anchor values (fraction of optimum) at tilts
 * 0° / 34° / 90°:
 *
 *   south      0.87 / 1.00  / 0.64
 *   east/west  0.87 / 0.82  / 0.57
 *   north      0.87 / 0.575 / 0.28
 *
 * Each row is a quadratic in tilt through its three anchors. Azimuth is then
 * blended with f(d) = a + b·cos(d) + c·cos(2d), d = angular distance from
 * south (0–180°), which hits the south / east-west / north rows exactly.
 * One annual factor is applied to every month, so the seasonal shape is not
 * modelled (vertical arrays are relatively better in winter in reality).
 */
export const ORIENTATION_ANCHORS = Object.freeze({
  tilts: [0, 34, 90],
  south: [0.87, 1.0, 0.64],
  eastWest: [0.87, 0.82, 0.57],
  north: [0.87, 0.575, 0.28],
});

function quadThrough([x0, x1, x2], [y0, y1, y2], x) {
  // Lagrange interpolation through three points
  return (
    (y0 * (x - x1) * (x - x2)) / ((x0 - x1) * (x0 - x2)) +
    (y1 * (x - x0) * (x - x2)) / ((x1 - x0) * (x1 - x2)) +
    (y2 * (x - x0) * (x - x1)) / ((x2 - x0) * (x2 - x1))
  );
}

/** Angular distance from south (0–180°) for a compass azimuth (0=N, 90=E, 180=S, 270=W). */
export function azimuthDeviation(azimuth) {
  const a = ((azimuth % 360) + 360) % 360;
  return Math.abs(a - 180);
}

export function orientationFactor(tilt, azimuth) {
  const t = clamp(tilt, 0, 90);
  const A = ORIENTATION_ANCHORS;
  const S = quadThrough(A.tilts, A.south, t);
  const EW = quadThrough(A.tilts, A.eastWest, t);
  const N = quadThrough(A.tilts, A.north, t);
  const b = (S - N) / 2;
  const a = ((S + N) / 2 + EW) / 2;
  const c = ((S + N) / 2 - EW) / 2;
  const d = (azimuthDeviation(azimuth) * Math.PI) / 180;
  return clamp(a + b * Math.cos(d) + c * Math.cos(2 * d), 0.2, 1);
}

/** Offline monthly yield: bundled table (34°/S) × orientation factor. */
export function fallbackYield(pvout, tilt, azimuth) {
  const factor = orientationFactor(tilt, azimuth);
  return { factor, monthly: pvout.map((v) => v * factor) };
}

/** True if `m` is 12 finite, non-negative monthly values with a positive sum. */
export function isValidMonthly(m) {
  return Array.isArray(m) && m.length === 12 && m.every((v) => Number.isFinite(v) && v >= 0) && m.some((v) => v > 0);
}

/** Month with the lowest DAILY specific yield (kWh/kWp/day). */
export function worstMonth(monthlyYield) {
  const daily = monthlyYield.map((v, i) => v / DAYS_IN_MONTH[i]);
  const index = daily.indexOf(Math.min(...daily));
  return { index, dailyPerKwp: daily[index] };
}

export function monthlySeries(kWp, monthlyYield, dailyConsumption) {
  const production = monthlyYield.map((v) => kWp * v);
  const dailyProduction = production.map((v, i) => v / DAYS_IN_MONTH[i]);
  const consumption = DAYS_IN_MONTH.map((d) => dailyConsumption * d);
  const balance = production.map((v, i) => v - consumption[i]);
  return { production, dailyProduction, consumption, balance };
}

/**
 * Day/night split of daily consumption.
 * nightSharePct = share of the daily kWh used inside the night window. When
 * null, it defaults to the flat-load assumption (proportional to hours).
 */
export function loadSplit({ dailyConsumption, nightStart, nightEnd, nightSharePct = null }) {
  const nh = nightHours(nightStart, nightEnd);
  const proportional = nightSharePct === null || nightSharePct === undefined;
  const sharePct = proportional ? proportionalNightShare(nightStart, nightEnd) : nightSharePct;
  const night = dailyConsumption * (sharePct / 100);
  return {
    nightStart, nightEnd, nightHours: nh, dayHours: 24 - nh,
    nightSharePct: sharePct, proportional,
    night, daytime: dailyConsumption - night,
  };
}

/**
 * Battery requirement.
 *
 * autonomyDays = 0 : no battery is sized (night load comes from the grid)
 * autonomyDays = 1 : battery covers one night (normal daily cycle)
 * autonomyDays = N : one night + (N-1) full sunless days
 *
 * usableNeeded = night + (N-1) * daily
 * grossNeeded  = usableNeeded / DoD          (DoD reserve is never discharged)
 * chargePerDay = night / round-trip eff.     (PV energy to refill one night)
 * reserve      = usableNeeded - night        (extra autonomy buffer)
 */
export function batteryRequirement({ night, daily, autonomyDays, dodPct, efficiencyPct }) {
  const n = Math.max(0, Math.round(autonomyDays));
  const eff = efficiencyPct / 100;
  const usableNeeded = n === 0 ? 0 : night + (n - 1) * daily;
  return {
    autonomyDays: n,
    usableNeeded,
    grossNeeded: usableNeeded / (dodPct / 100),
    chargePerDay: n === 0 ? 0 : night / eff,
    reserve: Math.max(0, usableNeeded - night),
    efficiency: eff,
  };
}

/**
 * Days needed to refill an autonomy reserve from the PV surplus left over in
 * the worst month after the normal nightly recharge. Infinity = it does not
 * refill in the worst month (it will in sunnier months).
 */
export function reserveRefillDays({ reserve, efficiency, leftoverSurplus }) {
  if (!(reserve > EPS)) return 0;
  if (!(leftoverSurplus > EPS)) return Infinity;
  return reserve / efficiency / leftoverSurplus;
}

/** Smallest panel count that covers daytime load + daily battery charge in the worst month. */
export function recommendPanels({ daytime, chargePerDay, perPanelWorst }) {
  if (!(perPanelWorst > 0)) return { panelsForDaytime: Infinity, panelsForCharge: Infinity, panels: Infinity };
  const panelsForDaytime = ceilSafe(daytime / perPanelWorst);
  const panelsForCharge = ceilSafe((daytime + chargePerDay) / perPanelWorst);
  return { panelsForDaytime, panelsForCharge, panels: Math.max(1, panelsForDaytime, panelsForCharge) };
}

/**
 * Round up to the next common inverter size. Above the largest listed size,
 * round up to the next 10 kW (several inverters / larger commercial units).
 */
export function roundUpInverter(kw) {
  if (!(kw > 0)) return INVERTER_SIZES[0];
  const hit = INVERTER_SIZES.find((s) => s >= kw - EPS);
  return hit !== undefined ? hit : ceilSafe(kw / 10) * 10;
}

/**
 * Inverter AC rating >= max(peak load, kWp / DC-AC ratio).
 * A DC/AC ratio of ~1.1–1.3 is normal: panels rarely reach STC power, so the
 * inverter may be smaller than the array (v1 oversized it with kWp * 1.1).
 */
export function sizeInverter({ peakLoadKw, kWp, dcAcRatio }) {
  const fromLoad = Math.max(0, peakLoadKw);
  const fromPv = dcAcRatio > 0 ? kWp / dcAcRatio : kWp;
  const raw = Math.max(fromLoad, fromPv);
  return { fromLoad, fromPv, raw, size: roundUpInverter(raw), drivenBy: fromPv > fromLoad ? 'pv' : 'load' };
}

function check(id, lhs, rhs, applicable = true) {
  if (!applicable) return { id, lhs, rhs, status: 'na' };
  return { id, lhs, rhs, status: lhs >= rhs - EPS ? 'pass' : 'fail' };
}

/**
 * Main entry point.
 *
 * mode 'size'  -> recommend panels + battery (a recommendation, not a verdict)
 * mode 'check' -> evaluate the user's installed panels + battery against
 *                 three worst-month checks that can genuinely fail
 */
export function evaluate(input) {
  const p = normalizeInputs(input);
  const mode = p.mode;
  const worst = worstMonth(p.monthlyYield);
  const load = loadSplit(p);
  const battery = batteryRequirement({
    night: load.night, daily: p.dailyConsumption,
    autonomyDays: p.autonomyDays, dodPct: p.dodPct, efficiencyPct: p.efficiencyPct,
  });
  const hasBattery = battery.autonomyDays > 0;
  const perPanelWorst = worst.dailyPerKwp * (p.panelWp / 1000);
  const sizing = recommendPanels({ daytime: load.daytime, chargePerDay: battery.chargePerDay, perPanelWorst });

  let panels;
  let batteryGross;
  if (mode === MODE_SIZE) {
    panels = sizing.panels;
    batteryGross = battery.grossNeeded;
  } else {
    panels = p.panels;
    batteryGross = p.batteryKwh;
  }
  const batteryUsable = batteryGross * (p.dodPct / 100);
  const kWp = (panels * p.panelWp) / 1000;

  const series = monthlySeries(kWp, p.monthlyYield, p.dailyConsumption);
  const annualProduction = series.production.reduce((a, b) => a + b, 0);
  const annualConsumption = p.dailyConsumption * 365;
  // "Theoretical annual coverage": ignores the timing mismatch between
  // production and use (summer surplus cannot cover winter, daytime PV cannot
  // cover the night without storage). Real self-sufficiency is lower.
  const theoreticalCoverage = annualConsumption > 0 ? (Math.min(annualProduction, annualConsumption) / annualConsumption) * 100 : 100;

  const solarDailyWorst = series.dailyProduction[worst.index];
  const surplusWorst = solarDailyWorst - load.daytime;
  const inverter = sizeInverter({ peakLoadKw: p.peakLoadKw, kWp, dcAcRatio: p.dcAcRatio });

  const leftoverSurplus = surplusWorst - battery.chargePerDay;
  const reserve = mode === MODE_SIZE ? battery.reserve : Math.max(0, batteryUsable - load.night);
  const refillDays = hasBattery ? reserveRefillDays({ reserve, efficiency: battery.efficiency, leftoverSurplus }) : 0;

  const checks = [
    check('daytime', solarDailyWorst, load.daytime),
    check('recharge', surplusWorst, battery.chargePerDay, hasBattery),
    check('night', batteryUsable, battery.usableNeeded, hasBattery),
  ];
  const verdict = mode === MODE_SIZE ? 'recommendation' : checks.every((c) => c.status !== 'fail') ? 'pass' : 'fail';

  return {
    mode, worst, load, battery, perPanelWorst, sizing,
    system: { panels, kWp, batteryGross, batteryUsable },
    series, annualProduction, annualConsumption, theoreticalCoverage,
    solarDailyWorst, surplusWorst, leftoverSurplus, reserve, refillDays,
    inverter,
    checks, verdict,
  };
}
