/*
 * phase.js — illumination of a sphere and reflected-light phase curves.
 * Pure functions (no DOM), usable in the browser (window.Phase) and Node.
 *
 * Exoplanet geometry follows Winn (2010): orbital phase 0 = mid-transit
 * (inferior conjunction), 0.5 = secondary eclipse. The planet–star–observer
 * phase angle obeys cos(alpha) = -sin(omega + f) sin(i), and the reflected flux is
 *     F_p / F_star = A_g (R_p / r)^2 Phi(alpha),
 * where r is the instantaneous star–planet distance (matters for eccentric orbits).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Phase = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const R_SUN_AU = 0.00465047, R_EARTH_AU = 4.26352e-5, R_JUP_AU = 4.77895e-4;

  // ------------------------------------------------------ phase functions
  /** Lambert sphere phase function, normalised to 1 at full phase. */
  function lambert(alpha) {
    return (Math.sin(alpha) + (Math.PI - alpha) * Math.cos(alpha)) / Math.PI;
  }
  const illuminatedFraction = (alpha) => (1 + Math.cos(alpha)) / 2;

  /** Brightness of a point on the visible disk.
   *  (u, v): position on the disk (unit radius, u right, v up).
   *  alpha: phase angle (rad). (du, dv): unit screen vector towards the Sun.
   *  law: "lambert" or "lommel" (Lommel–Seeliger, good for the Moon's regolith). */
  function shade(u, v, alpha, du, dv, law) {
    const w2 = 1 - u * u - v * v;
    if (w2 < 0) return -1;                                       // outside the disk
    const w = Math.sqrt(w2);
    const s = Math.sin(alpha);
    const mu0 = s * (u * du + v * dv) + Math.cos(alpha) * w;      // cos(incidence)
    if (mu0 <= 0) return 0;
    if (law === "lommel") return mu0 / (mu0 + w + 1e-9) * 2;      // = 1 at full-phase centre
    return mu0;
  }

  // ---------------------------------------------------------- exoplanets
  function solveKepler(M, e) {
    M = ((M % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    let E = e < 0.8 ? M : Math.PI;
    for (let k = 0; k < 60; k++) {
      const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
      E -= dE;
      if (Math.abs(dE) < 1e-12) break;
    }
    return E;
  }

  function semiMajorAxis(periodDays, starMass) {
    return Math.cbrt(starMass * Math.pow(periodDays / 365.25, 2));
  }

  /** Planet state at orbital phase `ph` (0 = transit). `pl`: { inc, ecc, omega, a (AU) }. */
  function orbitState(ph, pl) {
    const e = pl.ecc || 0, w = (pl.omega ?? 90) * D2R, inc = pl.inc * D2R;
    const fT = Math.PI / 2 - w;                                  // true anomaly at transit
    const ET = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(fT / 2), Math.sqrt(1 + e) * Math.cos(fT / 2));
    const MT = ET - e * Math.sin(ET);
    const E = solveKepler(MT + 2 * Math.PI * ph, e);
    const f = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
    const r = pl.a * (1 - e * Math.cos(E));
    const X = -r * Math.cos(w + f), Y = -r * Math.sin(w + f) * Math.cos(inc), Z = r * Math.sin(w + f) * Math.sin(inc);
    const cosA = -Math.sin(w + f) * Math.sin(inc);
    return { r, X, Y, Z, f, alpha: Math.acos(Math.max(-1, Math.min(1, cosA))) };
  }

  /** Fraction of a disk of radius rp (centred at distance z) hidden by a disk of radius 1. */
  function hiddenFraction(rp, z) {
    if (z >= 1 + rp) return 0;
    if (z <= 1 - rp) return 1;
    const k0 = Math.acos(Math.min(1, Math.max(-1, (rp * rp + z * z - 1) / (2 * rp * z))));
    const k1 = Math.acos(Math.min(1, Math.max(-1, (1 - rp * rp + z * z) / (2 * z))));
    const area = rp * rp * k0 + k1 - 0.5 * Math.sqrt(Math.max(0, 4 * z * z - (1 + z * z - rp * rp) ** 2));
    return area / (Math.PI * rp * rp);
  }

  /** Reflected planet/star flux ratio at orbital phase `ph`, including secondary eclipse. */
  function reflectedFlux(ph, pl) {
    const s = orbitState(ph, pl);
    const rpAU = pl.rp;                                          // planet radius in AU
    let F = pl.albedo * (rpAU / s.r) ** 2 * lambert(s.alpha);
    let eclipsed = 0;
    if (s.Z < 0 && pl.rstar) {                                   // planet behind the star
      const z = Math.hypot(s.X, s.Y) / pl.rstar;
      eclipsed = hiddenFraction(rpAU / pl.rstar, z);
      F *= 1 - eclipsed;
    }
    return { F, alpha: s.alpha, r: s.r, eclipsed, state: s };
  }

  function transitGeometry(pl) {
    const e = pl.ecc || 0, w = (pl.omega ?? 90) * D2R;
    const b = (pl.a * Math.cos(pl.inc * D2R) / pl.rstar) * (1 - e * e) / (1 + e * Math.sin(w));
    const bOcc = (pl.a * Math.cos(pl.inc * D2R) / pl.rstar) * (1 - e * e) / (1 - e * Math.sin(w));
    const k = pl.rp / pl.rstar;
    return { b, transits: b < 1 + k, eclipses: bOcc < 1 + k, k };
  }

  /** Build the model planet from physical parameters. */
  function makePlanet(p) {
    const a = semiMajorAxis(p.period, p.mstar);
    const rp = p.radiusUnit === "jup" ? p.radius * R_JUP_AU : p.radius * R_EARTH_AU;
    return { ...p, a, rp, rstar: p.rstar * R_SUN_AU };
  }

  // -------------------------------------------------------------- presets
  // Radii in Earth (earth) or Jupiter (jup) radii; stellar mass/radius in solar units.
  // Albedos marked "measured" come from phase-curve or eclipse studies; others are assumptions.
  const EXOPLANETS = [
    { id: "kepler7b", name: "Kepler-7 b", period: 4.8855, mstar: 1.36, rstar: 1.843, radius: 1.61, radiusUnit: "jup", inc: 86.5, ecc: 0, omega: 90, albedo: 0.35,
      note: "A puffy hot Jupiter with reflective clouds: one of the few planets with a clearly measured optical albedo, A_g = 0.35 (Demory et al. 2013)." },
    { id: "hd209458b", name: "HD 209458 b", period: 3.52475, mstar: 1.148, rstar: 1.203, radius: 1.38, radiusUnit: "jup", inc: 86.71, ecc: 0, omega: 90, albedo: 0.04,
      note: "A very dark hot Jupiter: MOST photometry limits its albedo to below 0.08 (Rowe et al. 2008); 0.04 is used here." },
    { id: "wasp12b", name: "WASP-12 b", period: 1.09142, mstar: 1.43, rstar: 1.657, radius: 1.90, radiusUnit: "jup", inc: 83.4, ecc: 0, omega: 90, albedo: 0.05,
      note: "An ultra-hot Jupiter darker than asphalt: HST limits its albedo to below 0.064 (Bell et al. 2017)." },
    { id: "51pegb", name: "51 Peg b", period: 4.2308, mstar: 1.11, rstar: 1.15, radius: 1.2, radiusUnit: "jup", inc: 80, ecc: 0, omega: 90, albedo: 0.5,
      note: "The first hot Jupiter around a Sun-like star. It does not transit, so its radius (1.2 R♃) is assumed; reflected-light spectroscopy suggests a high albedo, ~0.5 (Martins et al. 2015)." },
    { id: "kepler10b", name: "Kepler-10 b", period: 0.83749, mstar: 0.91, rstar: 1.065, radius: 1.47, radiusUnit: "earth", inc: 84.4, ecc: 0, omega: 90, albedo: 0.5,
      note: "A lava world on a 20-hour orbit. Its optical phase curve implies a surprisingly bright surface; A_g = 0.5 is an assumption." },
    { id: "gj1214b", name: "GJ 1214 b", period: 1.58040, mstar: 0.178, rstar: 0.215, radius: 2.74, radiusUnit: "earth", inc: 88.98, ecc: 0, omega: 90, albedo: 0.3,
      note: "A hazy sub-Neptune around an M dwarf; A_g = 0.3 is an assumption." },
    { id: "k218b", name: "K2-18 b", period: 32.94, mstar: 0.359, rstar: 0.411, radius: 2.61, radiusUnit: "earth", inc: 89.58, ecc: 0.09, omega: 90, albedo: 0.3,
      note: "A temperate sub-Neptune studied by JWST; A_g = 0.3 is an assumption." },
    { id: "toi700d", name: "TOI-700 d", period: 37.426, mstar: 0.416, rstar: 0.42, radius: 1.07, radiusUnit: "earth", inc: 89.73, ecc: 0, omega: 90, albedo: 0.3,
      note: "An Earth-sized planet in its star’s habitable zone; A_g = 0.3 (Earth-like) is an assumption." },
  ];

  return {
    D2R, R2D, R_SUN_AU, R_EARTH_AU, R_JUP_AU,
    lambert, illuminatedFraction, shade, solveKepler, semiMajorAxis, orbitState,
    hiddenFraction, reflectedFlux, transitGeometry, makePlanet, EXOPLANETS,
  };
});
