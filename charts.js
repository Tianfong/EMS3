"use strict";
/* Dependency-free SVG chart helpers */

const CHARTS = (() => {
  const fmt = DB.fmtW;

  function fmtY(v, f, dec){
    if (f) return f(v);
    if (Math.abs(v) >= 1000) return fmt(v);
    if (dec) return v.toFixed(1);
    return Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(1);
  }
  /* tight ranges need a decimal or every tick collapses to the same string */
  const autoDec = (lo, hi) => (hi - lo) < 5 && Math.abs(hi) < 1000;

  /* simple trailing moving average (nulls until the window fills) */
  function movingAvg(data, win){
    const out = [];
    for (let i=0; i<data.length; i++){
      if (i < win-1){ out.push(null); continue; }
      let s = 0;
      for (let j=i-win+1; j<=i; j++) s += data[j];
      out.push(+(s/win).toFixed(2));
    }
    return out;
  }

  /* trailing min/max envelope over a rolling window — the band that shows
     how wide the process has been swinging, not just where it landed */
  function envelope(data, win){
    const lo = [], hi = [];
    for (let i=0; i<data.length; i++){
      if (i < win-1){ lo.push(data[0]); hi.push(data[0]); continue; }
      let a = Infinity, b = -Infinity;
      for (let j=i-win+1; j<=i; j++){ if (data[j] < a) a = data[j]; if (data[j] > b) b = data[j]; }
      lo.push(+a.toFixed(2)); hi.push(+b.toFixed(2));
    }
    return { lo, hi };
  }

  /* line/area chart with hover crosshair
     opts.extras — [{data, color, dash, label}] overlay lines
     opts.band   — {lo:[], hi:[], color} envelope drawn behind the series   */
  function lineChart(el, opts){
    const pts = opts.data;
    const extras = (opts.extras || []).filter(e => e && e.data && e.data.length);
    const band = opts.band && opts.band.lo && opts.band.lo.length ? opts.band : null;
    const W = 720, H = 240, padL = 40, padR = 14, padT = 16, padB = 26;
    const iw = W - padL - padR, ih = H - padT - padB;
    const all = [...pts, ...extras.flatMap(e => e.data), ...(band ? [...band.lo, ...band.hi] : [])]
      .filter(v => typeof v === "number" && isFinite(v));
    const min = Math.min(...all), max = Math.max(...all);
    const range = (max - min) || 1;
    const lo = min - range*0.15, hi = max + range*0.15;
    const X = i => padL + i*iw/(pts.length-1);
    const Y = v => padT + (1 - (v-lo)/(hi-lo))*ih;

    const css = getComputedStyle(document.documentElement);
    const acc  = css.getPropertyValue("--acc").trim()  || "#38bdf8";
    const txt3 = css.getPropertyValue("--txt3").trim() || "#64748b";

    const toPts = pts.map((v,i)=>[X(i), Y(v)]);
    const d = "M" + toPts.map(p=>p[0].toFixed(1)+","+p[1].toFixed(1)).join(" L");
    const areaD = `M${X(0).toFixed(1)},${(padT+ih).toFixed(1)} `
      + toPts.map(p=>`L${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ")
      + ` L${X(pts.length-1).toFixed(1)},${(padT+ih).toFixed(1)} Z`;

    const gid = "grad" + Math.random().toString(36).slice(2,8);
    let gridLines = "", yLabels = "";
    for (let g=0; g<=3; g++){
      const v = lo + (hi-lo)*g/3;
      const y = Y(v);
      const dec = autoDec(lo, hi);
      gridLines += `<line x1="${padL}" y1="${y}" x2="${W-padR}" y2="${y}" stroke="var(--line)" stroke-dasharray="3 5"/>`;
      yLabels  += `<text x="${padL-7}" y="${(y+3).toFixed(1)}" text-anchor="end" font-size="9" fill="${txt3}" class="mono">${fmtY(v, opts.fmt, dec)}</text>`;
    }
    let xLabels = "";
    const step = Math.max(1, Math.ceil(pts.length/8));
    pts.forEach((v,i) => {
      if (i % step) return;
      xLabels += `<text x="${X(i).toFixed(1)}" y="${H-8}" text-anchor="middle" font-size="9" fill="${txt3}" class="mono">${opts.labels[i] ?? i}</text>`;
    });

    /* an overlay may start partway in (a moving average has nulls until its
       window fills) — emit one sub-path per run of real values rather than
       a single path with holes in it */
    const line = (data) => {
      const segs = [];
      let cur = [];
      data.forEach((v, i) => {
        if (typeof v !== "number" || !isFinite(v)){ if (cur.length) segs.push(cur); cur = []; return; }
        cur.push([X(i), Y(v)]);
      });
      if (cur.length) segs.push(cur);
      return segs.map(s => "M" + s.map(p => p[0].toFixed(1)+","+p[1].toFixed(1)).join(" L")).join(" ");
    };
    const bandD = band ? [
      "M" + band.lo.map((v,i)=>X(i).toFixed(1)+","+Y(v).toFixed(1)).join(" L"),
      "L" + band.hi.slice().reverse().map((v,i)=>X(band.hi.length-1-i).toFixed(1)+","+Y(v).toFixed(1)).join(" L"),
      "Z",
    ].join(" ") : "";
    const extrasD = extras.map(e =>
      `<path d="${line(e.data)}" fill="none" stroke="${e.color}" stroke-width="${e.width||1.6}" ${e.dash?`stroke-dasharray="${e.dash}"`:""} opacity=".85" stroke-linejoin="round" stroke-linecap="round"><title>${esc(e.label||"")}</title></path>`).join("");

    el.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block">
        <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="${acc}" stop-opacity=".30"/>
          <stop offset="1" stop-color="${acc}" stop-opacity="0"/>
        </linearGradient></defs>
        ${gridLines}${yLabels}${xLabels}
        ${bandD ? `<path d="${bandD}" fill="${band.color || "var(--txt3)"}" opacity=".13"/>` : ""}
        ${extrasD}
        <path d="${areaD}" fill="url(#${gid})"/>
        <path d="${d}" fill="none" stroke="${acc}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>
        ${opts.target != null ? `<line x1="${padL}" x2="${W-padR}" y1="${Y(opts.target)}" y2="${Y(opts.target)}" stroke="var(--good)" stroke-dasharray="6 4" stroke-width="1.4" opacity=".8"/><text x="${W-padR}" y="${Y(opts.target)-5}" text-anchor="end" font-size="9" fill="var(--good)" class="mono">target ${opts.target}</text>` : ""}
        <circle class="hd" r="4.5" fill="${acc}" stroke="var(--panel-solid)" stroke-width="2" opacity="0"/>
        <line class="hl" y1="${padT}" y2="${padT+ih}" stroke="var(--txt3)" stroke-dasharray="3 4" opacity="0"/>
        <rect class="hr" x="${padL}" y="${padT}" width="${iw}" height="${ih}" fill="transparent"/>
      </svg>`;

    const svg = el.querySelector("svg");
    const dot = el.querySelector(".hd"), hline = el.querySelector(".hl"), hit = el.querySelector(".hr");
    hit.onmousemove = e => {
      const r = svg.getBoundingClientRect();
      const x = (e.clientX - r.left)/r.width*W;
      const i = Math.max(0, Math.min(pts.length-1, Math.round((x-padL)/(iw/(pts.length-1)))));
      dot.setAttribute("cx", X(i)); dot.setAttribute("cy", Y(pts[i])); dot.setAttribute("opacity","1");
      hline.setAttribute("x1", X(i)); hline.setAttribute("x2", X(i)); hline.setAttribute("opacity",".6");
      if (opts.onHover) opts.onHover(i);
    };
    hit.onmouseleave = () => { dot.setAttribute("opacity","0"); hline.setAttribute("opacity","0"); if (opts.onOut) opts.onOut(); };
  }

  function spark(el, data, color){
    const W=90,H=30,pad=2.5;
    const min=Math.min(...data), max=Math.max(...data), range=(max-min)||1;
    const pts = data.map((v,i)=>[pad+i*(W-2*pad)/(data.length-1), H-pad-(v-min)/range*(H-2*pad)]);
    const d = "M"+pts.map(p=>p[0].toFixed(1)+","+p[1].toFixed(1)).join(" L");
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:100%;display:block">
      <path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round"/>
      <circle cx="${pts[pts.length-1][0]}" cy="${pts[pts.length-1][1]}" r="2.4" fill="${color}"/>
    </svg>`;
  }

  function donut(el, segs, centerTop, centerSub){
    const total = segs.reduce((s,x)=>s+x.v,0) || 1;
    const R=52, C=2*Math.PI*R;
    let off = 0, arcs = "";
    segs.forEach(s => {
      const frac = s.v/total, len = Math.max(frac*C - 2.5, 1.5);
      arcs += `<circle r="${R}" cx="75" cy="75" fill="none" stroke="${s.color}" stroke-width="17"
        stroke-dasharray="${len.toFixed(1)} ${(C-len).toFixed(1)}" stroke-dashoffset="${(-off).toFixed(1)}"
        stroke-linecap="butt"><title>${s.label}: ${s.v}</title></circle>`;
      off += frac*C;
    });
    el.innerHTML = `
      <svg viewBox="0 0 150 150" style="width:100%;height:100%;display:block">
        <circle r="${R}" cx="75" cy="75" fill="none" stroke="var(--line)" stroke-width="17" opacity=".35"/>
        ${arcs}
      </svg>
      <div class="donut-c"><div><b>${centerTop}</b><span>${centerSub}</span></div></div>`;
  }

  /* SPC control chart: CL/UCL/LCL, ±3σ, violation dots, trend target */
  function controlChart(el, opts){
    const pts = opts.data;
    const W = 720, H = 250, padL = 40, padR = 14, padT = 18, padB = 26;
    const iw = W - padL - padR, ih = H - padT - padB;
    const cl = opts.cl, ucl = opts.ucl, lcl = opts.lcl;
    const bl = opts.baseline ? (Array.isArray(opts.baseline) ? { data: opts.baseline } : opts.baseline) : null;
    const hi = Math.max(ucl, ...pts, ...(bl ? bl.data : [])) + (ucl - cl) * 0.35;
    const lo = Math.min(lcl, ...pts, ...(bl ? bl.data : [])) - (cl - lcl) * 0.35;
    const X = i => padL + i*iw/(pts.length-1);
    const Y = v => padT + (1 - (v-lo)/(hi-lo))*ih;
    const css = getComputedStyle(document.documentElement);
    const acc  = css.getPropertyValue("--acc").trim()  || "#38bdf8";
    const bad  = css.getPropertyValue("--bad").trim()  || "#f87171";
    const txt3 = css.getPropertyValue("--txt3").trim() || "#64748b";
    const ooc  = pts.map((v,i) => (v > ucl || v < lcl) ? i : -1).filter(i => i >= 0);
    const we   = opts.we || {};
    const weIdx = Object.keys(we).map(Number).filter(i => !ooc.includes(i));

    const d = "M" + pts.map((v,i) => X(i).toFixed(1)+","+Y(v).toFixed(1)).join(" L");
    const dec = autoDec(lo, hi);
    const lim = (v, color, label) =>
      `<line x1="${padL}" x2="${W-padR}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="${color}" ${color==="var(--good)"?"stroke-dasharray=\"6 4\"":"stroke-dasharray=\"4 3\""} opacity=".85"/>
       <text x="${W-padR}" y="${(Y(v)-4).toFixed(1)}" text-anchor="end" font-size="9" fill="${color}" class="mono">${label}</text>`;
    /* y ticks share the lineChart precision rule so CL/UCL/LCL never duplicate a label */
    let yTicks = "";
    for (let g=0; g<=4; g++){
      const v = lo + (hi-lo)*g/4;
      yTicks += `<line x1="${padL}" x2="${W-padR}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="var(--line)" stroke-dasharray="3 5" opacity="${dec ? ".75" : ".5"}"/>
        <text x="${padL-7}" y="${(Y(v)+3).toFixed(1)}" text-anchor="end" font-size="9" fill="${txt3}" class="mono">${fmtY(v, opts.fmt, dec)}</text>`;
    }

    let xLabels = "";
    const step = Math.max(1, Math.ceil(pts.length/8));
    pts.forEach((v,i) => { if (!(i % step)) xLabels += `<text x="${X(i).toFixed(1)}" y="${H-8}" text-anchor="middle" font-size="9" fill="${txt3}" class="mono">${opts.labels[i] ?? i}</text>`; });

    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block">
      ${yTicks}
      ${lim(ucl, bad, "UCL " + fmtY(ucl, opts.fmt, dec))}
      ${lim(cl, "var(--good)", "CL " + fmtY(cl, opts.fmt, dec))}
      ${lim(lcl, bad, "LCL " + fmtY(lcl, opts.fmt, dec))}
      ${xLabels}
      ${bl ? `<path d="${"M"+bl.data.map((v,i) => X(i).toFixed(1)+","+Y(v).toFixed(1)).join(" L")}" fill="none" stroke="${txt3}" stroke-width="1.5" stroke-dasharray="5 4" opacity=".7"/>
      <text x="${padL+4}" y="${padT+9}" font-size="8.5" fill="${txt3}">dashed = product baseline</text>` : ""}
      <path d="${d}" fill="none" stroke="${acc}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
      ${ooc.map(i => `<circle cx="${X(i).toFixed(1)}" cy="${Y(pts[i]).toFixed(1)}" r="5" fill="none" stroke="${bad}" stroke-width="2"/>
        <circle cx="${X(i).toFixed(1)}" cy="${Y(pts[i]).toFixed(1)}" r="2" fill="${bad}"/>`).join("")}
      ${weIdx.map(i => `<circle cx="${X(i).toFixed(1)}" cy="${Y(pts[i]).toFixed(1)}" r="6.5" fill="none" stroke="var(--warn)" stroke-width="1.6" stroke-dasharray="2.5 2" opacity=".95"/>`).join("")}
      <circle class="hd" r="4" fill="${acc}" stroke="var(--panel-solid)" stroke-width="2" opacity="0"/>
      <line class="hl" y1="${padT}" y2="${padT+ih}" stroke="${txt3}" stroke-dasharray="3 4" opacity="0"/>
      <rect class="hr" x="${padL}" y="${padT}" width="${iw}" height="${ih}" fill="transparent"/>
    </svg>`;

    const svg = el.querySelector("svg"), dot = el.querySelector(".hd"), hline = el.querySelector(".hl"), hit = el.querySelector(".hr");
    hit.onmousemove = e => {
      const r = svg.getBoundingClientRect();
      const x = (e.clientX - r.left)/r.width*W;
      const i = Math.max(0, Math.min(pts.length-1, Math.round((x-padL)/(iw/(pts.length-1)))));
      dot.setAttribute("cx", X(i)); dot.setAttribute("cy", Y(pts[i])); dot.setAttribute("opacity","1");
      hline.setAttribute("x1", X(i)); hline.setAttribute("x2", X(i)); hline.setAttribute("opacity",".6");
      if (opts.onHover) opts.onHover(i, ooc.includes(i), we[i]);
    };
    hit.onmouseleave = () => { dot.setAttribute("opacity","0"); hline.setAttribute("opacity","0"); if (opts.onOut) opts.onOut(); };
    return { ooc, outOfControl: ooc.length };
  }

  /* Pareto: sorted bars + cumulative % line */
  function pareto(el, items){
    const W = 720, H = 250, padL = 40, padR = 44, padT = 18, padB = 58;
    const iw = W - padL - padR, ih = H - padT - padB;
    const css = getComputedStyle(document.documentElement);
    const acc = css.getPropertyValue("--acc").trim() || "#38bdf8";
    const bad = css.getPropertyValue("--bad").trim() || "#f87171";
    const txt3 = css.getPropertyValue("--txt3").trim() || "#64748b";
    const total = items.reduce((s,x)=>s+x.v,0) || 1;
    let cum = 0;
    const pts = items.map(it => { cum += it.v; return cum/total*100; });
    const maxV = Math.max(...items.map(i=>i.v)) * 1.1;
    const dec = autoDec(0, maxV);   /* close-count bars need a decimal or labels collide */
    const X = i => padL + (i+0.5)*iw/items.length;
    const YL = v => padT + (1 - v/maxV)*ih;
    const YR = p => padT + (1 - p/100)*ih;
    const line = "M" + pts.map((p,i) => X(i).toFixed(1)+","+YR(p).toFixed(1)).join(" L");
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block">
      ${[0,25,50,75,100].map(p => `<line x1="${padL}" x2="${W-padR}" y1="${YR(p).toFixed(1)}" y2="${YR(p).toFixed(1)}" stroke="var(--line)" stroke-dasharray="3 5"/>
        <text x="${W-padR+6}" y="${(YR(p)+3).toFixed(1)}" font-size="9" fill="${txt3}" class="mono">${p}%</text>`).join("")}
      ${items.map((it,i) => {
        const y = YL(it.v), h = padT+ih - y;
        const color = (it.color || (i===0 ? bad : acc));
        return `<rect x="${(X(i)-Math.min(26,iw/items.length*0.32)).toFixed(1)}" y="${y.toFixed(1)}" width="${(Math.min(52,iw/items.length*0.64)).toFixed(1)}" height="${Math.max(h,1).toFixed(1)}" rx="4" fill="${color}" opacity=".92"><title>${esc(it.label)}: ${it.v} (${(it.v/total*100).toFixed(1)}%)</title></rect>
          <text x="${X(i).toFixed(1)}" y="${(y-5).toFixed(1)}" text-anchor="middle" font-size="9.5" fill="var(--txt2)" class="mono">${fmtY(it.v, null, dec)}</text>`;
      }).join("")}
      <path d="${line}" fill="none" stroke="var(--pur)" stroke-width="2" stroke-linecap="round"/>
      ${pts.map((p,i) => `<circle cx="${X(i).toFixed(1)}" cy="${YR(p).toFixed(1)}" r="3" fill="var(--pur)"/>`).join("")}
      ${items.map((it,i) => `<text x="${X(i).toFixed(1)}" y="${H-40}" font-size="9" fill="${txt3}" transform="rotate(-28 ${X(i).toFixed(1)} ${H-40})" text-anchor="end">${esc(it.label.length>16?it.label.slice(0,15)+"…":it.label)}</text>`).join("")}
    </svg>`;
  }

  return { lineChart, spark, donut, controlChart, pareto, movingAvg, envelope, autoDec };
})();
