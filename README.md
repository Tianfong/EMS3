# FDB NPI Command Center — Fan Manufacturing

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

- **9 views** — Overview, Products, Processes, KPI, Quality·SPC, Gantt, FACA,
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
- **Editable data** — FACA status/progress, claims (status/ETA/corrective
  action, new claims), Gantt tasks and lot phases. Edits persist to
  `localStorage` and can be reset to baseline from ⚙️ Settings.
- **Derived UI** — sidebar badges, ticker and alert feed update live after
  every edit.
- **CSV export** — products, claims, shipments, watch items (UTF-8 BOM).
- **Dark / light theme**, mobile drawer, responsive down to 360 px.

## Project layout

```
index.html    App shell: sidebar, topbar filter chips, view container
styles.css    Design system (themes, responsive, gantt, print)
data.js       DB module: masters, lots, KPIs, SPC, claims, FACA, persistence
charts.js     Dependency-free SVG charts (line, spark, donut, control, pareto)
app.js        Router, views, filters, modals, toasts, CSV, DataHub adapter
build.js      Inlines the above into a single self-contained app.html
app.html      Built artifact (one-file version of the whole app)
```

## Build

```bash
node build.js          # rebuilds app.html (~153 KB) from the modular sources
node --check app.js    # optional syntax check; same for charts.js / data.js
```

Open `index.html` directly in a browser (modular dev mode) or `app.html`
(single-file). No server required.

## REST mode (optional)

⚙️ Settings switches the data layer between **demo** (in-memory + localStorage)
and **REST**. Expected contract on the configured base URL:

```
GET    /health
PATCH  /claims/:id
POST   /claims
PATCH  /faca/:id
```

## Data & persistence

Demo-mode edits persist to `localStorage["fdb-overrides-v1"]` (claims, FACA,
Gantt tasks, lot phases) and `resetOverrides()` restores the seeded baseline.
SPC sample series and Western Electric rules live in `data.js`
(`spcSamples`, `westernElectric`, `spcStats`).
