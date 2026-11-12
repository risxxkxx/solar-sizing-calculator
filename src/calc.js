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

/**
 * v1 behaviour, extracted unchanged: auto-size panels for the worst month and
 * run the three checks.
 */
export function evaluate({ monthlyYield, panelWp, dailyConsumption, dodPct }) {
  const nightStart = 17;
  const nightEnd = 8;
  const worst = worstMonth(monthlyYield);

  const nh = nightHours(nightStart, nightEnd);
  const daytime = (24 - nh) * (dailyConsumption / 24);
  const night = nh * (dailyConsumption / 24);
  const batteryGross = night / (dodPct / 100);

  const perPanelWorst = worst.dailyPerKwp * (panelWp / 1000);
  const panels = Math.max(1, ceilSafe(daytime / perPanelWorst), ceilSafe((daytime + batteryGross) / perPanelWorst));
  const kWp = (panels * panelWp) / 1000;

  const series = monthlySeries(kWp, monthlyYield, dailyConsumption);
  const annualProduction = series.production.reduce((a, b) => a + b, 0);
  const annualConsumption = dailyConsumption * 365;
  const selfSufficiency = annualConsumption > 0 ? (Math.min(annualProduction, annualConsumption) / annualConsumption) * 100 : 100;

  const solarDailyWorst = series.dailyProduction[worst.index];
  const surplus = solarDailyWorst - daytime;
  const inverterRaw = Math.max(dailyConsumption / 6, kWp * 1.1);

  const check1 = solarDailyWorst >= daytime - EPS;
  const check2 = surplus >= batteryGross - EPS;
  const check3 = batteryGross * (dodPct / 100) >= night - EPS;

  return {
    worst, nightStart, nightEnd, nightHours: nh, daytime, night, batteryGross,
    panels, kWp, series, annualProduction, annualConsumption, selfSufficiency,
    solarDailyWorst, surplus, inverterRaw, inverter: Math.ceil(inverterRaw / 5) * 5,
    checks: [check1, check2, check3], allPass: check1 && check2 && check3,
  };
}
