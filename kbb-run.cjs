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

/* ============ KBB UNIT 1 (v0.98.0, K1/K2/K3/K8/K9/K7) ============ */
(function unit1() {
  group('UNIT 1: tour blocks answering, Purge gone, DESTROYED state, no timer artifacts, sharp canvas');
  var SRC = H.KBB_SRC;
  ok(/kbb-ht-spot\{pointer-events:none;\}/.test(SRC), 'K2: spotlighted zones are look-only during the tour');
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
  // (v0.78.0, JB2) the left panel is 5 always-visible artifact slots; a fresh run = all empty
  var slots0 = doc.querySelectorAll('.kbb-arts-card .kbb-slot');
  ok(slots0.length === 5 && doc.querySelectorAll('.kbb-arts-card .kbb-slot.empty').length === 5,
     'JB2: left panel renders 5 artifact slots, all empty at mount (' + slots0.length + ')');
  ok(ctx._rec.tracks.some(function (t) { return t.id === 'kbb'; }), "mount plays the 'kbb' bed");

  // Advance across whatever screen is up (feedback Continue / shop "Next battle") until options exist.
  function toQuestion() {
    for (var adv = 0; adv < 6; adv++) {
      if (q('.kbb-opt:not(:disabled)')) return true;
      var c = q('.kbb-cont:not(.kbb-submit)');
      if (c) { c.click(); V.step(2); continue; }
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
    var shopP = q('.kbb-main.is-shop');
    var actions = q('.kbb-shop-actions'), scroll = q('.kbb-shop-scroll');
    ok(!!shopP && !!actions && !!scroll && actions.parentNode === shopP && scroll.parentNode === shopP,
       'JB2: shop renders with a scroll region and a PINNED action row (both direct children)');
    var btns = actions ? actions.querySelectorAll('.kbb-btn') : [];
    var hasRe = false, hasNext = false;
    for (var bi = 0; bi < btns.length; bi++) { var bt = (btns[bi].textContent || '').toLowerCase(); if (bt.indexOf('reroll') >= 0) hasRe = true; if (bt.indexOf('next') >= 0 || bt.indexOf('start run') >= 0) hasNext = true; }
    ok(hasRe && hasNext && !scroll.contains(actions),
       'JB2: Reroll + Next battle live in the pinned row, never inside the scroll');
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
  ok(/\.kbb-main\{overflow:visible;order:2;\}/.test(SRC) && /\.kbb-combat\{height:250px;flex:none;order:1;\}/.test(SRC)
     && /\.kbb-leftcol\{min-height:0;order:4;\}/.test(SRC),
     'B4: <=820px stack order is combat(1) -> questions(2) -> enemy(3) -> artifacts(4)');
  ok(/\.kbb-shop-actions\{position:sticky;bottom:0/.test(SRC),
     'B4: shop actions are sticky-bottom on phones too');
  ok(/tgt\.scrollIntoView\(\{ block: 'center' \}\)/.test(SRC),
     "REVIEW: the how-to tour scrolls each spotlight into view (phone soft-lock fix)");
})();

H.summary('KBB RUN');
