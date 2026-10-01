"use strict";
/* ============================================================
   MES mock server — implements the FDB NPI dashboard REST contract.

   Zero dependencies (node:http only). Run:  node server/mes-mock.js
   Port:  env PORT, default 8787

   Contract:
     GET    /health        → { ok, service, ts }
     GET    /claims        → claim list
     POST   /claims        → create claim (auto id CL-####), 201
     PATCH  /claims/:id    → merge patch, 404 unknown
     GET    /faca          → faca list
     PATCH  /faca/:id      → merge patch, 404 unknown

   CORS is always enabled (the dashboard is hosted on GitHub Pages and
   calls this server cross-origin during development).
   ============================================================ */
const http = require("http");

const SEED = {
  claims: [
    { id: "CL-2213", product: "X4152", side: "RHS", customer: "NovaServe", severity: "Critical",
      status: "Containment", issue: "Acoustic escape D01 — bearing noise >32dB", qty: 86, owner: "QE-1", eta: "2026-10-02" },
    { id: "CL-2214", product: "X4151", side: "LHS", customer: "OrionTech", severity: "Major",
      status: "CA verification", issue: "Hub torque drift D02", qty: 64, owner: "QE-2", eta: "2026-10-09" },
    { id: "CL-2215", product: "X4154", side: "RHS", customer: "KestrelAuto", severity: "Minor",
      status: "Open", issue: "Cosmetic label smudge D06", qty: 28, owner: "QE-3", eta: "2026-10-15" },
  ],
  faca: [
    { id: "FA-101", title: "Pillow-stator press-fit window widening", product: "X4154",
      stage: "PVT", owner: "ME-2", status: "Overdue", progress: 45, due: "2026-09-20" },
    { id: "FA-097", title: "DC bit wear beyond PM interval", product: "X4151",
      stage: "DVT", owner: "ME-1", status: "CA in effect", progress: 80, due: "2026-10-05" },
  ],
};

function createMock(){
  const db = JSON.parse(JSON.stringify(SEED));

  function json(req, res, code, body){
    res.writeHead(code, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    });
    res.end(JSON.stringify(body));
  }

  function readBody(req, cb){
    let body = "";
    req.on("data", c => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on("end", () => cb(body));
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean);
    const log = `${req.method} ${url.pathname} → `;

    if (req.method === "OPTIONS") return json(req, res, 204, {});

    if (req.method === "GET" && url.pathname === "/health"){
      return json(req, res, 200, { ok: true, service: "mes-mock", ts: new Date().toISOString() });
    }
    if (req.method === "GET" && parts[0] === "claims" && !parts[1]){
      return json(req, res, 200, db.claims);
    }
    if (req.method === "GET" && parts[0] === "faca" && !parts[1]){
      return json(req, res, 200, db.faca);
    }
    if (req.method === "POST" && parts[0] === "claims" && !parts[1]){
      return readBody(req, body => {
        let claim;
        try { claim = JSON.parse(body || "{}"); }
        catch (e) { return json(req, res, 400, { error: "invalid JSON" }); }
        if (!claim.product || !claim.customer) return json(req, res, 400, { error: "product and customer are required" });
        if (!claim.id) claim.id = "CL-" + (2300 + db.claims.length);
        if (db.claims.find(c => c.id === claim.id)) return json(req, res, 409, { error: "claim id already exists" });
        db.claims.push(claim);
        console.log(log + `201 created ${claim.id}`);
        return json(req, res, 201, claim);
      });
    }
    if (req.method === "PATCH" && (parts[0] === "claims" || parts[0] === "faca") && parts[1]){
      const list = parts[0] === "claims" ? db.claims : db.faca;
      const rec = list.find(x => x.id === decodeURIComponent(parts[1]));
      if (!rec){
        console.log(log + "404 unknown id");
        return json(req, res, 404, { error: `${parts[0].slice(0, -1)} ${parts[1]} not found` });
      }
      return readBody(req, body => {
        let patch;
        try { patch = JSON.parse(body || "{}"); }
        catch (e) { return json(req, res, 400, { error: "invalid JSON" }); }
        Object.assign(rec, patch);
        console.log(log + "200 merged " + rec.id);
        return json(req, res, 200, rec);
      });
    }
    json(req, res, 404, { error: "not found", path: url.pathname });
    console.log(log + "404 no route");
  });

  return { server, db };
}

if (require.main === module){
  const port = Number(process.env.PORT) || 8787;
  const { server } = createMock();
  server.listen(port, () => {
    console.log(`MES mock listening on http://127.0.0.1:${port}`);
    console.log(`Contract: GET /health · GET /claims · POST /claims · PATCH /claims/:id · PATCH /faca/:id`);
  });
}

module.exports = { createMock };
