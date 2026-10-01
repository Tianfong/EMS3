"use strict";
/* ============================================================
   FDB NPI Command Center — mock data layer
   Products X4151/X4152/... · RHS/LHS · Stages P1,P2,EVT,DVT,PVT
   KPIs: FPY, FY, UPH, OEE, Shipment, Claims, FACA, Gantt
   ============================================================ */

const DB = (() => {

  /* ---------- master lists ---------- */
  const STAGES = ["P1", "P2", "EVT", "DVT", "PVT"];
  const SIDES  = ["RHS", "LHS"];
  const RANGES = ["7D", "30D", "QTD", "YTD"];

  const PROCESSES = [
    { id:"rotor",    name:"Rotor Assembly",        ico:"🌀", target:{ fpy:97.0, uph:150, oee:82 } },
    { id:"pillow",   name:"Pillow-Stator Assembly",ico:"🧲", target:{ fpy:96.0, uph:120, oee:80 } },
    { id:"fan",      name:"Fan Assembly",          ico:"🔧", target:{ fpy:95.5, uph:180, oee:85 } },
    { id:"test",     name:"Fan Test Accessory",    ico:"🧪", target:{ fpy:98.5, uph:220, oee:88 } },
  ];

  const PRODUCTS = [
    { id:"X4151", name:"FDB 92mm · Server",      customer:"CloudCore",  stage:"DVT", side:"RHS+LHS", mule:"M4",      ramp:"2026-Q4", vol: { ytd: 41200, target: 45000 } },
    { id:"X4152", name:"FDB 120mm · High-CFM",   customer:"NovaServe",  stage:"DVT", side:"RHS+LHS", mule:"M4",      ramp:"2026-Q4", vol: { ytd: 38600, target: 40000 } },
    { id:"X4153", name:"FDB 80mm · Slim",        customer:"EdgeWave",   stage:"EVT", side:"RHS",     mule:"M3",      ramp:"2027-Q1", vol: { ytd: 12600, target: 15000 } },
    { id:"X4154", name:"FDB 120mm · Dual",       customer:"NovaServe",  stage:"PVT", side:"RHS+LHS", mule:"M5",      ramp:"2026-Q3", vol: { y_data:0, ytd: 52100, target: 50000 } },
    { id:"X4155", name:"FDB 60mm · Blade",       customer:"PicoCloud",  stage:"P1",  side:"LHS",     mule:"M1",      ramp:"2027-Q2", vol: { ytd: 2100,  target: 6000 } },
    { id:"X4156", name:"FDB 97mm · Silent",      customer:"CloudCore",  stage:"P2",  side:"RHS",     mule:"M2",      ramp:"2027-Q1", vol: { ytd: 5400,  target: 8000 } },
  ];
  PRODUCTS.forEach(p => delete p.vol.y_data);

  /* deterministic PRNG so refreshes are stable between reloads-ish */
  let seed = 4151;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  /* ---------- NPI build lots (configurations) per stage ----------
     P1 → MP11, MP12… · P2 → MP21… · EVT → ME11, ME12…
     DVT → MD11, MD12… · PVT → MV11, MV12…                       */
  const LOT_PREFIX = { P1:"MP1", P2:"MP2", EVT:"ME1", DVT:"MD1", PVT:"MV1" };
  const LOTS = [];
  STAGES.forEach(st => {
    const n = { P1:2, P2:2, EVT:3, DVT:3, PVT:2 }[st];
    for (let i = 1; i <= n; i++){
      LOTS.push({
        id: LOT_PREFIX[st] + i,                 // MP11, MP12 · ME11 · MD11…
        stage: st,
        units: Math.round(80 + i*60 + (st.length*37) % 90),
      });
    }
  });
  /* product → lots currently running (within the product's stage) */
  const PRODUCT_LOTS = {};
  {
    let li = 0;
    PRODUCTS.forEach(p => {
      const inStage = LOTS.filter(l => l.stage === p.stage);
      const take = Math.max(1, Math.min(2, inStage.length));
      const start = li % Math.max(1, inStage.length - take + 1);
      PRODUCT_LOTS[p.id] = inStage.slice(start, start + take).map(l => l.id);
      li++;
    });
    // guarantee at least one lot per product
    PRODUCTS.forEach(p => { if (!PRODUCT_LOTS[p.id] || !PRODUCT_LOTS[p.id].length) PRODUCT_LOTS[p.id] = [LOTS.find(l=>l.stage===p.stage).id]; });
  }

  /* ---------- per-lot KPI snapshot ---------- */
  const LOT_KPI = {};
  {
    const lotSeeds = { P1: 4113, P2: 4121, EVT: 8837, DVT: 8839, PVT: 10037 };
    LOTS.forEach((l, i) => {
      seed = lotSeeds[l.stage] + i * 1013;
      const sb = { P1:-3.4, P2:-2.1, EVT:-1.4, DVT:-0.6, PVT:0 }[l.stage];
      LOT_KPI[l.id] = {
        fpy: +clamp(96.4 + sb + (rnd()-0.5)*2.6, 86, 99.7).toFixed(1),
        fy:  +clamp(98.2 + sb*0.5 + (rnd()-0.5)*1.4, 92, 99.9).toFixed(1),
        uph: Math.round(clamp(150 + sb*7 + (rnd()-0.5)*40, 95, 200)),
        oee: +clamp(80 + sb + (rnd()-0.5)*9, 62, 93).toFixed(1),
      };
    });
  }

  /* ---------- lot task flow (per-lot build lifecycle) ----------
     Preparation → MBO and Main build → OQC → OK2S → Shipment
     (schedules generated after TODAY is defined — see below)        */
  const LOT_PHASES = ["Preparation", "MBO and Main build", "OQC", "OK2S", "Shipment"];

  /* ---------- KPI definitions ---------- */
  const KPIS = [
    { id:"fpy",   name:"FPY",  full:"First Pass Yield",      unit:"%",  target:96.5, good:"up",  ico:"✅", note:"rotor → test, blended" },
    { id:"fy",    name:"FY",   full:"Final Yield",           unit:"%",  target:98.5, good:"up",  ico:"🏁", note:"incl. rework recovery" },
    {
      id:"uph",   name:"UPH",  full:"Units Per Hour",        unit:"",   target:160,  good:"up",  ico:"⚡", note:"line-rated, blended",
      base: 148, spread: 14,
    },
    {
      id:"oee",   name:"OEE",  full:"Overall Equipment Effectiveness", unit:"%", target:82, good:"up", ico:"🏭", note:"A × P × Q",
      base: 78.5, spread: 6,
    },
    { id:"ship",  name:"SHIP", full:"Shipment Achievement",  unit:"%",  target:100,  good:"up",  ico:"📦", note:"commit vs actual" },
    { id:"claim", name:"CLAIM",full:"Customer Claims",       unit:"",   target:0,    good:"down",ico:"⚑",  note:"open claims this quarter" },
    { id:"faca",  name:"FACA", full:"FACA Actions",          unit:"",   target:0,    good:"down",ico:"✎",  note:"open FACA actions" },
  ];

  /* ---------- deterministic series generator ---------- */
  function series(n, base, spread, drift=0, floor=null, ceil=null){
    const out = [];
    let v = base;
    for (let i=0;i<n;i++){
      v += (rnd()-0.5)*spread + drift;
      if (floor!==null) v = Math.max(floor, v);
      if (ceil !==null) v = Math.min(ceil, v);
      out.push(v);
    }
    return out;
  }

  const N = 42; // days of history
  const KPI_SERIES = {};
  KPIS.forEach(k => {
    if (k.id === "fpy")   KPI_SERIES.fpy   = series(N, 96.2, 1.1, 0.012, 93.2, 99.1);
    if (k.id === "fy")    KPI_SERIES.fy    = series(N, 98.3, 0.7, 0.006, 96.4, 99.9);
    if (k.id === "uph")   KPI_SERIES.uph   = series(N, k.base, k.spread, 0.05, 118, 182);
    if (k.id === "oee")   KPI_SERIES.oee   = series(N, k.base, k.spread, 0.02, 68, 91);
    if (k.id === "ship")  KPI_SERIES.ship  = series(N, 97.5, 4.5, 0.01, 86, 100);
    if (k.id === "claim") KPI_SERIES.claim = series(N, 4, 1.6, -0.01, 1, 9).map(Math.round);
    if (k.id === "faca")  KPI_SERIES.faca  = series(N, 5, 1.4, -0.01, 2, 9).map(Math.round);
  });

  /* ---------- per-product KPI snapshot ---------- */
  const PRODUCT_KPI = {};
  PRODUCTS.forEach(p => {
    seed = p.id.slice(1) * 97 + 13; // per-product seed
    const stageBoost = { P1:-3.2, P2:-1.8, EVT:-1.2, DVT:-0.4, PVT:0 }[p.stage];
    PRODUCT_KPI[p.id] = {
      fpy:   clamp(96.4 + stageBoost + (rnd()-0.5)*2.2, 86, 99.6),
      fy:    clamp(98.2 + stageBoost*0.5 + (rnd()-0.5)*1.2, 92, 99.9),
      uph:   Math.round(clamp(150 + stageBoost*6 + (rnd()-0.5)*36, 92, 195)),
      oee:   clamp(80 + stageBoost + (rnd()-0.5)*8, 63, 92),
      ship:  clamp(97 + (rnd()-0.5)*8, 84, 100),
      claim: Math.round(rnd()*3.4),
      faca:  Math.round(rnd()*3.4),
    };
    PRODUCT_KPI[p.id].fpys = series(28, PRODUCT_KPI[p.id].fpy, 1.3, 0.01, 84, 99.6);
  });

  /* ---------- per-process KPI snapshot (x stage) ---------- */
  const PROCESS_KPI = {};
  PROCESSES.forEach(pr => {
    seed = pr.id.length * 917 + 31;
    PROCESS_KPI[pr.id] = {};
    STAGES.forEach(st => {
      const sb = { P1:-3.4, P2:-2.1, EVT:-1.4, DVT:-0.6, PVT:0 }[st];
      PROCESS_KPI[pr.id][st] = {
        fpy: clamp(pr.target.fpy + sb + (rnd()-0.5)*2.4, 84, 99.8),
        uph: Math.round(clamp(pr.target.uph + sb*4 + (rnd()-0.5)*26, 60, 235)),
        oee: clamp(pr.target.oee + sb + (rnd()-0.5)*7, 62, 94),
      };
    });
  });

  /* ---------- side split (RHS / LHS) ---------- */
  const SIDE_KPI = {};
  {
    const seeds = { RHS: 5501, LHS: 9377 };
    SIDES.forEach((s, i) => {
      seed = seeds[s] + i * 4211;
      SIDE_KPI[s] = {
        fpy:  +clamp(96.1 + (rnd()-0.5)*1.6, 94, 98).toFixed(1),
        uph:  Math.round(clamp(146 + (rnd()-0.5)*22, 120, 180)),
        oee:  +clamp(79.5 + (rnd()-0.5)*7, 72, 88).toFixed(1),
      };
    });
  }

  /* ---------- shipments (weekly commit vs actual) ---------- */
  const SHIPMENTS = [];
  {
    seed = 991;
    const weeks = 10;
    for (let i=0;i<weeks;i++){
      const commit = 8000 + Math.round(rnd()*10)*250;
      const achieved = Math.round(commit * (0.90 + rnd()*0.13));
      SHIPMENTS.push({ week:`W${i+1}`, commit, actual: Math.min(achieved, commit + 300) });
    }
  }

  /* ---------- customer claims ---------- */
  const CLAIMS = [
    { id:"CL-2213", product:"X4152", side:"RHS", customer:"NovaServe",  severity:"Critical", status:"Containment", opened:"2026-09-18",
      issue:"Bearing noise > 32 dB(A) at 3,800 RPM on 0.4% of sample", qty:184, owner:"J. Tan",   eta:"2026-10-02", rma:"8A",
      containment:"Sort + 100% acoustic re-check at FAI-3; quarantine lot L0918.", root:"under investigation", ca:"—", pa:"—" },
    { id:"CL-2208", product:"X4151", side:"LHS", customer:"CloudCore",  severity:"Major",    status:"Root Cause",  opened:"2026-09-11",
      issue:"Hub set-screw torque drift out of 4.5–5.5 kgf·cm window",          qty:96,  owner:"M. Okafor",eta:"2026-09-30", rma:"2B",
      containment:"Torque audit 3×/shift; witness-mark all screws.",            root:"DC bit wear beyond PM interval", ca:"Bit PM interval 24h → 12h", pa:"Poka-yoke torque tool interlock (Nov)" },
    { id:"CL-2196", product:"X4154", side:"RHS", customer:"NovaServe",  severity:"Minor",    status:"Verified",    opened:"2026-08-29",
      issue:"Label print smudge on 2 lots — cosmetic only",                     qty:41,  owner:"R. Silva", eta:"2026-09-26", rma:"0A",
      containment:"Supplier label stock lot quarantined.",                      root:"Low-tack ribbon batch", ca:"Supplier ribbon spec updated", pa:"Incoming label ADP test weekly" },
    { id:"CL-2189", product:"X4153", side:"RHS", customer:"EdgeWave",   severity:"Major",    status:"Monitoring",  opened:"2026-08-21",
      issue:"Intermittent tach signal dropout during burn-in",                  qty:57,  owner:"K. Ito",   eta:"2026-10-05", rma:"1C",
      containment:"Add burn-in tach sniff test; hold-and-check 24h.",           root:"FPC connector crimp height", ca:"Crimper re-qualified", pa:"Crimp height SPC chart live at station" },
  ];

  /* ---------- FACA actions ---------- */
  const FACA = [
    { id:"FA-104", title:"Rotor OD variance 8µ beyond control plan",      product:"X4152", stage:"DVT", process:"rotor",  owner:"J. Tan",    due:"2026-10-01", status:"Open",       progress:55,  ico:"🌀" },
    { id:"FA-101", title:"Pillow-stator press-fit force window widening", product:"X4154", stage:"PVT", process:"pillow", owner:"A. Roy",    due:"2026-09-27", status:"Overdue",    progress:80,  ico:"🧲" },
    { id:"FA-097", title:"Fan screwdriver star-sequence automation",      product:"X4151", stage:"DVT", process:"fan",    owner:"M. Okafor", due:"2026-10-08", status:"In Review",  progress:90,  ico:"🔧" },
    { id:"FA-092", title:"EOL test accessory fixture re-design (v3)",     product:"X4153", stage:"EVT", process:"test",   owner:"K. Ito",    due:"2026-10-12", status:"Open",       progress:35,  ico:"🧪" },
    { id:"FA-088", title:"Upstream packaging ESD audit follow-up",        product:"X4156", stage:"P2",  process:"fan",    owner:"R. Silva",  due:"2026-09-25", status:"Overdue",    progress:65,  ico:"⚡" },
  ];

  /* ---------- projects / Gantt ---------- */
  const TODAY = new Date(2026, 8, 24); // Sep 24 2026
  const d2s = d => d.toISOString().slice(0,10);
  const addD = (d,n) => { const x = new Date(d); x.setDate(x.getDate()+n); return x; };
  const iso = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;

  const PROJECTS = [
    { id:"PRJ-X4155", name:"X4155 · 60mm Blade NPI",            product:"X4155", health:"green", owner:"A. Roy",
      tasks:[
        { name:"P1 Feasibility",            start:-70, end:-40, done:100, stage:"P1"  },
        { name:"P2 Design finalize",        start:-48, end:-14, done:100, stage:"P2"  },
        { name:"EVT build 1–2",             start:-20, end:6,   done:72,  stage:"EVT" },
        { name:"EVT exit review",           start:6,   end:12,  done:0,   stage:"EVT" },
        { name:"DVT build & validation",    start:14,  end:52,  done:0,   stage:"DVT" },
        { name:"PVT & ramp readiness",      start:54,  end:88,  done:0,   stage:"PVT" },
      ]},
    { id:"PRJ-X4156", name:"X4156 · 97mm Silent NPI",           product:"X4156", health:"amber", owner:"R. Silva",
      tasks:[
        { name:"P2 Design finalize",        start:-60, end:-24, done:100, stage:"P2"  },
        { name:"EVT builds",                start:-30, end:-2,  done:100, stage:"EVT" },
        { name:"DVT build 1",               start:-4,  end:30,  done:44,  stage:"DVT" },
        { name:"DVT reliability (1,000h)",  start:12,  end:58,  done:18,  stage:"DVT" },
        { name:"PVT pilot run",             start:60,  end:92,  done:0,   stage:"PVT" },
      ]},
    { id:"PRJ-X4153", name:"X4153 · 80mm Slim EVT→DVT",         product:"X4153", health:"green", owner:"K. Ito",
      tasks:[
        { name:"EVT closure actions",       start:-30, end:-6,  done:100, stage:"EVT" },
        { name:"DVT build 1–2",             start:-8,  end:26,  done:61,  stage:"DVT" },
        { name:"DVT exit gate",             start:26,  end:32,  done:0,   stage:"DVT" },
        { name:"PVT build",                 start:34,  end:64,  done:0,   stage:"PVT" },
        { name:"Mass-ramp preparation",     start:64,  end:96,  done:0,   stage:"PVT" },
      ]},
    { id:"PRJ-X4152", name:"X4152 · 120mm High-CFM ramp",       product:"X4152", health:"amber", owner:"J. Tan",
      tasks:[
        { name:"DVT residual validation",   start:-40, end:-10, done:100, stage:"DVT" },
        { name:"PVT pilot",                 start:-14, end:10,  done:82,  stage:"PVT" },
        { name:"Acoustic containment (CL-2213)", start:-6, end:14, done:55, stage:"PVT", flag:"claim" },
        { name:"Ramp-to-mp transition",     start:12,  end:46,  done:0,   stage:"PVT" },
      ]},
    { id:"PRJ-X4154", name:"X4154 · 120mm Dual MP sustain",     product:"X4154", health:"green", owner:"M. Okafor",
      tasks:[
        { name:"PVT pilot",                 start:-58, end:-30, done:100, stage:"PVT" },
        { name:"MP ramp",                   start:-30, end:-2,  done:100, stage:"PVT" },
        { name:"Yield improvement sprint",  start:-8,  end:22,  done:47,  stage:"PVT" },
        { name:"Cost-down phase 1",         start:16,  end:60,  done:0,   stage:"PVT" },
      ]},
    { id:"PRJ-X4151", name:"X4151 · 92mm Server MP",            product:"X4151", health:"green", owner:"A. Roy",
      tasks:[
        { name:"PVT pilot",                 start:-70, end:-40, done:100, stage:"PVT" },
        { name:"MP ramp",                   start:-40, end:-6,  done:100, stage:"PVT" },
        { name:"Quarterly QBR actions",     start:-10, end:18,  done:33,  stage:"PVT" },
      ]},
  ];
  // normalize project dates to real Date objects
  PROJECTS.forEach(p => p.tasks.forEach(t => {
    t.s = iso(addD(TODAY, t.start));
    t.e = iso(addD(TODAY, t.end));
    t.done = t.done ?? 0;
  }));

  /* ---------- per-lot phase schedules ---------- */
  const LOT_TASKS = {};
  LOTS.forEach((l, i) => {
    /* stages run earlier → later; lots inside a stage are staggered */
    const stageOrder = { P1: -46, P2: -38, EVT: -30, DVT: -22, PVT: -14 };
    const base = stageOrder[l.stage] + (i % 3) * 4;          // stagger lots in same stage
    const span = 6 + (i % 3) * 2;                            // phase duration
    /* progress scales with how far the stage window has elapsed */
    const el = (0 - base) / (span * 5 + 6);                  // 0..~1 by today
    const prog = Math.max(0, Math.min(1, el + ((i * 7) % 5) * 0.04));
    LOT_TASKS[l.id] = LOT_PHASES.map((name, ph) => {
      const s = base + ph * span;
      const done = Math.round(Math.max(0, Math.min(1, prog * LOT_PHASES.length - ph)) * 100);
      return { name, stage: l.stage, s: iso(addD(TODAY, s)), e: iso(addD(TODAY, s + span - 1)), done };
    });
  });

  /* ---------- stage pipeline summary (units through stages) ---------- */
  const PIPELINE = STAGES.map((st, i) => {
    seed = 104729 + i * 7919; // unique per stage (stage-name lengths collide)
    const units = Math.round(400 + rnd()*3600);
    const fpy = clamp(93.5 + rnd()*4.4, 92, 98);
    return { stage:st, units, fpy:+fpy.toFixed(1) };
  });

  /* ---------- alerts feed ---------- */
  const ALERTS = [
    { sev:"bad",  txt:"X4152 RHS FPY dipped 2.1σ below DVT control limit at Fan Assembly" },
    { sev:"warn", txt:"FA-101 FACA overdue — Pillow-stator press-fit window (X4154 PVT)" },
    { sev:"bad",  txt:"CL-2213 Critical claim open — NovaServe containment due Oct 2" },
    { sev:"warn", txt:"X4155 P1 UPH 38% below line-rate target — tooling pilot" },
    { sev:"good", txt:"X4154 PVT shipment achievement 99.6% — 3 weeks running" },
    { sev:"warn", txt:"Fan Test Accessory fixture v3 re-design slipping 4 days (X4153 EVT)" },
  ];

  /* ---------- quality analytics: defects + SPC ---------- */
  const DEFECTS = [
    { code:"D01", name:"Bearing noise >32dB",      process:"test",   product:"X4152", qty:86,  sev:"Critical" },
    { code:"D02", name:"Hub torque drift",         process:"fan",    product:"X4151", qty:64,  sev:"Major" },
    { code:"D03", name:"Rotor OD variance",        process:"rotor",  product:"X4152", qty:57,  sev:"Major" },
    { code:"D04", name:"Press-fit force OOS",      process:"pillow", product:"X4154", qty:41,  sev:"Major" },
    { code:"D05", name:"Tach signal dropout",      process:"test",   product:"X4153", qty:33,  sev:"Major" },
    { code:"D06", name:"Cosmetic label smudge",    process:"test",   product:"X4154", qty:28,  sev:"Minor" },
    { code:"D07", name:"Lead-wire scar",           process:"fan",    product:"X4151", qty:22,  sev:"Minor" },
    { code:"D08", name:"Stator lamination burr",   process:"pillow", product:"X4156", qty:15,  sev:"Minor" },
  ];

  /* control-chart stats: X-chart for daily FPY samples */
  function spcStats(series, target){
    const n = series.length;
    const cl = series.reduce((a,b)=>a+b,0)/n;
    const sd = Math.sqrt(series.reduce((s,v)=>s+(v-cl)*(v-cl),0)/Math.max(1,n-1));
    return { cl, sd, ucl: cl + 3*sd, lcl: Math.max(0, cl - 3*sd), target };
  }

  /* Western Electric rules — earlier sensitivity than the ±3σ rule alone.
     Returns map: index -> ["R1","R3",…]. */
  function westernElectric(series, st){
    const { cl, sd, ucl, lcl } = st;
    const z = series.map(v => sd ? (v - cl)/sd : 0);
    const hits = {};
    const add = (i, r) => { (hits[i] = hits[i] || []).push(r); };
    const above = z.map(v => v > 0), below = z.map(v => v < 0);
    for (let i = 0; i < series.length; i++){
      // R1: beyond 3σ (kept for completeness — chart already rings these)
      if (series[i] > ucl || series[i] < lcl) add(i, "R1");
      // R2: 2 of 3 consecutive beyond 2σ, same side
      for (const side of [1, -1]){
        const win = [i-2, i-1, i].filter(j => j >= 0);
        if (win.length === 3){
          const cnt = win.filter(j => side*z[j] > 2).length;
          const mid = win[1];
          if (cnt >= 2 && side*z[mid] > 2) add(i, "R2");
        }
      }
      // R3: 4 of 5 consecutive beyond 1σ, same side
      for (const side of [1, -1]){
        const win = [i-4, i-3, i-2, i-1, i].filter(j => j >= 0);
        if (win.length === 5){
          const cnt = win.filter(j => side*z[j] > 1).length;
          if (cnt >= 4 && side*z[i] > 1) add(i, "R3");
        }
      }
      // R4: 8 consecutive on one side of CL
      if (i >= 7){
        const win = z.slice(i-7, i+1);
        if (win.every(v => v > 0) || win.every(v => v < 0)) add(i, "R4");
      }
    }
    return hits;
  }
  function spcSamples(lotId){
    const n = 30;
    const labels = labelsForSeries(n);
    const lot = lotId && lotId !== "ALL" ? LOTS.find(l => l.id === lotId) : null;
    const prods = lot
      ? PRODUCTS.filter(p => (PRODUCT_LOTS[p.id] || []).includes(lot.id))
      : PRODUCTS.filter(p => STATE.product==="ALL" || p.id===STATE.product);
    const stages = lot ? [lot.stage] : STAGES.filter(s => STATE.stage==="ALL" || s===STATE.stage);
    /* deterministic per-lot signature — same lot always renders the same series */
    const lotSeed = lot ? lot.id.charCodeAt(2)*13 + lot.id.charCodeAt(3)*29 + lot.id.charCodeAt(1) : 0;
    const lotOff = lot ? ({P1:-1.1,P2:-0.6,EVT:-0.25,DVT:0.1,PVT:0.2}[lot.stage]||0) + ((lotSeed % 5) - 2) * 0.16 : 0;
    const data = [];
    for (let i=0;i<n;i++){
      let v = 96.4 + (i/n)*0.35;                 // gentle improving drift
      v += Math.sin(i/3.1)*0.32;                 // natural variation
      if (lot){
        /* lot-level view: family curve + lot signature + its own shifted echoes of the causes */
        v += lotOff + Math.sin(i/2.1 + lotSeed % 7)*0.22 + (((lotSeed + i*7) % 9) - 4)*0.06;
        const ev = { 7:-1.9, 16:-1.2, 23:-2.4, 28:+0.7 };
        for (const k in ev){ if (i === (Number(k) + lotSeed % 5) % n) v += ev[k]; }
      } else {
        // inject realistic special-cause events
        if (i===7)  v -= 1.9;                    // X4152 acoustic event
        if (i===16) v -= 1.2;                    // torque drift week
        if (i===23) v -= 2.4;                    // press-fit OOS spike
        if (i===28) v += 0.7;
      }
      const pb = prods.length ? prods.reduce((s,p)=>s+({P1:-3.2,P2:-1.8,EVT:-1.2,DVT:-0.4,PVT:0}[p.stage]||0),0)/prods.length : 0;
      data.push(+(v + pb).toFixed(2));
    }
    return { labels, data, stages, lot: lot ? lot.id : null };
  }
  function labelsForSeries(n){
    const out = [];
    for (let i = n-1; i >= 0; i--){
      const d = new Date(TODAY); d.setDate(d.getDate()-i);
      out.push(`${d.getMonth()+1}/${d.getDate()}`);
    }
    return out;
  }

  /* ---------- persistence (manage layer: edits survive reload) ---------- */
  const LS_KEY = "fdb-overrides-v1";
  const overrides = (() => {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || "{}"); } catch(e){ return {}; }
  })();

  /* baseline snapshots for clean reset (deep copies of seed data) */
  const BASELINE = {
    claims: JSON.parse(JSON.stringify(CLAIMS)),
    faca:   JSON.parse(JSON.stringify(FACA)),
    projects: JSON.parse(JSON.stringify(PROJECTS.map(p => ({ id:p.id, tasks:p.tasks })))),
    lotTasks: JSON.parse(JSON.stringify(LOT_TASKS)),
  };

  (function applyOverrides(){
    (overrides.claims || []).forEach(o => { const c = CLAIMS.find(x=>x.id===o.id); if (c) Object.assign(c, o); });
    (overrides.claimsAdd || []).forEach(c => { if (!CLAIMS.find(x=>x.id===c.id)) CLAIMS.push(c); });
    (overrides.faca || []).forEach(o => { const f = FACA.find(x=>x.id===o.id); if (f) Object.assign(f, o); });
    (overrides.projects || []).forEach(o => {
      const p = PROJECTS.find(x=>x.id===o.id);
      if (p && Array.isArray(o.tasks)) p.tasks = o.tasks.map(t => ({ ...t }));
    });
    (overrides.lotTasks || []).forEach(o => {
      if (LOT_TASKS[o.id] && Array.isArray(o.phases)) LOT_TASKS[o.id] = o.phases.map(t => ({ ...t }));
    });
  })();

  function saveOverrides(){ try { localStorage.setItem(LS_KEY, JSON.stringify(overrides)); } catch(e){} }

  function mergeOverride(listName, id, patch){
    overrides[listName] = overrides[listName] || [];
    let o = overrides[listName].find(x=>x.id===id);
    if (!o){ o = { id }; overrides[listName].push(o); }
    Object.assign(o, patch);
    saveOverrides();
  }
  function updateClaim(id, patch){
    const c = CLAIMS.find(x=>x.id===id); if (!c) return false;
    Object.assign(c, patch); mergeOverride("claims", id, patch); return true;
  }
  function addClaim(claim){
    CLAIMS.push(claim);
    overrides.claimsAdd = overrides.claimsAdd || [];
    overrides.claimsAdd.push(claim);
    saveOverrides(); return claim;
  }
  function updateFaca(id, patch){
    const f = FACA.find(x=>x.id===id); if (!f) return false;
    Object.assign(f, patch); mergeOverride("faca", id, patch); return true;
  }
  function updateProjectTasks(prjId, tasks){
    const p = PROJECTS.find(x=>x.id===prjId); if (!p) return false;
    p.tasks = tasks.map(t => ({ ...t }));
    mergeOverride("projects", prjId, { tasks: p.tasks });
    return true;
  }
  function updateLotTasks(lotId, phases){
    if (!LOT_TASKS[lotId]) return false;
    LOT_TASKS[lotId] = phases.map(t => ({ ...t }));
    mergeOverride("lotTasks", lotId, { phases: LOT_TASKS[lotId] });
    return true;
  }
  function resetOverrides(){
    CLAIMS.length = 0; BASELINE.claims.forEach(c => CLAIMS.push({ ...c }));
    FACA.length = 0;   BASELINE.faca.forEach(f => FACA.push({ ...f }));
    PROJECTS.forEach(p => {
      const b = BASELINE.projects.find(x=>x.id===p.id);
      if (b) p.tasks = b.tasks.map(t => ({ ...t }));
    });
    Object.keys(LOT_TASKS).forEach(id => {
      const b = BASELINE.lotTasks[id];
      if (b) LOT_TASKS[id] = b.map(t => ({ ...t }));
    });
    Object.keys(overrides).forEach(k => delete overrides[k]);
    saveOverrides();
  }

  /* ---------- dynamic alert feed (derived, always current) ---------- */
  const SYSTEM_ALERTS = [
    { sev:"bad",  type:"spc",    txt:"X4152 RHS FPY dipped 2.1σ below DVT control limit at Fan Assembly" },
    { sev:"warn", type:"system", txt:"X4155 P1 UPH 38% below line-rate target — tooling pilot" },
    { sev:"good", type:"system", txt:"X4154 PVT shipment achievement 99.6% — 3 weeks running" },
    { sev:"warn", type:"system", txt:"Fan Test Accessory fixture v3 re-design slipping 4 days (X4153 EVT)" },
  ];
  function dynamicAlerts(){
    const out = [];
    const todayIso = iso(TODAY);
    CLAIMS.forEach(c => {
      if (c.severity === "Critical") out.push({ sev:"bad",  type:"claim", txt:`${c.id} Critical claim open — ${c.customer} containment due ${c.eta}` });
      else if (c.status === "Containment") out.push({ sev:"warn", type:"claim", txt:`${c.id} ${c.severity} claim in containment — ${c.customer}, ETA ${c.eta}` });
    });
    FACA.forEach(f => {
      if (f.status === "Overdue") out.push({ sev:"warn", type:"faca", txt:`${f.id} FACA overdue — ${f.title} (${f.product} ${f.stage})` });
    });
    PROJECTS.forEach(p => p.tasks.forEach(t => {
      if (t.done < 100 && t.e && t.e < todayIso) out.push({ sev:"bad", type:"phase", txt:`${p.product} task overdue: ${t.name} (ended ${t.e} at ${t.done}%)` });
    }));
    /* overdue lot phases (Gantt at-risk rows) */
    Object.keys(LOT_TASKS).forEach(lotId => {
      const lot = LOTS.find(l => l.id === lotId); if (!lot) return;
      (LOT_TASKS[lotId] || []).forEach(t => {
        if (t.done < 100 && t.e && t.e < todayIso) out.push({ sev:"bad", type:"phase", txt:`${lotId} ${lot.stage} phase overdue: ${t.name} (ended ${t.e} at ${t.done}%)` });
      });
    });
    /* live SPC signals from the current sample window */
    try {
      const { data } = spcSamples();
      const st = spcStats(data);
      const ooc = data.filter(v => v > st.ucl || v < st.lcl).length;
      const we = westernElectric(data, st);
      const weN = Object.keys(we).length;
      if (ooc) out.push({ sev:"bad", type:"spc", txt:`SPC: ${ooc} point(s) beyond ±3σ on the FPY control chart — investigate special cause` });
      if (weN) out.push({ sev:"warn", type:"spc", txt:`SPC: ${weN} Western Electric signal(s) — early drift before a breach` });
    } catch(e){}
    return out;
  }
  function allAlerts(){ return dynamicAlerts().concat(SYSTEM_ALERTS); }

  /* ---------- public API ---------- */
  return {
    STAGES, SIDES, RANGES, LOTS, PRODUCT_LOTS, LOT_KPI, LOT_PHASES, LOT_TASKS,
    PROCESSES, PRODUCTS, KPIS, KPI_SERIES,
    PRODUCT_KPI, PROCESS_KPI, SIDE_KPI, SHIPMENTS, CLAIMS, FACA,
    PROJECTS, PIPELINE, ALERTS, TODAY,
    updateClaim, addClaim, updateFaca, updateProjectTasks, updateLotTasks, resetOverrides, LS_KEY,
    allAlerts, DEFECTS, spcStats, spcSamples, westernElectric,
    fmtW: n => n >= 1000 ? (n/1000).toFixed(1).replace(/\.0$/,"") + "k" : String(n),
  };
})();
