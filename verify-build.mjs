/* Headless verification of the assembled index.html (with real kbb.js).
 *
 * jsdom runs the INLINE scripts but not the external Three CDN, so window.THREE
 * stays undefined -> exercises CC's graceful "3D not loaded" fallback.
 * A mock 2D canvas context is provided (jsdom's getContext returns null), so the
 * 2D games (ARM, KBB) actually run their draw loops. The rAF polyfill catches
 * any error thrown inside a frame, so we can assert each game's animation loop
 * runs clean for several frames.
 */
import { JSDOM, VirtualConsole } from "jsdom";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");

let pass = 0, fail = 0; const fails = [];
function ok(name, cond) { if (cond) { pass++; console.log("  \u2713 " + name); }
  else { fail++; fails.push(name); console.log("  \u2717 " + name + "  <-- FAIL"); } }

const vc = new VirtualConsole();
vc.on("jsdomError", () => { /* swallow expected WebGL/AudioContext noise */ });

const dom = new JSDOM(html, {
  runScripts: "dangerously",
  pretendToBeVisual: true,
  virtualConsole: vc,
  url: "https://x.test/"
});
const w = dom.window;

// mock 2D canvas context (jsdom returns null) so 2D draw loops execute
w.HTMLCanvasElement.prototype.getContext = function (type) {
  if (type !== "2d") return null;            // webgl -> null => CC falls back
  const canvas = this;
  return new Proxy({}, {
    get(_t, k) {
      if (k === "canvas") return canvas;
      if (k === "measureText") return (s) => ({ width: (s ? String(s).length : 0) * 6 });
      if (k === "createLinearGradient" || k === "createRadialGradient" || k === "createPattern")
        return () => ({ addColorStop() {} });
      if (k === "getImageData") return (_x, _y, wd, ht) => ({ data: new Uint8ClampedArray(Math.max(0, (wd | 0) * (ht | 0) * 4)) });
      const v = _t[k];
      if (v !== undefined) return v;
      return () => {};
    },
    set(_t, k, v) { _t[k] = v; return true; }
  });
};

// rAF/cAF polyfill that records per-frame errors
let rafId = 0; const cancelled = new Set(); const frameErrors = [];
w.requestAnimationFrame = (fn) => {
  const id = ++rafId;
  w.setTimeout(() => {
    if (cancelled.has(id)) return;
    try { fn(w.performance.now()); } catch (e) { frameErrors.push(e); }
  }, 0);
  return id;
};
w.cancelAnimationFrame = (id) => cancelled.add(id);

function wait(ms) { return new Promise((r) => w.setTimeout(r, ms)); }
async function until(cond, ms = 2000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (cond()) return true; await wait(10); }
  return false;
}
async function runFrames(n = 6) {
  const before = frameErrors.length;
  for (let i = 0; i < n; i++) await wait(8);
  return frameErrors.slice(before);
}

(async function run() {
  console.log("StarNix index.html (with real KBB) — headless integration check\n");

  const SN = w.StarNix;
  console.log("A. Modules loaded + games registered");
  ok("window.StarNix present", !!SN);
  ok("ARM registered", !!(SN && SN.getGame && SN.getGame("ARM")));
  ok("CC registered", !!(SN && SN.getGame && SN.getGame("CC")));
  ok("KBB registered", !!(SN && SN.getGame && SN.getGame("KBB")));

  const booted = await until(() => SN.shell && SN.shell.screen === "title");
  ok("boot reached title screen", booted);
  // Pin the clock: provider.next() falls back to makeRng(clock.now()) when a caller passes no rng
  // (e.g. KBB), so without this the drawn question varies run-to-run and draw-dependent tests flake.
  if (SN.core && SN.core.clock) SN.core.clock.now = function () { return 1700000000000; };
  ok("build-version badge present at title", !!w.document.querySelector(".sx-build-badge"));
  ok("title screen has the nebula background wired to nebulaBg", (function () { const p = w.document.querySelector(".sx-title-photo"); return !!p && p.classList.contains("on") && /data:image\/(jpeg|png)/.test(p.style.backgroundImage || ""); })());
  ok("badge text shows the build version", (function () { const b = w.document.querySelector(".sx-build-badge"); return !!b && !!SN.BUILD && b.textContent.indexOf(SN.BUILD) !== -1; })());

  console.log("\nB. Audio engine installed (audio.js, not NoopAudio)");
  ok("core.audio present", !!(SN.core && SN.core.audio));
  ok("core.audio is the real engine (isReady present)", typeof SN.core.audio.isReady === "function");
  ok("playTrack present", typeof SN.core.audio.playTrack === "function");

  const calls = [];
  const realAudio = SN.core.audio;
  SN.core.audio = {
    ensure() {}, setMusic(on) { calls.push("music:" + on); }, setSfx() {},
    sfx(n) { calls.push("sfx:" + n); },
    playTrack(id, opts) { calls.push("track:" + id); this._last = { id: id, exact: !!(opts && opts.exact) }; },
    isReady() { return true; }, state() { return { trackId: this._last ? this._last.id : null }; },
    trackIds() { return realAudio.trackIds ? realAudio.trackIds() : []; }   // JB1: delegate to the real library
  };

  console.log("\nB2. Cold-open cinematic (P2 — all beats render, exits to menu)");
  {
    const realNow = w.performance.now.bind(w.performance);
    let nowMs = realNow();
    w.performance.now = () => { nowMs += 50; return nowMs; };   // fast-forward the cinematic clock
    calls.length = 0;
    const beforeErr = frameErrors.length;
    SN.shell.showCinematic();
    ok("screen === cinematic", SN.shell.screen === "cinematic");
    ok("cinematic canvas mounted", !!w.document.querySelector(".sx-cine-canvas"));
    ok("mission panel present, starts hidden", (function () { const m = w.document.querySelector(".sx-mission"); return !!m && m.style.opacity === "0"; })());
    let guard = 0;
    while (SN.shell.screen === "cinematic" && guard < 60) { await runFrames(20); guard++; }   // drive through every beat
    w.performance.now = realNow;
    ok("ran every beat without a frame error", frameErrors.length === beforeErr);
    ok("auto-advanced to menu at end", SN.shell.screen === "menu");
    ok("menu track played on cinematic end", calls.indexOf("track:menu") !== -1);
    ok("no cinematic residue (canvas gone)", !w.document.querySelector(".sx-cine-canvas"));
  }

  console.log("\nC. Menu");
  const shell = SN.shell;
  shell.showMenu();
  ok("screen === menu", shell.screen === "menu");
  ok("four game cards rendered (ARM/KBB/CC + NIT exam tile)", w.document.querySelectorAll(".sx-card").length === 4);
  ok("no card disabled (all four live)", w.document.querySelectorAll(".sx-card-disabled").length === 0);
  {
    const bg = w.document.querySelector(".sx-menu-bg");
    ok("menu has the tiled wireframe-X background", !!bg && /data:image\/svg/.test(bg.style.backgroundImage || ""));
    const photo = w.document.querySelector(".sx-menu-photo");
    ok("menu has a moving photo background wired to menuBg", !!photo && photo.classList.contains("on") && /menuBg|data:image\/(jpeg|png)/.test(photo.style.backgroundImage || ""));
    ok("menu shows the NX-SRC crew crest", !!w.document.querySelector(".sx-crest .sx-crest-x"));
  }
  {
    // NIT — the Practice Exam is now a first-class tile (not a footer button)
    const cards = Array.prototype.slice.call(w.document.querySelectorAll(".sx-card"));
    const nit = cards.filter(c => /Nutanix Interrogation Test/.test(c.textContent))[0];
    ok("NIT exam tile present, enabled, gold accent", !!nit && !nit.classList.contains("sx-card-disabled") && nit.classList.contains("sx-acc-gold"));
    ok("Practice Exam footer button removed (it's a tile now)", !w.document.querySelector(".sx-btn-exam"));
    if (nit) { nit.click(); ok("clicking the NIT tile opens the exam setup screen", shell.screen === "exam-setup"); }
  }

  console.log("\nD. ARM");
  calls.length = 0;
  shell.enterGame("ARM");
  ok("screen === game:ARM", shell.screen === "game:ARM");
  ok("build-version badge persists into a game (on root, not stage)", !!w.document.querySelector(".sx-build-badge"));
  ok("ARM track played on enter", calls.indexOf("track:arm") !== -1);
  await wait(10);
  ok("ARM built DOM in game root", shell.currentGameRoot && shell.currentGameRoot.childNodes.length > 0);
  // P6a: intro cutscene plays first, is skippable, hands off to the briefing
  {
    const aT = shell.currentGameRoot.__armTest;
    ok("ARM starts in the intro cutscene", !!aT && aT.state() === "INTRO");
    const skip = w.document.querySelector(".arm-introskip");
    ok("ARM intro shows a Skip button", !!skip);
    { const e = await runFrames(3); ok("ARM intro loop runs without error", e.length === 0); }
    if (skip) skip.dispatchEvent(new w.Event("click", { bubbles: true }));
    ok("skipping the intro reaches the briefing", aT && aT.state() === "BRIEF");
    ok("intro overlay hidden after skip", (function () { const b = w.document.querySelector(".arm-introbar"); return !b || b.style.display === "none"; })());
  }
  { const e = await runFrames(); ok("ARM draw loop runs without error", e.length === 0); }
  const armRoot = shell.currentGameRoot;
  shell.exitGame();
  ok("ARM unmounted -> menu", shell.screen === "menu");
  ok("ARM game root detached", !armRoot.parentNode);

  console.log("\nD2. ARM charge/recharge model (P1 — no softlock)");
  shell.enterGame("ARM");
  await wait(10);
  const armT = shell.currentGameRoot.__armTest;
  ok("ARM exposes test seam", !!armT);
  if (armT) {
    // ---- Core positions randomized per sector (seeded, spaced, in-bounds) ----
    {
      const MAPW = 3200, MAPH = 2200, M = 380, MINSP = 700;
      const inb = (p) => p.x >= M && p.x <= MAPW - M && p.y >= M && p.y <= MAPH - M;
      const spaced = (a) => { for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) { const dx = a[i].x - a[j].x, dy = a[i].y - a[j].y; if (dx * dx + dy * dy < MINSP * MINSP) return false; } return true; };
      const s1 = armT.coresForSector(1), s2 = armT.coresForSector(2);
      ok("ARM cores: 5 positions, all in-bounds", s1.length === 5 && s1.every(inb));
      ok("ARM cores: spaced so combat rings don't overlap", spaced(s1) && spaced(s2));
      ok("ARM cores: randomized per sector (sector 1 != sector 2)", JSON.stringify(s1) !== JSON.stringify(s2));
      ok("ARM cores: deterministic for a given seed", JSON.stringify(s1) === JSON.stringify(armT.coresForSector(1)));
      const live = armT.cores();
      const FIXED = [[540, 560], [2680, 480], [1640, 1180], [560, 1760], [2660, 1780]];
      const isFixed = live.length === 5 && live.every((c, i) => c.x === FIXED[i][0] && c.y === FIXED[i][1]);
      ok("ARM live cores use the randomized layout, not the fixed LAYOUT", live.length === 5 && !isFixed);
    }
    // ---- Commander briefing dialogue tree ----
    armT.endBriefingIntro();             // INTRO -> BRIEF (renders the commander dialogue)
    ok("briefing opens on the commander intro", armT.state() === "BRIEF" && armT.briefInfo().core === -1);
    {
      const fx = armT.commsFx();
      ok("comms window has the scanline + signal transmission frame", fx.scanline && fx.signal && fx.portraitFx);
      ok("transmission animates when motion is allowed (gated on reducedMotion)", fx.animated === true);
    }
    armT.briefPick(0);                   // "Go ahead, sir" -> first core, teach step
    {
      const o = armT.briefOptions();
      ok("teach step offers understand / repeat / explain further", o.includes("I understand") && o.includes("Repeat") && o.includes("Explain further"));
      ok("commander briefing teaches the answer (info to learn, not a quiz)", armT.briefText().indexOf(armT.briefCoreAnswer()) >= 0);
      armT.briefPick(1); armT.briefPick(1); armT.briefPick(1);   // ask to repeat 3x
      ok("repeating 3x on a core makes the commander terse (easter egg)", armT.briefInfo().frustrated === true);
      armT.briefPick(2);                 // "Explain further" -> ELI5
      const o2 = armT.briefOptions();
      ok("explain-further switches to the deeper breakdown", armT.briefInfo().mode === "ELI5" && o2.includes("Yes, sir") && o2.includes("Please repeat, sir"));
      armT.briefPick(0);                 // "Yes, sir" -> next core
      ok("acknowledging advances to the next core", armT.briefInfo().core === 1);
    }
    armT.skipBriefing();                 // BRIEF -> WARP
    {
      const wi = armT.warpInfo();
      ok("hyperdrive warp is longer (>= 2.5s with the countdown)", wi.total >= 2.5);
      ok("warp opens on the 3-2-1 countdown phase", wi.phase === "countdown" && wi.number === 3);
      calls.length = 0;                    // isolate warp-sequence audio
      armT.step(wi.cd / 3 + 0.02);        // into the second beat
      ok("countdown ticks down (3 -> 2)", armT.warpInfo().number === 2);
      armT.step(wi.cd);                    // past the countdown, into the streaks
      ok("after the countdown the warp enters the streak tunnel", armT.warpInfo().phase === "streak");
      ok("warp countdown plays a rising charge (not a flat click)", calls.indexOf("sfx:count2") !== -1 && calls.indexOf("sfx:click") === -1);
      ok("the jump fires the hyperdrive whoosh", calls.indexOf("sfx:hyperdrive") !== -1);
    }
    armT.flushWarp();                    // WARP -> SECTOR
    ok("ARM reached SECTOR", armT.state() === "SECTOR");
    const s1qids = armT.coreQids();      // sector 1's questions (for the cross-sector no-reuse check)
    ok("starts with a full charge", armT.charges() === armT.maxCharges() && armT.charges() >= 1);
    const fired1 = armT.fire();
    ok("first shot fires (charge consumed)", fired1 === true && armT.charges() === 0);
    const fired2 = armT.fire();          // immediately, no charge ready
    ok("cannot fire at 0 charges", fired2 === false && armT.charges() === 0);
    for (let i = 0; i < 40; i++) armT.step(1 / 60);   // ~0.67s > 0.45 recharge
    ok("charge recharges over time", armT.charges() >= 1);
    ok("can fire again after recharge", armT.fire() === true);
    let everStuck = false;               // drain->recharge cycles never softlock
    for (let cycle = 0; cycle < 5 && !everStuck; cycle++) {
      while (armT.charges() > 0) armT.fire();
      let restored = false;
      for (let i = 0; i < 80 && !restored; i++) { armT.step(1 / 60); if (armT.charges() > 0) restored = true; }
      if (!restored) everStuck = true;
    }
    ok("never softlocks (always recharges to fireable)", everStuck === false);

    // post-collect invulnerability (collect beat) + D6 per-question timer.
    const coreList = armT.cores();
    const combat = coreList.filter(c => c.kind === "combat").map(c => c.idx);
    ok("found a combat core to clear", combat.length >= 1);
    if (combat.length >= 1) {
      const ci = combat[0];

      // Combat cores engage from a large danger ring; extract is contact. Verify both.
      const c0 = armT.cores().find(c => c.idx === ci);
      const ring = armT.combatRing();
      ok("combat danger ring is large (>= 250px reach)", ring >= 250);
      ok("core's fight not yet engaged", !c0.gate);
      armT.shipTo(c0.x + c0.r + ring + 140, c0.y);   // outside the ring
      armT.step(1 / 60);
      ok("ring does NOT engage from outside it", !armT.cores().find(c => c.idx === ci).gate);
      armT.shipTo(c0.x + c0.r + ring - 60, c0.y);     // inside the ring, far from contact
      armT.step(1 / 60);
      ok("entering the danger ring engages the fight from far (not on contact)", !!armT.cores().find(c => c.idx === ci).gate);

      armT.prepCore(ci);                 // clear guardians/asteroid -> core unlocks
      const u = armT.cores().find(c => c.idx === ci);
      armT.shipTo(u.x + u.r + 90, u.y);  // 90px out: well beyond contact, but inside the old ring
      armT.step(1 / 60);
      ok("extracting a cleared core is contact — ring distance does not auto-open it", !armT.hasQuestion());
      armT.arrive(ci);                   // fly onto the cleared core -> opens its question
      ok("flying onto the cleared core opens its question (world frozen)", armT.hasQuestion() && armT.state() === "QUESTION");
      ok("question has a per-question time limit (>=12s)", armT.questionLimit() >= 12);
      ok("timer waits for the option reveal — not started at question creation (R5)", armT.timerStarted() === false);
      armT.answer(true);
      ok("collecting a core returns to SECTOR", armT.state() === "SECTOR");
      ok("post-collect invulnerability granted (invuln >= 1.4s)", armT.invuln() >= 1.4);
    }
    if (combat.length >= 2) {            // second core: let its timer run out -> graded incorrect (core lost)
      const ci2 = combat[1];
      armT.prepCore(ci2); armT.arrive(ci2);
      ok("second core opens its question", armT.hasQuestion() && armT.state() === "QUESTION");
      ok("running out of time resolves the question", armT.forceTimeout() === true);
      armT.answer(true);                 // proceed past the now-answered (timed-out) question
      const lost = armT.cores().some(c => c.idx === ci2 && c.state === "lost");
      ok("a timed-out core is graded incorrect (lost)", lost);
    }
    { const e = await runFrames(); ok("ARM SECTOR loop runs without error", e.length === 0); }
    // ---- multi-sector campaign (escalating difficulty, no-reuse across the whole run) ----
    ok("campaign spans multiple sectors", armT.sectorsTotal() >= 2);
    ok("station total = sectors x cores-per-sector", armT.total() === armT.sectorsTotal() * 5);
    ok("station is 12 sectors / 60 cores (3 tiers x 20)", armT.sectorsTotal() === 12 && armT.total() === 60);
    ok("tiers: 1-4 Easy, 5-8 Medium, 9-12 Hard", armT.tierOf(1) === 0 && armT.tierOf(4) === 0 && armT.tierOf(5) === 1 && armT.tierOf(8) === 1 && armT.tierOf(9) === 2 && armT.tierOf(12) === 2);
    ok("boss sectors are 4/8/12 (Increment-2 hook)", armT.isBossSector(4) && armT.isBossSector(8) && armT.isBossSector(12) && !armT.isBossSector(1) && !armT.isBossSector(5) && !armT.isBossSector(9));
    ok("starts in sector 1", armT.sectorNum() === 1);
    const s1ceil0 = armT.bandCeil(0);
    armT.nextSector();                   // advance to sector 2 (re-briefs)
    ok("advancing increments the sector", armT.sectorNum() === 2);
    ok("each new sector re-briefs the commander", armT.state() === "BRIEF" && armT.briefInfo().core === -1);
    const s2qids = armT.coreQids();
    ok("sector 2 draws fresh questions (no-reuse across sectors)", s2qids.length === 5 && s2qids.every(id => !s1qids.includes(id)));
    ok("difficulty ceiling never drops sector-to-sector", armT.bandCeil(0) >= s1ceil0);
    ok("difficulty ceiling rises across tiers (Hard > Medium > Easy)", armT.bandCeilAt(9, 0) > armT.bandCeilAt(5, 0) && armT.bandCeilAt(5, 0) > armT.bandCeilAt(1, 0));

    // ---- Puzzle completion timer + breach penalty + the two new puzzle types ----
    const puzzles = armT.cores().filter(c => c.kind === "puzzle");
    ok("a sector has puzzle cores", puzzles.length >= 3);
    if (puzzles.length >= 3) {
      // S3: puzzle timers are now a per-mechanic budget (PUZZLE_SECS, floor 10s), not the old x1.5 question formula.
      armT.openPuzzleAt(puzzles[0].idx, "rewire");   // deterministic non-Simon type (Simon's clock starts after playback)
      const pi = armT.puzzleInfo();
      ok("opening a puzzle starts a completion timer", armT.state() === "PUZZLE" && pi.active && pi.barShown);
      ok("puzzle time-limit is a sane per-mechanic budget (>=10s floor, much quicker)", typeof pi.limit === "number" && pi.limit >= 10 && pi.limit <= 30);
      const sBefore = pi.shields;
      armT.step(pi.limit + 0.5);          // run the stability clock out
      const pe = armT.puzzleInfo();
      ok("timing out breaches the core (shield hit, " + 14 + ")", pe.shields === sBefore - 14);
      ok("a breach re-arms a fresh attempt (no softlock)", pe.active && pe.remain === pi.limit);
      // S3 roster: Grid CUT; Battery (polarity) + vCPU (even allocation) ADDED.
      armT.openPuzzleAt(puzzles[1].idx, "battery");
      ok("battery polarity puzzle renders (replaces cut Grid)", armT.puzzleInfo().type === "battery" && !!w.document.querySelector(".arm-batt-cell"));
      armT.openPuzzleAt(puzzles[2].idx, "vcpu");
      ok("vCPU divide puzzle renders (new)", armT.puzzleInfo().type === "vcpu" && !!w.document.querySelector(".arm-vcpu-read"));
      armT.solvePuzzle();
      ok("solving a puzzle advances to its question", armT.state() === "QUESTION");
    }

    // ---- Increment 2: boss encounter (weakpoint -> shed core -> catch -> answer, x5 -> death + auto-warp) ----
    {
      const bs = armT.setupBossSector();
      ok("boss sector arms the boss (5 cores queued, none placed)", armT.bossEnabled() && bs.queue === 5 && bs.cores === 0 && armT.bossInfo().active === true);
      ok("boss exposes 5 weakpoints, the first active, none destroyed", armT.bossInfo().wpCount === 5 && armT.bossInfo().wpActive === 0 && armT.bossInfo().wpDead === 0);
      const wp = armT.bossInfo().wpMax;
      armT.hitWeakpoint(wp);                                  // break the weakpoint
      ok("breaking the weakpoint sheds one core + seals the weakpoint", armT.bossInfo().cores === 1 && armT.bossInfo().queue === 4 && armT.bossInfo().active === false);
      armT.arrive(0); armT.answer(false);                    // a WRONG answer still counts (core lost) — design: caught OR lost both progress
      ok("a shed core answered wrong still re-exposes the weakpoint (lost counts)", armT.bossInfo().active === true && armT.bossInfo().wpHp === wp && armT.bossInfo().queue === 4);
      for (let r = 0; r < 4; r++) { armT.hitWeakpoint(armT.bossInfo().wpMax); armT.arrive(armT.bossInfo().cores - 1); armT.answer(true); }
      ok("all five cores shed + resolved -> boss destabilizing, all 5 weakpoints destroyed, active advanced to the last", armT.bossInfo().queue === 0 && armT.bossInfo().dying === true && armT.bossInfo().wpDead === 5 && armT.bossInfo().wpActive === 4);
      // S4 staged death: NO auto-warp — the alarm phases run, then hyperdrive is offered for the player to engage
      let availAt = -1;
      for (let f = 0; f < 200 && availAt < 0; f++) { armT.step(1 / 30); if (armT.returnReady()) availAt = f; }
      ok("boss death runs alarm phases then offers hyperdrive (no auto-warp, ship still in SECTOR)", availAt >= 0 && armT.state() === "SECTOR");
      armT.engageReturn();                                   // player presses Hyperdrive within the window
      ok("engaging hyperdrive during the death sequence warps out", armT.state() === "WARP");
    }
  }
  const armRoot2 = shell.currentGameRoot;
  shell.exitGame();
  ok("ARM(2) unmounted -> menu", shell.screen === "menu");

  console.log("\nD3. ARM high-contrast palette (#12 P2 — wiring; look is browser-only)");
  {
    const prev = SN.core.profile.settings.colorblind;
    SN.core.profile.settings.colorblind = true;
    shell.enterGame("ARM"); await wait(10);
    const pHc = shell.currentGameRoot.__armTest.palette();
    ok("ARM reads high-contrast from settings.colorblind", pHc.highContrast === true);
    ok("ARM canvas border uses the HC value", pHc.border === "#9aa0e0");
    ok("ARM canvas accent (aqua) brightens under HC", pHc.aqua === "#3DE7F2");
    { const e = await runFrames(); ok("ARM HC draw loop runs without error", e.length === 0); }
    shell.exitGame();
    SN.core.profile.settings.colorblind = false;
    shell.enterGame("ARM"); await wait(10);
    const pBase = shell.currentGameRoot.__armTest.palette();
    ok("ARM uses the base palette when HC off", pBase.highContrast === false && pBase.border === "#34344a");
    shell.exitGame();
    SN.core.profile.settings.colorblind = prev;
  }

  console.log("\nE. CC (Three absent -> graceful fallback)");
  calls.length = 0;
  shell.enterGame("CC");
  ok("screen === game:CC", shell.screen === "game:CC");
  ok("CC track played on enter", calls.indexOf("track:cc") !== -1);
  await wait(10);
  ok("CC mounted (root has content)", shell.currentGameRoot && shell.currentGameRoot.childNodes.length > 0);
  ok("CC shows 3D-unavailable fallback", /three\.js|3d/i.test(shell.currentGameRoot.textContent || ""));
  // #11: the descent cinematic plays first; skipping it fires the how-to card, which hands off to the run.
  const ccIntro = w.document.querySelector(".cc-intro");
  ok("CC intro cutscene shows on mount", !!ccIntro && ccIntro.style.display === "flex");
  ok("CC intro has a Skip control", !!w.document.querySelector(".cc-intro-skip"));
  { const sk = w.document.querySelector(".cc-intro-skip"); if (sk) sk.click(); }
  ok("CC intro dismissed after Skip", !!ccIntro && ccIntro.style.display === "none");
  const ccHowto = w.document.querySelector(".cc-howto");
  ok("CC how-to card shows after descent", !!ccHowto && !!ccHowto.parentNode);
  ok("CC how-to lists 4 rules", w.document.querySelectorAll(".cc-howto-li").length === 4);
  { const c = w.document.querySelector(".cc-howto-cont"); if (c) c.click(); }
  ok("CC how-to dismissed after Continue", !w.document.querySelector(".cc-howto"));
  { const e = await runFrames(); ok("CC loop runs without error (fallback path)", e.length === 0); }
  const ccRoot = shell.currentGameRoot;
  // Regression guard for the dead-hook class of bug: exit must travel the real path
  // (Menu button -> ctx.exit -> shell.exitGame). CC previously called a never-defined
  // ctx.onExit, so the button was a silent no-op; because the bad call sat behind an `if`,
  // nothing threw and the structural harness stayed green. Click the actual button here.
  // (v0.73.0) the Garage button now sits beside Menu (both ghost) — find Menu by TEXT, the pin's actual intent
  const ccMenuBtn = Array.from(ccRoot.querySelectorAll(".cc-ovr-btns .cc-btn")).find(b => /menu/i.test(b.textContent || ""));
  ok("CC exposes an in-game Menu (exit) button", !!ccMenuBtn);
  if (ccMenuBtn) ccMenuBtn.click();
  ok("CC Menu button returns to the shell menu (ctx.exit wired)", shell.screen === "menu");
  ok("CC game root detached", !ccRoot.parentNode);

  console.log("\nE2. CC gate question overlay (P1 — freeze regression)");
  shell.enterGame("CC");
  await wait(10);
  { const sk = w.document.querySelector(".cc-intro-skip"); if (sk) sk.click(); }  // #11: skip descent -> how-to
  { const c = w.document.querySelector(".cc-howto-cont"); if (c) c.click(); }     // dismiss how-to -> run (module now reacts to gameplay phases)
  const ccSim = SN.getGame("CC")._sim();
  ok("CC sim accessible", !!ccSim);
  if (ccSim) {
    // 04 task 7: score IS distance, accrued at SCORE_SPEED (dramatized), shown in km; gates every 10 km; coins gone.
    ccSim.reset();
    const cfg7 = ccSim.cfg;
    for (let f = 0; f < 60; f++) ccSim.step(1 / 60);     // ~1s of RUN (first gate is 20s out, so no interruption)
    ok("scored distance accrues at ~500 m/s", Math.abs(ccSim.scoreDistance - cfg7.SCORE_SPEED) < cfg7.SCORE_SPEED * 0.05);
    // (v0.73.0, J9) cells are BACK by Jason's direction — the pin's surviving truth is score PURITY:
    // km score is distance ONLY; collecting a cell feeds the wallet, never the score.
    ok("score() returns scored distance (cells never pollute it)", ccSim.score() === Math.floor(ccSim.scoreDistance));
    {
      const sc7 = ccSim.coinScore;
      const cell = ccSim.coins.acquire(); cell.lane = ccSim.player.lane; cell.x = ccSim.player.x; cell.y = 0.6; cell.z = 0.4; cell.tested = false; cell.collected = false;
      const km7 = ccSim.score();
      ccSim.step(1 / 60);
      ok("J9: a collected cell feeds the wallet, not the km score",
        ccSim.coinScore === sc7 + 10 && Math.abs(ccSim.score() - km7) < 20);
    }
    ok("gate threshold is a 10 km multiple", ccSim._nextGateScore % (cfg7.GATE_KM * 1000) === 0);
    // 04 task 8: every 5 gates -> boost (invuln + ~100 km fast-forward, then normal cadence resumes)
    ccSim.reset();
    ccSim._gatesPassed = cfg7.GATES_PER_BOOST - 1;
    ccSim._passGate(ccSim.gates.items[0]);               // the Nth gate -> flags a boost
    ok("every 5th gate flags a boost", ccSim._boostPending === true);
    ccSim.phase = "EXPLAIN"; ccSim.pending = null;       // jump to the resume point
    ccSim.resumeAfterQuestion();
    ok("boost activates on resume (invuln + fast-forward)", ccSim.boostActive === true && ccSim._boostTargetScore > ccSim.scoreDistance);
    const sd0 = ccSim.scoreDistance;
    for (let f = 0; f < 60 * 4 && ccSim.boostActive; f++) ccSim.step(1 / 60);
    ok("boost covers ~100 km then ends", !ccSim.boostActive && (ccSim.scoreDistance - sd0) >= cfg7.BOOST_KM * 1000 * 0.95);
    ccSim.reset();
    let collected = false;               // drive the real sim until a gate forces a question
    for (let i = 0; i < 5000 && !collected; i++) {
      ccSim.step(1 / 60);
      if (ccSim.phase === "QUESTION") collected = true;
      else if (ccSim.phase === "OVER") ccSim.reset();
    }
    if (!collected) {                    // deterministic fallback via the real gate method (spans the track, always triggers)
      ccSim.reset();
      ccSim._passGate(ccSim.gates.items[0]);
      collected = ccSim.phase === "QUESTION";
    }
    ok("gate forces a question -> phase QUESTION", collected);
    await runFrames(3);                  // let the module react to the QUESTION phase
    const ov = w.document.querySelector(".cc-overlay");
    ok("question overlay now shows (freeze fixed)", !!ov && ov.style.display === "flex");
    ok("overlay presents answer options", w.document.querySelectorAll(".cc-opt").length > 0);

    // P1 resume-before-ready fix: answering must NOT resume the world; it stays frozen through
    // the explanation until Continue, which grants a post-question invulnerability window.
    if (collected && ccSim.pending) {
      const pq = ccSim.pending.question;
      const ans = Array.isArray(pq.correctIndices) ? pq.correctIndices.slice() : pq.correctIndex;
      const d0 = ccSim.distance;
      ccSim.answer(ans);
      ok("answering moves to EXPLAIN (not RUN)", ccSim.phase === "EXPLAIN");
      for (let k = 0; k < 12; k++) ccSim.step(1 / 60);
      ok("world stays frozen during the explanation (distance unchanged)", ccSim.distance === d0);
      ccSim.resumeAfterQuestion();
      ok("Continue -> phase RUN", ccSim.phase === "RUN");
      ok("post-question invulnerability granted (iframe >= 1.4s)", ccSim.iframe >= 1.4);
      const d1 = ccSim.distance;
      for (let k = 0; k < 6; k++) ccSim.step(1 / 60);
      ok("world advances again after Continue (distance increases)", ccSim.distance > d1);
    }

    // D6 per-question timer: a countdown is set when a gate forces a question; running out auto-resolves as incorrect.
    { const o = w.document.querySelector(".cc-overlay"); if (o) o.style.display = "none"; }
    ccSim.reset();
    ccSim._passGate(ccSim.gates.items[0]);
    ok("gate question sets a per-question time limit in range (12–45s)", !!ccSim.pending && ccSim.pending.limitS >= 12 && ccSim.pending.limitS <= 45);
    await runFrames(3);
    ok("countdown is displayed on the question overlay", /\d+\s*s/.test((w.document.querySelector(".cc-qtimer") || {}).textContent || ""));
    const lim = ccSim.pending.limitS, sh0 = ccSim.shields;
    ccSim.tickQuestion(lim + 1);          // force the clock past the deadline
    ok("running out of time auto-resolves to EXPLAIN", ccSim.phase === "EXPLAIN");
    ok("timeout is graded incorrect", ccSim.lastResult && ccSim.lastResult.timedOut === true && ccSim.lastResult.correct === false);
    ok("timeout costs two shields (04 task 4: wrong/timeout = -2)", ccSim.shields === sh0 - 2);
    await runFrames(3);
    ok("timeout shows the explanation feedback", /time/i.test((w.document.querySelector(".cc-fb-head") || {}).textContent || ""));
  }
  const ccRoot2 = shell.currentGameRoot;
  shell.exitGame();
  ok("CC(2) unmounted -> menu", shell.screen === "menu");

  console.log("\nE3. CC obstacle redesign (rock wall narrowing / full-width arch / solvable rows)");
  shell.enterGame("CC");
  await wait(10);
  { const sk = w.document.querySelector(".cc-intro-skip"); if (sk) sk.click(); }
  { const c = w.document.querySelector(".cc-howto-cont"); if (c) c.click(); }
  const ccSim3 = SN.getGame("CC")._sim();
  ok("CC sim accessible (E3)", !!ccSim3);
  if (ccSim3) {
    const EN = (w.CC && w.CC._enums) || { OB_NARROW: 0, OB_LOWROCK: 1, OB_ARCH: 2, SIDE_LEFT: 0, SIDE_RIGHT: 1 };
    ccSim3.reset();
    let nNarrow = 0, nLow = 0, nArch = 0, rows = 0, unsolvable = 0;
    let narrowSealOK = true, lowJumpOK = true, archWideOK = true, archDuckOK = true;
    for (let i = 0; i < 1500; i++) {
      const z = 100 + i * 40;
      ccSim3._spawnRow(z);                                                   // drive the spawner directly (deterministic per rng)
      const row = ccSim3.obstacles.items.filter(o => o.active && Math.abs(o.z - z) < 0.001);
      rows++;
      for (const o of row) {
        if (o.type === EN.OB_ARCH) {
          nArch++;
          for (const ln of [0, 1, 2]) {                                      // full-width: hits every standing lane, clears every ducking lane
            if (!ccSim3._wouldHit(o, ln, "stand")) archWideOK = false;
            if (ccSim3._wouldHit(o, ln, "duck")) archDuckOK = false;
          }
        } else if (o.type === EN.OB_NARROW) {
          nNarrow++;
          if (!ccSim3._wouldHit(o, o.lane, "stand")) narrowSealOK = false;   // a wall blocks its own lane
          for (const ln of [0, 1, 2]) if (ln !== o.lane && ccSim3._wouldHit(o, ln, "stand")) narrowSealOK = false; // and ONLY its own lane (no x-bleed)
        } else {
          nLow++;
          if (!ccSim3._wouldHit(o, o.lane, "stand")) lowJumpOK = false;      // standing in its lane is hit
          if (ccSim3._wouldHit(o, o.lane, "jump")) lowJumpOK = false;        // jumping clears it
        }
      }
      // solvability: some (lane, action) clears every obstacle in the row
      let solved = false;
      for (const ln of [0, 1, 2]) {
        for (const act of ["stand", "jump", "duck"]) {
          let hit = false;
          for (const o of row) { if (ccSim3._wouldHit(o, ln, act)) { hit = true; break; } }
          if (!hit) { solved = true; break; }
        }
        if (solved) break;
      }
      if (!solved) unsolvable++;
      for (const o of row) ccSim3.obstacles.release(o);                      // recycle so the cap-32 pool never exhausts
    }
    ok("all three obstacle kinds spawn (narrowing / low rock / arch)", nNarrow > 0 && nLow > 0 && nArch > 0);
    ok("each narrowing wall blocks exactly its own lane (no x-bleed)", narrowSealOK);
    ok("low rock blocks a stander in its lane and is jump-clearable", lowJumpOK);
    ok("arch is full-width: hits a stander in every lane", archWideOK);
    ok("arch is cleared by ducking in every lane", archDuckOK);
    ok("every spawned row is solvable (0 unclearable across " + rows + " rows)", unsolvable === 0);
    // 04 task 5: wall-extend seals an outer + the center, leaving ONLY the far opposite lane open
    let weOK = true;
    for (const side of [EN.SIDE_LEFT, EN.SIDE_RIGHT]) {
      ccSim3._spawnWallExtend(side, 100);
      const wrow = ccSim3.obstacles.items.filter(o => o.active);
      const far = (side === EN.SIDE_LEFT) ? 2 : 0;
      for (const ln of [0, 1, 2]) {
        let hit = false; for (const o of wrow) if (ccSim3._wouldHit(o, ln, "stand")) { hit = true; break; }
        if (ln === far ? hit : !hit) weOK = false;          // far lane open, the other two sealed
      }
      for (const o of wrow) ccSim3.obstacles.release(o);
    }
    ok("wall-extend leaves ONLY the far lane open (04 task 5)", weOK);
    // render fix (Jason): outer wall draws a 2-lane bulge (span 2), the sealed centre is collision-only (span 0)
    ccSim3.reset();
    ccSim3._spawnWallExtend(EN.SIDE_LEFT, 100);
    const weSpans = ccSim3.obstacles.items.filter(o => o.active).map(o => o.span).sort();
    ok("wall-extend renders a 2-lane bulge + a collision-only centre (graphic fix)", weSpans.length === 2 && weSpans[0] === 0 && weSpans[1] === 2);
    for (const o of ccSim3.obstacles.items.filter(o => o.active)) ccSim3.obstacles.release(o);
    // (clear-lane fix) a wall never hits a player whose centre is in an adjacent lane, even mid-tween across the boundary
    ccSim3.reset();
    let clearLaneOK = true, rockForgiveOK = true;
    ccSim3._placeObstacle(EN.OB_NARROW, 1, EN.SIDE_LEFT, 100);          // wall sealing the centre lane (x=0)
    const wallO = ccSim3.obstacles.items.find(o => o.active);
    for (let x = ccSim3.cfg.LANE_W * 0.5 + 0.01; x <= ccSim3.cfg.LANE_W; x += 0.1) {
      if (ccSim3._hitsObstacle(wallO, { x: x, y: 0, topY: 1.4 })) clearLaneOK = false;   // past the boundary => clear
    }
    if (!ccSim3._hitsObstacle(wallO, { x: 0, y: 0, topY: 1.4 })) clearLaneOK = false;     // still solid dead-centre
    ccSim3.obstacles.release(wallO);
    ok("wall never hits a player centred in an adjacent lane (clear-lane fix)", clearLaneOK);
    // (v0.47.0) the jump obstacle is a FULL-WIDTH wall: standing hits at every lane x; jumping clears it
    ccSim3._placeObstacle(EN.OB_LOWROCK, 1, 0, 100);
    const rockO = ccSim3.obstacles.items.find(o => o.active);
    for (const lx of [-ccSim3.cfg.LANE_W, 0, ccSim3.cfg.LANE_W]) {
      if (!ccSim3._hitsObstacle(rockO, { x: lx, y: 0, topY: 1.9 })) rockForgiveOK = false;                 // standing hits in EVERY lane
      if (ccSim3._hitsObstacle(rockO, { x: lx, y: ccSim3.cfg.JUMP_HEIGHT, topY: ccSim3.cfg.JUMP_HEIGHT + 1.9 })) rockForgiveOK = false;   // a jump clears in EVERY lane
    }
    ccSim3.obstacles.release(rockO);
    ok("jump wall is full-width (all lanes hit standing) and jumpable (all lanes clear airborne)", rockForgiveOK);
    // (Jason) hold-to-extend jump: holding keeps the player airborne (and pinned at the apex) ~JUMP_HANG_MAX longer than a tap
    function ccAir(hold) {
      ccSim3.reset();
      ccSim3.shields = 999;                                  // survive any obstacle so the run can't end mid-measurement
      ccSim3.jump();
      if (hold) ccSim3.holdJump();
      let frames = 0, apexFrames = 0;
      const APEX = ccSim3.cfg.JUMP_HEIGHT - 1e-4;
      for (let i = 0; i < 600 && ccSim3.player.jumping; i++) {
        ccSim3.step(1 / 60); frames++;
        if (ccSim3.player.y >= APEX) apexFrames++;
      }
      return { frames, apexFrames };
    }
    const ccTap = ccAir(false), ccHeld = ccAir(true);
    const hangFrames = Math.round(ccSim3.cfg.JUMP_HANG_MAX * 60);   // ~30 at 60fps
    ok("hold-jump stays airborne ~JUMP_HANG_MAX longer than a tap", ccHeld.frames > ccTap.frames + hangFrames - 5 && ccHeld.frames < ccTap.frames + hangFrames + 5);
    ok("hold-jump floats at the apex; a tap passes straight through", ccHeld.apexFrames >= hangFrames - 6 && ccTap.apexFrames <= 3);
  }
  shell.exitGame();
  ok("CC(3) unmounted -> menu", shell.screen === "menu");

  console.log("\nF. KBB (real module — #24 flow: how-to -> cinematic -> shop -> start)");
  calls.length = 0;
  shell.enterGame("KBB");
  ok("screen === game:KBB", shell.screen === "game:KBB");
  ok("KBB track played on enter", calls.indexOf("track:kbb") !== -1);
  await wait(10);
  ok("KBB mounted its UI (.kbb-root)", !!w.document.querySelector(".kbb-root"));
  ok("KBB rendered a scene canvas (.kbb-canvas)", !!w.document.querySelector(".kbb-canvas"));
  // (Session 2 rebuild: the combat zone is a code-generated looping Kuiper-Belt + sprite-billboard ships in the RED grid cell, not a full-bleed CSS nebula on .kbb-root. Art usage is covered by the KBB module harness.)
  // (v0.68.0, J6) NEW opening: cinematic FIRST -> live easy battle -> how-to tour over
  // POPULATED zones (the old how-to-first order spotlighted empty panels = "blank boxes").
  ok("J6: KBB opens on the cinematic (Skip present), NOT the how-to", !!w.document.querySelector(".kbb-skip") && !w.document.querySelector(".kbb-howto"));
  { const e = await runFrames(3); ok("KBB intro loop runs without error", e.length === 0); }
  const kbbSkip = Array.from(w.document.querySelectorAll(".kbb-skip")).find(b => /skip/i.test(b.textContent || ""));
  if (kbbSkip) kbbSkip.dispatchEvent(new w.Event("click", { bubbles: true }));
  await wait(10);
  ok("intro cleared after skip (Skip button gone)", !Array.from(w.document.querySelectorAll(".kbb-skip")).some(b => /skip/i.test(b.textContent || "")));
  ok("J6: no pre-run shop — the first battle is LIVE under the tour",
    w.document.querySelectorAll(".kbb-opt").length > 0 && !Array.from(w.document.querySelectorAll(".kbb-btn")).some(b => /start run/i.test(b.textContent || "")));
  ok("J6: the how-to tour rides on top of the populated battle", !!w.document.querySelector(".kbb-howto"));
  { const nextBtn = w.document.querySelector(".kbb-howto .kbb-ht-next"); ok("How to play opens on the intro step (Next button)", !!nextBtn && /next/i.test(nextBtn.textContent || "")); if (nextBtn) nextBtn.dispatchEvent(new w.Event("click", { bubbles: true })); }
  ok("Next advances the walkthrough to a zone callout (.kbb-ht-call)", !!w.document.querySelector(".kbb-howto .kbb-ht-call"));
  { const spot = w.document.querySelector(".kbb-ht-spot");
    ok("the walkthrough spotlights a real screen zone (.kbb-ht-spot)", !!spot);
    ok("J6 blank-box fix: the spotlighted zone has CONTENT", !!spot && spot.textContent.trim().length > 0); }
  { const skip = w.document.querySelector(".kbb-howto .kbb-ht-skip"); ok("the walkthrough offers Skip", !!skip); if (skip) skip.dispatchEvent(new w.Event("click", { bubbles: true })); }
  await wait(10);
  ok("How to play cleared (.kbb-howto gone)", !w.document.querySelector(".kbb-howto"));
  ok("Skip clears the zone spotlight too", !w.document.querySelector(".kbb-ht-spot"));
  ok("the live first battle offers answer options (.kbb-opt)", w.document.querySelectorAll(".kbb-opt").length > 0);
  ok("battle question sits in the question cell (.kbb-main, YELLOW zone)", !!w.document.querySelector(".kbb-main") && w.document.querySelectorAll(".kbb-opt").length > 0);
  ok("player health rings present (green HP + blue shield)", !!w.document.querySelector(".kbb-ring-pl .arc.hp") && !!w.document.querySelector(".kbb-ring-pl .arc.shield"));
  ok("enemy health ring present", !!w.document.querySelector(".kbb-ring-en .arc.ehp"));
  ok("left column shows artifacts + coins", !!w.document.querySelector(".kbb-arts-card .kbb-arts") && !!w.document.querySelector(".kbb-coins .v"));
  { const top = w.document.querySelector(".kbb-top"); ok("first battle is round 1-1 (#24: Start didn't advance the round)", !!top && /depth[\s\u00a0]+1-1/i.test(top.textContent || "")); }
  { const e = await runFrames(); if (e.length) console.log("    first KBB frame error:", e[0] && e[0].message); ok("KBB draw loop runs without error", e.length === 0); }
  const kbbRoot = shell.currentGameRoot;
  const kbbContainer = w.document.querySelector(".kbb-root");
  shell.exitGame();
  ok("KBB unmounted -> menu", shell.screen === "menu");
  ok("KBB game root detached", !kbbRoot.parentNode);
  ok("KBB container removed (zero residue)", !w.document.querySelector(".kbb-root") && (!kbbContainer || !kbbContainer.parentNode));

  console.log("\nG. Answering a KBB question (engine smoke)");
  calls.length = 0;
  shell.enterGame("KBB");
  await wait(10);
  // (v0.68.0, J6) advance through the NEW opening: cinematic -> live battle + tour -> skip tour
  { const sk = Array.from(w.document.querySelectorAll(".kbb-skip")).find(b => /skip/i.test(b.textContent || "")); if (sk) sk.dispatchEvent(new w.Event("click", { bubbles: true })); }
  await wait(10);
  { const sk0 = w.document.querySelector(".kbb-howto .kbb-ht-skip"); if (sk0) sk0.dispatchEvent(new w.Event("click", { bubbles: true })); }
  await wait(10);
  const opts = w.document.querySelectorAll(".kbb-opt");
  ok("KBB has clickable options", opts.length > 0);
  // (v0.46.0 K5) pre-answer agency: three action buttons, Attack preselected
  ok("battle offers the three-action row (Attack/Brace/Repair)", w.document.querySelectorAll(".kbb-action").length === 3);
  ok("Attack is the default selected action", !!w.document.querySelector('.kbb-action[data-act="attack"].on'));
  ok("action hint renders under the action row (v0.48.0)", !!w.document.querySelector(".kbb-act-hint"));
  // (v0.50.0) boss-music pin: flag the live enemy as a boss (+ inflate hp so this answer can't kill it);
  // the next renderAll must swap the bed to the fixed 'boss' track with intensity.
  {
    const stB = w.KBB._test.state();
    if (stB && stB.run && stB.run.battle && stB.run.battle.enemy) {
      stB.run.battle.enemy.boss = true;
      stB.run.battle.enemy.hp = stB.run.battle.enemy.maxHp = 500;
    }
    calls.length = 0;
  }
  let threw = false;
  try {
    if (opts.length) {
      opts[0].dispatchEvent(new w.Event("click", { bubbles: true }));
      // "choose two" draws don't submit on a single click — finish via the Submit button
      if (!w.document.querySelector(".kbb-fb-exp")) {
        const sub = w.document.querySelector(".kbb-submit");
        if (sub && !sub.disabled) sub.dispatchEvent(new w.Event("click", { bubbles: true }));
      }
    }
  } catch (e) { threw = true; }
  await runFrames(4);
  ok("answering an option does not throw", !threw);
  { const st = w.KBB && w.KBB._test && w.KBB._test.state && w.KBB._test.state();
    ok("answering queues battle animations (graphics overhaul FX)", !!(st && Array.isArray(st.fx) && st.fx.length > 0)); }
  const answered = w.document.querySelector(".kbb-opt.correct, .kbb-opt.wrong") ||
                   w.document.querySelector(".kbb-fb") ||
                   w.document.querySelector(".kbb-opt:disabled");
  ok("answer registered (feedback/result shown)", !!answered);
  ok("KBB shows the explanation after answering (P1c)", !!w.document.querySelector(".kbb-fb-exp"));
  const kbbCont = w.document.querySelector(".kbb-cont");
  ok("KBB shows a Continue gate, not an auto-advance (P1c)", !!kbbCont);
  let contThrew = false;
  try { if (kbbCont) kbbCont.dispatchEvent(new w.Event("click", { bubbles: true })); } catch (e) { contThrew = true; }
  await runFrames(4);
  ok("clicking Continue advances without error (P1c)", !contThrew);
  // (v0.50.0) the fresh-question renderAll after Continue must have swapped the bed to 'boss'
  ok("boss battle swaps the music to 'boss' (v0.50.0)", calls.some(c => c === "track:boss"));
  { const stB2 = w.KBB._test.state(); if (stB2 && stB2.run && stB2.run.battle && stB2.run.battle.enemy) stB2.run.battle.enemy.boss = false; }
  // (v0.48.0) the enemy panel STRIKES (kbb-en-strike) when its counterattack lands — probe across
  // up to 6 turns since an individual turn's intent can be 0 ("Charging") and screens may interleave.
  {
    let struck = false;
    const isStruck = () => { const ep = w.document.querySelector(".kbb-enemy"); return !!(ep && ep.classList.contains("kbb-en-strike")); };
    struck = isStruck();
    for (let round = 0; round < 6 && !struck; round++) {
      let op = w.document.querySelector(".kbb-opt:not(:disabled)");
      for (let adv = 0; adv < 3 && !op; adv++) {                      // advance through reward/continue screens
        const c2 = w.document.querySelector(".kbb-cont:not(.kbb-submit)") || Array.from(w.document.querySelectorAll(".kbb-btn")).find(b => /continue|next|onward/i.test(b.textContent || ""));
        if (!c2) break;
        c2.dispatchEvent(new w.Event("click", { bubbles: true }));
        await runFrames(3);
        op = w.document.querySelector(".kbb-opt:not(:disabled)");
      }
      if (!op) break;
      op.dispatchEvent(new w.Event("click", { bubbles: true }));
      const sub2 = w.document.querySelector(".kbb-submit");
      if (sub2 && !sub2.disabled) sub2.dispatchEvent(new w.Event("click", { bubbles: true }));
      await runFrames(4);
      struck = isStruck();
      if (!struck) { const c3 = w.document.querySelector(".kbb-cont:not(.kbb-submit)"); if (c3) c3.dispatchEvent(new w.Event("click", { bubbles: true })); await runFrames(3); }
    }
    ok("enemy panel telegraphs its strike (kbb-en-strike fires within 6 turns)", struck);
  }
  {
    const bi = calls.indexOf("track:boss"), ki = calls.lastIndexOf("track:kbb");
    ok("music returns to 'kbb' after the boss flag clears (v0.50.0)", bi >= 0 && ki > bi);
  }
  ok("FINAL ATTACK urgency wired into the intent statline (v0.48.0)", html.includes("FINAL ATTACK"));
  shell.exitGame();
  ok("KBB exits cleanly after answering", shell.screen === "menu" && !w.document.querySelector(".kbb-root"));

  console.log("\nG1b. KBB agency layer (v0.46.0 K5) + combat re-tune (K4)");
  {
    const K = w.KBB;
    ok("re-tune landed (basePower 12, heal 10, intents 2.5/0.35)",
       K.CONFIG.squad.basePower === 12 && K.CONFIG.squad.healPower === 10 && K.CONFIG.intentBase === 2.5 && K.CONFIG.intentPerRound === 0.35);
    let qn = 0;
    const provider = { next() { return { question: { id: "aq" + (qn++), difficulty: 2, domain: "d", options: ["a", "b", "c", "d"], correctIndex: 0, stem: "s", explanation: "e" }, reason: "t" }; } };
    const kctx = { rng: K.makeRng(4242), questions: provider };
    const krun = K.createRun(kctx, { seed: 4242, preRunShop: true });
    K.startDungeon(krun);
    K.drawQuestion(krun);
    const shBefore = krun.squad.shield;
    const r1 = K.submitAnswer(krun, 0, 800, "brace");
    // assert REAL squad state, not just the result object: shield = before + block − whatever
    // the counterattack absorbed (the negative control proved a result-only check has a hole)
    const shExpect = Math.max(0, shBefore + K.CONFIG.squad.block - (r1.enemyAttacked ? r1.incoming : 0));
    ok("brace: a correct answer raises shield by block and deals no damage",
       r1.correct === true && r1.action === "brace" && r1.damage === 0 && r1.enemyHpBefore === krun.battle.enemy.hp
       && krun.squad.shield === shExpect && shExpect > shBefore - (r1.enemyAttacked ? r1.incoming : 0));
    K.drawQuestion(krun);
    const r2 = K.submitAnswer(krun, 1, 800, "brace");
    ok("a wrong answer executes nothing regardless of the chosen action", r2.correct === false && r2.shieldGained === 0 && r2.damage === 0);
    krun.squad.hp = 25;
    K.drawQuestion(krun);
    const r3 = K.submitAnswer(krun, 0, 800, "repair");
    ok("repair: a correct answer heals healPower", r3.correct === true && r3.action === "repair" && r3.healed === K.CONFIG.squad.healPower);
    K.drawQuestion(krun);
    const r4 = K.submitAnswer(krun, 0, 800);
    ok("omitting the action still attacks (backward compatible)", r4.action === "attack" && r4.damage > 0);
  }

  ok("ARM intro dive beat wires the REAL planet image (Jason: keep it)", html.includes("SPR.planet = loadSprite(A.planet)"));

  console.log("\nG2. Pause overlay (shell-driven freeze + music stop/restart, self-heal)");
  calls.length = 0;
  shell.enterGame("ARM");
  await wait(10);
  ok("running game shows a Pause button, no overlay yet", !!w.document.querySelector(".sx-pausebtn") && !w.document.querySelector(".sx-pause"));
  let pzThrew = false;
  try { shell.togglePause(); } catch (e) { pzThrew = true; console.log("    pause error:", e && e.message); }
  ok("opening pause does not throw (drives module.pause)", !pzThrew);
  ok("pause overlay appears (.sx-pause)", !!w.document.querySelector(".sx-pause"));
  ok("pause overlay offers Resume + Menu", !!w.document.querySelector(".sx-pause-resume") && Array.from(w.document.querySelectorAll(".sx-pause .sx-btn")).some(b => /menu/i.test(b.textContent || "")));
  ok("entering pause STOPS the music (setMusic false)", calls.indexOf("music:false") !== -1);
  ok("shell flags itself paused", shell._paused === true);
  { const n = w.document.querySelectorAll(".sx-pause").length; shell.openPause(); ok("double-open is a no-op (single overlay)", w.document.querySelectorAll(".sx-pause").length === n); }
  // (v0.49.0) music-style toggle lives in the pause menu, persists, and repaints
  {
    const gbtns = Array.from(w.document.querySelectorAll(".sx-genre-btn"));
    ok("pause menu offers the Upbeat/Chill music-style toggle (v0.49.0)", !!w.document.querySelector(".sx-genre-row") && gbtns.length === 2);
    const chillBtn = gbtns.find(b => /chill/i.test(b.textContent || ""));
    calls.length = 0;
    if (chillBtn) chillBtn.dispatchEvent(new w.Event("click", { bubbles: true }));
    const st49 = w.StarNix.core.profile.settings;
    ok("picking Chill persists settings.musicGenre", st49.musicGenre === "chill");
    // (v0.68.0, J3) the swap itself must RESOLVE: the old code fed playTrack the UPPERCASE
    // game id, which audio.js silently ignored — the whole toggle was audibly dead.
    ok("J3 fix: picking Chill queues the lowercase context bed (no dead 'track:ARM' call)",
      calls.indexOf("track:arm") !== -1 && calls.indexOf("track:ARM") === -1);
    ok("Chill button paints active (sx-btn-primary)", chillBtn && /sx-btn-primary/.test(chillBtn.className));
    const upBtn = gbtns.find(b => /upbeat/i.test(b.textContent || ""));
    if (upBtn) upBtn.dispatchEvent(new w.Event("click", { bubbles: true }));
    ok("picking Upbeat restores the setting", st49.musicGenre === "upbeat");
  }
  ok("all four chill/upbeat playlists are inlined (spot ids)", ["arm_ch_5", "kbb_up_3", "menu_ch_4", "cc_ch_2"].every(id => html.includes(id + ":")));
  calls.length = 0;
  let rzThrew = false;
  try { w.document.querySelector(".sx-pause-resume").dispatchEvent(new w.Event("click", { bubbles: true })); } catch (e) { rzThrew = true; console.log("    resume error:", e && e.message); }
  ok("resume does not throw (drives module.resume)", !rzThrew);
  ok("resume clears the overlay", !w.document.querySelector(".sx-pause"));
  ok("resuming RESTARTS the music (audio self-heal, setMusic true)", calls.indexOf("music:true") !== -1);
  ok("shell no longer flagged paused", shell._paused === false);
  try {
    w.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape" }));
    ok("Esc opens the pause overlay", !!w.document.querySelector(".sx-pause"));
    w.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape" }));
    ok("Esc again resumes (overlay gone)", !w.document.querySelector(".sx-pause"));
  } catch (e) { console.log("    Esc error:", e && e.message); ok("Esc opens the pause overlay", false); ok("Esc again resumes (overlay gone)", false); }
  shell.togglePause();
  const pmenu = Array.from(w.document.querySelectorAll(".sx-pause .sx-btn")).find(b => /menu/i.test(b.textContent || ""));
  let pmThrew = false;
  try { if (pmenu) pmenu.dispatchEvent(new w.Event("click", { bubbles: true })); } catch (e) { pmThrew = true; }
  ok("Menu from pause does not throw", !pmThrew);
  ok("Menu from pause returns to the shell menu", shell.screen === "menu");
  ok("pause overlay + game root cleared after exit", !w.document.querySelector(".sx-pause") && !w.document.querySelector(".sx-game-root"));

  console.log("\nH. Re-entry (state isolation)");
  shell.enterGame("ARM"); await wait(10);
  ok("ARM re-mounts cleanly", shell.screen === "game:ARM" && shell.currentGameRoot.childNodes.length > 0);
  shell.exitGame();
  ok("ARM re-exits cleanly", shell.screen === "menu");

  console.log("\nH2. Progress / Stats screen (P1d)");
  let statsThrew = false;
  try { shell.showStats(); } catch (e) { statsThrew = true; console.log("    showStats error:", e && e.message); }
  ok("Stats screen renders without throwing", !statsThrew && shell.screen === "stats");
  ok("Stats shows stat boxes", w.document.querySelectorAll(".sx-stat").length >= 4);
  ok("Stats shows per-domain rows (all 9 domains)", w.document.querySelectorAll(".sx-dom-row").length >= 9);
  ok("Stats surfaces a 'Due for review' metric", /Due for review/.test(w.document.querySelector(".sx-stat-grid").textContent || ""));
  shell.showMenu();
  ok("returns to menu from Stats", shell.screen === "menu");

  console.log("\nH3. Settings — volume sliders + reset (Part 3 #14)");
  let setThrew = false;
  try { shell.showSettings(); } catch (e) { setThrew = true; console.log("    showSettings error:", e && e.message); }
  ok("Settings screen renders without throwing", !setThrew && shell.screen === "settings");
  const ranges = w.document.querySelectorAll(".sx-range");
  ok("Settings shows 3 volume sliders (master/music/sfx)", ranges.length === 3);
  ok("Settings shows the a11y toggles (reduced motion / extra time / colorblind)", w.document.querySelectorAll(".sx-switch").length === 3);
  ok("Settings shows a reset-progress control", !!w.document.querySelector(".sx-btn-danger"));

  // #12 P1 — high-contrast toggle: live, applied to <html>, persisted, and applied on boot.
  const themeStyle = w.document.getElementById("starnix-theme");
  ok("theme CSS includes a high-contrast override block", !!themeStyle && /\[data-contrast="high"\]/.test(themeStyle.textContent || ""));
  ok("a11y toggle is relabelled 'High contrast'",
    [...w.document.querySelectorAll(".sx-toggle-label")].some(n => n.textContent === "High contrast"));
  const hcSwitch = w.document.querySelectorAll(".sx-switch")[2];
  hcSwitch.click();
  ok("toggling High contrast sets <html data-contrast=high>", w.document.documentElement.getAttribute("data-contrast") === "high");
  ok("High contrast persists to settings.colorblind", SN.core.profile.settings.colorblind === true);
  hcSwitch.click();
  ok("toggling High contrast off removes the attribute", !w.document.documentElement.getAttribute("data-contrast"));
  ok("High contrast off persists (settings.colorblind === false)", SN.core.profile.settings.colorblind === false);
  SN.core.profile.settings.colorblind = true; shell._applyContrast();
  ok("_applyContrast applies high contrast from a saved profile", w.document.documentElement.getAttribute("data-contrast") === "high");
  SN.core.profile.settings.colorblind = false; shell._applyContrast();
  ok("_applyContrast clears high contrast when unset", !w.document.documentElement.getAttribute("data-contrast"));
  // JB3 (v0.80.0) — KBB cinematic fx reach the 3D view via the overlay canvas
  console.log("\nJB3. KBB 3D fx overlay source pins");
  ok("JB3: a .kbb-fx overlay canvas is created above the 3D view",
    html.includes("fx.className = 'kbb-fx'") && html.includes(".kbb-fx{position:absolute"));
  ok("JB3: render3D projects anchors and runs the shared fx pipeline on the overlay",
    html.includes("fxRenderOverlays(s, ts, { cxL: pxL, cxR: pxR, yShip: pyS, W: T.W / k3 }, fg)"));
  ok("JB3: the dying hull persists until the core detonation in BOTH render paths",
    (html.match(/s\.deathAt && ts < s\.deathAt/g) || []).length === 2);

  // JB1 (v0.79.0) — Dev Jukebox: one button per library track, exact playback, stop control
  console.log("\nJB1. Dev Jukebox");
  const jbIds = SN.core.audio.trackIds ? SN.core.audio.trackIds() : [];
  ok("audio.trackIds() lists the full library (>= 43 tracks, got " + jbIds.length + ")", jbIds.length >= 43);
  const jbBtns = w.document.querySelectorAll(".sx-jukebox .sx-jb-btn");
  ok("Jukebox renders one button per track (" + jbBtns.length + ")", jbBtns.length > 0 && jbBtns.length === jbIds.length);
  const jbTarget = [...jbBtns].find(n => n.textContent === "kbb_ch_3");
  ok("rotation-only variants are individually reachable (kbb_ch_3 button exists)", !!jbTarget);
  if (jbTarget) {
    jbTarget.click();
    ok("clicking a Jukebox button plays EXACTLY that track (exact:true, no playlist resolution)",
      SN.core.audio.state().trackId === "kbb_ch_3" && SN.core.audio._last.exact === true);
    ok("the playing button is highlighted + now-line updates", jbTarget.classList.contains("on")
      && /kbb_ch_3/.test(w.document.querySelector(".sx-jb-now").textContent || ""));
    const jbStop = [...w.document.querySelectorAll(".sx-jukebox .sx-btn")].find(n => /stop/i.test(n.textContent || ""));
    jbStop.click();
    ok("Stop returns to the menu bed", /^menu/.test(SN.core.audio.state().trackId || ""));
  } else { ok("jukebox click probe (unreached)", false); ok("jukebox highlight probe (unreached)", false); ok("jukebox stop probe (unreached)", false); }

  let slideThrew = false;
  try { ranges[1].value = "50"; ranges[1].dispatchEvent(new w.Event("input", { bubbles: true })); } catch (e) { slideThrew = true; }
  ok("adjusting a volume slider does not throw", !slideThrew);
  ok("slider write persists to settings.musicVol", Math.abs((SN.core.profile.settings.musicVol || 0) - 0.5) < 1e-6);
  let resetThrew = false;
  try { w.document.querySelector(".sx-btn-danger").dispatchEvent(new w.Event("click", { bubbles: true })); } catch (e) { resetThrew = true; }
  ok("reset first tap arms a confirm (no reload in harness)", !resetThrew && /confirm/i.test(w.document.querySelector(".sx-btn-danger").textContent || ""));
  shell.showMenu();
  ok("returns to menu from Settings", shell.screen === "menu");

  console.log("\nI. KBB economy + sell rules (P4)");
  {
    const KBB = w.KBB;
    ok("KBB engine exposed on window", !!KBB && typeof KBB.createRun === "function");
    ok("sell API exposed", typeof KBB.sellArtifact === "function" && typeof KBB.isSellable === "function");
    const ctx = SN.makeContext("KBB");
    ok("ctx.assets wired — armBoss sprite inlined + reachable by games", ctx.assets && typeof ctx.assets.armBoss === "string" && ctx.assets.armBoss.indexOf("data:image/") === 0);
    const run = KBB.createRun(ctx, { seed: 7 });
    ok("starting HP is 50 (combat retune — poor build fails ~section 6-8)", run.squad.maxHp === 50 && run.squad.hp === 50);
    ok("starts with ~1 common in coins (6)", run.squad.coins === 6);
    ok("battle start grants shield from block (6)", run.squad.shield === KBB.CONFIG.squad.block);

    // pick representative artifacts from the catalog
    const sellable = KBB.ARTIFACTS.find((a) => KBB.isSellable(a));
    const legendary = KBB.ARTIFACTS.find((a) => a.rarity === "legendary");
    ok("a sellable artifact exists", !!sellable);
    ok("legendaries are not sellable", !!legendary && KBB.isSellable(legendary) === false);
    ok("once-per-run (lazarus-protocol) not sellable", KBB.isSellable(KBB.ARTIFACTS_BY_ID["lazarus-protocol"]) === false);
    const onAcq = KBB.ARTIFACTS.find((a) => a.hooks && a.hooks.onAcquire);
    if (onAcq) ok("onAcquire-penalty ('cursed') artifact not sellable", KBB.isSellable(onAcq) === false);

    // equip a sellable artifact (no acquire side-effect) and sell it
    KBB.equipArtifact(run, sellable.id, false);
    const slot = run.squad.artifacts.length - 1;
    const coinsBefore = run.squad.coins, refund = KBB.sellRefund(sellable);
    const r1 = KBB.sellArtifact(run, slot);
    ok("selling a sellable artifact succeeds", r1.ok === true && r1.refund === refund);
    ok("refund is 50% of base price (>=1)", refund === Math.max(1, Math.round(0.5 * KBB.CONFIG.artifactPrice[sellable.rarity])));
    ok("coins increased by the refund", run.squad.coins === coinsBefore + refund);
    ok("artifact removed from squad", run.squad.artifacts.length === slot);

    // selling a legendary is rejected
    KBB.equipArtifact(run, legendary.id, false);
    const lr = KBB.sellArtifact(run, run.squad.artifacts.length - 1);
    ok("selling a legendary is rejected (unsellable)", lr.ok === false && lr.reason === "unsellable");

    // consumable cap is enforced (shop greys it in P5; rule already holds)
    run.consumables = KBB.CONSUMABLE_IDS.slice(0, KBB.CONFIG.consumableCap);
    run.phase = "shop"; KBB._test.buildShop(run);
    run.shop.consumables = [{ id: KBB.CONSUMABLE_IDS[0], price: 0 }];
    const cb = KBB.shopBuyConsumable(run, 0);
    ok("cannot buy a consumable when inventory is full", cb.ok === false && cb.reason === "inv-full");
  }

  // ===================================================================
  // K. Practice Exam (exam.js)
  // ===================================================================
  console.log("\nK. Practice Exam (exam.js)");
  {
    const EX = SN.exam;
    ok("exam module present with run()", !!(EX && typeof EX.run === "function"));

    // --- pure logic ---
    ok("exam single grade hit/miss/timeout", EX.gradeAnswer({ correctIndex: 2 }, 2) === true && EX.gradeAnswer({ correctIndex: 2 }, 1) === false && EX.gradeAnswer({ correctIndex: 2 }, null) === false);
    ok("exam multi grade set-equality", EX.gradeAnswer({ correctIndices: [1, 3] }, [3, 1]) === true && EX.gradeAnswer({ correctIndices: [1, 3] }, [1]) === false && EX.gradeAnswer({ correctIndices: [1, 3] }, [1, 2]) === false);
    ok("exam points decay max->0", EX.pointsAt(0, 30000) === 1000 && EX.pointsAt(15000, 30000) === 500 && EX.pointsAt(30000, 30000) === 0 && EX.pointsAt(99000, 30000) === 0);
    ok("exam window scales by difficulty", EX.windowFor(1) === 30000 && EX.windowFor(2) === 40000 && EX.windowFor(3) === 50000);

    let seed = 7; const erng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const sq = { id: "qx", domain: "vms", difficulty: 2, stem: "S", options: ["A", "B", "C", "D"], optionNotes: ["nA", "nB", "nC", "nD"], correctIndex: 2, explanation: "E" };
    let so = true;
    for (let k = 0; k < 150; k++) { const d = EX.shuffleOptions(sq, erng); if (d.id !== "qx" || d.options[d.correctIndex] !== "C" || d.optionNotes[d.correctIndex] !== "nC") so = false; for (let oi = 0; oi < 4; oi++) if (d.optionNotes[oi] !== "n" + d.options[oi]) so = false; }
    ok("exam shuffleOptions remaps correct+notes, id stable (150x)", so);
    const mq = { id: "qm", domain: "storage", difficulty: 3, stem: "S", options: ["A", "B", "C", "D", "E"], correctIndices: [1, 4], explanation: "E" };
    let mo = true; for (let k = 0; k < 150; k++) { const d = EX.shuffleOptions(mq, erng); if (d.correctIndices.map(i => d.options[i]).sort().join("") !== "BE") mo = false; }
    ok("exam shuffleOptions multi set preserved (150x)", mo);

    const mk = (dom, c, pts) => ({ q: { domain: dom }, correct: c, points: pts });
    const r80 = [mk("a", true, 1), mk("a", true, 1), mk("a", true, 1), mk("a", true, 1), mk("a", false, 0)];
    ok("exam summarize 80%=PASS", EX.summarize(r80, 5).pct === 80 && EX.summarize(r80, 5).pass === true);
    const s60 = EX.summarize([mk("a", true, 800), mk("a", false, 0), mk("b", true, 600), mk("b", true, 900)], 5);
    ok("exam summarize 60%=FAIL, speed=correct-only, byDomain", s60.pct === 60 && s60.pass === false && s60.speedPoints === 2300 && s60.wrong.length === 1 && s60.byDomain.a.correct === 1 && s60.byDomain.a.total === 2);

    // --- headless run(): renders, grades, records, reaches results ---
    const recs = []; const mockMastery = { record: (id, c) => recs.push({ id, c }) };
    const sfxLog = []; const mockAudio = { sfx: (n) => sfxLog.push(n), playTrack: () => {} };
    const cont = w.document.createElement("div"); w.document.body.appendChild(cont);
    let exitCalled = false;
    const pool = [
      { id: "e1", domain: "vms", difficulty: 1, stem: "Q1", options: ["w", "r", "x"], correctIndex: 1, explanation: "x1" },
      { id: "e2", domain: "storage", difficulty: 1, stem: "Q2", options: ["r", "w", "x"], correctIndex: 0, explanation: "x2" }
    ];
    let completed = null;
    const h = EX.run({ container: cont, questions: pool, rng: erng, audio: mockAudio, mastery: mockMastery, reducedMotion: true, bestPoints: 0, onComplete: (sum) => { completed = sum; }, onExit: () => { exitCalled = true; }, onRetry: () => {} });
    ok("exam renders a question card with options", cont.querySelectorAll(".sx-exam-opt").length >= 2);
    ok("exam backdrop is null under jsdom (no WebGL)", h._state.bg === null);
    ok("exam progress shows 'of 2'", /of 2/.test(cont.querySelector(".sx-exam-prog").textContent));

    // answer Q1 correctly (read the displayed/shuffled correct index)
    let dq = h._state.order[h._state.i]; let ci = dq.correctIndex;
    cont.querySelectorAll(".sx-exam-opt")[ci].click();
    await wait(700);
    ok("exam recorded the answer to mastery (game:EXAM)", recs.length === 1 && recs[0].c === true);
    ok("exam played a correctness sfx", sfxLog.length === 1);
    ok("exam advanced to question 2", h._state.i === 1);

    // answer Q2 incorrectly
    dq = h._state.order[h._state.i]; ci = dq.correctIndex;
    const btns = cont.querySelectorAll(".sx-exam-opt"); btns[(ci + 1) % btns.length].click();
    await wait(700);
    ok("exam recorded both answers", recs.length === 2 && recs[1].c === false);
    ok("exam shows the results screen after last question", !!cont.querySelector(".sx-exam-end"));
    ok("exam result is 50% (1 of 2 correct)", /50%/.test(cont.querySelector(".sx-exam-pct").textContent));
    ok("exam review lists exactly the 1 missed question", cont.querySelectorAll(".sx-exam-rv").length === 1);
    ok("exam onComplete fires with the summary on completion", !!completed && completed.pct === 50 && completed.total === 2 && completed.correct === 1);

    // exit via the results-screen Menu button -> teardown + onExit
    const menuBtn = Array.prototype.slice.call(cont.querySelectorAll(".sx-exam-btn")).filter(b => b.getAttribute("data-a") === "menu")[0];
    if (menuBtn) menuBtn.click();
    ok("exam Menu button triggers onExit", exitCalled === true);
    ok("exam teardown stops the loop (running=false)", h._state.running === false);

    // high-score persistence (bests.EXAM, best-per-length) + chooser display
    shell._recordExam({ total: 20, pct: 85, pass: true, speedPoints: 14200, correct: 17 });
    ok("exam best recorded under bests.EXAM by length", SN.core.profile.bests.EXAM["20"].pts === 14200);
    shell._recordExam({ total: 20, pct: 70, pass: false, speedPoints: 9000, correct: 14 });
    ok("a lower score does not overwrite the best", SN.core.profile.bests.EXAM["20"].pts === 14200);
    shell._recordExam({ total: 20, pct: 90, pass: true, speedPoints: 16000, correct: 18 });
    ok("a higher score updates the best", SN.core.profile.bests.EXAM["20"].pts === 16000);
    shell.showExamSetup();
    const qbtn = w.document.querySelectorAll(".sx-exam-len")[0];
    ok("chooser surfaces the best for that length", /16[,.]?000/.test(qbtn.textContent) && /90%/.test(qbtn.textContent));
    shell.showMenu();

    // count slices the pool to the chosen length
    const cc = w.document.createElement("div"); w.document.body.appendChild(cc);
    const dummies = [];
    for (let i = 0; i < 5; i++) dummies.push({ id: "d" + i, domain: "vms", difficulty: 1, stem: "S" + i, options: ["a", "b", "c"], correctIndex: 0, explanation: "e" });
    const hc = EX.run({ container: cc, questions: dummies, count: 2, rng: erng, audio: mockAudio, mastery: mockMastery, reducedMotion: true, onExit: () => {}, onRetry: () => {} });
    ok("exam count slices the pool to the chosen length", hc._state.order.length === 2);
    hc.teardown();

    // shell chooser: setup screen -> launches the exam at the chosen length, leaves clean
    shell.showExamSetup();
    ok("exam setup screen renders length options", shell.screen === "exam-setup" && w.document.querySelectorAll(".sx-exam-len").length >= 1);
    const realPool = SN.core.questions.pool().length;
    const lenBtns = w.document.querySelectorAll(".sx-exam-len");
    lenBtns[0].click();   // Quick (20) is first when the pool exceeds 20
    ok("choosing a length launches the exam", shell.screen === "exam" && !!shell._exam);
    ok("exam honours the chosen count from the chooser", shell._exam._state.order.length === Math.min(20, realPool));
    shell.showMenu();
    ok("leaving the exam tears it down (no leak)", shell._exam === null && shell.screen === "menu");
  }

  // ===================================================================
  // K2. Exam modes: Study + Sim + keyboard (v0.42.0)
  // ===================================================================
  console.log("\nK2. Exam modes (study / sim / keyboard)");
  {
    const EX = SN.exam;
    let seed = 11; const erng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const mkPool = (n) => { const p = []; for (let i = 0; i < n; i++) p.push({ id: "s" + i, domain: i % 2 ? "vms" : "storage", difficulty: 1, stem: "SQ" + i, options: ["a", "b", "c"], correctIndex: 1, explanation: "EXPL" + i, optionNotes: ["na", "nb", "nc"] }); return p; };

    // ---- (v0.50.0) exhibit lightbox: exhibit renders in study mode; click enlarges; click closes ----
    {
      w.STARNIX_EXHIBITS = w.STARNIX_EXHIBITS || {};
      w.STARNIX_EXHIBITS["vb-test-ex"] = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";
      const cz = w.document.createElement("div"); w.document.body.appendChild(cz);
      const pz = mkPool(1); pz[0].image = "vb-test-ex";
      EX.run({ mode: "study", container: cz, questions: pz, rng: erng, audio: { sfx: () => {} }, mastery: { record: () => {} }, reducedMotion: true, onExit: () => {}, onRetry: () => {} });
      const exImg = cz.querySelector(".sx-exam-exhibit img");
      ok("exhibit image renders on the study card (v0.50.0)", !!exImg);
      if (exImg) exImg.dispatchEvent(new w.Event("click", { bubbles: true }));
      const zoomEl = cz.querySelector(".sx-exhibit-zoom");
      ok("clicking the exhibit opens the lightbox", !!zoomEl);
      if (zoomEl) zoomEl.dispatchEvent(new w.Event("click", { bubbles: true }));
      ok("clicking the lightbox closes it", !cz.querySelector(".sx-exhibit-zoom"));
      cz.remove();
    }

    // ---- STUDY: select does not commit; confirm commits; explanation shows; Next advances; Prev browses graded ----
    {
      const recs = []; const cont = w.document.createElement("div"); w.document.body.appendChild(cont);
      const h = EX.run({ mode: "study", container: cont, questions: mkPool(2), rng: erng, audio: { sfx: () => {} }, mastery: { record: (id, c) => recs.push(c) }, reducedMotion: true, onExit: () => {}, onRetry: () => {} });
      ok("study: no per-question timer bar", cont.querySelector(".sx-exam-bars").style.visibility === "hidden");
      const ci = h._state.order[0].correctIndex;
      const opts0 = cont.querySelectorAll(".sx-exam-opt");
      opts0[ci].click();
      ok("study: clicking an option selects, does NOT commit", recs.length === 0 && opts0[ci].classList.contains("sel") && h._state.results.length === 0);
      opts0[(ci + 1) % 3].click();
      ok("study: clicking another option moves the selection", !opts0[ci].classList.contains("sel") && opts0[(ci + 1) % 3].classList.contains("sel"));
      opts0[ci].click();                                   // settle on correct
      cont.querySelector(".sx-exam-confirm").click();
      ok("study: Confirm commits + records mastery", recs.length === 1 && recs[0] === true && h._state.results.length === 1);
      ok("study: explanation panel is shown after grading", /EXPL0|EXPL1/.test((cont.querySelector(".sx-exam-fb .ex") || {}).textContent || ""));
      ok("study: no auto-advance (still on question 1)", /Question 1 of 2/.test(cont.querySelector(".sx-exam-prog").textContent));
      // Next -> Q2, answer wrong, check optionNote for the chosen wrong answer
      cont.querySelector(".sx-exam-fb .primary").click();
      ok("study: Next advances to question 2", /Question 2 of 2/.test(cont.querySelector(".sx-exam-prog").textContent));
      const ci2 = h._state.order[1].correctIndex, wrong = (ci2 + 1) % 3;
      cont.querySelectorAll(".sx-exam-opt")[wrong].click();
      cont.querySelector(".sx-exam-confirm").click();
      ok("study: wrong answer shows its option note", recs.length === 2 && recs[1] === false && /n[abc]/.test((cont.querySelector(".sx-exam-fb .on") || {}).textContent || ""));
      // Prev -> graded read-only view of Q1
      cont.querySelector(".sx-exam-fb .ghost").click();
      const g1 = cont.querySelectorAll(".sx-exam-opt");
      ok("study: Previous shows the graded question read-only", /Question 1 of 2/.test(cont.querySelector(".sx-exam-prog").textContent) && g1[0].disabled && !!cont.querySelector(".sx-exam-fb"));
      // forward again to the graded Q2, then Results
      cont.querySelector(".sx-exam-fb .primary").click();
      cont.querySelector(".sx-exam-fb .primary").click();
      ok("study: Results reached after browsing (1 of 2 correct = 50%)", !!cont.querySelector(".sx-exam-end") && /50%/.test(cont.querySelector(".sx-exam-pct").textContent));
      ok("study: results hide the Blitz speed stats", !cont.querySelector(".sx-exam-statline"));
      h.teardown(); cont.remove();
    }

    // ---- SIM: free nav, editable drafts, flag, review, grade only at submit ----
    {
      const recs = []; const cont = w.document.createElement("div"); w.document.body.appendChild(cont);
      const h = EX.run({ mode: "sim", container: cont, questions: mkPool(3), rng: erng, audio: { sfx: () => {} }, mastery: { record: (id, c) => recs.push(c) }, reducedMotion: true, onExit: () => {}, onRetry: () => {} });
      ok("sim: whole-exam clock is running (deadline set)", h._state.simEnd > 0);
      const c0 = h._state.order[0].correctIndex;
      cont.querySelectorAll(".sx-exam-opt")[c0].click();
      ok("sim: selecting stores a draft without grading", h._state.drafts[0] === c0 && recs.length === 0);
      cont.querySelectorAll(".sx-exam-opt")[(c0 + 1) % 3].click();
      ok("sim: re-selecting edits the draft", h._state.drafts[0] === (c0 + 1) % 3);
      cont.querySelectorAll(".sx-exam-opt")[c0].click();                       // settle correct
      cont.querySelector(".sx-exam-flag").click();
      ok("sim: flag toggles on", h._state.flags[0] === true);
      cont.querySelector(".sx-exam-nav .primary").click();                     // -> Q2
      const c1 = h._state.order[1].correctIndex;
      cont.querySelectorAll(".sx-exam-opt")[(c1 + 1) % 3].click();             // wrong draft
      cont.querySelector(".sx-exam-nav .primary").click();                     // -> Q3 (leave blank)
      cont.querySelector(".sx-exam-nav .primary").click();                     // -> Review
      ok("sim: review lists all questions with answered/blank + flag tags", cont.querySelectorAll(".sx-exam-rvrow").length === 3 && /2 answered/.test(cont.textContent) && /1 blank/.test(cont.textContent) && /1 flagged/.test(cont.textContent));
      cont.querySelectorAll(".sx-exam-rvrow")[2].click();
      ok("sim: clicking a review row jumps to that question", /Question 3 of 3/.test(cont.querySelector(".sx-exam-prog").textContent));
      cont.querySelector(".sx-exam-nav .primary").click();                     // back to Review
      const subBtn = Array.prototype.slice.call(cont.querySelectorAll(".sx-exam-btn")).filter(b => /Submit exam/.test(b.textContent))[0];
      subBtn.click();
      ok("sim: submit grades everything at once (mastery x3, blank=wrong)", recs.length === 3 && recs[0] === true && recs[1] === false && recs[2] === false);
      ok("sim: results show 33% and no speed stats", /33%/.test(cont.querySelector(".sx-exam-pct").textContent) && !cont.querySelector(".sx-exam-statline"));
      h.teardown(); cont.remove();
    }

    // ---- keyboard: A–E select + Enter confirm (study) ----
    {
      const recs = []; const cont = w.document.createElement("div"); w.document.body.appendChild(cont);
      const h = EX.run({ mode: "study", container: cont, questions: mkPool(1), rng: erng, audio: { sfx: () => {} }, mastery: { record: (id, c) => recs.push(c) }, reducedMotion: true, onExit: () => {}, onRetry: () => {} });
      const ci = h._state.order[0].correctIndex;
      const key = (k) => w.document.dispatchEvent(new w.KeyboardEvent("keydown", { key: k, bubbles: true }));
      key("abc".charAt(ci));
      ok("keyboard: letter key selects the option", h._state.selected === ci);
      key("Enter");
      ok("keyboard: Enter confirms + grades", recs.length === 1 && recs[0] === true && !!cont.querySelector(".sx-exam-fb"));
      h.teardown(); cont.remove();
      ok("keyboard: teardown removes the document key listener", (key("a"), h._state.selected === ci));
    }

    // ---- blitz multi-answer live hint (E4) ----
    {
      const cont = w.document.createElement("div"); w.document.body.appendChild(cont);
      const mq = [{ id: "bm", domain: "vms", difficulty: 1, stem: "MQ", options: ["a", "b", "c", "d"], correctIndices: [0, 2], explanation: "e" }];
      const h = EX.run({ container: cont, questions: mq, rng: erng, audio: { sfx: () => {} }, mastery: { record: () => {} }, reducedMotion: true, onExit: () => {}, onRetry: () => {} });
      cont.querySelectorAll(".sx-exam-opt")[0].click();
      ok("blitz multi: hint shows the live selected count", /1 selected/.test(cont.querySelector(".sx-exam-multi").textContent));
      h.teardown(); cont.remove();
    }

    // ---- blitz combo multiplier (v0.58.0 unit 8) — Blitz only; Study untouched ----
    {
      ok("comboMult pinned: base 1.0, +0.1 per chain link, capped x1.5",
        EX.comboMult(0) === 1 && Math.abs(EX.comboMult(1) - 1.1) < 1e-9
        && Math.abs(EX.comboMult(5) - 1.5) < 1e-9 && Math.abs(EX.comboMult(12) - 1.5) < 1e-9);
      const cont = w.document.createElement("div"); w.document.body.appendChild(cont);
      const bq = [];
      for (let i = 0; i < 4; i++) bq.push({ id: "cb" + i, domain: "vms", difficulty: 1, stem: "C" + i, options: ["a", "b", "c", "d"], correctIndex: 0, explanation: "e" });
      const h = EX.run({ container: cont, questions: bq, rng: erng, audio: { sfx: () => {} }, mastery: { record: () => {} }, reducedMotion: true, onExit: () => {}, onRetry: () => {} });
      const st = h._state;
      const clickOpt = (right) => { const q = st.order[st.i]; const ci = q.correctIndex; cont.querySelectorAll(".sx-exam-opt")[right ? ci : (ci + 1) % 4].click(); };
      clickOpt(true);
      ok("blitz: first correct starts the chain — meter shows '1 chain · x1.1'",
        st.combo === 1 && /1 chain/.test(cont.querySelector(".sx-exam-combo").textContent)
        && /1\.1/.test(cont.querySelector(".sx-exam-combo").textContent));
      await wait(330);                                   // blitz auto-advance (260 ms reveal)
      clickOpt(true);
      ok("blitz: the chained answer scores ABOVE the un-multiplied ceiling (x1.1 applied)",
        st.combo === 2 && st.results[1].points > EX.MAX_POINTS);
      await wait(330);
      clickOpt(false);
      ok("blitz: a wrong answer banks 0, resets the chain, clears the meter",
        st.combo === 0 && st.results[2].points === 0 && cont.querySelector(".sx-exam-combo").textContent === "");
      h.teardown(); cont.remove();
      // Study is untouched: same bank, study mode — select + confirm a correct answer
      const cont2 = w.document.createElement("div"); w.document.body.appendChild(cont2);
      const h2 = EX.run({ container: cont2, mode: "study", questions: bq.slice(0, 2), rng: erng, audio: { sfx: () => {} }, mastery: { record: () => {} }, reducedMotion: true, onExit: () => {}, onRetry: () => {} });
      const q2 = h2._state.order[0];
      cont2.querySelectorAll(".sx-exam-opt")[q2.correctIndex].click();
      cont2.querySelector(".sx-exam-confirm").click();
      ok("study: correct answers never touch the combo (no chain, no meter, 0 points)",
        h2._state.combo === 0 && cont2.querySelector(".sx-exam-combo").textContent === ""
        && h2._state.results[0].points === 0);
      h2.teardown(); cont2.remove();
    }

    // ---- (v0.71.0, J7/J8) 150-word DISPLAY caps — authored text untouched, tail behind <details> ----
    {
      const longExp = Array.from({ length: 200 }, (_, i) => "w" + i).join(" ");
      const runCap = (explanation) => {
        const cont = w.document.createElement("div"); w.document.body.appendChild(cont);
        const h = EX.run({ container: cont, mode: "study", questions: [{ id: "cap1", domain: "vms", difficulty: 1, stem: "CAP", options: ["a", "b", "c"], correctIndex: 0, explanation }], rng: erng, audio: { sfx: () => {} }, mastery: { record: () => {} }, reducedMotion: true, onExit: () => {}, onRetry: () => {} });
        cont.querySelectorAll(".sx-exam-opt")[h._state.order[0].correctIndex].click();
        cont.querySelector(".sx-exam-confirm").click();
        const ex = cont.querySelector(".sx-exam-fb .ex");
        const out = { det: ex && ex.querySelector("details.sx-exam-more"), head: ex ? (ex.childNodes[0].textContent || "") : "", text: ex ? ex.textContent : "" };
        h.teardown(); cont.remove();
        return out;
      };
      const capLong = runCap(longExp);
      ok("J8: a 200-word explanation shows exactly 120 words + an expander with the 80-word tail (Jason v0.75.0)",
        !!capLong.det && /80 more words/.test(capLong.det.querySelector("summary").textContent)
        && capLong.head.replace(/…/g, "").trim().split(/\s+/).length === 120
        && capLong.det.querySelector("div").textContent.trim().split(/\s+/).length === 80);
      const capShort = runCap("short and sweet");
      ok("J8: short explanations render whole — no expander", !capShort.det && /short and sweet/.test(capShort.text));
      // (v0.74.0) the NIT wears the title nebula behind its starfield (Jason's ask)
      {
        const cont = w.document.createElement("div"); w.document.body.appendChild(cont);
        const h = EX.run({ container: cont, mode: "study", questions: [{ id: "bg1", domain: "vms", difficulty: 1, stem: "B", options: ["a", "b", "c"], correctIndex: 0, explanation: "e" }], rng: erng, audio: { sfx: () => {} }, mastery: { record: () => {} }, reducedMotion: true, onExit: () => {}, onRetry: () => {} });
        const bg = (cont.querySelector(".sx-exam").style.backgroundImage || "");
        ok("NIT background = darkened title nebula + cover sizing (starfield floats above)",
          bg.indexOf("linear-gradient") === 0 && bg.includes("url(")
          && cont.querySelector(".sx-exam").style.backgroundSize === "cover");
        h.teardown(); cont.remove();
      }
      ok("J8: the same cap ships in ARM/KBB/CC feedback + J7 Vega comms (source pins)",
        html.includes("arm-explain-more") && html.includes("kbb-fb-more") && html.includes("cc-fb-more")
        && html.includes("Vega never exceeds 120 words"));
    }

    // ---- shell: mode picker renders, Study is default, choice reaches the exam ----
    {
      shell.showExamSetup();
      const modes = w.document.querySelectorAll(".sx-exam-mode");
      ok("shell: three exam modes offered, Study default", modes.length === 3 && modes[0].classList.contains("on") && /Study/.test(modes[0].textContent));
      modes[1].click();                                                        // Exam sim
      w.document.querySelectorAll(".sx-exam-len")[0].click();
      ok("shell: chosen mode reaches the running exam", shell._exam && shell._exam._state.mode === "sim");
      shell.showMenu();
      shell._examMode = "study";                                               // reset for any later sections
    }

    // ---- bests stay Blitz-only ----
    {
      const before = JSON.stringify(SN.core.profile.bests.EXAM["20"]);
      shell._recordExam({ total: 20, pct: 99, pass: true, speedPoints: 999999, correct: 20, mode: "study" });
      ok("bests: a Study result never touches the Blitz leaderboard", JSON.stringify(SN.core.profile.bests.EXAM["20"]) === before);
      shell._recordExam({ total: 20, pct: 99, pass: true, speedPoints: 999999, correct: 20, mode: "blitz" });
      ok("bests: a Blitz result still records", SN.core.profile.bests.EXAM["20"].pts === 999999);
    }
  }

  // K3. Progress & readiness screen (v0.51.0)
  console.log("\nK3. Progress & readiness (heatmap / weakest drill / readiness)");
  {
    const core = SN.core;
    const pool = core.questions.pool();
    const qA = pool[0], qB = pool[1];
    for (let i = 0; i < 8; i++) core.mastery.record(qA.id, false, {});      // the unambiguous worst
    for (let i = 0; i < 5; i++) core.mastery.record(qB.id, true, {});       // a mastered one

    // helper: weakest ordering + unseen exclusion
    const weak = shell._weakestQuestions(20);
    ok("weakest: the hammered-wrong question ranks first", weak.length > 0 && weak[0].id === qA.id);
    ok("weakest: only seen questions are drillable", !weak.some(q => { const m = core.mastery.get(q.id); return !(m && m.seen); }));

    // readiness: null without sims; composite math with them; abandoned/study never record
    delete core.profile.examHistory;
    ok("readiness: null score before any completed Exam sim", shell._readiness().score === null);
    shell._recordExam({ mode: "sim", pct: 60, correct: 18, total: 30 });
    shell._recordExam({ mode: "sim", pct: 80, correct: 24, total: 30 });
    shell._recordExam({ mode: "sim", pct: 90, correct: 27, total: 30, abandoned: true });   // must NOT record
    shell._recordExam({ mode: "study", pct: 100, correct: 30, total: 30 });                  // must NOT record
    ok("readiness: completed sims record to examHistory (abandoned + study excluded)",
      core.profile.examHistory.length === 2 && core.profile.examHistory[1].pct === 80);
    const st = core.questions.stats();
    const expect = Math.round(0.5 * ((60 + 80) / 2) + 30 * st.overall.masteredPct + 20 * (st.overall.seen / st.overall.total));
    const r = shell._readiness();
    ok("readiness: composite = 0.5·simAvg + 0.3·mastery + 0.2·coverage vs the 80% mark", r.score === expect && r.target === 80);
    ok("readiness: trend = last sim minus previous", r.trend === 20);

    // screen: readiness + heatmap tiles + weak list + drill launch
    shell.showStats();
    const scoreEl = w.document.querySelector(".sx-ready-score");
    ok("screen: readiness score renders", !!scoreEl && scoreEl.textContent === expect + "%");
    ok("screen: one heatmap tile per domain", w.document.querySelectorAll(".sx-heat").length === st.domains.length);
    ok("screen: sim chips show the recorded history", w.document.querySelectorAll(".sx-simchip").length === 2);
    ok("screen: weakest rows render", w.document.querySelectorAll(".sx-weak-row").length > 0);
    const drill = w.document.querySelector(".sx-drill");
    ok("screen: drill button offers the weak set", !!drill);
    const weakLen = shell._weakestQuestions(20).length;
    drill.dispatchEvent(new w.Event("click", { bubbles: true }));
    ok("drill: launches the exam on exactly the weak subset", shell.screen === "exam" && shell._exam && shell._exam._state.order.length === weakLen);
    ok("drill: runs in Study mode regardless of the picker", shell._exam._state.mode === "study");
    shell.showMenu();

    // hygiene: unwind the seeded state
    delete core.profile.examHistory;
    delete core.profile.mastery[qA.id]; delete core.profile.mastery[qB.id];
  }

  // K4. Commander rank — cross-game XP meta-progression (v0.52.0 unit 2)
  console.log("\nK4. Commander rank (XP pool / rank math / menu strip / rank-up moment)");
  {
    const core = SN.core, X = SN.xp;
    ok("xp API exposed: AWARDS + 10 pinned RANKS + pure helpers", !!X && Array.isArray(X.RANKS) && X.RANKS.length === 10
      && typeof X.rankFor === "function" && typeof X.forAnswer === "function" && typeof X.forExam === "function");
    ok("rank thresholds pinned: 0/150/400/800/1400/2200/3300/4800/6800/9500, strictly ascending",
      X.RANKS.map(r => r.xp).join(",") === "0,150,400,800,1400,2200,3300,4800,6800,9500"
      && X.RANKS.every((r, i, a) => i === 0 || r.xp > a[i - 1].xp));
    ok("rank names: Recruit first, Fleet admiral last, Commander at index 6",
      X.RANKS[0].name === "Recruit" && X.RANKS[9].name === "Fleet admiral" && X.RANKS[6].name === "Commander");
    {
      const r0 = X.rankFor(0), edge = X.rankFor(150), under = X.rankFor(149), top = X.rankFor(999999), bad = X.rankFor(-50);
      ok("rankFor boundaries: 0=Recruit, 149=Recruit, 150=Cadet, huge=Fleet admiral (progress 1), negative clamps to 0",
        r0.index === 0 && under.index === 0 && edge.index === 1 && top.index === 9 && top.progress === 1 && bad.index === 0);
    }
    ok("answer XP pinned: wrong=2, correct+promotion=25, correct-at-cap=10, mastered-crossing=65",
      X.forAnswer(false, 1, 0) === 2 && X.forAnswer(true, 0, 1) === 25
      && X.forAnswer(true, 6, 6) === 10 && X.forAnswer(true, 3, 4) === 65);
    ok("exam XP pinned: abandoned=0, empty=0, complete=25, pass(>=80)=100",
      X.forExam({ abandoned: true, total: 30, pct: 90 }) === 0 && X.forExam(null) === 0
      && X.forExam({ total: 30, pct: 79 }) === 25 && X.forExam({ total: 30, pct: 80 }) === 100);

    // live wiring 1: every mastery.record feeds the pool (promotion detected from the real bucket move)
    // (v0.53.0) sentinel: mark every achievement unlocked so the K4 XP-delta pins stay exact —
    // K5 owns achievement behavior and resets this.
    SN.achievements.LIST.forEach(d => { core.profile.achievements[d.id] = 1; });
    core.profile.xp = 0; core.profile.rankSeen = 0;
    const qX = core.questions.pool()[2];
    const mPrev = core.mastery.get(qX.id), prevB = mPrev ? mPrev.bucket : 0;
    core.mastery.record(qX.id, true, {});
    const mNew = core.mastery.get(qX.id);
    ok("mastery.record awards XP into profile.xp (answer + real promotion delta)",
      core.profile.xp === X.forAnswer(true, prevB, mNew.bucket));

    // live wiring 2: persistence.submitScore (the 01 seam ARM calls on campaign win) — best + run XP
    const xpAfterAnswer = core.profile.xp;
    await core.persistence.submitScore("ARM", 420, { sector: 12 });
    ok("submitScore records bests.ARM and awards the run-score XP",
      core.profile.bests.ARM === 420 && core.profile.xp === xpAfterAnswer + X.AWARDS.runScore);
    await core.persistence.submitScore("ARM", 90, { sector: 12 });
    ok("submitScore keeps the higher best but still awards run XP",
      core.profile.bests.ARM === 420 && core.profile.xp === xpAfterAnswer + 2 * X.AWARDS.runScore);

    // live wiring 3: exam completion through the shell's existing _recordExam seam
    const xpBeforeExam = core.profile.xp;
    shell._recordExam({ mode: "study", pct: 85, correct: 26, total: 30 });
    ok("_recordExam awards exam XP (+pass bonus) for any completed mode",
      core.profile.xp === xpBeforeExam + 100);
    const xpBeforeAbandon = core.profile.xp;
    shell._recordExam({ mode: "sim", pct: 90, correct: 27, total: 30, abandoned: true });
    ok("_recordExam never awards on abandon", core.profile.xp === xpBeforeAbandon);

    // menu strip + the one-shot rank-up moment
    core.profile.xp = 460; core.profile.rankSeen = 0;          // Ensign, never acknowledged
    core.profile.settings.reducedMotion = false;
    shell.showMenu();
    {
      const strip = w.document.querySelector(".sx-rank");
      const nm = w.document.querySelector(".sx-rank-name");
      const fill = strip && strip.querySelector(".sx-rank-bar i");
      const xpLine = w.document.querySelector(".sx-rank-xp");
      ok("menu strip renders rank name + progress bar + XP line",
        !!strip && !!nm && /Ensign/.test(nm.textContent) && !!fill && fill.style.width === "15%"
        && !!xpLine && /460 XP/.test(xpLine.textContent) && /340/.test(xpLine.textContent));
      const toast = w.document.querySelector(".sx-toast.sx-toast-gold");
      ok("rank-up moment: gold toast + pulse class + rankSeen persisted",
        !!toast && /Promoted: Ensign/.test(toast.textContent)
        && strip.classList.contains("sx-rank-up") && core.profile.rankSeen === 2);
      if (toast && toast.parentNode) toast.parentNode.removeChild(toast);
    }
    shell.showMenu();                                          // second entry: already acknowledged
    ok("rank-up fires once (no second toast, no pulse)",
      !w.document.querySelector(".sx-toast.sx-toast-gold")
      && !w.document.querySelector(".sx-rank.sx-rank-up"));

    // reduced motion: same strip + toast, but static (no pulse class)
    core.profile.xp = 900; core.profile.rankSeen = 2;          // Pilot, unacknowledged
    core.profile.settings.reducedMotion = true;
    shell.showMenu();
    {
      const strip = w.document.querySelector(".sx-rank");
      const toast = w.document.querySelector(".sx-toast.sx-toast-gold");
      ok("reduced motion: promotion toast still fires but the strip stays static",
        !!toast && /Promoted: Pilot/.test(toast.textContent) && !!strip && !strip.classList.contains("sx-rank-up"));
      if (toast && toast.parentNode) toast.parentNode.removeChild(toast);
    }
    core.profile.settings.reducedMotion = false;

    // hygiene: unwind the seeded state
    core.profile.xp = 0; core.profile.rankSeen = 0;
    delete core.profile.bests.ARM;
    delete core.profile.mastery[qX.id];
    shell.showMenu();
  }

  // K5. Achievements — cross-game unlocks (v0.53.0 unit 3)
  console.log("\nK5. Achievements (predicates / streaks / one-shot unlocks / Progress panel)");
  {
    const core = SN.core, A = SN.achievements, X = SN.xp;
    ok("achievements API exposed: 12 defs with id/name/desc/icon/xp/check", !!A && Array.isArray(A.LIST) && A.LIST.length === 12
      && A.LIST.every(d => d.id && d.name && d.desc && d.icon && d.xp > 0 && typeof d.check === "function")
      && new Set(A.LIST.map(d => d.id)).size === 12);
    const by = {}; A.LIST.forEach(d => { by[d.id] = d; });

    // pure predicate pins (crafted snapshots — no live state)
    ok("first-contact: fires on the first answered question",
      by["first-contact"].check({ profile: { totals: { questionsSeen: 1 } } }) === true
      && by["first-contact"].check({ profile: { totals: { questionsSeen: 0 } } }) === false);
    ok("hot-streak: any surface at 5; 4 is not enough",
      by["hot-streak"].check({ profile: { streaksBest: { EXAM: 5 } } }) === true
      && by["hot-streak"].check({ profile: { streaksBest: { EXAM: 4, CC: 4, KBB: 4 } } }) === false);
    ok("per-game 10-chains: gate-runner=CC, void-discipline=KBB, deep-strike=ARM (no cross-credit)",
      by["gate-runner"].check({ profile: { streaksBest: { CC: 10 } } }) === true
      && by["gate-runner"].check({ profile: { streaksBest: { ARM: 99, KBB: 99, EXAM: 99, CC: 9 } } }) === false
      && by["void-discipline"].check({ profile: { streaksBest: { KBB: 10 } } }) === true
      && by["deep-strike"].check({ profile: { streaksBest: { ARM: 10 } } }) === true);
    ok("station-restored: unlocks on a recorded ARM campaign best",
      by["station-restored"].check({ profile: { bests: { ARM: 1 } } }) === true
      && by["station-restored"].check({ profile: { bests: {} } }) === false);
    ok("sim-certified: sim >= 80 only (79 no; study 100 no)",
      by["sim-certified"].check({ profile: { examHistory: [{ mode: "sim", pct: 80 }] } }) === true
      && by["sim-certified"].check({ profile: { examHistory: [{ mode: "sim", pct: 79 }] } }) === false
      && by["sim-certified"].check({ profile: { examHistory: [{ mode: "study", pct: 100 }] } }) === false);
    {
      const m49 = {}, m50 = {};
      for (let i = 0; i < 49; i++) m49["q" + i] = { bucket: 0 };
      for (let i = 0; i < 50; i++) m50["q" + i] = { bucket: 0 };
      ok("scholar: 50 distinct questions seen (49 is not enough)",
        by["scholar"].check({ profile: { mastery: m50 } }) === true && by["scholar"].check({ profile: { mastery: m49 } }) === false);
      const m24 = {}, m25 = {};
      for (let i = 0; i < 24; i++) m24["q" + i] = { bucket: 4 };
      for (let i = 0; i < 25; i++) m25["q" + i] = { bucket: 4 };
      ok("first-mastery at bucket>=4; archivist needs 25 mastered",
        by["first-mastery"].check({ profile: { mastery: { a: { bucket: 4 } } } }) === true
        && by["first-mastery"].check({ profile: { mastery: { a: { bucket: 3 } } } }) === false
        && by["archivist"].check({ profile: { mastery: m25 } }) === true
        && by["archivist"].check({ profile: { mastery: m24 } }) === false);
    }
    ok("domain-sweep: every bank domain seen; commander: rank index >= 6 (3300 XP)",
      by["domain-sweep"].check({ profile: {}, stats: { domains: [{ seen: 1 }, { seen: 2 }] } }) === true
      && by["domain-sweep"].check({ profile: {}, stats: { domains: [{ seen: 1 }, { seen: 0 }] } }) === false
      && by["commander"].check({ profile: { xp: 3300 } }) === true
      && by["commander"].check({ profile: { xp: 3299 } }) === false);

    // evaluate(): one-shot unlock + XP award + list-order cascade into commander
    {
      const p = { xp: 3290, rankSeen: 0, totals: { questionsSeen: 1 }, mastery: {}, streaks: {}, streaksBest: {}, achievements: {}, bests: {}, settings: {} };
      const newly = A.evaluate(p);
      ok("evaluate: first-contact (+25) pushes 3290 over 3300 -> commander cascades in the SAME pass",
        newly.length === 2 && newly[0].id === "first-contact" && newly[1].id === "commander"
        && p.xp === 3290 + 25 + 250 && !!p.achievements["first-contact"] && !!p.achievements.commander);
      const again = A.evaluate(p);
      ok("evaluate is idempotent: unlocked ids never re-fire or re-award", again.length === 0 && p.xp === 3565);
    }

    // live wiring: streaks tracked at the mastery choke point, tagged by meta.game
    core.profile.achievements = {}; core.profile.streaks = {}; core.profile.streaksBest = {};
    core.profile.xp = 0; core.profile.rankSeen = 0;
    {
      const qs = core.questions.pool().slice(3, 9);
      const toastsBefore = w.document.querySelectorAll(".sx-toast-gold").length;
      for (let i = 0; i < 5; i++) core.mastery.record(qs[i].id, true, { game: "EXAM" });
      ok("5 tagged corrects -> streaksBest.EXAM = 5 -> hot-streak unlocks live (+ first-contact)",
        core.profile.streaksBest.EXAM === 5 && !!core.profile.achievements["hot-streak"] && !!core.profile.achievements["first-contact"]);
      ok("unlock toast fired through the shell's onUnlock hook (gold)",
        w.document.querySelectorAll(".sx-toast-gold").length > toastsBefore);
      core.mastery.record(qs[5].id, false, { game: "EXAM" });
      ok("a wrong answer resets the current streak but keeps the best",
        core.profile.streaks.EXAM === 0 && core.profile.streaksBest.EXAM === 5);
      // clean the toast residue
      Array.prototype.slice.call(w.document.querySelectorAll(".sx-toast")).forEach(t => t.parentNode && t.parentNode.removeChild(t));
      // unwind these six mastery touches
      qs.forEach(q => { delete core.profile.mastery[q.id]; });
    }

    // live wiring: submitScore -> station-restored; _recordExam -> sim-certified
    await core.persistence.submitScore("ARM", 55, { sector: 12 });
    ok("submitScore unlock: station-restored", !!core.profile.achievements["station-restored"]);
    shell._recordExam({ mode: "sim", pct: 85, correct: 26, total: 30 });
    ok("_recordExam unlock: sim-certified (evaluates AFTER the history write)", !!core.profile.achievements["sim-certified"]);

    // Progress screen panel
    shell.showStats();
    {
      const tiles = w.document.querySelectorAll(".sx-ach-tile");
      const got = w.document.querySelectorAll(".sx-ach-tile.got");
      const unlocked = Object.keys(core.profile.achievements).length;
      const cnt = w.document.querySelector(".sx-ach-count");
      ok("Progress panel: 12 tiles, unlocked ones marked .got, count line matches",
        tiles.length === 12 && got.length === unlocked && !!cnt && cnt.textContent === unlocked + " / 12");
      const gotNames = Array.prototype.map.call(got, t => t.querySelector(".sx-ach-name").textContent);
      ok("unlocked tiles include the live unlocks from this section",
        gotNames.indexOf("Hot streak") >= 0 && gotNames.indexOf("Station restored") >= 0 && gotNames.indexOf("Sim certified") >= 0);
    }
    shell.showMenu();

    // hygiene: unwind the seeded state
    core.profile.achievements = {}; core.profile.streaks = {}; core.profile.streaksBest = {};
    core.profile.xp = 0; core.profile.rankSeen = 0;
    delete core.profile.bests.ARM;
    delete core.profile.examHistory;
  }

  // K6. Daily missions (v0.56.0 unit 6)
  console.log("\nK6. Daily missions (date-seeded / progress wiring / claim / rollover / DOM)");
  {
    const core = SN.core, D = SN.daily;
    // achievements sentinel again — daily records here must not trigger surprise unlock XP
    SN.achievements.LIST.forEach(d => { core.profile.achievements[d.id] = 1; });
    ok("daily API exposed: 6 templates + gen/ensure/state/claim/dayKey", !!D && D.TEMPLATES.length === 6
      && [D.gen, D.ensure, D.state, D.claim, D.dayKey].every(f => typeof f === "function"));
    {
      const a = JSON.stringify(D.gen("2026-07-03")), b = JSON.stringify(D.gen("2026-07-03")), c = JSON.stringify(D.gen("2026-07-04"));
      const day = D.gen("2026-07-03");
      ok("determinism: same date → identical missions; different date → different set", a === b && a !== c);
      ok("a day rolls exactly 3 missions with distinct templates",
        day.length === 3 && new Set(day.map(m => m.tpl)).size === 3 && day.every(m => m.target > 0 && m.xp > 0));
    }
    const realNow = core.clock.now;
    core.clock.now = () => new Date("2026-07-03T12:00:00").getTime();
    delete core.profile.daily;
    core.profile.streaks = {};                                    // fresh streak run for the chain mission
    const xp0 = core.profile.xp;
    D.ensure(core.profile);
    // pinned day: 2026-07-03 rolls [promote:5, sharp:10, chain:3] (asserted, so drift is loud)
    ok("ensure: seeds today's state (date, xpStart, zeroed counters) with the pinned missions",
      core.profile.daily.date === "2026-07-03" && core.profile.daily.xpStart === xp0
      && core.profile.daily.missions.map(m => m.tpl + ":" + m.target).join(",") === "promote:5,sharp:10,chain:3");
    // progress wiring: the mastery choke point feeds correct/byGame/bestStreak/promotions
    const dq = core.questions.pool().slice(10, 14);
    core.mastery.record(dq[0].id, true, { game: "CC" });
    ok("one correct answer ticks correct/byGame/bestStreak/promotions",
      core.profile.daily.correct === 1 && core.profile.daily.byGame.CC === 1
      && core.profile.daily.bestStreak >= 1 && core.profile.daily.promotions === 1);
    shell._recordExam({ mode: "study", pct: 50, correct: 15, total: 30 });
    ok("a completed exam ticks the Examiner counter", core.profile.daily.exams === 1);
    // chain mission (index 2, target 3): two more straight corrects complete it
    core.mastery.record(dq[1].id, true, { game: "CC" });
    core.mastery.record(dq[2].id, true, { game: "CC" });
    const chain = D.state(core.profile, 2);
    ok("chain mission completes at a 3-streak (progress capped at target)",
      !!chain && chain.done && chain.progress === 3 && !chain.claimed);
    ok("claim guard: an incomplete mission pays nothing", D.claim(core.profile, 1) === 0);
    {
      const before = core.profile.xp;
      const got = D.claim(core.profile, 2);
      ok("claiming a done mission pays its XP once (double-claim = 0)",
        got === chain.xp && core.profile.xp === before + chain.xp && D.claim(core.profile, 2) === 0
        && D.state(core.profile, 2).claimed);
    }
    // rollover: a new calendar day regenerates missions and resets counters
    core.clock.now = () => new Date("2026-07-04T12:00:00").getTime();
    core.mastery.record(dq[3].id, true, { game: "ARM" });
    ok("date rollover regenerates the day (new date, counters restart from this answer)",
      core.profile.daily.date === "2026-07-04" && core.profile.daily.correct === 1
      && core.profile.daily.byGame.ARM === 1 && !core.profile.daily.missions[0].claimed);
    // DOM: menu strip + claim flow + Progress-screen row
    core.profile.daily.correct = 99; core.profile.daily.byGame = { ARM: 99, KBB: 99, CC: 99, EXAM: 99 };
    core.profile.daily.bestStreak = 99; core.profile.daily.exams = 99; core.profile.daily.promotions = 99;
    core.profile.xp = core.profile.daily.xpStart + 999;
    shell.showMenu();
    // (v0.60.0 P2·1, PLAYTEST A1/A3) the menu hosts a COMPACT strip: undated head, no goal
    // lines (they live in row tooltips + on Progress); and the menu itself must scroll.
    ok("menu: compact daily strip — undated head + 3 rows, goal text tucked into tooltips",
      /Daily missions/.test((w.document.querySelector(".sx-daily-head") || {}).textContent || "")
      && !/2026-07-04/.test((w.document.querySelector(".sx-daily-head") || {}).textContent || "")
      && w.document.querySelectorAll(".sx-daily-row").length === 3
      && w.document.querySelectorAll(".sx-menu .sx-daily-desc").length === 0
      && (w.document.querySelector(".sx-daily-row").getAttribute("title") || "").length > 0);
    ok("menu: scrolls past the fold (PLAYTEST A1 — the NIT tile must stay reachable)",
      /\.sx-menu\{[^}]*overflow-y:auto/.test((w.document.getElementById("starnix-shell-css") || {}).textContent || ""));
    {
      const claims = w.document.querySelectorAll(".sx-daily-claim");
      ok("menu: every completed unclaimed mission offers a Claim button", claims.length === 3);
      const xpB = core.profile.xp;
      claims[0].click();
      ok("claim click: pays XP, flips the row, survives the re-render, toasts gold",
        core.profile.xp > xpB && w.document.querySelectorAll(".sx-daily-claimed").length === 1
        && w.document.querySelectorAll(".sx-daily-claim").length === 2
        && !!w.document.querySelector(".sx-toast-gold"));
      const t = w.document.querySelector(".sx-toast-gold"); if (t && t.parentNode) t.parentNode.removeChild(t);
    }
    shell.showStats();
    ok("Progress screen: full daily rows (goal lines visible)",
      w.document.querySelectorAll(".sx-daily-stats .sx-daily-row").length === 3
      && w.document.querySelectorAll(".sx-daily-stats .sx-daily-desc").length === 3);
    ok("Progress screen: exactly ONE 'Daily missions' heading (A3 double header gone)",
      [...w.document.querySelectorAll(".sx-dom-head")].filter(h => /Daily missions/.test(h.textContent)).length === 1
      && w.document.querySelectorAll(".sx-daily-stats .sx-daily-head").length === 0);
    shell.showMenu();
    // hygiene
    core.clock.now = realNow;
    delete core.profile.daily;
    dq.forEach(q => { delete core.profile.mastery[q.id]; });
    core.profile.achievements = {}; core.profile.streaks = {}; core.profile.streaksBest = {};
    core.profile.xp = 0; core.profile.rankSeen = 0;
    shell.showMenu();
  }

  // K7. Mastery-gated cosmetics (v0.57.0 unit 7)
  console.log("\nK7. Cosmetics (unlock predicate / picker / persistence / applied in ARM+KBB)");
  {
    const core = SN.core, C = SN.cosmetics;
    SN.achievements.LIST.forEach(d => { core.profile.achievements[d.id] = 1; });   // no surprise unlock XP
    ok("cosmetics API: 6 palette-locked variants + threshold 0.5 + pure helpers",
      !!C && C.LIST.length === 6 && C.THRESHOLD === 0.5 && C.LIST[0].id === "standard" && C.LIST[0].domain === null
      && C.LIST.every(d => /^#[0-9A-F]{6}$/i.test(d.color)) && typeof C.unlocked === "function" && typeof C.resolve === "function");
    {
      const stats = { domains: [{ domain: "storage", masteredPct: 0.5 }, { domain: "vms", masteredPct: 0.49 }] };
      const aqua = C.LIST.find(d => d.id === "aqua-stream"), mantis = C.LIST.find(d => d.id === "mantis-wake");
      ok("unlock predicate: standard always; 0.50 unlocks; 0.49 does not; missing stats locks",
        C.unlocked(C.LIST[0], null) === true && C.unlocked(aqua, stats) === true
        && C.unlocked(mantis, stats) === false && C.unlocked(aqua, null) === false);
      ok("resolve: unlocked pick sticks; locked or unknown falls back to standard",
        C.resolve({ shipTrail: "aqua-stream" }, stats).id === "aqua-stream"
        && C.resolve({ shipTrail: "mantis-wake" }, stats).id === "standard"
        && C.resolve({ shipTrail: "nope" }, stats).id === "standard"
        && C.resolve(null, stats).id === "standard");
    }
    // unlock a REAL domain by mastering half its (smallest) bank slice, then pick it in Settings
    const st0 = core.questions.stats();
    const smallest = st0.domains.slice().sort((a, b) => a.total - b.total)[0];
    const domQs = core.questions.pool().filter(q => q.domain === smallest.domain);
    const need = Math.ceil(domQs.length * 0.5);
    const seededIds = [];
    for (let i = 0; i < need; i++) {
      core.profile.mastery[domQs[i].id] = { id: domQs[i].id, seen: 1, correct: 1, incorrect: 0, streak: 1, bucket: 4, lastSeen: core.clock.now() };
      seededIds.push(domQs[i].id);
    }
    const def = C.LIST.find(d => d.domain === smallest.domain);
    const chosen = def || C.LIST.find(d => d.domain === "storage");   // every LIST domain may not match the smallest — fall back to seeding storage
    if (!def) {
      // seed storage instead so a pickable variant is genuinely unlocked
      seededIds.forEach(id => delete core.profile.mastery[id]); seededIds.length = 0;
      const sQs = core.questions.pool().filter(q => q.domain === "storage");
      for (let i = 0; i < Math.ceil(sQs.length * 0.5); i++) {
        core.profile.mastery[sQs[i].id] = { id: sQs[i].id, seen: 1, correct: 1, incorrect: 0, streak: 1, bucket: 4, lastSeen: core.clock.now() };
        seededIds.push(sQs[i].id);
      }
    }
    ok("a real domain crosses the 50% mastery gate (" + chosen.domain + ")",
      C.unlocked(chosen, core.questions.stats()) === true);
    shell.showSettings();
    {
      const swatches = w.document.querySelectorAll(".sx-trail");
      const lockedN = w.document.querySelectorAll(".sx-trail.locked").length;
      ok("picker: 6 swatches; standard equipped by default; locked variants dimmed with a requirement",
        swatches.length === 6 && !!w.document.querySelector('.sx-trail.on[data-trail="standard"]')
        && lockedN >= 1 && /Master 50% of/.test(w.document.querySelector(".sx-trail.locked .sx-trail-req").textContent));
      const target = w.document.querySelector('.sx-trail[data-trail="' + chosen.id + '"]');
      ok("picker: the newly unlocked variant is selectable", !!target && !target.classList.contains("locked"));
      target.dispatchEvent(new w.Event("click", { bubbles: true }));
      ok("selection persists BOTH the id and the resolved hex",
        core.profile.settings.shipTrail === chosen.id && core.profile.settings.shipTrailColor === chosen.color
        && target.classList.contains("on"));
    }
    // applied in the live games (jsdom mount through the shell)
    shell.showMenu();
    shell.enterGame("ARM");
    await wait(10);
    ok("ARM: the mounted palette carries the trail tint", shell.currentGameRoot.__armTest.palette().trail === chosen.color);
    shell.exitGame();
    shell.enterGame("KBB");
    await wait(10);
    ok("KBB: the mounted view state carries the trail tint", w.KBB._test.state().trailColor === chosen.color);
    shell.exitGame();
    // fallback: with the cosmetic cleared, ARM returns to stock aqua
    delete core.profile.settings.shipTrail; delete core.profile.settings.shipTrailColor;
    shell.enterGame("ARM");
    await wait(10);
    {
      const pal = shell.currentGameRoot.__armTest.palette();
      ok("ARM fallback: no cosmetic -> the thruster stays stock aqua", pal.trail === pal.aqua);
    }
    shell.exitGame();

    // (v0.65.0, Jason's ruling) EARNED FOREVER — pure latch, resolve honor, end-to-end decay
    {
      const p2 = { trailsUnlocked: {} };
      const statsUp = { domains: [{ domain: chosen.domain, masteredPct: 0.6 }] };
      const statsDown = { domains: [{ domain: chosen.domain, masteredPct: 0.1 }] };
      const newly = C.latch(p2, statsUp);
      ok("latch: records + returns the newly earned variant, idempotent on repeat",
        newly.length === 1 && newly[0] === chosen.id && !!p2.trailsUnlocked[chosen.id] && C.latch(p2, statsUp).length === 0);
      ok("earned forever: resolve keeps the pick after mastery DECAYS below threshold; never-earned still falls back",
        C.resolve({ shipTrail: chosen.id }, statsDown, p2).id === chosen.id
        && C.unlocked(chosen, statsDown, p2) === true
        && C.resolve({ shipTrail: chosen.id }, statsDown, null).id === "standard");
    }
    // end-to-end: the earlier showSettings latched the REAL profile; de-seed mastery — still offered
    seededIds.forEach(id => { delete core.profile.mastery[id]; });
    shell.showSettings();
    ok("picker end-to-end: after mastery de-seed the earned variant stays selectable (profile latch)",
      !!core.profile.trailsUnlocked[chosen.id]
      && !w.document.querySelector('.sx-trail[data-trail="' + chosen.id + '"]').classList.contains("locked"));

    // hygiene
    core.profile.trailsUnlocked = {};
    core.profile.achievements = {};
    shell.showMenu();
  }

  // J9 (v0.73.0): the CC Garage — module-side source pins (the engine behavior is cc-run's 38)
  console.log("\nJ9. CC Garage source pins (banking + HUD + panel ship in the build)");
  {
    ok("J9: run-end banking + Garage UI + HUD cell counter are in the build",
      html.includes("prof.ccCells = (prof.ccCells | 0) + banked") && html.includes("cc-garage")
      && html.includes("cc-cells") && html.includes("Garage \\u25B8"));
    ok("J9: upgrades load from the profile into the live sim",
      html.includes("if (prof.ccUpgrades) sim.applyUpgrades(prof.ccUpgrades)"));
  }

  // JB4 (v0.77.0): the CC crash screen says so + surfaces the Garage
  console.log("\nJB4. CC crash screen source pins");
  ok("JB4: game over says SHIP DOWN and auto-opens the Garage",
    html.includes("SHIP DOWN") && html.includes("refit is part of the death loop"));

  // P2·3 (v0.63.0): PLAYTEST A4–A6 cleanup — source pins (layout geometry is jsdom-invisible;
  // the Playwright evidence shots are the visual proof, these guard the regressions).
  console.log("\nP2. PLAYTEST cleanup pins (A4 CC hud row / A5 ARM gear backdrop / A6 KBB full-bleed cine)");
  {
    ok("A4: CC replay chip lives on its own row below the readout",
      html.includes(".cc-replay{pointer-events:auto;position:absolute;top:44px"));
    ok("A5: ARM gear button carries a near-opaque backdrop (world markers read as UNDER it)",
      html.includes("background:rgba(10,10,17,.92)"));
    ok("A6: KBB is-cine spans the full grid (abs-pos grid items resolve inset against their AREA)",
      html.includes("grid-column:1 / -1;grid-row:1 / -1;}"));
  }

  SN.core.audio = realAudio;

  console.log("\nTotal frame errors across all games: " + frameErrors.length);
  console.log("--------------------------------------------------");
  console.log("PASSED " + pass + " / " + (pass + fail));
  if (fail) { console.log("FAILED: " + fails.join(" | ")); process.exit(1); }
  console.log("ALL GREEN");
  process.exit(0);
})().catch((e) => { console.log("\nVERIFY CRASHED:", e && e.stack ? e.stack : e); process.exit(2); });
