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

/** ceil() that ignores floating-point noise (5.0000000001 -> 5). */
export function ceilSafe(x) {
  return Math.ceil(x - 1e-9);
}

/** Hours in the night window [start, end), wrapping over midnight. */
export function nightHours(start, end) {
  if (end < start) return 24 - start + end;
  return end - start;
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

/** Day/night split of daily consumption (flat hourly load, 17:00–08:00 night). */
export function loadSplit({ dailyConsumption }) {
  const nightStart = 17;
  const nightEnd = 8;
  const nh = nightHours(nightStart, nightEnd);
  const night = nh * (dailyConsumption / 24);
  return { nightStart, nightEnd, nightHours: nh, dayHours: 24 - nh, night, daytime: dailyConsumption - night };
}

/**
 * Battery the night needs.
 * usable = energy discharged per night; gross = usable / DoD (the DoD reserve
 * is never discharged); chargePerDay = what PV must put back each day.
 */
export function batteryRequirement({ night, dodPct }) {
  const usableNeeded = night;
  return { usableNeeded, grossNeeded: usableNeeded / (dodPct / 100), chargePerDay: usableNeeded };
}

/** Smallest panel count that covers daytime load + daily battery charge in the worst month. */
export function recommendPanels({ daytime, chargePerDay, perPanelWorst }) {
  if (!(perPanelWorst > 0)) return { panelsForDaytime: Infinity, panelsForCharge: Infinity, panels: Infinity };
  const panelsForDaytime = ceilSafe(daytime / perPanelWorst);
  const panelsForCharge = ceilSafe((daytime + chargePerDay) / perPanelWorst);
  return { panelsForDaytime, panelsForCharge, panels: Math.max(1, panelsForDaytime, panelsForCharge) };
}

function check(id, lhs, rhs) {
  return { id, lhs, rhs, status: lhs >= rhs - EPS ? 'pass' : 'fail' };
}

/**
 * Main entry point.
 *
 * mode 'size'  -> recommend panels + battery (a recommendation, not a verdict)
 * mode 'check' -> evaluate the user's installed panels + battery against
 *                 three worst-month checks that can genuinely fail
 */
export function evaluate(p) {
  const mode = p.mode === MODE_CHECK ? MODE_CHECK : MODE_SIZE;
  const worst = worstMonth(p.monthlyYield);
  const load = loadSplit(p);
  const battery = batteryRequirement({ night: load.night, dodPct: p.dodPct });
  const perPanelWorst = worst.dailyPerKwp * (p.panelWp / 1000);
  const sizing = recommendPanels({ daytime: load.daytime, chargePerDay: battery.chargePerDay, perPanelWorst });

  let panels;
  let batteryGross;
  if (mode === MODE_SIZE) {
    panels = sizing.panels;
    batteryGross = battery.grossNeeded;
  } else {
    panels = Math.max(0, Math.round(p.panels || 0));
    batteryGross = Math.max(0, p.batteryKwh || 0);
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

  const checks = [
    check('daytime', solarDailyWorst, load.daytime),
    check('recharge', surplusWorst, battery.chargePerDay),
    check('night', batteryUsable, battery.usableNeeded),
  ];
  const verdict = mode === MODE_SIZE ? 'recommendation' : checks.every((c) => c.status !== 'fail') ? 'pass' : 'fail';

  return {
    mode, worst, load, battery, perPanelWorst, sizing,
    system: { panels, kWp, batteryGross, batteryUsable },
    series, annualProduction, annualConsumption, selfSufficiency,
    solarDailyWorst, surplusWorst,
    inverterRaw, inverter: Math.ceil(inverterRaw / 5) * 5,
    checks, verdict,
  };
}
