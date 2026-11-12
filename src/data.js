/**
 * Static reference data. No DOM access.
 *
 * PVOUT values are APPROXIMATE regional estimates of monthly specific yield
 * (kWh per kWp installed) for a south-facing (azimuth 180°) array tilted at 34°,
 * including typical system losses. They were derived from regional solar-resource
 * models for North Macedonia and are NOT official Global Solar Atlas exports.
 * Use them for first-pass sizing only.
 */
export const CITIES = [
  { id: 'gradsko',  name: { mk: 'Градско',  en: 'Gradsko' },  lat: 41.57, lng: 21.96, pvout: [73.2, 92.9, 122.7, 128.9, 140.4, 147.8, 158.3, 153.7, 128.1, 110.6, 77.4, 63.7] },
  { id: 'skopje',   name: { mk: 'Скопје',   en: 'Skopje' },   lat: 41.99, lng: 21.43, pvout: [71.5, 90.8, 120.3, 126.5, 138.2, 145.9, 156.1, 151.4, 126.0, 108.5, 75.8, 62.1] },
  { id: 'bitola',   name: { mk: 'Битола',   en: 'Bitola' },   lat: 41.03, lng: 21.33, pvout: [75.1, 94.5, 124.8, 131.2, 142.6, 150.1, 160.5, 155.8, 129.8, 112.0, 78.9, 65.2] },
  { id: 'strumica', name: { mk: 'Струмица', en: 'Strumica' }, lat: 41.44, lng: 22.64, pvout: [76.3, 95.8, 125.9, 132.4, 143.7, 151.3, 161.8, 157.0, 130.9, 113.1, 79.8, 66.1] },
  { id: 'ohrid',    name: { mk: 'Охрид',    en: 'Ohrid' },    lat: 41.12, lng: 20.80, pvout: [74.2, 93.6, 123.5, 130.0, 141.5, 149.0, 159.4, 154.6, 128.7, 111.0, 78.1, 64.4] },
  { id: 'shtip',    name: { mk: 'Штип',     en: 'Štip' },     lat: 41.74, lng: 22.19, pvout: [74.8, 94.1, 124.1, 130.7, 142.0, 149.6, 160.0, 155.3, 129.3, 111.6, 78.6, 64.9] },
  { id: 'tetovo',   name: { mk: 'Тетово',   en: 'Tetovo' },   lat: 42.01, lng: 20.97, pvout: [69.8, 88.9, 118.5, 124.8, 136.5, 143.8, 154.2, 149.6, 124.3, 107.0, 74.3, 60.8] },
  { id: 'kumanovo', name: { mk: 'Куманово', en: 'Kumanovo' }, lat: 42.13, lng: 21.71, pvout: [70.5, 89.6, 119.2, 125.5, 137.1, 144.4, 154.9, 150.2, 124.9, 107.6, 74.9, 61.4] },
  { id: 'veles',    name: { mk: 'Велес',    en: 'Veles' },    lat: 41.71, lng: 21.77, pvout: [72.8, 92.4, 122.2, 128.4, 139.9, 147.3, 157.8, 153.2, 127.6, 110.1, 77.0, 63.3] },
  { id: 'prilep',   name: { mk: 'Прилеп',   en: 'Prilep' },   lat: 41.34, lng: 21.55, pvout: [74.5, 93.8, 123.8, 130.3, 141.8, 149.3, 159.7, 155.0, 129.1, 111.3, 78.3, 64.6] },
];

/** Reference orientation the bundled PVOUT table refers to. */
export const TABLE_TILT = 34;
export const TABLE_AZIMUTH = 180;

export const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function findCity(id) {
  return CITIES.find((c) => c.id === id) || null;
}

/** Nearest bundled city (equirectangular distance; fine at this scale). */
export function nearestCity(lat, lng) {
  let best = CITIES[0];
  let bestD = Infinity;
  for (const c of CITIES) {
    const dx = (c.lng - lng) * Math.cos((lat * Math.PI) / 180);
    const dy = c.lat - lat;
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}
