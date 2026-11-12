import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { sanitizePvgisQuery, buildPvgisUrl, parsePvgisResponse, azimuthToAspect } from '../src/pvgis.js';
import handler from '../netlify/functions/pvgis.mjs';

// NOTE: hand-made fixture matching the documented PVcalc JSON shape,
// not a recorded API response (see its _comment field).
const fixture = JSON.parse(readFileSync(new URL('./fixtures/pvgis-pvcalc.fixture.json', import.meta.url), 'utf8'));

describe('azimuthToAspect', () => {
  it('maps compass azimuth to PVGIS aspect (0 = south)', () => {
    expect(azimuthToAspect(180)).toBe(0);
    expect(azimuthToAspect(90)).toBe(-90); // east
    expect(azimuthToAspect(270)).toBe(90); // west
    expect(azimuthToAspect(0)).toBe(-180); // north
    expect(azimuthToAspect(360)).toBe(-180);
  });
});

describe('sanitizePvgisQuery', () => {
  it('rejects missing or out-of-range coordinates', () => {
    expect(sanitizePvgisQuery({ lng: '21' }).ok).toBe(false);
    expect(sanitizePvgisQuery({ lat: '95', lng: '21' }).ok).toBe(false);
    expect(sanitizePvgisQuery({ lat: '41', lng: 'abc' }).ok).toBe(false);
  });
  it('clamps tilt, normalises azimuth and rounds coordinates', () => {
    const q = sanitizePvgisQuery({ lat: '41.98765', lng: '21,4321', tilt: '120', azimuth: '-90' });
    expect(q.ok).toBe(true);
    expect(q.value).toEqual({ lat: 41.99, lng: 21.43, tilt: 90, azimuth: 270, aspect: 90 });
  });
  it('defaults tilt/azimuth to 34° / south', () => {
    const q = sanitizePvgisQuery({ lat: 42, lng: 21 });
    expect(q.value.tilt).toBe(34);
    expect(q.value.aspect).toBe(0);
  });
});

describe('buildPvgisUrl', () => {
  it('requests a 1 kWp system with 14% loss as JSON', () => {
    const u = new URL(buildPvgisUrl({ lat: 41.99, lng: 21.43, tilt: 34, aspect: 0 }));
    expect(u.origin + u.pathname).toBe('https://re.jrc.ec.europa.eu/api/v5_3/PVcalc');
    expect(Object.fromEntries(u.searchParams)).toEqual({
      lat: '41.99', lon: '21.43', peakpower: '1', loss: '14', angle: '34', aspect: '0', outputformat: 'json',
    });
  });
});

describe('parsePvgisResponse', () => {
  it('extracts 12 monthly E_m values in month order', () => {
    const r = parsePvgisResponse(fixture);
    expect(r.monthly).toHaveLength(12);
    expect(r.monthly[0]).toBe(78.4);
    expect(r.monthly[11]).toBe(68.2);
    expect(r.annual).toBeCloseTo(fixture.outputs.totals.fixed.E_y, 6);
    expect(r.radiationDb).toBe('PVGIS-SARAH3');
    expect(r.years).toEqual([2005, 2023]);
  });
  it('does not depend on the order of monthly rows', () => {
    const shuffled = structuredClone(fixture);
    shuffled.outputs.monthly.fixed.reverse();
    expect(parsePvgisResponse(shuffled).monthly).toEqual(parsePvgisResponse(fixture).monthly);
  });
  it('rejects malformed responses', () => {
    expect(() => parsePvgisResponse(null)).toThrow();
    expect(() => parsePvgisResponse({ outputs: { monthly: { fixed: [] } } })).toThrow();
    const bad = structuredClone(fixture);
    bad.outputs.monthly.fixed[3].E_m = 'x';
    expect(() => parsePvgisResponse(bad)).toThrow(/E_m/);
    const dup = structuredClone(fixture);
    dup.outputs.monthly.fixed[1].month = 1;
    expect(() => parsePvgisResponse(dup)).toThrow();
  });
});

describe('Netlify function /api/pvgis', () => {
  afterEach(() => vi.unstubAllGlobals());
  const req = (qs, method = 'GET') => new Request(`https://example.test/api/pvgis?${qs}`, { method });

  it('returns 400 for invalid input without calling PVGIS', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const res = await handler(req('lat=abc&lng=21'));
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects non-GET methods', async () => {
    const res = await handler(req('lat=41&lng=21', 'POST'));
    expect(res.status).toBe(405);
  });

  it('proxies, parses and sets cache headers', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response(JSON.stringify(fixture), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    const res = await handler(req('lat=41.99&lng=21.43&tilt=30&azimuth=90'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toMatch(/max-age=86400/);
    const body = await res.json();
    expect(body.monthly).toHaveLength(12);
    expect(body).toMatchObject({ source: 'pvgis', tilt: 30, azimuth: 90, aspect: -90, radiationDb: 'PVGIS-SARAH3' });
    const called = new URL(fetchSpy.mock.calls[0][0]);
    expect(called.searchParams.get('aspect')).toBe('-90');
    expect(called.searchParams.get('angle')).toBe('30');
  });

  it('maps a PVGIS 400 (e.g. point over sea) to 422 with its message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'Location over the sea.', status: 400 }), { status: 400 })));
    const res = await handler(req('lat=40&lng=19'));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/sea/);
  });

  it('maps PVGIS overload (529) to 503 and timeouts to 504', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('busy', { status: 529 })));
    expect((await handler(req('lat=41&lng=21'))).status).toBe(503);
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(timeout));
    expect((await handler(req('lat=41&lng=21'))).status).toBe(504);
  });

  it('returns 502 when PVGIS answers 200 with an unexpected body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ outputs: {} }), { status: 200 })));
    expect((await handler(req('lat=41&lng=21'))).status).toBe(502);
  });
});
