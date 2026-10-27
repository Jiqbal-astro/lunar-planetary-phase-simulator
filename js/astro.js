/*
 * astro.js — positions and phases of the Moon and planets.
 *
 * Moon: truncated series of Meeus, "Astronomical Algorithms" (2nd ed.), ch. 47–49
 * (largest terms; longitude good to ~0.05°, phase to ~0.1 %).
 * Planets: Keplerian elements of Standish, "Approximate Positions of the Planets"
 * (JPL, valid 1800–2050), with Earth taken as the Earth–Moon barycentre.
 * Magnitudes: Meeus ch. 41 (Astronomical Almanac formulae).
 *
 * Pure functions, no DOM: usable in the browser (window.Astro) and in Node.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Astro = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const AU_KM = 149597870.7;
  const norm360 = (x) => ((x % 360) + 360) % 360;
  const sind = (x) => Math.sin(x * D2R), cosd = (x) => Math.cos(x * D2R);

  // ------------------------------------------------------------------ time
  function julianDay(date) { return date.getTime() / 86400000 + 2440587.5; }
  function fromJulianDay(jd) { return new Date((jd - 2440587.5) * 86400000); }
  const centuries = (jd) => (jd - 2451545.0) / 36525;

  function obliquity(jd) {
    const T = centuries(jd);
    return 23.439291 - 0.0130042 * T - 1.64e-7 * T * T + 5.04e-7 * T * T * T;
  }

  /** Greenwich mean sidereal time in degrees (Meeus 12.4). */
  function gmst(jd) {
    const T = centuries(jd);
    return norm360(280.46061837 + 360.98564736629 * (jd - 2451545) + 0.000387933 * T * T - (T * T * T) / 38710000);
  }

  function eclipticToEquatorial(lambda, beta, eps) {
    const l = lambda * D2R, b = beta * D2R, e = eps * D2R;
    const ra = Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l));
    const dec = Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l));
    return { ra: norm360(ra * R2D), dec: dec * R2D };
  }

  // ------------------------------------------------------------------- Sun
  /** Geometric Sun: ecliptic longitude (deg, equinox of date) and distance (AU). */
  function sun(jd) {
    const T = centuries(jd);
    const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
    const M = 357.52911 + 35999.05029 * T - 0.0001537 * T * T;
    const e = 0.016708634 - 0.000042037 * T - 0.0000001267 * T * T;
    const C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * sind(M)
      + (0.019993 - 0.000101 * T) * sind(2 * M) + 0.000289 * sind(3 * M);
    const nu = M + C;
    const R = (1.000001018 * (1 - e * e)) / (1 + e * cosd(nu));
    const omega = 125.04 - 1934.136 * T;
    const lambda = norm360(L0 + C - 0.00569 - 0.00478 * sind(omega));   // apparent
    return { lambda, beta: 0, distanceAU: R };
  }

  // ------------------------------------------------------------------ Moon
  function moonArgs(jd) {
    const T = centuries(jd);
    return {
      T,
      Lp: norm360(218.3164477 + 481267.88123421 * T - 0.0015786 * T * T),
      D: norm360(297.8501921 + 445267.1114034 * T - 0.0018819 * T * T),
      M: norm360(357.5291092 + 35999.0502909 * T - 0.0001536 * T * T),
      Mp: norm360(134.9633964 + 477198.8675055 * T + 0.0087414 * T * T),
      F: norm360(93.272095 + 483202.0175233 * T - 0.0036539 * T * T),
      E: 1 - 0.002516 * T - 0.0000074 * T * T,
    };
  }

  // [D, M, M', F, sum_l (1e-6 deg), sum_r (1e-3 km)] — largest terms of Meeus Table 47.A
  const MOON_LR = [
    [0, 0, 1, 0, 6288774, -20905355], [2, 0, -1, 0, 1274027, -3699111], [2, 0, 0, 0, 658314, -2955968],
    [0, 0, 2, 0, 213618, -569925], [0, 1, 0, 0, -185116, 48888], [0, 0, 0, 2, -114332, -3149],
    [2, 0, -2, 0, 58793, 246158], [2, -1, -1, 0, 57066, -152138], [2, 0, 1, 0, 53322, -170733],
    [2, -1, 0, 0, 45758, -204586], [0, 1, -1, 0, -40923, -129620], [1, 0, 0, 0, -34720, 108743],
    [0, 1, 1, 0, -30383, 104755], [2, 0, 0, -2, 15327, 10321], [0, 0, 1, 2, -12528, 0],
    [0, 0, 1, -2, 10980, 79661], [4, 0, -1, 0, 10675, -34782], [0, 0, 3, 0, 10034, -23210],
    [4, 0, -2, 0, 8548, -21636], [2, 1, -1, 0, -7888, 24208], [2, 1, 0, 0, -6766, 30824],
    [1, 0, -1, 0, -5163, -8379], [1, 1, 0, 0, 4987, -16675], [2, -1, 1, 0, 4036, -12831],
  ];
  // [D, M, M', F, sum_b (1e-6 deg)] — largest terms of Meeus Table 47.B
  const MOON_B = [
    [0, 0, 0, 1, 5128122], [0, 0, 1, 1, 280602], [0, 0, 1, -1, 277693], [2, 0, 0, -1, 173237],
    [2, 0, -1, 1, 55413], [2, 0, -1, -1, 46271], [2, 0, 0, 1, 32573], [0, 0, 2, 1, 17198],
    [2, 0, 1, -1, 9266], [0, 0, 2, -1, 8822], [2, -1, 0, -1, 8216], [2, 0, -2, -1, 4324],
  ];

  /** Geocentric Moon: ecliptic longitude/latitude (deg, equinox of date) and distance (km). */
  function moon(jd) {
    const a = moonArgs(jd);
    let sl = 0, sr = 0, sb = 0;
    for (const [d, m, mp, f, l, r] of MOON_LR) {
      const arg = d * a.D + m * a.M + mp * a.Mp + f * a.F;
      const e = Math.abs(m) === 1 ? a.E : Math.abs(m) === 2 ? a.E * a.E : 1;
      sl += l * e * sind(arg);
      sr += r * e * cosd(arg);
    }
    for (const [d, m, mp, f, b] of MOON_B) {
      const e = Math.abs(m) === 1 ? a.E : 1;
      sb += b * e * sind(d * a.D + m * a.M + mp * a.Mp + f * a.F);
    }
    // nutation in longitude (dominant term) so the Moon matches the apparent Sun
    const omega = 125.04452 - 1934.136261 * a.T;
    return {
      lambda: norm360(a.Lp + sl / 1e6 - 0.00478 * sind(omega)),
      beta: sb / 1e6,
      distanceKm: 385000.56 + sr / 1000,
    };
  }

  /** Moon phase details: phase angle, illuminated fraction, elongation, waxing. */
  function moonPhase(jd) {
    const s = sun(jd), m = moon(jd);
    const dl = norm360(m.lambda - s.lambda);                    // 0 new, 180 full
    const psi = Math.acos(cosd(m.beta) * cosd(m.lambda - s.lambda)); // elongation (rad)
    const R = s.distanceAU * AU_KM, Dm = m.distanceKm;
    const i = Math.atan2(R * Math.sin(psi), Dm - R * Math.cos(psi)); // phase angle (rad)
    return {
      phaseAngle: i * R2D,
      illuminated: (1 + Math.cos(i)) / 2,
      elongation: psi * R2D,
      phaseLongitude: dl,                                        // 0–360 through the month
      waxing: dl < 180,
      sun: s, moon: m,
    };
  }

  function phaseName(dl) {
    const names = ["New Moon", "Waxing crescent", "First quarter", "Waxing gibbous",
      "Full Moon", "Waning gibbous", "Last quarter", "Waning crescent"];
    return names[Math.floor(norm360(dl + 22.5) / 45) % 8];
  }

  /** Time (JD) when the Moon–Sun longitude difference equals `target` deg,
   *  searching from `jd` in `direction` (+1 next, -1 previous). */
  function findLunarPhase(jd, target, direction) {
    const rate = 360 / 29.530588853;                              // deg / day (mean)
    const cur = moonPhase(jd).phaseLongitude;
    let delta = norm360((target - cur) * direction);
    if (delta < 1e-6) delta = 360;
    let t = jd + (direction * delta) / rate;
    for (let k = 0; k < 8; k++) {                                // Newton refinement
      const diff = ((moonPhase(t).phaseLongitude - target + 540) % 360) - 180;
      t -= diff / rate;
      if (Math.abs(diff) < 1e-5) break;
    }
    return t;
  }

  function moonAge(jd) { return jd - findLunarPhase(jd, 0, -1); }

  /** Apparent visual magnitude of the Moon (Allen; phase angle in degrees). */
  function moonMagnitude(phaseAngleDeg, distanceKm) {
    const a = Math.abs(phaseAngleDeg);
    return -12.73 + 0.026 * a + 4e-9 * a ** 4 + 5 * Math.log10(distanceKm / 384400);
  }

  // --------------------------------------------------------------- planets
  // [a, e, I, L, varpi, Omega] and rates per century (Standish 1992, table 1)
  const ELEMENTS = {
    mercury: [[0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593],
      [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081]],
    venus: [[0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255],
      [0.0000039, -0.00004107, -0.0007889, 58517.81538729, 0.00268329, -0.27769418]],
    earth: [[1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0],
      [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0]],
    mars: [[1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891],
      [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343]],
    jupiter: [[5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909],
      [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106]],
  };

  const PLANETS = {
    mercury: { name: "Mercury", diameter1AU: 6.74, color: [168, 160, 150], magnitude: (r, d, i) => -0.42 + 5 * Math.log10(r * d) + 0.038 * i - 0.000273 * i * i + 0.000002 * i ** 3 },
    venus: { name: "Venus", diameter1AU: 16.92, color: [240, 226, 190], magnitude: (r, d, i) => -4.4 + 5 * Math.log10(r * d) + 0.0009 * i + 0.000239 * i * i - 0.00000065 * i ** 3 },
    mars: { name: "Mars", diameter1AU: 9.36, color: [214, 120, 72], magnitude: (r, d, i) => -1.52 + 5 * Math.log10(r * d) + 0.016 * i },
    jupiter: { name: "Jupiter", diameter1AU: 196.94, color: [222, 200, 168], magnitude: (r, d, i) => -9.4 + 5 * Math.log10(r * d) + 0.005 * i },
  };

  function solveKepler(M, e) {
    let E = M + e * Math.sin(M);
    for (let k = 0; k < 30; k++) {
      const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
      E -= dE;
      if (Math.abs(dE) < 1e-12) break;
    }
    return E;
  }

  /** Heliocentric ecliptic J2000 position (AU) from Keplerian elements. */
  function heliocentric(body, jd) {
    const [el, rate] = ELEMENTS[body];
    const T = centuries(jd);
    const [a, e, I, L, w, O] = el.map((v, k) => v + rate[k] * T);
    const M = (((L - w) % 360) + 540) % 360 - 180;
    const E = solveKepler(M * D2R, e);
    const xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
    const om = (w - O) * D2R, Om = O * D2R, inc = I * D2R;
    const co = Math.cos(om), so = Math.sin(om), cO = Math.cos(Om), sO = Math.sin(Om), ci = Math.cos(inc), si = Math.sin(inc);
    return {
      x: (co * cO - so * sO * ci) * xp + (-so * cO - co * sO * ci) * yp,
      y: (co * sO + so * cO * ci) * xp + (-so * sO + co * cO * ci) * yp,
      z: so * si * xp + co * si * yp,
    };
  }

  /** Everything needed to show a planet's phase as seen from Earth. */
  function planetPhase(body, jd) {
    const p = heliocentric(body, jd), e = heliocentric("earth", jd);
    const g = { x: p.x - e.x, y: p.y - e.y, z: p.z - e.z };
    const r = Math.hypot(p.x, p.y, p.z), delta = Math.hypot(g.x, g.y, g.z), R = Math.hypot(e.x, e.y, e.z);
    // phase angle: angle Sun–planet–Earth
    const cosI = (r * r + delta * delta - R * R) / (2 * r * delta);
    const i = Math.acos(Math.max(-1, Math.min(1, cosI))) * R2D;
    // elongation: angle Sun–Earth–planet
    const cosEl = (R * R + delta * delta - r * r) / (2 * R * delta);
    const elong = Math.acos(Math.max(-1, Math.min(1, cosEl))) * R2D;
    const lambda = norm360(Math.atan2(g.y, g.x) * R2D);
    const beta = Math.asin(g.z / delta) * R2D;
    const sunLambda = norm360(Math.atan2(-e.y, -e.x) * R2D);
    const info = PLANETS[body];
    return {
      body, name: info.name, phaseAngle: i, illuminated: (1 + cosd(i)) / 2, elongation: elong,
      east: norm360(lambda - sunLambda) < 180,              // evening sky when east of the Sun
      distanceAU: delta, sunDistanceAU: r, lambda, beta, sunLambda,
      diameterArcsec: info.diameter1AU / delta,
      magnitude: info.magnitude(r, delta, i),
      helio: p, earth: e,
    };
  }

  // ------------------------------------------------------------ orientation
  /** Position angle of the bright limb, from celestial north through east (Meeus 48.5). */
  function brightLimbAngle(sunEq, bodyEq) {
    const a0 = sunEq.ra * D2R, d0 = sunEq.dec * D2R, a = bodyEq.ra * D2R, d = bodyEq.dec * D2R;
    const num = Math.cos(d0) * Math.sin(a0 - a);
    const den = Math.sin(d0) * Math.cos(d) - Math.cos(d0) * Math.sin(d) * Math.cos(a0 - a);
    return norm360(Math.atan2(num, den) * R2D);
  }

  /** Parallactic angle and altitude for an observer (lat, lon east, deg). */
  function horizon(jd, eq, lat, lon) {
    const H = norm360(gmst(jd) + lon - eq.ra) * D2R;
    const phi = lat * D2R, dec = eq.dec * D2R;
    const q = Math.atan2(Math.sin(H), Math.tan(phi) * Math.cos(dec) - Math.sin(dec) * Math.cos(H));
    const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
    return { parallactic: q * R2D, altitude: alt * R2D };
  }

  /** Equatorial coordinates (equinox of date) of the Sun, Moon or a planet. */
  function equatorial(body, jd) {
    const eps = obliquity(jd);
    if (body === "sun") { const s = sun(jd); return eclipticToEquatorial(s.lambda, 0, eps); }
    if (body === "moon") { const m = moon(jd); return eclipticToEquatorial(m.lambda, m.beta, eps); }
    const p = planetPhase(body, jd);
    // J2000 ecliptic -> approximate equinox of date (precession in longitude)
    const prec = 1.396971 * centuries(jd);
    return eclipticToEquatorial(norm360(p.lambda + prec), p.beta, eps);
  }

  return {
    D2R, R2D, AU_KM, norm360, julianDay, fromJulianDay, obliquity, gmst, eclipticToEquatorial,
    sun, moon, moonPhase, phaseName, findLunarPhase, moonAge, moonMagnitude,
    PLANETS, heliocentric, planetPhase, brightLimbAngle, horizon, equatorial,
  };
});
