/* cc-fairness-check.mjs — proves the gate-on-obstacle fairness fix (Jason: "don't spawn a gate on
 * top of an obstacle"). Drives the real CCSim spawn+advance loop for ~180s across several seeds and
 * asserts no active obstacle is ever within GATE_CLEAR of an active gate. Ends with a negative control
 * (disable the skip + sweep) that MUST produce violations, proving the test actually bites.
 * Run from the project dir so cc.js + globals resolve. No THREE, no jsdom needed (sim is renderer-free). */
import fs from "fs";
globalThis.window = globalThis.window || globalThis;
(0, eval)(fs.readFileSync("./cc.js", "utf8"));
const CC = globalThis.window.CC;
const CFG = CC.CONFIG, CLEAR = CFG.GATE_CLEAR;

function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;var t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
function makeRng(seed){const f=mulberry32(seed);return {next:f,int:(n)=>Math.floor(f()*n)};}

let pass=0, fail=0; const errs=[];
function ok(name,cond){ if(cond){pass++;} else {fail++;errs.push(name);} console.log((cond?"  \u2713 ":"  \u2717 ")+name); }

function run(seed){
  const sim = new CC.CCSim({ rng: makeRng(seed) });
  let minSep = Infinity, violations = 0, gatesSeen = 0;
  const dt = 1/60;
  for (let frame=0; frame<60*180; frame++){
    sim.shields = 99;                                  // never let a stray crash end the run
    const adv = sim.speed * dt;
    sim.distance += adv;
    sim.speed = Math.min(CFG.MAX_SPEED, CFG.BASE_SPEED + sim.distance * CFG.SPEED_RAMP);
    sim.scoreDistance += CFG.SCORE_SPEED * dt;          // 04 task 7: gates now trigger on scored distance, not raw distance
    sim._advanceObstacles(adv);
    const gi = sim.gates.items;
    for (let i=0;i<gi.length;i++){ const g=gi[i]; if(g.active){ g.z -= adv; if(g.z < CFG.CULL_BEHIND) sim.gates.release(g); } } // advance gates w/o the question pause
    sim._maybeSpawn();
    const oi = sim.obstacles.items;
    for (let a=0;a<gi.length;a++){ const g=gi[a]; if(!g.active) continue; gatesSeen++;
      for (let b=0;b<oi.length;b++){ const o=oi[b]; if(!o.active) continue; const sep=Math.abs(g.z-o.z); if(sep<minSep) minSep=sep; if(sep < CLEAR-0.5) violations++; } }
  }
  return { violations, minSep, gatesSeen };
}

console.log("CC fairness — gates never overlap obstacles:");
for (const seed of [1,7,42,1337,99999]){
  const r = run(seed);
  ok(`seed ${seed}: gates do spawn (frames touched ${r.gatesSeen})`, r.gatesSeen>0);
  ok(`seed ${seed}: 0 obstacles within GATE_CLEAR of a gate (minSep=${r.minSep===Infinity?"n/a":r.minSep.toFixed(1)})`, r.violations===0);
}

// ---- negative control: without the skip + sweep, obstacles WILL land on gates ----
console.log("\nNegative control (skip+sweep disabled -> expect violations):");
const realNear = CC.CCSim.prototype._nearGateZone, realClear = CC.CCSim.prototype._clearObstaclesNear;
CC.CCSim.prototype._nearGateZone = function(){ return false; };
CC.CCSim.prototype._clearObstaclesNear = function(){};
const neg = run(42);
ok(`control: disabling fairness produces overlaps (violations=${neg.violations})`, neg.violations>0);
CC.CCSim.prototype._nearGateZone = realNear; CC.CCSim.prototype._clearObstaclesNear = realClear;

// ---- solvability: every obstacle row must leave at least one (lane, action) that clears ALL its
// obstacles. This is the invariant OB_PINCH must not break — it seals lanes 0 and 2, so the center
// (lane 1) has to stay clearable or the runner becomes a death trap. Captures each _spawnRow call's
// obstacles as a unit (rows spawn at similar zAhead, so we group by call, not by z). ----
function rowEscapable(sim, obs) {
  const actions = ['stand', 'jump', 'duck'];
  for (let lane = 0; lane < 3; lane++) {
    for (const act of actions) {
      let clears = true;
      for (const o of obs) { if (sim._wouldHit(o, lane, act)) { clears = false; break; } }
      if (clears) return true;
    }
  }
  return false;
}
function solvable(seed) {
  const sim = new CC.CCSim({ rng: makeRng(seed) });
  const allRows = []; let curRow = null;
  const realRow = sim._spawnRow.bind(sim), realPlace = sim._placeObstacle.bind(sim);
  sim._placeObstacle = function (type, lane, side, zAhead) {
    realPlace(type, lane, side, zAhead);
    if (curRow) curRow.push({ type: type, lane: lane, side: side, x: (lane - 1) * CFG.LANE_W, z: zAhead, active: true });
  };
  sim._spawnRow = function (zAhead) {
    curRow = []; realRow(zAhead);
    // (v0.160.0, CC#5) group by z-CLUSTER, not by call: a chain's wall and arch sit ~CHAIN_GAP
    // apart (two separate action moments — jump, then duck); same-z composites stay one unit.
    if (curRow.length) {
      curRow.sort((a, b) => a.z - b.z);
      let cluster = [curRow[0]];
      for (let ci = 1; ci < curRow.length; ci++) {
        if (curRow[ci].z - cluster[cluster.length - 1].z <= 16) cluster.push(curRow[ci]);
        else { allRows.push(cluster); cluster = [curRow[ci]]; }
      }
      allRows.push(cluster);
    }
    curRow = null;
  };
  const dt = 1 / 60;
  for (let frame = 0; frame < 60 * 120; frame++) {
    sim.shields = 99; const adv = sim.speed * dt; sim.distance += adv;
    sim.speed = Math.min(CFG.MAX_SPEED, CFG.BASE_SPEED + sim.distance * CFG.SPEED_RAMP);
    sim._advanceObstacles(adv); sim._maybeSpawn();
  }
  let dead = 0;
  for (const obs of allRows) { if (!rowEscapable(sim, obs)) dead++; }
  return { total: allRows.length, dead: dead };
}
// ---- (v0.47.0) the jump obstacle is a FULL-WIDTH wall: standing hits in EVERY lane, jumping clears in EVERY lane ----
console.log("\nJump wall (v0.47.0) — full-width + jumpable:");
{
  const sim = new CC.CCSim({ rng: makeRng(5) });
  const wall = { type: 1 /*OB_LOWROCK*/, lane: 1, side: 0, x: 0, z: 10, active: true };
  let standAll = true, jumpAll = true, duckAny = false;
  for (let lane = 0; lane < 3; lane++) {
    if (!sim._wouldHit(wall, lane, 'stand')) standAll = false;
    if (sim._wouldHit(wall, lane, 'jump')) jumpAll = false;
    if (!sim._wouldHit(wall, lane, 'duck')) duckAny = true;   // ducking must NOT clear it
  }
  ok("standing hits the wall in every lane (no lane escape)", standAll);
  ok("jumping clears the wall in every lane", jumpAll);
  ok("ducking does NOT clear the wall (it's the arch's mirror)", !duckAny);
  ok("wall top raised to 1.25 (Jason: a lot bigger)", CFG.ROCK_H === 1.25);
}

// ---- (v0.160.0, V1.1 CC#5) the two new types ----
console.log("\nCC#5 — CHAIN (jump-then-duck) and ROCKFALL (telegraphed lane seal):");
{
  const sim = new CC.CCSim({ rng: makeRng(9) });
  const placed = [];
  const rp = sim._placeObstacle.bind(sim);
  sim._placeObstacle = function (t, l, s, z) { placed.push({ t, l, z }); return rp(t, l, s, z); };
  sim._spawnChain(100);
  ok("chain = jump wall then arch exactly CHAIN_GAP apart (34m: land the jump, then duck)",
    placed.length === 2 && placed[0].t === 1 && placed[1].t === 2 && placed[1].z - placed[0].z === CFG.CHAIN_GAP);
  ok("chain spacing clears the jump arc with margin (CHAIN_GAP > MAX_SPEED * JUMP_TIME * 0.55)",
    CFG.CHAIN_GAP > CFG.MAX_SPEED * CFG.JUMP_TIME * 0.55 && CFG.CHAIN_GAP > 16);
  const rf = { type: 4, lane: 2, side: 0, x: CFG.LANE_W, z: 80, z0: 200, active: true };
  ok("airborne rockfall has NO hitbox in any lane/action (the warning window is real)",
    ['stand', 'jump', 'duck'].every((a) => [0, 1, 2].every((l) => {
      const hit = sim._hitsObstacle(rf, { x: (l - 1) * CFG.LANE_W, y: a === 'jump' ? CFG.JUMP_HEIGHT : 0, topY: a === 'duck' ? CFG.PLAYER_DUCK_H : CFG.PLAYER_H });
      return !hit;
    })));
  rf.z = CFG.ROCKFALL_LAND_Z - 1;
  ok("landed rockfall seals EXACTLY its lane (any action), the other two stay open",
    sim._wouldHit(rf, 2, 'stand') && sim._wouldHit(rf, 2, 'jump') && sim._wouldHit(rf, 2, 'duck')
    && !sim._wouldHit(rf, 0, 'stand') && !sim._wouldHit(rf, 1, 'stand'));
}

console.log("\nSolvability — every obstacle row leaves an escape lane (covers OB_PINCH center):");
for (const seed of [1, 7, 42, 1337]) {
  const r = solvable(seed);
  ok(`seed ${seed}: ${r.total} rows spawned, 0 unescapable (pinch center stays open)`, r.dead === 0 && r.total > 0);
}
// negative control: a pinch that also seals the center (lane 1) MUST produce unescapable rows
console.log("\nNegative control (pinch seals the center too -> expect unescapable rows):");
const realPinch = CC.CCSim.prototype._spawnPinch;
CC.CCSim.prototype._spawnPinch = function (zAhead) {
  this._placeObstacle(0, 0, 0, zAhead); this._placeObstacle(0, 2, 1, zAhead); this._placeObstacle(0, 1, 0, zAhead);
};
const negS = solvable(42);
ok(`control: sealing the center produces unescapable rows (dead=${negS.dead})`, negS.dead > 0);
CC.CCSim.prototype._spawnPinch = realPinch;

// ---- (v0.56.0) OB_SWEEP: the panning beam. Solvability is WORST-CASE phase (the beam can be
// over any lane at crossing time) so jump must be the guaranteed out in every lane; live
// collision stays phase-honest (only the occupied lane is hot). ----
console.log("\nSweeper (v0.56.0) — panning low beam, jump is the guaranteed out:");
{
  const sim = new CC.CCSim({ rng: makeRng(9) });
  const sw = { type: 3 /*OB_SWEEP*/, lane: 1, side: 0, x: 0, z: 10, active: true, sweepPhase: 0.7, span: 1, tested: false };
  let standAll = true, jumpAll = true, duckAny = false;
  for (let lane = 0; lane < 3; lane++) {
    if (!sim._wouldHit(sw, lane, 'stand')) standAll = false;
    if (sim._wouldHit(sw, lane, 'jump')) jumpAll = false;
    if (!sim._wouldHit(sw, lane, 'duck')) duckAny = true;
  }
  ok("worst case: standing can be hit in every lane (the beam pans all three)", standAll);
  ok("jumping clears the beam in every lane (the guaranteed out)", jumpAll);
  ok("ducking does NOT clear it (a low beam, not an arch)", !duckAny);
  const hot = [0, 1, 2].filter(lane => sim._hitsObstacle(sw, { x: (lane - 1) * CFG.LANE_W, y: 0, topY: CFG.PLAYER_H }));
  ok(`live phase: exactly one lane is hot at a time (lane-dodge is real skill; hot=${hot.join(",")})`, hot.length === 1);
  let seen = 0;
  {
    const sim2 = new CC.CCSim({ rng: makeRng(11) });
    const realPlace = sim2._placeObstacle.bind(sim2);
    sim2._placeObstacle = function (type, lane, side, z) { if (type === 3) seen++; return realPlace(type, lane, side, z); };
    const dt = 1 / 60;
    for (let f = 0; f < 60 * 120; f++) { sim2.shields = 99; const adv = sim2.speed * dt; sim2.distance += adv; sim2.speed = Math.min(CFG.MAX_SPEED, CFG.BASE_SPEED + sim2.distance * CFG.SPEED_RAMP); sim2._advanceObstacles(adv); sim2._maybeSpawn(); }
  }
  ok(`sweepers enter the live spawn stream (${seen} in 120s)`, seen > 0);
}

console.log("\n" + (fail===0 ? `CC FAIRNESS: ALL GREEN (${pass}/${pass})` : `CC FAIRNESS: ${fail} FAILED`));
if (fail) { for (const e of errs) console.log("   - "+e); process.exit(1); }
