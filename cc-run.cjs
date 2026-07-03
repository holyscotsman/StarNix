/* cc-run.cjs — the CC engine run-through harness (Phase 2 · iteration 4; the debt-list
 * parity leg beside kbb-run.cjs and arm-run.cjs). CCSim is renderer-free, so this drives
 * the REAL sim class headlessly — no jsdom, no THREE: reset state, spawn discipline, live
 * per-type collision truths (incl. the sweeper's phase-honest lane), the full gate-question
 * flow (right/wrong/cap/drain-to-game-over), the every-5-gates boost, crash + i-frames, and
 * same-seed determinism. Deterministic (seeded). Run: node cc-run.cjs | CC_SEED=n overrides.
 */
'use strict';
var fs = require('fs');
globalThis.window = globalThis.window || globalThis;
(0, eval)(fs.readFileSync('./cc.js', 'utf8'));
var CC = globalThis.window.CC;
var CFG = CC.CONFIG, E = CC._enums;

var SEED = parseInt(process.env.CC_SEED || '13', 10);

var fails = 0, total = 0;
function group(t) { console.log('\n' + t); }
function ok(cond, name) { total++; console.log((cond ? '  ✓ ' : '  ✗ ') + name + (cond ? '' : '  <-- FAIL')); if (!cond) fails++; }

function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function makeRng(seed) { var f = mulberry32(seed); return { next: f, int: function (n) { return Math.floor(f() * n); } }; }
function makeBank() { var qs = []; for (var d = 1; d <= 3; d++) for (var i = 0; i < 200; i++) qs.push({ id: 'q' + d + '-' + i, difficulty: d, domain: 'storage', options: ['a', 'b', 'c', 'd'], correctIndex: 0, stem: 's', explanation: 'e' }); return qs; }
function makeCtx(seed) {
  var rnd = mulberry32((seed * 7 + 1) >>> 0), bank = makeBank();
  var rec = { mastery: [], telemetry: [] };
  return {
    rng: makeRng(seed),
    questions: { next: function (o) { var ex = new Set((o && o.excludeIds) || []); var pool = bank.filter(function (q) { return !ex.has(q.id); }); if (!pool.length) pool = bank; return { question: pool[Math.floor(rnd() * pool.length)], reason: 'probe' }; } },
    mastery: { record: function (id, c) { rec.mastery.push({ id: id, c: !!c }); } },
    telemetry: { emit: function (e) { rec.telemetry.push(e); } },
    _rec: rec
  };
}
function mkSim(seed) { return new CC.CCSim({ rng: makeRng(seed), ctx: makeCtx(seed) }); }
function stepFor(sim, secs) { var dt = 1 / 60, n = Math.round(secs * 60); for (var i = 0; i < n && sim.phase !== 'OVER'; i++) { sim.step(dt); if (sim.phase !== 'RUN') break; } }
function runToQuestion(sim, maxSecs, pinShields) {
  // the probe player never dodges, so obstacle chip-damage would kill it long before the
  // 10 km gate — pin shields during travel; graded deltas are then measured off the pin.
  var dt = 1 / 60, n = Math.round((maxSecs || 60) * 60);
  for (var i = 0; i < n; i++) {
    if (pinShields != null && sim.phase === 'RUN') sim.shields = pinShields;
    sim.step(dt);
    if (sim.phase === 'QUESTION') return true;
    if (sim.phase === 'OVER') return false;
  }
  return false;
}

/* ============ 1) RESET + SPAWN DISCIPLINE ============ */
(function resetSpawn() {
  group('RESET + SPAWN: clean state, row gaps, gate cadence');
  var sim = mkSim(SEED);
  ok(sim.phase === 'RUN' && sim.shields === CFG.SHIELDS_START && sim.distance === 0 && Math.floor(sim.scoreDistance) === 0,
     'reset: RUN phase, full shields (' + CFG.SHIELDS_START + '), zero distance/score');
  var rows = [];
  var realRow = sim._spawnRow.bind(sim);
  sim._spawnRow = function (zAhead) { rows.push(this.distance + zAhead); realRow(zAhead); };
  sim.shields = 99;                                     // survive the probe
  var dt = 1 / 60;
  for (var i = 0; i < 60 * 40; i++) { sim.step(dt); if (sim.phase === 'QUESTION') { sim.answer(0); sim.resumeAfterQuestion(); } }
  var minGap = 1e9;
  for (var r = 1; r < rows.length; r++) minGap = Math.min(minGap, rows[r] - rows[r - 1]);
  ok(rows.length >= 8 && minGap >= CFG.MIN_GAP - 0.01,
     'rows keep discrete-action spacing: ' + rows.length + ' rows, min gap ' + minGap.toFixed(1) + ' >= MIN_GAP ' + CFG.MIN_GAP);
  ok(sim._gatesSpawned >= 1, 'gates enter on the scored-distance cadence (' + sim._gatesSpawned + ' in 40s)');
})();

/* ============ 2) LIVE COLLISION TRUTHS (per type, via _hitsObstacle) ============ */
(function liveCollision() {
  group('LIVE COLLISION: wall/arch/narrow/sweeper ground truths');
  var sim = mkSim(SEED + 1);
  var stand = function (lane) { return { x: (lane - 1) * CFG.LANE_W, y: 0, topY: CFG.PLAYER_H }; };
  var jumper = function (lane) { return { x: (lane - 1) * CFG.LANE_W, y: CFG.JUMP_HEIGHT, topY: CFG.JUMP_HEIGHT + CFG.PLAYER_H }; };
  var ducker = function (lane) { return { x: (lane - 1) * CFG.LANE_W, y: 0, topY: CFG.PLAYER_DUCK_H }; };
  var wall = { type: E.OB_LOWROCK, lane: 1, side: 0, x: 0, z: 0, active: true, span: 1, sweepPhase: 0 };
  var arch = { type: E.OB_ARCH, lane: 1, side: 0, x: 0, z: 0, active: true, span: 1, sweepPhase: 0 };
  var narrowL = { type: E.OB_NARROW, lane: 0, side: E.SIDE_LEFT, x: -CFG.LANE_W, z: 0, active: true, span: 1, sweepPhase: 0 };
  ok([0, 1, 2].every(function (l) { return sim._hitsObstacle(wall, stand(l)) && !sim._hitsObstacle(wall, jumper(l)); }),
     'wall: grounded hits in every lane, a jumper clears in every lane');
  ok([0, 1, 2].every(function (l) { return sim._hitsObstacle(arch, stand(l)) && !sim._hitsObstacle(arch, ducker(l)); }),
     'arch: standing hits everywhere, ducking clears everywhere');
  ok(sim._hitsObstacle(narrowL, stand(0)) && !sim._hitsObstacle(narrowL, stand(1)) && !sim._hitsObstacle(narrowL, stand(2)),
     'narrow: only the sealed lane is hot');
  var sw = { type: E.OB_SWEEP, lane: 1, side: 0, x: 0, z: 10, active: true, span: 1, sweepPhase: 0.7 };
  var beamX = sim._sweepX(sw);
  var hot = [0, 1, 2].filter(function (l) { return sim._hitsObstacle(sw, stand(l)); });
  ok(hot.length === 1 && Math.abs((hot[0] - 1) * CFG.LANE_W - beamX) < CFG.LANE_W * 0.5,
     'sweeper live phase: EXACTLY the occupied lane is hot (lane ' + hot[0] + ' at beam x ' + beamX.toFixed(2) + ')');
  ok([0, 1, 2].every(function (l) { return !sim._hitsObstacle(sw, jumper(l)); }),
     'sweeper: a jumper clears it regardless of phase');
})();

/* ============ 3) GATE QUESTION FLOW: right/wrong/cap/drain ============ */
(function questionFlow() {
  group('QUESTION FLOW: gate pause, grading deltas, cap, drain to game over');
  var sim = mkSim(SEED + 2);
  ok(runToQuestion(sim, 90, CFG.SHIELDS_START), 'a gate reaches the ship and pauses the world into QUESTION');
  var q1 = sim.pending.question;
  var r1 = sim.answer((q1.correctIndex + 1) % 4);
  ok(r1 && r1.correct === false && r1.shieldDelta === -2 && sim.shields === CFG.SHIELDS_START - 2,
     'wrong gate answer costs exactly 2 shields (' + CFG.SHIELDS_START + ' -> ' + sim.shields + ')');
  ok(sim.phase === 'EXPLAIN', 'the world stays paused through the explanation');
  sim.resumeAfterQuestion();
  ok(sim.phase === 'RUN' && sim.iframe >= CFG.POST_Q_GRACE - 0.01, 'Continue resumes with post-question grace i-frames');
  ok(sim.ctx._rec.mastery.length === 1 && sim.ctx._rec.mastery[0].c === false
     && sim.ctx._rec.telemetry.some(function (e) { return e.t === 'question_answered' && e.correct === false; }),
     'grading routed through the shared mastery + telemetry providers');
  ok(runToQuestion(sim, 90, CFG.SHIELDS_START - 1), 'a second gate arrives');
  var q2 = sim.pending.question;
  var r2 = sim.answer(q2.correctIndex);
  ok(r2.correct === true && r2.shieldDelta === 1 && sim.shields === CFG.SHIELDS_START,
     'right answer restores exactly 1 shield (' + (CFG.SHIELDS_START - 1) + ' -> ' + sim.shields + ')');
  sim.resumeAfterQuestion();
  // cap: heal to full then one more right answer must not overfill
  sim.shields = CFG.SHIELDS_MAX;
  ok(runToQuestion(sim, 90, CFG.SHIELDS_MAX) && sim.answer(sim.pending.question.correctIndex).shieldDelta === 0 && sim.shields === CFG.SHIELDS_MAX,
     'shields cap at SHIELDS_MAX (a right answer at full heals 0)');
  sim.resumeAfterQuestion();
  // drain: wrong answers to zero -> game over, score = floored scored metres
  ok(runToQuestion(sim, 90, 2), 'a draining gate arrives');
  sim.answer((sim.pending.question.correctIndex + 1) % 4);
  ok(sim.phase === 'OVER' && sim.shields === 0 && sim.runStats.points === Math.floor(sim.scoreDistance),
     'shields hitting 0 at a gate ends the run; banked points = floored scored metres');
})();

/* ============ 4) BOOST: every 5th gate, invulnerable fast-forward ============ */
(function boost() {
  group('BOOST: fires on the 5th gate, invulnerable, covers the promised distance');
  var sim = mkSim(SEED + 3);
  sim._gatesPassed = CFG.GATES_PER_BOOST - 1;           // next gate is the trigger
  ok(runToQuestion(sim, 90, CFG.SHIELDS_MAX), 'the trigger gate arrives');
  sim.answer(sim.pending.question.correctIndex);
  var scoreBefore = sim.scoreDistance;
  sim.resumeAfterQuestion();
  ok(sim.boostActive === true, 'boost activates on resume after the 5th gate');
  stepFor(sim, CFG.BOOST_TIME + 1.5);
  ok(sim.boostActive === false, 'boost ends on its own once the distance is covered');
  var gained = sim.scoreDistance - scoreBefore;
  ok(gained >= CFG.BOOST_KM * 1000 * 0.95, 'boost covers ~' + CFG.BOOST_KM + ' scored km (+' + Math.round(gained / 1000) + ' km)');
})();

/* ============ 5) CRASH + I-FRAMES + DETERMINISM ============ */
(function crashDet() {
  group('CRASH + DETERMINISM: shield cost, chained-hit grace, same-seed identity');
  var sim = mkSim(SEED + 4);
  var o1 = sim._placeObstacle(E.OB_LOWROCK, 1, 0, 0.5);   // dead ahead, grounded player
  var s0 = sim.shields;
  sim.step(1 / 60);
  ok(sim.shields === s0 - 1 && sim.iframe > 0 && sim.collisions === 1,
     'crash costs 1 shield and grants i-frames (' + s0 + ' -> ' + sim.shields + ')');
  sim._placeObstacle(E.OB_LOWROCK, 1, 0, 0.4);
  sim.step(1 / 60);
  ok(sim.shields === s0 - 1 && sim.collisions === 1, 'i-frames block the chained second hit');
  function fingerprint(seed) {
    var s = mkSim(seed); s.shields = 99;
    var dt = 1 / 60;
    for (var i = 0; i < 60 * 30; i++) { s.step(dt); if (s.phase === 'QUESTION') { s.answer(s.pending.question.correctIndex); s.resumeAfterQuestion(); } }
    var obs = s.obstacles.items.filter(function (o) { return o.active; }).map(function (o) { return o.type + '@' + o.z.toFixed(2); }).join('|');
    return s.distance.toFixed(3) + '/' + s.scoreDistance.toFixed(1) + '/' + s._gatesSpawned + '/' + obs;
  }
  ok(fingerprint(SEED + 5) === fingerprint(SEED + 5), 'same seed -> identical 30s world fingerprint');
  ok(fingerprint(SEED + 5) !== fingerprint(SEED + 6), 'different seed -> different world');
})();

console.log('\n' + (fails ? ('CC RUN: ' + fails + ' FAILED of ' + total) : ('CC RUN: ALL GREEN (' + total + '/' + total + ')')));
if (fails) process.exit(1);
