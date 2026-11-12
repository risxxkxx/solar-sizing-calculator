/**
 * PVGIS (EU JRC Photovoltaic Geographical Information System) helpers.
 * Pure functions shared by the Netlify proxy function and the tests.
 *
 * API docs: https://joint-research-centre.ec.europa.eu/photovoltaic-geographical-information-system-pvgis/getting-started-pvgis/api-non-interactive-service_en
 * PVGIS does not allow browser (AJAX/CORS) calls, hence the server-side proxy.
 */
export const PVGIS_VERSION = '5.3';
export const PVGIS_BASE_URL = 'https://re.jrc.ec.europa.eu/api/v5_3/PVcalc';
export const PVGIS_LOSS_PCT = 14;

function toNum(v) {
  if (v === null || v === undefined || v === '') return NaN;
  return typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
}

/** Compass azimuth (0=N, 90=E, 180=S, 270=W) -> PVGIS aspect (0=S, -90=E, 90=W). */
export function azimuthToAspect(azimuth) {
  const a = ((Math.round(azimuth) % 360) + 360) % 360;
  return a - 180; // -180..179
}

/**
 * Validate and clamp query parameters.
 * lat/lng are required (rejected if missing or out of range); tilt is clamped
 * to 0–90 and azimuth normalised to 0–359. Coordinates are rounded to 0.01°
 * (~1 km, finer than the PVGIS radiation grid) so responses cache well.
 */
export function sanitizePvgisQuery(params = {}) {
  const lat = toNum(params.lat);
  const lng = toNum(params.lng ?? params.lon);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return { ok: false, error: 'lat must be a number between -90 and 90' };
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) return { ok: false, error: 'lng must be a number between -180 and 180' };
  let tilt = toNum(params.tilt);
  if (!Number.isFinite(tilt)) tilt = 34;
  tilt = Math.round(Math.min(90, Math.max(0, tilt)));
  let azimuth = toNum(params.azimuth);
  if (!Number.isFinite(azimuth)) azimuth = 180;
  azimuth = ((Math.round(azimuth) % 360) + 360) % 360;
  return {
    ok: true,
    value: {
      lat: Math.round(lat * 100) / 100,
      lng: Math.round(lng * 100) / 100,
      tilt,
      azimuth,
      aspect: azimuthToAspect(azimuth),
    },
  };
}

/** PVcalc URL for a 1 kWp system, so E_m is directly kWh/kWp. */
export function buildPvgisUrl({ lat, lng, tilt, aspect }) {
  const qs = new URLSearchParams({
    lat: String(lat),
    lon: String(lng),
    peakpower: '1',
    loss: String(PVGIS_LOSS_PCT),
    angle: String(tilt),
    aspect: String(aspect),
    outputformat: 'json',
  });
  return `${PVGIS_BASE_URL}?${qs}`;
}

/**
 * Extract monthly specific yield from a PVcalc JSON response.
 * Expected shape (abridged):
 *   { inputs: { meteo_data: { radiation_db, year_min, year_max } },
 *     outputs: { monthly: { fixed: [ { month: 1..12, E_d, E_m, ... } ] },
 *                totals:  { fixed: { E_y, ... } } } }
 * Throws on anything that does not look like 12 valid months.
 */
export function parsePvgisResponse(json) {
  const fixed = json && json.outputs && json.outputs.monthly && json.outputs.monthly.fixed;
  if (!Array.isArray(fixed) || fixed.length !== 12) throw new Error('PVGIS response: expected 12 monthly values');
  const monthly = new Array(12).fill(NaN);
  for (const row of fixed) {
    const m = Number(row && row.month);
    const e = Number(row && row.E_m);
    if (!Number.isInteger(m) || m < 1 || m > 12) throw new Error('PVGIS response: invalid month');
    if (!Number.isFinite(e) || e < 0) throw new Error(`PVGIS response: invalid E_m for month ${m}`);
    monthly[m - 1] = e;
  }
  if (monthly.some((v) => Number.isNaN(v))) throw new Error('PVGIS response: duplicate or missing months');
  const totals = json.outputs.totals && json.outputs.totals.fixed;
  const annual = totals && Number.isFinite(Number(totals.E_y)) ? Number(totals.E_y) : monthly.reduce((a, b) => a + b, 0);
  const meteo = (json.inputs && json.inputs.meteo_data) || {};
  return {
    monthly,
    annual,
    radiationDb: typeof meteo.radiation_db === 'string' ? meteo.radiation_db : null,
    years: Number.isFinite(meteo.year_min) && Number.isFinite(meteo.year_max) ? [meteo.year_min, meteo.year_max] : null,
  };
}
