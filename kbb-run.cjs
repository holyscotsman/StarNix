/* kbb-run.cjs — the KBB engine + DOM run-through harness (rebuilt v0.50.0; the original never
 * landed in this repo). Two layers:
 *   1) ENGINE: drives createRun/drawQuestion/submitAnswer directly across full battles and rooms,
 *      asserting state invariants (hp/shield bounds, kill window, agency effects, loss finalize).
 *   2) DOM: mounts the module in jsdom, plays the intro-skip -> Start run -> several answered turns
 *      through real clicks, asserts view wiring (action row, hint, strike class, boss music, unmount).
 * Deterministic (seeded). Run: node kbb-run.cjs   |   KBB_SEED=n overrides the seed.
 */
'use strict';
var H = require('./kbb-headless.cjs');
var JSDOM = require('jsdom').JSDOM, VC = require('jsdom').VirtualConsole;
var ok = H.ok, group = H.group;

var SEED = parseInt(process.env.KBB_SEED || '9', 10);

function newWindow() {
  var vc = new VC(); vc.on('jsdomError', function () {});
  var dom = new JSDOM('<!DOCTYPE html><body></body>', { runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
  var win = dom.window, rafQ = [];
  win.requestAnimationFrame = function (cb) { rafQ.push(cb); return rafQ.length; };
  win.cancelAnimationFrame = function () {};
  win.STARNIX_ASSETS = {};
  var mod = null; win.StarNix = { registerGame: function (m) { mod = m; } };
  win.eval(H.KBB_SRC);
  var t = 0;
  function step(n, dt) { dt = dt || 16; for (var k = 0; k < n; k++) { t += dt; var gen = rafQ.slice(); rafQ.length = 0; for (var i = 0; i < gen.length; i++) gen[i](t); } }
  return { win: win, doc: win.document, mod: mod, KBB: win.KBB, step: step };
}

/* ================= 1) ENGINE ================= */
(function engine() {
  group('ENGINE: battles through the public seam (createRun/drawQuestion/submitAnswer/leaveShop)');
  var V = newWindow(), K = V.KBB;

  function play(run, pickAction, pickAnswer, maxTurns) {
    var turns = 0, log = { wins: 0, invariants: true, res: null };
    while (run.phase !== 'lost' && turns < maxTurns) {
      var d = K.drawQuestion(run);
      var q = d && d.question;
      if (!q) {
        // between battles: try to cross the shop/reward gate the engine exposes
        if (run.phase !== 'lost' && typeof K.leaveShop === 'function') { try { K.leaveShop(run); } catch (e) {} }
        d = K.drawQuestion(run); q = d && d.question;
        if (!q) break;
      }
      var res = K.submitAnswer(run, pickAnswer(q, turns), 900, pickAction(run, q, turns));
      turns++; log.res = res;
      if (res.error) { log.invariants = false; break; }
      var s = run.squad;
      if (!(s.hp >= 0 && s.hp <= s.maxHp && s.shield >= 0)) log.invariants = false;
      if (run.battle && !(run.battle.attackIndex >= 0 && run.battle.attackIndex <= run.battle.maxAttacks)) log.invariants = false;
      if (!res.correct && res.damage) log.invariants = false;      // wrong answers never deal damage
      if (res.win) log.wins++;
    }
    log.turns = turns; return log;
  }
  var right = function (q) { return q.multi ? q.correctIndices.slice() : q.correctIndex; };
  var wrongA = function (q) { return q.multi ? [q.correctIndices[0]] : ((q.correctIndex + 1) % q.options.length); };

  // A) all-correct attack: crosses at least two battles (wins + shop gate)
  var runA = K.createRun(H.makeCtx(K, { seed: SEED }), { seed: SEED });
  var A = play(runA, function () { return 'attack'; }, right, 60);
  ok(A.turns >= 6, 'all-correct play sustains multiple turns (' + A.turns + ')');
  ok(A.wins >= 2, 'crosses at least two battle wins through the shop gate (' + A.wins + ')');
  ok(A.invariants, 'state invariants held every turn (bounds, wrong=no-damage, no seam errors)');

  // B) brace on turn 1 must raise REAL shield by block minus the counter (v0.46 lesson)
  var runB = K.createRun(H.makeCtx(K, { seed: SEED + 1 }), { seed: SEED + 1 });
  var dB = K.drawQuestion(runB), qB = dB.question, shB = runB.squad.shield, eB = runB.battle.enemy.hp;
  var rB = K.submitAnswer(runB, right(qB), 900, 'brace');
  var shExpect = Math.max(0, shB + K.CONFIG.squad.block - (rB.enemyAttacked ? rB.incoming : 0));
  ok(rB.correct === true && runB.squad.shield === shExpect, 'brace raises real squad shield (' + shB + ' -> ' + runB.squad.shield + ')');
  ok(runB.battle.enemy.hp === eB, 'brace deals no damage');

  // C) repair after taking damage heals healPower (capped at maxHp)
  var runC = K.createRun(H.makeCtx(K, { seed: SEED + 2 }), { seed: SEED + 2 });
  runC.battle.enemy.pattern = 'flat'; runC.battle.enemy.cyc = 0;   // (v0.171.0, KBB#6) pin the read — this probe's arithmetic assumes steady intent
  runC.squad.shield = 0;                                                                       // bare hull so the counter reaches hp
  var dC1 = K.drawQuestion(runC); K.submitAnswer(runC, wrongA(dC1.question), 3000, 'attack');   // eat a counter
  if (runC.phase !== 'lost') {
    var hpC = runC.squad.hp;
    var dC2 = K.drawQuestion(runC), rC = K.submitAnswer(runC, right(dC2.question), 900, 'repair');
    var healExpect = Math.min(K.CONFIG.squad.healPower, K.CONFIG.squad.maxHp - hpC);
    var hpAfterExpect = Math.max(0, hpC + rC.healed - (rC.enemyAttacked ? (rC.toHp == null ? rC.incoming : rC.toHp) : 0));
    ok(rC.correct === true && rC.healed === healExpect && rC.healed > 0 && runC.squad.hp === hpAfterExpect, 'repair heals real hp (+' + rC.healed + ', from a real deficit; counter accounted)');
  } else { ok(false, 'repair probe: run died to one counter (tune drifted?)'); }

  // D) all-wrong reaches a terminal LOSS (enemy-kill or the finishing-blow window)
  var runD = K.createRun(H.makeCtx(K, { seed: SEED + 3 }), { seed: SEED + 3 });
  var D = play(runD, function () { return 'attack'; }, wrongA, 200);
  ok(runD.phase === 'lost', 'all-wrong play reaches phase=lost (turns=' + D.turns + ')');
  ok(D.res && (D.res.lossReason === 'enemy-kill' || D.res.lossReason === 'finishing-blow'), 'loss reason is enemy-kill or finishing-blow (' + (D.res && D.res.lossReason) + ')');
  ok(runD.squad.hp >= 0, 'hp never goes negative on the loss path');
})();

/* ============ 1b) ENGINE: the v0.55.0 artifact batch (+6), targeted deltas ============ */
(function artifactBatch() {
  group('ENGINE: v0.55 artifacts — equip via the public seam, pin each effect');
  var V = newWindow(), K = V.KBB;
  var right = function (q) { return q.multi ? q.correctIndices.slice() : q.correctIndex; };
  var wrongA = function (q) { return q.multi ? [q.correctIndices[0]] : ((q.correctIndex + 1) % q.options.length); };

  // fresh battle-phase run; optionally equip one artifact and bulk up the enemy so it survives probes
  function mkRun(seed, artId, fatEnemy) {
    var run = K.createRun(H.makeCtx(K, { seed: seed }), { seed: seed });
    if (artId) K.equipArtifact(run, artId);
    if (fatEnemy && run.battle && run.battle.enemy) { run.battle.enemy.hp = run.battle.enemy.maxHp = 500; }
    return run;
  }
  function attackDamages(run, n) {
    var out = [];
    for (var t = 0; t < n; t++) {
      var d = K.drawQuestion(run), q = d.question;
      var res = K.submitAnswer(run, right(q), 8000, 'attack');
      out.push(res.damage || 0);
      if (run.phase === 'lost') break;
    }
    return out;
  }

  // prism-focus: +12 flat on the FIRST attack of a battle only (paired same-seed runs)
  var pf0 = attackDamages(mkRun(SEED + 20, null, true), 2);
  var pf1 = attackDamages(mkRun(SEED + 20, 'prism-focus', true), 2);
  ok(pf1[0] - pf0[0] === 12 && pf1[1] - pf0[1] === 0,
     'prism-focus: first attack +12 (' + pf0[0] + '->' + pf1[0] + '), second attack unchanged (' + pf0[1] + '->' + pf1[1] + ')');

  // lcm-pipeline: +0.8 mult on lifecycle-domain questions only (domain forced onto the live
  // battle question in BOTH paired runs — the harness bank only serves storage/vms)
  (function () {
    var base = mkRun(SEED + 21, null, true), art = mkRun(SEED + 21, 'lcm-pipeline', true);
    var deltas = [];
    for (var t = 0; t < 2; t++) {
      var qb = K.drawQuestion(base).question, qa = K.drawQuestion(art).question;
      if (t === 0) { base.battle.question.domain = 'lifecycle'; art.battle.question.domain = 'lifecycle'; }
      var rb = K.submitAnswer(base, right(qb), 8000, 'attack'), ra = K.submitAnswer(art, right(qa), 8000, 'attack');
      deltas.push((ra.damage || 0) - (rb.damage || 0));
    }
    ok(deltas[0] > 0 && deltas[1] === 0,
       'lcm-pipeline: lifecycle questions hit harder (+' + deltas[0] + '), other domains unchanged (' + deltas[1] + ')');
  })();

  // erasure-coding: every THIRD incoming enemy attack halved (probe via wrong-answer counters)
  (function () {
    var run = mkRun(SEED + 22, 'erasure-coding', true);
    run.battle.enemy.pattern = 'flat'; run.battle.enemy.cyc = 0;   // (v0.171.0, KBB#6) steady intent — the thirds arithmetic is under test, not the read
    var seen = [];
    for (var t = 0; t < 3; t++) {
      var q = K.drawQuestion(run).question;
      var intent = run.battle.enemy.intent || 0;
      var res = K.submitAnswer(run, wrongA(q), 8000, 'attack');
      seen.push({ intent: intent, landed: res.enemyAttacked ? run.battle.lastIncoming : null });
      if (run.phase === 'lost') break;
    }
    ok(seen.length === 3 && seen[0].landed === seen[0].intent && seen[1].landed === seen[1].intent
       && seen[2].landed === Math.round(seen[2].intent * 0.5),
       'erasure-coding: attacks 1+2 land full (' + seen[0].landed + ',' + (seen[1] && seen[1].landed) + '), third halved ('
       + (seen[2] && seen[2].intent) + '->' + (seen[2] && seen[2].landed) + ')');
  })();

  // snapshot-ledger: +1 coin on a correct answer (fat enemy = no battle-won coin noise)
  (function () {
    var run = mkRun(SEED + 23, 'snapshot-ledger', true);
    var c0 = run.squad.coins;
    var q = K.drawQuestion(run).question;
    K.submitAnswer(run, right(q), 8000, 'attack');
    ok(run.squad.coins === c0 + 1, 'snapshot-ledger: correct answer pays +1 coin (' + c0 + '->' + run.squad.coins + ')');
  })();

  // one-click-repair: consumables also grant +6 shield (full useConsumable path)
  (function () {
    var run = mkRun(SEED + 24, 'one-click-repair', false);
    run.consumables.push('recharge');
    var s0 = run.squad.shield;
    var r = K.useConsumable(run, 'recharge');
    ok(r.ok === true && run.squad.shield === s0 + K.CONFIG.rechargeShield + 6,
       'one-click-repair: recharge grants base ' + K.CONFIG.rechargeShield + ' +6 bonus shield (' + s0 + '->' + run.squad.shield + ')');
  })();

  // cluster-expand: +1 block per battle won, permanent squad state
  (function () {
    var run = mkRun(SEED + 25, 'cluster-expand', false);
    var b0 = run.squad.block, wins = 0, guard = 0;
    while (wins < 1 && guard++ < 12) {
      var d = K.drawQuestion(run); var q = d && d.question;
      if (!q) { try { K.leaveShop(run); } catch (e) {} continue; }
      var res = K.submitAnswer(run, right(q), 8000, 'attack');
      if (res.win) wins++;
      if (run.phase === 'lost') break;
    }
    ok(wins === 1 && run.squad.block === b0 + 1, 'cluster-expand: battle win adds +1 block (' + b0 + '->' + run.squad.block + ')');
  })();
})();

/* ============ KBB UNIT 2 (v0.99.0, K4/K10/K11) ============ */
(function unit2() {
  group('UNIT 2: rarity curve, fittings, longer rounds');
  var V = newWindow(), K = V.KBB;
  var run = K.createRun(H.makeCtx(K, { seed: SEED + 51 }), { seed: SEED + 51 });
  var w1 = K.rarityWeightsFor({ section: 1, round: 1 });
  ok(Math.abs(w1.common - 0.64) < 1e-9 && Math.abs(w1.uncommon - 0.30) < 1e-9
     && Math.abs(w1.rare - 0.05) < 1e-9 && Math.abs(w1.legendary - 0.01) < 1e-9,
     'K4: round 1 rolls exactly 64/30/5/1');
  var w9 = K.rarityWeightsFor({ section: 4, round: 3 });
  ok(w9.common < w1.common && w9.rare > w1.rare && w9.legendary > w1.legendary && w9.legendary <= 0.08,
     'K4: deeper runs shift rarer (commons shrink, legendary capped at 8%)');
  // fittings: +1, one per shop
  run.phase = 'shop'; K._test.buildShop(run);
  run.squad.coins = 99;
  var p0 = run.squad.basePower;
  var b1 = K.shopBuyBoost(run, 3);
  ok(b1.ok === true && run.squad.basePower === p0 + 1, 'K10: +1 Attack fitting applies permanently');
  var b2 = K.shopBuyBoost(run, 0);
  ok(b2.ok === false && b2.reason === 'one-per-shop', 'K10: ONE fitting per shop visit');
  K._test.buildShop(run);
  var b3 = K.shopBuyBoost(run, 1);
  ok(b3.ok === true && run.squad.startShield === 1, 'K10: next shop allows another; +1 Shield floor raises startShield');
  // round 1 needs >= 2 correct hits
  var run2 = K.createRun(H.makeCtx(K, { seed: SEED + 52 }), { seed: SEED + 52 });
  var d0 = K.drawQuestion(run2), q0 = run2.battle.question;
  var r0 = K.submitAnswer(run2, q0.multi ? q0.correctIndices : q0.correctIndex, 8000, 'attack');
  ok(r0.correct === true && r0.win === false && run2.battle.enemy.hp > 0,
     'K10: one correct answer no longer one-shots the first enemy');
})();

/* ============ KBB UNIT 1 (v0.98.0, K1/K2/K3/K8/K9/K7) ============ */
(function unit1() {
  group('UNIT 1: tour blocks answering, Purge gone, DESTROYED state, no timer artifacts, sharp canvas');
  var SRC = H.KBB_SRC;
  ok(/kbb-ht-spot\{pointer-events:none;\}/.test(SRC), 'K2: spotlighted zones are look-only during the tour');
  ok(/name: 'lasercharge', side: 'enemy', dur: 60, delay: ed \}/.test(SRC) && /dur: 1100, delay: ed, col: PALETTE\.peach/.test(SRC)
     && /thick: true/.test(SRC),
     'K6: enemy attack = long charge (1.1s) + THICK beam, sound on the beat');
  ok(/heroExitDx/.test(SRC) && /battleEase/.test(SRC) && /in from the LEFT, off to the RIGHT/.test(SRC),
     'K5: fly-in/fly-off choreography present in both draw paths');
  ok(!/purge/i.test(SRC.replace(/Purge cut \(Jason\)/, '')), 'K3: Purge fully removed (defs, roster, use path, view hook)');
  ok(/DESTROYED/.test(SRC) && /b\.over \|\| e\.hp <= 0/.test(SRC), 'K8: enemy panel states DESTROYED after death');
  ok(!/answerMs != null && c\.answerMs <=/.test(SRC) && /hull is at full HP/.test(SRC), 'K9: no time-based artifact effects remain');
  ok(/s\.combat && s\.combat\.clientWidth\) \|\| s\.canvas\.clientWidth/.test(SRC) && /s\.fxCanvas\.width = Math\.max/.test(SRC),
     'K7: canvas + 3D renderer + fx overlay size from the container (the blur fix)');
  ok(/width:min\(540px,94%\)/.test(SRC) && /font-size:18px/.test(SRC), 'K1: tour card + heading enlarged');
  // behavioral: DESTROYED shows after a forced win
  var V = newWindow(), doc = V.doc, KBB = V.KBB;
  V.mod.mount(doc.body, H.makeCtx(KBB, { seed: SEED + 41, reducedMotion: true }));
  V.step(3);
  var sk = Array.prototype.slice.call(doc.querySelectorAll('.kbb-skip')).find(function (b) { return /skip/i.test(b.textContent || ''); });
  if (sk) { sk.click(); V.step(2); }
  var hts = doc.querySelector('.kbb-ht-skip'); if (hts) { hts.click(); V.step(2); }
  var run = KBB._test.state().run;
  run.battle.enemy.hp = 1;
  var qq = run.battle.question, ci = qq.multi ? qq.correctIndices : [qq.correctIndex];
  for (var i = 0; i < ci.length; i++) { var o = doc.querySelector('.kbb-opt[data-idx="' + ci[i] + '"]'); if (o) o.click(); }
  var sub = doc.querySelector('.kbb-submit'); if (sub && !sub.disabled) sub.click();
  V.step(2);
  ok(/DESTROYED/.test(doc.querySelector('.kbb-intent') ? doc.querySelector('.kbb-intent').textContent : ''),
     'K8: panel reads DESTROYED the moment the enemy dies');
  V.mod.unmount();
})();

/* ============ REVEAL INTEGRITY (v0.90.0, review) ============ */
(function revealIntegrity() {
  group('REVEAL: revealOneWrong never rules out a CORRECT option (multi-answer)');
  var V = newWindow(), K = V.KBB;
  var run = K.createRun(H.makeCtx(K, { seed: SEED + 31 }), { seed: SEED + 31 });
  var guard = 0, qM = null;
  while (guard++ < 30) {
    var d = K.drawQuestion(run); var qq = d && d.question;
    if (qq && qq.multi) { qM = qq; break; }
    if (qq) K.submitAnswer(run, qq.correctIndex, 5000, 'attack');
    if (run.phase !== 'battle') { try { K.leaveShop(run); } catch (e) {} }
    if (run.phase === 'lost') break;
  }
  if (qM) {
    var actx = KBBseam(run);
    for (var rv = 0; rv < qM.options.length + 2; rv++) actx.api.revealWrong();
    var revealed = run.battle.revealed, clean = true;
    for (var ri = 0; ri < revealed.length; ri++) if (qM.correctIndices.indexOf(revealed[ri]) >= 0) clean = false;
    ok(clean && revealed.length === qM.options.length - qM.correctIndices.length,
       'multi-answer reveal only ever rules out true wrongs (' + revealed.join(',') + ' vs correct ' + qM.correctIndices.join(',') + ')');
  } else { ok(false, 'reveal-integrity probe found no multi question'); }
  function KBBseam(runX) { return V.KBB._test.ctx(runX, { id: 'probe' }, {}); }
})();

/* ================= 2) DOM ================= */
(function debriefCollect() {
  group('KBB#2: post-battle debrief — misses collected as text, per battle, capped');
  var V = newWindow(), K = V.KBB;
  var right = function (q) { return q.multi ? q.correctIndices.slice() : q.correctIndex; };
  var wrongA = function (q) { return q.multi ? [q.correctIndices[0]] : ((q.correctIndex + 1) % q.options.length); };
  var run = K.createRun(H.makeCtx(K, { seed: SEED + 40 }), { seed: SEED + 40 });
  ok(Array.isArray(run.misses) && run.misses.length === 0, 'a fresh battle opens with an empty miss list');
  var d1 = K.drawQuestion(run), q1 = d1.question;
  K.submitAnswer(run, wrongA(q1), 3000, 'attack');
  ok(run.misses.length === 1 && run.misses[0].id === q1.id, 'a wrong answer lands ONE debrief entry carrying the question id');
  var expAns = q1.multi ? q1.correctIndices.map(function (ci) { return q1.options[ci]; }).join(' \u00b7 ') : q1.options[q1.correctIndex];
  ok(run.misses[0].stem === q1.stem && run.misses[0].correctText === expAns,
     'the entry stores stem + right-answer TEXT resolved against the shuffled presentation (index-proof)');
  ok(run.misses[0].expl.length <= 170, 'the explanation is clipped to a first-line recap, not the whole essay');
  var d2 = K.drawQuestion(run), q2 = d2.question;
  K.submitAnswer(run, right(q2), 900, 'attack');
  ok(run.misses.length === 1, 'a correct answer adds nothing to the debrief');
  run.misses = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }];
  var d3 = K.drawQuestion(run), q3 = d3.question;
  if (q3) K.submitAnswer(run, wrongA(q3), 3000, 'attack');
  ok(run.misses.length === 5, 'the list caps at 5 (no unbounded growth in a grindy battle)');
  // reset: crossing into the NEXT battle wipes the previous debrief
  var run2 = K.createRun(H.makeCtx(K, { seed: SEED + 41 }), { seed: SEED + 41 });
  run2.misses.push({ id: 'stale', stem: 's', correctText: 'c', expl: '' });
  var crossed = false;
  for (var ct = 0; ct < 60 && !crossed; ct++) {
    var dd = K.drawQuestion(run2), qq = dd && dd.question;
    if (!qq) { if (typeof K.leaveShop === 'function') { try { K.leaveShop(run2); } catch (e) {} crossed = true; } continue; }
    K.submitAnswer(run2, (qq.multi ? qq.correctIndices.slice() : qq.correctIndex), 900, 'attack');
  }
  ok(crossed && run2.misses.length === 0, 'starting the next battle clears the previous debrief');
})();

(function intentPatterns() {
  group('KBB#6: intent patterns rolled per enemy — siphon + crescendo join the reads');
  var V = newWindow(), K = V.KBB;
  ok(K.ENEMY_PATTERNS.length === 5 && K.ENEMY_PATTERNS.indexOf('siphon') >= 0 && K.ENEMY_PATTERNS.indexOf('crescendo') >= 0,
     'the pattern pool is five (flat/ramp/alternating/siphon/crescendo)');
  // per-enemy roll: round 1 is NOT always flat any more; s1 stays classics-only
  var seen1 = {}, seen2 = {};
  for (var sd = 0; sd < 60; sd++) {
    var runP = K.createRun(H.makeCtx(K, { seed: 9000 + sd }), { seed: 9000 + sd });
    seen1[runP.battle.enemy.pattern] = 1;
    runP.section = 2; runP.round = 1;
    seen2[K.makeEnemy(runP).pattern] = 1;
  }
  ok(Object.keys(seen1).length >= 2 && !seen1.siphon && !seen1.crescendo,
     'section 1 round 1 varies across runs but stays on the teaching classics (' + Object.keys(seen1).sort().join('/') + ')');
  ok(seen2.siphon === 1 && seen2.crescendo === 1,
     'section 2+ regulars draw the full pool (' + Object.keys(seen2).sort().join('/') + ')');
  // SIPHON: weak hit + a 4-shield rip BEFORE absorption
  var runS = K.createRun(H.makeCtx(K, { seed: 9100 }), { seed: 9100 });
  var eS = runS.battle.enemy; eS.pattern = 'siphon'; eS.intent = 10; eS.boss = false;
  ok(K.currentIntent(runS) === 6, 'siphon hits weak (60% of intent: 10 -> 6)');
  runS.squad.shield = 10;
  K._test.applyIncoming(runS, K.currentIntent(runS));
  ok(runS.squad.shield === 0 && runS.battle.lastToHp === 0,
     'siphon rips 4 shield FIRST, then the weak hit lands on what remains (10-4-6=0 shield, 0 to hull)');
  // CRESCENDO: weak/weak/HEAVY on a three-turn cycle
  var runC = K.createRun(H.makeCtx(K, { seed: 9101 }), { seed: 9101 });
  var eC = runC.battle.enemy; eC.pattern = 'crescendo'; eC.intent = 10; eC.cyc = 0; eC.boss = false;
  var seqC = [];
  for (var tc = 0; tc < 6; tc++) { seqC.push(K.currentIntent(runC)); K._test.advanceIntent ? K._test.advanceIntent(runC) : (function () { eC.cyc = (eC.cyc + 1) % 3; })(); }
  ok(seqC.join(',') === '7,7,22,7,7,22', 'crescendo cycles weak/weak/HEAVY (7,7,22 at intent 10)');
})();

(function newMechanics() {
  group('KBB#5: six boss mechanics — splitter / leech / jammer join, s4+ draws from the pool');
  var V = newWindow(), K = V.KBB;
  var right = function (q) { return q.multi ? q.correctIndices.slice() : q.correctIndex; };
  var wrongA = function (q) { return q.multi ? [q.correctIndices[0]] : ((q.correctIndex + 1) % q.options.length); };
  function bossRun(mech, seed) {
    var run = K.createRun(H.makeCtx(K, { seed: seed }), { seed: seed });
    run.section = 4; run.round = K.CONFIG.roundsPerSection - 1; run.phase = 'shop'; run.shop = null; K._test.buildShop(run);
    K.leaveShop(run);
    var e = run.battle.enemy;
    e.mechanic = mech; e.locked = false; e.shieldUp = false;   // force the mechanic under test
    if (mech !== 'enrage') e.pattern = 'flat';
    return run;
  }
  // SELECTION: 1-3 teach in order (Flagship stays gated); 4+ draws all six across seeds
  var selRun = K.createRun(H.makeCtx(K, { seed: SEED + 70 }), { seed: SEED + 70 });
  selRun.round = K.CONFIG.roundsPerSection;
  var m123 = [1, 2, 3].map(function (sx) { selRun.section = sx; return K.makeEnemy(selRun).mechanic; });
  ok(m123.join(',') === 'shielded,enrage,gated', 'sections 1-3 keep the teaching cycle (Flagship stays gated)');
  var seen = {};
  for (var sd = 0; sd < 80; sd++) { selRun.section = 4 + (sd % 6); seen[K.makeEnemy(selRun).mechanic] = 1; }
  ok(Object.keys(seen).length === 6, 'section 4+ draws from ALL SIX mechanics via run.rng (' + Object.keys(seen).sort().join('/') + ')');
  // SPLITTER: crossing 50% detaches an escort that must ALSO die
  var rs = bossRun('splitter', SEED + 71);
  var es = rs.battle.enemy;
  es.hp = Math.ceil(es.maxHp / 2) + 1;
  var d1 = K.drawQuestion(rs); rs.squad.basePower = es.hp + 5;   // one clean overkill blow
  K.submitAnswer(rs, right(d1.question), 900, 'attack');
  ok(es.split === true && es.escortHp === Math.max(1, Math.round(es.maxHp * 0.35)) && rs.phase === 'battle',
     'KBB#5 SPLITTER: the killing blow past 50% detaches an escort — the battle is NOT won yet');
  var guardS = 0;
  while (guardS++ < 12 && rs.phase === 'battle') {
    var ds = K.drawQuestion(rs); if (!ds || !ds.question) break;
    rs.squad.hp = rs.squad.maxHp; rs.battle.attackIndex = 0;     // stay alive/under cap: the ESCORT contract is under test
    K.submitAnswer(rs, right(ds.question), 900, 'attack');
  }
  ok(rs.phase === 'shop' && es.escortHp === 0, 'KBB#5 SPLITTER: killing the escort finishes the fight (both bars must die)');
  // LEECH: a wrong answer feeds it 15% maxHp (capped)
  var rl = bossRun('leech', SEED + 72);
  var el = rl.battle.enemy;
  el.hp = Math.round(el.maxHp * 0.5);
  var hp0 = el.hp, dl = K.drawQuestion(rl);
  K.submitAnswer(rl, wrongA(dl.question), 3000, 'attack');
  ok(el.hp === Math.min(el.maxHp, hp0 + Math.round(el.maxHp * 0.15)), 'KBB#5 LEECH: a miss feeds it +15% maxHp (' + hp0 + ' -> ' + el.hp + ')');
  // JAMMER: odd turns suppress artifact damage hooks, telegraphed by drawQuestion parity
  var rj = bossRun('jammer', SEED + 73);
  var ej = rj.battle.enemy;
  K.equipArtifact(rj, 'overclocked-core', true);                 // +4 flat modifyDamage
  rj.battle.attackIndex = 0; K.drawQuestion(rj);
  ok(ej.jamOn === false, 'KBB#5 JAMMER: even turns are clean (parity telegraph, like the shield)');
  var dmgClean = K.computeDamage(rj, 8000);
  rj.battle.attackIndex = 1; K.drawQuestion(rj);
  ok(ej.jamOn === true, 'KBB#5 JAMMER: odd turns jam');
  var dmgJam = K.computeDamage(rj, 8000);
  ok(dmgJam === rj.squad.basePower && dmgClean > dmgJam, 'KBB#5 JAMMER: jammed turns strip artifact hooks to base power (' + dmgJam + ' vs ' + dmgClean + ')');
})();

(function newConsumables() {
  group('KBB#7: Overcharge + Stasis — offense and tempo join the sustain row');
  var V = newWindow(), K = V.KBB;
  var right = function (q) { return q.multi ? q.correctIndices.slice() : q.correctIndex; };
  ok(K.CONSUMABLE_IDS.length === 5 && K.CONSUMABLE_IDS.indexOf('overcharge') >= 0 && K.CONSUMABLE_IDS.indexOf('stasis') >= 0,
     'the consumable pool is five (repair/recharge/intel/overcharge/stasis) — the cap-4 hold matters again');
  // OVERCHARGE: exactly +1.0 mult on the NEXT correct attack, then spent
  var run = K.createRun(H.makeCtx(K, { seed: SEED + 80 }), { seed: SEED + 80 });
  run.battle.enemy.pattern = 'flat'; run.battle.enemy.cyc = 0;
  var base = K.computeDamage(run, 8000);
  run.consumables.push('overcharge');
  ok(K.useConsumable(run, 'overcharge').ok === true && run.battle.overcharge === true, 'Overcharge arms on the live battle');
  ok(K.computeDamage(run, 8000) === base * 2 && run.battle.overcharge === false,
     'the armed strike computes at +1.0 mult (' + base + ' -> ' + base * 2 + ') and the charge is SPENT in the same computation');
  ok(K.computeDamage(run, 8000) === base, 'the following strike is back to base — one strike only');
  // STASIS: the enemy skips exactly one counter
  var run2 = K.createRun(H.makeCtx(K, { seed: SEED + 81 }), { seed: SEED + 81 });
  run2.battle.enemy.pattern = 'flat'; run2.battle.enemy.cyc = 0; run2.battle.enemy.hp = 99999; run2.battle.enemy.maxHp = 99999;
  run2.consumables.push('stasis');
  ok(K.useConsumable(run2, 'stasis').ok === true && run2.battle.skipEnemyCounter === true, 'Stasis freezes the counter flag');
  var d2 = K.drawQuestion(run2);
  var r2 = K.submitAnswer(run2, right(d2.question), 900, 'attack');
  ok(r2.enemyAttacked === false && r2.incoming === 0, 'STASIS: the enemy skips that counter entirely');
  var d3 = K.drawQuestion(run2);
  var r3 = K.submitAnswer(run2, right(d3.question), 900, 'attack');
  ok(r3.enemyAttacked === true, 'the NEXT turn counters normally — stasis is one counter, not a battle');
  // guard: neither arms outside a live battle
  var run3 = K.createRun(H.makeCtx(K, { seed: SEED + 82 }), { seed: SEED + 82 });
  run3.phase = 'shop'; run3.battle = null; run3.consumables.push('overcharge', 'stasis');
  ok(K.useConsumable(run3, 'overcharge').ok === false && K.useConsumable(run3, 'stasis').ok === false
     && run3.consumables.length === 2, 'no live battle -> both refuse and are NOT consumed');
})();

(function flagshipArc() {
  group('KBB#3: the run has an arc — Flagship victory at section 3, then the endless Deep Belt');
  var V = newWindow(), K = V.KBB;
  var right = function (q) { return q.multi ? q.correctIndices.slice() : q.correctIndex; };
  var ctxF = H.makeCtx(K, { seed: SEED + 50 });
  var run = K.createRun(ctxF, { seed: SEED + 50 });
  run.section = 3; run.round = K.CONFIG.roundsPerSection;
  var fe = K.makeEnemy(run);
  ok(fe.flagship === true && /FLAGSHIP/i.test(fe.name) && fe.boss === true, 'the section-3 boss IS the named BCM Flagship');
  run.section = 6;
  var fe6 = K.makeEnemy(run);
  ok(!fe6.flagship && !/FLAGSHIP/i.test(fe6.name), 'the section-6 boss is a regular Mk boss — the flagship moment is singular');
  // arm the real 3-5 battle through the public seam, then kill it clean
  run.section = 3; run.round = K.CONFIG.roundsPerSection - 1; run.phase = 'shop'; run.shop = null; K._test.buildShop(run);
  K.leaveShop(run);
  ok(run.round === K.CONFIG.roundsPerSection && run.battle && run.battle.enemy.flagship === true, 'leaveShop at 3-4 arms the flagship battle');
  var guard = 0, resW = null;
  while (guard++ < 30 && run.phase === 'battle') {
    var dq = K.drawQuestion(run); if (!dq || !dq.question) break;
    run.battle.enemy.locked = false; run.battle.enemy.shieldUp = false;   // the ARC is under test, not the gate mechanic
    run.battle.enemy.hp = Math.min(run.battle.enemy.hp, 1);
    resW = K.submitAnswer(run, right(dq.question), 900, 'attack');
  }
  ok(!!resW && resW.win === true && run.phase === 'won' && run.won === true, 'killing the Flagship lands phase WON (not shop)');
  var winEvs = ctxF._rec.telemetry.filter(function (e) { return e.ev && e.ev.t === 'run_ended' && e.ev.result === 'win'; });
  ok(winEvs.length === 1 && winEvs[0].ev.game === 'KBB' && winEvs[0].ev.score > 0, "telemetry lands ONE run_ended result:'win' with the score");
  ok(K.claimVictory(run).ok === true && run.phase === 'shop' && !!run.shop, 'Push into the Deep Belt: the win claims into the normal post-boss shop');
  K.leaveShop(run);
  ok(run.section === 4 && run.round === 1 && run.phase === 'battle' && !run.battle.enemy.flagship, 'section 4 (The Deep Belt) continues endless exactly as before');
  ok(K.claimVictory(run).ok === false, 'claimVictory is phase-guarded — no double-claim mid-battle');
  ok(run.won === true, 'the run stays marked WON through the Deep Belt (checkpoint carries it)');
})();

(function pityOffer() {
  group('KBB#4: boss-shop pity — a discounted legendary in every post-boss shop');
  var V = newWindow(), K = V.KBB;
  var ctxP = H.makeCtx(K, { seed: SEED + 60 });
  var run = K.createRun(ctxP, { seed: SEED + 60 });
  var isLeg = function (o) { return K.ARTIFACTS_BY_ID[o.id].rarity === 'legendary'; };
  // post-boss shop (round 5): the guarantee
  run.section = 2; run.round = K.CONFIG.roundsPerSection; run.phase = 'shop'; K._test.buildShop(run);
  var legs = run.shop.artifacts.filter(isLeg);
  ok(legs.length >= 1 && legs.some(function (o) { return o.pity === true; }),
     'KBB#4: the post-boss shop always carries a pity legendary');
  var lp = legs.filter(function (o) { return o.pity; })[0];
  var fullLeg = Math.max(1, Math.round(K.CONFIG.artifactPrice.legendary * (1 + (run.section - 1) * K.CONFIG.pricePerSection)));
  ok(lp.price === Math.max(1, Math.round(fullLeg * 0.7)) && lp.price < fullLeg,
     'KBB#4: the pity price carries the 30% salvage cut (' + lp.price + 'c vs ' + fullLeg + 'c full)');
  // mid-section shops (rounds 1-4): NO guarantee
  var sawMid = false;
  for (var rp = 1; rp < K.CONFIG.roundsPerSection; rp++) {
    run.round = rp; K._test.buildShop(run);
    if (run.shop.artifacts.some(function (o) { return o.pity; })) sawMid = true;
  }
  ok(!sawMid, 'KBB#4: mid-section shops roll the normal table (no pity tag)');
  // owning every legendary: the pity gracefully yields (no dupes, no crash)
  run.round = K.CONFIG.roundsPerSection;
  var allLegs = [];
  for (var ai in K.ARTIFACTS_BY_ID) { if (K.ARTIFACTS_BY_ID[ai].rarity === 'legendary') allLegs.push(ai); }
  run.squad.artifacts = allLegs.map(function (id) { return { def: K.ARTIFACTS_BY_ID[id], state: {} }; });
  K._test.buildShop(run);
  var dupes = run.shop.artifacts.filter(function (o) { return isLeg(o) && allLegs.indexOf(o.id) >= 0; });
  ok(dupes.length === 0, 'KBB#4: with every legendary owned, no duplicate is forced');
})();

(function domFlow() {
  group('DOM: mount -> skip intro -> Start run -> answered turns -> boss music -> unmount');
  var V = newWindow(), doc = V.doc, KBB = V.KBB;
  var ctx = H.makeCtx(KBB, { seed: SEED, reducedMotion: false });
  ok(!!V.mod && typeof V.mod.mount === 'function', 'module registered with mount()');
  V.mod.mount(doc.body, ctx);
  V.step(3);
  function q(sel) { return doc.querySelector(sel); }
  function clickText(sel, t) { var e = Array.prototype.slice.call(doc.querySelectorAll(sel)); for (var i = 0; i < e.length; i++) { if ((e[i].textContent || '').toLowerCase().indexOf(t) >= 0) { e[i].click(); return true; } } return false; }

  // (v0.68.0, J6) NEW flow: cinematic FIRST -> live easy battle -> how-to tour over POPULATED
  // panels (the old order spotlighted empty zones = Jason's "blank boxes"); no pre-run shop.
  ok(KBB._test.state().run.phase === 'battle', 'mount opens straight into the first battle (no pre-run shop \u2014 J6)');
  var cineSkip = Array.prototype.slice.call(doc.querySelectorAll('.kbb-skip')).find(function (b) { return /skip/i.test(b.textContent || ''); });
  if (cineSkip) { cineSkip.click(); V.step(2); }
  var cineGone = !Array.prototype.slice.call(doc.querySelectorAll('.kbb-skip')).some(function (b) { return /skip/i.test(b.textContent || ''); });
  ok(cineGone, 'intro cinematic ends via Skip (replay button may remain)');
  ok(!!q('.kbb-howto') && doc.querySelectorAll('.kbb-opt').length > 0,
     'how-to tour opens OVER the live battle (spotlighted zones are populated \u2014 the blank-box fix)');
  clickText('.kbb-ht-skip', 'skip');
  V.step(2);
  ok(!q('.kbb-howto') && doc.querySelectorAll('.kbb-opt').length > 0, 'skipping the tour leaves the live first battle ready');
  ok(doc.querySelectorAll('.kbb-action').length === 3 && !!q('.kbb-act-hint'), 'action row + hint render');
  // ============ (v0.113.0, D5) card-hand battle — behavioral pins ============
  ok(!!q('.kbb-hand') && q('.kbb-hand').querySelectorAll('.kbb-acard').length === 5
     && !!q('.kbb-hand .kbb-gem') && q('.kbb-hand').querySelectorAll('.kbb-pile').length === 2
     && q('.kbb-main').querySelectorAll('.kbb-action').length === 3,
     'v0.127.0 (Jason): the hand fans the 5 ARTIFACT card slots (+gem+piles); the 3 move buttons sit on the played card');
  ok(!!q('.kbb-main .kbb-play-head') && !!q('.kbb-main .kbb-play-stake'),
     'D5: the question is framed as the played card (header + stake line)');
  var stake0 = (q('.kbb-main .kbb-play-stake') || {}).innerHTML || '';
  var braceCard = q('.kbb-main .kbb-action[data-act="brace"]');
  if (braceCard) { braceCard.click(); V.step(1); }
  var stake1 = (q('.kbb-main .kbb-play-stake') || {}).innerHTML || '';
  ok(!!braceCard && stake1 !== stake0 && /shield/i.test(stake1) && braceCard.classList.contains('on'),
     'D5: playing Brace re-frames the played card (stake flips to shield, card lifts .on)');
  var atkCard = q('.kbb-main .kbb-action[data-act="attack"]');
  if (atkCard) { atkCard.click(); V.step(1); }
  ok(/fire/i.test((q('.kbb-main .kbb-play-stake') || {}).innerHTML || ''),
     'D5: switching back to Attack restores the volley stake');
  var pillHp = q('.kbb-top .pv.hp b');
  ok(!!pillHp && pillHp.textContent === String(KBB._test.state().run.squad.hp),
     'D5: the top pill mirrors live squad HP');
  // (v0.78.0, JB2) the left panel is 5 always-visible artifact slots; a fresh run = all empty
  var slots0 = doc.querySelectorAll('.kbb-hand .kbb-acard');
  ok(slots0.length === 5 && doc.querySelectorAll('.kbb-hand .kbb-acard.empty').length === 5,
     'JB2/v0.127.0: the hand renders 5 artifact card slots, all empty at mount (' + slots0.length + ')');
  ok(ctx._rec.tracks.some(function (t) { return t.id === 'kbb'; }), "mount plays the 'kbb' bed");

  // Advance across whatever screen is up (feedback Continue / shop "Next battle") until options exist.
  function toQuestion() {
    for (var adv = 0; adv < 6; adv++) {
      if (q('.kbb-opt:not(:disabled)')) return true;
      var c = q('.kbb-cont:not(.kbb-submit)');
      if (c) { c.click(); V.step(2); continue; }
      var em = q('.kbb-embark'); if (em) { em.click(); V.step(2); continue; }   // (D6) map -> next battle
      if (clickText('.kbb-btn', 'next battle')) { V.step(2); continue; }
      if (clickText('.kbb-btn', 'contin') || clickText('.kbb-btn', 'onward')) { V.step(2); continue; }
      break;
    }
    return !!q('.kbb-opt:not(:disabled)');
  }
  // answer across battles until the enemy's counter fires the strike telegraph
  var struck = false, answered = 0;
  // (v0.68.0) J6's no-preshop opening shifted the run RNG stream — a first-turn wrong answer
  // can fire the strike immediately, so keep answering until BOTH goals are met (they're
  // independent properties: >=2 answered turns AND the telegraph observed).
  for (var round = 0; round < 10 && (!struck || answered < 2); round++) {
    if (!toQuestion()) break;
    q('.kbb-opt:not(:disabled)').click();
    var sub = q('.kbb-submit'); if (sub && !sub.disabled) sub.click();
    answered++;
    V.step(3);
    var ep = q('.kbb-enemy'); if (ep && ep.classList.contains('kbb-en-strike')) struck = true;
  }
  ok(answered >= 2, 'answered ' + answered + ' turn(s) through the DOM, crossing battles');
  ok(struck, 'enemy strike telegraph (kbb-en-strike) fired once a counter landed');

  // boss music: flag the live enemy as boss, force a fresh enemy render via the next turn
  if (toQuestion()) {
    var st = KBB._test.state();
    st.run.battle.enemy.boss = true; st.run.battle.enemy.hp = st.run.battle.enemy.maxHp = 500;
    q('.kbb-opt:not(:disabled)').click();
    var s2 = q('.kbb-submit'); if (s2 && !s2.disabled) s2.click();
    V.step(3);
    var c2 = q('.kbb-cont:not(.kbb-submit)'); if (c2) { c2.click(); V.step(2); }
    ok(ctx._rec.tracks.some(function (t) { return t.id === 'boss' && t.intensity; }), "boss battle swaps to 'boss' (intensity) via renderEnemy");
    // clearing the flag only takes effect on the NEXT renderEnemy — answer one more turn to force it
    var stLive = KBB._test.state();
    if (stLive.run.battle && stLive.run.battle.enemy) stLive.run.battle.enemy.boss = false;
    if (toQuestion()) {
      q('.kbb-opt:not(:disabled)').click();
      var s3 = q('.kbb-submit'); if (s3 && !s3.disabled) s3.click();
      V.step(3);
      var c3 = q('.kbb-cont:not(.kbb-submit)'); if (c3) { c3.click(); V.step(2); }
    }
    var ti = ctx._rec.tracks.map(function (t) { return t.id; });
    ok(ti.lastIndexOf('kbb') > ti.indexOf('boss'), "bed returns to 'kbb' after the boss flag clears");
  } else {
    ok(false, 'boss-music probe could not reach a live battle');
    ok(false, "bed returns to 'kbb' after the boss flag clears (unreached)");
  }

  // (v0.80.0, JB3) cinematic choreography: a guaranteed-correct answer on a 1-HP enemy must
  // queue the full attack grammar AND the staged-kill sequence (detonation, quake, banner).
  if (toQuestion()) {
    var runF = KBB._test.state().run;
    runF.battle.enemy.hp = 1;                                    // force the win
    var qF = runF.battle.question;
    var ciF = qF.multi ? null : qF.correctIndex;
    if (ciF == null && qF.correctIndices) ciF = qF.correctIndices[0];
    var optF = doc.querySelector('.kbb-opt[data-idx="' + ciF + '"]');
    if (qF.multi && qF.correctIndices) {                          // select ALL correct for multi
      for (var mi = 0; mi < qF.correctIndices.length; mi++) { var ob2 = doc.querySelector('.kbb-opt[data-idx="' + qF.correctIndices[mi] + '"]'); if (ob2) ob2.click(); }
    } else if (optF) optF.click();
    var subF = q('.kbb-submit'); if (subF && !subF.disabled) subF.click();
    var fxT = (KBB._test.state().fx || []).map(function (f) { return f.type; });
    function hasFx(t) { return fxT.indexOf(t) >= 0; }
    ok(hasFx('charge') && hasFx('beam') && hasFx('sparks'),
       'JB3: attack reads cause->effect (charge telegraph + travelling beam + impact sparks) [' + fxT.join(',') + ']');
    ok(hasFx('shock') && hasFx('death') && (KBB._test.state().fx || []).some(function (f) { return f.type === 'quake' && f.amt === 0.5; }),
       'JB3: the kill detonates (shockwave + the heavy 0.5 win-quake + hull breakup)');
    ok((KBB._test.state().fx || []).some(function (f) { return f.type === 'banner' && /DESTROYED/.test(f.text || ''); }),
       'JB3: a DESTROYED banner caps the staged kill');
    // (v0.100.0, K5/K6) choreography truths on the same forced win
    var fxAll = KBB._test.state().fx || [];
    ok(fxAll.filter(function (f) { return f.type === 'sfx' && f.name === 'fire'; }).length >= 3
       && fxAll.filter(function (f) { return f.type === 'sfx' && f.name === 'fire'; }).length % 3 === 0
       && fxAll.some(function (f) { return f.type === 'sfx' && f.name === 'explode'; }),
       'K6: hero three-shot volleys + detonation sounds queued on the beats');
    ok(KBB._test.state().heroExitAt > 0, 'K5: victory schedules the squad fly-off');
    var sSt = KBB._test.state();
    ok(typeof sSt.battleStartAt === 'number' && sSt._battleKey !== '', 'K5: battle-start clock armed (fly-in ran)');
    V.step(4);
    var cW = q('.kbb-cont:not(.kbb-submit)'); if (cW) { cW.click(); V.step(2); }
  } else {
    ok(false, 'JB3 choreography probe could not reach a question');
    ok(false, 'JB3 detonation probe unreached');
    ok(false, 'JB3 banner probe unreached');
  }

  // (v0.91.0) exhibit leak guard: KBB renders the loud warning if an image question leaks
  ok(/kbb-exhibit-warn/.test(H.KBB_SRC) && /q\.image\) p\.appendChild/.test(H.KBB_SRC),
     'GUARD: a leaked exhibit question fails loudly in KBB (source)');

  // (v0.88.0, L3) a wrong single-choice pick surfaces ITS authored optionNote
  if (toQuestion()) {
    var runN = KBB._test.state().run, qN = runN.battle.question;
    if (!qN.multi) {
      var wrongN = (qN.correctIndex + 1) % qN.options.length;
      var obN = doc.querySelector('.kbb-opt[data-idx="' + wrongN + '"]'); if (obN) obN.click();
      var subN = q('.kbb-submit'); if (subN && !subN.disabled) subN.click();
      var noteEl = q('.kbb-fb-note');
      var expectN = 'Your pick \u2014 ' + qN.optionNotes[wrongN];   // (v0.90.0) EXACT match — prefix-only was tautological vs the mock bank
      ok(!!noteEl && noteEl.textContent === expectN,
         "L3: wrong pick shows EXACTLY its own optionNote ('" + (noteEl ? noteEl.textContent.slice(0, 44) : 'none') + "')");
      V.step(3);
      var cN = q('.kbb-cont:not(.kbb-submit)'); if (cN) { cN.click(); V.step(2); }
    } else {
      ok(true, 'L3 note probe skipped (multi question drawn)');
    }
  } else { ok(false, 'L3 note probe could not reach a question'); }

  // (v0.78.0, JB2) shop chrome: actions pinned OUTSIDE the scroll region (no scrolling for
  // Reroll / Next battle). Reach a feedback screen, flip the run to shop, Continue renders it.
  if (toQuestion()) {
    q('.kbb-opt:not(:disabled)').click();
    var s4 = q('.kbb-submit'); if (s4 && !s4.disabled) s4.click();
    V.step(2);
    var run4 = KBB._test.state().run;
    run4.phase = 'shop'; KBB._test.buildShop(run4);
    var c4 = q('.kbb-cont:not(.kbb-submit)'); if (c4) { c4.click(); V.step(2); }
    // (v0.114.0, D6) the 'shop' phase renders the run map; the shop is a stop on it
    ok(!!q('.kbb-main.is-map') && !!q('.kbb-embark'), 'D6: between battles the run map renders with an Embark CTA');
    // (v0.140.0, KBB#2) the debrief card: absent without misses; present with stem + answer after
    // (the drive above answered an arbitrary option, so clear the real misses first)
    run4.misses = [];
    var pick4 = q('.kbb-mapnode.pick'); if (pick4) { pick4.click(); V.step(1); }   // any re-render repaints
    ok(!q('.kbb-debrief'), 'KBB#2: a clean battle leaves NO debrief card on the map');
    run4.misses = [{ id: 'probe', stem: 'DEBRIEF STEM PROBE', correctText: 'THE RIGHT ANSWER', expl: 'One line.' }];
    if (pick4) { pick4.click(); V.step(1); }
    var debC = q('.kbb-debrief');
    ok(!!debC && /DEBRIEF STEM PROBE/.test(debC.textContent) && /THE RIGHT ANSWER/.test(debC.textContent),
       'KBB#2: the map shows the debrief card with the missed stem and the right answer');
    run4.misses = [];
    var shopStop = q('.kbb-mapnode[data-type="shop"]:not(:disabled)');
    ok(!!shopStop, 'D6: a shop stop is available on the corridor');
    if (shopStop) { shopStop.click(); V.step(1); }
    var shopP = q('.kbb-main.is-shop');
    var actions = q('.kbb-shop-actions'), scroll = q('.kbb-shop-scroll');
    ok(!!shopP && !!actions && !!scroll && actions.parentNode === shopP && scroll.parentNode === shopP,
       'JB2: shop renders with a scroll region and a PINNED action row (both direct children)');
    var handEl = q('.kbb-hand');
    ok(!!handEl && handEl.style.display === 'none', 'D5: the hand strip hides while the shop is up');
    var btns = actions ? actions.querySelectorAll('.kbb-btn') : [];
    var hasRe = false, hasNext = false;
    for (var bi = 0; bi < btns.length; bi++) { var bt = (btns[bi].textContent || '').toLowerCase(); if (bt.indexOf('reroll') >= 0) hasRe = true; if (bt.indexOf('next') >= 0 || bt.indexOf('start run') >= 0 || bt.indexOf('return to map') >= 0) hasNext = true; }
    ok(hasRe && hasNext && !scroll.contains(actions),
       'JB2: Reroll + the exit CTA live in the pinned row, never inside the scroll (D6: exit = Return to map)');
    // (v0.114.0, D6) leaving a shop STOP returns to the map without burning the rank
    var rtm = null;
    for (var bj = 0; bj < btns.length; bj++) { if (/return to map/i.test(btns[bj].textContent || '')) rtm = btns[bj]; }
    var roundBefore = KBB._test.state().run.round;
    if (rtm) { rtm.click(); V.step(1); }
    ok(!!rtm && !!q('.kbb-main.is-map') && KBB._test.state().run.round === roundBefore
       && !q('.kbb-mapnode[data-type="shop"]:not(:disabled):not(.used)'),
       'D6: Return to map re-renders the map, round unchanged, the visited stop spent');
  } else {
    ok(false, 'JB2 shop-structure probe could not reach a question');
    ok(false, 'JB2 pinned-row probe unreached');
  }

  // unmount cleanliness
  var before = doc.body.childNodes.length;
  V.mod.unmount();
  ok(!q('.kbb-root'), 'unmount removes the KBB root');
  ok(doc.body.childNodes.length < before || !q('.kbb-root'), 'no orphan DOM after unmount');
  V.step(3);   // any stray RAF after unmount would throw into step's generation
})();

/* ============ REDUCED-MOTION INFO (v0.85.0, B3) ============ */
(function reducedInfo() {
  group('REDUCED MOTION: information survives, motion does not');
  var V = newWindow(), doc = V.doc, KBB = V.KBB;
  V.mod.mount(doc.body, H.makeCtx(KBB, { seed: SEED + 9, reducedMotion: true }));
  V.step(3);
  function q(sel) { return doc.querySelector(sel); }
  var sk = Array.prototype.slice.call(doc.querySelectorAll('.kbb-skip')).find(function (b) { return /skip/i.test(b.textContent || ''); });
  if (sk) { sk.click(); V.step(2); }
  var hts = q('.kbb-ht-skip'); if (hts) { hts.click(); V.step(2); }
  var st = KBB._test.state();
  ok(st && st.reduced === true, 'mount honors ctx reducedMotion');
  var run = st.run;
  run.battle.enemy.hp = 1;
  var qq = run.battle.question;
  var ci = qq.multi ? qq.correctIndices : [qq.correctIndex];
  for (var i = 0; i < ci.length; i++) { var o = doc.querySelector('.kbb-opt[data-idx="' + ci[i] + '"]'); if (o) o.click(); }
  var sub = q('.kbb-submit'); if (sub && !sub.disabled) sub.click();
  var types = (KBB._test.state().fx || []).map(function (f) { return f.type; });
  var fx = KBB._test.state().fx || [];
  ok(fx.some(function (f) { return f.type === 'dmg' && f.static; }), 'B3: damage number still shows (static) [' + types.join(',') + ']');
  ok(fx.some(function (f) { return f.type === 'banner' && f.static; }), 'B3: DESTROYED banner still shows (static, centered)');
  ok(!fx.some(function (f) { return /^(lunge|beam|quake|shock|charge|sparks)$/.test(f.type); }),
     'B3: zero motion fx under reduced motion (no lunge/beam/quake/shock/charge/sparks)');
  V.mod.unmount();
})();

/* ============ PHONE STACK (v0.85.0, B4) — source pins ============ */
(function phoneStack() {
  group('PHONE: question panel under combat, sticky shop actions');
  var SRC = H.KBB_SRC;
  ok(/\.kbb-main\{overflow:visible;order:2;[^}]*\}/.test(SRC) && /\.kbb-combat\{height:250px;flex:none;order:1;\}/.test(SRC)
     && /\.kbb-hand\{order:3;[^}]*\}/.test(SRC) && /\.kbb-leftcol\{min-height:0;order:5;[^}]*\}/.test(SRC),
     'B4: <=820px stack order is combat(1) -> questions(2) -> hand(3) -> enemy(4) -> artifacts(5) (D5)');
  ok(/\.kbb-shop-actions\{position:sticky;bottom:0/.test(SRC),
     'B4: shop actions are sticky-bottom on phones too');
  ok(/tgt\.scrollIntoView\(\{ block: 'center' \}\)/.test(SRC),
     "REVIEW: the how-to tour scrolls each spotlight into view (phone soft-lock fix)");
})();

/* ============ (v0.114.0, D6) RUN MAP — determinism, elite seam, cache claim ============ */
(function d6Map() {
  group('D6: run map — same-seed graphs match, elite battles bite harder, caches pay once');
  // Engine: same seed with/without the elite flag — the ONLY difference is the buff
  var eA = newWindow(), eB = newWindow();
  var ctxA = H.makeCtx(eA.KBB, { seed: 777 }), ctxB = H.makeCtx(eB.KBB, { seed: 777 });
  var runA = eA.KBB._test.createRun ? null : null;
  var KA = eA.KBB, KB = eB.KBB;
  var rA = KA.createRun(ctxA, { seed: 777 }), rB = KB.createRun(ctxB, { seed: 777 });
  rA.phase = 'shop'; rB.phase = 'shop';
  rB.pendingElite = true;
  KA._test.leaveShop ? KA._test.leaveShop(rA) : KA.leaveShop(rA);
  KB._test.leaveShop ? KB._test.leaveShop(rB) : KB.leaveShop(rB);
  var e0 = rA.battle.enemy, e1 = rB.battle.enemy;
  ok(e1.elite === true && !e0.elite && e1.maxHp === Math.round(e0.maxHp * 1.45)
     && e1.baseIntent === e0.baseIntent + 1 && e1.rewardCoins === Math.round(e0.rewardCoins * 1.8)
     && rB.pendingElite === false,
     'D6: pendingElite consumed once — hp ×1.45, intent +1, reward ×1.8 vs the same-seed normal battle');
  // DOM: deterministic graph + cache claim (JB2 recipe: answer -> force shop -> Continue -> map)
  function mapOf(seed) {
    var W2 = newWindow(), ctx2 = H.makeCtx(W2.KBB, { seed: seed });
    W2.mod.mount(W2.doc.body, ctx2); W2.step(3);
    var sk2 = Array.prototype.slice.call(W2.doc.querySelectorAll('.kbb-skip')).find(function (b) { return /skip/i.test(b.textContent || ''); });
    if (sk2) { sk2.click(); W2.step(2); }
    var ht2 = W2.doc.querySelector('.kbb-ht-skip'); if (ht2) { ht2.click(); W2.step(2); }
    var st2 = W2.KBB._test.state();
    var q0 = st2.run.battle.question;
    var ci0 = (q0 && q0.correctIndices) ? q0.correctIndices : [q0 ? q0.correctIndex : 0];
    for (var qi = 0; qi < ci0.length; qi++) { var ob = W2.doc.querySelector('.kbb-opt[data-idx="' + ci0[qi] + '"]'); if (ob) ob.click(); }
    var sb = W2.doc.querySelector('.kbb-submit'); if (sb && !sb.disabled) sb.click();
    st2.run.phase = 'shop'; W2.KBB._test.buildShop(st2.run);
    var c2 = W2.doc.querySelector('.kbb-cont:not(.kbb-submit)'); if (c2) { c2.click(); W2.step(1); }
    var m2 = W2.KBB._test.state().run.map;
    return { win: W2, map: m2 ? JSON.parse(JSON.stringify({ nodes: m2.nodes, stops: m2.stops.map(function (s3) { return { id: s3.id, afterRank: s3.afterRank, type: s3.type, ev: s3.ev || null }; }) })) : null };
  }
  var g1 = mapOf(4242), g2 = mapOf(4242), g3 = mapOf(9191);
  ok(!!g1.map && JSON.stringify(g1.map) === JSON.stringify(g2.map),
     'D6: same seed → the same section graph (nodes + stops byte-identical)');
  ok(!!g3.map && g3.map.nodes.length >= 5 && g3.map.stops.length >= 5,
     'D6: a different seed still yields a well-formed graph (5-rank spine + a stop per corridor)');
  // cache claim: inject an unknown stop on the live corridor, click it, coins land once
  var W4 = g1.win, doc4 = W4.doc, st4 = W4.KBB._test.state();
  var coins0 = st4.run.squad.coins;
  st4.run.map.stops.push({ id: 'wXu', afterRank: st4.run.round, type: 'unknown', used: false, coins: 20 });
  var selNode = doc4.querySelector('.kbb-mapnode.pick'); if (selNode) { selNode.click(); W4.step(1); }   // any re-render paints the injected stop
  var unk = doc4.querySelector('.kbb-mapnode[data-node="wXu"]');
  if (unk) { unk.click(); W4.step(1); }
  var coins1 = W4.KBB._test.state().run.squad.coins;
  var unk2 = doc4.querySelector('.kbb-mapnode[data-node="wXu"]');
  if (unk2 && !unk2.disabled) { unk2.click(); W4.step(1); }
  var coins2 = W4.KBB._test.state().run.squad.coins;
  ok(!!unk && coins1 === coins0 + 20 && coins2 === coins1 && (!unk2 || unk2.disabled),
     'D6: an unknown stop pays its salvage cache exactly once (' + coins0 + ' → ' + coins1 + ' → ' + coins2 + ')');
  // ============ (v0.133.0, V1.1 KBB#1) the event deck ============
  {
    var st5 = W4.KBB._test.state();
    function driveStop(ev, id5) {
      st5.run.map.stops.push({ id: id5, afterRank: st5.run.round, type: 'unknown', used: false, ev: ev });
      var sel5 = doc4.querySelector('.kbb-mapnode.pick'); if (sel5) { sel5.click(); W4.step(1); }
      var node5 = doc4.querySelector('.kbb-mapnode[data-node="' + id5 + '"]');
      if (node5) { node5.click(); W4.step(1); }
      return !!node5;
    }
    var consB = st5.run.consumables.length;
    ok(driveStop({ type: 'supply', cid: 'repair' }, 'wS1') && st5.run.consumables.length === consB + 1,
       'KBB#1: a supply-drop stop grants a consumable');
    st5.run.squad.hp = Math.max(1, st5.run.squad.hp - 8);
    var hpLow = st5.run.squad.hp;
    ok(driveStop({ type: 'repair', heal: 6 }, 'wS2') && st5.run.squad.hp === Math.min(st5.run.squad.maxHp, hpLow + 6),
       'KBB#1: a field-repair stop heals (capped at maxHp)');
    var coinG = st5.run.squad.coins;
    ok(driveStop({ type: 'gamble', win: true, coins: 30, dmg: 4 }, 'wS3') && st5.run.squad.coins === coinG + 30,
       'KBB#1: a winning gamble pays out');
    var hpG = st5.run.squad.hp;
    ok(driveStop({ type: 'gamble', win: false, coins: 30, dmg: 4 }, 'wS4') && st5.run.squad.hp === Math.max(1, hpG - 4),
       'KBB#1: a losing gamble bites, never lethal');
    var evTypes = (g1.map.stops || []).map(function (s6) { return s6.ev && s6.ev.type; }).join(',');
    var evTypes2 = (g2.map.stops || []).map(function (s6) { return s6.ev && s6.ev.type; }).join(',');
    ok(evTypes === evTypes2 && /cache|supply|repair|gamble/.test(evTypes),
       'KBB#1: the event deck is pre-rolled deterministically per seed (' + evTypes + ')');
  }
  // (v0.149.0, KBB#3) DOM: flip the live run to WON and repaint — the gold victory card
  // renders, and Push into the Deep Belt claims back into the run (shop phase)
  {
    var stW = W4.KBB._test.state();
    stW.run.won = true; stW.run.phase = 'won'; stW.run._winBanked = true;   // banked already — the DOM is under test
    var rpW = doc4.querySelector('.kbb-mapnode.pick'); if (rpW) { rpW.click(); W4.step(2); }
    var cardW = doc4.querySelector('.kbb-won');
    ok(!!cardW && /VICTORY/.test(cardW.textContent) && /Flagship/.test(cardW.textContent), 'KBB#3 DOM: the gold VICTORY card renders over the map');
    var pushBtn = doc4.querySelector('.kbb-won-push');
    if (pushBtn) { pushBtn.click(); W4.step(2); }
    ok(!!pushBtn && stW.run.phase === 'shop' && !doc4.querySelector('.kbb-won'), 'KBB#3 DOM: Push into the Deep Belt clears the card and claims into the shop');
  }
})();

/* ============ Flow#7 (v0.179.0): the Lieutenant perk pays +25 starting coins ============ */
(function rankPerk() {
  group('Flow#7: ctx.perks.kbbCoins raises the starting purse (CONFIG untouched)');
  var V = newWindow(), K = V.KBB;
  var ctxP = H.makeCtx(K, { seed: SEED + 91 }); ctxP.perks = { kbbCoins: 25 };
  var runP = K.createRun(ctxP, { seed: SEED + 91 });
  var runN = K.createRun(H.makeCtx(K, { seed: SEED + 91 }), { seed: SEED + 91 });
  ok(runN.squad.coins === 6 && runP.squad.coins === 31,
     'perked run starts at 31 coins, stock run at 6 — the perk rides ctx, never CONFIG');
})();

H.summary('KBB RUN');
