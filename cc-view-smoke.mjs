/* cc-view-smoke.mjs — constructs CCView against a minimal mock of THREE (r128 surface)
 * and drives the full render path. The jsdom build verifier never reaches CCView (no WebGL
 * context -> CC falls back), so runtime errors in the 3D view code are otherwise invisible.
 * This proves CCView builds, renders many frames over a live sim, runs the intro camera,
 * resizes and disposes WITHOUT THROWING. It does NOT check visual correctness (that needs a
 * real browser) — only that the view code is structurally sound. No WebGL is created. */
import fs from "fs";

// ---- minimal THREE mock -----------------------------------------------------
class Vec {
  constructor(x, y, z) { this.x = x || 0; this.y = y || 0; this.z = z || 0; }
  set(x, y, z) { this.x = x || 0; this.y = y || 0; this.z = z || 0; return this; }
}
class Mat4 {
  makeScale() { return this; }
  compose() { return this; }
}
class Quat {
  set() { return this; }
  setFromAxisAngle() { return this; }
}
function colorObj(hex) { return { value: hex || 0, setHex(h) { this.value = h; return this; } }; }
function tex() {
  return {
    wrapS: 0, wrapT: 0, encoding: 0, anisotropy: 0, needsUpdate: false,
    map: null, normalMap: null,
    repeat: new Vec(1, 1), offset: new Vec(0, 0),
    dispose() {}
  };
}
class Node3D {
  constructor() {
    this.position = new Vec(); this.rotation = new Vec(); this.scale = new Vec(1, 1, 1);
    this.visible = true; this.children = [];
  }
  add(c) { this.children.push(c); return this; }
}
function geom() { return { dispose() {} }; }
function material(opts) {
  opts = opts || {};
  return {
    color: colorObj(opts.color), emissive: colorObj(opts.emissive),
    emissiveIntensity: opts.emissiveIntensity, roughness: opts.roughness, metalness: opts.metalness,
    fog: opts.fog,                                  // (P2·2) peaks pin needs the near-row fog opt-out visible
    map: null, normalMap: null, normalScale: new Vec(1, 1),
    dispose() {}
  };
}
function instanceMatrix() {
  return { count: 0, needsUpdate: false, setUsage() {} };
}
class InstancedMesh extends Node3D {
  constructor(g, m, count) { super(); this.geometry = g; this.material = m; this.count = count; this.frustumCulled = true; this.instanceMatrix = instanceMatrix(); this.instanceMatrix.count = count; }
  setMatrixAt() {}
  dispose() {}
}
class Renderer {
  constructor() {}
  setPixelRatio() {} setSize() {} setClearColor() {} render() {} dispose() {}
  getContext() { return null; }
}
const THREE = {
  // constants
  sRGBEncoding: 1, RepeatWrapping: 1000, MirroredRepeatWrapping: 1002, DynamicDrawUsage: 35048,
  // math
  Vector3: Vec, Quaternion: Quat, Matrix4: Mat4,
  // scene graph
  Scene: class extends Node3D { constructor() { super(); this.fog = null; this.background = null; } },
  Group: Node3D, Mesh: class extends Node3D { constructor(g, m) { super(); this.geometry = g; this.material = m; } },
  InstancedMesh,
  PerspectiveCamera: class { constructor() { this.position = new Vec(); this.aspect = 1; } lookAt() {} updateProjectionMatrix() {} },
  // lights
  HemisphereLight: class extends Node3D {}, DirectionalLight: class extends Node3D {},
  AmbientLight: class extends Node3D {}, PointLight: class extends Node3D {},
  // materials / color / fog
  MeshStandardMaterial: function (o) { return material(o); },
  MeshBasicMaterial: function (o) { return material(o); },
  Color: function (h) { return colorObj(h); },
  Fog: function () { return {}; },
  // geometry
  PlaneGeometry: geom, BoxGeometry: geom, ConeGeometry: geom, CylinderGeometry: geom,
  TorusGeometry: geom, CircleGeometry: geom, OctahedronGeometry: geom, SphereGeometry: geom, RingGeometry: geom, BufferGeometry: geom,
  // textures / renderer
  TextureLoader: class { load(url) { (globalThis.__texLoads || (globalThis.__texLoads = [])).push(url); return tex(); } },
  WebGLRenderer: Renderer
};

// ---- load cc.js -------------------------------------------------------------
globalThis.window = globalThis;
globalThis.window.devicePixelRatio = 2;
// Provide (mock) assets so _rockMat sets .map/.normalMap and the texture-scroll branches
// (floor/wall/surface offset animation) are actually exercised — TextureLoader returns a mock
// texture regardless of URL, so any truthy string works. Without this those branches are skipped.
globalThis.window.STARNIX_ASSETS = { ccRock: "mock://rock", ccRockN: "mock://rockN", ccSky: "mock://sky", ccSurface: "mock://surface" };
(0, eval)(fs.readFileSync(new URL("./cc.js", import.meta.url), "utf8"));
const CC = globalThis.window.CC;

let fails = 0; const errs = [];
function ok(name, cond) { console.log((cond ? "  \u2713 " : "  \u2717 ") + name); if (!cond) fails++; }

// mock canvas
const canvas = { width: 1280, height: 720, clientWidth: 1280, clientHeight: 720, getContext() { return {}; } };

console.log("CCView smoke (mock THREE — builds, renders, intro, resize, dispose without throwing):");

let view = null, buildErr = null;
const sim = new CC.CCSim({ rng: CC.makeFallbackRng(7) });
try { view = new CC.CCView(THREE, sim, canvas, { reducedMotion: false }); }
catch (e) { buildErr = e; }
ok("CCView constructs", !buildErr && !!view);
ok("planet rim loads the ccSurface texture (distinct from canyon rock)", (globalThis.__texLoads || []).includes("mock://surface"));
if (buildErr) errs.push(buildErr);

if (view) {
  let runErr = null;
  try {
    // intro camera sweep
    for (const t of [0, 0.25, 0.5, 0.75, 1, 1.2]) view.setIntroCamera(t);
    // drive the sim + render for a while so every render branch (obstacles/coins/gates/ship/particles/scroll) runs
    for (let f = 0; f < 600; f++) {
      sim.step(1 / 120);
      if (sim.phase === "QUESTION") { sim.pending = null; sim.phase = "RUN"; }   // skip gate questions
      else if (sim.phase === "OVER") sim.reset();
      if (f % 50 === 0) view.spawnSparks(0, 0.6, 4, 8);                          // exercise particle pool
      view.render(1 / 60);
    }
    view.resize();
  } catch (e) { runErr = e; }
  ok("intro camera + 600 rendered frames + resize run clean", !runErr);
  if (runErr) errs.push(runErr);

  // ship-descent wiring (Jason's fly-in fix): the ship starts high above the chasm and lands at its
  // gameplay height by the end of the fly-in, so the intro reads as the ship diving INTO the chasm.
  view.setIntroCamera(0); ok("intro starts the ship high above the chasm (it descends in)", (view._introLift || 0) > 10);
  view.setIntroCamera(1); ok("intro ends with the ship at its gameplay height (descent = 0)", view._introLift === 0);

  // (v0.43.0) motion-continuity feel pass: camera follow, velocity bank easing, duck ease, landing squash
  {
    const p = sim.player;
    // camera follows a lane change laterally
    p.lane = 2; p.fromX = p.x; p.targetX = sim.cfg.LANE_W; p.laneT = 0;
    for (let f = 0; f < 60; f++) { sim.step(1 / 120); sim.step(1 / 120); view.applySpeedCamera(sim.speed, true, p.x, 1 / 60); view.render(1 / 60); }
    ok("feel: camera eased laterally toward the player's lane (C1)", view._camFX > sim.cfg.LANE_W * 0.25);
    ok("feel: ship banked during the change and eased back near zero after arrival (C2)", Math.abs(view._bank) < 0.08);
    // mid-tween bank is nonzero (velocity-driven)
    p.lane = 0; p.fromX = p.x; p.targetX = -sim.cfg.LANE_W; p.laneT = 0;
    let midBank = 0;
    for (let f = 0; f < 8; f++) { sim.step(1 / 120); view.applySpeedCamera(sim.speed, true, p.x, 1 / 120); view.render(1 / 120); if (f === 6) midBank = view._bank; }
    ok("feel: bank is engaged mid lane-change, signed toward motion (C2)", midBank < -0.1);
    for (let f = 0; f < 90; f++) { sim.step(1 / 120); view.render(1 / 120); }   // settle
    // duck eases instead of snapping
    p.ducking = true; view.render(1 / 60);
    ok("feel: duck factor eases (one frame is far from fully ducked) (C3)", view._duckF > 0 && view._duckF < 0.6);
    for (let f = 0; f < 40; f++) view.render(1 / 60);
    ok("feel: duck factor converges while held (C3)", view._duckF > 0.9);
    p.ducking = false; p.duckT = 0;
    for (let f = 0; f < 40; f++) view.render(1 / 60);
    ok("feel: duck factor releases back out (C3)", view._duckF < 0.1);
    // landing triggers squash + dip
    p.jumping = true; p.y = 1.2; view.render(1 / 60);
    p.jumping = false; p.y = 0; view.render(1 / 60);
    ok("feel: landing triggers the squash impulse (C4)", view._landT > 0.7);
    ok("feel: landing dips the camera (C4)", view._landDip > 0.05);
  }

  // (v0.47.0) telegraphs + futuristic gate + duck pitch
  ok("chevron telegraph meshes built (up=jump gold, down=duck aqua)", !!view.iChevUp && !!view.iChevDown);
  ok("gate energy films built (aqua + gold)", !!view.iGateFilm && !!view.iGateFilmPow && !!view._gateFilmMat);
  // (v0.56.0) sweeper hazard: beam + sideways-arrow telegraph meshes exist, and a live sweeper
  // renders many frames clean (its x pans as z shrinks — the render path recomputes per frame)
  ok("sweeper beam + side-arrow telegraph meshes built (peach)", !!view.iSweep && !!view.iChevSide);
  ok("C1/C2 (v0.101.0): arrow shafts + the scanner-drone emitter are instanced",
    !!view.iChevUpShaft && !!view.iChevDownShaft && !!view.iSweepHead);
  {
    const sw = sim._spawnSweep(60);
    let swErr = null;
    try { for (let f = 0; f < 90; f++) { if (sw) sw.z -= 0.5; view.render(1 / 60); } } catch (e) { swErr = e; }
    if (sw) sw.z = -50;                    // culled on the next advance; later sections unaffected
    ok("live sweeper renders 90 panning frames without throwing", !swErr);
    view.reducedMotion = true;
    const sw2 = sim._spawnSweep(40);
    let rmErr = null;
    try { for (let f = 0; f < 30; f++) view.render(1 / 60); } catch (e) { rmErr = e; }
    if (sw2) sw2.z = -50; view.reducedMotion = false;
    ok("reduced motion: sweeper + static telegraph render clean (no slide)", !rmErr);
  }
  // (v0.61.0 P2·2, PLAYTEST A2) craggy peaks: 30 ridge meshes (2 sides × 9 near + 6 far),
  // near row opted OUT of fog (true rock value), far row fogged (the haze layer). The crag
  // ROOT-CAUSE fix — cones must carry height segments or the jitter has no vertices to move —
  // is pinned at source level so a refactor can't silently regress it back to smooth cones.
  {
    ok("peaks: 30 ridge meshes across both sides", !!view.peaks && view.peaks.children.length === 30);
    ok("peaks: near row keeps true rock value (fog:false), far row rides the haze",
      !!view._peakMatNear && view._peakMatNear.fog === false
      && !!view._peakMatFar && view._peakMatFar.fog !== false
      && view._peakMatNear.color.value !== view._peakMatFar.color.value);
    const src = fs.readFileSync("./cc.js", "utf8");
    ok("peaks: crag amplitude + height-segmented cones pinned at source (the no-op-jitter root cause)",
      /CRAG_AMT = 0\.42/.test(src) && /ConeGeometry\(r, h, 7, 4\)/.test(src) && /ConeGeometry\(rk, hk, 6, 3\)/.test(src));
    // (P2·3, PLAYTEST A7) corridor end-cap: fog-colored, fog-exempt plane sealing the vanishing point
    ok("end-cap: fog-colored plane seals the corridor (no bare backdrop column)",
      !!view._endCap && !!view._endCap.material && view._endCap.material.fog === false
      && view._endCap.position.z < -(sim.cfg.DRAW_DIST - 10));
  }

  // (v0.104.0, C10) barrel roll: additive full spin over _bank; reduced motion never spins
  {
    view._bank = 0.1; view._rollT = 0;
    view.startBarrelRoll(1);
    ok("startBarrelRoll arms the spin", view._rollT === 1 && view._rollDir === 1);
    let peaked = 0;
    for (let f = 0; f < 40; f++) { view.render(1 / 60); peaked = Math.max(peaked, Math.abs(view.ship.rotation.z - view._bank)); }
    ok("the roll sweeps a full turn additively over _bank (peak " + peaked.toFixed(2) + " rad)", peaked > 4.5);
    const saved = view.reducedMotion; view.reducedMotion = true; view._rollT = 0;
    view.startBarrelRoll(1);
    ok("reduced motion: no spin", view._rollT === 0);
    view.reducedMotion = saved;
  }

  // (v0.77.0, JB5) the speed shake CYCLES per 40 km window: near-max just before a boundary,
  // near-zero right after it (Jason: intensity must relent, not pin at max)
  {
    sim.speed = sim.cfg.MAX_SPEED;
    sim.scoreDistance = 39.9 * 1000;
    view.applySpeedCamera(sim.speed, true, 0, 1 / 60);
    const nearMax = view._lastShakeAmp;
    sim.scoreDistance = 40.1 * 1000;
    view.applySpeedCamera(sim.speed, true, 0, 1 / 60);
    const reset = view._lastShakeAmp;
    ok("shake cycles at the 40 km boundary (" + nearMax.toFixed(4) + " -> " + reset.toFixed(4) + ")",
      nearMax > 0.02 && reset < nearMax * 0.05);
    sim.scoreDistance = 0;
  }

  // (v0.57.0) mastery cosmetic: the boost plume takes the shell-resolved trail tint at
  // construction; stock stays gold. (Mock materials record the constructed color.)
  {
    ok("stock plume is gold (no cosmetic set)", !!view.shipPlumeMat && view.shipPlumeMat.color && view.shipPlumeMat.color.value === 0xFFC857);
    let v2 = null, v2err = null;
    try { v2 = new CC.CCView(THREE, sim, canvas, { reducedMotion: false, shipTrailColor: "#92DD23" }); } catch (e) { v2err = e; }
    ok("trail-tinted view builds; plume wears the mastery color", !v2err && !!v2 && v2.shipPlumeMat.color.value === 0x92DD23);
    try { if (v2) v2.dispose(); } catch (e) {}
  }
  {
    sim.player.ducking = true;
    for (let f = 0; f < 30; f++) view.render(1 / 60);
    ok("ducking pitches the nose down (dive-under read)", view.ship.rotation.x > 0.15);
    // (v0.72.0, J4) the rework's contract: STEEP dive, NO deflate, afterburner flare
    ok("J4: full duck is a steep power-dive (pitch >= 0.4) with ZERO vertical squash",
       view.ship.rotation.x >= 0.4 && view.ship.scale.y === 1);
    ok("J4: the plume flares as an afterburner during the dive", !!view.shipPlume && view.shipPlume.visible === true);
    sim.player.ducking = false; sim.player.duckT = 0;
    for (let f = 0; f < 40; f++) view.render(1 / 60);
    ok("pitch releases when the duck ends", view.ship.rotation.x < 0.05);
  }

  let dispErr = null;
  try { view.dispose(); } catch (e) { dispErr = e; }
  ok("dispose runs clean (frees disposables, nulls scene/camera/renderer)", !dispErr);
  if (dispErr) errs.push(dispErr);
}

if (errs.length) console.log("\nERRORS:\n" + errs.map((e) => (e && e.stack) || String(e)).join("\n\n"));
console.log("\n" + (fails ? ("CC VIEW SMOKE: " + fails + " FAIL") : "CC VIEW SMOKE: ALL GREEN"));
process.exit(fails ? 1 : 0);
