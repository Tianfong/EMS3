# FDB NPI Command Center — Fan Manufacturing

[![CI](https://github.com/Tianfong/EMS3/actions/workflows/ci.yml/badge.svg)](https://github.com/Tianfong/EMS3/actions/workflows/ci.yml)

A modern, interactive, fully responsive web dashboard for monitoring and managing
New Product Introduction (NPI) of FDB fan manufacturing — from first prototype
build to mass-production shipment.

**Zero dependencies.** Plain HTML + CSS + vanilla JS. No framework, no build
tooling beyond a simple inliner, no network calls in demo mode.

**Live:** https://tianfong.github.io/EMS3/ (GitHub Pages, serves this repo root)

## Scope

| | |
|---|---|
| **Products** | X4151 – X4156 |
| **Sides** | RHS / LHS |
| **Lines** | L1 – L4 |
| **Stages** | P1 → P2 → EVT → DVT → PVT |
| **Production lots** | MP11/12, MP21/22, ME11–13, MD11–13, MV11/12 (12 lots) |
| **KPIs** | FPY, FY, UPH, OEE, Shipment, Claims, FACA, Gantt |

## Features

- **8 views** — Overview (with the embedded KPI Deep Dive: FPY/FY/UPH/OEE/Shipment/
  Claims/FACA tabs, per-KPI charts, breakdowns, stage-contribution waterfall and
  the blended scope trend), Products, Processes, Quality·SPC, Gantt, FACA,
  Claims, Shipments, plus an executive stage-gate report modal (print/PDF-ready).
- **Cross-filtering** — Product × Stage × Lot × Side × Line × Range; product
  select cascades Line + Stage, lot select cascades Stage; everything stays
  coherent via `syncSegs`.
- **Quality / SPC** — ±3σ control chart with Western Electric rule detection
  (R1–R4), Cpk / PPM cards, defect Pareto, by-process donut.
- **Gantt** — By-lot and by-product modes. Lot rows show the 5-phase flow
  *Preparation → MBO and Main build → OQC → OK2S → Shipment* with an editable
  phase editor (dates, % done — persisted). Day / Week / Month zoom
  (Ctrl+wheel), ◉ Today, sticky labels, weekend shading.
  **Interactive:** drag bars to reschedule, drag the right-edge grip to
  extend (snapped to whole days, persisted, done% preserved), dashed flow
  arrows between phases, critical-chain flag on the next phase after a
  completed one, red pulse + alert-feed entries for overdue phases.
- **Quality / SPC drill-down** — scope the ±3σ control chart to any of the 12
  lots; the blended baseline is overlaid as a dashed reference and CL/σ/Cpk,
  signals and CSV export follow the selection.
- **Editable data** — FACA status/progress, claims (status/ETA/corrective
  action, new claims), Gantt tasks and lot phases. Edits persist to
  `localStorage` and can be reset to baseline from ⚙️ Settings.
- **Derived UI** — sidebar badges, ticker and alert feed update live after
  every edit.
- **CSV export & import** — products, claims, shipments, watch items, SPC
  series (UTF-8 BOM); claims import round-trips the export format (update by
  id or add rows) via ⚙️ Settings.
- **PWA** — installable; service worker precaches the shell so the dashboard
  opens offline on the shop floor.
- **Dark / light theme**, mobile drawer, responsive down to 360 px.
- **Dark / light theme**, mobile drawer, responsive down to 360 px.

## Project layout

```
index.html            App shell: sidebar, topbar filter chips, view container
styles.css            Design system (themes, responsive, gantt, print)
data.js               DB module: masters, lots, KPIs, SPC, claims, FACA, persistence
charts.js             Dependency-free SVG charts (line, spark, donut, control, pareto)
app.js                Router, views, filters, modals, toasts, CSV, DataHub adapter
build.js              Inlines the above into a single self-contained app.html
app.html              Built artifact (one-file version of the whole app)
sw.js                 PWA service worker (offline shell, stale-while-revalidate)
manifest.webmanifest  PWA manifest (installable, fan icon)
server/mes-mock.js    Zero-dependency MES mock implementing the REST contract
server/test-mes.js    Contract tests for the mock (11 assertions)
```

## Build

```bash
node build.js          # rebuilds app.html (~153 KB) from the modular sources
node --check app.js    # optional syntax check; same for charts.js / data.js
```

Open `index.html` directly in a browser (modular dev mode) or `app.html`
(single-file). No server required.

```bash
npm run build   # rebuild app.html from sources
test            # run MES contract tests (node server/test-mes.js)
npm run mes     # start the MES mock server on http://127.0.0.1:8787
```

CI (`.github/workflows/ci.yml`) syntax-checks all JS sources, runs the MES
contract tests, rebuilds `app.html`, and fails the run if the committed bundle
is out of date — so the deployed site and the bundle can never drift.

## REST mode (optional)

⚙️ Settings switches the data layer between **demo** (in-memory + localStorage)
and **REST**. Expected contract on the configured base URL:

```
GET    /health
GET    /claims · /faca   (bonus, for debugging)
POST   /claims
PATCH  /claims/:id
PATCH  /faca/:id
```

A zero-dependency mock implementing exactly this contract ships in
`server/mes-mock.js` (`npm run mes`, port 8787, CORS enabled). Point REST mode
at `http://127.0.0.1:8787` from the local preview. Browsers may block an
https page from calling a local http server (Private Network Access) — test
the live site against it from the local preview instead, or front the mock
with TLS for production.

## PWA

Served over HTTPS, the dashboard registers a service worker that precaches the
full shell. It opens offline (network-less shop floor) and can be installed as
a standalone app from the browser's install prompt. Cache strategy is
stale-while-revalidate: updates land on the next online visit. Bump `VERSION`
in `sw.js` to force a shell refresh.

## Data & persistence

Demo-mode edits persist to `localStorage["fdb-overrides-v1"]` (claims, FACA,
Gantt tasks, lot phases) and `resetOverrides()` restores the seeded baseline.
SPC sample series and Western Electric rules live in `data.js`
(`spcSamples`, `westernElectric`, `spcStats`).
