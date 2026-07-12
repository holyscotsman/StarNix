/* arm-run.cjs — the ARM engine + DOM run-through harness (new in v0.52.0, unit 1 of the
 * NIGHT_RUN queue). Mirrors kbb-run.cjs. Drives arm.js in jsdom with ctx.test=true (no RAF —
 * frames advance via root.__armTest.step(dt)) through:
 *   mount → INTRO → BRIEF (real briefing clicks) → WARP → live SECTOR;
 *   grading right/wrong (mastery + telemetry + coins/held); question-timeout structure
 *   (forceTimeout grades WRONG, no hang — the actual QA-A5 code path: question timeouts
 *   never damage; see NIGHT_LOG 2026-07-03 for the doc discrepancy this pins);
 *   depot round-trip (HOME → DEPOT_Q → DEPOT_SUM → SHOP → next sector);
 *   damage → gameOver via the puzzle stability-timer breach chain (a REAL death-by-timeout)
 *   landing on the GAME OVER panel; pause/gnow() freeze; determinism; unmount cleanliness.
 * Deterministic (seeded). Run: node arm-run.cjs   |   ARM_SEED=n overrides the seed.
 */
'use strict';
var H = require('./arm-headless.cjs');
var JSDOM = require('jsdom').JSDOM, VC = require('jsdom').VirtualConsole;
var ok = H.ok, group = H.group;

var SEED = parseInt(process.env.ARM_SEED || '11', 10);

function newWindow() {
  var vc = new VC(); vc.on('jsdomError', function () {});
  var dom = new JSDOM('<!DOCTYPE html><body></body>', { runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
  var win = dom.window;
  var mod = null; win.StarNix = { registerGame: function (m) { mod = m; } };
  win.eval(H.ARM_SRC);
  var root = win.document.createElement('div');
  win.document.body.appendChild(root);
  return { win: win, doc: win.document, mod: mod, root: root };
}
function busyWait(ms) { var e = Date.now() + ms; while (Date.now() < e) {} }
function textOf(doc, sel) { var e = doc.querySelector(sel); return e ? (e.textContent || '') : ''; }
function clickByText(doc, sel, re) {
  var e = Array.prototype.slice.call(doc.querySelectorAll(sel));
  for (var i = 0; i < e.length; i++) { if (re.test(e[i].textContent || '')) { e[i].click(); return true; } }
  return false;
}
function pickBrief(T, re) {
  var opts = T.briefOptions();
  for (var i = 0; i < opts.length; i++) { if (re.test(opts[i])) { T.briefPick(i); return true; } }
  return false;
}

/* ================= 1) FLOW: mount → briefing clicks → warp → live sector ================= */
var V = newWindow(), doc = V.doc, mod = V.mod, root = V.root;
var ctx = H.makeCtx({ seed: SEED });
var detSector3 = null;   // captured for the determinism probe against window 2

(function flow() {
  group('FLOW: registration → INTRO → BRIEF (real clicks) → WARP → SECTOR');
  ok(!!mod && mod.id === 'ARM' && typeof mod.mount === 'function' && typeof mod.unmount === 'function'
     && typeof mod.pause === 'function' && typeof mod.resume === 'function',
     'module registered: { id:"ARM", mount, unmount, pause, resume }');
  mod.mount(root, ctx);
  var T = root.__armTest;
  ok(!!T && T.state() === 'INTRO', 'mount lands in INTRO with the __armTest seam attached');
  T.endBriefingIntro();
  ok(T.state() === 'BRIEF' && pickBrief(T, /go ahead/i), 'INTRO → BRIEF; Vega offers "Go ahead, sir"');
  var guard = 0;
  while (T.state() === 'BRIEF' && guard++ < 12) {
    if (pickBrief(T, /hyperdrive/i)) break;
    if (!pickBrief(T, /understand/i)) break;
  }
  ok(T.state() === 'WARP', 'briefing walked core-by-core via real options to "Engage hyperdrive" → WARP');
  T.flushWarp();
  ok(T.state() === 'SECTOR', 'flushWarp completes the jump → live SECTOR');
  var cores = T.cores(), qids = {};
  cores.forEach(function (c) { qids[c.qid] = 1; });
  ok(cores.length === 5 && Object.keys(qids).length === 5, 'sector spawns 5 cores with 5 distinct question ids');
  ok(ctx._rec.tracks.some(function (t) { return t.id === 'arm'; }), "mount/sector plays the 'arm' bed");
  detSector3 = JSON.stringify(T.coresForSector(3));
})();

/* ================= 2) GRADING: right/wrong through the live question seam ================= */
(function grading() {
  group('GRADING: core-scan right/wrong → mastery, telemetry, coins, cargo');
  var T = root.__armTest;
  var coins0 = T.coins();
  T.prepCore(1);                                   // combat core: gate cleared → "unlocked"
  ok(T.cores()[1].state === 'unlocked', 'prepCore clears the combat gate (core 1 unlocked)');
  T.arrive(1);
  ok(T.state() === 'QUESTION' && T.hasQuestion(), 'arriving at an unlocked core opens the QUESTION panel');
  ok(T.timerStarted() === false, 'countdown has NOT started yet (waits for the option reveal — R5 fairness)');
  var qid1 = T.cores()[1].qid;
  T.answer(true);
  var m = ctx._rec.mastery;
  ok(m.length >= 1 && m[m.length - 1].id === qid1 && m[m.length - 1].correct === true
     && m[m.length - 1].meta && m[m.length - 1].meta.game === 'ARM',
     'right answer → mastery.record(id, true, {game:"ARM"})');
  ok(T.coins() === coins0 + 15 && T.held().indexOf(qid1) >= 0 && T.cores()[1].state === 'collected'
     && T.state() === 'SECTOR', 'right answer → +15 coins, core collected into cargo, back to SECTOR');
  T.prepCore(4); T.arrive(4);
  var qid4 = T.cores()[4].qid, coins1 = T.coins();
  T.answer(false);
  m = ctx._rec.mastery;
  ok(m[m.length - 1].id === qid4 && m[m.length - 1].correct === false, 'wrong answer → mastery.record(id, false)');
  ok(T.coins() === coins1 && T.cores()[4].state === 'lost' && T.held().indexOf(qid4) < 0,
     'wrong answer → no coins, core lost (never damages shields)');
  var tel = ctx._rec.telemetry.filter(function (e) { return e.t === 'question_answered'; });
  ok(tel.length >= 2 && tel.some(function (e) { return e.correct === true; }) && tel.some(function (e) { return e.correct === false; }),
     'telemetry question_answered fired for both outcomes');
})();

/* ================= 3) QUESTION TIMEOUT (forceTimeout): grades wrong + COSTS SHIELDS ================= */
(function timeout() {
  group('TIMEOUT: forceTimeout grades WRONG, damages shields (Jason\'s QA-A5 ruling), no hang');
  var T = root.__armTest;
  T.arrive(0);                                       // core 0 is a puzzle core
  ok(T.state() === 'PUZZLE' && T.solvePuzzle(), 'puzzle core opens PUZZLE; solvePuzzle() hands off to the core scan');
  var sh0 = T.puzzleInfo().shields;
  ok(T.state() === 'QUESTION' && T.forceTimeout() === true, 'forceTimeout() expires the live question countdown');
  var m = ctx._rec.mastery;
  ok(m[m.length - 1].correct === false, 'timeout graded as a WRONG answer into mastery');
  ok(T.puzzleInfo().shields === sh0 - 14, 'field timeout costs exactly QUESTION_TIMEOUT_DMG shields (' + sh0 + ' -> ' + T.puzzleInfo().shields + ')');
  var expl = textOf(doc, '.arm-explain');
  var cont = doc.querySelector('.arm-panel > button.arm-act');
  ok(/time/i.test(expl) && !!cont && cont.style.display !== 'none',
     'non-lethal: panel shows the "Time\'s up" explanation + a live Continue (no hang)');
  T.answer(false);                                   // choose() is a no-op post-grade; proceed() fires
  ok(T.state() === 'SECTOR' && T.cores()[0].state === 'lost',
     'Continue path resolves as before: core lost, back to SECTOR');
})();

/* ================= 4) DEPOT: return → dock → install → summary → shop → next sector ================= */
(function depot() {
  group('DEPOT: engageReturn → HOME dock → install question → summary → shop → sector 2');
  var T = root.__armTest;
  var coins0 = T.coins(), station0 = T.station();
  T.engageReturn(); T.flushWarp();
  ok(T.state() === 'HOME', 'engageReturn + flushWarp lands at the HOME station');
  T.dock();
  ok(T.state() === 'DEPOT_Q' && T.hasQuestion(), 'docking opens the depot install question for the carried core');
  T.answer(true);
  var dPayPin = 25 + T.sector() * 2;   // (v0.161.0, ARM#5) install pay ramps with depth
  ok(T.state() === 'DEPOT_SUM' && T.station() === station0 + 1 && T.coins() === coins0 + dPayPin,
     'right install → station +1, +' + dPayPin + ' coins (depth-ramped), delivery summary');
  T.closeSummary();
  ok(T.state() === 'SHOP', 'summary → SHOP');
  T.closeShop();
  ok(T.state() === 'SECTORCLEAR' && /Sector cleared/.test(textOf(doc, '.arm-panel')), 'shop close → SECTORCLEAR panel');
  ok(clickByText(doc, '.arm-panel button', /next sector/i) && T.state() === 'BRIEF' && T.sectorNum() === 2,
     '"Next sector" advances the run to the sector 2 briefing');
})();

/* ================= 5) DEATH BY TIMEOUT: puzzle breach chain → damage → GAME OVER panel ================= */
(function death() {
  group('DEATH: stability-timer breaches drain shields → gameOver → GAME OVER panel → relaunch');
  var T = root.__armTest;
  T.skipBriefing(); T.flushWarp();
  ok(T.state() === 'SECTOR' && T.sectorNum() === 2, 'sector 2 reached for the death probe');
  var sh0 = T.puzzleInfo().shields;
  T.openPuzzleAt(2, 'battery');                      // battery arms its stability bar immediately
  var info = T.puzzleInfo();
  ok(T.state() === 'PUZZLE' && info.active && info.barShown, 'forced battery puzzle arms the stability bar');
  T.step(info.limit + 0.1);                          // one un-clamped step burns the whole bar → breach
  var sh1 = T.puzzleInfo().shields;
  ok(sh1 < sh0, 'stability breach damages shields (' + sh0 + ' → ' + sh1 + ')');
  var guard = 0;
  while (T.state() === 'PUZZLE' && guard++ < 12) T.step(T.puzzleInfo().limit + 0.1);
  ok(T.state() === 'GAMEOVER' && T.puzzleInfo().shields === 0,
     'repeated breaches reach 0 shields → damage() triggers GAMEOVER (timeout-driven death)');
  T.step(1.2);                                       // burn the 1.1 s death beat → panel fills
  var panel = doc.querySelector('.arm-panel');
  ok(!!panel && /peach/.test(panel.className) && /Ship destroyed/.test(panel.textContent || ''),
     'GAME OVER panel renders: .arm-panel.peach, "Ship destroyed" (no hang — QA-A5 structural)');
  ok(clickByText(doc, '.arm-panel button', /relaunch/i), 'panel offers "Relaunch sector"');
  ok(T.state() === 'SECTOR' && T.puzzleInfo().shields > 0, 'relaunch resets the sector with shields restored');

  // (v0.65.0) DEATH BY QUESTION TIMEOUT — QA-A5's ORIGINAL scenario, now real code:
  // drain to <= QUESTION_TIMEOUT_DMG via breaches, then let the scan timer expire.
  T.openPuzzleAt(2, 'battery');
  var g2 = 0;
  while (T.puzzleInfo().shields > 14 && T.state() === 'PUZZLE' && g2++ < 10) T.step(T.puzzleInfo().limit + 0.1);
  ok(T.state() === 'PUZZLE' && T.puzzleInfo().shields > 0 && T.puzzleInfo().shields <= 14,
     'breach chain leaves the ship at ' + T.puzzleInfo().shields + ' shields (lethal-timeout range)');
  ok(T.solvePuzzle() && T.state() === 'QUESTION', 'solved puzzle hands off to the core scan at low shields');
  T.forceTimeout();
  ok(T.state() === 'GAMEOVER' && T.hasQuestion() === false,
     'lethal timeout: timeUp -> damage -> GAMEOVER, pending question cleared (no stale Continue)');
  T.step(1.2);
  ok(/Ship destroyed/.test((doc.querySelector('.arm-panel') || {}).textContent || ''),
     'the GAME OVER panel lands off a pure question timeout (QA-A5 canon)');
  ok(clickByText(doc, '.arm-panel button', /relaunch/i) && T.state() === 'SECTOR',
     'relaunch recovers to SECTOR for the downstream probes');
})();

/* ================= 5b) BOSS KILL: shake decays + resets, boss bed ends on destroy ================= */
(function bossKill() {
  group('BOSS KILL (J1/J2): shake hygiene through the fight, boss bed ends the moment it dies');
  var T = root.__armTest;
  var info = T.setupBossSector();
  ok(info.enabled === true && T.state() === 'SECTOR', 'setupBossSector arms the dreadnought arena');
  ok(ctx._rec.tracks.some(function (t) { return t.id === 'boss'; }), "arena entry plays the 'boss' bed");
  var kills = 0, guard = 0;
  while (kills < 5 && guard++ < 12) {
    T.hitWeakpoint(T.bossInfo().wpMax);              // break the active weakpoint -> sheds a core
    if (kills === 0) {
      ok(T.shake() > 0, 'weakpoint break kicks screen shake (' + T.shake().toFixed(1) + ')');
      T.step(1.5);
      ok(T.shake() === 0, 'shake decays back to zero mid-fight (sanity; the J1 leak fix is the resets below)');
    }
    var cs = T.cores(), target = null;
    for (var i = cs.length - 1; i >= 0; i--) { var c = cs[i]; if (c.state !== 'collected' && c.state !== 'lost' && c.kind !== 'combat') { target = c.idx; break; } }
    if (target == null) break;
    T.arrive(target);
    if (T.state() !== 'QUESTION') break;
    T.answer(true);
    kills++;
  }
  ok(kills === 5 && T.bossInfo().dying === true, 'five weakpoints -> five caught cores -> reactor breached (dying)');
  var ids = ctx._rec.tracks.map(function (t) { return t.id; });
  ok(ids.lastIndexOf('arm') > ids.lastIndexOf('boss'), "J2: the 'arm' bed replaces 'boss' the moment the reactor breaches");
  // leak regression (J1): shake raised by death blasts must NOT survive into the home/next world
  T.step(1.0);                                       // death sequence blasts raise shake
  T.engageReturn(); T.flushWarp();
  ok(T.state() === 'HOME' && T.shake() === 0, 'J1: no leaked shake at the home station (was frozen 11-18px forever)');
  // (v0.82.0, Jason) reticle REMOVED by request — active weakpoint reads via beacon + burning
  // core + peach HP arc, with no gold ring of any kind. Honest re-pin of the v0.76 guard.
  ok(!/RETICLE_R/.test(H.ARM_SRC) && !/lock-on ping/.test(H.ARM_SRC)
     && /beacon shaft/.test(H.ARM_SRC) && /pulsing gold core/.test(H.ARM_SRC) && /HP arc stays the damage read/.test(H.ARM_SRC),
     'active weakpoint = beacon + burning core + HP arc, NO gold ring (v0.82 rework)');
  // (v0.82.0) all five weakpoints sit on the PROW: every WP_DEFS oy is positive (front = +oy)
  var wpBlock = (H.ARM_SRC.match(/WP_DEFS = \[[\s\S]*?\];/) || [''])[0];
  ok(wpBlock.length > 0 && (wpBlock.match(/oy: \+0\./g) || []).length === 5 && !/oy: -/.test(wpBlock),
     'weakpoints are front-mounted: 5 ports, all oy positive, none astern');
  // (v0.83.0, review) the CORE DISC (r=wpR=20) must sit INSIDE the vector-fallback wedge at both
  // a small screen (W=360) and the sprite cap (dw=460) — pins the containment claim numerically.
  (function () {
    var defs = [], re = /ox:\s+([+-]?\d*\.?\d+), oy: \+(\d*\.?\d+)/g, m2;
    while ((m2 = re.exec(wpBlock))) defs.push({ ox: parseFloat(m2[1]), oy: parseFloat(m2[2]) });
    function halfW(y, hw) { return y <= 14 ? hw - hw * 0.5 * (y + 34) / 48 : hw * 0.5 * (52 - y) / 38; }
    var okAll = defs.length === 5;
    [360, 742].forEach(function (Wpx) {                       // 742 -> dw caps at 460
      var dw = Math.min(Wpx * 0.62, 460), dh = dw * 533 / 800, hw = Math.min(Wpx * 0.28, 200);
      defs.forEach(function (dfn) {
        var x = Math.abs(dfn.ox) * dw * 0.5, y = dfn.oy * dh * 0.5;
        if (x + 20 > halfW(y, hw) || y + 20 > 52 + 6) okAll = false;   // 6px tip grace
      });
    });
    ok(okAll, 'core discs sit inside the fallback wedge at W=360 AND the dw=460 cap (5 ports x 2 widths)');
  })();
  // (v0.82.0) boss backdrop: vertical hyperspeed rush, time-driven, reduced-motion calm path
  ok(/BOSS_FLOW = 920/.test(H.ARM_SRC) && /bt \* BOSS_FLOW \* depth/.test(H.ARM_SRC)
     && /bossActive\) drawBossRush\(\)/.test(H.ARM_SRC) && /three static faint shafts/.test(H.ARM_SRC),
     'boss arena rushes upward: BOSS_FLOW streaks behind the world, calm under reduced motion');
  // (v0.112.0, D4) Center-console briefing: cockpit scene shows in BRIEF, manifest mirrors
  // progress, console keys stay 1:1 with briefOpts (the A5 answer-last pin still guards content)
  ok(/arm-brfscene/.test(H.ARM_SRC) && /show\(brfScene, s === "BRIEF"\)/.test(H.ARM_SRC)
     && /arm-mhex/.test(H.ARM_SRC) && /CORE MANIFEST/.test(H.ARM_SRC)
     && /state !== "BRIEF" \|\| paused\) return;/.test(H.ARM_SRC),
     'D4: center-console scene wired (BRIEF-only + pause-guarded, manifest hexes, 1/2/3 console keys — R1)');
  ok(/R_WORLD = 900, i2;/.test(H.ARM_SRC),
     'R1: drawRadarOnly declares i2 (undeclared strict-mode assignment threw every radar frame)');
  ok(H.ARM_SRC.includes('.arm-reduce .arm-brf-station,.arm-reduce .arm-brf-station .bem,'),
     'R1: reduced motion kills the briefing ember pulse too (.bem had its own animation)');
  ok(/var TAPE_TXT = \["N", "30"/.test(H.ARM_SRC) && /hudCapStr = "", hudCapDeg = -1/.test(H.ARM_SRC),
     'R1: cockpit HUD draws from cached label table + heading caption (no per-frame string churn)');
  ok(/mm\.life = 9; sfx\("missile"\);/.test(H.ARM_SRC),
     'v0.121.0: the dreadnought MISSILE fires its own sfx("missile"), NOT the laser-charge zap (Jason)');
  ok(/drawBossAura\(\);\s*\n\s*drawBossAt\(/.test(H.ARM_SRC) && /function drawBossAura\(\)/.test(H.ARM_SRC),
     'v0.123.0: the dreadnought looms out of a red danger-aura drawn BEHIND it (Jason boss look/feel)');
  ok(/banner\.classList\.toggle\("boss", !!bossActive\)/.test(H.ARM_SRC) && /\.arm-banner\.boss\{top:auto;bottom:104px/.test(H.ARM_SRC),
     'v0.123.0: the boss objective banner drops to the bottom, off the dreadnought (Jason)');
  ok(/v0\.123\.0\) faint green wash = "stand HERE"/.test(H.ARM_SRC),
     'v0.123.0: the wall-laser SAFE column reads clearly (green lane fill + brighter outline) (Jason)');
  ok(/if \(devMode\(\)\) \{[^]*?Skip to boss fight/.test(H.ARM_SRC),
     'v0.125.0 cleanup: the ARM Settings dev tools ("Skip to boss fight") are gated behind devMode() — not shipped to players');
  // (v0.111.0, D3) Cockpit-lite HUD sources: tape+radar draw fn, rail rows, HC-gated vignette
  ok(/function drawCockpitHud\(\)/.test(H.ARM_SRC) && /drawCompass\(\);\s*\n\s*drawCockpitHud\(\);/.test(H.ARM_SRC)
     && /arm-rrow/.test(H.ARM_SRC) && /if \(!highContrast\) wrap\.appendChild\(mk\("div", "arm-vignette"\)\)/.test(H.ARM_SRC),
     'D3: cockpit HUD wired (tape/radar in the draw loop, icon rail, vignette skipped in high contrast)');
  // (v0.108.0, G4 HIGH) the wall laser must produce a FINITE gap (bossArena has .l, not .x —
  // gapX was NaN and the wall mode was completely inert since v0.97)
  (function () {
    var st9 = T.setupBossSector(6);   // (v0.142.0, ARM#2) B1 no longer fields the wall — probe B2
    var found = false, guard9 = 0;
    while (!found && guard9++ < 400) {
      T.refillShields(); T.step(0.1);
      var bi9 = T.bossInfo();
      if (bi9 && bi9.laserMode === 'wall') found = true;
    }
    var gap9 = T.bossGapX ? T.bossGapX() : NaN;
    ok(found && isFinite(gap9) && gap9 > 0,
       'A10 wall laser arms with a FINITE safe-gap x (' + (found ? Math.round(gap9) : 'never armed') + ')');
  })();
  // (v0.97.0, A10) boss arsenal: seekers + dual lasers
  ok(/MISSILE_SPEED = 130, MISSILE_TURN = 1\.7, MISSILE_R = 10/.test(H.ARM_SRC)
     && /boss\.laserMode = runRng\.next\(\) < \(1 - P\.wallP\) \? "beam" : "wall"/.test(H.ARM_SRC)
     && /Math\.abs\(ship\.x - boss\.gapX\) >= GAP_HALF/.test(H.ARM_SRC),
     'A10/ARM#2: seeking missiles + wall laser, wall chance now per-boss (P.wallP)');
  (function () {
    // behavioral: drive the boss with a forced missile — it must steer toward the ship,
    // die to a player bullet, and never linger past its life.
    var st = T.setupBossSector();
    ok(st.enabled === true, 'A10 probe: boss sector armed (sector 3)');
    T.spawnMissileAt(600, 160);
    var m0 = T.missileInfo();
    T.step(0.5);
    var m1 = T.missileInfo();
    ok(m0.active === 1 && m1.active === 1 && m1.distToShip < m0.distToShip,
       'A10: missile steers toward the ship (' + Math.round(m0.distToShip) + ' -> ' + Math.round(m1.distToShip) + ')');
    T.shootAtMissile();
    for (var fs = 0; fs < 30 && T.missileInfo().active > 0; fs++) T.step(1 / 60);
    ok(T.missileInfo().active === 0, 'A10: a player bullet detonates the seeker');
  })();
  // (v0.142.0, V1.1 ARM#2) four dreadnoughts, four fights — the pattern table drives them
  (function () {
    var s3 = T.setupBossSector(3), s6 = T.setupBossSector(6), s9 = T.setupBossSector(9), s12 = T.setupBossSector(12);
    ok(s3.pattern === 'VANGUARD' && s6.pattern === 'BULWARK' && s9.pattern === 'TEMPEST' && s12.pattern === 'ANNIHILATOR',
       'ARM#2: sectors 3/6/9/12 fly four NAMED dreadnoughts (' + [s3.pattern, s6.pattern, s9.pattern, s12.pattern].join('/') + ')');
    // B1: the wall NEVER arms (wallP 0 — teach the fight on the single beam)
    T.setupBossSector(3);
    var sawWall = false;
    for (var w1 = 0; w1 < 400; w1++) { T.refillShields(); T.step(0.1); var b1 = T.bossInfo(); if (b1 && b1.laserMode === 'wall') { sawWall = true; break; } }
    ok(!sawWall, 'ARM#2 B1 VANGUARD: 40 simulated seconds, the wall barrage never arms (beam only)');
    var p1 = T.bossPatternInfo();
    ok(p1 && p1.wallP === 0 && !p1.twin && p1.escortEvery === 0 && !p1.enrage, 'ARM#2 B1 table: no wall, no twin, no escorts, no enrage');
    // B2: escort drones launch in the arena (the old bossActive spawn freeze is bypassed by design)
    T.setupBossSector(6);
    var e0 = T.bossEscorts();
    for (var w2 = 0; w2 < 110; w2++) { T.refillShields(); T.step(0.1); }   // 11 s > escortEvery 9
    ok(e0 === 0 && T.bossEscorts() >= 2, 'ARM#2 B2 BULWARK: escort drones launch from the flanks (' + T.bossEscorts() + ' in the arena)');
    ok(T.bossPatternInfo().escortEvery === 9 && T.bossPatternInfo().wallP === 0.4, 'ARM#2 B2 table: wall unlocked + 9s escort cadence');
    // B3: twin beams — when a beam charges, a SECOND column arms with it
    T.setupBossSector(9);
    var sawTwin = false;
    for (var w3 = 0; w3 < 400; w3++) { T.refillShields(); T.step(0.1); var b3 = T.bossInfo(); if (b3 && b3.laserState !== 'none' && b3.laserMode === 'beam' && b3.twin) { sawTwin = true; break; } }
    ok(sawTwin, 'ARM#2 B3 TEMPEST: the beam charges with a second simultaneous column');
    ok(T.bossPatternInfo().missLo === 3.5 && T.bossPatternInfo().laserLo === 3.5, 'ARM#2 B3 table: tighter seeker + laser cadences');
    // B4: everything + enrage at 3 broken ports
    T.setupBossSector(12);
    var p4 = T.bossPatternInfo();
    ok(p4 && p4.enrage && p4.twin && p4.escortEvery === 8 && p4.wallP === 0.4, 'ARM#2 B4 ANNIHILATOR table: wall + twin + escorts + enrage');
    var bi4a = T.bossInfo();
    ok(bi4a && bi4a.enraged === false, 'ARM#2 B4: calm before three ports break');
    T.breakWeakpoints(3);
    T.step(0.05);
    var bi4b = T.bossInfo();
    ok(bi4b && bi4b.enraged === true, 'ARM#2 B4: three broken ports trip the ENRAGE (faster weave + tighter cadence)');
  })();
  // (v0.148.0, V1.1 ARM#3) two archetypes, tier-gated — the belt escalates in KIND, not just HP
  (function () {
    var t0 = T.rollTypes(200, 1), t1 = T.rollTypes(200, 6), t2 = T.rollTypes(200, 10);
    var has = function (arr, ty) { return arr.indexOf(ty) >= 0; };
    ok(!has(t0, 'orbiter') && !has(t0, 'lancer'), 'ARM#3 T0 (sector 1): chasers ONLY — onboarding untouched');
    ok(has(t1, 'orbiter') && !has(t1, 'lancer'), 'ARM#3 T1 (sector 6): orbiters mix in, no lancers yet');
    ok(has(t2, 'orbiter') && has(t2, 'lancer'), 'ARM#3 T2 (sector 10): both archetypes fly');
    var chasers2 = t2.filter(function (x) { return x === null; }).length;
    ok(chasers2 >= 60, 'ARM#3 T2: chasers still form the base of the mix (' + chasers2 + '/200)');
    // ORBITER: settles into the ~240px standoff band instead of ramming
    T.setupBossSector(3);
    for (var bi = 0; bi < 80; bi++) { T.refillShields(); T.step(1 / 60); }   // burn spawn invuln
    T.spawnTyped('orbiter', 640, 60);
    for (var os = 0; os < 60 * 8; os++) { T.refillShields(); T.step(1 / 60); }
    var oInfo = T.enemyInfo().filter(function (e) { return e.type === 'orbiter'; })[0];
    ok(!!oInfo && oInfo.d > 140 && oInfo.d < 400, 'ARM#3 ORBITER: holds the standoff band after 8s (d=' + (oInfo ? Math.round(oInfo.d) : '?') + '), never rams');
    ok(/e\.shootCD = rnd\(1\.0, 1\.8\);/.test(H.ARM_SRC), 'ARM#3 ORBITER: quicker trigger source-pinned (1.0-1.8s vs 1.6-2.8)');
    // LANCER: 0.6s DEAD-STOP telegraph, then a dash on the locked line
    T.setupBossSector(3);
    for (var bj = 0; bj < 80; bj++) { T.refillShields(); T.step(1 / 60); }
    T.shipTo(640, 520);
    T.spawnTyped('lancer', 760, 520);
    var sawTele = false, teleFrozen = true, sawDash = false, dashStep = 0, px = 0, py = 0, prevState = 0;
    for (var ls = 0; ls < 60 * 10; ls++) {
      T.refillShields(); T.step(1 / 60);
      var li = T.enemyInfo().filter(function (e) { return e.type === 'lancer'; })[0];
      if (!li) break;   // rammed the ship and popped — fine, the phases were observed
      if (li.lstate === 1) {
        if (sawTele && prevState === 1 && (Math.abs(li.x - px) > 0.01 || Math.abs(li.y - py) > 0.01)) teleFrozen = false;
        sawTele = true;
      }
      if (li.lstate === 2) {
        if (sawDash && prevState === 2) dashStep = Math.max(dashStep, Math.abs(li.x - px) + Math.abs(li.y - py));
        sawDash = true;
      }
      prevState = li.lstate; px = li.x; py = li.y;
    }
    ok(sawTele && teleFrozen, 'ARM#3 LANCER: telegraphs with a DEAD STOP (position frozen through the 0.6s)');
    ok(sawDash && dashStep > 4, 'ARM#3 LANCER: then dashes the locked line (' + dashStep.toFixed(1) + 'px/frame ~ 340px/s)');
    var lz = H.ARM_SRC.indexOf("e.type === 'lancer'");
    ok(lz > 0 && H.ARM_SRC.slice(lz, lz + 1400).indexOf('spawnEBullet') < 0, 'ARM#3 LANCER: NO gun — its update branch never spawns a bullet');
    // RAM: the lancer hull costs 26, a chaser stays 18
    T.setupBossSector(3);
    for (var bk = 0; bk < 90; bk++) { T.refillShields(); T.step(1 / 60); }
    T.shipTo(640, 520); T.refillShields();
    var shL0 = T.puzzleInfo().shields;
    T.spawnTyped('lancer', 640, 520);
    T.step(1 / 60);
    ok(shL0 - T.puzzleInfo().shields === 26, 'ARM#3 RAM: a lancer hull hit costs 26 (' + shL0 + ' -> ' + T.puzzleInfo().shields + ')');
    for (var iv = 0; iv < 70; iv++) T.step(1 / 60);   // burn the post-hit invuln
    T.shipTo(640, 520); T.refillShields();
    var shC0 = T.puzzleInfo().shields;
    T.spawnTyped(null, 640, 520);
    T.step(1 / 60);
    ok(shC0 - T.puzzleInfo().shields === 18, 'ARM#3 RAM control: a chaser ram stays 18');
  })();
  // (v0.161.0, V1.1 ARM#5) death costs ONE random owned level (priced), not your two best
  (function () {
    var sum = function (o) { return o.engine + o.maneuver + o.capacitor + o.shieldCell + o.rapid; };
    T.setLvl({ engine: 3, maneuver: 2, capacitor: 0, shieldCell: 0, rapid: 0 });
    var before = T.getLvl(), pen = T.applyDeathPenalty(), after = T.getLvl();
    ok(!!pen && sum(after) === sum(before) - 1 && before[pen.key] - after[pen.key] === 1 && (pen.key === 'engine' || pen.key === 'maneuver'),
       'ARM#5: death strips exactly ONE level, drawn among OWNED upgrades (' + pen.key + ')');
    var baseC = { engine: 120, maneuver: 110, capacitor: 130, shieldCell: 130, rapid: 140 };
    ok(pen.cost === baseC[pen.key] + after[pen.key] * 60, 'ARM#5: the panel price = the real rebuy cost (' + pen.cost + 'c)');
    // distribution: a 5/1 spread must NOT always bleed the tall pillar (the old flattener)
    var tall = 0, small = 0;
    for (var dp = 0; dp < 60; dp++) {
      T.setLvl({ engine: 5, maneuver: 0, capacitor: 0, shieldCell: 0, rapid: 1 });
      var p2 = T.applyDeathPenalty();
      if (p2.key === 'engine') tall++; else if (p2.key === 'rapid') small++;
    }
    ok(tall > 0 && small > 0, 'ARM#5: the draw is uniform-among-owned, not best-first (engine ' + tall + ' / rapid ' + small + ' over 60)');
    T.setLvl({ engine: 0, maneuver: 0, capacitor: 0, shieldCell: 0, rapid: 0 });
    ok(T.applyDeathPenalty() === null, 'ARM#5: a bare ship loses nothing (no crash, no negative levels)');
    // income ramp sources
    ok(/coins \+= 3 \+ tierOf\(sector\); hud\(\)/.test(H.ARM_SRC) && /var dPay = 25 \+ sector \* 2;/.test(H.ARM_SRC),
       'ARM#5: kill bounty ramps by tier (3/4/5) and depot install pay ramps by sector (27c -> 49c)');
  })();
  // (v0.176.0, V1.1 ARM#6) two spec-02 s3D puzzles: DECRYPT (mastermind) + TRACE (node maze)
  (function () {
    var seen0 = {}, seen1 = {}, seen2 = {}, hardFirstOk = true;
    var HARD = { decrypt: 1, trace: 1, rewire: 1, vcpu: 1 };
    for (var rr = 0; rr < 30; rr++) {
      T.puzzleRoster(0).forEach(function (t) { seen0[t] = 1; });
      T.puzzleRoster(1).forEach(function (t) { seen1[t] = 1; });
      var r2 = T.puzzleRoster(2);
      r2.forEach(function (t) { seen2[t] = 1; });
      for (var h4 = 0; h4 < 4; h4++) if (!HARD[r2[h4]]) hardFirstOk = false;
    }
    ok(!seen0.trace && !seen0.decrypt, 'ARM#6 roster T0: the classic six only (onboarding untouched)');
    ok(seen1.trace === 1 && !seen1.decrypt, 'ARM#6 roster T1: TRACE joins, DECRYPT waits');
    ok(seen2.trace === 1 && seen2.decrypt === 1 && hardFirstOk, 'ARM#6 roster T2: both live AND the hard half deals first');
    ok(T.puzzleSecs('decrypt', 0, false) === 32 && T.puzzleSecs('trace', 0, false) === 24
       && T.puzzleSecs('decrypt', 0, true) === 48, 'ARM#6 timers: decrypt 32s / trace 24s, extra-time x1.5');
    // land in a REGULAR sector so cores exist (boss arenas hold their cores in the queue)
    T.setupBossSector(3); T.nextSector(); T.skipBriefing(); T.flushWarp();
    ok(T.state() === 'SECTOR' && T.sectorNum() === 4, 'ARM#6 probe: regular sector 4 reached');
    // DECRYPT
    var ty = T.openPuzzleAt(0, 'decrypt');
    ok(ty === 'decrypt' && T.state() === 'PUZZLE', 'ARM#6 DECRYPT mounts');
    var pd = T.puzzleProbe();
    ok(pd.len === 4 && pd.alphabet === 5 && pd.tries === 0 && !pd.solved, 'ARM#6 DECRYPT shape: 4 slots x 5 glyphs, unsolved');
    var sec = pd.secret.slice();
    var swapped = sec.slice(); var tw = swapped[0]; swapped[0] = swapped[1]; swapped[1] = tw;
    var g1 = T.puzzleTryGuess(swapped);
    var expEx = (sec[0] === sec[1]) ? 4 : 2, expNear = (sec[0] === sec[1]) ? 0 : 2;
    ok(g1.exact === expEx && g1.near === expNear, 'ARM#6 DECRYPT grading: a two-slot swap reads ' + expEx + ' locked + ' + expNear + ' misplaced');
    if (expEx !== 4) {
      var g2 = T.puzzleTryGuess(sec);
      ok(g2.exact === 4 && T.puzzleProbe().solved === true, 'ARM#6 DECRYPT: the true cipher cracks it');
    } else { ok(true, 'ARM#6 DECRYPT: the swap equalled the secret (double glyph) — solve already covered'); }
    T.flushLater();
    ok(T.state() !== 'PUZZLE', 'ARM#6 DECRYPT solve hands back to the core flow');
    // the solve opened the core question — clear it so TRACE can mount cleanly
    if (T.state() === 'CORE_Q' || T.hasQuestion()) { T.answer(true); }
    // TRACE: solvable by construction across 20 regenerations
    var allOk = true;
    for (var tr = 0; tr < 20; tr++) {
      var ty2 = T.openPuzzleAt(1 + (tr % 3), 'trace');
      if (ty2 !== 'trace') { allOk = false; break; }
      var pt = T.puzzleProbe();
      if (!(pt.pathOk === true && pt.conduits >= pt.pathLen - 1 && !pt.solved)) allOk = false;
      T.puzzleTapSolve();
      if (!T.puzzleProbe().solved) allOk = false;
      T.flushLater();
      if (T.hasQuestion()) T.answer(true);
    }
    ok(allOk, 'ARM#6 TRACE: 20 regenerated mazes all self-validate solvable and tapSolve reaches OUT');
  })();
  // (v0.155.0, V1.1 ARM#4) the tier cliffs are smoothed — and the 02 s3D shape toggle exists
  (function () {
    var dmg = []; for (var ds = 1; ds <= 12; ds++) dmg.push(T.shotDmg(ds));
    var mono = true, maxStep = 0;
    for (var dm = 1; dm < dmg.length; dm++) { if (dmg[dm] < dmg[dm - 1]) mono = false; maxStep = Math.max(maxStep, dmg[dm] - dmg[dm - 1]); }
    ok(dmg[0] === 10 && dmg[11] === 18 && mono && maxStep <= 1,
       'ARM#4: shot damage LERPS 10 -> 18 with max +1/sector (was +4 at the tier walls): ' + dmg.join(','));
    var m4 = T.hpMix(300, 4), m5 = T.hpMix(300, 5), m6 = T.hpMix(300, 6), m7 = T.hpMix(300, 7), m9 = T.hpMix(300, 9);
    ok(!m4[2] && (m4[1] === 300), 'ARM#4: sector 4 spawns pure tier-0 HP (onboarding tail untouched)');
    var f5 = (m5[2] || 0) / 300;
    ok(f5 > 0.25 && f5 < 0.55 && (m5[1] || 0) > 0, 'ARM#4: sector 5 MIXES ~40% 2-HP into the population (' + Math.round(f5 * 100) + '%)');
    var f6 = (m6[2] || 0) / 300;
    ok(f6 > 0.55 && f6 < 0.85 && (m6[1] || 0) > 0, 'ARM#4: sector 6 deepens to ~70% (' + Math.round(f6 * 100) + '%)');
    ok((m7[2] || 0) === 300, 'ARM#4: sector 7 is fully tier-1 HP');
    ok((m9[3] || 0) > 0 && (m9[2] || 0) > 0 && !m9[1], 'ARM#4: sector 9 mixes 2-HP and 3-HP (the second cliff smoothed too)');
    T.setSmoothDiff(false);
    ok(T.shotDmg(4) === 10 && T.shotDmg(5) === 14 && T.hpMix(80, 5)[2] === 80,
       'ARM#4: the 02 s3D shape toggle OFF restores the classic hard steps');
    T.setSmoothDiff(true);
    ok(/toggleRow\("Smooth difficulty", smoothDiff/.test(H.ARM_SRC), 'ARM#4: the toggle is a real Settings row, persisted as armSmoothDiff');
  })();
  // (v0.96.0, A6) economy + cadence sources
  ok(/sec % 3 === 0/.test(H.ARM_SRC) && /MAX_TIER = 8/.test(H.ARM_SRC)
     && /baseCost = \{ engine: 120, maneuver: 110, capacitor: 130, shieldCell: 130, rapid: 140 \}/.test(H.ARM_SRC)
     && /lvl\[k\] \* 60/.test(H.ARM_SRC),
     'A6: bosses every 3rd sector; 8 tiers; sector-income-scaled prices (base 110-140, slope 60)');
  ok(/Math\.pow\(1\.06, lvl\.engine\)/.test(H.ARM_SRC) && /Math\.pow\(1\.05, lvl\.maneuver\)/.test(H.ARM_SRC)
     && /Math\.pow\(0\.93, lvl\.rapid\)/.test(H.ARM_SRC) && /maxCharges = 1 \+ lvl\.capacitor/.test(H.ARM_SRC),
     'A6: per-tier effects halved (same 8-tier endpoint), capacitor exempt at +1/tier');
  // (v0.95.0, A4/A5) briefing rework sources
  ok(/BCM DREADNOUGHT parked on our lane/.test(H.ARM_SRC) && /bossQueue\.length \+ " station cores/.test(H.ARM_SRC)
     && /pour fire into the ACTIVE port/.test(H.ARM_SRC),
     'A4: pre-boss brief names the Dreadnought, counts the cores, teaches the kill');
  ok(/close: "So the key here is " \+ key/.test(H.ARM_SRC) && /listen close\." , *body: why/.test(H.ARM_SRC.replace(/\s+/g, ' ')) === false
     && /body: why, close:/.test(H.ARM_SRC),
     'A5: teach line = explain first, answer as the closing line');
  // (v0.94.0, A2/A3) spread + aim assist + belt-cleared seam
  ok(/AIM_ASSIST = 0\.1;/.test(H.ARM_SRC) && /runRng\.next\(\) - 0\.5\) \* Math\.min\(0\.06, 0\.015 \* lvl\.rapid\)/.test(H.ARM_SRC)
     && /Math\.max\(-0\.05, Math\.min\(0\.05, dA \* AIM_ASSIST\)\)/.test(H.ARM_SRC),
     'A2: rapid-fire spread (runRng) + capped whisper aim assist');
  ok(/asteroids\.length === 0\) markBeltCleared\(\)/.test(H.ARM_SRC) && /p\.armBeltCleared = true/.test(H.ARM_SRC),
     'A3: belt-cleared flag fires when the last asteroid dies (non-boss)');
  // (v0.93.0, Batch #5 ARM unit 1) A1/A7/A8/A9 source truths
  ok(!/shopTab/.test(H.ARM_SRC) && !/Repair Shields/.test(H.ARM_SRC),
     'A1: Consumables are GONE from the hangar (no tab state, no repair item)');
  ok(/simonTier === 0 \? 5 : simonTier === 1 \? 6 : 8/.test(H.ARM_SRC),
     'A7: Simon caps pinned at easy 5 / medium 6 / hard 8');
  ok(/maxShields = 100;/.test(H.ARM_SRC) && /shieldRegenDelay = 4 \* Math\.pow\(0\.91, lvl\.shieldCell\)/.test(H.ARM_SRC)
     && !/ds: "\+25 max shields"/.test(H.ARM_SRC),
     'A8: Shield Cell buys RECHARGE (delay+rate), capacity fixed at 100');
  ok(/charges >= 1 \? 1 : \(1 - rechargeTimer \/ rechargeTime\)/.test(H.ARM_SRC),
     'A9: the Charge bar reads weapon-ready (full = can fire)');
  // (v0.91.0) variety: per-run forks vary replays; openers past sector 1 reach the d<=2 pool
  ok((H.ARM_SRC.match(/arm-run-" \+ sector \+ ":" \+ \(runSeq\+\+\)/g) || []).length === 3
     && /if \(s2 > 1\) d = Math\.max\(d, 2\)/.test(H.ARM_SRC),
     'VARIETY: both run forks salt runSeq (fresh questions on Fly again/replays) + opener band floor 2 past sector 1');
  ok(/arm-exhibit-warn/.test(H.ARM_SRC) && /q\.image\) panel\.appendChild/.test(H.ARM_SRC),
     'GUARD: a leaked exhibit question fails loudly in ARM');
  // (v0.88.0, L3) ARM wrong-answer feedback carries the pick's authored rationale
  ok(/if \(wrongPick >= 0 && q\.optionNotes\[wrongPick\]\)/.test(H.ARM_SRC) && /arm-pick-note/.test(H.ARM_SRC),
     "L3: ARM renders the wrong pick's optionNote under the explanation");
  // (v0.83.0, review) EXPLICIT rush execution — canvas-package-independent: drive drawBossRush
  // against a counting stub and assert one streak per star actually draws.
  (function () {
    var strokes = 0, fills = 0;
    var stub = { save: function () {}, restore: function () {}, beginPath: function () {},
      moveTo: function () {}, lineTo: function () {}, stroke: function () { strokes++; },
      fillRect: function () { fills++; } };
    T.bossRush(stub);
    ok(strokes === T.starCount() && strokes > 0,
       'drawBossRush draws exactly one streak per star on an injected ctx (' + strokes + ')');
  })();
  ok(/hull sway/.test(H.ARM_SRC) && /running lights sweep the hull/.test(H.ARM_SRC),
     'the dreadnought lives: sway + engine wash + running lights (all sin-clock, no rng, no shake)');
  // (v0.75.0) hyperdrive re-time (Jason: fluid, not slow motion): 1.0s countdown + 2.2s tunnel,
  // and the tunnel FLOWS (radial star rush constant in source — regression-guarded)
  ok(/return reducedMotion \? 1\.0 : 1\.0/.test(H.ARM_SRC) && /return reducedMotion \? 0\.7 : 2\.2/.test(H.ARM_SRC),
     'warp timing pinned: countdown 1.0s, tunnel 2.2s (total 3.2s, was 4.85s)');
  ok(/WARP_FLOW = 340/.test(H.ARM_SRC) && /r0 \+ wt \* WARP_FLOW \* depth/.test(H.ARM_SRC),
     'the tunnel MOVES: radial star flow with per-star parallax (no more anchored streaks)');
})();

/* ================= 6) PAUSE: gnow() freezes; resume re-opens the clock ================= */
(function pauseFreeze() {
  group('PAUSE: module pause() freezes gnow(); resume() reopens it');
  var T = root.__armTest;
  mod.pause();
  ok(T.isPaused() === true, 'module.pause() flips the paused flag');
  var t1 = T.gnow(); busyWait(50); var t2 = T.gnow();
  ok(Math.abs(t2 - t1) < 15, 'gnow() frozen across 50 ms of wall time while paused (Δ=' + Math.round(Math.abs(t2 - t1)) + 'ms)');
  mod.resume();
  ok(T.isPaused() === false, 'module.resume() clears the paused flag');
  var t3 = T.gnow(); busyWait(50); var t4 = T.gnow();
  ok(t4 - t3 >= 30, 'gnow() advances again after resume (Δ=' + Math.round(t4 - t3) + 'ms)');
})();

/* ================= 7) UNMOUNT cleanliness ================= */
(function unmountClean() {
  group('UNMOUNT: zero residue');
  var T = root.__armTest;
  mod.unmount();
  ok(root.childNodes.length === 0, 'unmount empties the mount root');
  ok(root.__armTest === undefined, 'unmount removes the __armTest seam');
  ok(!doc.querySelector('style[data-arm]'), 'unmount removes the injected <style data-arm>');
  ok(T.timerCount() === 0 && T.rafCancelled() === true, 'all timers cleared, no RAF handle survives');
})();

/* ================= 8) REDUCED MOTION + DETERMINISM (window 2) ================= */
(function reducedAndDeterminism() {
  group('REDUCED MOTION + DETERMINISM: fresh window, same seed');
  var V2 = newWindow(), ctx2 = H.makeCtx({ seed: SEED, reducedMotion: true });
  V2.mod.mount(V2.root, ctx2);
  var T2 = V2.root.__armTest;
  T2.step(4.7);                                      // reduced-motion intro auto-ends at 4.6 s
  ok(T2.state() === 'BRIEF', 'reduced-motion INTRO auto-ends by frame time alone (no click)');
  ok(JSON.stringify(T2.coresForSector(3)) === detSector3, 'same seed → identical seeded sector-3 core layout across mounts');
  ok(JSON.stringify(T2.coresForSector(3)) !== JSON.stringify(T2.coresForSector(4)), 'different sector forks → different layouts');
  T2.skipBriefing(); T2.flushWarp();
  T2.prepCore(1); T2.arrive(1);
  ok(T2.state() === 'QUESTION' && T2.timerStarted() === true,
     'reduced motion: no option stagger — the countdown starts immediately');
  V2.mod.unmount();
  ok(V2.root.childNodes.length === 0, 'window-2 unmount also leaves an empty root');
})();

/* ============ (v0.131.0, V1.1 ARM#1) LOST-CORE RESURFACING POOL ============ */
(function lostPool() {
  group('ARM#1: lost cores resurface next sector as recovered cores');
  var V3 = newWindow(), ctx3 = H.makeCtx({ seed: SEED + 31 });
  V3.mod.mount(V3.root, ctx3);
  var T3 = V3.root.__armTest;
  T3.endBriefingIntro();
  var g3 = 0; while (T3.state() === 'BRIEF' && g3++ < 12) { if (pickBrief(T3, /hyperdrive/i)) break; pickBrief(T3, /understand|go ahead/i); }
  T3.flushWarp(); T3.step(0.1);
  T3.prepCore(4); T3.arrive(4);                         // same core the main grading drive uses for wrong->lost
  var qLost = T3.cores()[4].qid;
  T3.answer(false);                                     // lose the core through the REAL grading path
  ok(T3.cores()[4].state === 'lost', 'setup: core 4 lost via a wrong answer');
  T3.nextSector();                                      // sector boundary commits + redraws
  var rIdx3 = T3.recoveredIdx(), qids3 = T3.coreQids();
  var reserved3 = rIdx3.map(function (i) { return qids3[i]; });
  ok(reserved3.indexOf(qLost) >= 0, 'the lost question resurfaces in sector 2 as a RECOVERED core');
  ok(T3.lostPoolIds().indexOf(qLost) < 0, 'consumption removes it from the pool (no double-serve)');
  V3.mod.unmount();
})();

/* ============ Flow#7 (v0.179.0): the Lieutenant perk = a free Shield Cell level ============ */
(function rankPerk() {
  group('Flow#7: ctx.perks.armShieldCell boots a fresh run at Shield Cell level 1');
  var V4 = newWindow(), ctx4 = H.makeCtx({ seed: SEED + 77 });
  ctx4.perks = { armShieldCell: 1 };
  V4.mod.mount(V4.root, ctx4);
  var T4 = V4.root.__armTest;
  T4.endBriefingIntro();
  ok(T4.upgradeLvl('shieldCell') === 1 && T4.upgradeLvl('engine') === 0 && T4.upgradeLvl('rapid') === 0,
     'fresh run boots with Shield Cell level 1 and ONLY that perk');
  ok(Math.abs(T4.regenDelay() - 4 * 0.91) < 1e-9,
     'the perk is real: shield regen delay derives at level 1 (3.64s, not the stock 4s)');
  V4.mod.unmount();
})();

H.summary('ARM RUN');
