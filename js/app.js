/* app.js — Lunar & Planetary Phase Simulator interface. */
(function () {
  "use strict";
  const A = window.Astro, P = window.Phase;
  const $ = (id) => document.getElementById(id);
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;

  const MAX_DIAM = { mercury: 13.0, venus: 66.0, mars: 25.1, jupiter: 50.1 };      // arcsec, closest approach
  const SYNODIC = { mercury: 115.88, venus: 583.92, mars: 779.94, jupiter: 398.88 };  // days

  const state = {
    mode: "moon",
    jd: A.julianDay(new Date()),
    planet: "venus",
    orient: "north",
    lat: null, lon: null,
    trueSize: true,
    playing: false,
    speed: 1,
    exo: null, exoId: "kepler7b", exoPhase: 0.35, exoPlaying: false, noise: false, sigma: 20,
  };

  // ------------------------------------------------------------ helpers
  const fmtDate = (jd, withTime = true) => {
    const d = A.fromJulianDay(jd);
    const s = d.toISOString();
    return withTime ? `${s.slice(0, 10)} ${s.slice(11, 16)} UTC` : s.slice(0, 10);
  };
  const shortDate = (jd) => A.fromJulianDay(jd).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  const pct = (k) => `${(k * 100).toFixed(1)} %`;
  const sig = (x, s = 3) => Number(x.toPrecision(s)).toLocaleString("en");

  function setupCanvas(cv) {
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    }
    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h, dpr };
  }

  // ------------------------------------------------------------ renderer
  // Major lunar maria: selenographic latitude, longitude (east +), radius (deg)
  const MARIA = [
    [33, -16, 17], [28, 17, 10], [8.5, 31, 12], [17, 59, 7.5], [-8, 51, 9.5], [-15, 35, 6.5],
    [-21, -17, 10], [18, -57, 22], [-24, -39, 6.5], [56, 1, 7], [56, -20, 6], [56, 22, 6], [-2, -15, 5],
  ].map(([la, lo, r]) => ({ x: Math.cos(la * D2R) * Math.sin(lo * D2R), y: Math.sin(la * D2R), z: Math.cos(la * D2R) * Math.cos(lo * D2R), c: Math.cos(r * D2R), r }));

  function albedoAt(kind, u, v, w) {
    if (kind === "moon") {
      let a = 1;
      for (const m of MARIA) {
        const d = u * m.x + v * m.y + w * m.z;                 // cos of angular distance
        // soft-edged darker plains; a gentle fall-off avoids hard "bubble" outlines
        const edge = 0.09;
        if (d > m.c - edge) a = Math.min(a, 0.74 + 0.26 * Math.min(1, Math.max(0, (m.c - d) / edge + 0.35) ** 2));
      }
      return a;
    }
    if (kind === "jupiter") return 0.86 + 0.14 * Math.sin(v * 17) * Math.cos(v * 5);
    if (kind === "mars") return 0.9 + 0.1 * Math.sin(u * 7 + v * 3);
    return 1;
  }

  /** Draw an illuminated sphere. `sunDir` is the angle of the Sun on screen in the
   *  north-up frame (0 = up, increasing towards the left/east). `rot` turns the
   *  whole picture (radians, clockwise). */
  function drawDisk(cv, o) {
    const { ctx, w, h, dpr } = setupCanvas(cv);
    ctx.clearRect(0, 0, w, h);
    const Rmax = Math.min(h * 0.38, w * 0.36);
    const R = Math.max(6, Rmax * (o.scale ?? 1));
    const size = Math.ceil(2 * R * dpr) + 2;
    const img = ctx.createImageData(size, size);
    const du = -Math.sin(o.sunDir), dv = Math.cos(o.sunDir);
    const [cr, cg, cb] = o.color;
    const c = size / 2, Rp = R * dpr;
    for (let y = 0; y < size; y++) {
      const v = (c - (y + 0.5)) / Rp;
      for (let x = 0; x < size; x++) {
        const u = ((x + 0.5) - c) / Rp;
        const r2 = u * u + v * v;
        if (r2 > 1) continue;
        const wz = Math.sqrt(1 - r2);
        const s = P.shade(u, v, o.alpha, du, dv, o.law);
        const alb = albedoAt(o.kind, u, v, wz);
        let b = s > 0 ? Math.min(1, 0.06 + 0.98 * s) * alb : 0;
        if (o.earthshine) b = Math.max(b, 0.05 * alb);
        const edge = Math.min(1, (1 - Math.sqrt(r2)) * Rp);   // anti-aliased limb
        const k = (y * size + x) * 4;
        img.data[k] = cr * b + 14 * (1 - b); img.data[k + 1] = cg * b + 22 * (1 - b); img.data[k + 2] = cb * b + 38 * (1 - b);
        // the unlit side fades into the sky (a faint outline remains for orientation)
        img.data[k + 3] = 255 * edge * (b > 0.02 || o.earthshine ? 1 : 0.55);
      }
    }
    const off = document.createElement("canvas");
    off.width = off.height = size;
    off.getContext("2d").putImageData(img, 0, 0);
    const cx = w / 2, cy = h / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(o.rot || 0);
    ctx.drawImage(off, -size / (2 * dpr), -size / (2 * dpr), size / dpr, size / dpr);
    // direction labels
    ctx.fillStyle = "rgba(201,214,234,0.75)";
    ctx.font = "12px 'IBM Plex Sans', system-ui, sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    if (o.compass) {
      const L = Rmax + 22;
      ctx.fillText("N", 0, -L); ctx.fillText("S", 0, L); ctx.fillText("E", -L, 0); ctx.fillText("W", L, 0);
    }
    // arrow towards the Sun
    const L2 = Math.max(R + 26, 60);
    const ax = du * L2, ay = -dv * L2;
    ctx.strokeStyle = "rgba(232,163,61,0.85)"; ctx.fillStyle = "rgba(232,163,61,0.95)"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(du * (R + 8), -dv * (R + 8)); ctx.lineTo(ax, ay); ctx.stroke();
    ctx.beginPath(); ctx.arc(ax + du * 9, ay - dv * 9, 6, 0, 2 * Math.PI); ctx.fill();
    ctx.restore();
    if (o.zenith) {
      ctx.fillStyle = "rgba(201,214,234,0.75)";
      ctx.font = "12px 'IBM Plex Sans', system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("↑ zenith", cx, 18);
      ctx.fillText("horizon ↓", cx, h - 30);
    }
    return R;
  }

  // ------------------------------------------------------------ plotting
  function theme() {
    return { paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
      font: { family: "IBM Plex Sans, system-ui, sans-serif", color: css("--ink"), size: 12 } };
  }
  function axis(title, extra) {
    const g = css("--rule"), m = css("--muted");
    return Object.assign({ title: { text: title, font: { size: 12, color: m } }, gridcolor: g, zerolinecolor: g,
      linecolor: g, tickfont: { color: m } }, extra || {});
  }
  /** Click anywhere in the plot area to call fn(x) (drags are ignored, so zoom still works). */
  function bindPlotClick(el, fn) {
    if (el._clickBound) return;
    let down = null;
    el.addEventListener("mousedown", (e) => { down = [e.clientX, e.clientY]; });
    el.addEventListener("click", (e) => {
      const drag = el.querySelector(".nsewdrag");
      if (!drag || !down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
      const r = drag.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
      const xa = el._fullLayout.xaxis;
      fn(xa.p2d(e.clientX - r.left));
    });
    el._clickBound = true;
  }
  const cursor = (x, color) => ({ type: "line", xref: "x", yref: "paper", x0: x, x1: x, y0: 0, y1: 1,
    line: { color: color || css("--accent"), width: 1.6, dash: "dot" } });
  function moveCursor(id, x) {
    const el = $(id);
    if (!el || !el.layout || !el.layout.shapes) return;
    const shapes = el.layout.shapes.slice();
    shapes[0] = cursor(x);
    Plotly.relayout(el, { shapes });
  }
  const isoX = (jd) => A.fromJulianDay(jd).toISOString().replace("T", " ").slice(0, 19);
  const jdFromIso = (s) => A.julianDay(new Date(String(s).replace(" ", "T") + (String(s).length <= 10 ? "T00:00:00Z" : "Z")));

  // --------------------------------------------------------------- readouts
  function setReadouts(name, sub, rows, caption) {
    $("phaseName").textContent = name;
    $("phaseSub").textContent = sub;
    $("readouts").innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
    $("skyCaption").textContent = caption;
  }

  function orientation(jd, bodyEq) {
    const pa = A.brightLimbAngle(A.equatorial("sun", jd), bodyEq);
    let rot = 0, caption = "North up, east left (as seen with the naked eye facing south from the northern hemisphere)";
    let alt = null;
    if (state.orient === "sky" && state.lat !== null && state.lon !== null) {
      const hz = A.horizon(jd, bodyEq, state.lat, state.lon);
      rot = hz.parallactic * D2R;
      alt = hz.altitude;
      caption = `As seen from ${state.lat.toFixed(2)}°, ${state.lon.toFixed(2)}°: zenith up. ` +
        (alt > 0 ? `Altitude ${alt.toFixed(0)}° above the horizon.` : `Below the horizon now (altitude ${alt.toFixed(0)}°).`);
    }
    return { pa, rot, caption, alt };
  }

  // ------------------------------------------------------------------ Moon
  function renderMoon(full) {
    const ph = A.moonPhase(state.jd);
    const eq = A.equatorial("moon", state.jd);
    const o = orientation(state.jd, eq);
    drawDisk($("skyCanvas"), { alpha: ph.phaseAngle * D2R, sunDir: o.pa * D2R, rot: o.rot, law: "lommel",
      color: [236, 233, 225], kind: "moon", earthshine: true, compass: state.orient === "north" || o.alt === null, zenith: o.rot !== 0 });
    const age = A.moonAge(state.jd);
    const diam = 2 * Math.atan(1737.4 / ph.moon.distanceKm) * R2D * 60;
    const rows = [
      ["Illuminated", pct(ph.illuminated)],
      ["Age", `${age.toFixed(1)} days`],
      ["Phase angle", `${ph.phaseAngle.toFixed(1)}°`],
      ["Elongation from the Sun", `${ph.elongation.toFixed(1)}° ${ph.waxing ? "east" : "west"}`],
      ["Distance", `${Math.round(ph.moon.distanceKm).toLocaleString("en")} km`],
      ["Apparent diameter", `${diam.toFixed(2)}′`],
      ["Magnitude", A.moonMagnitude(ph.phaseAngle, ph.moon.distanceKm).toFixed(1)],
      ["Bright limb position angle", `${o.pa.toFixed(0)}°`],
    ];
    if (o.alt !== null) rows.push(["Altitude", `${o.alt.toFixed(1)}°`]);
    setReadouts(A.phaseName(ph.phaseLongitude), `${fmtDate(state.jd)}, ${ph.waxing ? "waxing" : "waning"}`, rows, o.caption);
    drawMonth();
    if (full || !moonWindowOk()) { plotMoon(); renderUpcoming(); }
    else { moveCursor("moonPlot", isoX(state.jd)); renderUpcoming(); }
  }

  let moonWindow = null;
  const moonWindowOk = () => moonWindow && state.jd > moonWindow[0] + 3 && state.jd < moonWindow[1] - 3;

  function plotMoon() {
    const j0 = state.jd - 15, j1 = state.jd + 15;
    moonWindow = [j0, j1];
    const xs = [], ys = [];
    for (let j = j0; j <= j1; j += 0.1) { xs.push(isoX(j)); ys.push(A.moonPhase(j).illuminated * 100); }
    const marks = { x: [], y: [], text: [] };
    for (const [t, label] of [[0, "New"], [90, "First quarter"], [180, "Full"], [270, "Last quarter"]]) {
      let s = A.findLunarPhase(j0, t, +1);
      while (s < j1) { marks.x.push(isoX(s)); marks.y.push(A.moonPhase(s).illuminated * 100); marks.text.push(`${label}<br>${fmtDate(s)}`); s = A.findLunarPhase(s + 1, t, +1); }
    }
    Plotly.react("moonPlot", [
      { x: xs, y: ys, mode: "lines", line: { color: css("--accent"), width: 2.4 }, hovertemplate: "%{x|%d %b %H:%M} UTC<br>%{y:.1f} % lit<extra></extra>" },
      { x: marks.x, y: marks.y, text: marks.text, mode: "markers", marker: { size: 9, color: css("--ink") }, hovertemplate: "%{text}<extra></extra>" },
    ], { ...theme(), margin: { l: 56, r: 12, t: 8, b: 40 }, showlegend: false, hovermode: "closest",
      xaxis: axis("", { type: "date" }), yaxis: axis("Illuminated (%)", { range: [-3, 103] }), shapes: [cursor(isoX(state.jd))] },
    { responsive: true, displaylogo: false, modeBarButtonsToRemove: ["lasso2d", "select2d"] });
    bindPlotClick($("moonPlot"), (x) => setJD(jdFromIso(x)));
  }

  function drawMonth() {
    const cv = $("monthCanvas");
    const { ctx, w, h } = setupCanvas(cv);
    ctx.clearRect(0, 0, w, h);
    const n = 29, cell = w / n, r = Math.min(cell * 0.38, 18);
    const today = Math.floor(state.jd - 0.5) + 0.5;                  // 0 h UTC of the current day
    const time = state.jd - today;
    cv._days = [];
    for (let k = 0; k < n; k++) {
      const j = today + (k - 14) + time;
      const ph = A.moonPhase(j);
      const pa = A.brightLimbAngle(A.equatorial("sun", j), A.equatorial("moon", j));
      const cx = cell * (k + 0.5), cy = 34;
      if (k === 14) { ctx.fillStyle = css("--sunken"); ctx.fillRect(cell * k + 1, 2, cell - 2, h - 4); }
      // small shaded disk
      const du = -Math.sin(pa * D2R), dv = Math.cos(pa * D2R), a = ph.phaseAngle * D2R;
      const img = ctx.createImageData(Math.ceil(2 * r), Math.ceil(2 * r));
      for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
        const u = (x + 0.5 - r) / r, v = (r - y - 0.5) / r;
        const s = P.shade(u, v, a, du, dv, "lommel");
        if (s < 0) continue;
        const b = s > 0 ? 0.15 + 0.85 * Math.min(1, s) : 0.08;
        const q = (y * img.width + x) * 4;
        img.data[q] = 20 + 215 * b; img.data[q + 1] = 28 + 205 * b; img.data[q + 2] = 46 + 180 * b; img.data[q + 3] = 255;
      }
      const off = document.createElement("canvas"); off.width = img.width; off.height = img.height;
      off.getContext("2d").putImageData(img, 0, 0);
      ctx.drawImage(off, cx - r, cy - r);
      ctx.fillStyle = k === 14 ? css("--ink") : css("--muted");
      ctx.font = `${k === 14 ? 600 : 400} 11px 'IBM Plex Sans', system-ui, sans-serif`;
      ctx.textAlign = "center";
      const d = A.fromJulianDay(j);
      ctx.fillText(String(d.getUTCDate()), cx, cy + r + 16);
      if (d.getUTCDate() === 1 || k === 0) ctx.fillText(d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" }), cx, cy + r + 31);
      cv._days.push(j);
    }
  }

  function renderUpcoming() {
    const items = [[0, "New Moon"], [90, "First quarter"], [180, "Full Moon"], [270, "Last quarter"]]
      .map(([t, name]) => ({ name, jd: A.findLunarPhase(state.jd, t, +1) }))
      .sort((a, b) => a.jd - b.jd);
    $("upcoming").innerHTML = items.map((it) =>
      `<button type="button" data-jd="${it.jd}"><b>${it.name}</b><span>${fmtDate(it.jd)}</span></button>`).join("");
  }

  // --------------------------------------------------------------- planets
  function renderPlanet(full) {
    const p = A.planetPhase(state.planet, state.jd);
    const eq = A.equatorial(state.planet, state.jd);
    const o = orientation(state.jd, eq);
    const scale = state.trueSize ? Math.max(0.05, p.diameterArcsec / MAX_DIAM[state.planet]) : 1;
    drawDisk($("skyCanvas"), { alpha: p.phaseAngle * D2R, sunDir: o.pa * D2R, rot: o.rot, law: "lambert",
      color: A.PLANETS[state.planet].color, kind: state.planet, compass: state.orient === "north" || o.alt === null, zenith: o.rot !== 0, scale });
    const where = p.elongation < 12 ? "too close to the Sun to see" : p.east ? "evening sky (east of the Sun)" : "morning sky (west of the Sun)";
    let name;
    if (p.illuminated > 0.995) name = "Full"; else if (p.illuminated < 0.01) name = "New";
    else if (p.illuminated < 0.45) name = "Crescent"; else if (p.illuminated <= 0.55) name = "Half lit"; else name = "Gibbous";
    const rows = [
      ["Illuminated", pct(p.illuminated)],
      ["Phase angle", `${p.phaseAngle.toFixed(1)}°`],
      ["Elongation from the Sun", `${p.elongation.toFixed(1)}° ${p.east ? "east" : "west"}`],
      ["Apparent diameter", `${p.diameterArcsec.toFixed(1)}″`],
      ["Magnitude", p.magnitude.toFixed(2)],
      ["Distance from Earth", `${p.distanceAU.toFixed(3)} AU`],
      ["Distance from the Sun", `${p.sunDistanceAU.toFixed(3)} AU`],
      ["Bright limb position angle", `${o.pa.toFixed(0)}°`],
    ];
    if (o.alt !== null) rows.push(["Altitude", `${o.alt.toFixed(1)}°`]);
    setReadouts(`${p.name}: ${name}`, `${fmtDate(state.jd)}, ${where}`, rows,
      (state.trueSize ? `Drawn at ${(scale * 100).toFixed(0)} % of its size at closest approach (${MAX_DIAM[state.planet]}″). ` : "") + o.caption);
    drawPlanetOrbit(p);
    if (full || !planetWindowOk()) plotPlanet(); else moveCursor("planetPlot", isoX(state.jd));
  }

  let planetWindow = null;
  const planetWindowOk = () => planetWindow && planetWindow[2] === state.planet &&
    state.jd > planetWindow[0] + 0.1 * SYNODIC[state.planet] && state.jd < planetWindow[1] - 0.1 * SYNODIC[state.planet];

  function plotPlanet() {
    const S = SYNODIC[state.planet];
    const j0 = state.jd - S * 0.6, j1 = state.jd + S * 0.6;
    planetWindow = [j0, j1, state.planet];
    const xs = [], k = [], d = [], m = [];
    const step = (j1 - j0) / 500;
    for (let j = j0; j <= j1; j += step) {
      const p = A.planetPhase(state.planet, j);
      xs.push(isoX(j)); k.push(p.illuminated * 100); d.push(p.diameterArcsec); m.push(p.magnitude);
    }
    const ink = css("--accent");
    const tr = (y, yaxis, unit, fmt) => ({ x: xs, y, yaxis, xaxis: "x", mode: "lines", line: { color: ink, width: 2.2 },
      hovertemplate: `%{x|%d %b %Y}<br>%{y:${fmt}}${unit}<extra></extra>` });
    Plotly.react("planetPlot", [tr(k, "y", " % lit", ".1f"), tr(d, "y2", "″", ".1f"), tr(m, "y3", " mag", ".2f")], {
      ...theme(), margin: { l: 62, r: 12, t: 6, b: 36 }, showlegend: false, hovermode: "x unified",
      grid: { rows: 3, columns: 1, subplots: [["xy"], ["xy2"], ["xy3"]], roworder: "top to bottom" },
      xaxis: axis("", { type: "date" }),
      yaxis: axis("Illuminated (%)", { domain: [0.7, 1], range: [-3, 103] }),
      yaxis2: axis("Diameter (″)", { domain: [0.36, 0.64] }),
      yaxis3: axis("Magnitude", { domain: [0, 0.3], autorange: "reversed" }),
      shapes: [cursor(isoX(state.jd))],
    }, { responsive: true, displaylogo: false, modeBarButtonsToRemove: ["lasso2d", "select2d"] });
    bindPlotClick($("planetPlot"), (x) => setJD(jdFromIso(x)));
  }

  function drawPlanetOrbit(p) {
    const cv = $("orbitCanvas");
    const { ctx, w, h } = setupCanvas(cv);
    ctx.clearRect(0, 0, w, h);
    const aMax = Math.max(1.05, Math.hypot(p.helio.x, p.helio.y) * 1.08, state.planet === "mars" ? 1.68 : 0);
    const sc = (Math.min(w, h) / 2 - 26) / aMax, cx = w / 2, cy = h / 2;
    const X = (x) => cx + x * sc, Y = (y) => cy - y * sc;
    const orbit = (body, period, color) => {
      ctx.beginPath();
      for (let k = 0; k <= 200; k++) {
        const q = A.heliocentric(body, state.jd + (k / 200) * period);
        if (k === 0) ctx.moveTo(X(q.x), Y(q.y)); else ctx.lineTo(X(q.x), Y(q.y));
      }
      ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.stroke();
    };
    const periods = { mercury: 87.97, venus: 224.7, mars: 686.98, jupiter: 4332.6 };
    orbit("earth", 365.25, css("--rule-strong"));
    orbit(state.planet, periods[state.planet], css("--rule-strong"));
    // lines Sun–planet and Earth–planet: the angle between them at the planet is the phase angle
    ctx.setLineDash([5, 5]); ctx.lineWidth = 1.3;
    ctx.strokeStyle = css("--sun"); ctx.beginPath(); ctx.moveTo(X(0), Y(0)); ctx.lineTo(X(p.helio.x), Y(p.helio.y)); ctx.stroke();
    ctx.strokeStyle = css("--accent"); ctx.beginPath(); ctx.moveTo(X(p.earth.x), Y(p.earth.y)); ctx.lineTo(X(p.helio.x), Y(p.helio.y)); ctx.stroke();
    ctx.setLineDash([]);
    const dot = (x, y, r, fill, label) => {
      ctx.beginPath(); ctx.arc(X(x), Y(y), r, 0, 2 * Math.PI); ctx.fillStyle = fill; ctx.fill();
      ctx.fillStyle = css("--ink"); ctx.font = "12px 'IBM Plex Sans', system-ui, sans-serif"; ctx.textAlign = "left";
      ctx.fillText(label, X(x) + r + 4, Y(y) - r - 2);
    };
    dot(0, 0, 8, css("--sun"), "Sun");
    dot(p.earth.x, p.earth.y, 5, "#2f7fd8", "Earth");
    const [r, g, b] = A.PLANETS[state.planet].color;
    dot(p.helio.x, p.helio.y, 6, `rgb(${r},${g},${b})`, p.name);
    ctx.fillStyle = css("--muted"); ctx.textAlign = "left";
    ctx.fillText(`Phase angle ${p.phaseAngle.toFixed(0)}° (between the dashed lines)`, 12, h - 12);
  }

  // ------------------------------------------------------------ exoplanets
  const PARAMS = [
    ["period", "Period (days)", 0.1, 10000], ["mstar", "Star mass (M☉)", 0.05, 50], ["rstar", "Star radius (R☉)", 0.05, 100],
    ["radius", "Planet radius", 0.1, 300], ["inc", "Inclination (°)", 0, 90], ["ecc", "Eccentricity", 0, 0.95],
    ["omega", "Periastron ω (°)", 0, 360], ["albedo", "Geometric albedo", 0, 1],
  ];

  function buildExoControls() {
    const sel = $("exoSelect");
    sel.innerHTML = P.EXOPLANETS.map((p) => `<option value="${p.id}">${p.name}</option>`).join("") + '<option value="custom">Custom planet</option>';
    $("exoParams").innerHTML = PARAMS.map(([k, label, lo, hi]) => k === "radius"
      ? `<label class="field">${label}<span class="pair"><input id="ex-${k}" type="number" step="any" min="${lo}" max="${hi}">
          <select id="ex-unit" aria-label="Radius unit"><option value="earth">R⊕</option><option value="jup">R♃</option></select></span></label>`
      : `<label class="field">${label}<input id="ex-${k}" type="number" step="any" min="${lo}" max="${hi}"></label>`).join("");
    sel.addEventListener("change", () => { if (sel.value !== "custom") loadExo(sel.value); });
    PARAMS.forEach(([k, , lo, hi]) => {
      $(`ex-${k}`).addEventListener("change", (e) => {
        const v = parseFloat(e.target.value);
        if (!Number.isFinite(v) || v < lo || v > hi) { e.target.classList.add("invalid"); e.target.title = `Enter a value between ${lo} and ${hi}`; return; }
        e.target.classList.remove("invalid");
        if (v === state.exo[k]) return;                         // e.g. a change event fired on blur with the same value
        state.exo[k] = v; markCustom(); renderExo(true);
      });
    });
    $("ex-unit").addEventListener("change", (e) => { state.exo.radiusUnit = e.target.value; markCustom(); renderExo(true); });
  }

  function markCustom() {
    $("exoSelect").value = "custom";
    state.exoId = "custom";
    $("exoNote").textContent = "Custom planet: your own parameters.";
  }

  function loadExo(id) {
    const p = P.EXOPLANETS.find((x) => x.id === id) || P.EXOPLANETS[0];
    state.exo = { ...p };
    state.exoId = id;
    $("exoSelect").value = id;
    $("exoNote").textContent = p.note;
    PARAMS.forEach(([k]) => { $(`ex-${k}`).value = p[k]; $(`ex-${k}`).classList.remove("invalid"); });
    $("ex-unit").value = p.radiusUnit;
    renderExo(true);
  }

  function exoModel() { return P.makePlanet(state.exo); }

  function renderExo(full) {
    const pl = exoModel();
    const now = P.reflectedFlux(state.exoPhase, pl);
    const s = now.state;
    const g = P.transitGeometry(pl);
    // direction from planet towards the star on the sky (sky X right, Y up)
    let sunDir = Math.atan2(s.X, -s.Y);              // angle from "up" towards the left of (-X, -Y)
    if (Math.hypot(s.X, s.Y) < 1e-9) sunDir = -Math.PI / 2;
    const hidden = now.eclipsed >= 0.999;
    drawDisk($("skyCanvas"), { alpha: now.alpha, sunDir, rot: 0, law: "lambert",
      color: [150 + 100 * state.exo.albedo, 170 + 80 * state.exo.albedo, 200 + 50 * state.exo.albedo], kind: state.exo.radiusUnit === "jup" ? "jupiter" : "", compass: false });
    const amp = pl.albedo * (pl.rp / pl.a) ** 2 * 1e6;
    const status = hidden ? "Hidden behind its star (secondary eclipse)" : now.eclipsed > 0 ? "Partly behind its star"
      : (s.Z > 0 && Math.hypot(s.X, s.Y) < pl.rstar + pl.rp) ? "Transiting in front of its star" : "";
    $("phaseName").textContent = state.exo.name || "Custom planet";
    $("phaseSub").textContent = `Orbital phase ${state.exoPhase.toFixed(3)}${status ? `: ${status.toLowerCase()}` : ""}`;
    $("readouts").innerHTML = [
      ["Illuminated", pct(P.illuminatedFraction(now.alpha))],
      ["Phase angle", `${(now.alpha * R2D).toFixed(1)}°`],
      ["Reflected light now", `${(now.F * 1e6).toFixed(now.F * 1e6 < 1 ? 4 : 2)} ppm`],
      ["Full-phase amplitude", `${amp.toFixed(amp < 1 ? 4 : 1)} ppm`],
      ["Semi-major axis", `${pl.a.toFixed(4)} AU`],
      ["a / R★", (pl.a / pl.rstar).toFixed(2)],
      ["Rp / a", pl.rp / pl.a < 0.001 ? (pl.rp / pl.a).toExponential(2) : (pl.rp / pl.a).toFixed(4)],
      ["Transits / eclipses", `${g.transits ? "yes" : "no"} / ${g.eclipses ? "yes" : "no"} (b = ${g.b.toFixed(2)})`],
    ].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
    $("skyCaption").textContent = hidden ? "The planet is behind its star; this shows the face that would be lit."
      : "The planet as seen by a distant observer, enlarged. The orange marker points to the star.";
    $("exoPhaseOut").textContent = state.exoPhase.toFixed(3);
    $("exoPhase").value = state.exoPhase;
    drawExoOrbit(pl, s);
    if (full) plotExo(pl, g); else moveCursor("exoPlot", state.exoPhase);
  }

  function plotExo(pl, g) {
    const N = 801, xs = [], ys = [], shapes = [cursor(state.exoPhase)];
    let inTr = null, inEc = null;
    for (let k = 0; k < N; k++) {
      const ph = k / (N - 1);
      const r = P.reflectedFlux(ph, pl);
      xs.push(ph); ys.push(r.F * 1e6);
      const tr = r.state.Z > 0 && Math.hypot(r.state.X, r.state.Y) < pl.rstar + pl.rp;
      const ec = r.eclipsed > 0;
      if (tr && inTr === null) inTr = ph; if (!tr && inTr !== null) { shapes.push(band(inTr, ph, "rgba(36,87,214,0.10)")); inTr = null; }
      if (ec && inEc === null) inEc = ph; if (!ec && inEc !== null) { shapes.push(band(inEc, ph, "rgba(232,163,61,0.18)")); inEc = null; }
    }
    if (inTr !== null) shapes.push(band(inTr, 1, "rgba(36,87,214,0.10)"));
    const traces = [{ x: xs, y: ys, mode: "lines", name: "Model", line: { color: css("--accent"), width: 2.6 },
      hovertemplate: "phase %{x:.3f}<br>%{y:.3g} ppm<extra></extra>" }];
    if (state.noise) {
      const rand = mulberry(7), M = 400, nx = [], ny = [];
      for (let k = 0; k < M; k++) {
        const ph = (k + 0.5) / M;
        const u = Math.max(rand(), 1e-12), v = rand();
        const n = state.sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
        nx.push(ph); ny.push(P.reflectedFlux(ph, pl).F * 1e6 + n);
      }
      const bx = [], by = [];
      for (let b = 0; b < 25; b++) {
        let s = 0, c = 0;
        for (let k = 0; k < M; k++) if (Math.floor(nx[k] * 25) === b) { s += ny[k]; c++; }
        bx.push((b + 0.5) / 25); by.push(s / c);
      }
      traces.unshift({ x: nx, y: ny, mode: "markers", name: "Simulated data", marker: { size: 4, color: "rgba(91,107,128,0.4)" }, hoverinfo: "skip" });
      traces.splice(1, 0, { x: bx, y: by, mode: "markers", name: "Binned", marker: { size: 8, color: css("--ink") }, hoverinfo: "skip" });
    }
    const amp = Math.max(...ys);
    const ann = [{ x: 0.5, y: amp, xref: "x", yref: "y", text: `${sig(amp)} ppm`, showarrow: true, arrowhead: 0, ay: -26, font: { size: 12, color: css("--ink") } }];
    if (g.transits) ann.push({ x: 0.02, y: 1, xref: "x", yref: "paper", xanchor: "left", text: "transit", showarrow: false, font: { size: 11, color: css("--accent") } });
    if (g.eclipses) ann.push({ x: 0.5, y: 1, xref: "x", yref: "paper", text: "eclipse", showarrow: false, yanchor: "bottom", font: { size: 11, color: "#b7791f" } });
    const yr = state.noise ? undefined : [-0.05 * amp, amp * 1.22];
    Plotly.react("exoPlot", traces, { ...theme(), margin: { l: 64, r: 12, t: 22, b: 40 }, showlegend: state.noise,
      legend: { orientation: "h", x: 0, y: 1.12 }, hovermode: "closest",
      xaxis: axis("Orbital phase (0 = transit)", { range: [0, 1] }),
      yaxis: axis("Reflected light Fp/F★ (ppm)", yr ? { range: yr } : { autorange: true }), shapes, annotations: ann },
    { responsive: true, displaylogo: false, modeBarButtonsToRemove: ["lasso2d", "select2d"] });
    bindPlotClick($("exoPlot"), (x) => { state.exoPhase = Math.min(1, Math.max(0, x)); renderExo(false); });
  }
  const band = (x0, x1, color) => ({ type: "rect", xref: "x", yref: "paper", x0, x1, y0: 0, y1: 1, fillcolor: color, line: { width: 0 }, layer: "below" });

  function mulberry(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  function drawExoOrbit(pl, s) {
    const cv = $("exoOrbitCanvas");
    const { ctx, w, h } = setupCanvas(cv);
    ctx.clearRect(0, 0, w, h);
    const apo = pl.a * (1 + (pl.ecc || 0));
    const sc = (Math.min(w, h) / 2 - 30) / apo, cx = w / 2, cy = h / 2 - 8;
    // top-down: sky X to the right, line of sight (Z) towards the bottom
    const sinI = Math.sin(pl.inc * D2R) || 1e-6;
    ctx.beginPath();
    for (let k = 0; k <= 240; k++) {
      const q = P.orbitState(k / 240, pl);
      const x = cx + q.X * sc, y = cy + (q.Z / sinI) * sc;
      if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = css("--rule-strong"); ctx.lineWidth = 1.2; ctx.stroke();
    const sr = Math.max(5, pl.rstar * sc);
    ctx.beginPath(); ctx.arc(cx, cy, sr, 0, 2 * Math.PI); ctx.fillStyle = css("--sun"); ctx.fill();
    const px = cx + s.X * sc, py = cy + (s.Z / sinI) * sc;
    // lit half of the planet faces the star
    const ang = Math.atan2(cy - py, cx - px), pr = 7;
    ctx.beginPath(); ctx.arc(px, py, pr, 0, 2 * Math.PI); ctx.fillStyle = "#1c2a40"; ctx.fill();
    ctx.beginPath(); ctx.arc(px, py, pr, ang - Math.PI / 2, ang + Math.PI / 2); ctx.closePath(); ctx.fillStyle = "#f2efe6"; ctx.fill();
    ctx.strokeStyle = css("--accent"); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(px, py, pr, 0, 2 * Math.PI); ctx.stroke();
    ctx.fillStyle = css("--muted"); ctx.font = "12px 'IBM Plex Sans', system-ui, sans-serif"; ctx.textAlign = "center";
    ctx.fillText("↓ towards the observer", cx, h - 10);
    ctx.textAlign = "left";
    ctx.fillText(`a = ${pl.a.toFixed(3)} AU`, 12, 20);
  }

  // ------------------------------------------------------------- control
  function render(full = true) {
    if (state.mode === "moon") renderMoon(full);
    else if (state.mode === "planets") renderPlanet(full);
    else renderExo(full);
    $("dateInput").value = A.fromJulianDay(state.jd).toISOString().slice(0, 16);
    const notes = {
      moon: "Moon positions use the main terms of Meeus’s lunar theory (Astronomical Algorithms, ch. 47–49); phases agree with published times to within minutes. Shading uses the Lommel–Seeliger law, which suits the Moon’s dusty surface. The dark side is faintly lit by earthshine.",
      planets: "Planet positions use JPL’s approximate Keplerian elements (Standish, valid 1800–2050), good to a few arcminutes. Magnitudes follow the Astronomical Almanac formulae given by Meeus (ch. 41).",
      exo: "Geometry follows Winn (2010); reflected light uses a Lambert sphere phase function with geometric albedo A_g. Thermal emission, which dominates for the hottest planets in the infrared, is not included.",
    };
    $("footnote").textContent = notes[state.mode];
  }

  function setJD(jd, full = false) {
    state.jd = jd;
    render(full);
  }

  function setMode(mode) {
    state.mode = mode;
    document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.mode === mode)));
    document.querySelectorAll("[data-show]").forEach((el) => { el.hidden = !el.dataset.show.split(" ").includes(mode); });
    setPlaying(false); setExoPlaying(false);
    render(true);
    window.dispatchEvent(new Event("resize"));
  }

  let last = null;
  function tick(now) {
    if (!state.playing && !state.exoPlaying) { last = null; return; }
    if (last !== null) {
      const dt = Math.min(0.1, (now - last) / 1000);
      if (state.playing) setJD(state.jd + dt * state.speed);
      if (state.exoPlaying) { state.exoPhase = (state.exoPhase + dt * 0.08) % 1; renderExo(false); }
    }
    last = now;
    requestAnimationFrame(tick);
  }
  function setPlaying(on) {
    state.playing = on;
    const b = $("playBtn"); b.textContent = on ? "❚❚" : "▶"; b.setAttribute("aria-pressed", String(on));
    b.setAttribute("aria-label", on ? "Pause time-lapse" : "Play time-lapse");
    if (on) requestAnimationFrame(tick); else render(true);
  }
  function setExoPlaying(on) {
    state.exoPlaying = on;
    const b = $("exoPlay"); b.textContent = on ? "❚❚" : "▶"; b.setAttribute("aria-pressed", String(on));
    b.setAttribute("aria-label", on ? "Pause orbit" : "Play orbit");
    if (on) requestAnimationFrame(tick);
  }

  function applyTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    $("themeToggle").textContent = t === "dark" ? "☀" : "☾";
    $("themeToggle").setAttribute("aria-label", t === "dark" ? "Switch to light theme" : "Switch to dark theme");
    try { localStorage.setItem("lps-theme", t); } catch (e) { /* storage unavailable */ }
    render(true);
  }

  function readLocation() {
    const la = parseFloat($("latInput").value), lo = parseFloat($("lonInput").value);
    const okLa = Number.isFinite(la) && la >= -90 && la <= 90, okLo = Number.isFinite(lo) && lo >= -180 && lo <= 180;
    $("latInput").classList.toggle("invalid", $("latInput").value !== "" && !okLa);
    $("lonInput").classList.toggle("invalid", $("lonInput").value !== "" && !okLo);
    state.lat = okLa && okLo ? la : null;
    state.lon = okLa && okLo ? lo : null;
    try { if (state.lat !== null) localStorage.setItem("lps-loc", JSON.stringify([la, lo])); } catch (e) { /* ignore */ }
    if (state.orient === "sky" && state.lat === null) $("locNote").textContent = "Enter your latitude and longitude to see the disk as in your sky.";
    else $("locNote").textContent = "“As in my sky” turns the disk as you would see it above your horizon. It needs your latitude and longitude.";
  }

  function init() {
    buildExoControls();
    state.exo = { ...P.EXOPLANETS[0] };
    document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
    $("dateInput").addEventListener("change", (e) => {
      const d = new Date(e.target.value + ":00Z");
      if (!Number.isNaN(d.getTime())) setJD(A.julianDay(d), true);
    });
    document.querySelectorAll(".step").forEach((b) => b.addEventListener("click", () => setJD(state.jd + parseFloat(b.dataset.step))));
    $("nowBtn").addEventListener("click", () => setJD(A.julianDay(new Date()), true));
    $("playBtn").addEventListener("click", () => setPlaying(!state.playing));
    $("speedSelect").addEventListener("change", (e) => { state.speed = parseFloat(e.target.value); });
    document.querySelectorAll(".jump").forEach((b) => b.addEventListener("click", () =>
      setJD(A.findLunarPhase(state.jd + 0.01, parseFloat(b.dataset.target), +1), true)));
    $("upcoming").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) setJD(parseFloat(b.dataset.jd), true); });
    $("monthCanvas").addEventListener("click", (e) => {
      const cv = $("monthCanvas"), r = cv.getBoundingClientRect();
      const k = Math.floor(((e.clientX - r.left) / r.width) * 29);
      if (cv._days && cv._days[k] !== undefined) setJD(cv._days[k], true);
    });
    document.querySelectorAll("#planetSeg button").forEach((b) => b.addEventListener("click", () => {
      state.planet = b.dataset.planet;
      document.querySelectorAll("#planetSeg button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      render(true);
    }));
    $("trueSize").addEventListener("change", (e) => { state.trueSize = e.target.checked; render(false); });
    document.querySelectorAll("#orientSeg button").forEach((b) => b.addEventListener("click", () => {
      state.orient = b.dataset.orient;
      document.querySelectorAll("#orientSeg button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      readLocation(); render(false);
    }));
    ["latInput", "lonInput"].forEach((id) => $(id).addEventListener("change", () => { readLocation(); render(false); }));
    $("geoBtn").addEventListener("click", () => {
      if (!navigator.geolocation) { $("locNote").textContent = "This browser cannot share your location; type it in instead."; return; }
      $("locNote").textContent = "Asking the browser for your location…";
      navigator.geolocation.getCurrentPosition((pos) => {
        $("latInput").value = pos.coords.latitude.toFixed(3); $("lonInput").value = pos.coords.longitude.toFixed(3);
        readLocation(); render(false);
      }, () => { $("locNote").textContent = "Location was not shared. Type your latitude and longitude instead."; }, { timeout: 10000 });
    });
    $("exoPhase").addEventListener("input", (e) => { state.exoPhase = parseFloat(e.target.value); renderExo(false); });
    $("exoPlay").addEventListener("click", () => setExoPlaying(!state.exoPlaying));
    $("exoNoise").addEventListener("change", (e) => { state.noise = e.target.checked; $("noiseBox").hidden = !state.noise; renderExo(true); });
    $("exoSigma").addEventListener("input", (e) => { state.sigma = Math.pow(10, parseFloat(e.target.value)); $("exoSigmaNum").value = +state.sigma.toPrecision(3); renderExo(true); });
    $("exoSigmaNum").addEventListener("change", (e) => {
      const v = parseFloat(e.target.value);
      if (!(v >= 0.1 && v <= 10000)) { e.target.classList.add("invalid"); return; }
      e.target.classList.remove("invalid"); state.sigma = v; $("exoSigma").value = Math.log10(v); renderExo(true);
    });
    $("themeToggle").addEventListener("click", () => applyTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark"));
    try {
      if (localStorage.getItem("lps-theme") === "dark") document.documentElement.setAttribute("data-theme", "dark");
      const loc = JSON.parse(localStorage.getItem("lps-loc") || "null");
      if (loc) { $("latInput").value = loc[0]; $("lonInput").value = loc[1]; }
    } catch (e) { /* storage unavailable */ }
    readLocation();
    let resizeT = null;
    window.addEventListener("resize", () => { clearTimeout(resizeT); resizeT = setTimeout(() => render(false), 120); });
    document.addEventListener("keydown", (e) => {
      const tag = document.activeElement.tagName;
      if (/INPUT|SELECT|TEXTAREA/.test(tag)) return;          // typing in a field
      if (e.code === "Space" && tag === "BUTTON") return;       // Space already presses the focused button
      if (e.code === "Space") { e.preventDefault(); if (state.mode === "exo") setExoPlaying(!state.exoPlaying); else setPlaying(!state.playing); }
      if (state.mode !== "exo" && e.code === "ArrowRight") setJD(state.jd + (e.shiftKey ? 1 / 24 : 1));
      if (state.mode !== "exo" && e.code === "ArrowLeft") setJD(state.jd - (e.shiftKey ? 1 / 24 : 1));
    });
    loadExo("kepler7b");
    setMode("moon");
  }

  window.PhaseApp = { state, setJD, setMode, render, loadExo };
  document.addEventListener("DOMContentLoaded", init);
})();
