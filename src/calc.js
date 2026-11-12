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
});

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

/** v1 orientation correction relative to 34° / south. */
export function orientationFactor(tilt, azimuth) {
  const tiltFactor = Math.max(0.05, Math.cos((Math.abs(tilt - 34) * Math.PI) / 180));
  const azFactor = Math.max(0.05, Math.cos(((Math.abs(azimuth - 180) * Math.PI) / 180) * 0.5));
  return tiltFactor * azFactor;
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
  const selfSufficiency = annualConsumption > 0 ? (Math.min(annualProduction, annualConsumption) / annualConsumption) * 100 : 100;

  const solarDailyWorst = series.dailyProduction[worst.index];
  const surplusWorst = solarDailyWorst - load.daytime;
  const inverterRaw = Math.max(p.dailyConsumption / 6, kWp * 1.1);

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
    series, annualProduction, annualConsumption, selfSufficiency,
    solarDailyWorst, surplusWorst, leftoverSurplus, reserve, refillDays,
    inverterRaw, inverter: Math.ceil(inverterRaw / 5) * 5,
    checks, verdict,
  };
}
