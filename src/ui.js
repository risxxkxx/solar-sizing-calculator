/**
 * UI layer: reads inputs, calls the pure engine (calc.js), renders results.
 * All maths lives in calc.js; this file only formats and draws.
 */
import { CITIES, findCity, nearestCity } from './data.js';
import {
  evaluate, fallbackYield, normalizeInputs, proportionalNightShare, azimuthDeviation, isValidMonthly,
  MODE_SIZE, MODE_CHECK, INVERTER_SIZES,
} from './calc.js';
import { fmt as fmtNum } from './format.js';
import { t, getLang, monthName } from './i18n.js';

const $ = (id) => document.getElementById(id);
const f = (n, d = 1) => fmtNum(n, d, getLang());
const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const hh = (h) => String(h).padStart(2, '0') + ':00';

const state = {
  mode: MODE_SIZE,
  pvgis: {
    available: null, // null = unknown, true = proxy answered, false = no proxy (file://, plain static server, offline)
    cache: new Map(), // key -> proxy response
    errors: new Map(), // key -> error message (location errors, transient upstream errors)
    pendingKey: null,
    timer: null,
  },
};

const PVGIS_ENDPOINT = '/api/pvgis';
const canTryPvgis = () => location.protocol === 'http:' || location.protocol === 'https:';

/* ===================== FORMULA DISCLOSURES ===================== */
function formulaBlock(formula, substituted, result) {
  return formulaRows([
    { label: t('fFormula'), mono: formula },
    { label: t('fSubst'), mono: substituted },
    { label: t('fResult'), mono: result, result: true },
  ]);
}

function formulaRows(rows) {
  const lines = rows
    .map((r) => `<div class="f-line"${r.gap ? ' style="margin-top:6px;"' : ''}><span class="f-label">${r.label}</span><span class="f-mono${r.result ? ' f-result' : ''}">${r.mono}</span></div>`)
    .join('');
  return `<details class="formula"><summary>${t('formula')}</summary><div class="formula-body">${lines}</div></details>`;
}

/* ===================== STATIC TEXT ===================== */
function applyStaticText() {
  document.documentElement.lang = getLang();
  document.title = t('title');
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.innerHTML = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); });
}

function populateCitySelect() {
  const sel = $('city');
  let prev = sel.value || 'skopje';
  const allowCustom = state.pvgis.available === true;
  if (prev === 'custom' && !allowCustom) prev = currentLocation().fallbackCity.id;
  sel.innerHTML = CITIES.map((c) => `<option value="${c.id}">${esc(c.name[getLang()] || c.name.mk)}</option>`).join('')
    + (allowCustom ? `<option value="custom">${esc(t('customLocation'))}</option>` : '');
  sel.value = prev === 'custom' || findCity(prev) ? prev : 'skopje';
}

function populateHourSelects() {
  for (const id of ['nightStart', 'nightEnd']) {
    const sel = $(id);
    const prev = sel.value;
    sel.innerHTML = Array.from({ length: 24 }, (_, h) => `<option value="${h}">${hh(h)}</option>`).join('');
    sel.value = prev !== '' ? prev : id === 'nightStart' ? '17' : '8';
  }
}

/* ===================== INPUTS ===================== */
function readInputs() {
  return normalizeInputs({
    mode: state.mode,
    panelWp: $('wp').value,
    panels: $('panels').value,
    dailyConsumption: $('consumption').value,
    peakLoadKw: $('peakLoad').value,
    nightStart: $('nightStart').value,
    nightEnd: $('nightEnd').value,
    nightSharePct: $('nightShareAuto').checked ? null : $('nightShare').value,
    batteryKwh: $('batteryKwh').value,
    dodPct: $('dod').value,
    efficiencyPct: $('eff').value,
    autonomyDays: $('autonomy').value,
    dcAcRatio: $('dcAc').value,
  });
}

function readOrientation() {
  return { tilt: +$('tilt').value, azimuth: +$('azimuth').value };
}

function currentLocation() {
  if ($('city').value === 'custom') {
    const lat = parseFloat(String($('lat').value).replace(',', '.'));
    const lng = parseFloat(String($('lng').value).replace(',', '.'));
    const valid = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
    const near = valid ? nearestCity(lat, lng) : findCity('skopje');
    return { custom: true, valid, lat: valid ? Math.round(lat * 100) / 100 : near.lat, lng: valid ? Math.round(lng * 100) / 100 : near.lng, fallbackCity: near };
  }
  const c = findCity($('city').value) || findCity('skopje');
  return { custom: false, valid: true, lat: c.lat, lng: c.lng, fallbackCity: c };
}

/**
 * Monthly specific yield (kWh/kWp) + where it came from.
 * Live PVGIS data when the proxy answers; otherwise the bundled table x the
 * approximate offline orientation model.
 */
function getYield() {
  const loc = currentLocation();
  const { tilt, azimuth } = readOrientation();
  const fb = fallbackYield(loc.fallbackCity.pvout, tilt, azimuth);
  const base = { lat: loc.lat, lng: loc.lng, custom: loc.custom };
  const offline = (reason, extra = {}) => ({
    ...base, monthly: fb.monthly,
    source: { kind: 'offline', reason, factor: fb.factor, tilt, azimuth, city: loc.fallbackCity, custom: loc.custom, ...extra },
  });

  if (!canTryPvgis() || state.pvgis.available === false) return offline('unavailable');
  if (!loc.valid) return offline('invalidCoords');
  const key = `${loc.lat.toFixed(2)},${loc.lng.toFixed(2)},${tilt},${azimuth}`;
  const hit = state.pvgis.cache.get(key);
  if (hit) return { ...base, monthly: hit.monthly, source: { kind: 'pvgis', ...hit } };
  if (state.pvgis.errors.has(key)) return offline('pvgisError', { message: state.pvgis.errors.get(key) });
  schedulePvgis(key, { lat: loc.lat, lng: loc.lng, tilt, azimuth });
  return offline('loading');
}

function schedulePvgis(key, q) {
  if (state.pvgis.pendingKey === key) return;
  state.pvgis.pendingKey = key;
  clearTimeout(state.pvgis.timer);
  // debounce slider drags; first probe goes out immediately
  state.pvgis.timer = setTimeout(() => fetchPvgis(key, q), state.pvgis.available ? 450 : 0);
}

async function fetchPvgis(key, q) {
  const before = state.pvgis.available;
  try {
    const res = await fetch(`${PVGIS_ENDPOINT}?${new URLSearchParams(q)}`, { headers: { Accept: 'application/json' } });
    // A plain static server answers 404 with HTML: there is no proxy.
    if (!(res.headers.get('content-type') || '').includes('application/json')) throw new Error('no proxy');
    const body = await res.json();
    state.pvgis.available = true;
    if (res.ok && isValidMonthly(body.monthly)) state.pvgis.cache.set(key, body);
    else state.pvgis.errors.set(key, (body && body.error) || `HTTP ${res.status}`);
  } catch {
    state.pvgis.available = false;
  }
  if (state.pvgis.pendingKey === key) state.pvgis.pendingKey = null;
  if (before !== state.pvgis.available) populateCitySelect();
  render();
}

function syncSliderLabels() {
  $('tiltVal').textContent = $('tilt').value + '°';
  $('azimuthVal').textContent = $('azimuth').value + '°';
  $('dodVal').textContent = $('dod').value + '%';
  $('effVal').textContent = $('eff').value + '%';
  $('autonomyVal').textContent = $('autonomy').value;
}

function syncNightShareField(p) {
  const auto = $('nightShareAuto').checked;
  $('nightShare').disabled = auto;
  if (auto) $('nightShare').value = (Math.round(proportionalNightShare(p.nightStart, p.nightEnd) * 10) / 10).toString();
}

/* ===================== MAIN RENDER ===================== */
function render() {
  syncSliderLabels();
  const p = readInputs();
  syncNightShareField(p);

  const y = getYield();
  const r = evaluate({ ...p, monthlyYield: y.monthly });
  const month = monthName(r.worst.index);

  document.body.dataset.mode = r.mode;
  $('modeSize').classList.toggle('active', r.mode === MODE_SIZE);
  $('modeCheck').classList.toggle('active', r.mode === MODE_CHECK);
  $('modeSize').setAttribute('aria-pressed', r.mode === MODE_SIZE);
  $('modeCheck').setAttribute('aria-pressed', r.mode === MODE_CHECK);
  $('modeNote').textContent = r.mode === MODE_SIZE ? t('modeSizeNote') : t('modeCheckNote');
  document.body.dataset.custom = y.custom ? '1' : '0';
  $('cityCoords').textContent = y.custom ? '' : `φ ${y.lat}°, λ ${y.lng}°`;

  $('panelsComputedNote').innerHTML = Number.isFinite(r.sizing.panels)
    ? t('recommendedPanels', { panels: r.sizing.panels, kWp: f((r.sizing.panels * p.panelWp) / 1000, 2), month })
    : '—';

  const safe = (fn, label) => { try { fn(); } catch (e) { console.error(`Render error in "${label}":`, e); } };
  safe(() => renderSource(y), 'source');
  safe(() => renderVerdict(r, p, month), 'verdict');
  safe(() => renderChecks(r, month), 'checks');
  safe(() => renderMetrics(r, p, month), 'metrics');
  safe(() => renderChart(r.series), 'chart');
  safe(() => renderTable(r.series), 'table');
  safe(() => renderBatterySteps(r, p, month), 'battery steps');
}

/* ===================== DATA SOURCE ===================== */
function renderSource(y) {
  const s = y.source;
  if (s.kind === 'pvgis') {
    const years = Array.isArray(s.years) ? `, ${s.years[0]}–${s.years[1]}` : '';
    $('sourceNote').innerHTML = `<div class="source live">${t('sourceLive', { version: esc(s.version), db: esc(s.radiationDb || 'PVGIS') + years })}</div>`
      + formulaBlock(t('fPvgis'), `lat=${s.lat}, lon=${s.lng}, angle=${s.tilt}, aspect=${s.azimuth}−180=${s.aspect}, loss=${s.lossPct}%`, `${f(s.annual, 0)} kWh/kWp`);
    return;
  }
  const dev = azimuthDeviation(s.azimuth);
  const cityName = esc(s.city.name[getLang()] || s.city.name.mk);
  let lead = '';
  if (s.reason === 'loading') lead = `<div class="source loading">${t('sourceLoading')}</div>`;
  else if (s.reason === 'pvgisError') lead = `<div class="source loading">${t('sourcePvgisError', { msg: esc(s.message) })}</div>`;
  else if (s.reason === 'invalidCoords') lead = `<div class="source loading">${t('sourceInvalidCoords')}</div>`;
  const near = s.custom ? ` ${t('sourceNearest', { city: cityName })}` : '';
  const hint = s.reason === 'unavailable' ? `<div class="note">${t('sourceNoProxy')}</div>` : '';
  $('sourceNote').innerHTML = lead
    + `<div class="source offline" title="${esc(t('sourceOfflineTip'))}">${t('sourceOffline', { factor: f(s.factor, 3) })}${near}</div>${hint}`
    + formulaBlock(t('fOrientation'), `tilt ${s.tilt}°, d = ${dev}°`, `× ${f(s.factor, 3)}`);
}

/* ===================== VERDICT ===================== */
function renderVerdict(r, p, month) {
  let cfg;
  if (r.verdict === 'recommendation') {
    const vars = {
      panels: r.system.panels, wp: p.panelWp, kWp: f(r.system.kWp, 2),
      gross: f(r.system.batteryGross, 1), usable: f(r.system.batteryUsable, 1),
      inv: f(r.inverter.size, r.inverter.size % 1 ? 1 : 0), month,
    };
    cfg = {
      cls: 'info', icon: '☀', title: t('recTitle'),
      text: t(r.battery.autonomyDays > 0 ? 'recText' : 'recTextNoBattery', vars),
      extra: `<button type="button" class="btn" id="useRecommendation">${t('recButton')}</button>`,
    };
  } else if (r.verdict === 'pass') {
    cfg = { cls: 'green', icon: '✓', title: t('passTitle'), text: t('passText', { month }) };
  } else {
    cfg = { cls: 'red', icon: '✗', title: t('failTitle'), text: t('failText', { month }) };
  }
  $('verdictBox').innerHTML = `
    <div class="verdict ${cfg.cls}">
      <div class="icon">${cfg.icon}</div>
      <div class="text"><h3>${cfg.title}</h3><p>${cfg.text}</p></div>
      ${cfg.extra || ''}
    </div>`;
  const btn = $('useRecommendation');
  if (btn) {
    btn.addEventListener('click', () => {
      $('panels').value = r.system.panels;
      // round battery UP to 0.1 kWh so the check cannot fail on rounding
      $('batteryKwh').value = (Math.ceil(r.system.batteryGross * 10 - 1e-9) / 10).toString();
      setMode(MODE_CHECK);
    });
  }
}

/* ===================== CHECKS ===================== */
function renderChecks(r, month) {
  const isSize = r.mode === MODE_SIZE;
  $('checksTitle').textContent = isSize ? t('checksTitleSize') : t('checksTitleCheck');
  const op = (c) => (c.status === 'fail' ? '<' : '≥');
  const meta = {
    daytime: { title: t('chkDaytimeTitle', { month }), detail: 'chkDaytimeDetail', pass: 'chkDaytimePass', fail: 'chkDaytimeFail', size: 'chkDaytimeSize' },
    recharge: { title: t('chkRechargeTitle'), detail: 'chkRechargeDetail', pass: 'chkRechargePass', fail: 'chkRechargeFail', size: 'chkRechargeSize' },
    night: { title: t('chkNightTitle'), detail: 'chkNightDetail', pass: 'chkNightPass', fail: 'chkNightFail', size: 'chkNightSize' },
  };
  $('verdictChecks').innerHTML = r.checks.map((c, i) => {
    const m = meta[c.id];
    let cls; let idx; let msg; let color;
    if (c.status === 'na') {
      cls = 'na'; idx = '–'; msg = t('chkNa'); color = 'var(--ink-faint)';
    } else if (isSize) {
      cls = ''; idx = String(i + 1); msg = t(m.size); color = 'var(--blue)';
    } else {
      const ok = c.status === 'pass';
      cls = ok ? 'yes' : 'no'; idx = ok ? '✓' : '✗'; msg = t(ok ? m.pass : m.fail); color = ok ? 'var(--green)' : 'var(--red)';
    }
    const detail = c.status === 'na' ? '' : `<div class="sval small">${t(m.detail, { lhs: f(c.lhs, 2), rhs: f(c.rhs, 2), op: op(c) })}</div>`;
    return `
      <div class="step ${cls}">
        <div class="sidx">${idx}</div>
        <div class="scontent">
          <div class="stitle">${m.title}</div>
          ${detail}
          <div class="smsg" style="color:${color};">${msg}</div>
        </div>
      </div>`;
  }).join('');
}

/* ===================== METRICS ===================== */
function renderMetrics(r, p, month) {
  const isSize = r.mode === MODE_SIZE;
  const ppw = r.perPanelWorst;
  const systemFormula = isSize
    ? formulaRows([
      { label: t('fCondA'), mono: t('fPanelsA') },
      { label: t('fSubst'), mono: `ceil(${f(r.load.daytime, 2)} ÷ ${f(ppw, 4)}) = ${r.sizing.panelsForDaytime}` },
      { label: t('fCondB'), mono: t('fPanelsB'), gap: true },
      { label: t('fSubst'), mono: `ceil((${f(r.load.daytime, 2)} + ${f(r.battery.chargePerDay, 2)}) ÷ ${f(ppw, 4)}) = ${r.sizing.panelsForCharge}` },
      { label: t('fRec'), mono: `${t('fPanelsMax')} = ${r.system.panels} → ${f(r.system.kWp, 2)} kWp`, result: true, gap: true },
      { label: t('fWorst'), mono: `${month} (${f(r.worst.dailyPerKwp, 3)} kWh/kWp/d)`, gap: true },
    ])
    : formulaBlock(t('fKwp'), `${r.system.panels} × ${f(p.panelWp, 0)} ÷ 1000`, `${f(r.system.kWp, 2)} kWp`);

  const usableFormula = r.battery.autonomyDays === 0
    ? formulaBlock(t('fUsableZero'), '—', '0 kWh')
    : formulaBlock(t('fUsable'), `${f(r.load.night, 2)} + (${r.battery.autonomyDays} − 1) × ${f(p.dailyConsumption, 1)}`, `${f(r.battery.usableNeeded, 1)} kWh`);

  const batteryCard = isSize
    ? {
      label: t('mBatGross'), value: `${f(r.battery.grossNeeded, 1)} kWh`, sub: t('mBatGrossSub'),
      formula: formulaBlock(t('fGross'), `${f(r.battery.usableNeeded, 2)} ÷ ${f(p.dodPct / 100, 2)}`, `${f(r.battery.grossNeeded, 1)} kWh`),
    }
    : {
      label: t('mBatInstalled'), value: `${f(r.system.batteryGross, 1)} kWh`, sub: t('mBatInstalledSub', { usable: f(r.system.batteryUsable, 1), dod: f(p.dodPct, 0) }),
      formula: formulaBlock(t('fInstalled'), `${f(r.system.batteryGross, 2)} × ${f(p.dodPct / 100, 2)}`, `${f(r.system.batteryUsable, 1)} kWh`),
    };

  const inv = r.inverter;
  const invDigits = inv.size % 1 ? 1 : 0;
  const inverterFormula = formulaRows([
    { label: t('fFormula'), mono: t('fInverter') },
    { label: t('fSubst'), mono: `max(${f(inv.fromLoad, 1)}, ${f(r.system.kWp, 2)} ÷ ${f(p.dcAcRatio, 2)}) = ${f(inv.raw, 2)} kW` },
    { label: '', mono: t('fInverterRound', { sizes: INVERTER_SIZES.map((s) => f(s, s % 1 ? 1 : 0)).join(', ') }) },
    { label: t('fResult'), mono: `${f(inv.raw, 2)} kW → ${f(inv.size, invDigits)} kW`, result: true },
  ]);

  const cards = [
    {
      label: isSize ? t('mSystemRec') : t('mSystemYours'), value: `${f(r.system.kWp, 2)} kWp`,
      sub: t('mSystemSub', { panels: r.system.panels, wp: f(p.panelWp, 0), month }), formula: systemFormula,
    },
    {
      label: t('mAnnual'), value: `${f(r.annualProduction, 0)} kWh`, sub: t('mAnnualSub'),
      formula: formulaBlock(t('fSum'), t('fSumSubst'), `${f(r.annualProduction, 0)} kWh`),
    },
    {
      label: `${t('mCoverage')} <span class="tip" tabindex="0" title="${esc(t('mCoverageTip'))}">ⓘ</span>`,
      value: `${f(r.theoreticalCoverage, 1)}%`, sub: t('mCoverageSub'),
      formula: formulaRows([
        { label: t('fFormula'), mono: t('fCoverage') },
        { label: t('fSubst'), mono: `min(${f(r.annualProduction, 0)}, ${f(r.annualConsumption, 0)}) ÷ ${f(r.annualConsumption, 0)} × 100` },
        { label: t('fResult'), mono: `${f(r.theoreticalCoverage, 1)}%`, result: true },
        { label: 'ⓘ', mono: t('mCoverageTip'), gap: true },
      ]),
    },
    {
      label: t('mBatUsable'), value: `${f(r.battery.usableNeeded, 1)} kWh`,
      sub: t('mBatUsableSub', { extra: Math.max(0, r.battery.autonomyDays - 1) }), formula: usableFormula,
    },
    batteryCard,
    {
      label: t('mInverter'), value: `${f(inv.size, invDigits)} kW`, sub: t('mInverterSub', { raw: f(inv.raw, 2) }),
      formula: inverterFormula,
    },
  ];
  $('metricsBox').innerHTML = cards.map((c) => `
    <div class="metric">
      <div class="mlabel">${c.label}</div>
      <div class="mvalue">${c.value}</div>
      <div class="msub">${c.sub}</div>
      ${c.formula}
    </div>`).join('');
}

/* ===================== CHART (pure inline SVG — no library) ===================== */
function renderChart(series) {
  const target = $('monthlyChart');
  const { production, consumption, balance } = series;
  const W = 700; const H = 320;
  const mL = 56; const mR = 14; const mT = 38; const mB = 34;
  const plotW = W - mL - mR; const plotH = H - mT - mB;
  const maxVal = Math.max(1, ...production, ...consumption) * 1.15;
  const slot = plotW / 12; const barW = slot * 0.52;

  const grid = [0, 0.25, 0.5, 0.75, 1].map((g) => {
    const yy = mT + plotH - g * plotH;
    return `<line x1="${mL}" y1="${yy.toFixed(1)}" x2="${W - mR}" y2="${yy.toFixed(1)}" stroke="#E2E5E9" stroke-width="1"/>
      <text x="${mL - 8}" y="${(yy + 3.5).toFixed(1)}" text-anchor="end" font-size="10" fill="#8A9097" font-family="ui-monospace,monospace">${f(g * maxVal, 0)}</text>`;
  }).join('');

  const bars = production.map((v, i) => {
    const x = mL + i * slot + (slot - barW) / 2;
    const h = Math.max(0, (v / maxVal) * plotH);
    const color = balance[i] >= 0 ? '#1D9E75' : '#E24B4A';
    return `<rect x="${x.toFixed(1)}" y="${(mT + plotH - h).toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="${color}"><title>${monthName(i)} — ${t('chartProd')}: ${f(v, 0)}</title></rect>`;
  }).join('');

  const pts = consumption.map((v, i) => ({ x: mL + i * slot + slot / 2, y: mT + plotH - Math.max(0, (v / maxVal) * plotH), v }));
  const path = pts.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`).join(' ');
  const dots = pts.map((pt, i) => `<circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="3.4" fill="#378ADD" stroke="#fff" stroke-width="1.4"><title>${monthName(i)} — ${t('chartCons')}: ${f(pt.v, 0)}</title></circle>`).join('');
  const xl = Array.from({ length: 12 }, (_, i) => `<text x="${(mL + i * slot + slot / 2).toFixed(1)}" y="${H - mB + 17}" text-anchor="middle" font-size="10.5" fill="#5B6168" font-family="system-ui,sans-serif">${monthName(i, 'short')}</text>`).join('');

  target.innerHTML = `
  <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:100%;display:block;" role="img" aria-label="${esc(t('chartTitle'))}">
    <g>${grid}</g>
    <line x1="${mL}" y1="${(mT + plotH).toFixed(1)}" x2="${W - mR}" y2="${(mT + plotH).toFixed(1)}" stroke="#C9CDD2" stroke-width="1.2"/>
    <g>${bars}</g>
    <path d="${path}" fill="none" stroke="#378ADD" stroke-width="2.2"/>
    <g>${dots}</g>
    <g>${xl}</g>
    <g font-family="system-ui,sans-serif" font-size="11" font-weight="600">
      <rect x="${mL}" y="8" width="10" height="10" rx="2" fill="#1D9E75"></rect>
      <text x="${mL + 15}" y="17" fill="#5B6168">${t('chartProd')}</text>
      <line x1="${mL + 172}" y1="13" x2="${mL + 188}" y2="13" stroke="#378ADD" stroke-width="2.5"></line>
      <circle cx="${mL + 180}" cy="13" r="3" fill="#378ADD"></circle>
      <text x="${mL + 196}" y="17" fill="#5B6168">${t('chartCons')}</text>
    </g>
  </svg>`;
}

/* ===================== TABLE ===================== */
function renderTable(series) {
  const { production, consumption, dailyProduction, balance } = series;
  $('monthlyTableBody').innerHTML = production.map((_, i) => {
    const ok = balance[i] >= 0;
    return `<tr>
      <td>${monthName(i)}</td>
      <td class="num">${f(production[i], 0)}</td>
      <td class="num">${f(consumption[i], 0)}</td>
      <td class="num">${f(dailyProduction[i], 2)}</td>
      <td class="num" style="color:${ok ? 'var(--green)' : 'var(--red)'};font-weight:700;">${ok ? '+' : ''}${f(balance[i], 0)}</td>
      <td><span class="status-pill ${ok ? 'ok' : 'bad'}">${ok ? t('surplus') : t('deficit')}</span></td>
    </tr>`;
  }).join('');
}

/* ===================== BATTERY STEPS ===================== */
function step(idx, title, body, cls = '') {
  return `<div class="step ${cls}"><div class="sidx">${idx}</div><div class="scontent"><div class="stitle">${title}</div>${body}</div></div>`;
}

function renderBatterySteps(r, p, month) {
  const L = r.load; const B = r.battery;
  const wrap = L.nightEnd < L.nightStart;
  const out = [];
  out.push(step(1, t('stNightTitle'),
    `<div>${t('stNightText', { start: hh(L.nightStart), end: hh(L.nightEnd), wrap: wrap ? t('stWrap') : '', hours: L.nightHours })}</div>`
    + formulaBlock(wrap ? t('fNightWrap') : t('fNightPlain'), wrap ? `24 − ${L.nightStart} + ${L.nightEnd}` : `${L.nightEnd} − ${L.nightStart}`, `${L.nightHours} ${t('hoursUnit')}`)));

  out.push(step(2, t('stShareTitle'),
    `<div>${t('stShareText', { share: f(L.nightSharePct, 1), night: f(L.night, 2), day: f(L.daytime, 2) })}</div>`
    + formulaRows([
      { label: t('fFormula'), mono: L.proportional ? t('fShareProp') : t('fShareUser') },
      { label: t('fSubst'), mono: L.proportional ? `${L.nightHours} ÷ 24 × 100 = ${f(L.nightSharePct, 1)}%` : `${f(L.nightSharePct, 1)}%` },
      { label: t('fFormula'), mono: t('fNightKwh'), gap: true },
      { label: t('fSubst'), mono: `${f(p.dailyConsumption, 1)} × ${f(L.nightSharePct / 100, 3)}` },
      { label: t('fResult'), mono: `${f(L.night, 2)} kWh`, result: true },
    ])));

  if (B.autonomyDays === 0) {
    out.push(step(3, t('stUsableTitle', { days: 0 }), `<div>${t('stNoBattery')}</div>`, 'na'));
    $('batterySteps').innerHTML = out.join('');
    return;
  }

  out.push(step(3, t('stUsableTitle', { days: B.autonomyDays }),
    `<div><span class="sval">${f(B.usableNeeded, 1)} kWh</span></div><div class="note">${t('autonomyNote')}</div>`
    + formulaBlock(t('fUsable'), `${f(L.night, 2)} + (${B.autonomyDays} − 1) × ${f(p.dailyConsumption, 1)}`, `${f(B.usableNeeded, 1)} kWh`)));

  out.push(step(4, t('stGrossTitle', { dod: f(p.dodPct, 0) }),
    `<div><span class="sval">${f(B.grossNeeded, 1)} kWh</span></div>`
    + formulaBlock(t('fGross'), `${f(B.usableNeeded, 2)} ÷ ${f(p.dodPct / 100, 2)}`, `${f(B.grossNeeded, 1)} kWh`)));

  out.push(step(5, t('stChargeTitle', { eff: f(p.efficiencyPct, 0) }),
    `<div><span class="sval">${f(B.chargePerDay, 2)} kWh</span></div>`
    + formulaBlock(t('fCharge'), `${f(L.night, 2)} ÷ ${f(B.efficiency, 2)}`, `${f(B.chargePerDay, 2)} kWh`)));

  const rc = r.checks.find((c) => c.id === 'recharge');
  const ok = rc.status === 'pass';
  const isSize = r.mode === MODE_SIZE;
  out.push(step(isSize ? 6 : ok ? '✓' : '✗', t('stRechargeTitle', { month }),
    `<div>${t('stRechargeText', { prod: f(r.solarDailyWorst, 2), day: f(L.daytime, 2), surplus: f(r.surplusWorst, 2), charge: f(B.chargePerDay, 2) })}</div>`
    + `<div class="smsg" style="color:${ok ? 'var(--green)' : 'var(--red)'};">${ok ? t('stYes') : t('stNo')} — ${f(r.surplusWorst, 2)} ${ok ? '≥' : '<'} ${f(B.chargePerDay, 2)} kWh</div>`
    + formulaBlock(t('fSurplus'), `${f(r.solarDailyWorst, 2)} − ${f(L.daytime, 2)}`, `${f(r.surplusWorst, 2)} kWh ${ok ? '≥' : '<'} ${f(B.chargePerDay, 2)} kWh`),
    isSize ? '' : ok ? 'yes' : 'no'));

  if (r.reserve > 1e-9) {
    const days = Number.isFinite(r.refillDays) ? t('stReserveDays', { n: f(r.refillDays, 1) }) : t('stReserveNever', { month });
    out.push(step(7, t('stReserveTitle'),
      `<div>${t('stReserveText', { reserve: f(r.reserve, 1), month, leftover: f(Math.max(0, r.leftoverSurplus), 2), days })}</div>`
      + formulaBlock(t('fRefill'), `${f(r.reserve, 2)} ÷ ${f(B.efficiency, 2)} ÷ ${f(Math.max(0, r.leftoverSurplus), 2)}`, days)));
  }
  $('batterySteps').innerHTML = out.join('');
}

/* ===================== WIRING ===================== */
function setMode(mode) {
  state.mode = mode === MODE_CHECK ? MODE_CHECK : MODE_SIZE;
  render();
}

function init() {
  applyStaticText();
  populateCitySelect();
  populateHourSelects();
  $('modeSize').addEventListener('click', () => setMode(MODE_SIZE));
  $('modeCheck').addEventListener('click', () => setMode(MODE_CHECK));
  document.querySelectorAll('#controls input, #controls select').forEach((el) => {
    el.addEventListener('input', render);
    el.addEventListener('change', render);
  });
  render();
}

init();
