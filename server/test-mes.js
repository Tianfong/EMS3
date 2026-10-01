"use strict";
/* ============================================================
   Contract tests for the MES mock server (zero dependencies).

   Run:  node server/test-mes.js
   Starts the mock on an ephemeral port and exercises every route
   of the REST contract the dashboard expects.
   ============================================================ */
const assert = require("assert");
const { createMock } = require("./mes-mock.js");

const results = [];
function check(name, fn){
  return fn()
    .then(() => { results.push(`PASS  ${name}`); })
    .catch(err => { results.push(`FAIL  ${name} — ${err.message}`); throw err; });
}

const { server } = createMock();
server.listen(0, () => {
  const base = `http://127.0.0.1:${server.address().port}`;

  const run = Promise.resolve()
    .then(() => check("GET /health returns ok", async () => {
      const r = await fetch(base + "/health");
      const b = await r.json();
      assert.equal(r.status, 200);
      assert.equal(b.ok, true);
      assert.equal(b.service, "mes-mock");
    }))
    .then(() => check("GET /claims lists seeded claims", async () => {
      const r = await fetch(base + "/claims");
      const b = await r.json();
      assert.equal(r.status, 200);
      assert.ok(Array.isArray(b) && b.length >= 3);
      assert.ok(b.every(c => c.id && c.product && c.customer));
    }))
    .then(() => check("POST /claims creates a claim with auto id", async () => {
      const r = await fetch(base + "/claims", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product: "X4153", side: "LHS", customer: "Halcón", severity: "Major", status: "Open", qty: 5 }),
      });
      const b = await r.json();
      assert.equal(r.status, 201);
      assert.match(b.id, /^CL-\d+$/);
      assert.equal(b.customer, "Halcón");
    }))
    .then(() => check("POST /claims without required fields → 400", async () => {
      const r = await fetch(base + "/claims", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ severity: "Major" }),
      });
      assert.equal(r.status, 400);
    }))
    .then(() => check("PATCH /claims/:id merges fields", async () => {
      const r = await fetch(base + "/claims/CL-2213", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "Closed", eta: "2026-10-01" }),
      });
      const b = await r.json();
      assert.equal(r.status, 200);
      assert.equal(b.status, "Closed");
      const after = await (await fetch(base + "/claims")).json();
      assert.equal(after.find(c => c.id === "CL-2213").eta, "2026-10-01");
    }))
    .then(() => check("PATCH /claims/UNKNOWN → 404", async () => {
      const r = await fetch(base + "/claims/CL-0000", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      assert.equal(r.status, 404);
    }))
    .then(() => check("PATCH /faca/:id merges fields", async () => {
      const r = await fetch(base + "/faca/FA-101", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ progress: 55, status: "CA in effect" }),
      });
      const b = await r.json();
      assert.equal(r.status, 200);
      assert.equal(b.progress, 55);
      assert.equal(b.status, "CA in effect");
    }))
    .then(() => check("PATCH /faca/UNKNOWN → 404", async () => {
      const r = await fetch(base + "/faca/FA-000", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      assert.equal(r.status, 404);
    }))
    .then(() => check("invalid JSON body → 400", async () => {
      const r = await fetch(base + "/claims/CL-2214", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: "{not json",
      });
      assert.equal(r.status, 400);
    }))
    .then(() => check("unknown route → 404", async () => {
      const r = await fetch(base + "/nope");
      assert.equal(r.status, 404);
    }))
    .then(() => check("CORS headers present on every response", async () => {
      const r = await fetch(base + "/health");
      assert.equal(r.headers.get("access-control-allow-origin"), "*");
      const pre = await fetch(base + "/claims/CL-2213", {
        method: "OPTIONS",
        headers: { "Origin": "https://tianfong.github.io", "Access-Control-Request-Method": "PATCH" },
      });
      assert.equal(pre.headers.get("access-control-allow-origin"), "*");
      assert.ok((pre.headers.get("access-control-allow-methods") || "").includes("PATCH"));
    }))
    .then(() => { console.log(results.join("\n")); console.log(`\nAll ${results.length} contract tests passed.`); server.close(); })
    .catch(err => { console.error(results.join("\n")); console.error("\nContract test failure:", err.message); server.close(); process.exitCode = 1; });
});
