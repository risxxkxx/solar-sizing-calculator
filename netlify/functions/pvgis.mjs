/**
 * GET /api/pvgis?lat=41.99&lng=21.43&tilt=34&azimuth=180
 *
 * Server-side proxy to the PVGIS PVcalc API (browsers cannot call PVGIS
 * directly: no CORS). Returns monthly specific yield in kWh/kWp for a
 * 1 kWp system with 14% losses. No API key is needed.
 */
import { sanitizePvgisQuery, buildPvgisUrl, parsePvgisResponse, PVGIS_VERSION, PVGIS_LOSS_PCT } from '../../src/pvgis.js';

const TIMEOUT_MS = 9000;

function json(status, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders },
  });
}

const NO_STORE = { 'Cache-Control': 'no-store' };

export default async function handler(req) {
  if (req.method !== 'GET') return json(405, { error: 'Method not allowed' }, { ...NO_STORE, Allow: 'GET' });

  const params = Object.fromEntries(new URL(req.url).searchParams);
  const q = sanitizePvgisQuery(params);
  if (!q.ok) return json(400, { error: q.error }, NO_STORE);

  let upstream;
  try {
    upstream = await fetch(buildPvgisUrl(q.value), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
    return json(timedOut ? 504 : 502, { error: timedOut ? 'PVGIS timed out' : 'PVGIS unreachable' }, NO_STORE);
  }

  const body = await upstream.json().catch(() => null);

  if (!upstream.ok) {
    // PVGIS returns 400 + {"message": "..."} for e.g. points over sea or outside coverage.
    const message = body && typeof body.message === 'string' ? body.message.slice(0, 300) : `PVGIS HTTP ${upstream.status}`;
    if (upstream.status === 400) return json(422, { error: message }, NO_STORE);
    if (upstream.status === 429 || upstream.status === 529) return json(503, { error: 'PVGIS is busy, try again shortly' }, { ...NO_STORE, 'Retry-After': '5' });
    return json(502, { error: message }, NO_STORE);
  }

  let parsed;
  try {
    parsed = parsePvgisResponse(body);
  } catch (err) {
    return json(502, { error: err.message }, NO_STORE);
  }

  return json(
    200,
    {
      source: 'pvgis',
      version: PVGIS_VERSION,
      lossPct: PVGIS_LOSS_PCT,
      ...q.value,
      radiationDb: parsed.radiationDb,
      years: parsed.years,
      monthly: parsed.monthly.map((v) => Math.round(v * 100) / 100),
      annual: Math.round(parsed.annual * 10) / 10,
    },
    {
      // Long-term irradiation averages do not change: cache aggressively.
      'Cache-Control': 'public, max-age=86400',
      'Netlify-CDN-Cache-Control': 'public, durable, s-maxage=2592000, stale-while-revalidate=604800',
    },
  );
}

export const config = { path: '/api/pvgis' };
