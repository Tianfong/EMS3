"use strict";
/* ============================================================
   Structural guard tests (zero dependencies).

   Run:  node tools/test-structure.js
         npm test

   These are not MES contract tests — they guard the *shape* of the app.
   The Overview absorbed the Products and Processes pages, and the KPI
   view was retired even earlier. All three are easy to re-add by accident
   (copy a nav button, paste a renderer) and all three would duplicate
   content that already lives on the Overview.

   So this asserts two things:

     1. The retired views stay retired.
     2. Every nav button has a VIEWS entry and a renderer, and vice
        versa — which catches a view added *half way*, which is the
        more likely accident.

   Plus a couple of cheap checks that the merged content is actually
   where we said it is, and that the purged L1-L4 framing stays purged.
   ============================================================ */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");

const indexHtml = read("index.html");
const appJs = read("app.js");

const results = [];
function check(name, fn){
  try { fn(); results.push(`PASS  ${name}`); }
  catch (err){ results.push(`FAIL  ${name} — ${err.message}`); process.exitCode = 1; }
}

/* views that were deliberately removed; see README "Before → after" */
const RETIRED = {
  products:  "folded into the Overview product table",
  processes: "folded into the Overview flow, process modal and matrix",
  kpi:       "deep dive is embedded in the Overview",
};

const navViews = [...indexHtml.matchAll(/data-view="([a-zA-Z0-9_-]+)"/g)].map(m => m[1]);

/* the VIEWS registry: const VIEWS = { key: {...}, ... }; */
const viewsBlock = appJs.match(/const VIEWS = \{([\s\S]*?)\n\};/);
const registryViews = viewsBlock
  ? [...viewsBlock[1].matchAll(/^\s*([a-zA-Z0-9_-]+)\s*:\s*\{/gm)].map(m => m[1])
  : [];

/* the renderer map: const renderers = { key: [viewX, mountX], ... }; */
const renderersBlock = appJs.match(/const renderers = \{([\s\S]*?)\n\s*\};/);
const rendererViews = renderersBlock
  ? [...renderersBlock[1].matchAll(/^\s*([a-zA-Z0-9_-]+)\s*:/gm)].map(m => m[1])
  : [];

// ---------------------------------------------------------------- retired

for (const [view, why] of Object.entries(RETIRED)){
  check(`nav has no "${view}" view (${why})`, () => {
    assert.ok(!navViews.includes(view), `index.html still has a nav button for "${view}"`);
  });

  check(`"${view}" is absent from the VIEWS registry and renderer map`, () => {
    assert.ok(!registryViews.includes(view), `VIEWS still registers "${view}"`);
    assert.ok(!rendererViews.includes(view), `renderers still maps "${view}"`);
  });

  check(`"${view}" has no orphaned render/mount function`, () => {
    const camel = view[0].toUpperCase() + view.slice(1);
    for (const fn of [`view${camel}`, `mount${camel}`]){
      assert.ok(!new RegExp(`function\\s+${fn}\\s*\\(`).test(appJs),
        `${fn}() still exists in app.js`);
    }
  });
}

// ---------------------------------------------------- registry integrity

check("VIEWS registry is parseable and non-empty", () => {
  assert.ok(viewsBlock, "could not find the `const VIEWS = {` block in app.js");
  assert.ok(registryViews.length > 0, "VIEWS registry parsed as empty");
});

check("renderer map is parseable and non-empty", () => {
  assert.ok(renderersBlock, "could not find the `const renderers = {` block in app.js");
  assert.ok(rendererViews.length > 0, "renderer map parsed as empty");
});

check("every nav button has a VIEWS entry and a renderer", () => {
  const missingView = navViews.filter(v => !registryViews.includes(v));
  const missingRender = navViews.filter(v => !rendererViews.includes(v));
  assert.deepEqual(missingView, [], `nav buttons with no VIEWS entry: ${missingView.join(", ")}`);
  assert.deepEqual(missingRender, [], `nav buttons with no renderer: ${missingRender.join(", ")}`);
});

check("every VIEWS entry has a nav button and a renderer (no orphan views)", () => {
  const noButton = registryViews.filter(v => !navViews.includes(v));
  const noRender = registryViews.filter(v => !rendererViews.includes(v));
  assert.deepEqual(noButton, [], `registered views with no nav button: ${noButton.join(", ")}`);
  assert.deepEqual(noRender, [], `registered views with no renderer: ${noRender.join(", ")}`);
});

check("nav, VIEWS registry and renderer map describe the same set", () => {
  assert.deepEqual([...navViews].sort(), [...registryViews].sort(),
    "nav buttons and VIEWS registry disagree");
  assert.deepEqual([...rendererViews].sort(), [...registryViews].sort(),
    "renderer map and VIEWS registry disagree");
});

check("no nav button is a duplicate", () => {
  const dupes = navViews.filter((v, i) => navViews.indexOf(v) !== i);
  assert.deepEqual(dupes, [], `duplicate nav buttons: ${dupes.join(", ")}`);
});

// ------------------------------------------- merged content still on Overview

check("Overview still carries the content the deleted pages owned", () => {
  for (const sel of ["#flowWrap", "#procMatrix", "#prodTableWrap", "#prodSearch", "#tblStageSeg", "#exportProducts"]){
    assert.ok(indexHtml.length >= 0 && appJs.includes(sel), `app.js no longer references ${sel}`);
  }
  assert.ok(/function\s+openProcModal\s*\(/.test(appJs),
    "openProcModal() is gone — the flow and matrix have no detail view");
  assert.ok(/function\s+seqBreaks\s*\(/.test(appJs),
    "seqBreaks() is gone — broken gantt sequences are no longer flagged");
});

// --------------------------------------------------------- framing stays purged

check("no L1-L4 production-line framing in app code or meta", () => {
  for (const f of ["index.html", "app.js", "data.js", "styles.css"]){
    assert.ok(!/\bL[1-4]\b/.test(read(f)), `${f} still mentions a production line (L1-L4)`);
  }
});

check("README documents plants/fixtures, not lines", () => {
  const readme = read("README.md");
  // The docs are allowed to *name* the removal — the changelog does — but they
  // must never present lines as a live dimension of the dashboard.
  assert.ok(!/^\|\s*\*\*Lines\*\*/m.test(readme), "README scope table still lists a Lines dimension");
  assert.ok(!/fan lines/i.test(readme), "README still describes the app as covering fan lines");
  assert.ok(/^\|\s*\*\*Plants\*\*/m.test(readme), "README scope table is missing the Plants dimension");
  assert.ok(/^\|\s*\*\*Fixtures\*\*/m.test(readme), "README scope table is missing the Fixtures dimension");
});

// --------------------------------------------------------------- report

console.log(results.join("\n"));
const failed = results.filter(r => r.startsWith("FAIL")).length;
if (failed){
  console.error(`\n${failed} of ${results.length} structure guards failed.`);
} else {
  console.log(`\nAll ${results.length} structure guards passed.`);
}