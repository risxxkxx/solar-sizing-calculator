# Solar PV + Battery Sizing Calculator

A transparent, first-pass sizing tool for rooftop solar PV with battery storage. Every number it shows can be opened up as **formula → substitution → result**, so the user can check the engineering instead of trusting a black box.

Built for quick estimates for households and small businesses in North Macedonia, and usable anywhere PVGIS has data (Europe, Africa, most of Asia and the Americas).

> Built with AI-assisted development; engineering assumptions, formulas and validation by the author.

> **Screenshot:** add `docs/screenshot.png` after the first Netlify deploy (live PVGIS mode) and reference it here.

---

## The problem

Before a site visit, installers and homeowners need a quick answer to *"roughly how many panels, how big a battery, which inverter?"* Spreadsheets hide their assumptions, and most online calculators give a single number with no reasoning, often based on annual totals that hide the December problem.

## The solution

- **Two modes**
  - **Size for me**: recommends panels, battery and inverter so that, in the **worst month**, solar covers daytime use *and* recharges the battery. It is presented as a recommendation, not a pass/fail verdict.
  - **Check my system**: enter your panel count and installed battery. Three worst-month checks can genuinely fail, giving a green or red verdict.
- **Live irradiance from PVGIS** (EU Joint Research Centre) for the exact location, tilt and azimuth, through a small Netlify Function proxy. Custom latitude/longitude is supported.
- **Offline fallback**: when PVGIS is unavailable (opened from disk, no proxy, API error), a bundled regional table and an approximate orientation model are used, **clearly labelled as an approximate offline estimate**.
- **Every result has a 📐 Formula disclosure** (formula → substituted values → result).
- **English / Macedonian** toggle. Macedonian number formatting (`1 234,5`) in Macedonian mode.
- **No framework, no chart library**: vanilla HTML/CSS/JS, chart drawn as inline SVG. The site has no runtime dependencies.

---

## Formulas and assumptions

Units: kWh (energy), kW (power), degrees, % (0–100). `η` = round-trip efficiency, `DoD` = depth of discharge, `N` = days of autonomy, `Wp` = panel rating.

### 1. Load split (day / night)

| Quantity | Formula | Default |
|---|---|---|
| Night hours | `end − start` if `end ≥ start`, else `24 − start + end` (wraps over midnight; `start = end` → 0 h) | 17:00 → 08:00 = 15 h |
| Night share | user input, or `night_hours ÷ 24 × 100` (flat hourly load, the v1 behaviour) | 62.5 % |
| Night use | `daily × night_share` | |
| Daytime use | `daily − night_use` | |

The night window is the period without useful PV output, during which the battery supplies the load.

### 2. Specific yield (kWh per kWp per month)

- **PVGIS (live)**: `E_m` from the PVGIS **PVcalc v5.3** API for a 1 kWp system: `peakpower=1`, `loss=14`, `angle=tilt`, `aspect=azimuth − 180` (PVGIS uses 0 = south, −90 = east, 90 = west), default radiation database for the location, terrain horizon included (`usehorizon=1`).
- **Offline fallback**: `bundled_table[month] × f(tilt, azimuth)`, see section 6.

**Worst month** = month with the lowest `E_m ÷ days_in_month` (kWh/kWp/day). Sizing and checks use this month.

### 3. Battery

| Quantity | Formula |
|---|---|
| Required usable capacity | `N = 0` → 0 (no battery); otherwise `night_use + (N − 1) × daily` |
| Required nominal capacity | `usable ÷ DoD` (the DoD reserve is never discharged) |
| PV energy to recharge one night | `night_use ÷ η` |
| Autonomy reserve | `usable − night_use` |
| Days to refill the reserve (worst month) | `reserve ÷ η ÷ (daily_surplus − night_use ÷ η)`, or "does not refill in this month" if the leftover surplus is ≤ 0 |

`N = 1` means one night (normal daily cycle). Monthly averages hide multi-day cloudy streaks, so the UI suggests 2+ days for critical loads. Defaults: DoD 95 %, η 92 %, N = 1.

### 4. Panels ("Size for me")

```
y_panel   = worst_kWh/kWp/day × Wp ÷ 1000
A         = ceil(daytime_use ÷ y_panel)
B         = ceil((daytime_use + night_use ÷ η) ÷ y_panel)
panels    = max(1, A, B)
kWp       = panels × Wp ÷ 1000
```

### 5. Checks ("Check my system", worst month)

| # | Check | Passes when |
|---|---|---|
| 1 | Daytime coverage | `daily_PV_worst ≥ daytime_use` |
| 2 | Daily recharge | `daily_PV_worst − daytime_use ≥ night_use ÷ η` |
| 3 | Battery capacity | `installed_kWh × DoD ≥ required_usable` |

With `N = 0`, checks 2 and 3 are marked *not applicable*. The verdict is green only if no check fails.

### 6. Offline orientation model (fallback only)

Annual yield relative to the table reference (34° tilt, south), calibrated for about 41–42° N. Anchor values:

| Orientation | 0° (flat) | 34° | 90° (vertical) |
|---|---|---|---|
| South | 0.87 | 1.00 | 0.64 |
| East / West | 0.87 | 0.82 | 0.57 |
| North | 0.87 | 0.575 | 0.28 |

Each row is a quadratic in tilt through its three anchors. Azimuth is blended with `f(d) = a + b·cos(d) + c·cos(2d)`, where `d` is the angular distance from south (0–180°), which reproduces the south, east/west and north rows exactly. The result is clamped to [0.2, 1]. One annual factor is applied to every month.

### 7. Inverter

```
AC_kW ≥ max(peak_load_kW, kWp ÷ DC/AC_ratio)
```

The result is rounded up to a common size: 3, 3.6, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40 or 50 kW. Above 50 kW it is rounded up to the next 10 kW. Defaults: peak load 5 kW, DC/AC 1.2 (typical range 1.1–1.3).

### 8. Theoretical annual coverage

```
min(annual_production, annual_consumption) ÷ annual_consumption × 100
```

This is an **upper bound**, not self-sufficiency. It ignores timing: summer surplus cannot cover the winter deficit, and daytime PV cannot cover the night without storage.

### Data: bundled city table

The 10 North Macedonian cities in `src/data.js` contain **approximate regional monthly yield values** (34°, south, typical losses) derived from regional solar-resource models. They are **not official Global Solar Atlas (GSA) exports** and are used only for the offline fallback.

---

## Limitations

- **Not a replacement for professional PV design.** Use it for first-pass sizing and conversations, not for procurement or permits.
- **Average-month based.** The model works with monthly averages, not an hourly simulation. Cloudy streaks, daily load peaks and battery state-of-charge dynamics are not modelled.
- **Worst-month sizing is conservative.** "Size for me" sizes the array so that PV plus battery covers December (or the worst month) on average. For grid-tied systems, where the grid covers winter gaps, the economically optimal array is usually smaller.
- **No shading model**, apart from the terrain horizon that PVGIS includes. Nearby buildings and trees are ignored.
- **No temperature model** beyond the losses built into PVGIS (14 % system loss plus PVGIS' own temperature and irradiance corrections). The offline fallback has no temperature model at all.
- **Fixed night window all year.** In reality, useful sun hours are shorter in winter.
- **Offline fallback is approximate.** It uses one annual orientation factor for every month and is calibrated for roughly 41–42° N.
- **No economics.** Tariffs, feed-in, payback and battery degradation are out of scope.
- **PVGIS availability.** PVGIS limits the API to 30 requests/s per IP and may return 529 when busy. The proxy maps that to 503 and the UI falls back to the offline estimate.

---

## Run locally

**Just open it:** double-click `index.html`. It runs in offline-fallback mode with the bundled table. (Chromium blocks ES modules on `file://`, so on `file://` the page loads the prebuilt classic bundle `dist/app.bundle.js`; over http it loads the ES modules in `src/`.)

**With live PVGIS data** (needs the Netlify CLI):

```bash
npm install
npx netlify-cli dev     # serves the site + /api/pvgis on http://localhost:8888
```

**Development:**

```bash
npm install
npm test             # vitest: engine, PVGIS parsing, proxy function, i18n
npm run lint         # eslint
npm run bundle       # regenerate dist/app.bundle.js after editing src/
npm run bundle:check # CI fails if the bundle is stale
```

`package.json` exists only for dev tooling (vitest, eslint). The site itself has no dependencies and no build step.

## Deploy (Netlify)

1. Push the repo to GitHub.
2. In Netlify, choose **Add new site → Import from Git** and pick the repo.
3. Leave the build command empty. The publish directory is `.` and functions live in `netlify/functions` (both already set in `netlify.toml`).
4. Deploy. The function is served at `/api/pvgis`. No API keys or environment variables are needed.

Proxy API: `GET /api/pvgis?lat=41.99&lng=21.43&tilt=34&azimuth=180` returns `{ monthly: [12 × kWh/kWp], annual, radiationDb, years, … }`.

- Invalid input → 400. Location error from PVGIS (e.g. a point over the sea) → 422.
- PVGIS busy → 503. Timeout (9 s) → 504.
- Successful responses are cached (1 day in the browser, 30 days on the CDN).

## Project structure

```
index.html                 markup + CSS, loads src/ui.js (http) or dist/app.bundle.js (file://)
src/calc.js                pure sizing engine (no DOM): load split, battery, panels, checks, inverter, fallback model
src/data.js                bundled city table (approximate), days per month
src/format.js              number formatting (mk / en)
src/i18n.js                all UI strings, EN + MK
src/pvgis.js               PVGIS helpers shared by the function and tests (sanitise, URL, parse)
src/ui.js                  DOM rendering, inline SVG chart, PVGIS client with fallback
netlify/functions/pvgis.mjs  PVGIS proxy (validation, timeout, error mapping, cache headers)
scripts/bundle.mjs         zero-dependency bundler for the file:// fallback
tests/                     vitest suites + a hand-made PVGIS fixture (labelled as such)
```

## Tech

Vanilla JavaScript (ES modules), HTML and CSS with an inline SVG chart; Netlify Functions (Web `Request`/`Response` API); PVGIS 5.3 API; Vitest; ESLint; GitHub Actions.

See [CHANGELOG.md](CHANGELOG.md) for the engineering fixes from v1 to v2.

## Author

**Riste Kozarev**, energy-tech automation engineer (solar PV and BESS), Skopje, North Macedonia. GitHub: [risxxkxx](https://github.com/risxxkxx)

License: MIT

---

## Накратко (МК)

Калкулатор за првична процена на сончев систем со батерија: број на панели, капацитет на батерија и инвертер, со формула за секој резултат. Има два режими: **„Димензионирај за мене“** (препорака за најлошиот месец) и **„Провери го мојот систем“** (внесуваш панели и батерија, а проверките можат навистина да паднат). Податоците за сончевото зрачење доаѓаат во живо од **PVGIS** (преку Netlify функција), а кога PVGIS не е достапен се користи приближна офлајн табела за 10 македонски градови, јасно означена како проценка. Се пресметуваат ефикасноста на батеријата, деновите на автономија, ноќниот прозорец и уделот на ноќната потрошувачка. Ова не е замена за професионален PV дизајн.
