# Architecture — FDB NPI Command Center

A handoff document for whoever picks this up next. It describes how data
flows, how edits are layered, what the REST contract is, and where to extend
each part without breaking the zero-dependency constraint.

Companion documents: [README.md](README.md) (what it is, how to run it) and
[.freebuff/run.md](.freebuff/run.md) (reproduce and verify the artifacts).

---

## 1. The hard constraint

**Zero dependencies.** No framework, no bundler, no npm packages — not at
runtime and not at build time. Plain HTML, CSS and vanilla JS, plus `node:zlib`
for the one thing Node can't hand you (PNG encoding, in `tools/make-icons.js`).

This rules out the usual answers to most refactoring questions. There is no
component tree to memoize, no module graph to tree-shake, no CSS pipeline to
extend. What that leaves is:

- **A build step that is a text inliner.** `build.js` does four string
  replacements on `index.html` and writes `app.html`. It does not parse,
  bundle, minify or resolve imports.
- **Globals as the module system.** `DB` (from `data.js`), `CHARTS` (from
  `charts.js`) and the app's own functions are all top-level. Inlining
  concatenates them into one `<script>`, so they share a scope by construction.
- **`node --check` as the type system.** There are no types. Syntax errors are
  the only thing caught before the browser sees the code.

`app.html` is committed and CI fails if it drifts from the sources. That is the
one piece of "tooling" and it is load-bearing — see §7.

---

## 2. Files and load order

```
index.html   app shell only: sidebar, topbar filter chips, view container, OG meta
styles.css   design system: two themes, responsive breakpoints, gantt, print
data.js      DB module — an IIFE returning a single frozen-ish `DB` object
charts.js    CHARTS module — same shape, dependency-free SVG chart primitives
app.js       STATE + router + every view renderer + modals + CSV + DataHub adapter
```

`build.js` inlines `styles.css` into a `<style>` and the three scripts into
`<script>` blocks, preserving order: `data.js` → `charts.js` → `app.js`. Order
matters only because `app.js` reads `DB` and `CHARTS` at call time, not at
definition time.

Load order to preserve when adding a file:

1. A new data module must go **before** `app.js` and expose a global.
2. A new chart primitive belongs in `charts.js` for the same reason.
3. Anything that only `app.js` uses can live inside `app.js` and needs no
   build.js change.

---

## 3. Data flow

```
seeded masters ──┐
                 ├─→ DB (data.js) ──→ view renderers (app.js) ──→ DOM
localStorage ────┤                                      │
  overrides      │                                      └─→ re-render
                 └─→ DB.allAlerts() ──→ badge / ticker / alert feed
                        │
                        └─→ SPC signals, overdue phases, claim & FACA state
```

### 3.1 The `DB` module

`data.js` is one IIFE. Everything it returns is reachable as `DB.*`. It owns:

- **Masters** — `STAGES`, `SIDES`, `RANGES`, `MACHINES`, `PLANTS`, `PROCESSES`,
  `PRODUCTS`, `KPIS`
- **Generated series** — `KPI_SERIES` (42 days per KPI), `STAGE_SERIES`
  (per-stage FPY), `PRODUCT_KPI`, `PROCESS_KPI`, `SIDE_KPI`, `LOT_KPI`
- **Work items** — `LOTS`, `PRODUCT_LOTS`, `LOT_TASKS`, `PROJECTS`, `CLAIMS`,
  `FACA`, `SHIPMENTS`, `PIPELINE`
- **Derived logic** — `plantOf`, `plantProducts/Lots/Claims/Faca`,
  `allAlerts`, `spcStats`, `spcSamples`, `westernElectric`
- **Mutations** — `updateClaim`, `addClaim`, `updateFaca`, `updateProjectTasks`,
  `updateLotTasks`, `resetOverrides`

**Determinism is load-bearing.** The generated data uses a seeded PRNG
(`seed` / `rnd`), and every generator reseeds before it runs. Two rules follow
from this, both learned the hard way:

1. **Reseed before every generator.** Stage names have different lengths, so
   name-based seeding collides across stages.
2. **Never consume the shared PRNG for decoration.** `STAGE_SERIES` uses a local
   `wob(a, b)` hash instead of `rnd()` precisely so it cannot shift every other
   generated dataset downstream.

If you add a generator, follow both rules or every number in the app shifts and
the baselines stop matching `PLANT_BIAS`.

### 3.2 State

`STATE` (in `app.js`) is one flat object holding every filter and UI mode:
`plant`, `product`, `stage`, `side`, `machine`, `lot`, `range`, `alertFilter`,
`sortKey`/`sortDir`, `ganttMode`/`ganttZoom`/`ganttCenter`, `kpiFocus`,
`fpyMode`, `tblSearch`/`tblStage`, `spcLot`, `hovered`.

It is **not persisted** except where noted in §4. A reload resets filters to
defaults. The exceptions are deliberate and each uses its own key:
`fdb-kpi-collapsed` (deep-dive collapse), `fdb-dh-mode` / `fdb-dh-url`
(DataHub), `fdb-overrides-v1` (data edits).

### 3.3 Filtering

Plant is the **outermost** filter. `applyPlant()` re-derives the machine
segment, the product select and the lot select, and clears any now out-of-scope
selection. Everything downstream reads `filteredProducts()`, which composes
plant → product → stage → side → machine. Change the order in `filteredProducts()`
and the cascading behaviour changes; change `applyPlant()` and the selects drift
out of sync with the data.

### 3.4 Rendering

Two-phase per view: `viewX()` returns an HTML string, `mountX()` queries the
result and binds events. The split exists because `mountOverview()` re-runs
every 15 seconds from a `setInterval` in `boot()`.

**Consequence: every binding must be re-established on each mount.** There is
no event delegation for most things. If you add a control, bind it in `mountX()`,
not once at boot.

A second consequence: anything holding a stale node reference across a re-mount
is a bug waiting to happen. Query inside the mount.

---

## 4. Override layers

Three layers stack, and the topmost wins:

1. **Seeded baseline** — generated at load from the seeded PRNG.
2. **`localStorage["fdb-overrides-v1"]`** — a deep snapshot of edited
   collections (`claims`, `claimsAdd`, `faca`, `projects`, `lotTasks`) plus
   `BASELINE` copies of the originals. Editable state survives reload;
   `resetOverrides()` restores the baseline and clears the key.
3. **REST** — when DataHub is in REST mode, mutations go over the wire
   (§5) and the local copy is updated from the response.

`LS_KEY` is exported from `data.js` so nothing else hard-codes the string.
Prefer editing through the `update*` / `add*` functions over writing
`localStorage` directly — they keep the snapshot consistent.

One caution: **the override layer is per-browser, not per-user.** It is a demo
convenience, not a collaboration feature. Two people editing the same dashboard
will not see each other's changes.

---

## 5. REST contract

⚙️ Settings switches the data layer between `demo` and `rest`. The adapter lives
in `app.js` (`DataHub`); `server/mes-mock.js` implements the contract with zero
dependencies, and `server/test-mes.js` asserts it (11 tests, run by CI).

```
GET   /health              → liveness probe; drives the connection pill
GET   /claims              → list (debugging aid)
GET   /faca                → list (debugging aid)
POST  /claims              → create; body is a claim, returns the new record
PATCH /claims/:id          → partial update by id
PATCH /faca/:id            → partial update by id
```

Conventions the mock establishes, which a real backend must match:

- `PATCH` merges the body into the stored record; omitted fields are untouched.
- Unknown id → `404`. Malformed JSON → `400`. Unknown route → `404`.
- CORS headers on **every** response, including errors.
- `/health` exists so the UI can distinguish "server down" from "no data yet".

`npm run mes` starts it on port 8787 (`PORT` to override). Point Settings at
`http://127.0.0.1:8787` **from the local preview**, not the Pages origin —
browsers block https → http://localhost under Private Network Access.

---

## 6. Charts

`CHARTS` (`charts.js`) returns `lineChart`, `spark`, `donut`, `controlChart`,
`pareto`, plus the maths helpers `movingAvg`, `envelope`, `autoDec`.

Two shared rules worth knowing before you add a chart:

- **`autoDec(lo, hi)`** decides decimal precision. Tight ranges need a decimal
  or every tick renders as the same string. `lineChart`, `controlChart` and
  `pareto` all route through it — that is why their axes no longer collide.
- **`lineChart` tolerates nulls.** Overlays may start partway in (a moving
  average has no value until its window fills), and it emits one sub-path per
  run of real values rather than a single path with holes. It also filters
  non-finite values out of the y-domain — forget that and one `null` coerces
  to `0` and flattens the axis.

Overlay lines come in via `opts.extras` (`{data, color, dash, label}`) and
envelopes via `opts.band` (`{lo, hi, color}`); both participate in y-domain
calculation.

---

## 7. Build and CI

```
node build.js                 → app.html  (committed)
node tools/make-icons.js      → icon-192.png, icon-512.png  (committed)
node server/test-mes.js       → 11 contract tests
node tools/test-structure.js  → 18 structural guards
```

CI (`.github/workflows/ci.yml`) on every push to `master`:

1. `node --check` on `app.js`, `charts.js`, `data.js`, `build.js`, `sw.js`,
   `tools/make-icons.js`, `tools/test-structure.js`
2. MES contract tests
3. Structural guards
4. Regenerates the PWA icons and rebuilds `app.html`
5. **Fails if any generated artefact differs from what is committed**

Both generators are byte-deterministic (the icon PNGs are verified by SHA-256
after a double run), so step 5 catches real drift and not noise. If CI fails on
staleness, run both commands locally and commit the result.

Push → CI ~1 min → GitHub Pages ~30 s.

### The structural guards

`tools/test-structure.js` guards the *shape* of the app rather than its data.
The Overview absorbed the Products and Processes pages and the KPI view was
retired earlier, and all three are easy to re-add by accident — paste a nav
button, add a `VIEWS` entry, forget the renderer. The guards assert:

- the three retired views stay retired (nav button, registry entry, renderer,
  and any orphaned `viewX`/`mountX` function)
- **every nav button has a `VIEWS` entry and a renderer, and vice versa** —
  which catches a view added *half way*, the likelier accident
- no duplicate nav buttons
- the content the deleted pages owned is still on the Overview (`#flowWrap`,
  `#procMatrix`, `#prodTableWrap`, `#prodSearch`, `#tblStageSeg`,
  `#exportProducts`, `openProcModal`, `seqBreaks`)
- the purged L1–L4 framing stays purged

The registry is parsed out of `app.js` with a regex rather than by importing it,
because `app.js` is a browser script with no module boundary — the same reason
the app uses globals instead of imports.

`npm test` runs both suites. If you re-add a deliberately-merged view on
purpose, delete its entry from `RETIRED` in that file — it is a deliberate
allowlist, not an accident to work around.

---

## 8. PWA

`sw.js` precaches a shell (`SHELL`) with stale-while-revalidate: cache-first,
background revalidate. `VERSION` keys the cache — **bump it whenever `SHELL`
changes** or returning visitors keep the old shell.

`index.html` registers the worker; `manifest.webmanifest` declares the icons.
`icon.svg` is the vector `any` icon; `icon-192.png` / `icon-512.png` are
generated, maskable and required — Chrome will not offer the install prompt
without a 192 and a 512 PNG.

Maskable icons must survive being cropped to the central 80% circle, which is
why `tools/make-icons.js` draws full-bleed and keeps the glyph inside that
circle. Keep that property if you change the mark.

---

## 9. Extension points

| To add… | Do this | Where |
|---|---|---|
| A KPI | add to `KPIS`, give it a `KPI_SERIES` entry, add a `target`/`good` | `data.js` + `kpiSnapshot`, `kpiSeries` |
| A stage | append to `STAGES`; give it a colour in `STAGE_COLOR` and `STAGE_SERIES_COLOR` | `data.js`, `app.js` |
| A process | append to `PROCESSES` with `PROCESS_KPI[stage]` for every stage | `data.js` |
| A plant | append to `PLANTS`, map machines in `MACHINE_PLANT`, add a `PLANT_BIAS` entry | `data.js` |
| A chart type | return it from the `CHARTS` IIFE | `charts.js` |
| A view | add to `VIEWS` (title/sub), add `[viewX, mountX]` to `renderers`, add a nav button — all three, or `test:structure` fails | `app.js`, `index.html` |
| An alert source | give it a `type` and push into the list `allAlerts()` builds | `data.js` |
| A REST endpoint | extend the DataHub adapter **and** `server/mes-mock.js`, then add a test | `app.js`, `server/` |

### Two things to preserve

**Views are now deliberately consolidated.** Overview carries the KPI deep
dive, the product table with its inline search, the process flow with its
detail modal, and the stage × process matrix. Dedicated pages for Products and
Processes were removed once their content was duplicated on the Overview. Before
adding a card, check whether the Overview already says it — duplication is the
failure mode this codebase has been actively pruned of.

**Accessibility basics are already in place and easy to regress:** the section
nav and deep-dive tabs are real `<button>`/`<a>` elements, matrix and flow rows
are keyboard-focusable with `:focus-visible` outlines, the strip tiles respond
to Enter and Space, and modals are dismissible. Adding a clickable `<div>` would
undo that.

---

## 10. Known sharp edges

- **The Overview re-mounts every 15 s.** Anything holding focus or a text cursor
  across a mount is lost. `refreshProductTable()` exists specifically to
  re-render only the table so the search box keeps focus while typing — use that
  pattern for any input on a re-mounting view.
- **`register_preview` serves one file.** The Freebuff preview exposes only the
  registered `htmlPath`; loose assets (the PNG icons) 404 there. Inspect them by
  inlining as data URIs.
- **`sw.js` 404s under the preview** for the same reason. Harmless; it serves
  fine on Pages.
- **`code_search` is unavailable** in this environment (its vendored `rg` is
  missing). Use `grep` via the terminal.
- **Commit identity is not configured globally.** Pass
  `-c user.name='Tianfong' -c user.email='Tianfong@users.noreply.github.com'`
  on every commit.