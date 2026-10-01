"use strict";
/* ============================================================
   FDB NPI Command Center — main app
   ============================================================ */

const STATE = {
  view: "overview",
  product: "ALL",
  stage: "ALL",
  side: "ALL",
  line: "ALL",
  lot: "ALL",
  spcLot: "ALL",
  range: "30D",
  sortKey: null,
  sortDir: 1,
  hovered: null,
  ganttMode: "lots",
  ganttZoom: "week",
  ganttCenter: null,
};

const VIEWS = {
  overview:  { title:"Overview",       sub:"New Product Introduction · real-time command view" },
  products:  { title:"Products",       sub:"X4151–X4156 · stage, side, yield & volume" },
  processes: { title:"Processes",      sub:"Rotor · Pillow-stator · Fan assembly · Test accessory" },
  kpi:       { title:"KPI Deep Dive",  sub:"FPY · FY · UPH · OEE · Shipment · Claims · FACA" },
  quality:   { title:"Quality — SPC",  sub:"Control charts · Cpk · Pareto · defect mix" },
  gantt:     { title:"Projects — Gantt", sub:"NPI stage gates & ramp plan" },
  faca:      { title:"FACA",           sub:"Follow-up & Corrective Action Committee" },
  claims:    { title:"Customer Claims",sub:"Complaints, containment & 8D" },
  shipments: { title:"Shipment Achievement", sub:"Commit vs actual, weekly" },
};

const $q  = s => document.querySelector(s);
const $q$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

/* ---------- helpers ---------- */
function delta(arr, n=1){
  const a = arr.at(-1-n), b = arr.at(-1);
  if (a === undefined || a === 0) return null;
  return (b - a) / a * 100;
}
const trendHtml = d => d == null ? `<span class="trend fl">—</span>`
  : `<span class="trend ${d>=0.05?"up":d<=-0.05?"dn":"fl"}">${d>=0?"▲":"▼"} ${Math.abs(d).toFixed(1)}%</span>`;

function toast(msg, kind="acc"){
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.innerHTML = msg;
  $q("#toastRoot").appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; el.style.transform = "translateX(20px)"; }, 2600);
  setTimeout(() => el.remove(), 3000);
}

/* ---------- DataHub: demo (in-memory, persisted locally) or REST ---------- */
const DataHub = {
  mode: localStorage.getItem("fdb-dh-mode") || "demo",
  baseUrl: localStorage.getItem("fdb-dh-url") || "",
  async req(path, opt){
    const res = await fetch(this.baseUrl.replace(/\/$/,"") + path, {
      headers: { "Content-Type": "application/json" },
      ...opt,
    });
    if (!res.ok) throw new Error(res.status + " " + res.statusText);
    return res.json();
  },
  testConnection(){
    if (this.mode !== "rest") return Promise.resolve({ ok:true, note:"demo mode — in-memory data, edits persist locally" });
    return this.req("/health").then(() => ({ ok:true, note:"REST endpoint answered /health" }))
      .catch(e => ({ ok:false, note:String(e.message || e) }));
  },
  async updateClaim(id, patch){
    if (this.mode === "rest") await this.req(`/claims/${id}`, { method:"PATCH", body: JSON.stringify(patch) });
    DB.updateClaim(id, patch);
  },
  async addClaim(claim){
    if (this.mode === "rest"){ const saved = await this.req("/claims", { method:"POST", body: JSON.stringify(claim) }); DB.addClaim(saved || claim); }
    else DB.addClaim(claim);
  },
  async updateFaca(id, patch){
    if (this.mode === "rest") await this.req(`/faca/${id}`, { method:"PATCH", body: JSON.stringify(patch) });
    DB.updateFaca(id, patch);
  },
};

/* ---------- CSV export (Excel-compatible BOM) ---------- */
function exportCSV(name, rows){
  const q = v => { const s = String(v ?? ""); return /[",\n]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s; };
  const csv = [rows[0].map(q).join(","), ...rows.slice(1).map(r => r.map(q).join(","))].join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type:"text/csv;charset=utf-8" }));
  a.download = name; a.click();
  URL.revokeObjectURL(a.href);
  toast(`Exported <b>${name}</b> (${rows.length - 1} rows)`, "good");
}
function exportProducts(){
  exportCSV("fdb-products.csv", [["Product","Model","Customer","Stage","Side","FPY","FY","UPH","OEE","Ship%","Claims","FACA","YTD","Target"],
    ...filteredProducts().map(p => { const k = DB.PRODUCT_KPI[p.id];
      return [p.id, p.name, p.customer, p.stage, p.side, k.fpy, k.fy, k.uph, k.oee, k.ship, k.claim, k.faca, p.vol.ytd, p.vol.target]; })]);
}
function exportClaims(){
  exportCSV("fdb-claims.csv", [["Claim","Product","Side","Customer","Severity","Status","Issue","Qty","Owner","ETA"],
    ...DB.CLAIMS.map(c => [c.id, c.product, c.side, c.customer, c.severity, c.status, c.issue, c.qty, c.owner, c.eta])]);
}
function exportShipments(){
  exportCSV("fdb-shipments.csv", [["Week","Commit","Actual","Achievement%"],
    ...DB.SHIPMENTS.map(s => [s.week, s.commit, s.actual, (s.actual/s.commit*100).toFixed(1)])]);
}

/* ---------- sortable products ---------- */
const SORTABLE = ["id","name","stage","lot","side","line","fpy","fy","uph","oee","ship","claim","vol"];
function sortedProducts(){
  const key = STATE.sortKey;
  const val = p => {
    const k = DB.PRODUCT_KPI[p.id];
    return ({ id:p.id, name:p.name, stage:p.stage, lot:(DB.PRODUCT_LOTS[p.id]||[]).join(","), side:p.side, line:p.line,
      fpy:k.fpy, fy:k.fy, uph:k.uph, oee:k.oee, ship:k.ship, claim:k.claim,
      vol:p.vol.ytd/p.vol.target })[key];
  };
  const arr = [...filteredProducts()];
  if (key) arr.sort((a,b) => { const x = val(a), y = val(b); return (x<y?-1:x>y?1:0) * STATE.sortDir; });
  return arr;
}

/* ---------- theme ---------- */
function applyTheme(t){
  document.documentElement.dataset.theme = t;
  const btn = $q("#themeBtn"); if (btn) btn.textContent = t === "dark" ? "🌙" : "☀️";
  try { localStorage.setItem("fdb-theme", t); } catch(e){}
}
function initTheme(){
  let t = null;
  try { t = localStorage.getItem("fdb-theme"); } catch(e){}
  applyTheme(t || "dark");
}

/* ---------- filtering ---------- */
function filteredProducts(){
  return DB.PRODUCTS.filter(p =>
    (STATE.product === "ALL" || p.id === STATE.product) &&
    (STATE.stage === "ALL" || p.stage === STATE.stage) &&
    (STATE.side === "ALL" || p.side.includes(STATE.side)) &&
    (STATE.line === "ALL" || p.line === STATE.line) &&
    (STATE.lot === "ALL" || (DB.PRODUCT_LOTS[p.id] || []).includes(STATE.lot))
  );
}
function rebuildLotSelect(){
  const sel = $q("#lotSel");
  if (!sel) return;
  const avail = STATE.stage === "ALL" ? DB.LOTS : DB.LOTS.filter(l => l.stage === STATE.stage);
  sel.innerHTML = `<option value="ALL">All lots</option>` +
    avail.map(l => `<option value="${l.id}" ${STATE.lot===l.id?"selected":""}>${l.id} · ${l.stage} · ${DB.fmtW(l.units)}u</option>`).join("");
  if (STATE.lot !== "ALL" && !avail.some(l => l.id === STATE.lot)) STATE.lot = "ALL";
  sel.value = STATE.lot;
  sel.onchange = () => {
    STATE.lot = sel.value;
    if (STATE.lot !== "ALL"){
      const lot = DB.LOTS.find(l => l.id === STATE.lot);
      if (lot && STATE.stage === "ALL"){ STATE.stage = lot.stage; }
    }
    syncSegs();
    setView(STATE.view);
    toast(`Lot → <b>${STATE.lot==="ALL"?"All":STATE.lot}</b>`);
  };
}
function buildProductSelect(){
  const sel = $q("#productSel");
  sel.innerHTML = `<option value="ALL">All products</option>` +
    DB.PRODUCTS.map(p => `<option value="${p.id}" ${STATE.product===p.id?"selected":""}>${p.id} · ${esc(p.name)}</option>`).join("");
  sel.value = STATE.product;
  sel.onchange = () => {
    STATE.product = sel.value;
    // keep line/stage/lot coherent with the chosen product
    if (STATE.product !== "ALL"){
      const p = DB.PRODUCTS.find(x => x.id === STATE.product);
      if (p){
        STATE.line = p.line;
        if (p.stage !== STATE.stage){ STATE.stage = p.stage; STATE.lot = "ALL"; }
      }
    }
    syncSegs();
    setView(STATE.view);
    refreshBadges(); buildTicker();
    toast(`Product → <b>${STATE.product==="ALL"?"All":STATE.product}</b>`);
  };
}
function sliceByRange(series){
  const n = { "7D":7, "30D":14, "QTD":28, "YTD":42 }[STATE.range] ?? 14;
  return series.slice(-n);
}
function labelsFor(series, n){
  const out = [];
  const end = DB.TODAY;
  for (let i = n-1; i >= 0; i--){
    const d = new Date(end); d.setDate(d.getDate()-i);
    out.push(`${d.getMonth()+1}/${d.getDate()}`);
  }
  return out;
}
function isoOf(dt){
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}-${String(dt.getDate()).padStart(2,"0")}`;
}

/* ============================================================
   KPI SNAPSHOT — respects product/stage/side filters
   ============================================================ */
function kpiSnapshot(){
  const prods = filteredProducts();
  const stageIdx = STAGE_IDX[STATE.stage] ?? 1.5; // avg stage penalty
  const prodsAvg = key => prods.length
    ? prods.reduce((s,p)=>s+DB.PRODUCT_KPI[p.id][key],0)/prods.length
    : 96.2;

  let fpy  = prodsAvg("fpy");
  let fy   = prodsAvg("fy");
  let uph  = Math.round(prodsAvg("uph"));
  let oee  = prodsAvg("oee");
  let ship = prodsAvg("ship");

  // stage filter bias: blend toward stage-level values
  if (STATE.stage !== "ALL"){
    const sb = { P1:-3.4, P2:-2.1, EVT:-1.4, DVT:-0.6, PVT:0 }[STATE.stage] ?? 0;
    fpy += sb*0.55; fy += sb*0.3; uph = Math.round(uph + sb*8); oee += sb*0.7;
  }
  // side bias
  if (STATE.side !== "ALL"){
    fpy += (DB.SIDE_KPI[STATE.side].fpy - 96.2)*0.6;
    uph = Math.round(uph + (DB.SIDE_KPI[STATE.side].uph - 146)*0.5);
    oee += (DB.SIDE_KPI[STATE.side].oee - 79.5)*0.6;
  }
  // lot bias — selected lot's own KPIs dominate the blend
  if (STATE.lot !== "ALL" && DB.LOT_KPI[STATE.lot]){
    const lk = DB.LOT_KPI[STATE.lot];
    fpy = fpy*0.35 + lk.fpy*0.65;
    fy  = fy*0.35 + lk.fy*0.65;
    uph = Math.round(uph*0.35 + lk.uph*0.65);
    oee = oee*0.35 + lk.oee*0.65;
  }
  // line bias
  if (STATE.line !== "ALL" && DB.LINE_KPI[STATE.line]){
    fpy += (DB.LINE_KPI[STATE.line].fpy - 96.3)*0.7;
    uph = Math.round(uph + (DB.LINE_KPI[STATE.line].uph - 150)*0.55);
    oee += (DB.LINE_KPI[STATE.line].oee - 80)*0.7;
    ship += (DB.LINE_KPI[STATE.line].ship - 97.5)*0.6;
  }
  fpy  = Math.min(99.8, Math.max(84, fpy));
  fy   = Math.min(99.9, Math.max(90, fy));
  oee  = Math.min(94, Math.max(60, oee));
  ship = Math.min(100, Math.max(80, ship));

  const claims = DB.CLAIMS.filter(c =>
    (STATE.product==="ALL" || c.product===STATE.product) &&
    (STATE.side==="ALL" || c.side===STATE.side)
  ).length;
  const facas = DB.FACA.filter(f =>
    (STATE.product==="ALL" || f.product===STATE.product)
  ).length;

  return {
    fpy:+fpy.toFixed(1), fy:+fy.toFixed(1), uph, oee:+oee.toFixed(1), ship:+ship.toFixed(1),
    claim: claims, faca: facas,
    nProducts: prods.length,
  };
}
const STAGE_IDX = { P1:3.4, P2:2.1, EVT:1.4, DVT:0.6, PVT:0 };

/* ---------- range-shifted series for the filtered snapshot ---------- */
function shiftedSeries(base, shiftPct, n){
  const f = 1 + shiftPct/100;
  return base.slice(-n).map(v => +(v*f).toFixed(2));
}

/* ============================================================
   VIEW RENDERERS
   ============================================================ */
function renderKpiCards(mount, snap){
  const S = DB.KPI_SERIES;
  const defs = [
    { id:"fpy",  ico:"✅", name:"FPY",  full:"First Pass Yield", val:`${snap.fpy}%`,  kc:"var(--good)", series:shiftedSeries(S.fpy, (snap.fpy-96.2)*0.8), target:96.5, note:"blended, rotor→test" },
    { id:"fy",   ico:"🏁", name:"FY",   full:"Final Yield",      val:`${snap.fy}%`,   kc:"var(--acc)",  series:shiftedSeries(S.fy, (snap.fy-98.2)*0.8),  target:98.5, note:"incl. rework recovery" },
    { id:"uph",  ico:"⚡", name:"UPH",  full:"Units Per Hour",   val:snap.uph,        kc:"var(--pur)",  series:shiftedSeries(S.uph,(snap.uph-148)*2),    target:160,  note:"line-rated" },
    { id:"oee",  ico:"🏭", name:"OEE",  full:"Overall Equipment Effectiveness", val:`${snap.oee}%`, kc:"var(--warn)", series:shiftedSeries(S.oee,(snap.oee-78.5)*1.2), target:82, note:"A × P × Q" },
    { id:"ship", ico:"📦", name:"SHIP", full:"Shipment Achievement", val:`${snap.ship}%`, kc:"var(--acc)", series:shiftedSeries(S.ship,(snap.ship-97.5)*0.9), target:100, note:"commit vs actual" },
    { id:"claim",ico:"⚑",  name:"CLAIM",full:"Customer Claims",  val:snap.claim,      kc:"var(--bad)",  series:S.claim.slice(-14).map(v=>v + (snap.claim - S.claim.at(-1))), target:0, note:"open, quarter" },
    { id:"faca", ico:"✎",  name:"FACA", full:"FACA Actions",     val:snap.faca,       kc:"var(--bad)",  series:S.faca.slice(-14).map(v=>v + (snap.faca - S.faca.at(-1))),   target:0, note:"open actions" },
  ];
  mount.innerHTML = defs.map(d => `
    <div class="card kpi" data-kpi="${d.id}" title="${esc(d.full)}">
      <div class="kpi-top">
        <span class="kpi-ico" style="--kc:${d.kc}">${d.ico}</span>
        <span class="pill ${d.id==="claim"||d.id==="faca" ? (d.val>0?"warn":"good") : "acc"}">${d.id==="claim"||d.id==="faca" ? (d.val>0?"open":"clear") : "vs " + d.target + (d.id==="uph"?"":"%")}</span>
      </div>
      <div class="kpi-name">${d.name}</div>
      <div class="kpi-val">${d.val}${typeof d.val==="number" ? "" : ""}</div>
      <div class="kpi-foot">
        ${trendHtml(delta(d.series))}
        <div class="kpi-spark" data-spark="${d.id}"></div>
      </div>
      <div class="kpi-note">${d.note}</div>
    </div>`).join("");

  mount.querySelectorAll("[data-spark]").forEach(el => {
    const id = el.dataset.spark;
    const def = defs.find(x=>x.id===id);
    const goodUp = !(id==="claim" || id==="faca");
    const last = def.series.at(-1), prev = def.series.at(-5) ?? last;
    const up = last >= prev;
    const color = (goodUp ? (up ? "var(--good)" : "var(--bad)") : (up ? "var(--bad)" : "var(--good)"));
    CHARTS.spark(el, def.series, color);
  });

  mount.querySelectorAll(".kpi").forEach(card => {
    card.onclick = () => { STATE.view = "kpi"; STATE.kpiFocus = card.dataset.kpi; setView("kpi"); };
  });
}

/* ---------- OVERVIEW ---------- */
function viewOverview(){
  const snap = kpiSnapshot();
  const S = DB.KPI_SERIES;
  const n = { "7D":7, "30D":14, "QTD":28, "YTD":42 }[STATE.range] ?? 14;

  return `
  <div class="grid g-kpi" id="kpiCards">${""}</div>

  <div class="grid g-32" style="margin-top:14px">
    <div class="card">
      <div class="card-head">
        <h3 id="mainChartTitle">FPY trend — blended</h3>
        <span class="sub"><span class="pill acc" id="mainChartVal">—</span></span>
      </div>
      <div id="mainChart"></div>
    </div>
    <div class="card">
      <div class="card-head"><h3>NPI stage pipeline</h3><span class="sub"><span class="pill">units & FPY</span></span></div>
      <div class="pipe" id="pipeWrap"></div>
      <div class="card-head" style="margin-top:14px"><h3>Side split — RHS vs LHS</h3></div>
      <div id="sideSplit" style="display:flex;flex-direction:column;gap:10px"></div>
      <div class="card-head" style="margin-top:14px"><h3>Line health — L1–L4</h3></div>
      <div id="lineSplit" style="display:flex;flex-direction:column;gap:9px"></div>
      <div class="card-head" style="margin-top:14px"><h3>Active lots in current scope</h3></div>
      <div id="lotStrip" style="display:flex;flex-wrap:wrap;gap:6px"></div>
    </div>
  </div>

  <div class="grid g-23" style="margin-top:14px">
    <div class="card">
      <div class="card-head">
        <h3>Process health</h3>
        <span class="sub"><span class="pill pur">4 processes</span></span>
      </div>
      <div class="flow" id="flowWrap"></div>
    </div>
    <div class="card">
      <div class="card-head">
        <h3>Live feed & alerts</h3>
        <span class="sub"><span class="pill good">live</span></span>
      </div>
      <div class="list" id="alertList"></div>
    </div>
  </div>

  <div class="sec-head"><h2>Products at a glance</h2><div class="rule"></div><span class="pill">${snap.nProducts} of ${DB.PRODUCTS.length} shown</span></div>
  <div class="card" style="padding:6px 10px">
    <div class="table-wrap" style="border:none">
      ${productTableHTML()}
    </div>
  </div>`;
}

function mountOverview(){
  const snap = kpiSnapshot();
  renderKpiCards($q("#kpiCards"), snap);

  // main chart
  const S = DB.KPI_SERIES;
  const n = { "7D":7, "30D":14, "QTD":28, "YTD":42 }[STATE.range] ?? 14;
  const series = shiftedSeries(S.fpy, (snap.fpy-96.2)*0.8, n);
  const labels = labelsFor(S.fpy, n);
  const draw = () => {
    CHARTS.lineChart($q("#mainChart"), {
      data: series, labels, target: 96.5,
      onHover: i => $q("#mainChartVal").textContent = `D-${series.length-1-i} · ${series[i]}%`,
      onOut:   () => $q("#mainChartVal").textContent = `now ${series.at(-1)}%`,
    });
    $q("#mainChartVal").textContent = `now ${series.at(-1)}%`;
  };
  draw();

  // pipeline
  $q("#pipeWrap").innerHTML = DB.PIPELINE.map(p => `
    <div class="pipe-stage ${STATE.stage===p.stage?"on":""}" data-stage="${p.stage}">
      <div class="ps-name">${p.stage}</div>
      <div class="ps-val">${DB.fmtW(p.units)}</div>
      <div class="ps-sub">FPY ${p.fpy}%</div>
    </div>`).join("");
  $q$("#pipeWrap .pipe-stage").forEach(el => el.onclick = () => {
    STATE.stage = STATE.stage === el.dataset.stage ? "ALL" : el.dataset.stage;
    syncSegs(); setView(STATE.view); toast(`Stage filter → <b>${STATE.stage}</b>`);
  });

  // side split bars
  const r = DB.SIDE_KPI.RHS, l = DB.SIDE_KPI.LHS;
  $q("#sideSplit").innerHTML = `
    ${sideRow("RHS", r)}${sideRow("LHS", l)}`;

  // line health comparison
  $q("#lineSplit").innerHTML = DB.LINES.map(ln => {
    const k = DB.LINE_KPI[ln];
    const prods = DB.PRODUCTS.filter(p => p.line===ln).map(p=>p.id).join(", ") || "—";
    const pct = (k.fpy-90)/(100-90)*100;
    return `<div>
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">
        <b>${ln} <span style="color:var(--txt3);font-weight:500">· ${prods}</span></b>
        <span class="mono" style="color:var(--txt2)">FPY ${k.fpy}% · UPH ${k.uph} · OEE ${k.oee}%</span>
      </div>
      <div class="bar"><i class="${k.fpy>=96.5?"g":k.fpy>=95?"w":"b"}" style="width:${pct.toFixed(0)}%"></i></div>
    </div>`;
  }).join("");

  // active lots strip — clickable chips scoped to the current filters
  const scopedLots = [...new Set(filteredProducts().flatMap(p => DB.PRODUCT_LOTS[p.id] || []))]
    .map(id => DB.LOTS.find(l => l.id===id)).filter(Boolean);
  $q("#lotStrip").innerHTML = scopedLots.length ? scopedLots.map(l => {
    const k = DB.LOT_KPI[l.id];
    const on = STATE.lot === l.id;
    return `<button class="pill ${on?"acc":k.fpy>=96.5?"good":k.fpy>=94?"warn":"bad"}" data-lot="${l.id}"
      style="cursor:pointer;border:${on?"2px":"1px"} solid var(--line2)" title="FPY ${k.fpy}% · FY ${k.fy}% · UPH ${k.uph} · OEE ${k.oee}%">
      ${l.id} · ${l.stage} · FPY ${k.fpy}%
    </button>`;
  }).join("") : `<span class="empty">No lots in scope</span>`;
  $q$("#lotStrip [data-lot]").forEach(b => b.onclick = () => {
    STATE.lot = STATE.lot === b.dataset.lot ? "ALL" : b.dataset.lot;
    const l = DB.LOTS.find(x => x.id === STATE.lot);
    if (l && STATE.stage === "ALL") STATE.stage = l.stage;
    syncSegs(); setView(STATE.view);
    toast(`Lot → <b>${STATE.lot}</b>`);
  });

  // flow
  $q("#flowWrap").innerHTML = DB.PROCESSES.map((pr,i) => `
    ${i ? '<div class="flow-arrow"></div>' : ""}
    <div class="flow-node" data-proc="${pr.id}">
      <div class="fn-head">
        <div class="fn-ico">${pr.ico}</div>
        <div><div class="fn-name">${pr.name}</div><div class="fn-sub">target FPY ${pr.target.fpy}%</div></div>
      </div>
      <div class="fn-kpis">
        <div class="fn-kpi"><b>${DB.PROCESS_KPI[pr.id][STATE.stage==="ALL"?"DVT":STATE.stage].fpy.toFixed(1)}%</b><span>FPY</span></div>
        <div class="fn-kpi"><b>${DB.PROCESS_KPI[pr.id][STATE.stage==="ALL"?"DVT":STATE.stage].uph}</b><span>UPH</span></div>
        <div class="fn-kpi"><b>${DB.PROCESS_KPI[pr.id][STATE.stage==="ALL"?"DVT":STATE.stage].oee.toFixed(0)}%</b><span>OEE</span></div>
      </div>
    </div>`).join("");
  $q$("#flowWrap .flow-node").forEach(el => el.onclick = () => { STATE.proc = el.dataset.proc; setView("processes"); });

  // alerts — derived live from claims/FACA/projects + system alerts
  const alerts = DB.allAlerts();
  $q("#alertList").innerHTML = alerts.map(a => `
    <div class="item">
      <div class="item-ico" style="background:var(--${a.sev}-soft);color:var(--${a.sev})">${a.sev==="bad"?"⚑":a.sev==="warn"?"⚠":"✓"}</div>
      <div class="item-body"><div class="item-title">${esc(a.txt)}</div><div class="item-sub">just now · auto-detected</div></div>
    </div>`).join("");
}

function sideRow(name, k){
  const pct = (k.fpy-90)/(100-90)*100;
  return `<div>
    <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">
      <b>${name}</b><span class="mono" style="color:var(--txt2)">FPY ${k.fpy}% · UPH ${k.uph} · OEE ${k.oee}%</span>
    </div>
    <div class="bar"><i class="${k.fpy>=96.5?"g":k.fpy>=95?"w":"b"}" style="width:${pct.toFixed(0)}%"></i></div>
  </div>`;
}

/* ---------- PRODUCTS ---------- */
function productTableHTML(){
  const prods = sortedProducts();
  const arrow = key => STATE.sortKey===key ? `<span class="arr">${STATE.sortDir===1?"▲":"▼"}</span>` : "";
  const rows = prods.map(p => {
    const k = DB.PRODUCT_KPI[p.id];
    const volPct = Math.min(100, p.vol.ytd/p.vol.target*100);
    const fpyCls = k.fpy>=96.5?"good":k.fpy>=94?"warn":"bad";
    return `<tr data-prod="${p.id}">
      <td class="mono"><b>${p.id}</b></td>
      <td>${esc(p.name)}<div style="font-size:10px;color:var(--txt3)">${esc(p.customer)} · ${p.mule}</div></td>
      <td><span class="pill ${p.stage==="PVT"?"good":p.stage==="DVT"?"acc":p.stage==="EVT"?"pur":"warn"}">${p.stage}</span></td>
      <td>${(DB.PRODUCT_LOTS[p.id]||[]).join(" · ")}</td>
      <td>${p.side}</td>
      <td><span class="pill">${p.line}</span></td>
      <td class="num"><span class="pill ${fpyCls}">${k.fpy.toFixed(1)}%</span></td>
      <td class="num">${k.fy.toFixed(1)}%</td>
      <td class="num">${k.uph}</td>
      <td class="num">${k.oee.toFixed(0)}%</td>
      <td class="num">${k.ship.toFixed(0)}%</td>
      <td class="num">${k.claim}/${k.faca}</td>
      <td style="min-width:120px">
        <div style="display:flex;align-items:center;gap:8px">
          <div class="bar" style="flex:1"><i class="${volPct>=100?"g":volPct>=90?"w":"b"}" style="width:${volPct.toFixed(0)}%"></i></div>
          <span class="num" style="font-size:11px;color:var(--txt2)">${DB.fmtW(p.vol.ytd)}/${DB.fmtW(p.vol.target)}</span>
        </div>
      </td>
    </tr>`;
  }).join("");
  return `<table>
    <thead><tr>
      ${["id","name","stage","lot","side","line","fpy","fy","uph","oee","ship","claim","vol"]
        .map(key => {
          const label = { id:"Product", name:"Model", stage:"Stage", lot:"Lots", side:"Side", line:"Line", fpy:"FPY", fy:"FY", uph:"UPH", oee:"OEE", ship:"Ship %", claim:"Claims/FACA", vol:"YTD Volume" }[key];
          return `<th data-sort="${key}">${label} ${arrow(key)}</th>`;
        }).join("")}
    </tr></thead>
    <tbody>${rows || `<tr><td colspan="13" class="empty">No products match filters</td></tr>`}</tbody>
  </table>`;
}

function bindSort(){
  $q$("#viewArea th[data-sort]").forEach(th => th.onclick = () => {
    const key = th.dataset.sort;
    if (STATE.sortKey === key) STATE.sortDir *= -1;
    else { STATE.sortKey = key; STATE.sortDir = 1; }
    if (STATE.view === "products"){ $q("#viewArea .table-wrap").innerHTML = productTableHTML(); bindSort(); }
  });
}

function viewProducts(){
  return `
  <div class="grid g-kpi" id="kpiCards"></div>
  <div class="card" style="margin-top:14px;padding:6px 10px">
    <div class="card-head" style="padding:10px 6px 4px">
      <h3>Product portfolio</h3>
      <span class="sub">
        <span class="pill acc">${filteredProducts().length} products</span>
        <button class="mini-btn" id="exportProducts">⬇ CSV</button>
      </span>
    </div>
    <div class="table-wrap" style="border:none">${productTableHTML()}</div>
  </div>
  <div class="grid g-2" style="margin-top:14px">
    <div class="card">
      <div class="card-head"><h3>FPY by product</h3><span class="sub"><span class="pill acc">current</span></span></div>
      <div id="prodFpyBars" style="display:flex;flex-direction:column;gap:10px"></div>
    </div>
    <div class="card">
      <div class="card-head"><h3>FPY trend by product</h3><span class="sub"><span class="pill">28d</span></span></div>
      <div id="prodFpyChart"></div>
    </div>
  </div>`;
}

function mountProducts(){
  renderKpiCards($q("#kpiCards"), kpiSnapshot());
  bindSort();
  const eb = $q("#exportProducts"); if (eb) eb.onclick = exportProducts;
  $q("#prodFpyBars").innerHTML = sortedProducts().map(p => {
    const k = DB.PRODUCT_KPI[p.id];
    const w = (k.fpy-84)/(100-84)*100;
    return `<div>
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">
        <b>${p.id} <span style="color:var(--txt3);font-weight:500">· ${esc(p.name)}</span></b>
        <span class="mono">${k.fpy.toFixed(1)}% <span style="color:var(--txt3)">/ 96.5 target</span></span>
      </div>
      <div class="bar"><i class="${k.fpy>=96.5?"g":k.fpy>=94?"w":"b"}" style="width:${Math.max(3,w).toFixed(0)}%"></i></div>
    </div>`;
  }).join("") || `<div class="empty">No products match filters</div>`;

  // composite chart: average of filtered products' fpys
  const prods = filteredProducts();
  const len = 28;
  const avg = Array.from({length:len}, (_,i) => {
    if (!prods.length) return 95;
    const vals = prods.map(p => DB.PRODUCT_KPI[p.id].fpys[i]);
    return +(vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(2);
  });
  CHARTS.lineChart($q("#prodFpyChart"), {
    data: avg, labels: labelsFor(avg, len), target: 96.5,
    fmt: v => v.toFixed(1),
  });
}

/* ---------- PROCESSES ---------- */
function viewProcesses(){
  const stage = STATE.stage === "ALL" ? "DVT" : STATE.stage;
  return `
  <div class="grid g-32" style="margin-top:2px">
    <div class="card">
      <div class="card-head">
        <h3>Process flow — click a node</h3>
        <span class="sub"><span class="pill pur">stage: ${stage}</span></span>
      </div>
      <div class="flow" id="flowWrap"></div>
    </div>
    <div class="card">
      <div class="card-head"><h3>Yield funnel (FPY)</h3></div>
      <div id="funnel" style="display:flex;flex-direction:column;gap:10px"></div>
    </div>
  </div>
  <div class="grid g-2" style="margin-top:14px">
    <div class="card">
      <div class="card-head"><h3 id="procDetailTitle">Select a process</h3></div>
      <div id="procDetail" class="empty">Click a process node to see its stage matrix, FPY trend and open issues.</div>
    </div>
    <div class="card">
      <div class="card-head"><h3>Stage × process FPY matrix</h3><span class="sub"><span class="pill">heat view</span></span></div>
      <div class="table-wrap" id="procMatrix"></div>
    </div>
  </div>`;
}

function mountProcesses(){
  const stage = STATE.stage === "ALL" ? "DVT" : STATE.stage;
  $q("#flowWrap").innerHTML = DB.PROCESSES.map((pr,i) => `
    ${i ? '<div class="flow-arrow"></div>' : ""}
    <div class="flow-node ${STATE.proc===pr.id?"on":""}" data-proc="${pr.id}">
      <div class="fn-head">
        <div class="fn-ico">${pr.ico}</div>
        <div><div class="fn-name">${pr.name}</div><div class="fn-sub">target FPY ${pr.target.fpy}%</div></div>
      </div>
      <div class="fn-kpis">
        <div class="fn-kpi"><b>${DB.PROCESS_KPI[pr.id][stage].fpy.toFixed(1)}%</b><span>FPY</span></div>
        <div class="fn-kpi"><b>${DB.PROCESS_KPI[pr.id][stage].uph}</b><span>UPH</span></div>
        <div class="fn-kpi"><b>${DB.PROCESS_KPI[pr.id][stage].oee.toFixed(0)}%</b><span>OEE</span></div>
      </div>
    </div>`).join("");
  $q$("#flowWrap .flow-node").forEach(el => el.onclick = () => { STATE.proc = el.dataset.proc; mountProcesses(); renderProcDetail(); });

  // funnel
  let cum = 100;
  $q("#funnel").innerHTML = DB.PROCESSES.map(pr => {
    const fpy = DB.PROCESS_KPI[pr.id][stage].fpy;
    cum = cum * (fpy/100);
    return `<div>
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">
        <b>${pr.ico} ${pr.name}</b>
        <span class="mono">FPY ${fpy.toFixed(1)}% → roll-up ${cum.toFixed(1)}%</span>
      </div>
      <div class="bar"><i class="${fpy>=pr.target.fpy?"g":"w"}" style="width:${((fpy-80)/20*100).toFixed(0)}%"></i></div>
    </div>`;
  }).join("");

  // matrix
  const cell = v => {
    const cls = v>=96.5?"good":v>=94?"warn":"bad";
    return `<td><span class="pill ${cls}">${v.toFixed(1)}</span></td>`;
  };
  $q("#procMatrix").innerHTML = `<table>
    <thead><tr><th>Process</th>${DB.STAGES.map(s=>`<th>${s}</th>`).join("")}</tr></thead>
    <tbody>
      ${DB.PROCESSES.map(pr => `<tr data-proc="${pr.id}">
        <td><b>${pr.ico} ${pr.name}</b></td>
        ${DB.STAGES.map(st => cell(DB.PROCESS_KPI[pr.id][st].fpy)).join("")}
      </tr>`).join("")}
    </tbody>
  </table>`;

  renderProcDetail();
}

function renderProcDetail(){
  if (!STATE.proc) return;
  const pr = DB.PROCESSES.find(x=>x.id===STATE.proc);
  const stage = STATE.stage === "ALL" ? "DVT" : STATE.stage;
  const k = DB.PROCESS_KPI[pr.id][stage];
  $q("#procDetailTitle").innerHTML = `${pr.ico} ${pr.name} — <span class="pill acc">${stage}</span>`;
  $q("#procDetail").className = "";
  $q("#procDetail").innerHTML = `
    <div class="modal-grid">
      <div class="stat-box"><span>FPY</span><b>${k.fpy.toFixed(1)}%</b></div>
      <div class="stat-box"><span>UPH</span><b>${k.uph}</b></div>
      <div class="stat-box"><span>OEE</span><b>${k.oee.toFixed(1)}%</b></div>
      <div class="stat-box"><span>Target FPY</span><b>${pr.target.fpy}%</b></div>
    </div>
    <div class="bar" style="margin-bottom:14px"><i class="${k.fpy>=pr.target.fpy?"g":"w"}" style="width:${((k.fpy-80)/20*100).toFixed(0)}%"></i></div>
    <div id="procTrend"></div>
    <div class="sec-head"><h2>Linked FACA actions</h2><div class="rule"></div></div>
    ${(DB.FACA.filter(f=>f.process===pr.id).map(f=>`
      <div class="item"><div class="item-ico" style="background:var(--pur-soft);color:var(--pur)">${f.ico}</div>
      <div class="item-body"><div class="item-title">${f.id} · ${esc(f.title)}</div>
      <div class="item-sub">${f.product} · ${f.owner} · due ${f.due}</div></div>
      <div class="item-meta"><span class="pill ${f.status==="Overdue"?"bad":f.status==="In Review"?"acc":"warn"}">${f.status}</span></div></div>`).join(""))
      || `<div class="empty">No open FACA for this process</div>`}`;

  const seedOff = pr.id.length;
  const base = DB.KPI_SERIES.fpy.slice(-(14));
  const series = base.map((v,i)=>+(v - 1.2 + ((i*seedOff)%5)*0.18).toFixed(2));
  CHARTS.lineChart($q("#procTrend"), { data: series, labels: labelsFor(series, series.length), fmt: v=>v.toFixed(1)+"%", target: pr.target.fpy });
}

/* ---------- KPI DEEP DIVE ---------- */
function viewKpi(){
  const focus = STATE.kpiFocus || "fpy";
  const kdef = DB.KPIS.find(k=>k.id===focus) || DB.KPIS[0];
  return `
  <div class="seg" id="kpiTabs" style="margin:2px 0 14px;display:inline-flex">
    ${DB.KPIS.map(k=>`<button data-kpi="${k.id}" class="${k.id===focus?"on":""}">${k.name}</button>`).join("")}
  </div>
  <div id="kpiBody"></div>`;
}

function mountKpi(){
  const focus = STATE.kpiFocus || "fpy";
  const kdef = DB.KPIS.find(k=>k.id===focus) || DB.KPIS[0];
  $q$("#kpiTabs button").forEach(b => {
    b.onclick = () => { STATE.kpiFocus = b.dataset.kpi; mountKpi(); retab(); };
  });
  function retab(){
    $q$("#kpiTabs button").forEach(b => b.classList.toggle("on", b.dataset.kpi===STATE.kpiFocus));
  }

  const snap = kpiSnapshot();
  const S = DB.KPI_SERIES;
  const n = { "7D":7, "30D":14, "QTD":28, "YTD":42 }[STATE.range] ?? 14;
  const map = { fpy:"fpy", fy:"fy", uph:"uph", oee:"oee", ship:"ship", claim:"claim", faca:"faca" };
  const key = map[focus];
  const valMap = { fpy:snap.fpy, fy:snap.fy, uph:snap.uph, oee:snap.oee, ship:snap.ship, claim:snap.claim, faca:snap.faca };
  const baseSeries = S[key];
  const series = shiftedSeries(baseSeries, key==="uph" ? (valMap[key]-148)*2 : (valMap[key]-(baseSeries.at(-1)))*1.0, n);
  const labels = labelsFor(baseSeries, n);
  const goodDown = focus==="claim" || focus==="faca";

  const vsTarget = goodDown ? (valMap[key] <= (kdef.target||0) ? "good" : "bad")
                            : (valMap[key] >= kdef.target ? "good" : "bad");

  $q("#kpiBody").innerHTML = `
    <div class="grid g-32">
      <div class="card">
        <div class="card-head">
          <h3>${kdef.name} — ${esc(kdef.full)}</h3>
          <span class="sub"><span class="pill ${vsTarget}">target ${kdef.target}${kdef.unit==="%"?"%":""} · now ${valMap[key]}${kdef.unit==="%"?"%":""}</span></span>
        </div>
        <div id="kpiChart"></div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Breakdown</h3></div>
        <div class="modal-grid">
          <div class="stat-box"><span>Current</span><b>${valMap[key]}${kdef.unit==="%"?"%":""}</b></div>
          <div class="stat-box"><span>Target</span><b>${kdef.target}${kdef.unit==="%"?"%":""}</b></div>
          <div class="stat-box"><span>Best (range)</span><b>${goodDown ? Math.min(...series) : Math.max(...series)}${kdef.unit==="%"?"%":""}</b></div>
          <div class="stat-box"><span>Worst (range)</span><b>${goodDown ? Math.max(...series) : Math.min(...series)}${kdef.unit==="%"?"%":""}</b></div>
        </div>
        <div id="kpiByStage" style="display:flex;flex-direction:column;gap:9px"></div>
      </div>
    </div>
    ${focus==="fpy" ? `
    <div class="sec-head"><h2>FPY stage contribution</h2><div class="rule"></div></div>
    <div class="grid g-2">
      <div class="card"><div class="card-head"><h3>Roll-up waterfall</h3></div><div id="fpyWaterfall" style="display:flex;flex-direction:column;gap:9px"></div></div>
      <div class="card"><div class="card-head"><h3>Side comparison</h3></div><div id="fpySide"></div></div>
    </div>` : ""}
    ${(focus==="claim") ? `
    <div class="sec-head"><h2>Open claims feeding this KPI</h2><div class="rule"></div></div>
    <div class="card" style="padding:6px 10px">${claimsTableHTML(STATE.product==="ALL"?null:STATE.product)}</div>` : ""}
    ${(focus==="faca") ? `
    <div class="sec-head"><h2>Open FACA actions feeding this KPI</h2><div class="rule"></div></div>
    <div class="card" style="padding:6px 10px">${facaListHTML()}</div>` : ""}
  `;

  CHARTS.lineChart($q("#kpiChart"), {
    data: series, labels, target: kdef.target != null ? kdef.target : undefined,
    fmt: key==="uph" ? v=>Math.round(v) : (v=>v.toFixed(1)),
    onHover: i => {},
  });

  $q("#kpiByStage").innerHTML = DB.STAGES.map(st => {
    const p = DB.PIPELINE.find(x=>x.stage===st);
    const v = p.fpy;
    return `<div>
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">
        <b>${st}</b><span class="mono">${v}% FPY · ${DB.fmtW(p.units)} units</span>
      </div>
      <div class="bar"><i class="${v>=96.5?"g":v>=94.5?"w":"b"}" style="width:${((v-90)/10*100).toFixed(0)}%"></i></div>
    </div>`;
  }).join("");

  if (focus==="fpy"){
    let cum = 100;
    $q("#fpyWaterfall").innerHTML = DB.PROCESSES.map(pr => {
      const fpy = DB.PROCESS_KPI[pr.id][STATE.stage==="ALL"?"DVT":STATE.stage].fpy;
      cum *= fpy/100;
      return `<div>
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">
          <b>${pr.ico} ${pr.name}</b><span class="mono">${fpy.toFixed(1)}% → roll ${cum.toFixed(1)}%</span>
        </div>
        <div class="bar"><i class="${fpy>=pr.target.fpy?"g":"w"}" style="width:${((fpy-80)/20*100).toFixed(0)}%"></i></div>
      </div>`;
    }).join("");
    $q("#fpySide").innerHTML = `
      ${sideRow("RHS", DB.SIDE_KPI.RHS)}
      ${sideRow("LHS", DB.SIDE_KPI.LHS)}
      <div class="empty" style="padding-top:8px">Side filter applies globally from the top bar.</div>`;
  }
}

/* ---------- QUALITY · SPC & PARETO ---------- */
function viewQuality(){
  return `
  <div class="grid g-kpi" id="qStats"></div>
  <div class="grid g-2" style="margin-top:14px">
    <div class="card">
      <div class="card-head">
        <h3>FPY control chart (X-chart, ±3σ)</h3>
        <span class="sub"><span class="pill acc" id="spcVal">—</span> <button class="mini-btn" id="spcCsv" title="Export SPC series as CSV">⬇</button></span>
      </div>
      <div style="display:flex;gap:10px;align-items:center;margin:2px 0 8px;flex-wrap:wrap">
        <select id="spcLot" class="topbar-select" style="min-width:168px" aria-label="SPC scope — production lot"></select>
        <span class="item-sub" id="spcScopeNote">Baseline view — blended FPY across lots in filter scope.</span>
      </div>
      <div id="spcChart"></div>
    </div>
    <div class="card">
      <div class="card-head"><h3>Special-cause violations</h3><span class="sub"><span class="pill bad" id="oocCount">—</span></span></div>
      <div class="list" id="oocList"></div>
      <div class="item-sub" style="margin-top:10px">Rule: any point beyond ±3σ from the center line triggers investigation (Wheeler single-point rule). Hover the chart to scan.</div>
    </div>
  </div>
  <div class="grid g-32" style="margin-top:14px">
    <div class="card">
      <div class="card-head"><h3>Defect Pareto — top contributors</h3><span class="sub"><span class="pill pur">counts, 30d</span></span></div>
      <div id="pareto"></div>
    </div>
    <div class="card">
      <div class="card-head"><h3>Defects by process</h3></div>
      <div class="donut-wrap">
        <div class="donut" id="defDonut"></div>
        <div class="donut-leg" id="defLeg"></div>
      </div>
    </div>
  </div>`;
}

const WE_NAMES = { R1:"Beyond 3σ", R2:"2 of 3 beyond 2σ", R3:"4 of 5 beyond 1σ", R4:"8 consecutive one side" };

function mountQuality(){
  /* ---- SPC scope: blended baseline or a single production lot ---- */
  const sel = $q("#spcLot");
  sel.innerHTML = `<option value="ALL">Product baseline — blended</option>` +
    DB.LOTS.map(l => `<option value="${l.id}">${l.id} · ${l.stage} lot</option>`).join("");
  sel.value = STATE.spcLot && DB.LOTS.some(l => l.id === STATE.spcLot) ? STATE.spcLot : "ALL";
  sel.onchange = () => { STATE.spcLot = sel.value; mountQuality(); };
  const lotId = sel.value === "ALL" ? null : sel.value;
  const base = DB.spcSamples();                        // blended baseline for scope
  const cur  = lotId ? DB.spcSamples(lotId) : base;    // selected series
  const { labels, data } = cur;
  const LSL = 93.0;                        // FPY spec floor
  const st = DB.spcStats(data);
  const cpk = (st.cl - LSL) / (3 * st.sd);
  const we = DB.westernElectric(data, st);
  const weCount = Object.keys(we).length;
  const scope = lotId ? `${lotId} lot` : "Baseline";
  const res = CHARTS.controlChart($q("#spcChart"), {
    data, labels, cl: st.cl, ucl: st.ucl, lcl: st.lcl, we,
    baseline: lotId ? base.data : null,
    onHover: (i, ooc, rules) => $q("#spcVal").textContent = `${labels[i]} · ${data[i]}%${ooc ? " · ⚠ OUT OF CONTROL" : rules ? " · " + rules.map(r=>WE_NAMES[r]).join(" + ") : ""}`,
    onOut: () => $q("#spcVal").textContent = `${scope} · CL ${st.cl.toFixed(2)}% · σ ${st.sd.toFixed(2)} · ${weCount} WE signal${weCount===1?"":"s"}`,
  });
  $q("#spcVal").textContent = `${scope} · CL ${st.cl.toFixed(2)}% · σ ${st.sd.toFixed(2)} · ${weCount} WE signal${weCount===1?"":"s"}`;
  $q("#oocCount").textContent = `${res.outOfControl} beyond limits · ${weCount} WE signals`;
  $q("#spcScopeNote").textContent = lotId
    ? `Lot ${lotId} overlay — dashed gray line is the blended product baseline (CL ${DB.spcStats(base.data).cl.toFixed(2)}%).`
    : "Baseline view — blended FPY across lots in filter scope. Pick a lot to overlay it.";
  $q("#spcCsv").onclick = () => exportCSV(`fdb-spc-${(lotId || "baseline").toLowerCase()}.csv`, [
    ["Sample","Date","FPY%","CL","UCL","LCL","Signal"],
    ...cur.data.map((v,i) => [i+1, cur.labels[i], v, st.cl.toFixed(2), st.ucl.toFixed(2), st.lcl.toFixed(2),
      res.ooc.includes(i) ? "beyond-3sigma" : (we[i] ? we[i].join("+") : "")]),
  ]);

  // known special causes (sample-index keyed)
  const causes7 = {
    7:  { t:"D01 bearing-noise event", d:"X4152 RHS acoustic escape — containment started, see CL-2213" },
    16: { t:"D02 torque drift window", d:"DC bit wear beyond PM interval — FACA FA-097 corrective" },
    23: { t:"D04 press-fit OOS spike", d:"Pillow-stator force window widening — FACA FA-101" },
    28: { t:"Recovery after sort", d:"Containment effective — back within limits" },
  };

  // consolidated signal list: ±3σ violations first, then WE rules
  const signals = [];
  res.ooc.forEach(i => signals.push({ i, sev:"bad", label:"Beyond ±3σ", note: lotId ? "Lot-level breach — check this lot's phases in the Gantt" : (causes7[i]||{}).t || "Investigate immediately" }));
  Object.keys(we).map(Number).sort((a,b)=>a-b).forEach(i => {
    if (res.ooc.includes(i)) return;
    signals.push({ i, sev:"warn", label:we[i].map(r=>WE_NAMES[r]).join(" + "), note:"Early-warning pattern — review before it becomes a breach" });
  });

  // stat cards
  const lotProdIds = lotId ? DB.PRODUCTS.filter(p => (DB.PRODUCT_LOTS[p.id]||[]).includes(lotId)).map(p => p.id) : null;
  const defects = DB.DEFECTS.filter(d => (STATE.product==="ALL" || d.product===STATE.product) && (!lotProdIds || lotProdIds.includes(d.product)));
  const totalDef = defects.reduce((s,d)=>s+d.qty,0);
  const vol = filteredProducts().reduce((s,p)=>s+p.vol.ytd,0) || 1;
  const ppm = Math.round(totalDef / vol * 1e6);
  const top = [...defects].sort((a,b)=>b.qty-a.qty)[0];
  $q("#qStats").innerHTML = [
    { name:"Cpk (lower spec)", val:cpk.toFixed(2), ico:"📏", kc:"var(--acc)", note:cpk>=1.33?"capable (≥1.33)":cpk>=1?"marginal":"not capable", cls:cpk>=1.33?"good":cpk>=1?"warn":"bad" },
    { name:"Out-of-control pts", val:res.outOfControl, ico:"⚠", kc:"var(--bad)", note:"last 30 samples", cls:res.outOfControl?"bad":"good" },
    { name:"Defect PPM", val:ppm.toLocaleString(), ico:"🔎", kc:"var(--pur)", note:"defects vs YTD volume", cls:"acc" },
    { name:"Top defect", val:top ? top.qty : 0, ico:"🥇", kc:"var(--warn)", note:top ? `${top.code} ${top.name}` : "—", cls:top&&top.sev==="Critical"?"bad":"warn" },
  ].map(d => `
    <div class="card kpi">
      <div class="kpi-top"><span class="kpi-ico" style="--kc:${d.kc}">${d.ico}</span><span class="pill ${d.cls}">${d.name.split(" ")[0]==="Cpk"?"SPC":"30d"}</span></div>
      <div class="kpi-name">${d.name}</div>
      <div class="kpi-val" style="font-size:22px">${d.val}</div>
      <div class="kpi-note">${esc(d.note)}</div>
    </div>`).join("");

  $q("#oocList").innerHTML = signals.length ? signals.map(s => {
    const c = lotId ? null : causes7[s.i];
    return `<div class="item" style="cursor:default">
      <div class="item-ico" style="background:var(--${s.sev}-soft);color:var(--${s.sev})">${s.sev==="bad"?"⚠":"∿"}</div>
      <div class="item-body"><div class="item-title">${labels[s.i]} · ${data[s.i]}% — ${esc(s.label)}</div><div class="item-sub">${c ? esc(c.t) + " — " + esc(c.d) : esc(s.note)}</div></div>
    </div>`;
  }).join("") : `<div class="empty">Process in control — no signals</div>`;

  // pareto + donut
  CHARTS.pareto($q("#pareto"), [...defects].sort((a,b)=>b.qty-a.qty).slice(0,8).map(d => ({ label:`${d.code} ${d.name}`, v:d.qty })));
  const byProc = {};
  defects.forEach(d => byProc[d.process] = (byProc[d.process]||0) + d.qty);
  const segs = DB.PROCESSES.filter(p=>byProc[p.id]).map((p,i) => ({ label:p.name, v:byProc[p.id], color:["var(--bad)","var(--warn)","var(--acc)","var(--pur)"][i%4] }));
  CHARTS.donut($q("#defDonut"), segs, totalDef, "defects");
  $q("#defLeg").innerHTML = segs.map(s=>`<div class="dl"><i style="width:9px;height:9px;border-radius:3px;display:inline-block;background:${s.color}"></i>${esc(s.label)}<b>${s.v}</b></div>`).join("");
}

/* ---------- GANTT ---------- */
function viewGantt(){
  return `
  <div class="card">
    <div class="card-head">
      <h3>NPI project timeline</h3>
      <span class="sub">
        <span class="seg" id="ganttMode">
          <button data-mode="lots" class="${STATE.ganttMode!=="product"?"on":""}">By lot</button>
          <button data-mode="product" class="${STATE.ganttMode==="product"?"on":""}">By product</button>
        </span>
        <span class="seg" id="ganttZoom">
          <button data-zoom="day" class="${STATE.ganttZoom==="day"?"on":""}">Day</button>
          <button data-zoom="week" class="${STATE.ganttZoom==="week"?"on":""}">Week</button>
          <button data-zoom="month" class="${STATE.ganttZoom==="month"?"on":""}">Month</button>
        </span>
        <button class="mini-btn" id="todayBtn" title="Center on today">◉ Today</button>
      </span>
    </div>
    <div class="card-head" style="margin-bottom:8px">
      <span class="legend" id="ganttLegend"></span>
      <span class="sub"><button class="mini-btn" id="addTask">＋ Add task</button></span>
    </div>
    <div class="gantt" id="ganttWrap"></div>
  </div>
  <div class="grid g-3" style="margin-top:14px" id="ganttStats"></div>`;
}

function ganttRows(){
  /* scoped by product/stage/lot filters, returns [{key,label,sub,tasks,lot}] */
  const rows = [];
  if (STATE.ganttMode === "product"){
    DB.PROJECTS
      .filter(p => STATE.product==="ALL" || p.product===STATE.product)
      .forEach(p => rows.push({ key:p.id, label:p.name, sub:p.owner, health:p.health, tasks:p.tasks, prj:p }));
  } else {
    const scopedLots = DB.LOTS.filter(l =>
      (STATE.lot==="ALL" || l.id===STATE.lot) &&
      (STATE.stage==="ALL" || l.stage===STATE.stage)
    );
    const activeLots = new Set(filteredProducts().flatMap(p => DB.PRODUCT_LOTS[p.id] || []));
    const lots = scopedLots.filter(l => activeLots.has(l.id));
    lots.forEach(l => {
      const prods = DB.PRODUCTS.filter(p => (DB.PRODUCT_LOTS[p.id]||[]).includes(l.id)).map(p => p.id);
      const tasks = DB.LOT_TASKS[l.id] || [];
      rows.push({
        key:l.id,
        label:`${prods.join("/") || "—"} · ${l.id}`,
        sub:`${l.stage} · ${DB.fmtW(l.units)} units`,
        tasks, lot:l,
      });
    });
  }
  return rows;
}

const PHASE_COLOR = {
  "Preparation":          "var(--warn)",
  "MBO and Main build":   "var(--acc)",
  "OQC":                  "var(--pur)",
  "OK2S":                 "var(--pur)",
  "Shipment":             "var(--good)",
};

function mountGantt(){
  const wrap = $q("#ganttWrap");
  const byLot = STATE.ganttMode !== "product";
  const mode = $q("#ganttMode");
  mode.querySelectorAll("button").forEach(b => b.onclick = () => {
    STATE.ganttMode = b.dataset.mode;
    setView("gantt");
  });

  const projects = DB.PROJECTS
    .filter(p => STATE.product==="ALL" || p.product===STATE.product)
    .filter(p => {
      if (STATE.ganttGroup==="all") return true;
      if (STATE.ganttGroup==="npi") return ["X4155","X4156","X4153"].includes(p.product);
      return !["X4155","X4156","X4153"].includes(p.product);
    });
  const rows = ganttRows();

  $q("#ganttLegend").innerHTML = byLot
    ? Object.entries(PHASE_COLOR).map(([n,c]) => `<span><i style="background:${c}"></i>${n}</span>`).join("")
    : `<span><i style="background:var(--acc)"></i>EVT</span><span><i style="background:var(--pur)"></i>DVT</span><span><i style="background:var(--good)"></i>PVT/MP</span><span><i style="background:var(--warn)"></i>At risk</span>`;

  const allDates = rows.flatMap(r => r.tasks.flatMap(t => [t.s, t.e])).filter(Boolean);
  if (!allDates.length){ wrap.innerHTML = `<div class="empty">No tasks in scope</div>`; $q("#ganttStats").innerHTML = ""; return; }
  const min = allDates.reduce((a,b)=>a<b?a:b);
  const max = allDates.reduce((a,b)=>a>b?a:b);

  /* zoom: px-per-day drives ticks, label density and scroll width */
  const PX_PER_DAY = { day: 34, week: 11, month: 4.2 }[STATE.ganttZoom] || 11;
  const DAY = 864e5;
  const d0 = new Date(min+"T00:00:00");
  const d1 = new Date(max+"T00:00:00");
  const totalDays = Math.max(1, Math.round((d1-d0)/DAY) + 1);
  const trackW = Math.max(760, Math.round(totalDays * PX_PER_DAY));
  const x = iso => ((new Date(iso+"T00:00:00").getTime() - d0.getTime()) / DAY) * (PX_PER_DAY);

  /* ticks per zoom level */
  let ticks = [];
  const DOW = ["S","M","T","W","T","F","S"];
  if (STATE.ganttZoom === "day"){
    for (let t = d0.getTime(); t <= d1.getTime(); t += DAY){
      const dt = new Date(t);
      ticks.push({ pct: (t - d0.getTime())/DAY * PX_PER_DAY,
        label: dt.getDate() === 1 || t === d0.getTime()
          ? dt.toLocaleString("en",{month:"short",day:"numeric"}) : String(dt.getDate()),
        sub: DOW[dt.getDay()],
        wknd: dt.getDay() === 0 || dt.getDay() === 6,
        major: dt.getDay() === 1 });
    }
  } else if (STATE.ganttZoom === "week"){
    const first = new Date(d0); first.setDate(first.getDate() - ((first.getDay()+6)%7)); // back to Monday
    for (let t = first.getTime(); t <= d1.getTime()+7*DAY; t += 7*DAY){
      const dt = new Date(t);
      if (t + 7*DAY < d0.getTime()) continue;
      const lbl = dt.getDate() <= 7 ? dt.toLocaleString("en",{month:"short"}) : String(dt.getDate());
      ticks.push({ pct: (t - d0.getTime())/DAY * PX_PER_DAY, label: lbl, major: dt.getDate() <= 7 });
    }
  } else {
    const m = new Date(d0); m.setDate(1);
    while (m.getTime() <= d1.getTime()+31*DAY){
      if (m.getTime() + 31*DAY >= d0.getTime()) ticks.push({ pct: (m.getTime()-d0.getTime())/DAY*PX_PER_DAY,
        label: m.toLocaleString("en",{month:"short"}), major: m.getMonth()%3===0 });
      m.setMonth(m.getMonth()+1);
    }
  }
  ticks = ticks.filter(t => t.pct >= -PX_PER_DAY*8 && t.pct <= trackW + PX_PER_DAY*8);

  const todayX = (new Date(isoOf(DB.TODAY)+"T00:00:00").getTime() - d0.getTime())/DAY * PX_PER_DAY;
  const stageColor = { P1:"var(--warn)", P2:"var(--warn)", EVT:"var(--acc)", DVT:"var(--pur)", PVT:"var(--good)" };

  const gridHtml = (withLabels) => ticks.map(t => {
    const wknd = t.wknd ? " tick-wknd" : "";
    return `<i class="${t.major?"tick-major":""}${t.wknd?" tick-wknd-line":""}" style="left:${t.pct.toFixed(1)}px"></i>` +
      (withLabels
        ? (t.sub
          ? `<span class="tick-date${t.major?" tick-major-lbl":""}${wknd}" style="left:${t.pct.toFixed(1)}px">${t.label}</span>` +
            `<span class="tick-dow${wknd}" style="left:${t.pct.toFixed(1)}px">${t.sub}</span>`
          : `<span class="${t.major?"tick-major-lbl":""}${wknd}" style="left:${t.pct.toFixed(1)}px">${t.label}</span>`)
        : "");
  }).join("");

  const dayZoom = STATE.ganttZoom === "day";
  wrap.innerHTML = `<div class="gantt-scroll" id="ganttScroll" style="padding-top:${dayZoom?34:16}px">
    <div class="gantt-inner" style="width:${trackW}px">
    <div class="gantt-row" style="border-bottom:2px solid var(--line2)">
      <div class="g-label"><b style="font-size:11px;color:var(--txt3)">${byLot?"LOT":"PROJECT"}</b></div>
      <div class="g-track" style="height:${dayZoom?42:26}px">
        <div class="g-grid">${gridHtml(true)}</div>
      </div>
    </div>
    ${rows.map(r => {
      const phasesDone = byLot ? Math.round(r.tasks.reduce((s,t)=>s+t.done,0)/Math.max(1,r.tasks.length)) : null;
      const barColor = t => byLot
        ? (t.done>=100 ? PHASE_COLOR[t.name] || "var(--good)" : PHASE_COLOR[t.name] || "var(--acc)")
        : (t.flag==="claim" ? "var(--bad)" : (r.health==="amber" && t.done>0 && t.done<100) ? "var(--warn)" : stageColor[t.stage] || "var(--acc)");
      return `
      <div class="gantt-row" style="padding:9px 0">
        <div class="g-label">
          <b>${esc(r.label)}</b>
          <span>${esc(r.sub)}${byLot && phasesDone!=null ? ` · <span class="pill ${phasesDone>=100?"good":phasesDone>0?"acc":"warn"}" style="font-size:9px;padding:1px 7px">${phasesDone}%</span>` : byLot ? "" : r.health ? ` · <span class="pill ${r.health==="green"?"good":r.health==="amber"?"warn":"bad"}" style="font-size:9px;padding:1px 7px">${r.health}</span>` : ""}</span>
        </div>
        <div class="g-track">
          <div class="g-grid">${gridHtml(false)}</div>
          <div class="g-today" style="left:${todayX.toFixed(1)}px"></div>
          ${r.tasks.map((t, ti) => {
            const l = x(t.s), rr = x(t.e);
            const w = Math.max(rr-l, PX_PER_DAY*0.9);
            const color = barColor(t);
            const showTxt = w > 30;
            const onFill = (w * t.done / 100) >= 24; /* label rides the solid fill? */
            const late = t.done < 100 && t.e && t.e < isoOf(DB.TODAY);
            const crit = byLot && ti > 0 && t.done < 100 && (r.tasks[ti-1].done >= 100);
            const cls = `g-bar ${byLot?"g-bar-lot":""}${t.done>=100?" g-done":""}${crit?" g-crit":""}${late?" g-risk":""}`;
            return `<div class="${cls}" data-row="${r.key}" data-phase-idx="${ti}" data-task="${esc(t.name)}"
              style="left:${l.toFixed(1)}px;width:${w.toFixed(1)}px;--pb:${color}"
              title="${esc(r.label)} · ${esc(t.name)} · ${t.s} → ${t.e} · ${t.done}% complete${late?" · ⚠ OVERDUE":""}${crit?" · next in critical chain":""}"><i class="g-fill" style="width:${t.done}%"></i>${showTxt && t.done>0 ? `<b class="g-txt${onFill?"":" g-txt-lo"}">${t.done}%</b>` : ""}<i class="g-grip" title="Drag to extend"></i></div>`;
          }).join("")}
          ${byLot ? ganttDepsSvg(r, x) : ""}
        </div>
      </div>`;
    }).join("")}
    </div>
  </div>`;

  /* scroll position: keep center date across zoom changes */
  const scroller = $q("#ganttScroll");
  const center = STATE.ganttCenter || isoOf(DB.TODAY);
  const centerPx = (new Date(center+"T00:00:00").getTime() - d0.getTime())/DAY * PX_PER_DAY;
  scroller.scrollLeft = Math.max(0, centerPx - scroller.clientWidth/2);
  scroller.addEventListener("scroll", () => {
    STATE.ganttCenter = isoOf(new Date(d0.getTime() + (scroller.scrollLeft + scroller.clientWidth/2)/PX_PER_DAY*DAY));
  }, { passive:true });
  scroller.addEventListener("wheel", e => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const order = ["month","week","day"];
    const idx = order.indexOf(STATE.ganttZoom);
    const next = e.deltaY < 0 ? Math.min(2, idx+1) : Math.max(0, idx-1);
    if (next !== idx){ STATE.ganttZoom = order[next]; setView("gantt"); }
  }, { passive:false });

  const zoomSeg = $q("#ganttZoom");
  zoomSeg.querySelectorAll("button").forEach(b => b.onclick = () => { STATE.ganttZoom = b.dataset.zoom; setView("gantt"); });
  $q("#todayBtn").onclick = () => { STATE.ganttCenter = isoOf(DB.TODAY); setView("gantt"); };

  const addBtn = $q("#addTask"); if (addBtn) addBtn.onclick = () => openTaskEditor(null);

  bindGanttDrag(byLot, PX_PER_DAY, d0, DAY);

  $q$("#ganttWrap .g-bar").forEach(bar => bar.onclick = () => {
    if (bar.__dragged){ bar.__dragged = false; return; }
    const rowKey = bar.dataset.row;
    const idx = +bar.dataset.phaseIdx;
    if (byLot){
      const lot = DB.LOTS.find(l=>l.id===rowKey);
      const phases = DB.LOT_TASKS[rowKey] || [];
      if (lot && phases[idx]) openLotPhaseEditor(lot, phases[idx]);
    } else {
      const prj = DB.PROJECTS.find(p=>p.id===rowKey);
      const task = prj && prj.tasks.find(t=>t.name===bar.dataset.task);
      if (prj && task) openTaskEditor(prj, task);
    }
  });

  const totalTasks = rows.flatMap(r=>r.tasks);
  const done = totalTasks.filter(t=>t.done===100).length;
  const active = totalTasks.filter(t=>t.done>0&&t.done<100).length;
  const upcoming = totalTasks.filter(t=>t.done===0).length;
  $q("#ganttStats").innerHTML = `
    <div class="card"><div class="card-head"><h3>${byLot?"Phases complete":"Tasks complete"}</h3></div><div class="kpi-val" style="--kc:var(--good)">${done}</div><div class="kpi-note">of ${totalTasks.length} planned</div></div>
    <div class="card"><div class="card-head"><h3>Active</h3></div><div class="kpi-val" style="--kc:var(--acc)">${active}</div><div class="kpi-note">in flight this window</div></div>
    <div class="card"><div class="card-head"><h3>Upcoming</h3></div><div class="kpi-val" style="--kc:var(--warn)">${upcoming}</div><div class="kpi-note">not started</div></div>`;
}

/* ---------- gantt: dependency arrows (lot mode: consecutive phases in the 5-step flow) ---------- */
function ganttDepsSvg(r, x){
  const segs = [];
  for (let i = 0; i < r.tasks.length - 1; i++){
    const a = r.tasks[i], b = r.tasks[i+1];
    const ax = x(a.e) + 2, bx = x(b.s) - 3;
    if (bx - ax < 5) continue;                       /* phases touch — no room for an arrow */
    const y1 = 15;
    segs.push(`<line x1="${ax.toFixed(1)}" y1="${y1}" x2="${(bx-6).toFixed(1)}" y2="${y1}"/>` +
      `<path d="M${bx.toFixed(1)},${y1} l-6,-3.5 v7 z"/>`);
  }
  return `<svg class="g-deps">${segs.join("")}</svg>`;
}

/* ---------- gantt: drag-to-move + edge-drag-to-extend (pointer events, persisted) ---------- */
function bindGanttDrag(byLot, pxd, d0, DAY){
  if (!byLot) return;   /* lot mode only — product tasks stay in the editor */
  $q$("#ganttWrap .g-bar").forEach(bar => {
    bar.addEventListener("pointerdown", e => {
      if (e.button !== 0) return;
      const kind = e.target.closest(".g-grip") ? "resize" : "move";
      const rowKey = bar.dataset.row, idx = +bar.dataset.phaseIdx;
      const orig = (DB.LOT_TASKS[rowKey] || [])[idx];
      if (!orig) return;
      const origS = orig.s, origE = orig.e;
      const spanDays = Math.max(1, Math.round((new Date(origE+"T00:00:00") - new Date(origS+"T00:00:00")) / DAY) + 1);
      const startX = e.clientX;
      let lastDelta = null;
      try { bar.setPointerCapture(e.pointerId); } catch(err){}

      bar.onpointermove = ev => {
        const d = Math.round((ev.clientX - startX) / pxd);
        if (d === lastDelta) return;
        lastDelta = d;
        let ns = origS, ne = origE;
        if (kind === "move"){
          ns = isoAddDays(origS, d); ne = isoAddDays(origE, d);
        } else {
          const end = isoAddDays(origS, spanDays - 1 + Math.max(-(spanDays-1), d));
          ne = end < origS ? origS : end;
        }
        bar.style.left = xOf(d0, pxd, ns).toFixed(1) + "px";
        bar.style.width = Math.max(pxd * 0.9, (xOf(d0, pxd, ne) - xOf(d0, pxd, ns))).toFixed(1) + "px";
        bar.title = `${bar.dataset.row} · ${orig.name} · ${ns} → ${ne} · ${orig.done}% complete — release to save`;
      };

      bar.onpointerup = bar.onpointercancel = ev => {
        bar.onpointermove = bar.onpointerup = bar.onpointercancel = null;
        try { bar.releasePointerCapture(e.pointerId); } catch(err){}
        const d = lastDelta == null ? 0 : lastDelta;
        if (d === 0) return;                          /* plain click → editor via onclick */
        bar.__dragged = true;                         /* suppress the click that follows a drag */
        const phases = (DB.LOT_TASKS[rowKey] || []).map(t => {
          if (t.name !== orig.name) return { ...t };
          if (kind === "move") return { ...t, s: isoAddDays(orig.s, d), e: isoAddDays(orig.e, d) };
          const minEnd = orig.s;
          const e2 = isoAddDays(orig.s, spanDays - 1 + Math.max(-(spanDays-1), d));
          return { ...t, e: e2 < minEnd ? minEnd : e2 };
        });
        const bad = phases.find(t => t.e < t.s);
        if (bad){ toast("End date must be on or after start date", "warn"); setView("gantt"); return; }
        DB.updateLotTasks(rowKey, phases);
        refreshBadges(); buildTicker();
        toast(`<b>${rowKey}</b> · ${esc(orig.name)} ${kind === "move" ? "moved" : "extended"} → ${phases[idx].s} → ${phases[idx].e}`, "good");
        setView("gantt");
      };
    });
  });
}
function xOf(d0, pxd, iso){ return (new Date(iso+"T00:00:00").getTime() - d0.getTime()) / 864e5 * pxd; }
function isoAddDays(iso, n){ const d = new Date(iso+"T00:00:00"); d.setDate(d.getDate()+n); return isoOf(d); }

function openLotPhaseEditor(lot, phase){
  openModal(`
    <h2>${lot.id} — ${esc(phase.name)}</h2>
    <div class="modal-grid" style="margin-top:12px">
      <div class="stat-box"><span>Stage</span><b>${lot.stage}</b></div>
      <div class="stat-box"><span>Lot units</span><b>${DB.fmtW(lot.units)}</b></div>
      <div class="stat-box"><span>Window</span><b style="font-size:13px">${phase.s} → ${phase.e}</b></div>
      <div class="stat-box"><span>Complete</span><b>${phase.done}%</b></div>
    </div>
    <div class="bar" style="margin:10px 0 14px"><i class="${phase.done>=100?"g":phase.done>0?"w":"b"}" style="width:${phase.done}%"></i></div>
    <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;margin-bottom:14px">
      <label class="fld"><span>Start</span><input id="lpStart" type="date" value="${phase.s}"/></label>
      <label class="fld"><span>End</span><input id="lpEnd" type="date" value="${phase.e}"/></label>
      <label class="fld"><span>Done %</span><input id="lpDone" type="number" min="0" max="100" value="${phase.done}"/></label>
      <button class="btn-primary" id="lpSave">Save</button>
    </div>
    <div class="item-sub">Flow: ${DB.LOT_PHASES.join(" → ")}. Phase completion feeds the lot's overall progress in the Gantt and shipment readiness.</div>
  `);
  $q("#lpSave").onclick = () => {
    const phases = (DB.LOT_TASKS[lot.id] || []).map(t =>
      t.name === phase.name ? {
        ...t,
        s: $q("#lpStart").value,
        e: $q("#lpEnd").value,
        done: Math.max(0, Math.min(100, +$q("#lpDone").value || 0)),
      } : t
    );
    if (phases.some(t => t.e < t.s)){ toast("End date must be on or after start date", "warn"); return; }
    DB.updateLotTasks(lot.id, phases);
    closeModal(); toast(`<b>${lot.id}</b> · ${esc(phase.name)} updated`, "good");
    setView("gantt");
  };
}

function updateTask(prjId, taskName, patch){
  const prj = DB.PROJECTS.find(p=>p.id===prjId);
  if (!prj) return false;
  const tasks = prj.tasks.map(t => t.name===taskName ? { ...t, ...patch } : t);
  return DB.updateProjectTasks(prjId, tasks);
}
function deleteTask(prjId, taskName){
  const prj = DB.PROJECTS.find(p=>p.id===prjId);
  if (!prj) return false;
  return DB.updateProjectTasks(prjId, prj.tasks.filter(t => t.name!==taskName));
}
function addTask(prjId, task){
  const prj = DB.PROJECTS.find(p=>p.id===prjId);
  if (!prj) return false;
  return DB.updateProjectTasks(prjId, [...prj.tasks, task]);
}
function openTaskEditor(prj, task){
  const isNew = !task;
  const projects = DB.PROJECTS;
  const t = task || { name:"", stage: STATE.stage!=="ALL" ? STATE.stage : "DVT",
    s: new Date().toISOString().slice(0,10),
    e: new Date(Date.now()+14*864e5).toISOString().slice(0,10), done:0, flag:"" };
  openModal(`
    <h2>${isNew ? "Add Gantt task" : "Edit task — " + esc(t.name)}</h2>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin:12px 0">
      ${isNew ? `<label class="fld"><span>Project</span>
        <select id="tePrj">${projects.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join("")}</select></label>` : ""}
      <label class="fld grow"><span>Task name</span><input id="teName" value="${esc(t.name)}" placeholder="e.g. DVT build 3"/></label>
      <label class="fld"><span>Stage</span>
        <select id="teStage">${DB.STAGES.map(s=>`<option ${t.stage===s?"selected":""}>${s}</option>`).join("")}</select></label>
      <label class="fld"><span>Start</span><input id="teStart" type="date" value="${t.s}"/></label>
      <label class="fld"><span>End</span><input id="teEnd" type="date" value="${t.e}"/></label>
      <label class="fld"><span>Done %</span><input id="teDone" type="number" min="0" max="100" value="${t.done}"/></label>
    </div>
    <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap">
      ${isNew ? "" : `<button class="mini-btn" id="teDelete">🗑 Delete task</button>`}
      <span style="flex:1"></span>
      <button class="btn-primary" id="teSave">${isNew ? "Add task" : "Save"}</button>
    </div>
  `);
  $q("#teSave").onclick = () => {
    const prjId = isNew ? $q("#tePrj").value : prj.id;
    const patch = {
      name: $q("#teName").value.trim(),
      stage: $q("#teStage").value,
      s: $q("#teStart").value,
      e: $q("#teEnd").value,
      done: Math.max(0, Math.min(100, +$q("#teDone").value || 0)),
    };
    if (!patch.name){ toast("Task name is required", "warn"); return; }
    if (patch.e < patch.s){ toast("End date must be on or after start date", "warn"); return; }
    if (isNew){ addTask(prjId, patch); toast(`Task <b>${esc(patch.name)}</b> added`, "good"); }
    else { updateTask(prjId, t.name, patch); toast(`Task <b>${esc(patch.name)}</b> updated`, "good"); }
    closeModal(); setView("gantt"); refreshBadges();
  };
  const del = $q("#teDelete");
  if (del) del.onclick = () => {
    deleteTask(prj.id, t.name);
    closeModal(); toast(`Task <b>${esc(t.name)}</b> deleted`, "warn"); setView("gantt"); refreshBadges();
  };
}

/* ---------- FACA ---------- */
function facaListHTML(){
  const cls = s => s==="Overdue"?"bad":s==="In Review"?"acc":s==="Closed"?"good":"warn";
  return DB.FACA.filter(f=>STATE.product==="ALL"||f.product===STATE.product).map(f => `
    <div class="item" data-faca="${f.id}">
      <div class="item-ico" style="background:var(--pur-soft);color:var(--pur)">${f.ico}</div>
      <div class="item-body">
        <div class="item-title">${f.id} · ${esc(f.title)}</div>
        <div class="item-sub">${f.product} · ${f.stage} · ${esc(f.owner)} · due ${f.due}</div>
      </div>
      <div class="item-meta">
        <span class="pill ${cls(f.status)}">${f.status}</span>
        <span class="mono" style="font-size:10.5px;color:var(--txt2)">${f.progress}%</span>
      </div>
    </div>`).join("") || `<div class="empty">No FACA actions for current filter</div>`;
}

function viewFaca(){
  return `
  <div class="grid g-32">
    <div class="card" style="padding:6px 10px"><div class="table-wrap" style="border:none">${facaListHTML()}</div></div>
    <div class="card">
      <div class="card-head"><h3>Status mix</h3></div>
      <div class="donut-wrap">
        <div class="donut" id="facaDonut"></div>
        <div class="donut-leg" id="facaLeg"></div>
      </div>
    </div>
  </div>`;
}

function mountFaca(){
  const items = DB.FACA.filter(f=>STATE.product==="ALL"||f.product===STATE.product);
  const mix = [
    { label:"Open",       v:items.filter(f=>f.status==="Open").length,      color:"var(--warn)" },
    { label:"In Review",  v:items.filter(f=>f.status==="In Review").length, color:"var(--acc)" },
    { label:"Overdue",    v:items.filter(f=>f.status==="Overdue").length,   color:"var(--bad)" },
    { label:"Closed",     v:items.filter(f=>f.status==="Closed").length,    color:"var(--good)" },
  ].filter(s=>s.v>0);
  CHARTS.donut($q("#facaDonut"), mix, items.length, "actions");
  $q("#facaLeg").innerHTML = mix.map(s=>`<div class="dl"><i style="width:9px;height:9px;border-radius:3px;display:inline-block;background:${s.color}"></i>${s.label}<b>${s.v}</b></div>`).join("");
  $q$("#viewArea [data-faca]").forEach(el => el.onclick = () => {
    const f = DB.FACA.find(x=>x.id===el.dataset.faca);
    if (f) openFacaEditor(f.id);
  });
}

/* ---------- FACA editor ---------- */
function openFacaEditor(id){
  const f = DB.FACA.find(x=>x.id===id);
  openModal(`
    <h2>${f.id} — ${esc(f.title)}</h2>
    <div class="modal-grid" style="margin-top:12px">
      <div class="stat-box"><span>Product</span><b>${f.product}</b></div>
      <div class="stat-box"><span>Stage</span><b>${f.stage}</b></div>
      <div class="stat-box"><span>Owner</span><b style="font-size:14px">${esc(f.owner)}</b></div>
      <div class="stat-box"><span>Due</span><b>${f.due}</b></div>
      <div class="stat-box"><span>Process</span><b style="font-size:13px">${esc((DB.PROCESSES.find(p=>p.id===f.process)||{}).name||f.process)}</b></div>
    </div>
    <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;margin:6px 0 14px">
      <label class="fld"><span>Status</span>
        <select id="feStatus">${["Open","In Review","Overdue","Closed"].map(s=>`<option ${f.status===s?"selected":""}>${s}</option>`).join("")}</select>
      </label>
      <label class="fld"><span>Progress %</span>
        <input id="feProgress" type="number" min="0" max="100" value="${f.progress}"/>
      </label>
      <button class="btn-primary" id="feSave">Save</button>
    </div>
    <div class="bar" style="margin:6px 0 14px"><i class="${f.status==="Overdue"?"b":f.progress>=80?"g":"w"}" style="width:${f.progress}%"></i></div>
    <div class="item-sub">Discipline: 8D-linked corrective action tracked at the FACA committee. Escalation path: process owner → NPI PM → BU quality head.</div>
  `);
  $q("#feSave").onclick = async () => {
    const patch = { status: $q("#feStatus").value, progress: Math.max(0, Math.min(100, +$q("#feProgress").value || 0)) };
    try {
      await DataHub.updateFaca(f.id, patch);
      closeModal(); toast(`<b>${f.id}</b> updated — ${patch.status}, ${patch.progress}%`, "good");
      setView(STATE.view); refreshBadges(); buildTicker();
    } catch(e){ toast("Save failed: " + esc(e.message || e), "bad"); }
  };
}

/* ---------- CLAIMS ---------- */
function claimsTableHTML(productFilter){
  const rows = DB.CLAIMS
    .filter(c => (productFilter ? c.product===productFilter : STATE.product==="ALL" || c.product===STATE.product))
    .filter(c => STATE.side==="ALL" || c.side===STATE.side)
    .map(c => {
      const sevCls = c.severity==="Critical"?"bad":c.severity==="Major"?"warn":"acc";
      const stCls  = c.status==="Containment"?"bad":c.status==="Root Cause"?"warn":"acc";
      return `<tr data-claim="${c.id}">
        <td class="mono"><b>${c.id}</b></td>
        <td class="mono">${c.product}</td>
        <td>${c.side}</td>
        <td>${esc(c.customer)}</td>
        <td><span class="pill ${sevCls}">${c.severity}</span></td>
        <td><span class="pill ${stCls}">${c.status}</span></td>
        <td class="trunc" title="${esc(c.issue)}">${esc(c.issue)}</td>
        <td class="num">${c.qty}</td>
        <td>${esc(c.owner)}</td>
        <td class="mono">${c.eta}</td>
      </tr>`;
    }).join("");
  return `<table>
    <thead><tr><th>Claim</th><th>Product</th><th>Side</th><th>Customer</th><th>Severity</th><th>Status</th><th>Issue</th><th>Qty</th><th>Owner</th><th>ETA</th></tr></thead>
    <tbody>${rows || `<tr><td colspan="10" class="empty">No claims match current filters</td></tr>`}</tbody>
  </table>`;
}

function viewClaims(){
  return `
  <div class="card" style="padding:6px 10px">
    <div class="card-head" style="padding:10px 6px 4px">
      <h3>Claim register</h3>
      <span class="sub">
        <span class="pill bad">${DB.CLAIMS.length} open</span>
        <button class="mini-btn" id="exportClaims">⬇ CSV</button>
        <button class="btn-primary" id="newClaim" style="margin-left:4px">＋ New claim</button>
      </span>
    </div>
    <div class="table-wrap" style="border:none">${claimsTableHTML()}</div>
  </div>`;
}

function mountClaims(){
  const eb = $q("#exportClaims"); if (eb) eb.onclick = exportClaims;
  const nb = $q("#newClaim"); if (nb) nb.onclick = openNewClaimForm;
  $q$("#viewArea [data-claim]").forEach(el => el.onclick = () => {
    const c = DB.CLAIMS.find(x=>x.id===el.dataset.claim);
    if (c) openClaimModal(c.id);
  });
}

function openClaimModal(id){
  const c = DB.CLAIMS.find(x=>x.id===id);
  const sevCls = c.severity==="Critical"?"bad":c.severity==="Major"?"warn":"acc";
  openModal(`
    <h2>${c.id} — <span class="pill ${sevCls}" style="vertical-align:2px">${c.severity}</span></h2>
    <div class="modal-grid" style="margin-top:12px">
      <div class="stat-box"><span>Product</span><b>${c.product}</b></div>
      <div class="stat-box"><span>Side</span><b>${c.side}</b></div>
      <div class="stat-box"><span>Customer</span><b style="font-size:14px">${esc(c.customer)}</b></div>
      <div class="stat-box"><span>Opened</span><b style="font-size:13px">${c.opened}</b></div>
      <div class="stat-box"><span>Qty affected</span><b>${c.qty}</b></div>
      <div class="stat-box"><span>RMA</span><b>${c.rma}</b></div>
    </div>
    <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;margin:6px 0 14px">
      <label class="fld"><span>Status</span>
        <select id="ceStatus">${["Containment","Root Cause","Verified","Monitoring","Closed"].map(s=>`<option ${c.status===s?"selected":""}>${s}</option>`).join("")}</select>
      </label>
      <label class="fld"><span>ETA</span><input id="ceEta" type="date" value="${c.eta}"/></label>
      <label class="fld grow"><span>Corrective action</span><input id="ceCa" value="${esc(c.ca)}"/></label>
      <button class="btn-primary" id="ceSave">Save</button>
    </div>
    <div class="item-title" style="margin:8px 0 4px">Issue</div>
    <div class="item-sub" style="font-size:12.5px;color:var(--txt)">${esc(c.issue)}</div>
    <div class="item-title" style="margin:14px 0 4px">Containment</div>
    <div class="item-sub" style="font-size:12.5px;color:var(--txt)">${esc(c.containment)}</div>
    <div class="item-title" style="margin:14px 0 4px">8D progress</div>
    <div class="item-sub" style="font-size:12.5px;color:var(--txt)"><b>Root cause:</b> ${esc(c.root)}<br/><b>Preventive action:</b> ${esc(c.pa)}</div>
  `);
  $q("#ceSave").onclick = async () => {
    const patch = { status: $q("#ceStatus").value, eta: $q("#ceEta").value, ca: $q("#ceCa").value };
    try {
      await DataHub.updateClaim(c.id, patch);
      closeModal(); toast(`<b>${c.id}</b> updated`, "good");
      setView(STATE.view); refreshBadges(); buildTicker();
    } catch(e){ toast("Save failed: " + esc(e.message || e), "bad"); }
  };
}

function openNewClaimForm(){
  openModal(`
    <h2>Log new customer claim</h2>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin:12px 0">
      <label class="fld"><span>Product</span>
        <select id="ncProduct">${DB.PRODUCTS.map(p=>`<option>${p.id}</option>`).join("")}</select>
      </label>
      <label class="fld"><span>Side</span>
        <select id="ncSide"><option>RHS</option><option>LHS</option></select>
      </label>
      <label class="fld"><span>Severity</span>
        <select id="ncSeverity"><option>Critical</option><option selected>Major</option><option>Minor</option></select>
      </label>
      <label class="fld"><span>Qty affected</span><input id="ncQty" type="number" min="1" value="1"/></label>
      <label class="fld grow"><span>Customer</span><input id="ncCustomer" placeholder="e.g. NovaServe"/></label>
      <label class="fld grow"><span>Owner</span><input id="ncOwner" placeholder="e.g. J. Tan"/></label>
    </div>
    <label class="fld" style="display:block;margin-bottom:12px"><span>Issue description</span>
      <textarea id="ncIssue" rows="3" style="width:100%" placeholder="What failed, where, how detected…"></textarea>
    </label>
    <div style="display:flex;justify-content:flex-end;gap:8px">
      <button class="mini-btn" id="ncCancel">Cancel</button>
      <button class="btn-primary" id="ncSave">Log claim</button>
    </div>
  `);
  $q("#ncCancel").onclick = closeModal;
  $q("#ncSave").onclick = async () => {
    const customer = $q("#ncCustomer").value.trim();
    const issue = $q("#ncIssue").value.trim();
    if (!customer || !issue){ toast("Customer and issue description are required", "warn"); return; }
    const id = "CL-" + (2300 + DB.CLAIMS.length + Math.floor(Math.random()*90));
    const today = new Date().toISOString().slice(0,10);
    const eta = new Date(Date.now() + 14*864e5).toISOString().slice(0,10);
    const claim = {
      id, product: $q("#ncProduct").value, side: $q("#ncSide").value,
      customer, severity: $q("#ncSeverity").value, status: "Containment",
      opened: today, issue, qty: Math.max(1, +$q("#ncQty").value || 1),
      owner: $q("#ncOwner").value.trim() || "unassigned", eta, rma: "—",
      containment: "Pending — define within 24h.", root: "under investigation", ca: "—", pa: "—",
    };
    try {
      await DataHub.addClaim(claim);
      closeModal(); toast(`<b>${id}</b> logged for ${esc(customer)}`, "good");
      setView(STATE.view); refreshBadges(); buildTicker();
    } catch(e){ toast("Save failed: " + esc(e.message || e), "bad"); }
  };
}

/* ---------- SHIPMENTS ---------- */
function viewShipments(){
  return `
  <div class="grid g-32">
    <div class="card">
      <div class="card-head"><h3>Commit vs actual — weekly</h3><span class="sub"><span class="pill acc">10 weeks</span><button class="mini-btn" id="exportShip">⬇ CSV</button></span></div>
      <div id="shipChart"></div>
    </div>
    <div class="card">
      <div class="card-head"><h3>Achievement</h3></div>
      <div class="modal-grid" style="grid-template-columns:1fr 1fr">
        <div class="stat-box"><span>10-wk avg</span><b id="shipAvg">—</b></div>
        <div class="stat-box"><span>On-target weeks</span><b id="shipHit">—</b></div>
      </div>
      <div id="shipBars" style="display:flex;flex-direction:column;gap:10px;margin-top:8px"></div>
    </div>
  </div>
  <div class="card" style="margin-top:14px;padding:6px 10px">
    <div class="table-wrap" style="border:none">
      <table>
        <thead><tr><th>Week</th><th>Commit</th><th>Actual</th><th>Achievement</th><th>Gap</th></tr></thead>
        <tbody>
          ${DB.SHIPMENTS.map(s => {
            const pct = s.actual/s.commit*100;
            const cls = pct>=100?"good":pct>=95?"warn":"bad";
            return `<tr><td class="mono"><b>${s.week}</b></td>
              <td class="num">${DB.fmtW(s.commit)}</td>
              <td class="num">${DB.fmtW(s.actual)}</td>
              <td><span class="pill ${cls}">${pct.toFixed(1)}%</span></td>
              <td class="num" style="color:${pct>=100?"var(--good)":"var(--bad)"}">${s.actual-s.commit>=0?"+":""}${DB.fmtW(s.actual-s.commit)}</td></tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>
  </div>`;
}

function mountShipments(){
  const es = $q("#exportShip"); if (es) es.onclick = exportShipments;
  const S = DB.SHIPMENTS;
  const ratios = S.map(s => +(s.actual/s.commit*100).toFixed(1));
  CHARTS.lineChart($q("#shipChart"), {
    data: ratios, labels: S.map(s=>s.week), target: 100, fmt: v=>v.toFixed(0)+"%",
  });
  const avg = ratios.reduce((a,b)=>a+b,0)/ratios.length;
  $q("#shipAvg").textContent = avg.toFixed(1)+"%";
  $q("#shipHit").textContent = S.filter(s=>s.actual>=s.commit).length + " / " + S.length;
  $q("#shipBars").innerHTML = S.slice(-5).map(s => {
    const pct = s.actual/s.commit*100;
    return `<div>
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">
        <b>${s.week}</b><span class="mono">${DB.fmtW(s.actual)} / ${DB.fmtW(s.commit)}</span>
      </div>
      <div class="bar"><i class="${pct>=100?"g":pct>=95?"w":"b"}" style="width:${Math.min(100,pct).toFixed(0)}%"></i></div>
    </div>`;
  }).join("");
}

/* ============================================================
   EXECUTIVE STAGE-GATE REPORT (print / PDF-ready)
   ============================================================ */
function openExecReport(){
  const snap = kpiSnapshot();
  const { labels, data } = DB.spcSamples();
  const st = DB.spcStats(data);
  const LSL = 93.0;
  const cpk = (st.cl - LSL) / (3 * st.sd);
  const we = DB.westernElectric(data, st);
  const ooc = data.filter((v,i) => v > st.ucl || v < st.lcl).length;
  const prods = filteredProducts();
  const worstFpy = [...prods].sort((a,b) => DB.PRODUCT_KPI[a.id].fpy - DB.PRODUCT_KPI[b.id].fpy)[0];
  const bestFpy  = [...prods].sort((a,b) => DB.PRODUCT_KPI[b.id].fpy - DB.PRODUCT_KPI[a.id].fpy)[0];
  const critClaim = DB.CLAIMS.find(c => c.severity==="Critical") || DB.CLAIMS[0];
  const overdueFaca = DB.FACA.filter(f => f.status==="Overdue");
  const riskyTasks = DB.PROJECTS.flatMap(p => p.tasks.filter(t => t.done<100 && t.e && t.e < isoOf(DB.TODAY)).map(t => ({ p, t })));
  const gate = g => `<span class="pill ${g==="green"?"good":g==="amber"?"warn":"bad"}">${g}</span>`;

  openModal(`
    <h2>Executive NPI report — ${isoOf(DB.TODAY)}</h2>
    <div class="item-sub" style="margin:2px 0 14px">Auto-generated for stage-gate review · scope: ${STATE.product==="ALL"?"all products":STATE.product}${STATE.stage!=="ALL"?" · stage "+STATE.stage:""}${STATE.lot!=="ALL"?" · lot "+STATE.lot:""} · ${prods.length} product(s)</div>
    <div class="modal-grid" style="grid-template-columns:repeat(auto-fit,minmax(120px,1fr))">
      <div class="stat-box"><span>Blended FPY</span><b>${snap.fpy}%</b></div>
      <div class="stat-box"><span>FY</span><b>${snap.fy}%</b></div>
      <div class="stat-box"><span>UPH</span><b>${snap.uph}</b></div>
      <div class="stat-box"><span>OEE</span><b>${snap.oee}%</b></div>
      <div class="stat-box"><span>Shipment</span><b>${snap.ship}%</b></div>
      <div class="stat-box"><span>Cpk (LSL 93)</span><b>${cpk.toFixed(2)}</b></div>
      <div class="stat-box"><span>SPC signals</span><b>${ooc + Object.keys(we).length}</b></div>
      <div class="stat-box"><span>Open claims</span><b>${DB.CLAIMS.length}</b></div>
    </div>
    <div class="item-title" style="margin:10px 0 6px">Health snapshot</div>
    <table class="report-table">
      <thead><tr><th>Product</th><th>Stage</th><th>FPY</th><th>FY</th><th>OEE</th><th>Ship</th><th>Gate</th></tr></thead>
      <tbody>
        ${prods.map(p => { const k = DB.PRODUCT_KPI[p.id]; const g = k.fpy>=96.5&&k.oee>=80?"green":k.fpy>=94?"amber":"red"; return `<tr>
          <td class="mono"><b>${p.id}</b></td><td>${p.stage}</td><td class="num">${k.fpy.toFixed(1)}%</td><td class="num">${k.fy.toFixed(1)}%</td><td class="num">${k.oee.toFixed(0)}%</td><td class="num">${k.ship.toFixed(0)}%</td><td>${gate(g)}</td></tr>`; }).join("")}
      </tbody>
    </table>
    <div class="item-title" style="margin:14px 0 6px">Watch items — needs attention at the gate</div>
    <ul class="report-list">
      ${worstFpy ? `<li><b>${worstFpy.id}</b> lowest FPY at ${DB.PRODUCT_KPI[worstFpy.id].fpy.toFixed(1)}% (vs 96.5 target) — ${esc(worstFpy.name)}</li>` : ""}
      ${critClaim ? `<li><b>${critClaim.id}</b> ${esc(critClaim.severity)} claim — ${esc(critClaim.customer)} · containment ETA ${critClaim.eta}</li>` : ""}
      ${overdueFaca.map(f => `<li><b>${f.id}</b> FACA overdue (${f.progress}%) — ${esc(f.title)}</li>`).join("")}
      ${riskyTasks.map(({p,t}) => `<li><b>${p.product}</b> Gantt task overdue — ${esc(t.name)} (ended ${t.e} at ${t.done}%)</li>`).join("")}
      ${ooc ? `<li><b>SPC:</b> ${ooc} point(s) beyond ±3σ — special cause unresolved</li>` : ""}
      ${Object.keys(we).length ? `<li><b>SPC:</b> ${Object.keys(we).length} Western Electric signal(s) — early drift present</li>` : ""}
    </ul>
    <div class="item-title" style="margin:14px 0 6px">Wins to sustain</div>
    <ul class="report-list">
      ${bestFpy ? `<li><b>${bestFpy.id}</b> best FPY at ${DB.PRODUCT_KPI[bestFpy.id].fpy.toFixed(1)}%</li>` : ""}
      ${snap.ship>=98 ? `<li>Shipment achievement sustained at <b>${snap.ship}%</b></li>` : ""}
      <li>4 NPI lines live — P1 → PVT pipeline flowing (${DB.fmtW(DB.PIPELINE.reduce((s,p)=>s+p.units,0))} units in build)</li>
    </ul>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">
      <button class="mini-btn" id="erCsv">⬇ Watch items CSV</button>
      <button class="btn-primary" id="erPrint">🖨 Print / Save PDF</button>
    </div>
  `);
  $q("#erPrint").onclick = () => window.print();
  $q("#erCsv").onclick = () => exportCSV("fdb-watch-items.csv", [["Type","Ref","Detail"],
    ...prods.map(p => { const k = DB.PRODUCT_KPI[p.id]; return ["Product", p.id, `FPY ${k.fpy}% · OEE ${k.oee}% · gate ${k.fpy>=96.5&&k.oee>=80?"green":k.fpy>=94?"amber":"red"}`]; })
    .concat(overdueFaca.map(f => ["FACA", f.id, f.title]))
    .concat(riskyTasks.map(({p,t}) => ["Gantt", p.product, `${t.name} overdue since ${t.e} at ${t.done}%`]))]);
}

/* ============================================================
   MODAL
   ============================================================ */
function openModal(html){
  // extract leading <h2>…</h2> into the sticky header
  let title = "";
  const m = html.match(/^\s*<h2[^>]*>([\s\S]*?)<\/h2>/);
  if (m){ title = m[1]; html = html.slice(m[0].length); }
  $q("#modalRoot").innerHTML = `<div class="modal-back" id="modalBack"><div class="modal">
    <div class="modal-head"><h2 style="flex:1">${title}</h2><button class="icon-btn" id="modalClose">✕</button></div>
    <div class="modal-body">${html}</div>
  </div></div>`;
  $q("#modalBack").onclick = e => { if (e.target.id==="modalBack") closeModal(); };
  $q("#modalClose").onclick = closeModal;
  document.addEventListener("keydown", escListener);
}
function escListener(e){ if (e.key==="Escape") closeModal(); }
function closeModal(){
  $q("#modalRoot").innerHTML = "";
  document.removeEventListener("keydown", escListener);
}

/* product modal */
function openProductModal(pid){
  const p = DB.PRODUCTS.find(x=>x.id===pid);
  const k = DB.PRODUCT_KPI[pid];
  const volPct = Math.min(100, p.vol.ytd/p.vol.target*100);
  openModal(`
    <h2>${p.id} — ${esc(p.name)}</h2>
    <div class="modal-grid" style="margin-top:12px">
      <div class="stat-box"><span>Customer</span><b style="font-size:14px">${esc(p.customer)}</b></div>
      <div class="stat-box"><span>NPI stage</span><b>${p.stage}</b></div>
      <div class="stat-box"><span>Side</span><b>${p.side}</b></div>
      <div class="stat-box"><span>Line</span><b>${p.line}</b></div>
      <div class="stat-box"><span>Lots</span><b style="font-size:13px">${(DB.PRODUCT_LOTS[p.id]||[]).join(" · ")}</b></div>
      <div class="stat-box"><span>Mule</span><b>${p.mule}</b></div>
      <div class="stat-box"><span>Ramp</span><b>${p.ramp}</b></div>
      <div class="stat-box"><span>FPY</span><b>${k.fpy.toFixed(1)}%</b></div>
      <div class="stat-box"><span>FY</span><b>${k.fy.toFixed(1)}%</b></div>
      <div class="stat-box"><span>UPH</span><b>${k.uph}</b></div>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:12px;margin:8px 0 4px">
      <b>YTD volume</b><span class="mono">${DB.fmtW(p.vol.ytd)} / ${DB.fmtW(p.vol.target)} (${volPct.toFixed(0)}%)</span>
    </div>
    <div class="bar" style="margin-bottom:16px"><i class="${volPct>=100?"g":volPct>=90?"w":"b"}" style="width:${volPct.toFixed(0)}%"></i></div>
    <div id="pmTrend" style="margin-bottom:6px"></div>
    <div class="sec-head"><h2>Open items</h2><div class="rule"></div></div>
    ${(DB.FACA.filter(f=>f.product===pid).map(f=>`<div class="item"><div class="item-ico" style="background:var(--pur-soft);color:var(--pur)">${f.ico}</div><div class="item-body"><div class="item-title">${f.id} · ${esc(f.title)}</div><div class="item-sub">${f.status} · due ${f.due}</div></div><span class="pill ${f.status==="Overdue"?"bad":"warn"}">${f.progress}%</span></div>`).join(""))
    + (DB.CLAIMS.filter(c=>c.product===pid).map(c=>`<div class="item"><div class="item-ico" style="background:var(--bad-soft);color:var(--bad)">⚑</div><div class="item-body"><div class="item-title">${c.id} · ${esc(c.issue)}</div><div class="item-sub">${c.severity} · ${c.status} · ETA ${c.eta}</div></div></div>`).join(""))
    || `<div class="empty">No open FACA or claims for ${pid}</div>`}
  `);
  CHARTS.lineChart($q("#pmTrend"), { data: k.fpys, labels: labelsFor(k.fpys, 28), fmt: v=>v.toFixed(1)+"%", target: 96.5 });
}

/* ============================================================
   ROUTER
   ============================================================ */
function setView(v){
  STATE.view = v;
  $q$(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.view===v));
  const meta = VIEWS[v];
  $q("#viewTitle").textContent = meta.title;
  $q("#viewSub").textContent = meta.sub;

  const renderers = {
    overview:  [viewOverview,  mountOverview],
    products:  [viewProducts,  mountProducts],
    processes: [viewProcesses, mountProcesses],
    kpi:       [viewKpi,       mountKpi],
    quality:   [viewQuality,   mountQuality],
    gantt:     [viewGantt,     mountGantt],
    faca:      [viewFaca,      mountFaca],
    claims:    [viewClaims,    mountClaims],
    shipments: [viewShipments, mountShipments],
  };
  const [htmlFn, mountFn] = renderers[v];
  $q("#viewArea").innerHTML = htmlFn();
  mountFn();
  closeSidebarMobile();
  window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
}

/* ---------- segment controls ---------- */
function buildSeg(el, items, key, allLabel){
  el.innerHTML = `<button data-v="ALL" class="${STATE[key]==="ALL"?"on":""}">${allLabel}</button>` +
    items.map(i => `<button data-v="${i}" class="${STATE[key]===i?"on":""}">${i}</button>`).join("");
  el.querySelectorAll("button").forEach(b => b.onclick = () => {
    STATE[key] = b.dataset.v;
    el.querySelectorAll("button").forEach(x => x.classList.toggle("on", x===b));
    setView(STATE.view);
    toast(`${key === "stage" ? "Stage" : key === "side" ? "Side" : key === "line" ? "Line" : "Range"} → <b>${b.dataset.v==="ALL"?"All":b.dataset.v}</b>`);
  });
}
function syncSegs(){
  [["#stageSeg","stage"],["#sideSeg","side"],["#lineSeg","line"],["#rangeSeg","range"]].forEach(([sel,key]) => {
    $q(sel).querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.v===STATE[key]));
  });
  const ps = $q("#productSel"); if (ps) ps.value = STATE.product;
  rebuildLotSelect();
}

/* ---------- ticker + live badges ---------- */
function buildTicker(){
  const items = DB.allAlerts().map(a =>
    `<span class="t-${a.sev}">${a.sev==="bad"?"⚑":a.sev==="warn"?"⚠":"✓"} ${esc(a.txt)}</span>`
  ).join("");
  $q("#tickerTrack").innerHTML = items + items; // duplicate for seamless loop
}
function refreshBadges(){
  const claims = DB.CLAIMS.length;
  const faca = DB.FACA.filter(f=>f.status!=="Closed").length;
  const atRisk = DB.PROJECTS.filter(p=>
    p.health!=="green" || p.tasks.some(t => t.done<100 && t.e && t.e < isoOf(DB.TODAY))
  ).length;
  const alerts = DB.allAlerts().length;
  const set = (sel, n) => { const el = $q(sel); if (el){ el.textContent = n; el.style.display = n ? "" : "none"; } };
  set("#badgeAlerts", alerts);
  set("#badgeAtRisk", atRisk);
  set("#badgeFaca", faca);
  const cb = $q("#badgeClaims");
  if (cb){ cb.textContent = claims; cb.style.display = claims ? "" : "none"; }
}

/* ---------- sidebar mobile ---------- */
function openSidebarMobile(){ $q("#sidebar").classList.add("open"); $q("#scrim").classList.add("show"); }
function closeSidebarMobile(){ $q("#sidebar").classList.remove("open"); $q("#scrim").classList.remove("show"); }

/* ---------- settings (data source) ---------- */
function openSettings(){
  openModal(`
    <h2>Data source & settings</h2>
    <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;margin:12px 0">
      <label class="fld"><span>Mode</span>
        <select id="stMode"><option value="demo" ${DataHub.mode==="demo"?"selected":""}>Demo (local, persisted)</option><option value="rest" ${DataHub.mode==="rest"?"selected":""}>REST API</option></select>
      </label>
      <label class="fld grow"><span>Base URL (REST mode)</span><input id="stUrl" placeholder="https://mes.example.com/api" value="${esc(DataHub.baseUrl)}"/></label>
      <button class="mini-btn" id="stTest">Test connection</button>
    </div>
    <div id="stNote" class="item-sub" style="margin-bottom:14px"></div>
    <div class="item-title">REST contract</div>
    <div class="item-sub" style="margin:6px 0 14px"><span class="mono">GET /health · PATCH /claims/:id · POST /claims · PATCH /faca/:id</span> — JSON bodies, standard status codes. In demo mode writes persist to <span class="mono">localStorage[${DB.LS_KEY}]</span>.</div>
    <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap">
      <button class="mini-btn" id="stReset">Reset local edits</button>
      <button class="btn-primary" id="stSave">Save</button>
    </div>
  `);
  $q("#stTest").onclick = async () => {
    $q("#stNote").textContent = "Testing…";
    const r = await DataHub.testConnection();
    $q("#stNote").innerHTML = (r.ok ? "✅ " : "❌ ") + esc(r.note);
  };
  $q("#stReset").onclick = () => {
    DB.resetOverrides();
    toast("Local edits reset to demo baseline", "warn");
    setView(STATE.view);
  };
  $q("#stSave").onclick = () => {
    DataHub.mode = $q("#stMode").value;
    DataHub.baseUrl = $q("#stUrl").value.trim();
    try { localStorage.setItem("fdb-dh-mode", DataHub.mode); localStorage.setItem("fdb-dh-url", DataHub.baseUrl); } catch(e){}
    closeModal();
    toast(`Data source → <b>${DataHub.mode}</b>${DataHub.baseUrl ? " · " + esc(DataHub.baseUrl) : ""}`, "good");
  };
}

/* ---------- boot ---------- */
function boot(){
  initTheme();
  buildProductSelect();
  rebuildLotSelect();
  buildSeg($q("#stageSeg"), DB.STAGES, "stage", "All");
  buildSeg($q("#sideSeg"),  DB.SIDES,  "side",  "All");
  buildSeg($q("#lineSeg"),  DB.LINES,  "line",  "All");
  buildSeg($q("#rangeSeg"), DB.RANGES, "range", "");

  $q$(".nav-item").forEach(b => b.onclick = () => setView(b.dataset.view));
  $q("#menuBtn").onclick = openSidebarMobile;
  $q("#sidebarClose").onclick = closeSidebarMobile;
  $q("#scrim").onclick = closeSidebarMobile;
  $q("#themeBtn").onclick = () => applyTheme(document.documentElement.dataset.theme==="dark" ? "light" : "dark");
  $q("#settingsBtn").onclick = openSettings;
  $q("#reportBtn").onclick = openExecReport;

  buildTicker();

  // delegate product row clicks
  $q("#viewArea").addEventListener("click", e => {
    const tr = e.target.closest("tr[data-prod]");
    if (tr) openProductModal(tr.dataset.prod);
  });

  // footer bars + clock + live sync
  const bars = $q("#footBars");
  bars.innerHTML = Array.from({length:12}, () => `<i style="height:${20+Math.round(Math.random()*80)}%"></i>`).join("");
  setInterval(() => {
    bars.innerHTML = Array.from({length:12}, () => `<i style="height:${20+Math.round(Math.random()*80)}%"></i>`).join("");
    $q("#lastSync").textContent = "synced " + new Date().toLocaleTimeString("en",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
    // subtle live jitter on overview chart values
    if (STATE.view === "overview" && Math.random() < 0.34){
      const s = DB.KPI_SERIES.fpy;
      s[s.length-1] = +(s.at(-1) + (Math.random()-0.5)*0.3).toFixed(2);
      mountOverview();
    }
  }, 15000);

  const clock = $q("#footClock");
  const tick = () => clock.textContent = new Date().toLocaleString("en",{ weekday:"short", hour:"2-digit", minute:"2-digit", second:"2-digit" });
  tick(); setInterval(tick, 1000);

  setView("overview");
  refreshBadges();
  setTimeout(() => toast("Welcome to <b>FDB NPI Command Center</b> — click any KPI card, product row or Gantt bar.", "good"), 600);
}

document.addEventListener("DOMContentLoaded", boot);
