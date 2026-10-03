# FDB NPI Command Center — Fan Manufacturing

[![CI](https://github.com/Tianfong/EMS3/actions/workflows/ci.yml/badge.svg)](https://github.com/Tianfong/EMS3/actions/workflows/ci.yml)

An interactive, fully responsive web dashboard for monitoring and managing New
Product Introduction (NPI) of FDB fan manufacturing — from first prototype build
to mass-production shipment.

**Zero dependencies.** Plain HTML + CSS + vanilla JS. No framework, no bundler,
no network calls in demo mode.

**Live:** https://tianfong.github.io/EMS3/ (GitHub Pages, serves this repo root)

**Architecture:** see [ARCHITECTURE.md](ARCHITECTURE.md) for data flow, override
layers, the REST contract and where to extend things.

## Scope

| | |
|---|---|
| **Plants** | A / B |
| **Products** | X4151 – X4156 |
| **Sides** | RHS / LHS |
| **Fixtures** | MF-01 – MF-04 |
| **Stages** | P1 → P2 → EVT → DVT → PVT |
| **Production lots** | MP11/12, MP21/22, ME11–13, MD11–13, MV11/12 (12 lots) |
| **Processes** | Rotor → Pillow-stator → Fan assembly → Test accessory |
| **KPIs** | FPY, FY, UPH, OEE, Shipment, Claims, FACA |

## Features

- **6 views** — Overview, Quality·SPC, Project Gantt, FACA, Customer Claims,
  Shipments, plus a print-ready executive stage-gate report modal.
- **Overview is the command page.** It carries the seven KPI cards, the
  collapsible KPI Deep Dive, the product table and the process flow — a
  sticky section nav (KPIs · Deep dive · Products · Alerts) jumps between them
  and highlights the section in view.
- **KPI deep dive** — seven tabs with a moving average, min/max envelope and a
  Blended/Per-stage overlay on FPY; a seven-KPI sparkline strip sits above the
  tabs so every metric is visible before opening the panel. Collapsed by
  default, remembered per browser.
- **Cross-filtering** — Plant × Product × Stage × Lot × Side × Fixture × Range.
  Plant is the outermost partition and cascades the rest; selects stay coherent
  via `applyPlant()` / `syncSegs()`.
- **Customer health** — FPY/OEE rolled up per account (CloudCore, NovaServe,
  EdgeWave, PicoCloud) with risk pills, ship %, claim and FACA counts.
- **Split alert feed** — claims and FACA under *Actions required*, SPC signals
  and overdue phases under *Derived alerts*, filterable by source.
- **Quality / SPC** — ±3σ control chart with Western Electric rule detection
  (R1–R4), Cpk / PPM cards, defect Pareto, by-process donut. Scope the control
  chart to any of the 12 lots; the blended baseline is overlaid as a dashed
  reference and CL/σ/Cpk, signals and CSV export follow the selection.
- **Gantt** — by-lot and by-product modes. Lot rows show the five-phase flow
  *Preparation → MBO and Main build → OQC → OK2S → Shipment*. Day / Week /
  Month zoom (Ctrl+wheel), ◉ Today, sticky labels, weekend shading.
  **Interactive:** drag a bar to reschedule, drag the right-edge grip to extend,
  drag the **left-edge grip to move the start date independently** — all snapped
  to whole days and persisted. Dependency arrows turn red and explain themselves
  when a phase starts before its predecessor ends.
- **Inline table filtering** — the product table has a search box and stage
  pills that update the rows live without losing focus.
- **Editable data** — FACA status/progress, claims (status/ETA/corrective
  action, new claims), Gantt tasks and lot phases. Persists to `localStorage`,
  resettable from ⚙️ Settings.
- **CSV export & import** — products, claims, shipments, watch items, SPC
  series (UTF-8 BOM); claims import round-trips the export format.
- **PWA** — installable; a service worker precaches the shell so the dashboard
  opens offline. Maskable 192/512 PNG icons are generated, not hand-drawn.
- **Dark / light theme**, mobile drawer, responsive down to 360 px.

## Before → after

What changed as the dashboard matured, and what was deliberately removed.

| Area | Before | After |
|---|---|---|
| Views | 8 pages | 6 — Products and Processes folded into the Overview once their content proved duplicative, guarded by CI |
| Line dimension | dedicated L1–L4 line health card | machine/fixture (MF-01…) filter + plant partition (A/B); no line card |
| KPI cards | value only | delta-vs-target chips, click to jump to the matching deep-dive tab |
| Deep dive | separate page, always open | embedded, collapsed by default, with a seven-KPI sparkline strip and sticky tabs |
| FPY chart | single blended line | 5-day moving average + min/max envelope + per-stage overlay toggle |
| Alerts | one undifferentiated list | split into *Actions required* vs *Derived alerts*, filterable by source |
| Product table | read-only table | inline search, stage pills, process-gate mini-map, CSV export |
| Gantt | static bars | drag to move, resize, independent start-date handle, broken-sequence arrows |
| Axis labels | colliding on tight ranges | one shared `autoDec` precision rule across line/control/pareto |
| PWA icons | SVG only — no install prompt | generated maskable 192/512 PNGs |

**Removed on purpose:** the line health card, the dedicated Products and
Processes pages, and every L1–L4 production-line reference. If you find one
still in the docs or the OG meta, it is a bug.

## Project layout

```
index.html            App shell: sidebar, topbar filter chips, view container
styles.css            Design system (themes, responsive, gantt, print)
data.js               DB module: masters, lots, KPIs, SPC, claims, FACA, persistence
charts.js             Dependency-free SVG charts (line, spark, donut, control, pareto)
app.js                Router, views, filters, modals, toasts, CSV, DataHub adapter
build.js              Inlines the above into a single self-contained app.html
app.html              Built artifact (one-file version of the whole app)
tools/make-icons.js   Zero-dependency PNG encoder for the maskable PWA icons
tools/test-structure.js  Structural guards (retired views, nav/registry consistency)
sw.js                 PWA service worker (offline shell, stale-while-revalidate)
manifest.webmanifest  PWA manifest (installable, fan icon)
ARCHITECTURE.md       Handoff doc: data flow, overrides, REST contract, extensions
server/mes-mock.js    Zero-dependency MES mock implementing the REST contract
server/test-mes.js    Contract tests for the mock (11 assertions)
```

## Build

```bash
npm run build   # rebuild app.html (~191 KB) from the modular sources
npm test        # MES contract tests + structural guards
npm run icons   # regenerate the maskable PWA icons
npm run mes     # start the MES mock server on http://127.0.0.1:8787
```

Open `index.html` directly in a browser (modular dev mode) or `app.html`
(single-file). No server required.

Both `app.html` and the icon PNGs are committed artifacts. CI regenerates them
and fails the run if either drifts from what is committed, so the deployed site
can never disagree with the sources.

## Guards

`npm test` runs two suites:

- **11 MES contract tests** (`server/test-mes.js`) — the REST contract the
  DataHub adapter expects.
- **18 structural guards** (`tools/test-structure.js`) — the *shape* of the app.
  The Overview absorbed the Products and Processes pages, and both are easy to
  re-add by accident, so the guards assert they stay retired. They also require
  every nav button to have a `VIEWS` entry *and* a renderer, and vice versa —
  which catches a view added half way. If you merge a view back deliberately,
  remove it from the `RETIRED` allowlist in that file.

CI runs both plus the generated-artefact drift check.

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
at `http://127.0.0.1:8787` from the local preview — browsers may block an https
page from calling a local http server (Private Network Access), so test the live
site against it from the local preview instead, or front the mock with TLS.

## PWA

Served over HTTPS, the dashboard registers a service worker that precaches the
full shell. It opens offline and installs as a standalone app from the browser's
install prompt. Cache strategy is stale-while-revalidate: updates land on the
next online visit. Bump `VERSION` in `sw.js` to force a shell refresh.

Chrome will not offer installation without a 192px and a 512px PNG, which is why
`icon-192.png` / `icon-512.png` are generated by `tools/make-icons.js` rather
than hand-drawn. They are maskable: full-bleed background, glyph inside the
central 80% safe circle.

## Data & persistence

Demo-mode edits persist to `localStorage["fdb-overrides-v1"]` (claims, FACA,
Gantt tasks, lot phases) and `resetOverrides()` restores the seeded baseline.
SPC sample series and Western Electric rules live in `data.js`
(`spcSamples`, `westernElectric`, `spcStats`).

All generated data is deterministic — a seeded PRNG drives it — so every reload
reproduces the same dashboard and the KPI baselines stay stable. See
[ARCHITECTURE.md §3.1](ARCHITECTURE.md) for the rules that keep it that way.