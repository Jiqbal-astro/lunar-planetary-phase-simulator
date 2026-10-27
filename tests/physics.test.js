// Run with:  node --test
const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("../js/astro.js");
const P = require("../js/phase.js");

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ""} expected ${b} ± ${tol}, got ${a}`);
const jd = (iso) => A.julianDay(new Date(iso));

// ------------------------------------------------------------------ Moon
// Published times (UTC) of the 2024 lunar phases (USNO / timeanddate.com)
const PHASES_2024 = [
  ["2024-01-11T11:57Z", 0, "New Moon"], ["2024-01-18T03:53Z", 90, "First quarter"],
  ["2024-01-25T17:54Z", 180, "Full Moon"], ["2024-02-02T23:18Z", 270, "Last quarter"],
  ["2024-02-09T22:59Z", 0, "New Moon"], ["2024-02-24T12:30Z", 180, "Full Moon"],
];

test("Moon: illuminated fraction at the published 2024 phases", () => {
  for (const [iso, target] of PHASES_2024) {
    const k = A.moonPhase(jd(iso)).illuminated;
    const expected = { 0: 0, 90: 0.5, 180: 1, 270: 0.5 }[target];
    close(k, expected, target % 180 ? 0.02 : 0.004, iso);
  }
});

test("Moon: phase names and waxing/waning (the original app inverted full and new)", () => {
  assert.equal(A.phaseName(A.moonPhase(jd("2024-01-25T17:54Z")).phaseLongitude), "Full Moon");
  assert.equal(A.phaseName(A.moonPhase(jd("2024-01-11T11:57Z")).phaseLongitude), "New Moon");
  assert.equal(A.moonPhase(jd("2024-01-15T00:00Z")).waxing, true);
  assert.equal(A.moonPhase(jd("2024-01-30T00:00Z")).waxing, false);
});

test("Moon: finds the next new, quarter and full Moons within minutes", () => {
  const start = jd("2024-01-05T00:00Z");
  for (const [iso, target] of PHASES_2024.slice(0, 4)) {
    const found = A.findLunarPhase(start, target, +1);
    close((found - jd(iso)) * 1440, 0, 20, `${iso} (minutes)`);
  }
  // searching backwards finds the previous new Moon
  close((A.findLunarPhase(jd("2024-01-20T00:00Z"), 0, -1) - jd("2024-01-11T11:57Z")) * 1440, 0, 20);
});

test("Moon: age, distance and magnitude are sensible", () => {
  close(A.moonAge(jd("2024-01-25T17:54Z")), 14.25, 0.1);
  const d = A.moon(jd("2024-01-25T17:54Z")).distanceKm;
  assert.ok(d > 356000 && d < 407000);
  close(A.moonMagnitude(0, 384400), -12.73, 1e-9);
});

test("Moon: perigee distance near the published value (2024-01-13 10:34 UTC, 362,267 km)", () => {
  close(A.moon(jd("2024-01-13T10:34Z")).distanceKm, 362267, 400);
});

// --------------------------------------------------------------- planets
test("Venus: inferior conjunction 2023-08-13 is a thin crescent near the Sun", () => {
  const v = A.planetPhase("venus", jd("2023-08-13T11:00Z"));
  assert.ok(v.illuminated < 0.01, `k = ${v.illuminated}`);
  assert.ok(v.elongation < 9, `elongation = ${v.elongation}`);
  assert.ok(v.diameterArcsec > 55, `diameter = ${v.diameterArcsec}`);
});

test("Venus: greatest eastern elongation 2023-06-04 (45.4°) is half lit, evening sky", () => {
  const v = A.planetPhase("venus", jd("2023-06-04T00:00Z"));
  close(v.elongation, 45.4, 0.5);
  close(v.illuminated, 0.5, 0.04);
  assert.equal(v.east, true);
});

test("Venus: superior conjunction 2022-10-22 is fully lit", () => {
  const v = A.planetPhase("venus", jd("2022-10-22T21:00Z"));
  assert.ok(v.illuminated > 0.995);
  close(v.diameterArcsec, 9.7, 0.3);
});

test("Mars: opposition 2022-12-08 is fully lit; quadrature phase ~87 %", () => {
  const m = A.planetPhase("mars", jd("2022-12-08T05:00Z"));
  assert.ok(m.illuminated > 0.998 && m.elongation > 175);
  close(m.diameterArcsec, 17.0, 0.4);
  close(m.magnitude, -1.9, 0.25);
  const q = A.planetPhase("mars", jd("2022-09-01T00:00Z"));
  assert.ok(q.illuminated > 0.84 && q.illuminated < 0.92, `k = ${q.illuminated}`);
});

test("Jupiter: opposition 2023-11-03, magnitude about -2.9", () => {
  const j = A.planetPhase("jupiter", jd("2023-11-03T05:00Z"));
  assert.ok(j.elongation > 178);
  close(j.magnitude, -2.9, 0.15);
  close(j.diameterArcsec, 49.5, 1);
});

test("Mercury: greatest elongations reach 18–28° and are about half lit", () => {
  const m = A.planetPhase("mercury", jd("2024-03-24T00:00Z"));   // GEE 2024-03-24, 18.7°
  close(m.elongation, 18.7, 0.8);
  assert.ok(m.illuminated > 0.3 && m.illuminated < 0.6);
});

// ------------------------------------------------------- orientation/time
test("sidereal time and bright limb direction", () => {
  close(A.gmst(2451545.0), 280.46061837, 1e-6);
  // waxing Moon: bright limb points towards the Sun (to the west, PA ~ 270°± 60°)
  const t = jd("2024-01-15T18:00Z");
  const pa = A.brightLimbAngle(A.equatorial("sun", t), A.equatorial("moon", t));
  assert.ok(pa > 200 && pa < 340, `PA = ${pa}`);
  // waning Moon: bright limb towards the east (PA ~ 90°)
  const t2 = jd("2024-01-31T06:00Z");
  const pa2 = A.brightLimbAngle(A.equatorial("sun", t2), A.equatorial("moon", t2));
  assert.ok(pa2 > 20 && pa2 < 160, `PA = ${pa2}`);
});

// ---------------------------------------------------------- phase physics
test("Lambert phase function and illuminated fraction limits", () => {
  close(P.lambert(0), 1, 1e-12); close(P.lambert(Math.PI), 0, 1e-12);
  close(P.illuminatedFraction(Math.PI / 2), 0.5, 1e-12);
});

test("rendered disk: lit area equals the illuminated fraction for every phase and direction", () => {
  for (const alphaDeg of [10, 45, 90, 135, 170]) {
    for (const ang of [0, 0.7, 2.5]) {
      const a = alphaDeg * P.D2R, du = Math.cos(ang), dv = Math.sin(ang);
      let lit = 0, all = 0; const n = 400;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        const u = -1 + (2 * (i + 0.5)) / n, v = -1 + (2 * (j + 0.5)) / n;
        const s = P.shade(u, v, a, du, dv, "lambert");
        if (s >= 0) { all++; if (s > 0) lit++; }
      }
      close(lit / all, P.illuminatedFraction(a), 0.01, `alpha ${alphaDeg}`);
    }
  }
});

test("rendered disk: lit side faces the Sun direction", () => {
  const a = 120 * P.D2R;
  assert.ok(P.shade(0.9, 0, a, 1, 0, "lambert") > 0);    // limb towards the Sun is lit
  assert.equal(P.shade(-0.9, 0, a, 1, 0, "lambert"), 0); // opposite limb dark
});

test("exoplanet: transit at phase 0 (alpha = 180°), full phase at eclipse", () => {
  const pl = P.makePlanet({ period: 3.5, mstar: 1, rstar: 1, radius: 1.2, radiusUnit: "jup", inc: 90, ecc: 0, omega: 90, albedo: 0.3 });
  close(P.orbitState(0, pl).alpha * P.R2D, 180, 1e-6);
  close(P.orbitState(0.5, pl).alpha * P.R2D, 0, 1e-6);
  const before = P.reflectedFlux(0.45, pl).F, during = P.reflectedFlux(0.5, pl).F;
  assert.ok(before > 0 && during === 0, "planet hidden during secondary eclipse");
});

test("exoplanet: flux near full phase = A_g (Rp/a)^2 Phi(alpha) for Kepler-7 b (~50 ppm)", () => {
  const pl = P.makePlanet({ period: 4.8855, mstar: 1.36, rstar: 1.843, radius: 1.61, radiusUnit: "jup", inc: 86.5, ecc: 0, omega: 90, albedo: 0.35 });
  const g = P.transitGeometry(pl);
  assert.ok(g.transits && g.eclipses);
  const r = P.reflectedFlux(0.44, pl);
  close(r.F, 0.35 * (pl.rp / pl.a) ** 2 * P.lambert(r.alpha), 1e-15);
  const amplitude = 0.35 * (pl.rp / pl.a) ** 2 * 1e6;
  assert.ok(amplitude > 40 && amplitude < 60, `amplitude ${amplitude} ppm`);
});

test("exoplanet: eccentric orbit flux scales with 1/r^2", () => {
  const pl = P.makePlanet({ period: 10, mstar: 1, rstar: 1, radius: 1, radiusUnit: "jup", inc: 30, ecc: 0.5, omega: 0, albedo: 0.3 });
  for (const ph of [0.1, 0.4, 0.7]) {
    const r = P.reflectedFlux(ph, pl);
    close(r.F, 0.3 * (pl.rp / r.r) ** 2 * P.lambert(r.alpha), 1e-15);
  }
});

test("exoplanet presets: Rp/a values agree with the literature", () => {
  const byId = Object.fromEntries(P.EXOPLANETS.map((p) => [p.id, P.makePlanet(p)]));
  close(byId.hd209458b.rp / byId.hd209458b.a, 0.0139, 0.0006);
  close(byId.toi700d.rp / byId.toi700d.a, 0.00028, 0.00002);   // original app: 0.0035 (12x too large)
  close(byId.wasp12b.rp / byId.wasp12b.a, 0.0388, 0.0015);       // original app: 0.020
  close(byId.k218b.a, 0.1429, 0.003);
  close(byId.toi700d.a, 0.163, 0.002);
});
