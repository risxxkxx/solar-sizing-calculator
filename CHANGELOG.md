# Changelog

## v2.0.0: engineering fixes and restructure (v1 → v2)

v1 was a single HTML file (`index.html` in the first commit). v2 keeps its look, the inline SVG chart and the formula → substitution → result disclosures. It moves the maths into a pure, tested module and fixes the problems below.

### Fixes

1. **Verdict could never be red** (v1 → v2)
   - v1: panels were auto-sized with `ceil((daytime + batteryGross) / perPanel)`, so checks 1 and 2 passed by construction for every input.
   - v2 has two modes:
     - **Size for me** keeps the auto-sizing but presents it as a recommendation, with no pass/fail.
     - **Check my system** takes the user's panel count and installed battery kWh, so the checks can genuinely fail.
   - A test proves that the auto-sized system passes when it is entered in check mode, and that undersized systems fail.

2. **Check 3 was a tautology** (v1 → v2)
   - v1 compared `batteryGross × DoD` with `nightConsumption`, but `batteryGross` was defined as `nightConsumption ÷ DoD`.
   - v2 compares the installed usable capacity (`installed × DoD`) with the required usable capacity (night + autonomy).

3. **Check 2 recharged the wrong amount** (v1 → v2, found while fixing 1–2)
   - v1 required the daily surplus to refill the *gross* battery capacity. The DoD reserve is never discharged, so it does not need daily recharging.
   - v2 requires the surplus to refill what the night actually used, divided by round-trip efficiency.

4. **No battery round-trip efficiency** (v1 → v2)
   - New input, default 92 %. PV energy needed per night = `night_use ÷ η`.

5. **No days of autonomy** (v1 → v2)
   - New input, 0–3, default 1. Required usable capacity = `night + (N − 1) × daily`; `N = 0` means no battery.
   - The UI notes that monthly averages hide cloudy streaks, and shows how many days the extra reserve takes to refill in the worst month (often "not in December").

6. **Hard-coded night window and flat load** (v1 → v2)
   - v1 fixed the night at 17:00–08:00 and assumed a flat hourly load.
   - v2 makes start and end hours inputs (same defaults) and adds a "share of consumption at night %" input. Leaving it on *proportional* reproduces v1.

7. **Inverter rule oversized relative to PV** (v1 → v2)
   - v1: `max(daily ÷ 6, kWp × 1.1)`, rounded up to 5 kW steps. Daily energy ÷ 6 h is not a power requirement, and an inverter larger than the array is the opposite of normal DC/AC practice.
   - v2: `AC ≥ max(peak_load, kWp ÷ DC/AC)` (defaults 5 kW, 1.2), rounded up to common sizes [3, 3.6, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50] kW.
   - Example: 10.62 kWp went from 15 kW to 10 kW.

8. **Crude tilt/azimuth correction** (v1 → v2)
   - v1: `cos(|tilt − 34|) · cos(|az − 180| · 0.5)`, clamped at 0.05. A north-facing roof came out at about 5 % of optimum (real: about 55–60 %).
   - v2 primary path: live **PVGIS PVcalc v5.3** data for the exact location, tilt and azimuth, through a Netlify Function proxy (PVGIS blocks browser/CORS calls). The proxy validates input, applies a timeout, maps errors and sets cache headers. Custom lat/lng is supported.
   - v2 fallback: an approximate orientation model anchored at flat 0.87, vertical south 0.64, E/W at 34° 0.82 and north at 34° 0.575, labelled "approximate offline estimate".

9. **"Annual self-sufficiency" overstated** (v1 → v2)
   - `min(prod, cons) ÷ cons` ignores the timing mismatch between production and use.
   - Renamed to **theoretical annual coverage**, with a tooltip explaining why real self-sufficiency is lower.

10. **City table presented as GSA data** (v1 → v2)
    - The bundled PVOUT values are now labelled in the UI, the code and the README as approximate regional values, not official Global Solar Atlas exports.

### Structure and quality

- `src/calc.js`: pure ES module, no DOM. `src/ui.js`: rendering. `src/i18n.js`: all strings (English + Macedonian toggle, default English unless the browser prefers `mk`).
- Input normalisation: clamps ranges and accepts a decimal comma.
- 56 unit tests (vitest) covering:
  - night-window wrap and auto-size vs check mode
  - efficiency, autonomy and inverter rounding
  - fallback model bounds
  - PVGIS parsing against a hand-made fixture, and the proxy function with mocked fetch
  - i18n key parity
- `file://` support through a generated classic-script bundle, so double-clicking `index.html` still works.
- GitHub Actions: lint, test, bundle freshness.
- User-provided text (e.g. PVGIS error messages) is escaped before rendering.
