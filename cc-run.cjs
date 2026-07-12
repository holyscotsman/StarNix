/* cc-run.cjs — the CC engine run-through harness (Phase 2 · iteration 4; the debt-list
 * parity leg beside kbb-run.cjs and arm-run.cjs). CCSim is renderer-free, so this drives
 * the REAL sim class headlessly — no jsdom, no THREE: reset state, spawn discipline, live
 * per-type collision truths (incl. the sweeper's phase-honest lane), the full gate-question
 * flow (right/wrong/cap/drain-to-game-over), the gate-cadence boost, crash + i-frames, and
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

/* ============ FAIRNESS INVARIANT (v0.108.0, G4): jumpability at max speed ============ */
(function minGap() {
  group('INVARIANT: MIN_GAP >= MAX_SPEED * JUMP_TIME (was pinned only in a dead suite)');
  ok(CFG.MIN_GAP >= CFG.MAX_SPEED * CFG.JUMP_TIME,
     'every row is jumpable on reaction at max speed (' + CFG.MIN_GAP + ' >= ' + (CFG.MAX_SPEED * CFG.JUMP_TIME).toFixed(1) + ')');
})();

/* ============ C4 (v0.104.0 / v0.132.0 CC#2): 90° turns players actually SEE ============ */
(function turns() {
  group('C4: turn warning, lane check, wall clip on miss');
  var sim = mkSim(SEED + 81), dt = 1 / 60;
  ok(CFG.TURN_KM <= 40 && CFG.TURN_KM >= 25, 'CC#2: turns land every ' + CFG.TURN_KM + ' km — inside a normal session, not once per 250 km');
  {  // the +5km-offset turn grid provably never collides with the ≡4-mod-10 gate grid
    var clash = false;
    for (var tw = 1; tw <= 12; tw++) { var ts = 5000 + tw * CFG.TURN_KM * 1000; if ((ts - CFG.FIRST_GATE_KM * 1000) % (CFG.GATE_KM * 1000) === 0 || ts % (CFG.GATE_KM * 1000) === 0) { clash = true; break; } }
    ok(!clash, 'CC#2: no turn score collides with a gate score across 12 windows');
  }
  // fast-forward to just before the first warning
  sim.scoreDistance = CFG.TURN_KM * 1000 + 5000 - CFG.SCORE_SPEED * CFG.TURN_WARN_S - 50;
  sim._nextGateScore = sim.scoreDistance + 20000;   // teleported score: skip the gate catch-up storm
  sim.shields = 5;
  for (var t = 0; t < 60 && !sim.turnPending; t++) { sim.step(dt); if (sim.phase === 'QUESTION') { sim.answer(0); sim.resumeAfterQuestion(); } }
  ok(!!sim.turnPending && (sim.turnPending.dir === 'left' || sim.turnPending.dir === 'right'),
     'warning arms ~' + CFG.TURN_WARN_S + 's ahead (dir ' + (sim.turnPending && sim.turnPending.dir) + ')');
  // park in the WRONG lane and cross the threshold
  var wrongLane = sim.turnPending.dir === 'right' ? 0 : 2;
  sim.player.lane = wrongLane; sim._retarget();
  var sh0 = sim.shields;
  for (var t2 = 0; t2 < 60 * CFG.TURN_WARN_S * 2 && sim.turnPending; t2++) { sim.step(dt); if (sim.phase === 'QUESTION') { sim.answer(0); sim.resumeAfterQuestion(); } }
  var turnEvts = sim.ctx._rec.telemetry.filter(function (e) { return e.t === 'turn'; });
  ok(!sim.turnPending && sim.turnMade === false && turnEvts.length === 1 && turnEvts[0].made === false && sim.phase === 'RUN',
     'missing the corner clips the wall (telemetry made:false), run continues');
  ok(sim._nextTurnScore >= CFG.TURN_KM * 1000 * 2 + 5000, 'next turn armed a full window out (5 km off the gate grid)');
  // (v0.132.0, CC#2) boost end re-anchors the next corner onto the turn grid with real runway
  {
    var sB = mkSim(SEED + 41);
    sB.phase = 'RUN'; sB.shields = 99;
    sB.boostActive = true; sB._boostTargetScore = 137000; sB.scoreDistance = 137100;   // boost overruns several turn windows
    sB.step(1 / 60);
    var t1k = CFG.TURN_KM * 1000, offOK = (sB._nextTurnScore - 5000) % t1k === 0;
    ok(!sB.boostActive && offOK && sB._nextTurnScore > sB.scoreDistance + CFG.SCORE_SPEED * CFG.TURN_WARN_S * 2,
       'CC#2: boost end re-anchors the next turn on the grid with >= 2 warning windows of runway');
  }
  // second turn: made properly (settle any boost FIRST — boost autopilots corners)
  for (var tb = 0; tb < 60 * 12 && sim.boostActive; tb++) { sim.shields = 5; sim.step(dt); if (sim.phase === 'QUESTION') { sim.answer(0); sim.resumeAfterQuestion(); } }
  sim.scoreDistance = sim._nextTurnScore - CFG.SCORE_SPEED * CFG.TURN_WARN_S - 50;
  sim._nextGateScore = sim.scoreDistance + 20000;
  for (var t3 = 0; t3 < 60 * 15 && !sim.turnPending; t3++) { sim.shields = 5; sim.step(dt); if (sim.phase === 'QUESTION') { sim.answer(0); sim.resumeAfterQuestion(); } }
  ok(!!sim.turnPending, 'second warning arms (post-boost)');
  var needLane = sim.turnPending.dir === 'right' ? 2 : 0;
  sim.player.lane = needLane; sim._retarget();
  var sh1 = sim.shields;
  for (var t4 = 0; t4 < 60 * CFG.TURN_WARN_S * 2 && sim.turnPending; t4++) { sim.step(dt); if (sim.phase === 'QUESTION') { sim.answer(0); sim.resumeAfterQuestion(); } }
  var turnEvts2 = sim.ctx._rec.telemetry.filter(function (e) { return e.t === 'turn'; });
  ok(!sim.turnPending && sim.turnMade === true && turnEvts2.length === 2 && turnEvts2[1].made === true,
     'matching lane makes the corner: telemetry made:true, flourish flag set');
})();

/* ============ C7 (v0.103.0): Boost Mode — locked, centered, doubled, calm road ============ */
(function boostMode() {
  group('C7: auto-center + steering lock + 2x duration + calm window');
  ok(CFG.BOOST_TIME === 6, 'boost duration doubled (BOOST_TIME 6)');
  var sim = mkSim(SEED + 71);
  sim.player.lane = 0; sim._retarget();
  var rowTypes = [];
  var realRow2 = sim._spawnRow.bind(sim);
  sim._spawnRow = function (z) { realRow2(z); };   // keep original; audit via pool snapshots below
  sim._activateBoost();
  ok(sim.boostActive === true && sim.player.lane === 1, 'activation auto-centers the ship');
  sim.moveLeft();
  ok(sim.player.lane === 1, 'steering is locked during Boost Mode');
  // ride the whole boost + the calm window, auditing every spawned obstacle type
  var dt = 1 / 60, calmBad = 0, sawCalmNarrow = 0, coinsDuringCalm = 0;
  var coinBaseline = 0;
  for (var t = 0; t < 60 * 20; t++) {
    var wasCalm = sim.boostActive || sim.distance < sim._boostCalmUntil;
    var obN0 = 0, obT = sim.obstacles.items;
    sim.shields = 99;
    var coinsActive0 = sim.coins.items.filter(function (cn) { return cn.active; }).length;
    sim.step(dt);
    if (sim.phase === 'QUESTION') { sim.answer(0); sim.resumeAfterQuestion(); }
    if (wasCalm) {
      var coinsActive1 = sim.coins.items.filter(function (cn) { return cn.active; }).length;
      if (coinsActive1 > coinsActive0) coinsDuringCalm++;
      for (var i = 0; i < obT.length; i++) {
        var o = obT[i];
        if (o.active && o.z > CFG.DRAW_DIST - 2) {           // just spawned at the horizon
          if (o.type !== E.OB_NARROW) calmBad++; else sawCalmNarrow++;
        }
      }
    }
    if (!sim.boostActive && sim.distance >= sim._boostCalmUntil && t > 60 * 8) break;
  }
  ok(calmBad === 0 && /iframe = Math\.max\(this\.iframe, 1\.0\)/.test(require('fs').readFileSync('./cc.js', 'utf8')), 'Boost + 5s after: nothing spawns but side walls + end-grace i-frames in source (' + sawCalmNarrow + ' narrows, 0 others)');
  ok(coinsDuringCalm === 0, 'no coins spawn into the calm road');
  ok(sim.boostActive === false && sim._boostCalmUntil > 0, 'boost ended with a calm window armed (grace i-frames source-pinned)');
  sim.moveLeft();
  ok(sim.player.lane === 0, 'steering returns after Boost Mode');
})();

/* ============ C6/C9 (v0.102.0): coin routing + squeeze stretches ============ */
(function coinsAndSqueeze() {
  group('C6/C9: coins never clip obstacles; squeeze stretches hold one side, no ducks');
  var sim = mkSim(SEED + 61), dt = 1 / 60, bad = { sealed: 0, low: 0, sweep: 0 }, audits = 0;
  var sawSqueeze = false, squeezeArch = 0, squeezeSweep = 0, squeezeOffSide = 0, archOutside = 0;
  var realRow = sim._spawnRow.bind(sim);
  sim._spawnRow = function (zAhead) {
    var before = sim.obstacles.items.filter(function (o) { return o.active; }).length;
    var inSq = (sim.distance + zAhead) < sim._squeezeUntil;
    realRow(zAhead);
    var items = sim.obstacles.items;
    for (var i = 0; i < items.length; i++) {
      var o = items[i];
      if (!o.active || Math.abs(o.z - zAhead) > 0.5) continue;
      if (inSq) {
        sawSqueeze = true;
        if (o.type === E.OB_ARCH) squeezeArch++;
        if (o.type === E.OB_SWEEP) squeezeSweep++;
        if (o.type === E.OB_NARROW && o.side !== sim._squeezeSide) squeezeOffSide++;
      } else if (o.type === E.OB_ARCH) archOutside++;
    }
  };
  for (var t = 0; t < 60 * 150; t++) {
    if (sim.phase === 'RUN') sim.shields = 99;
    sim.step(dt);
    if (sim.phase === 'QUESTION') { sim.answer(0); sim.resumeAfterQuestion(); }
    if (t % 30 === 0) {
      audits++;
      var cs = sim.coins.items, os = sim.obstacles.items;
      for (var ci = 0; ci < cs.length; ci++) {
        var cn = cs[ci]; if (!cn.active || cn.collected) continue;
        for (var oi = 0; oi < os.length; oi++) {
          var ob = os[oi]; if (!ob.active) continue;
          var dz = Math.abs(ob.z - cn.z);
          if (ob.type === E.OB_NARROW && dz < 1.0
              && sim._hitsObstacle(ob, { x: (cn.lane - 1) * CFG.LANE_W, y: 0, topY: CFG.PLAYER_H })) bad.sealed++;
          if (ob.type === E.OB_LOWROCK && dz < 0.8 && cn.y < 0.6 + CFG.JUMP_HEIGHT * 0.5) bad.low++;
          if (ob.type === E.OB_SWEEP && dz < 1.0) bad.sweep++;
        }
      }
    }
  }
  ok(bad.sealed === 0 && bad.low === 0 && bad.sweep === 0,
     'C6: across 150s (' + audits + ' audits) no coin sits in a sealed lane, under a jump wall, or on a sweeper (' + JSON.stringify(bad) + ')');
  ok(sawSqueeze, 'C9: squeeze stretches occur');
  ok(squeezeArch === 0 && squeezeSweep === 0 && squeezeOffSide === 0,
     'C9: inside a stretch — zero arches (no ducks), zero sweepers, the wall NEVER switches sides');
  ok(archOutside > 0, 'C9: arches still spawn outside stretches (mix intact)');
})();

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
  ok(sim.pending.limitS === 30, 'v0.126.0: the CC question window is 1.5x the base (20 -> 30s) (Jason playtest)');
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
  group('BOOST: earned by corrects, invulnerable, covers the promised distance');
  var sim = mkSim(SEED + 3);
  sim.boostCharge = CFG.GATES_PER_BOOST - 1;            // (v0.139.0, CC#1) one correct short of full
  ok(runToQuestion(sim, 90, CFG.SHIELDS_MAX), 'the trigger gate arrives');
  sim.answer(sim.pending.question.correctIndex);
  var scoreBefore = sim.scoreDistance;
  sim.resumeAfterQuestion();
  ok(sim.boostActive === true, 'CC#1: the charging correct arms the boost, fired on resume');
  stepFor(sim, CFG.BOOST_TIME + 1.5);
  ok(sim.boostActive === false, 'boost ends on its own once the distance is covered');
  var gained = sim.scoreDistance - scoreBefore;
  ok(gained >= CFG.BOOST_KM * 1000 * 0.95, 'boost covers ~' + CFG.BOOST_KM + ' scored km (+' + Math.round(gained / 1000) + ' km)');
})();

/* ============ 4b) CC#1: THE BOOST IS EARNED — corrects charge it, a miss drains half ============ */
(function boostCharge() {
  group('CC#1: answer-charged boost — corrects fill the meter, a wrong answer drains half');
  var sim = mkSim(SEED + 31);
  ok(sim.boostCharge === 0, 'a fresh run starts with an empty meter');
  // wrong first: no charge lost from empty, NO boost momentum
  ok(runToQuestion(sim, 90, CFG.SHIELDS_MAX), 'gate 1 arrives');
  sim.answer((sim.pending.question.correctIndex + 1) % sim.pending.question.options.length);
  ok(sim.boostCharge === 0 && !sim._boostPending, 'a miss on an empty meter stays empty (no underflow)');
  sim.shields = CFG.SHIELDS_MAX; sim.resumeAfterQuestion();
  // two corrects back to back: full meter -> armed -> meter resets
  ok(runToQuestion(sim, 120, CFG.SHIELDS_MAX), 'gate 2 arrives');
  sim.answer(sim.pending.question.correctIndex);
  ok(sim.boostCharge === 1 && !sim._boostPending, 'first correct: half charge, not armed yet');
  sim.resumeAfterQuestion();
  ok(!sim.boostActive, 'half a meter buys nothing — no boost fires');
  ok(runToQuestion(sim, 120, CFG.SHIELDS_MAX), 'gate 3 arrives');
  sim.answer(sim.pending.question.correctIndex);
  ok(sim.boostCharge === 0 && sim._boostPending === true, 'second correct: meter full -> boost armed, charge banked to 0');
  sim.resumeAfterQuestion();
  ok(sim.boostActive === true, 'the earned boost fires on resume');
  for (var bt = 0; bt < 60 * 20 && sim.boostActive; bt++) { sim.shields = CFG.SHIELDS_MAX; sim.step(1 / 60); if (sim.phase === 'QUESTION') { sim.answer(sim.pending.question.correctIndex); sim.resumeAfterQuestion(); } }
  // drain: charge 1, miss -> floor(1/2) = 0
  var s2 = mkSim(SEED + 32);
  s2.boostCharge = 1;
  ok(runToQuestion(s2, 90, CFG.SHIELDS_MAX), 'drain probe reaches a gate');
  s2.answer((s2.pending.question.correctIndex + 1) % s2.pending.question.options.length);
  ok(s2.boostCharge === 0 && !s2._boostPending, 'a miss drains half the charge (1 -> 0)');
  // gate count keeps ticking as a stat but no longer arms anything on its own
  var s3 = mkSim(SEED + 33);
  s3._gatesPassed = 99;
  ok(runToQuestion(s3, 90, CFG.SHIELDS_MAX), 'stat probe reaches a gate');
  ok(s3._gatesPassed === 100 && !s3._boostPending, 'gate COUNT alone never arms a boost any more (stat only)');
  s3.answer((s3.pending.question.correctIndex + 1) % s3.pending.question.options.length);
  ok(!s3._boostPending, 'even at 100 gates, a wrong answer arms nothing');
})();

/* ============ 4c) CC#3: 25 km MILESTONE CLOCK ============ */
(function milestones() {
  group('CC#3: the 25 km milestone clock — fires each mark, derives on resume');
  var sim = mkSim(SEED + 34);
  ok(sim.lastMilestone === 0 && sim._nextMile === 25000, 'fresh run: no milestone yet, first mark at 25 km');
  sim.scoreDistance = 24990; sim.step(1 / 60);
  for (var mt = 0; mt < 600 && sim.lastMilestone === 0; mt++) { sim.shields = 9; if (sim.phase === 'QUESTION') { sim.answer(null, { timedOut: true }); sim.resumeAfterQuestion(); } sim.step(1 / 60); }
  ok(sim.lastMilestone === 25000 && sim._nextMile === 50000, 'crossing 25 km fires the mark and arms 50 km');
  sim.scoreDistance = 74995;
  for (var mt2 = 0; mt2 < 600 && sim.lastMilestone < 75000; mt2++) { sim.shields = 9; if (sim.phase === 'QUESTION') { sim.answer(null, { timedOut: true }); sim.resumeAfterQuestion(); } sim.step(1 / 60); }
  ok(sim.lastMilestone === 75000 && sim._nextMile === 100000, 'skipped marks are not back-paid: 75 km fires once, next is 100');
  // resume derivation: a 62 km checkpoint must aim at 75 km, not replay 25/50
  var s2 = mkSim(SEED + 35);
  s2.scoreDistance = 62000;
  s2._nextMile = (Math.floor(s2.scoreDistance / 25000) + 1) * 25000;   // the resume line (cc.js restore)
  ok(s2._nextMile === 75000, 'CC#3: resume derives the next mark from the checkpoint distance (62 km -> 75 km)');
})();

/* ============ 4d) CC#5: THE NEW ROWS ENTER THE LIVE STREAM ============ */
(function newRows() {
  group('CC#5: chain + rockfall spawn in the live mix');
  var sim = mkSim(SEED + 40);
  var placed = [];
  var rp = sim._placeObstacle.bind(sim);
  sim._placeObstacle = function (t, l, s, z) { placed.push({ t: t, z: z, at: sim.distance }); return rp(t, l, s, z); };
  for (var f = 0; f < 60 * 150; f++) { sim.shields = 9; if (sim.phase === 'QUESTION') { sim.answer(null, { timedOut: true }); sim.resumeAfterQuestion(); } sim.step(1 / 60); }
  var rocks = placed.filter(function (p) { return p.t === 4; }).length;
  var chains = 0;
  for (var i = 1; i < placed.length; i++) { if (placed[i].t === 2 && placed[i - 1].t === 1 && placed[i].at === placed[i - 1].at && Math.abs((placed[i].z - placed[i - 1].z) - CFG.CHAIN_GAP) < 0.001) chains++; }
  ok(rocks >= 2, 'CC#5: rockfalls enter the live stream (' + rocks + ' in 150s)');
  ok(chains >= 2, 'CC#5: chain rows enter the live stream (' + chains + ' in 150s)');
  var classic = placed.filter(function (p) { return p.t <= 3; }).length;
  ok(classic > rocks + chains * 2, 'CC#5: the classic mix still forms the base');
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
    var dt = 1 / 60, acc = 0, seen = 0;
    for (var i = 0; i < 60 * 30; i++) {
      s.step(dt);
      if (s.phase === 'QUESTION') { s.answer(s.pending.question.correctIndex); s.resumeAfterQuestion(); }
      var items = s.obstacles.items;                        // (v0.126.0) hash the WHOLE obstacle stream — a
      for (var j = 0; j < items.length; j++) {               // single-frame sample coincided across seeds once
        var o = items[j];                                    // the first gate moved to 4 km; the run-wide stream
        if (o.active) { acc += (o.type + 1) * 31 + (o.lane + 1) * 7 + o.z; seen++; }   // stays seed-divergent.
      }
    }
    return s.distance.toFixed(3) + '/' + s.scoreDistance.toFixed(1) + '/' + s._gatesSpawned + '/' + acc.toFixed(2) + '/' + seen;
  }
  ok(fingerprint(SEED + 5) === fingerprint(SEED + 5), 'same seed -> identical 30s world fingerprint');
  ok(fingerprint(SEED + 5) !== fingerprint(SEED + 6), 'different seed -> different world');
})();

/* ============ 6) THE GARAGE (v0.73.0, J9): cells, upgrades, purchase math ============ */
(function garage() {
  group('GARAGE (J9): cells spawn+collect, upgrades bite, purchase math holds');
  var sim = mkSim(SEED + 7);
  sim.shields = 99;
  var dt = 1 / 60;
  for (var i = 0; i < 60 * 30; i++) { if (sim.phase === 'RUN') sim.shields = 99; sim.step(dt); if (sim.phase === 'QUESTION') { sim.answer(sim.pending.question.correctIndex); sim.resumeAfterQuestion(); } }
  ok(sim.coinScore > 0 || sim.coins.items.some(function (c) { return c.active; }),
     'energy cells spawn into the live run and get collected (v0.28 pipeline revived; ' + sim.coinScore + ' banked in 30s)');
  // direct collect: drop a cell right on the nose
  var c0 = sim.coins.acquire(); c0.lane = sim.player.lane; c0.x = sim.player.x; c0.y = 0.6; c0.z = 0.4; c0.tested = false; c0.collected = false;
  var cellsBefore = sim.coinScore;
  sim.step(dt);
  ok(sim.coinScore === cellsBefore + 1, 'flying through a cell collects it (+1 -> ' + sim.coinScore + ') [C12 value-1 coins]');
  // upgrades: hull + plating
  var s2 = mkSim(SEED + 8);
  s2.applyUpgrades({ hull: 2, plating: 1 });
  s2.reset();
  ok(s2.shields === CFG.SHIELDS_START + 2, 'hull tier 2: runs start at ' + (CFG.SHIELDS_START + 2) + ' shields');
  s2._placeObstacle(E.OB_LOWROCK, 1, 0, 0.5);
  var sh0 = s2.shields;
  s2.step(dt);
  ok(s2.shields === sh0 && s2._platingLeft === 0 && s2.collisions === 1,
     'ablative plating eats the FIRST crash (shields intact, flag consumed)');
  stepFor(s2, 1.2);                                    // let the i-frames lapse
  s2._placeObstacle(E.OB_LOWROCK, 1, 0, 0.5);
  s2.step(dt);
  ok(s2.shields === sh0 - 1, 'the SECOND crash costs a shield as normal (plating is once per run)');
  // boost upgrade: +50% covered distance
  var s3 = mkSim(SEED + 9);
  s3.applyUpgrades({ boost: 1 });
  s3.boostCharge = CFG.GATES_PER_BOOST - 1;             // (v0.139.0, CC#1) charge model
  ok(runToQuestion(s3, 90, CFG.SHIELDS_MAX), 'boost-upgrade probe reaches the trigger gate');
  s3.answer(s3.pending.question.correctIndex);
  var sc0 = s3.scoreDistance;
  s3.resumeAfterQuestion();
  stepFor(s3, CFG.BOOST_TIME + 1.5);
  var gained = s3.scoreDistance - sc0;
  ok(gained >= CFG.BOOST_KM * 1500 * 0.95, 'overcharged boost covers ~+50% (' + Math.round(gained / 1000) + ' km vs stock ' + CFG.BOOST_KM + ')');
  ok(CFG.GATES_PER_BOOST === 2, 'JB6/CC#1: a full charge costs 2 correct answers (GATES_PER_BOOST 2)');
  // passive magnet: a neighbouring-lane cell drifts toward the player
  var s4 = mkSim(SEED + 10);
  s4.applyUpgrades({ magnet: 1 });
  var cm = s4.coins.acquire(); cm.lane = 0; cm.x = -CFG.LANE_W; cm.y = 0.6; cm.z = 4; cm.tested = false; cm.collected = false;
  var dx0 = Math.abs(cm.x - s4.player.x);
  for (var m = 0; m < 30; m++) s4.step(dt);
  ok(cm.collected || Math.abs(cm.x - s4.player.x) < dx0, 'passive cell magnet pulls cells in without a buff');
  // purchase math (pure, profile-level)
  var prof = { ccCells: 125, ccUpgrades: {} };   // (v0.101.0, C12) value-1 economy
  var st = CC.garage.state(prof);
  ok(st.length === 4 && st.map(function (i) { return i.price; }).join(',') === '50,75,60,100',
     'catalog prices pinned: hull 50 / boost 75 / magnet 60 / plating 100 (C12)');
  var b1 = CC.garage.buy(prof, 'hull');
  ok(b1.ok && prof.ccCells === 75 && prof.ccUpgrades.hull === 1, 'buying hull T1 debits 50 and records the tier');
  ok(CC.garage.state(prof)[0].price === 120 && CC.garage.buy(prof, 'hull').ok === false,
     'hull T2 costs 120 — and 75 cells cannot afford it (no debt, no free tiers)');
  var b3 = CC.garage.buy(prof, 'magnet');
  ok(b3.ok && prof.ccCells === 15 && CC.garage.buy(prof, 'magnet').ok === false,
     'magnet buys once then reports maxed');
})();

(function firstGate() {
  group('FIRST GATE: earlier first question, then the normal cadence (v0.126.0, Jason)');
  var s9 = mkSim(SEED + 9);
  ok(s9._nextGateScore === CFG.FIRST_GATE_KM * 1000 && CFG.FIRST_GATE_KM < CFG.GATE_KM,
     'the FIRST gate is at FIRST_GATE_KM (' + CFG.FIRST_GATE_KM + 'km) < GATE_KM (' + CFG.GATE_KM + 'km)');
  var b9 = s9._nextGateScore;
  s9.scoreDistance = CFG.FIRST_GATE_KM * 1000 + 100;
  s9.step(1 / 60);
  ok(s9._nextGateScore === b9 + CFG.GATE_KM * 1000,
     'after the first gate, cadence returns to GATE_KM (' + (b9/1000) + 'km -> ' + (s9._nextGateScore/1000) + 'km)');
})();

console.log('\n' + (fails ? ('CC RUN: ' + fails + ' FAILED of ' + total) : ('CC RUN: ALL GREEN (' + total + '/' + total + ')')));
if (fails) process.exit(1);
