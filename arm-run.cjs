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
  ok(T.state() === 'DEPOT_SUM' && T.station() === station0 + 1 && T.coins() === coins0 + 25,
     'right install → station +1, +25 coins, delivery summary');
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
  // (v0.108.0, G4 HIGH) the wall laser must produce a FINITE gap (bossArena has .l, not .x —
  // gapX was NaN and the wall mode was completely inert since v0.97)
  (function () {
    var st9 = T.setupBossSector();
    var found = false, guard9 = 0;
    while (!found && guard9++ < 400) {
      T.step(0.1);
      var bi9 = T.bossInfo();
      if (bi9 && bi9.laserMode === 'wall') found = true;
    }
    var gap9 = T.bossGapX ? T.bossGapX() : NaN;
    ok(found && isFinite(gap9) && gap9 > 0,
       'A10 wall laser arms with a FINITE safe-gap x (' + (found ? Math.round(gap9) : 'never armed') + ')');
  })();
  // (v0.97.0, A10) boss arsenal: seekers + dual lasers
  ok(/MISSILE_SPEED = 130, MISSILE_TURN = 1\.7, MISSILE_R = 10/.test(H.ARM_SRC)
     && /boss\.laserMode = runRng\.next\(\) < 0\.6 \? "beam" : "wall"/.test(H.ARM_SRC)
     && /Math\.abs\(ship\.x - boss\.gapX\) >= GAP_HALF/.test(H.ARM_SRC),
     'A10: seeking missiles (slower/larger/shootable) + wall laser with ONE safe column');
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

H.summary('ARM RUN');
