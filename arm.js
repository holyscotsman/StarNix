/* =============================================================================
 * arm.js — ARM · Acropolis Rescue Mission  (StarNix GameModule, doc 02)
 *
 * Increment 1: the existing single-sector ARM (project starnix.html), dissected
 * into a contract-compliant module. Gameplay (physics, puzzles, combat, shop,
 * draw code) is ported faithfully; only the contract-mandated changes are made:
 *   - registerGame({id:'ARM', mount(root,ctx), unmount()}) on window.StarNix,
 *     tolerant of load order (queues on window.__StarNixGames if the shell core
 *     hasn't installed registerGame yet).
 *   - mount(root,ctx) builds all DOM inside `root`; unmount() fully cleans up
 *     (cancels RAF, removes every listener, clears every timer, empties root).
 *   - Questions come from ctx.questions; every answer routes through
 *     ctx.mastery.record() and ctx.telemetry.emit().
 *   - Gameplay/learning randomness flows through ctx.rng; only cosmetic effects (screen shake, explosion debris) use Math.random.
 *   - Bullets / enemy-bullets / particles are object-pooled; enemies/asteroids
 *     use swap-pop removal; no per-frame allocation in update/draw.
 *   - No cinematic and no title screen — the shell owns those; ARM starts at
 *     the commander briefing. (Commander portrait is original in-code art.)
 *
 * ---- Integration note for the Core & Integration chat ----------------------
 * Hand the Core chat THIS file only (not mock-core.js / arm-test.html — those
 * are test-only). ARM expects ctx = {
 *   questions: { next({game,domain?,difficultyBand?,excludeIds?,rng}) -> {question,reason},
 *                byId(id), pool(filter?) },           // doc 01 §3
 *   mastery:   { record(id, correct, {game}), get(id), summary() },  // 01 §4
 *   rng:       { next(), int(n), pick(arr), shuffle(arr), fork(salt) }, // 01 §6
 *   audio:     { ensure(), setMusic(on), setSfx(on), sfx(name), playTrack(id) }, // 01 §7
 *   theme:     { colors:{ iris,iris300,iris600,aqua,mantis,peach,gold,... } },   // 01 §8
 *   telemetry: { emit(event) },                       // 01 §10
 *   persistence?: { load(), save(p), submitScore?(game,score,meta) }, // 01 §5 (optional)
 *   settings?: { reducedMotion, extraTime, music, sfx }, // optional; else local
 *   exit?:     () => void,   // optional; ARM calls it to request return to menu
 *   test?:     boolean       // optional; when true ARM does not start its own RAF
 * }
 * SFX names ARM calls: fire, hit, explode, collect, correct, wrong, hyperdrive,
 * click. (01 §7 lists fire/hit/explode/collect/correct/wrong/hyperdrive; ARM
 * also emits 'click' — confirm the extracted engine maps it, else it no-ops.)
 * Load the core/shell before the game modules so registerGame exists.
 * ========================================================================== */
(function () {
  "use strict";

  var TAU = Math.PI * 2;

  /* ---- world constants (verbatim from the proven standalone build) -------- */
  var MAP_W = 3200, MAP_H = 2200, ENTRY_X = 1600, ENTRY_Y = 2060;
  var HOME_W = 2200, HOME_H = 1600, HOME_ENTRY_X = 1100, HOME_ENTRY_Y = 1430;
  var HS_X = 1100, HS_Y = 740, HS_R = 54;          // home station
  var DRAG = 0.7, SHIP_BASE_R = 13;
  // Combat cores (defeat guardians / shatter asteroid) engage from a large danger ring you fly into.
  // Everything else (extracting a cleared core, plain collect, puzzle) is contact — you fly onto it.
  var COMBAT_RING_PAD = 320;   // ~5x the old reach; ring radius ≈ core.r+pad ≈ 346px (viewport is 960 wide)
  var EXTRACT_PAD = 10;        // contact
  var DEFAULT_W = 960, DEFAULT_H = 600;

  /* ---- Station shape: 60 cores across 12 sectors in 3 difficulty tiers ----- */
  /* (v0.96.0, A6, Jason) cadence: TWO standard sectors, then a dreadnought —   */
  /* bosses at 3/6/9/12 (four per campaign, finale still sector 12).            */
  var CORES_PER_SECTOR = 5;
  var SECTORS = 12;                        // 3 tiers x (3 standard + 1 boss)
  var TOTAL = SECTORS * CORES_PER_SECTOR;  // 60-core station target
  var TIER_NAMES = ["Easy", "Medium", "Hard"];
  var ENEMY_HP_BY_TIER = [1, 2, 3];          // guardian/roamer hits-to-kill, by tier
  var ENEMY_SHOT_DMG_BY_TIER = [10, 14, 18]; // enemy-bullet shield damage, by tier (was a flat 10)
  var BOSS_WP_HP_BY_TIER = [6, 9, 12];       // boss weakpoint shots-to-break per shed, by tier
  // (v0.142.0, V1.1 ARM#2) per-dreadnought fight tables — sectors 3/6/9/12 each fly a DIFFERENT
  // warship. wallP = chance the laser is the wall barrage; twin = two beam columns; escortEvery
  // = seconds between escort-drone pairs (0 = none); miss/laser = attack cadence windows;
  // enrage = B4 only, triggers at 3 broken ports (faster weave/vx, tighter cadences).
  var BOSS_PATTERNS = [
    { name: "VANGUARD",    callout: "single-beam batteries \u2014 sidestep the line and pour fire", wallP: 0,   twin: false, escortEvery: 0, missLo: 5,   missHi: 8,   laserLo: 4,   laserHi: 7, enrage: false },
    { name: "BULWARK",     callout: "wall barrages and escort drones \u2014 find the green lane",   wallP: 0.4, twin: false, escortEvery: 9, missLo: 5,   missHi: 8,   laserLo: 4,   laserHi: 7, enrage: false },
    { name: "TEMPEST",     callout: "twin beams and tight seeker salvos \u2014 never stop moving",  wallP: 0.4, twin: true,  escortEvery: 0, missLo: 3.5, missHi: 5.5, laserLo: 3.5, laserHi: 6, enrage: false },
    { name: "ANNIHILATOR", callout: "its whole arsenal \u2014 and it ENRAGES at three broken ports", wallP: 0.4, twin: true,  escortEvery: 8, missLo: 3.5, missHi: 5.5, laserLo: 3.5, laserHi: 6, enrage: true }
  ];
  function bossIdxOf(sec) { return Math.max(0, Math.min(BOSS_PATTERNS.length - 1, Math.floor(sec / 3) - 1)); }
  function tierOf(sec) { return sec <= 4 ? 0 : (sec <= 8 ? 1 : 2); }   // 0 Easy / 1 Medium / 2 Hard
  function isBossSector(sec) { return sec % 3 === 0; }                 // (v0.96.0, A6) 3/6/9/12 — two regulars then a dreadnought

  // Fixed core layout + per-core challenge assignment (from the standalone).
  var LAYOUT = [
    { x: 540, y: 560, kind: "puzzle", type: "simon" },
    { x: 2680, y: 480, kind: "combat", type: "drones", need: 3 },
    { x: 1640, y: 1180, kind: "puzzle", type: "rewire" },
    { x: 560, y: 1760, kind: "puzzle", type: "dials" },
    { x: 2660, y: 1780, kind: "combat", type: "asteroid", hp: 6 },
  ];
  // Puzzle cores draw a type per sector from this pool (seeded), so the campaign varies.
  // S3: 'grid' removed (decided); 'battery' (polarity) + 'vcpu' (even allocation) added.
  // rewire/dials/sort retained pending the keep/cut/retune proposal — timers retuned now,
  // removals gated on Jason's confirmation (see doc 02 §S3 proposal).
  var PUZZLE_TYPES = ["simon", "battery", "vcpu", "rewire", "dials", "sort"];
  // (v0.176.0, V1.1 ARM#6) spec 02 s3D's harder pair, tier-gated: TRACE from T1, DECRYPT from
  // T2 — and T2 sectors draw the HARD half of the roster first, so puzzle difficulty finally
  // has a curve to match combat's.
  var PUZZLE_HARD = ["decrypt", "trace", "rewire", "vcpu"];
  var PUZZLE_EASY = ["dials", "sort", "battery", "simon"];
  var PUZZLE_MIN = 10;            // floor, seconds (S3: was 12 — "timers much quicker overall")
  var PUZZLE_FAIL_DMG = 14;       // shield hit on a breach (timeout); ~1.5 combat hits, recoverable
  var QUESTION_TIMEOUT_DMG = 14;  // (v0.65.0, Jason's QA-A5 ruling) a FIELD core-scan timeout costs shields — the documented timeUp→wrong→damage→gameOver trace is now real. Depot installs stay forgiving (no damage).
  // S3: per-type completion-timer budget (seconds, pre extra-time). Replaces the old
  // per-question x1.5 model (which gave ~37s for EVERY puzzle). Simon is dynamic by sequence
  // length and is armed only AFTER its playback. See doc 02 §timers + the S3 proposal table.
  var PUZZLE_SECS = { battery: 14, vcpu: 20, rewire: 26, dials: 18, sort: 16, trace: 24, decrypt: 32 };   // (v0.176.0, ARM#6)
  function puzzleSecsFor(type, len, extra) {
    var s = (type === "simon") ? (8 + (len || 5) * 2) : (PUZZLE_SECS[type] || 18);
    if (extra) s = Math.round(s * 1.5);
    return Math.max(PUZZLE_MIN, s);
  }

  // Seeded, spaced core positions — regenerated each sector (runRng is re-forked per sector) so the
  // station's layout differs every sector. Rejection-sampled within a margin, kept clear of the ship
  // entry, and spaced so combat danger rings (~346px) never overlap. Deterministic per seed; falls
  // back to the fixed LAYOUT coords if packing fails (it won't at these dims).
  function randomCorePositions(rng) {
    var M = 380, minX = M, maxX = MAP_W - M, minY = M, maxY = MAP_H - M;
    var D2 = 720 * 720, SHIP2 = 460 * 460, pts = [], tries = 0, n = LAYOUT.length, i, k;
    while (pts.length < n && tries++ < 5000) {
      var x = minX + rng.next() * (maxX - minX), y = minY + rng.next() * (maxY - minY);
      var sx = x - ENTRY_X, sy = y - ENTRY_Y; if (sx * sx + sy * sy < SHIP2) continue; // clear the entry point
      var ok = true;
      for (k = 0; k < pts.length; k++) { var dx = x - pts[k].x, dy = y - pts[k].y; if (dx * dx + dy * dy < D2) { ok = false; break; } }
      if (ok) pts.push({ x: Math.round(x), y: Math.round(y) });
    }
    while (pts.length < n) { var L = LAYOUT[pts.length]; pts.push({ x: L.x, y: L.y }); } // deterministic fallback
    return pts;
  }

  // Preferred domain order; ARM uses the first domain present in the bank.
  // Never hardcodes the cert — derived from ctx.questions at mount (pillar 3).
  var DOMAIN_PRIORITY = ["storage", "networking", "security", "vms",
    "architecture", "data-protection", "lifecycle", "monitoring", "performance"];

  var now = (typeof performance !== "undefined" && performance.now)
    ? function () { return performance.now(); }
    : function () { return Date.now(); };

  /* ========================================================================
   * The module. One instance; mount re-initializes, unmount tears down.
   * ====================================================================== */
  function createArm() {
    // ---- injected context + environment ----
    var ctx, root, doc, win, raf, caf;
    // ---- providers (pulled from ctx in mount) ----
    var Q, MAST, AUD, RNG, THEME, TEL, PERS, SET, EXIT, TESTMODE, PERKS = {};
    var runRng;                       // forked per run for determinism
    var COL;                          // palette
    var TRAIL;                        // (v0.57.0 unit 7) resolved ship-trail tint (cosmetic)

    // ---- teardown bookkeeping ----
    var listeners = [];               // {target,type,fn,opts}
    var timers = new Map();           // id -> {fn, fireAt}  (S3: was a Set; Map lets pause() freeze in-flight timeouts)
    var pausedTimers = [];            // S3: timers stashed (with remaining ms) while paused; re-armed on resume
    var rafId = 0, running = false, mounted = false;
    var styleEl = null;

    // ---- DOM refs ----
    var wrap, cv, c2d, banner, gear, stats, steer, action, comms, overlay, panel, toast;
    var sSector, sStation, sCargo, sCoins, sTier, mShield, mCharge;
    var commsPort, commsName, commsMsg, commsSubj, commsDots, commsOpts, commsReplay, commsSig, commsScan, brfScene;
    // (v0.180.0, V1.1 ARM#7) the deferred D4 CRT typing reveal — VISUAL ONLY. commsMsg always
    // holds the FULL text (the A5 pin and briefText() read final text instantly); a sibling
    // layer types the same words at ~34ms/char. TESTMODE and reduced motion render instantly.
    var typeLayer = null, typeForced = false, TYPE_MS = 34;
    var typing = { active: false, shown: 0, total: 0, text: "", timer: -1 };
    var introBar, introCap, introSkipBtn;
    var bannerText = "";

    // ---- game state ----
    var state = "BRIEF", prevState = null;
    var sector = 1, coins = 0;
    var charges, maxCharges, shields, maxShields, shipThrust, shipTurn, rechargeTime, rechargeTimer, bulletSpeed;
    var puzzleLimit = 0, puzzleTimer = 0, puzzleBar = null, puzzleWrap = null, puzzleCore = null, puzzleDoneFlag = false;
    var puzzleTimerHold = false;      // S3: freeze the stability bar during Simon playback (timer starts on the player's turn)
    var activePuzzle = null;          // S3: {type, probe(), tapSolve()} test/inspection seam for the live puzzle
    var lvl = { engine: 0, maneuver: 0, capacitor: 0, shieldCell: 0, rapid: 0 };

    var domain = "storage";
    var cores = [], held = [], stationBuild = 0, challengeLvl = 0, usedIds = [];
    var asteroids = [], enemies = [], stars = [];
    var camX = 0, camY = 0, invuln = 0, roamTimer = 0;
    var shipBank = 0;                 // (v0.44.0 feel) smoothed roll from turn input — banks the hull + counter-rolls the world
    var returnReady = false, deathTimer = 0, regenT = 0;
    var ship = { x: ENTRY_X, y: ENTRY_Y, vx: 0, vy: 0, angle: -Math.PI / 2 };
    var input = { left: false, right: false, thrust: false, down: false, fire: false };

    var warpT = 0, warpBeat = -1, warpDone = null;
    var shakeAmt = 0;                  // S4: boss screen shake (laser fire / death blasts); decays per frame
    var paused = false, pauseStart = 0, pauseClockOffset = 0;   // S3: shell-driven pause (freeze rAF + sim/puzzle/question timers)
    var panicSpawned = false;                                   // S3: full-collection escape gauntlet (fires once per sector)
    var SPR = { hero: null, enemy: null, boss: null, warp: null, dive: null, station: null };  // S3: asset-gated sprites (fallback = in-code vector art). warp = hyperdrive hull; dive = BCM intro-dive enemy; station = intro Acropolis.
    var bossActive = false;                                     // S3: boss-fight seam (sprite wired; encounter is Increment 2 — flagged to Core)
    var boss = null;                                            // S3: boss actor (populated by the boss encounter in a boss sector)
    var bossQueue = [];                                         // Inc2: the 5 cores the boss holds; one is shed per weakpoint break
    var SPRITE_FACE = Math.PI / 2;                              // S3: sprites authored facing "up"; heading 0 = +x, so rotate by angle+this
    var briefCore = -1, briefMode = "TEACH", briefRepeat = 0, briefIntro = "", briefOutro = "", briefOpts = [];
    var introT = 0, introActive = false, introDone = null;   // P6a intro cutscene
    var NEBULA = null;                                        // P6a parallax backdrop blobs
    // (v0.197.0, V1.1 ARM#9) sector identity: per-tier field tints + one seeded landmark.
    var TIER_NEB = [
      ["rgba(120,85,250,0.22)", "rgba(31,221,233,0.16)", "rgba(146,221,35,0.10)", "rgba(255,107,91,0.12)"],   // T0: the shipped iris-cool mix
      ["rgba(31,221,233,0.22)", "rgba(120,85,250,0.14)", "rgba(31,221,233,0.12)", "rgba(146,221,35,0.10)"],   // T1: aqua-teal
      ["rgba(255,107,91,0.20)", "rgba(255,200,87,0.14)", "rgba(120,85,250,0.10)", "rgba(255,107,91,0.14)"]    // T2: ember warning tones
    ];
    var TIER_STARS = ["#cfd2ff", "#c8ecf2", "#f2d8c8"];
    var STAR_COL = TIER_STARS[0];
    var landmark = null;                                      // one per standard sector, far parallax, never a collider
    var dq = [], dqi = 0, dIn = 0, dLost = 0, dCoins = 0;
    var sectorLost = [];              // collect-fails this attempt (commit on home)
    var lostPool = [];                // (v0.131.0, V1.1 ARM#1) run-level resurfacing pool — lost cores COME BACK
    var reducedMotion = false, extraTime = false, musicOn = true, sfxOn = true, highContrast = false;
    var smoothDiff = true;   // (v0.155.0, V1.1 ARM#4) per-sector difficulty blend (02 s3D shape toggle; OFF = classic tier steps)
    var shieldRegenDelay = 4, shieldRegenRate = 18;   // (v0.93.0, A8) Shield Cell upgrades these
    var runSeq = 0;   // (v0.91.0) per-mount run counter: "Fly again"/sector replays draw fresh questions

    // ---- object pools (no per-frame allocation) ----
    var bullets = [], ebullets = [], missiles = [], particles = [];

    // ---- panel interaction handles (also used by the test seam) ----
    var pendingQuestion = null;       // { choose(i), proceed(), correctIndex }
    var pendingPuzzleDone = null;     // idempotent finisher
    var toastT = 0;

    /* ---------------------------------------------------------------------- */
    /* listener / timer helpers                                               */
    /* ---------------------------------------------------------------------- */
    function on(target, type, fn, opts) {
      target.addEventListener(type, fn, opts || false);
      listeners.push({ target: target, type: type, fn: fn, opts: opts || false });
    }
    function offAll() {
      for (var i = 0; i < listeners.length; i++) {
        var l = listeners[i];
        l.target.removeEventListener(l.type, l.fn, l.opts);
      }
      listeners.length = 0;
    }
    function later(fn, ms) {
      if (paused) { pausedTimers.push({ fn: fn, remain: ms }); return -1; }   // S3: defer until resume
      var id = win.setTimeout(function () { timers.delete(id); if (running && !paused) fn(); }, ms);
      timers.set(id, { fn: fn, fireAt: now() + ms });
      return id;
    }
    function clearTimers() {
      timers.forEach(function (rec, id) { win.clearTimeout(id); });
      timers.clear();
      pausedTimers.length = 0;
    }
    // S3 — pause/resume support -------------------------------------------------
    // Freeze every in-flight wall-clock timer: clear it, remember its remaining
    // time, re-schedule on resume. Combined with the gnow() game-clock and the
    // tick()/RAF freeze, this stops ALL game-advancing time (sim, puzzle bar,
    // question countdown, puzzle replay chains) without dropping any callback.
    function pauseTimers() {
      timers.forEach(function (rec, id) {
        win.clearTimeout(id);
        pausedTimers.push({ fn: rec.fn, remain: Math.max(0, rec.fireAt - now()) });
      });
      timers.clear();
    }
    function resumeTimers() {
      var list = pausedTimers; pausedTimers = [];
      for (var i = 0; i < list.length; i++) later(list[i].fn, list[i].remain);
    }
    // Pause-immune monotonic clock for wall-clock-deadline logic (the question
    // countdown). It does not advance while paused, so a frozen question keeps its
    // exact remaining time. RAF dt uses the frame timestamp instead (see loop()).
    function gnow() { return now() - pauseClockOffset - (paused ? (now() - pauseStart) : 0); }

    /* ---------------------------------------------------------------------- */
    /* tiny DOM helpers (textContent for all dynamic text — 05 §2)            */
    /* ---------------------------------------------------------------------- */
    function mk(tag, cls, text) {
      var e = doc.createElement(tag);
      if (cls) e.className = cls;
      if (text != null) e.textContent = text;
      return e;
    }
    function btn(cls, text, onClick) { var b = mk("button", cls, text); on(b, "click", onClick); return b; }
    function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
    function show(el, vis, disp) { el.style.display = vis ? (disp || "block") : "none"; }

    /* ---------------------------------------------------------------------- */
    /* audio passthrough                                                      */
    /* ---------------------------------------------------------------------- */
    var ensured = false;
    function ensureAudio() { if (ensured) return; ensured = true; try { AUD.ensure(); AUD.playTrack("arm"); } catch (e) {} }
    function sectorMusic() {                              // boss sectors get the boss track; tier 2+ layers intensity onto "arm"
      try {
        if (bossActive) AUD.playTrack("boss", { intensity: 1 });
        else AUD.playTrack("arm", { intensity: tierOf(sector) >= 2 ? 1 : 0 });
      } catch (e) {}
    }
    function sfx(name) { if (!sfxOn) return; try { AUD.sfx(name === "warp" ? "hyperdrive" : name); } catch (e) {} }

    /* ---------------------------------------------------------------------- */
    /* S3 — asset-gated sprites (ctx.assets.{armHero,armEnemy,armBoss})       */
    /* Browser-only: each draw path falls back to the in-code vector actor     */
    /* until the image is decoded, so ARM runs identically before assets land. */
    /* Images are created ONCE here (never per-frame). Flagged to Core: confirm */
    /* the ctx.assets key + value shape (src string or preloaded HTMLImage).   */
    /* ---------------------------------------------------------------------- */
    function loadSprite(src) {
      if (!src) return null;
      try {
        if (typeof src === "object" && (src.tagName || src.naturalWidth !== undefined)) return src; // already an image
        if (typeof win === "undefined" || !win || typeof win.Image === "undefined") return null;
        var im = new win.Image(); im.src = src; return im;
      } catch (e) { return null; }
    }
    function initSprites() {
      var A = (ctx && ctx.assets) || {};
      SPR.hero = loadSprite(A.armHero);
      SPR.enemy = loadSprite(A.armEnemy);
      SPR.boss = loadSprite(A.armBoss);
      // (Jason) hyperdrive cinematic hull: prefer a dedicated armWarp sprite, else reuse the shared player ship (ccShip).
      SPR.warp = loadSprite(A.armWarp || A.ccShip);
      SPR.dive = loadSprite(A.armEnemyDive);     // (Jason) BCM enemy used ONLY in the intro dive-to-planet beat
      SPR.planet = loadSprite(A.planet);         // (Jason v0.47.0) the REAL planet image in the dive beat — keep it; gradient is only the fallback
      SPR.station = loadSprite(A.armStation);     // (Jason) intact Acropolis Station, shattered in the intro
    }
    function spriteReady(im) { return !!(im && im.complete && im.naturalWidth > 0); }
    function drawSprite(im, sizePx) {
      // assumes the caller has already translated/rotated into the actor's local frame
      c2d.save(); c2d.rotate(SPRITE_FACE);
      c2d.drawImage(im, -sizePx / 2, -sizePx / 2, sizePx, sizePx);
      c2d.restore();
    }

    /* ---------------------------------------------------------------------- */
    /* mastery / telemetry passthrough (guarded; never throws to gameplay)    */
    /* ---------------------------------------------------------------------- */
    function safeRecord(id, correct, extra) {   // (v0.183.0, Backend#7) extra = {latencyMs, timerPct, reason}
      try {
        var mm = { game: "ARM" };
        if (extra) for (var mk in extra) mm[mk] = extra[mk];
        MAST.record(id, correct, mm);
      } catch (e) {}
    }
    // (v0.71.0, J7/J8) display caps — authored text is NEVER edited; long explanations tuck
    // their tail behind a native <details>, and Vega's comms hard-cap at 120 words (the full
    // authored detail resurfaces in the answer explanation).
    function capWords(t, n) {
      var w = String(t == null ? "" : t).trim().split(/\s+/);
      if (w.length <= n) return { s: String(t == null ? "" : t), rest: null, extra: 0 };
      return { s: w.slice(0, n).join(" "), rest: w.slice(n).join(" "), extra: w.length - n };
    }
    function safeTel(e) { try { if (TEL && TEL.emit) TEL.emit(e); } catch (err) {} }
    function safeBest(score) {
      try { if (PERS && PERS.submitScore) PERS.submitScore("ARM", score, { sector: sector }); } catch (e) {}
    }

    /* ====================================================================== */
    /* MOUNT                                                                  */
    /* ====================================================================== */
    function mount(_root, _ctx) {
      root = _root; ctx = _ctx || {};
      doc = root.ownerDocument; win = doc.defaultView || (typeof window !== "undefined" ? window : null);
      raf = win && win.requestAnimationFrame ? win.requestAnimationFrame.bind(win) : null;
      caf = win && win.cancelAnimationFrame ? win.cancelAnimationFrame.bind(win) : null;

      Q = ctx.questions; MAST = ctx.mastery; AUD = ctx.audio || noopAudio();
      RNG = ctx.rng; THEME = ctx.theme || {}; TEL = ctx.telemetry; PERS = ctx.persistence;
      SET = ctx.settings || {}; EXIT = ctx.exit; TESTMODE = !!ctx.test; PERKS = ctx.perks || {};   // (v0.179.0, Flow#7)
      runRng = RNG.fork("arm-boot");   // valid before newRun re-forks per run
      paused = false; pauseStart = 0; pauseClockOffset = 0; pausedTimers.length = 0;
      initSprites();                   // S3: asset-gated ship sprites (no-op + vector fallback if absent)

      highContrast = !!SET.colorblind;             // #12 P2: high-contrast canvas + DOM palette
      COL = paletteFrom(THEME, highContrast);
      TRAIL = SET.shipTrailColor || COL.aqua;      // (v0.57.0 unit 7) mastery cosmetic: shell-resolved hex, falls back to the stock aqua
      reducedMotion = !!SET.reducedMotion; extraTime = !!SET.extraTime;
      smoothDiff = SET.armSmoothDiff !== false;   // (v0.155.0, ARM#4) default ON
      // (v0.106.0, G2) Resume: restore the checkpoint and open at that sector's briefing
      if (ctx.resumeData && ctx.resumeData.sector) {
        var rz = ctx.resumeData;
        sector = rz.sector; coins = rz.coins | 0; stationBuild = rz.stationBuild | 0;
        if (rz.lvl) for (var rk2 in lvl) { if (Object.prototype.hasOwnProperty.call(rz.lvl, rk2)) lvl[rk2] = rz.lvl[rk2] | 0; }
        if (rz.usedIds && rz.usedIds.length) usedIds = rz.usedIds.slice();
        if (rz.lostIds && rz.lostIds.length && ctx.questions && ctx.questions.byId) {   // (ARM#1) the pool survives resume
          lostPool = [];
          for (var rl = 0; rl < rz.lostIds.length; rl++) { var rq2 = ctx.questions.byId(rz.lostIds[rl]); if (rq2) lostPool.push(rq2); }
        }
        deriveStats(); resumePending = true;
      }
      musicOn = SET.music !== false; sfxOn = SET.sfx !== false;

      domain = pickDomain();

      buildStyle();
      buildDom();
      initPools();
      bindGlobalInput();

      mounted = true; running = true;
      newRun();                       // -> BRIEF
      ensureAudio();                  // shell mounts ARM on a user gesture

      attachTestApi();

      if (raf && !TESTMODE) { rafId = raf(loop); }
      return;
    }

    /* ====================================================================== */
    /* UNMOUNT — must leave zero residue                                      */
    /* ====================================================================== */
    function unmount() {
      running = false; mounted = false;
      if (caf && rafId) caf(rafId);
      rafId = 0;
      clearTimers();
      offAll();
      try { delete root.__armTest; } catch (e) { root.__armTest = undefined; }
      if (styleEl && styleEl.parentNode) styleEl.parentNode.removeChild(styleEl);
      styleEl = null;
      if (root) clear(root);
      // drop large references
      cores = []; held = []; enemies = []; asteroids = []; stars = [];
      bullets = []; ebullets = []; particles = [];
      pendingQuestion = null; pendingPuzzleDone = null;
    }

    /* ====================================================================== */
    /* PAUSE / RESUME — shell-driven (e.g. menu overlay). Freezes the RAF +    */
    /* every wall-clock timer + the game/question clocks; resume re-arms all.  */
    /* Flagged to Core: GameModule contract §9a.3 should add pause()/resume()  */
    /* (exposure convention assumed = module-object methods).                  */
    /* ====================================================================== */
    function pause() {
      if (!mounted || paused) return;
      paused = true; pauseStart = now();
      if (caf && rafId) caf(rafId); rafId = 0;   // stop the render/sim loop
      pauseTimers();                              // stash + clear in-flight timers (re-armed on resume)
    }
    function resume() {
      if (!mounted || !paused) return;
      pauseClockOffset += now() - pauseStart;     // keep gnow() frozen across the paused gap
      paused = false;
      resumeTimers();                             // re-arm stashed timers with their remaining time
      lastTs = 0;                                 // avoid a giant dt on the first resumed frame
      if (raf && !TESTMODE && !rafId) rafId = raf(loop);
    }

    /* ---------------------------------------------------------------------- */
    /* palette / domain selection                                             */
    /* ---------------------------------------------------------------------- */
    function paletteFrom(theme, hc) {
      // #12 P2: high-contrast variant pulls from theme.contrast (brighter actors/text, far
      // brighter border). Base (hc=false) is byte-identical to before, plus a new `border` key.
      var c = (hc && theme && theme.contrast) || (theme && theme.colors) || {};
      var d = hc
        ? { space: "#000000", panel2: "#28283c", iris: "#8b6bff", iris300: "#c4b8ff", aqua: "#3DE7F2", green: "#A6EE3C", peach: "#FF8473", gold: "#FFD479", text: "#FFFFFF", mid: "#cfd2ec", dim: "#b0b4d2", border: "#9aa0e0" }
        : { space: "#07070e", panel2: "#1d1d29", iris: "#7855FA", iris300: "#AC9BFD", aqua: "#1FDDE9", green: "#92DD23", peach: "#FF6B5B", gold: "#FFC857", text: "#F2F2F7", mid: "#9a9aad", dim: "#6d6d80", border: "#34344a" };
      return {
        space: c.space || d.space, panel2: c.panel2 || d.panel2,
        iris: c.iris || d.iris, iris300: c.iris300 || d.iris300, iris600: c.iris600 || "#6D40E6",
        aqua: c.aqua || d.aqua, green: c.mantis || d.green,
        peach: c.peach || d.peach, gold: c.gold || d.gold,
        text: c.white || d.text, mid: d.mid, dim: d.dim, border: d.border,
      };
    }
    function pickDomain() {
      // first priority domain that has at least CORES_PER_SECTOR questions,
      // else any domain present, else just the first in the pool.
      var pool;
      try { pool = Q.pool(); } catch (e) { pool = []; }
      var counts = {};
      for (var i = 0; i < pool.length; i++) counts[pool[i].domain] = (counts[pool[i].domain] || 0) + 1;
      for (var d = 0; d < DOMAIN_PRIORITY.length; d++) {
        if ((counts[DOMAIN_PRIORITY[d]] || 0) >= CORES_PER_SECTOR) return DOMAIN_PRIORITY[d];
      }
      for (var d2 = 0; d2 < DOMAIN_PRIORITY.length; d2++) {
        if (counts[DOMAIN_PRIORITY[d2]]) return DOMAIN_PRIORITY[d2];
      }
      return (pool[0] && pool[0].domain) || "storage";
    }

    /* ---------------------------------------------------------------------- */
    /* CSS (static; injected; removed on unmount)                             */
    /* ---------------------------------------------------------------------- */
    function buildStyle() {
      styleEl = doc.createElement("style");
      styleEl.setAttribute("data-arm", "1");
      var css = CSS(COL) + [
        ".arm-introbar{position:absolute;inset:0;pointer-events:none;z-index:30;}",
        ".arm-introcap{position:absolute;left:50%;bottom:7%;transform:translateX(-50%);width:88%;max-width:560px;text-align:center;",
        "font-family:Montserrat,Arial,sans-serif;font-weight:600;font-size:15px;color:#eef;text-shadow:0 0 12px #000,0 2px 6px #000;}",
        ".arm-introskip{position:absolute;top:14px;right:14px;pointer-events:auto;background:rgba(14,14,24,.72);border:1px solid #34344a;",
        "color:#9a9aad;border-radius:10px;padding:7px 14px;font-family:Montserrat,Arial,sans-serif;font-weight:700;font-size:12px;cursor:pointer;}",
        ".arm-introskip:hover{border-color:" + COL.aqua + ";color:#fff;}",
        ".arm-comms-replay{background:none;border:1px solid #34344a;color:#9a9aad;border-radius:7px;",
        "padding:3px 9px;font-family:Montserrat,Arial,sans-serif;font-size:11px;cursor:pointer;margin-right:8px;}",
        ".arm-comms-replay:hover{border-color:" + COL.iris + ";color:#fff;}"
      ].join("");
      // #12 P2: in high contrast, flip the CSS literals that bypass the palette (borders + secondary
      // grey) so the DOM HUD matches the brighter canvas. Base mode leaves the CSS byte-identical.
      if (highContrast) css = css.replace(/#34344a/g, COL.border).replace(/#33334a/g, COL.border).replace(/#9a9aad/g, COL.mid);
      styleEl.textContent = css;
      (doc.head || doc.documentElement).appendChild(styleEl);
    }

    /* ---------------------------------------------------------------------- */
    /* DOM skeleton (scoped to root)                                          */
    /* ---------------------------------------------------------------------- */
    function buildDom() {
      clear(root);
      wrap = mk("div", "arm-wrap" + (reducedMotion ? " arm-reduce" : "")); root.appendChild(wrap);
      cv = mk("canvas", "arm-canvas"); wrap.appendChild(cv);
      c2d = cv.getContext ? cv.getContext("2d") : null;

      // (v0.111.0, D3 — "Cockpit-lite", ARM Flight Proposals #1b, CHOSEN) canopy vignette:
      // pure dressing, pointer-events none; skipped in high-contrast mode for readability.
      if (!highContrast) wrap.appendChild(mk("div", "arm-vignette"));
      banner = mk("div", "arm-banner"); wrap.appendChild(banner);
      gear = btn("arm-gear", "⚙ Menu", function () { ensureAudio(); sfx("click"); showSettings(); }); wrap.appendChild(gear);

      // (v0.111.0, D3) the 7-row stats panel becomes the compact left status rail:
      // icon rows (shield / charge / coins), divider, then the sector text block.
      stats = mk("div", "arm-stats arm-rail");
      var rShield = mk("div", "arm-rrow"); rShield.title = "Shields";
      rShield.appendChild(mk("span", "arm-ric", "\u26E8"));
      var mS = mk("span", "arm-meter arm-m-shield"); mShield = mk("i"); mShield.style.width = "100%"; mS.appendChild(mShield); rShield.appendChild(mS);
      stats.appendChild(rShield);
      var rCharge = mk("div", "arm-rrow"); rCharge.title = "Fire charge";
      rCharge.appendChild(mk("span", "arm-ric gold", "\u26A1"));
      var mA = mk("span", "arm-meter arm-m-ammo"); mCharge = mk("i"); mCharge.style.width = "100%"; mA.appendChild(mCharge); rCharge.appendChild(mA);
      stats.appendChild(rCharge);
      var rCoins = mk("div", "arm-rrow"); rCoins.title = "Coins";
      rCoins.appendChild(mk("span", "arm-ric gold", "\u25CE"));
      rCoins.appendChild(sCoins = mk("b", "gold", "0"));
      stats.appendChild(rCoins);
      stats.appendChild(mk("div", "arm-rdiv"));
      var rTxt = mk("div", "arm-rtext");
      var l1 = mk("div"); l1.appendChild(mk("span", null, "Sector ")); l1.appendChild(sSector = mk("b", null, "1/" + SECTORS)); rTxt.appendChild(l1);
      var l2 = mk("div"); l2.appendChild(mk("span", null, "Cargo ")); l2.appendChild(sCargo = mk("b", null, "0/" + CORES_PER_SECTOR)); rTxt.appendChild(l2);
      var l3 = mk("div"); l3.appendChild(mk("span", null, "Station ")); l3.appendChild(sStation = mk("b", null, "0/" + TOTAL)); rTxt.appendChild(l3);
      sTier = mk("b", null, TIER_NAMES[0]); sTier.style.display = "none"; rTxt.appendChild(sTier);   // tier folds into the sector tooltip
      l1.title = "Difficulty tier: " + TIER_NAMES[0];
      stats.appendChild(rTxt);
      wrap.appendChild(stats);

      steer = mk("div", "arm-steer");
      steer.appendChild(keyBtn("left", "⟲"));
      steer.appendChild(keyBtn("thrust", "▲"));
      steer.appendChild(keyBtn("right", "⟳"));
      wrap.appendChild(steer);

      action = mk("div", "arm-action", "FIRE");
      bindAction(action);
      wrap.appendChild(action);

      // (v0.112.0, D4 — "Center console", ARM Briefing Proposals #1a, CHOSEN) the briefing
      // becomes a place: canopy view up top, hardware dash below, Vega on a dash-mounted CRT.
      // The existing comms element (with its pinned .arm-comms-key/-why content classes and
      // 1:1 briefOpts keys) becomes the CRT screen; everything around it is set dressing.
      brfScene = mk("div", "arm-brfscene");
      var brfCanopy = mk("div", "arm-brf-canopy");
      var stArt2 = (win.STARNIX_ASSETS && win.STARNIX_ASSETS.armStation) || null;
      brfCanopy.innerHTML =
        (stArt2 ? '<div class="arm-brf-station">' +
          '<i class="bsh a" style="background-image:url(' + "'" + stArt2 + "'" + ')"></i>' +
          '<i class="bsh b" style="background-image:url(' + "'" + stArt2 + "'" + ')"></i>' +
          '<i class="bsh c" style="background-image:url(' + "'" + stArt2 + "'" + ')"></i>' +
          '<i class="bsh d" style="background-image:url(' + "'" + stArt2 + "'" + ')"></i>' +
          '<i class="bem"></i></div>' : '') +
        '<span class="arm-brf-hex bh1">\u2B21</span><span class="arm-brf-hex bh2">\u2B21</span><span class="arm-brf-hex bh3">\u2B21</span>' +
        '<div class="arm-brf-strut sl"></div><div class="arm-brf-strut sr"></div>';
      brfScene.appendChild(brfCanopy);
      var brfDash = mk("div", "arm-brf-dash");
      brfDash.innerHTML =
        '<i class="arm-screw s1"></i><i class="arm-screw s2"></i><i class="arm-screw s3"></i><i class="arm-screw s4"></i>' +
        '<div class="arm-brf-cluster left">' +
          '<div class="arm-brf-lbl">CORE MANIFEST</div><div class="arm-brf-hexes"></div>' +
          '<div class="arm-brf-info"></div>' +
          '<div class="arm-brf-hw">' +
            '<div class="arm-thr"><span>THR</span><i class="track"><b class="fill"></b><b class="grip"></b></i><span class="ro">68</span></div>' +
            '<div class="arm-togs"><i class="tog on" title="COMS"></i><i class="tog on" title="NAV"></i><i class="tog" title="AUX"></i><i class="tog guard" title="JETT"></i></div>' +
            '<div class="arm-leds"><i class="g"></i><i class="g"></i><i class="y bl"></i><i></i></div>' +
          '</div></div>' +
        '<div class="arm-brf-cluster right">' +
          '<div class="arm-brf-lbl">COMMS LINK</div>' +
          '<div class="arm-wave"><b></b><b></b><b></b><b></b><b></b><b></b></div>' +
          '<div class="arm-brf-link">Link 98% \u00b7 Relay Kuiper-7</div>' +
          '<div class="arm-brf-log">01:58 uplink handshake ok<br>02:04 crypt key rotated<br><span>02:16 briefing stream open \u258e</span></div>' +
          '<div class="arm-brf-hw"><svg class="arm-gauge" viewBox="0 0 64 34"><path d="M6 30 A26 26 0 0 1 58 30" fill="none" stroke="rgba(255,255,255,.1)" stroke-width="5"/><path d="M6 30 A26 26 0 0 1 40 6" fill="none" stroke="#1FDDE9" stroke-width="5"/><line x1="32" y1="30" x2="46" y2="12" stroke="#fff" stroke-width="2"/><circle cx="32" cy="30" r="3" fill="#fff"/></svg>' +
          '<i class="arm-knob" style="--rot:38deg" title="GAIN"></i><i class="arm-knob gold" style="--rot:-64deg" title="FREQ"></i></div></div>';
      brfScene.appendChild(brfDash);
      wrap.appendChild(brfScene);
      comms = mk("div", "arm-comms");
      var top = mk("div", "arm-comms-top");
      commsPort = mk("div", "arm-comms-port");
      var who = mk("div", "arm-comms-who", "Incoming transmission");
      commsName = mk("b", null, "Cmdr. Vega"); who.appendChild(commsName);
      commsSig = mk("div", "arm-comms-sig");
      commsSig.innerHTML = '<span class="arm-sig-bars"><b></b><b></b><b></b><b></b></span><span class="arm-sig-rec">\u25CF LIVE</span>';
      top.appendChild(commsPort); top.appendChild(who); top.appendChild(commsSig); comms.appendChild(top);
      commsSubj = mk("div", "arm-comms-subj", ""); comms.appendChild(commsSubj);
      commsMsg = mk("div", "arm-comms-msg"); comms.appendChild(commsMsg);
      typeLayer = mk("div", "arm-comms-type"); comms.appendChild(typeLayer);   // (v0.180.0, ARM#7)
      on(comms, "click", function () { if (typing.active && !paused) skipReveal(); });   // any click in the bezel skips
      var ctl = mk("div", "arm-comms-ctl");
      commsDots = mk("div", "arm-comms-dots"); ctl.appendChild(commsDots);
      commsReplay = btn("arm-comms-replay", "\u21BB intro", function () { ensureAudio(); sfx("click"); playIntro(showBriefing); });
      ctl.appendChild(commsReplay); comms.appendChild(ctl);
      commsOpts = mk("div", "arm-comms-opts"); comms.appendChild(commsOpts);
      commsScan = mk("div", "arm-comms-scan"); comms.appendChild(commsScan);   // CRT scanline overlay (pointer-events none)
      wrap.appendChild(comms);

      overlay = mk("div", "arm-overlay");
      panel = mk("div", "arm-panel"); overlay.appendChild(panel);
      wrap.appendChild(overlay);

      toast = mk("div", "arm-toast"); wrap.appendChild(toast);

      // P6a intro cutscene overlay (skip + caption), shown only in INTRO state
      introBar = mk("div", "arm-introbar");
      introCap = mk("div", "arm-introcap");
      introSkipBtn = btn("arm-introskip", "Skip \u25B8", function () { ensureAudio(); sfx("click"); endIntro(); });
      introBar.appendChild(introCap); introBar.appendChild(introSkipBtn);
      wrap.appendChild(introBar); show(introBar, false);

      commsPort.innerHTML = PORTRAIT + '<i class="arm-port-sweep"></i><i class="arm-port-scan"></i>';  // static art + transmission overlays
      resize();
      on(win, "resize", resize);
      on(win, "keydown", function (eK) {   // (v0.112.0, D4) console keys 1/2/3 in the briefing
        if (state !== "BRIEF" || paused) return;   // (v0.116.0, R1) console keys freeze under the pause overlay
        var kn = eK.key === "1" ? 0 : eK.key === "2" ? 1 : eK.key === "3" ? 2 : -1;
        if (kn < 0) return;
        if (typing.active) { eK.preventDefault(); skipReveal(); return; }   // (v0.180.0, ARM#7) first key completes the reveal
        var btns = commsOpts ? commsOpts.querySelectorAll("button") : [];
        if (btns[kn]) { eK.preventDefault(); btns[kn].click(); }
      });
    }
    function srow(label, valEl) {
      var r = mk("div", "arm-srow"); r.appendChild(mk("span", null, label)); r.appendChild(valEl); return r;
    }
    function keyBtn(k, glyph) {
      var b = mk("div", "arm-key" + (k === "thrust" ? " thrust" : ""), glyph);
      var onDown = function (e) { e.preventDefault(); ensureAudio(); input[k] = true; };
      var onUp = function (e) { e.preventDefault(); input[k] = false; };
      on(b, "pointerdown", onDown); on(b, "pointerup", onUp);
      on(b, "pointerleave", onUp); on(b, "pointercancel", onUp);
      return b;
    }
    function bindAction(el) {
      var onDown = function (e) { e.preventDefault(); ensureAudio(); if (returnReady) engageReturn(); else input.fire = true; };
      var onUp = function (e) { e.preventDefault(); input.fire = false; };
      on(el, "pointerdown", onDown); on(el, "pointerup", onUp);
      on(el, "pointerleave", onUp); on(el, "pointercancel", onUp);
    }
    function bindGlobalInput() {
      var km = { ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right", ArrowUp: "thrust", KeyW: "thrust", ArrowDown: "down", KeyS: "down" };
      on(win, "keydown", function (e) {
        if (state === "SECTOR" || state === "HOME") {
          if (km[e.code]) { input[km[e.code]] = true; e.preventDefault(); }
          else if (e.code === "Space") { e.preventDefault(); if (returnReady && state === "SECTOR") engageReturn(); else input.fire = true; }
        }
      });
      on(win, "keyup", function (e) {
        if (km[e.code]) input[km[e.code]] = false;
        if (e.code === "Space") input.fire = false;
      });
    }

    /* ---------------------------------------------------------------------- */
    /* sizing                                                                 */
    /* ---------------------------------------------------------------------- */
    var W = DEFAULT_W, H = DEFAULT_H, dpr = 1;
    function resize() {
      dpr = Math.min((win && win.devicePixelRatio) || 1, 2);
      W = wrap.clientWidth || DEFAULT_W; H = wrap.clientHeight || DEFAULT_H;
      cv.width = W * dpr; cv.height = H * dpr;
      if (c2d) c2d.setTransform(dpr, 0, 0, dpr, 0, 0);
      makeStars();
    }
    function makeStars() {
      stars.length = 0;
      var n = Math.round(MAP_W * MAP_H / 14000);
      for (var i = 0; i < n; i++) {
        // (v0.44.0 feel) four depth layers: far 0.25 / mid 0.5 / near 0.8 / FOREGROUND 1.25 (drawn over the ship).
        var r = runRng.next(), d = r < 0.35 ? 0.25 : (r < 0.65 ? 0.5 : (r < 0.9 ? 0.8 : 1.25));
        stars.push({ x: runRng.next() * MAP_W, y: runRng.next() * MAP_H, a: (runRng.next() * 0.6 + 0.2) * (0.45 + 0.55 * Math.min(d, 1)), s: (runRng.next() * 1.5 + 0.4) * (0.55 + 0.6 * Math.min(d, 1.1)), t: runRng.next() * TAU, d: d });
      }
      // P6a: a few soft parallax nebula blobs for depth (gradients cached lazily)
      var cols = ["rgba(120,85,250,0.22)", "rgba(31,221,233,0.16)", "rgba(146,221,35,0.10)", "rgba(255,107,91,0.12)"];
      NEBULA = [];
      for (i = 0; i < 4; i++) {
        NEBULA.push({ fx: runRng.next() * 1.1 - 0.05, fy: runRng.next() * 1.1 - 0.05, r: 160 + runRng.next() * 220, c0: cols[i % cols.length], a: 0.5 + runRng.next() * 0.4, p: 0.12 + runRng.next() * 0.22, grad: null });
      }
    }

    /* ---------------------------------------------------------------------- */
    /* deterministic helpers (all randomness via runRng)                      */
    /* ---------------------------------------------------------------------- */
    function rnd(a, b) { return a + runRng.next() * (b - a); }
    function rint(n) { return runRng.int(n); }
    function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
    function dist2(ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return Math.sqrt(dx * dx + dy * dy); }

    /* ---------------------------------------------------------------------- */
    /* pools                                                                  */
    /* ---------------------------------------------------------------------- */
    function initPools() {
      bullets.length = 0; ebullets.length = 0; particles.length = 0; missiles.length = 0;
      var i;
      for (i = 0; i < 64; i++) bullets.push({ active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0 });
      for (i = 0; i < 96; i++) ebullets.push({ active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0 });
      for (i = 0; i < 16; i++) missiles.push({ active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, ang: 0 });   // (v0.97.0, A10) seekers
      for (i = 0; i < 320; i++) particles.push({ active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, col: "#fff", sz: 1 });
    }
    function spawnBullet(x, y, vx, vy, life) {
      for (var i = 0; i < bullets.length; i++) { var b = bullets[i]; if (!b.active) { b.active = true; b.x = x; b.y = y; b.vx = vx; b.vy = vy; b.life = life; return b; } }
      return null;
    }
    function spawnEBullet(x, y, vx, vy, life) {
      for (var i = 0; i < ebullets.length; i++) { var b = ebullets[i]; if (!b.active) { b.active = true; b.x = x; b.y = y; b.vx = vx; b.vy = vy; b.life = life; return b; } }
      return null;
    }
    function spawnParticle(x, y, vx, vy, life, col, sz) {
      for (var i = 0; i < particles.length; i++) { var p = particles[i]; if (!p.active) { p.active = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.life = life; p.col = col; p.sz = sz; return p; } }
      return null;
    }
    function clearProjectiles() {
      var i;
      for (i = 0; i < bullets.length; i++) bullets[i].active = false;
      for (i = 0; i < ebullets.length; i++) ebullets[i].active = false;
      for (i = 0; i < missiles.length; i++) missiles[i].active = false;
    }
    function clearParticles() { for (var i = 0; i < particles.length; i++) particles[i].active = false; }
    function burst(x, y, col, n) {
      if (reducedMotion) n = Math.ceil(n * 0.5);
      for (var i = 0; i < n; i++) { var a = runRng.next() * TAU, sp = rnd(40, 200); spawnParticle(x, y, Math.cos(a) * sp, Math.sin(a) * sp, rnd(0.4, 0.9), col, rnd(1.5, 3.5)); }
    }

    /* ---------------------------------------------------------------------- */
    /* derived stats / ship                                                   */
    /* ---------------------------------------------------------------------- */
    function shipR() { return SHIP_BASE_R + held.length * 5; }
    function deriveStats() {
      // (v0.96.0, A6) 8 tiers per item at HALF the per-tier effect (same endpoint as the
      // old 4-tier curve, twice the climb). Capacitor exempt per Jason: still +1/tier.
      shipThrust = 300 * Math.pow(1.06, lvl.engine);
      shipTurn = 3.2 * Math.pow(1.05, lvl.maneuver);
      maxCharges = 1 + lvl.capacitor;                       // start 1; Capacitor adds burst capacity (exempt)
      maxShields = 100;                                     // (v0.93.0, A8) capacity is fixed — Shield Cell now buys RECHARGE
      shieldRegenDelay = 4 * Math.pow(0.91, lvl.shieldCell);
      shieldRegenRate = 18 * Math.pow(1.09, lvl.shieldCell);
      rechargeTime = 0.45 * Math.pow(0.93, lvl.rapid);      // seconds per charge; Rapid Fire shortens it
      bulletSpeed = 540;
      if (charges === undefined) { charges = maxCharges; rechargeTimer = rechargeTime; }
      if (shields === undefined) shields = maxShields;
      if (charges > maxCharges) charges = maxCharges;
      if (shields > maxShields) shields = maxShields;
    }

    /* ---------------------------------------------------------------------- */
    /* state / HUD                                                            */
    /* ---------------------------------------------------------------------- */
    function setState(s) {
      state = s;
      var flying = (s === "SECTOR" || s === "HOME");
      show(steer, flying, "flex");
      show(action, s === "SECTOR", "flex");
      show(stats, flying || s === "PUZZLE" || s === "QUESTION" || s === "DEPOT_Q", "flex");
      show(banner, flying && !!bannerText);
      show(overlay, s === "QUESTION" || s === "PUZZLE" || s === "DEPOT_Q" || s === "DEPOT_SUM" || s === "SHOP" || s === "SETTINGS" || s === "GAMEOVER" || s === "SECTORCLEAR", "flex");
      show(comms, s === "BRIEF");
      show(brfScene, s === "BRIEF");   // (v0.112.0, D4) the cockpit scene frames the CRT
      show(gear, s === "SECTOR" || s === "HOME" || s === "BRIEF" || s === "SECTORCLEAR");
      if (introBar) show(introBar, s === "INTRO");
    }
    function hud() {
      sSector.textContent = sector + "/" + SECTORS;
      sTier.textContent = TIER_NAMES[tierOf(sector)];
      sStation.textContent = stationBuild + "/" + TOTAL;
      sCargo.textContent = held.length + "/" + CORES_PER_SECTOR;
      sCoins.textContent = coins;
      mShield.style.width = clamp(shields / maxShields * 100, 0, 100) + "%";
      // (v0.93.0, A9, Jason) the bar answers ONE question: can I fire? Full = ready,
      // filling = the next shot charging. (The old math averaged all capacitor slots.)
      var chargeFrac = charges >= 1 ? 1 : (1 - rechargeTimer / rechargeTime);
      mCharge.style.width = clamp(chargeFrac * 100, 0, 100) + "%";
    }
    function showToast(m) {
      toast.textContent = m; toast.style.opacity = "1";
      win.clearTimeout(toastT); timers.delete(toastT);
      toastT = later(function () { toast.style.opacity = "0"; }, 1900);
    }
    function setBanner(m) {
      bannerText = m || ""; banner.textContent = bannerText;
      if (banner) banner.classList.toggle("boss", !!bossActive);   // (v0.123.0, Jason) boss banner -> bottom, off the dreadnought
      show(banner, (state === "SECTOR" || state === "HOME") && !!bannerText);
    }
    function conceptTag(core) {
      var q = core.q;
      var t = (q.tags && q.tags[1]) ? q.tags[1] : q.domain;
      return String(t).replace(/-/g, " ");
    }

    /* ---------------------------------------------------------------------- */
    /* sector setup                                                           */
    /* ---------------------------------------------------------------------- */
    // (v0.131.0, V1.1 ARM#1) lost cores resurface: field losses + depot fails join a run-level
    // pool (deduped, capped) and later sectors re-serve them FIRST, marked as recovered cores.
    // This is the Leitner promise — missed material comes back — inside the campaign itself.
    function commitLost() {
      for (var li = 0; li < sectorLost.length; li++) {
        var lq = sectorLost[li], dup = false;
        for (var lj = 0; lj < lostPool.length; lj++) if (lostPool[lj].id === lq.id) { dup = true; break; }
        if (!dup) lostPool.push(lq);
      }
      if (lostPool.length > 12) lostPool = lostPool.slice(lostPool.length - 12);
      sectorLost = [];
    }
    function drawCoreQuestions() {
      // one question per core, distinct across the WHOLE run (usedIds persists between sectors).
      // No domain filter: a single domain has too few questions for multi-sector no-reuse.
      cores = []; bossQueue = []; bossActive = isBossSector(sector);   // boss sectors (3/6/9/12): the boss holds the cores
      var ptypes = puzzleRosterFor(tierOf(sector)), pj = 0;   // (v0.176.0, ARM#6) tier-gated per-sector order (runRng is forked per sector)
      var pos = randomCorePositions(runRng);                      // seeded core positions, regenerated each sector
      commitLost();                                              // harvest any stragglers (defensive: nextSector path)
      var recoveredN = 0;
      for (var i = 0; i < LAYOUT.length; i++) {
        var L = LAYOUT[i];
        var q, recovered = false;
        if (!bossActive && recoveredN < 2 && lostPool.length) {   // (ARM#1) re-serve up to 2 lost cores per standard sector
          q = lostPool.shift(); recovered = true; recoveredN++;
        } else {
          var draw = Q.next({ game: "ARM", difficultyBand: bandFor(i), excludeIds: usedIds, rng: runRng, shuffle: true });
          q = draw.question;
          usedIds.push(q.id);
        }
        if (bossActive) { bossQueue.push(q); continue; }   // boss holds it; shed one per weakpoint break (no open core)
        cores.push({
          idx: i, q: q, recovered: recovered, x: pos[i].x, y: pos[i].y, r: 26, pulse: runRng.next() * TAU,
          ch: L, state: (L.kind === "combat") ? "locked" : "unlocked",
          gateActive: false, qOpen: false,
          puzType: (L.kind === "puzzle") ? ptypes[pj++ % ptypes.length] : null,
          astHP: (L.type === "asteroid" ? L.hp + Math.floor(i / 2) : 0),
        });
      }
      setupBriefing();
    }
    function bandFor(coreIdx, sec) {
      // ceiling rises by difficulty TIER (Easy leans 1-2, Medium 2-3, Hard 3) and gently within
      // a sector. Floor stays easy so the skewed bank (few hard questions) never starves the draw.
      var s2 = sec === undefined ? sector : sec;
      var d = Math.min(3, 1 + tierOf(s2) + Math.floor(coreIdx / 3));
      // (v0.91.0) the bank has only 18 difficulty-1 cards, so [1,1] openers replayed the same
      // few every session; from sector 2 on the opener ceiling is at least 2 (sector 1 stays
      // the gentle intro).
      if (s2 > 1) d = Math.max(d, 2);
      return [1, d];
    }
    function setupBriefing() {
      if (bossActive) {
        // (v0.95.0, A4, Jason) the pre-boss brief: name the threat, count the cores, teach the kill.
        var PBb = BOSS_PATTERNS[bossIdxOf(sector)];   // (v0.142.0, ARM#2) name the warship, call its signature
        briefIntro = "Pilot \u2014 this one's different. Long-range scans show a BCM DREADNOUGHT parked on our lane \u2014 the \u201C" + PBb.name + "\u201D \u2014 and it's holding " + bossQueue.length + " station cores in its hull racks. Tactical readout: " + PBb.callout + ".";
        briefOutro = "Tactics: its hull ports glow gold under a beacon \u2014 pour fire into the ACTIVE port until it vents a core, then CATCH the core and answer to lock it in. When its laser charges, get OFF the line before it fires. Five ports, five cores. Bring that monster down \u2014 hyperdrive when you're ready.";
        return;
      }
      briefIntro = sector <= 1
        ? "Pilot \u2014 a BCM Disruptor hit shattered the MCI Station into " + cores.length + " knowledge cores. I'll brief each one before you fly."
        : "Sector " + sector + " of " + SECTORS + ", pilot \u2014 " + cores.length + " more cores ahead, and the BCM's pushing harder. I'll brief each before you launch.";
      briefOutro = sector >= SECTORS
        ? "Last of them. Clear this sector and the Station's whole again \u2014 hyperdrive when you're ready."
        : "That's the loadout. Guarded cores: clear the threat or solve the lock, then prove the concept to extract. Hyperdrive when you're ready.";
    }
    // Per-core teaching. (v0.95.0, A5, Jason: "I end up just reading the answer and ignoring
    // the why") Vega now EXPLAINS first and lands the answer as the closing line — the study
    // phase forces the why before the what; the spaced scheduler re-tests it across later
    // sessions. Content is sourced ONLY from authored, verified fields (the correct option(s),
    // q.briefing, q.explanation, q.deepExplain). Never AI-generated, never invented. NOTE: authored
    // q.briefing/q.deepExplain were written non-revealing (old design), so they SUPPORT the reveal
    // rather than replace it — a few are phrased as questions and may want rewording (ARM-chat / 02).
    function correctAnswerText(q) {
      if (Array.isArray(q.correctIndices) && q.correctIndices.length) {
        var parts = [];
        for (var i = 0; i < q.correctIndices.length; i++) parts.push(String(q.options[q.correctIndices[i]]).replace(/\s+$/, ""));
        return parts;
      }
      return [String(q.options[q.correctIndex]).replace(/\s+$/, "")];
    }
    function teachLine(core) {
      var q = core.q, ans = correctAnswerText(q);
      var key = ans.length > 1
        ? ans.slice(0, -1).join(", ") + " and " + ans[ans.length - 1]
        : "\u201c" + ans[0] + "\u201d";
      var why = q.briefing || q.explanation || "";
      // explanation first; the answer is the CLOSING line so the why gets read (A5)
      return { lead: "Intel, pilot \u2014 listen close.", body: why, close: "So the key here is " + key + "." };
    }
    function eli5Line(core) {
      var q = core.q, ans = correctAnswerText(q);
      var plain = ans.length > 1 ? ans.join(" and ") : "\u201c" + ans[0] + "\u201d";
      var extra = q.deepExplain || q.explanation || "";   // surface the deepest authored detail we have
      return { lead: "Plainly, pilot \u2014 walk it through with me.", body: extra, close: "Which is why the right read is " + plain + "." };
    }
    function frustrationLine() {
      return briefRepeat >= 4
        ? "My transmitter works fine, pilot. The next word out of you had better be \u201cunderstood.\u201d"
        : "I've said it three times now. Are your comms damaged, or are you stalling? Focus up.";
    }
    // Render a comms message. A plain string (intro/outro/frustration) goes in as-is; a {lead, body}
    // pair (teach/eli5) renders the answer as a short lead line and the authored explanation as its own
    // spaced paragraph below — so the briefing reads as answer + detail instead of one wall of text.
    function setBriefMsg(parts) {
      if (parts && typeof parts === "object") {
        commsMsg.innerHTML = "";
        commsMsg.appendChild(mk("div", "arm-comms-key", parts.lead));
        if (parts.body) commsMsg.appendChild(mk("div", "arm-comms-why", parts.body));
        if (parts.close) commsMsg.appendChild(mk("div", "arm-comms-key", parts.close));   // (A5) the answer lands LAST
      } else {
        var capV = capWords(parts || "", 120);     // (J7) Vega never exceeds 120 words (Jason v0.75.0)
        commsMsg.textContent = capV.rest ? (capV.s + "\u2026") : capV.s;
      }
      startTypeReveal();   // (v0.180.0, ARM#7) full text is already in place — this is purely visual
    }
    // (v0.180.0, V1.1 ARM#7) the reveal machinery. Timers ride later() (pause-aware, cleared on
    // unmount, flushable via the flushLater seam) so the harness can step a forced session.
    function gateOpts(waiting) {
      if (!commsOpts) return;
      commsOpts.classList.toggle("wait", !!waiting);
      var bs = commsOpts.querySelectorAll("button");
      for (var gi = 0; gi < bs.length; gi++) bs[gi].disabled = !!waiting;
    }
    function startTypeReveal() {
      if (typing.timer !== -1) { win.clearTimeout(typing.timer); timers.delete(typing.timer); typing.timer = -1; }
      typing.active = false;
      if (!typeLayer || !commsMsg) return;
      if (reducedMotion || (TESTMODE && !typeForced)) { finishReveal(); return; }   // instant: no timers, no gating
      var chunks = [];
      if (commsMsg.children && commsMsg.children.length) {
        for (var ci = 0; ci < commsMsg.children.length; ci++) chunks.push(commsMsg.children[ci].textContent);
      } else chunks.push(commsMsg.textContent || "");
      typing.text = chunks.join("\n\n");
      typing.total = typing.text.length; typing.shown = 0;
      if (!typing.total) { finishReveal(); return; }
      typing.active = true;
      commsMsg.classList.add("arm-msg-ink");
      typeLayer.style.display = "block"; typeLayer.textContent = "";
      gateOpts(true);
      typeStep();
    }
    function typeStep() {
      if (!typing.active) return;
      typing.shown++;
      typeLayer.textContent = typing.text.slice(0, typing.shown);
      if (typing.shown >= typing.total) { finishReveal(); return; }
      typing.timer = later(typeStep, TYPE_MS);
    }
    function finishReveal() {
      if (typing.timer !== -1) { win.clearTimeout(typing.timer); timers.delete(typing.timer); typing.timer = -1; }
      typing.active = false; typing.shown = typing.total;
      if (typeLayer) { typeLayer.style.display = "none"; typeLayer.textContent = ""; }
      if (commsMsg) commsMsg.classList.remove("arm-msg-ink");
      gateOpts(false);
    }
    function skipReveal() { if (typing.active) finishReveal(); }
    function buildSectorWorld() {
      shakeAmt = 0;   // (v0.69.0, J1) fresh world = zero inherited shake (the post-boss leak's other half)
      // reset core runtime (keep drawn questions); rebuild ambient field.
      for (var i = 0; i < cores.length; i++) {
        var c = cores[i], L = c.ch;
        c.state = (L.kind === "combat") ? "locked" : "unlocked";
        c.gateActive = false; c.qOpen = false; c.pulse = runRng.next() * TAU;
        c.astHP = (L.type === "asteroid" ? L.hp + Math.floor(c.idx / 2) : 0);
      }
      asteroids = [];
      var an = bossActive ? 0 : 7;
      for (var k = 0; k < an; k++) {
        var p = null, t = 0;
        do { p = { x: rnd(120, MAP_W - 120), y: rnd(120, MAP_H - 120) }; t++; }
        while ((dist2(p.x, p.y, ship.x, ship.y) < 260 || nearAnyCore(p.x, p.y, 200)) && t < 40);
        var r = rnd(20, 40), verts = [], vc = 8 + rint(4);
        for (var m = 0; m < vc; m++) verts.push(rnd(0.72, 1.12));
        asteroids.push({ x: p.x, y: p.y, vx: rnd(-16, 16), vy: rnd(-16, 16), r: r, verts: verts, rot: runRng.next() * TAU, vrot: rnd(-0.5, 0.5), hp: Math.max(1, Math.round(r / 12)) });
      }
      enemies = []; clearProjectiles(); clearParticles();
      for (var e = 0; e < (bossActive ? 0 : 5); e++) spawnRoamer();
      // (v0.197.0, V1.1 ARM#9) the field wears the tier — nebula + star tint shift so sector 11
      // stops being pixel-cousin to sector 1 (cached gradients invalidated for the re-tint)
      var tierP = Math.max(0, Math.min(2, tierOf(sector)));
      if (NEBULA) for (var nT = 0; nT < NEBULA.length; nT++) { NEBULA[nT].c0 = TIER_NEB[tierP][nT % 4]; NEBULA[nT].grad = null; }
      STAR_COL = TIER_STARS[tierP];
      // (ARM#9) one seeded landmark per standard sector — far parallax scenery, never a
      // collider, placed clear of every core approach and the spawn (the v0.44 no-occluder ruling)
      landmark = null;
      if (!bossActive) {
        var lkKinds = ['derelict', 'drift', 'planet'];
        var lk = lkKinds[rint(3)], lp = null, lt = 0;
        do { lp = { x: rnd(160, MAP_W - 160), y: rnd(160, MAP_H - 160) }; lt++; }
        while ((nearAnyCore(lp.x, lp.y, 320) || dist2(lp.x, lp.y, ship.x, ship.y) < 300) && lt < 30);
        if (lt < 30) {
          landmark = { kind: lk, x: lp.x, y: lp.y,
            r: lk === 'planet' ? rnd(180, 260) : (lk === 'drift' ? rnd(140, 220) : rnd(60, 90)),
            rot: rnd(0, TAU), d: lk === 'planet' ? 0.25 : 0.5, rocks: null };
          if (lk === 'drift') {
            landmark.rocks = [];
            for (var lr = 0; lr < 10; lr++) landmark.rocks.push({ ox: rnd(-1, 1), oy: rnd(-0.35, 0.35), r: rnd(6, 16), a: rnd(0.25, 0.55) });
          }
        }
      }
      roamTimer = 4; returnReady = false; panicSpawned = false; invuln = 1.0; regenT = 0; setBanner("");
      if (bossActive) {
        // Galaga arena: just the dreadnought. Ship locked to the bottom, boss weaving across the top.
        asteroids = []; enemies = []; clearProjectiles();
        ship.x = W / 2; ship.y = H - 74; ship.vx = ship.vy = 0; ship.angle = -Math.PI / 2;
        camX = 0; camY = 0;
        var whp = BOSS_WP_HP_BY_TIER[tierOf(sector)];
        var PB0 = BOSS_PATTERNS[bossIdxOf(sector)];   // (v0.142.0, ARM#2)
        boss = { x: W / 2, y: 98, baseY: 98, vx: 42, r: 52, wpR: 20, wpMax: whp, wpHp: whp, active: true,
          wps: makeWeakpoints(), wpActive: 0,
          dying: false, deathT: 0, flash: 0, shootCD: 1.6,
          laserCD: rnd(PB0.laserLo, PB0.laserHi), laserState: "none", laserT: 0, laserX: W / 2, laserY: 98,
          laserMode: "beam", laserX2: null, laserY2: 98, gapX: W / 2, missileCD: 6,   // (v0.97.0, A10) seekers + wall-mode fields
          escortCD: PB0.escortEvery || 0, enraged: false,   // (v0.142.0, ARM#2)
          exCD: 0, warpDeadline: 0, ph1: false, ph2: false };
        setBanner("\u2620 BCM Dreadnought \u201C" + PB0.name + "\u201D \u2014 destroy the glowing weakpoints \u00B7 catch the cores they drop \u00B7 dodge the laser beam");
      } else { boss = null; }
      sectorMusic();
    }
    function nearAnyCore(x, y, d) {
      for (var i = 0; i < cores.length; i++) if (dist2(x, y, cores[i].x, cores[i].y) < d) return true;
      return false;
    }
    // (v0.148.0, V1.1 ARM#3) tier-gated archetypes: T0 chasers only (onboarding unchanged),
    // T1 mixes in ORBITERS (aqua diamond, circles at standoff, quicker trigger), T2 adds
    // LANCERS (peach chevron, no gun: 0.6s telegraph then a ramming dash). Sectors 9-12 were
    // just spongier copies of sector 1's one enemy — now the belt escalates in KIND.
    // (v0.155.0, V1.1 ARM#4) the difficulty CLIFFS smoothed: tier HP arrives as a spawn-
    // population MIX (entry sector 40% new tier, next 70%, then 100%) and shot damage lerps
    // 10 -> 18 across all 12 sectors (max +1/sector; the old tables jumped +4 at 5 and 9).
    // smoothDiff OFF = the classic hard steps (02 s3D difficulty-shape toggle).
    function enemyHpFor(sec) {
      var t = tierOf(sec);
      if (!smoothDiff || t === 0) return ENEMY_HP_BY_TIER[t];
      var entry = t === 1 ? 5 : 9;
      var p = sec === entry ? 0.4 : (sec === entry + 1 ? 0.7 : 1);
      return runRng.next() < p ? ENEMY_HP_BY_TIER[t] : ENEMY_HP_BY_TIER[t - 1];
    }
    function shotDmgFor(sec) {
      if (!smoothDiff) return ENEMY_SHOT_DMG_BY_TIER[tierOf(sec)];
      var lo = ENEMY_SHOT_DMG_BY_TIER[0], hi = ENEMY_SHOT_DMG_BY_TIER[2];
      return Math.round(lo + (Math.min(SECTORS, Math.max(1, sec)) - 1) * (hi - lo) / (SECTORS - 1));
    }
    function rollEnemyType() {
      var t = tierOf(sector);
      if (t === 0) return null;
      var r = runRng.next();
      if (t === 1) return r < 0.35 ? 'orbiter' : null;
      return r < 0.30 ? 'orbiter' : (r < 0.55 ? 'lancer' : null);
    }
    function spawnRoamer() {
      if (countEnemies(null) >= 8) return;
      var ang = runRng.next() * TAU, d = rnd(W * 0.55, W * 0.9);
      var x = clamp(ship.x + Math.cos(ang) * d, 60, MAP_W - 60);
      var y = clamp(ship.y + Math.sin(ang) * d, 60, MAP_H - 60);
      enemies.push({ x: x, y: y, vx: 0, vy: 0, r: 13, coreId: null, shootCD: rnd(1.2, 2.4), hp: enemyHpFor(sector), type: rollEnemyType(), orb: runRng.next() < 0.5 ? 1 : -1, lstate: 0, lt: 0, lang: 0 });
    }
    function spawnGuardians(core, n) {
      for (var i = 0; i < n; i++) { var a = i / n * TAU; enemies.push({ x: core.x + Math.cos(a) * 70, y: core.y + Math.sin(a) * 70, vx: 0, vy: 0, r: 13, coreId: core.idx, shootCD: rnd(1, 2), hp: enemyHpFor(sector), type: rollEnemyType(), orb: runRng.next() < 0.5 ? 1 : -1, lstate: 0, lt: 0, lang: 0 }); }
    }
    function spawnWave(n) {
      for (var k = 0; k < n; k++) {
        if (countEnemies(null) >= 10) break;
        var p = null, tr = 0;
        do { p = { x: rnd(80, MAP_W - 80), y: rnd(80, MAP_H - 80) }; tr++; } while (dist2(p.x, p.y, ship.x, ship.y) < 560 && tr < 40);
        enemies.push({ x: p.x, y: p.y, vx: 0, vy: 0, r: 13, coreId: null, shootCD: rnd(1.2, 2.6), hp: enemyHpFor(sector), type: rollEnemyType(), orb: runRng.next() < 0.5 ? 1 : -1, lstate: 0, lt: 0, lang: 0 });
      }
    }
    // S3: full-collection escape gauntlet — a ring of enemies around the ship. Far enough + slow enough to be escapable, not a wall.
    function spawnPanic(n) {
      for (var i = 0; i < n; i++) {
        var ang = i / n * TAU + (runRng.next() - 0.5) * 0.6;       // even ring, jittered so it isn't a perfect circle
        var d = rnd(W * 0.55, W * 0.95);                           // outside the immediate threat radius
        var x = clamp(ship.x + Math.cos(ang) * d, 60, MAP_W - 60);
        var y = clamp(ship.y + Math.sin(ang) * d, 60, MAP_H - 60);
        enemies.push({ x: x, y: y, vx: 0, vy: 0, r: 13, coreId: "panic", shootCD: rnd(1.8, 3.2), hp: enemyHpFor(sector), type: null, orb: 1, lstate: 0, lt: 0, lang: 0 });   // panic swarm stays chasers (drama)
      }
    }
    function panicCount() { var n = 0; for (var i = 0; i < enemies.length; i++) if (enemies[i].coreId === "panic") n++; return n; }
    function countEnemies(coreId) {
      var n = 0;
      for (var i = 0; i < enemies.length; i++) { if (coreId === null ? enemies[i].coreId == null : enemies[i].coreId === coreId) n++; }
      return n;
    }
    function removeGuardians(coreId) {
      for (var i = enemies.length - 1; i >= 0; i--) { if (enemies[i].coreId === coreId) { enemies[i] = enemies[enemies.length - 1]; enemies.pop(); } }
    }

    /* ---------------------------------------------------------------------- */
    /* flow                                                                   */
    /* ---------------------------------------------------------------------- */
    var resumePending = false;   // (v0.106.0, G2) set at mount when ctx.resumeData restored
    function newRun() {
      if (resumePending) {
        // (G2) Resume: state was restored at mount — keep it, refill the tanks, skip the
        // intro cutscene, open at the checkpointed sector's briefing.
        resumePending = false;
        disarmPuzzleTimer(); puzzleCore = null; puzzleDoneFlag = false;
        charges = undefined; shields = undefined; deriveStats(); charges = maxCharges; shields = maxShields; rechargeTimer = rechargeTime;
        held = []; sectorLost = [];
        runRng = RNG.fork("arm-run-" + sector + ":" + (runSeq++));
        makeStars();
        drawCoreQuestions();
        briefCore = -1; briefMode = "TEACH"; briefRepeat = 0; ship.x = ENTRY_X; ship.y = ENTRY_Y; ship.vx = ship.vy = 0; ship.angle = -Math.PI / 2;
        showBriefing();
        return;
      }
      sector = 1; coins = 0;
      disarmPuzzleTimer(); puzzleCore = null; puzzleDoneFlag = false;
      lvl.engine = lvl.maneuver = lvl.capacitor = lvl.shieldCell = lvl.rapid = 0;
      if (PERKS.armShieldCell) lvl.shieldCell = PERKS.armShieldCell | 0;   // (v0.179.0, V1.1 Flow#7) Lieutenant perk: free Shield Cell level(s) on a fresh run
      charges = undefined; shields = undefined; deriveStats(); charges = maxCharges; shields = maxShields; rechargeTimer = rechargeTime;
      held = []; stationBuild = 0; sectorLost = []; usedIds = []; lostPool = [];
      runRng = RNG.fork("arm-run-" + sector + ":" + (runSeq++));   // deterministic per run; (v0.91.0) runSeq varies retries/replays
      makeStars();
      startBriefing();
    }
    function startBriefing() {
      drawCoreQuestions();
      briefCore = -1; briefMode = "TEACH"; briefRepeat = 0; ship.x = ENTRY_X; ship.y = ENTRY_Y; ship.vx = ship.vy = 0; ship.angle = -Math.PI / 2;
      playIntro(showBriefing);                 // P6a: cutscene first, then the commander briefing
    }
    function showBriefing() { comms.className = "arm-comms" + (reducedMotion ? "" : " tx-live"); setState("BRIEF"); renderComms(); }
    // ---- P6a intro cutscene (skippable, replayable) ----
    function playIntro(done) {
      introDone = done || showBriefing;
      introActive = true; introT = 0;
      show(introBar, true);
      if (introCap) introCap.textContent = "";
      setState("INTRO");
      try { sfx("hyperdrive"); } catch (e) {}
    }
    function endIntro() {
      if (!introActive) return;
      introActive = false;
      show(introBar, false);
      var d = introDone; introDone = null;
      if (d) d();
    }
    function updateIntro(dt) {
      introT += dt;
      if (introT >= (reducedMotion ? 4.6 : 7.2)) endIntro();
    }
    // intact-station fallback when the sprite hasn't decoded (neon citadel: hex base + aqua spire)
    function drawStationVector(cx, cy, r, alpha) {
      if (!c2d) return;
      c2d.save(); c2d.translate(cx, cy); c2d.globalAlpha = alpha;
      c2d.shadowColor = COL.iris; c2d.shadowBlur = 16; c2d.strokeStyle = COL.iris300; c2d.fillStyle = "rgba(40,30,70,0.7)"; c2d.lineWidth = 2;
      c2d.beginPath(); for (var j = 0; j < 6; j++) { var aa = j / 6 * TAU; var px = Math.cos(aa) * r, py = Math.sin(aa) * r; j === 0 ? c2d.moveTo(px, py) : c2d.lineTo(px, py); } c2d.closePath(); c2d.fill(); c2d.stroke();
      c2d.shadowColor = COL.aqua; c2d.fillStyle = COL.aqua; c2d.globalAlpha = alpha * 0.9;
      c2d.beginPath(); c2d.moveTo(0, -r * 1.4); c2d.lineTo(r * 0.18, 0); c2d.lineTo(-r * 0.18, 0); c2d.closePath(); c2d.fill();
      c2d.restore(); c2d.globalAlpha = 1; c2d.shadowBlur = 0;
    }
    // P6a intro/Disruptor cinematic: arrival -> the Acropolis Station, struck by the BCM Disruptor and shattered -> dive after the scattered cores.
    function drawIntro() {
      if (!c2d) return;
      var T = introT, rm = reducedMotion;
      var bWarp = rm ? 0.5 : 0.9, bFire = rm ? 1.7 : 2.7, bDive = rm ? 2.8 : 4.4, bEnd2 = rm ? 3.6 : 5.8;
      var stCx = W * 0.5, stCy = H * 0.42, stSize = Math.min(W, H) * 0.52;
      var srcX = W * 0.85, srcY = H * 0.14;                     // BCM Disruptor source (top-right, off the station)

      c2d.fillStyle = COL.space || "#07070e"; c2d.fillRect(0, 0, W, H);
      drawNebula(introT * 8, 0);
      var i, s;
      for (i = 0; i < stars.length; i++) { s = stars[i]; var sx = (s.x * 0.3) % W, sy = (s.y * 0.3) % H; c2d.globalAlpha = s.a * 0.6; c2d.fillStyle = "#cfd2ff"; c2d.fillRect(sx, sy, s.s, s.s); }
      c2d.globalAlpha = 1;

      // --- A: warp-arrival streaks settling ---
      if (T < bWarp && !rm) {
        var fade = 1 - T / bWarp; c2d.lineWidth = 2; c2d.strokeStyle = COL.iris300; c2d.shadowBlur = 8; c2d.shadowColor = COL.aqua;
        for (i = 0; i < stars.length; i += 2) {
          var stp = stars[i]; var dxa = ((stp.x * 0.3) % W) - W / 2, dya = ((stp.y * 0.3) % H) - H / 2;
          var ang0 = Math.atan2(dya, dxa), rad0 = Math.sqrt(dxa * dxa + dya * dya), len0 = 40 * fade;
          c2d.globalAlpha = 0.5 * fade; c2d.beginPath();
          c2d.moveTo(W / 2 + Math.cos(ang0) * rad0, H / 2 + Math.sin(ang0) * rad0);
          c2d.lineTo(W / 2 + Math.cos(ang0) * (rad0 + len0), H / 2 + Math.sin(ang0) * (rad0 + len0)); c2d.stroke();
        }
        c2d.globalAlpha = 1; c2d.shadowBlur = 0;
      }

      // --- B/C: the Acropolis Station, struck and shattered ---
      if (T >= bWarp * 0.4 && T < bDive) {
        var stIn = clamp((T - bWarp * 0.4) / 0.7, 0, 1);
        var stationOK = spriteReady(SPR.station);
        if (T < bFire) {
          var bob = rm ? 0 : Math.sin(T * 1.4) * 6;
          if (stationOK) {
            c2d.save(); c2d.globalAlpha = stIn; c2d.shadowColor = COL.aqua; c2d.shadowBlur = 28;
            c2d.drawImage(SPR.station, stCx - stSize / 2, stCy - stSize / 2 + bob, stSize, stSize);
            c2d.restore(); c2d.shadowBlur = 0;
          } else { drawStationVector(stCx, stCy + bob, stSize * 0.4, stIn); }
          var chg = clamp((T - (bFire - 1.0)) / 1.0, 0, 1);     // Disruptor charging at the source
          if (chg > 0) {
            var cr = 4 + chg * 16;
            c2d.save(); c2d.globalCompositeOperation = "lighter";
            var cg = c2d.createRadialGradient(srcX, srcY, 0, srcX, srcY, cr * 2.2);
            if (cg && cg.addColorStop) {
              cg.addColorStop(0, "rgba(255,107,91," + (0.5 + 0.4 * chg) + ")"); cg.addColorStop(1, "rgba(255,107,91,0)");
              c2d.fillStyle = cg; c2d.beginPath(); c2d.arc(srcX, srcY, cr * 2.2, 0, TAU); c2d.fill();
            }
            c2d.globalAlpha = 0.25 + 0.4 * chg; c2d.strokeStyle = COL.peach; c2d.lineWidth = 1; c2d.setLineDash([4, 6]);
            c2d.beginPath(); c2d.moveTo(srcX, srcY); c2d.lineTo(stCx, stCy); c2d.stroke(); c2d.setLineDash([]);
            c2d.restore(); c2d.globalAlpha = 1;
          }
        } else {
          var shatter = clamp((T - bFire) / (bDive - bFire - 0.2), 0, 1);
          var fire = clamp((T - bFire) / 0.22, 0, 1);
          c2d.save(); c2d.globalCompositeOperation = "lighter"; c2d.shadowColor = COL.peach; c2d.shadowBlur = 22;  // the Disruptor beam
          var beamA = 1 - shatter;
          c2d.strokeStyle = "rgba(255,107,91," + (0.85 * beamA) + ")"; c2d.lineWidth = 7 + 12 * (1 - shatter);
          c2d.beginPath(); c2d.moveTo(srcX, srcY); c2d.lineTo(stCx, stCy); c2d.stroke();
          c2d.strokeStyle = "rgba(255,238,228," + (0.9 * beamA) + ")"; c2d.lineWidth = 3;
          c2d.beginPath(); c2d.moveTo(srcX, srcY); c2d.lineTo(stCx, stCy); c2d.stroke();
          c2d.restore(); c2d.shadowBlur = 0;
          if (stationOK) {                                       // station shatters into 3x3 sprite fragments flying outward
            var nat = SPR.station.naturalWidth || 384, GR = 3, scell = nat / GR, dcell = stSize / GR;
            for (var gy = 0; gy < GR; gy++) for (var gx = 0; gx < GR; gx++) {
              var fdx = gx - 1, fdy = gy - 1, fly = shatter * stSize * 0.85, jx = ((gx * 3 + gy * 7) % 5 - 2);
              var fx = stCx + fdx * dcell * 0.5 + fdx * fly + jx * shatter * 20;
              var fy = stCy + fdy * dcell * 0.5 + fdy * fly - shatter * shatter * 28;
              c2d.save(); c2d.globalAlpha = Math.max(0, 1 - shatter * 1.05);
              c2d.translate(fx, fy); c2d.rotate(shatter * (fdx - fdy + 0.5) * 1.1);
              c2d.drawImage(SPR.station, gx * scell, gy * scell, scell, scell, -dcell / 2, -dcell / 2, dcell, dcell);
              c2d.restore();
            }
            c2d.globalAlpha = 1;
          } else { drawStationVector(stCx, stCy, stSize * 0.4, 1 - shatter); }
          var cscat = clamp((T - bFire) / 1.4, 0, 1);            // knowledge cores scatter (glowing orbs)
          for (var m = 0; m < 6; m++) {
            var ma = m / 6 * TAU + 0.4, md = cscat * (stSize * 0.55 + (m % 3) * 18);
            var ccx = stCx + Math.cos(ma) * md, ccy = stCy + Math.sin(ma) * md - cscat * cscat * 18;
            var pulse = 0.6 + 0.4 * Math.sin(T * 4 + m), col = (m % 3 === 0) ? COL.iris : (m % 3 === 1 ? COL.aqua : COL.gold);
            c2d.save(); c2d.globalCompositeOperation = "lighter"; c2d.globalAlpha = Math.min(1, cscat * 1.4);
            c2d.shadowColor = col; c2d.shadowBlur = 12 + pulse * 8; c2d.fillStyle = col;
            c2d.beginPath(); c2d.arc(ccx, ccy, 4.5 + pulse * 2, 0, TAU); c2d.fill(); c2d.restore();
          }
          c2d.globalAlpha = 1; c2d.shadowBlur = 0;
          if (fire < 1) { c2d.fillStyle = "rgba(255,255,255," + (0.7 * (1 - fire)) + ")"; c2d.fillRect(0, 0, W, H); }  // impact flash
        }
      }

      // --- D: dive to the planet (BCM dive enemies + the player) ---
      if (T >= bDive) {
        var dv = clamp((T - bDive) / ((bEnd2 - bDive) + 0.8), 0, 1);
        var pr = Math.max(W, H) * 0.95, pcy = H + pr - dv * H * 0.4;          // planet rising at the bottom
        c2d.save();
        if (spriteReady(SPR.planet)) {                                        // (Jason) the real planet image, clipped to the disc
          c2d.save(); c2d.beginPath(); c2d.arc(W * 0.5, pcy, pr, 0, TAU); c2d.clip();
          c2d.drawImage(SPR.planet, W * 0.5 - pr, pcy - pr, pr * 2, pr * 2);
          c2d.restore();
        } else {
          var pg = c2d.createRadialGradient(W * 0.5, pcy, pr * 0.55, W * 0.5, pcy, pr);
          if (pg && pg.addColorStop) {
            pg.addColorStop(0, "rgba(46,38,92,0.95)"); pg.addColorStop(0.82, "rgba(22,18,48,0.97)"); pg.addColorStop(1, "rgba(10,8,24,1)");
            c2d.fillStyle = pg; c2d.beginPath(); c2d.arc(W * 0.5, pcy, pr, 0, TAU); c2d.fill();
          }
        }
        c2d.strokeStyle = "rgba(31,221,233,0.5)"; c2d.lineWidth = 3; c2d.shadowColor = COL.aqua; c2d.shadowBlur = 18;
        c2d.beginPath(); c2d.arc(W * 0.5, pcy, pr, Math.PI * 1.12, Math.PI * 1.88); c2d.stroke();
        c2d.restore(); c2d.shadowBlur = 0;
        c2d.save(); c2d.strokeStyle = "rgba(172,155,253,0.35)"; c2d.lineWidth = 2;     // descent streaks
        for (i = 0; i < 10; i++) { var lx = (i * 97 + (T * 220 % H)) % W, ly = (i * 53 + T * 260) % (H * 0.6); c2d.globalAlpha = 0.3; c2d.beginPath(); c2d.moveTo(lx, ly); c2d.lineTo(lx, ly + 26); c2d.stroke(); }
        c2d.globalAlpha = 1; c2d.restore();
        var diveY = H * 0.16 + dv * H * 0.36;
        if (spriteReady(SPR.dive)) {                                          // BCM dive enemies, pointing down
          for (var e = 0; e < 3; e++) {
            var ex = W * (0.3 + e * 0.2) + Math.sin(T * 2 + e) * 12, ey = diveY - 26 + (e % 2) * 22 - dv * 16, es = 30 + (e % 2) * 6;
            c2d.save(); c2d.translate(ex, ey); c2d.rotate(Math.PI); c2d.shadowColor = COL.peach; c2d.shadowBlur = 8;
            c2d.drawImage(SPR.dive, -es / 2, -es / 2, es, es); c2d.restore(); c2d.shadowBlur = 0;
          }
        }
        drawShipAt(W * 0.5, diveY + 8, Math.PI / 2, 1.2);                     // the player, diving after them
      }

      // --- captions ---
      var cap = "";
      if (T >= bEnd2) cap = "Recover the cores \u2014 rebuild the station.";
      else if (T >= bDive) cap = "Dive after them.";
      else if (T >= bFire) cap = "The BCM\u2019s Disruptor shattered the MCI Station.";
      else if (T >= bWarp * 0.4) cap = "The MCI Station \u2014 the sector\u2019s memory.";
      if (introCap && introCap.textContent !== cap) introCap.textContent = cap;
    }
    function setBriefOpts(arr) {
      briefOpts = arr; clear(commsOpts);
      for (var i = 0; i < arr.length; i++) {
        (function (o) {
          commsOpts.appendChild(btn("arm-comms-opt" + (o.primary ? " pri" : ""), o.label, function () { ensureAudio(); sfx("click"); o.fn(); }));
        })(arr[i]);
      }
      if (typing.active) gateOpts(true);   // (v0.180.0, ARM#7) options enable on reveal-complete or skip
    }
    function briefAdvanceCore() { briefCore++; briefMode = "TEACH"; briefRepeat = 0; renderComms(); }
    function renderComms() {
      var nCore = cores.length; clear(commsDots);
      for (var i = 0; i < nCore; i++) commsDots.appendChild(mk("span", "arm-dot" + (briefCore >= i && briefCore < nCore ? " on" : "")));
      // (v0.112.0, D4) the dash manifest carries the same progress as the dots
      try {
        var hx = brfScene && brfScene.querySelector(".arm-brf-hexes");
        if (hx) {
          clear(hx);
          for (var hxi = 0; hxi < nCore; hxi++) hx.appendChild(mk("span", "arm-mhex" + (briefCore >= hxi ? " on" : ""), briefCore >= hxi ? "\u2B21" : String(hxi + 1)));
          var info = brfScene.querySelector(".arm-brf-info");
          if (info && briefCore >= 0 && briefCore < nCore) info.innerHTML = 'BRIEFING ' + (briefCore + 1) + '/' + nCore + '<br><span>Topic</span> ' + conceptTag(cores[briefCore]) + '<br><span>Domain</span> ' + (cores[briefCore].q.domain || '');
          else if (info) info.innerHTML = 'SECTOR ' + sector + ' \u00b7 ' + nCore + ' CORES';
        }
      } catch (eMx) {}
      if (briefCore < 0) {                                    // intro
        commsSubj.textContent = "Priority channel \u00b7 NX-SRC"; setBriefMsg(briefIntro);
        setBriefOpts([{ label: "Go ahead, sir \u25B8", primary: true, fn: function () { briefCore = 0; briefMode = "TEACH"; briefRepeat = 0; renderComms(); } }]);
      } else if (briefCore >= nCore) {                        // engage
        commsSubj.textContent = "Mission"; setBriefMsg(briefOutro);
        setBriefOpts([{ label: "Engage hyperdrive \u25B8", primary: true, fn: function () { startWarp(enterSector); } }]);
      } else {                                                // teaching a core
        var core = cores[briefCore], frustrated = briefRepeat >= 3;
        commsSubj.textContent = "Core " + (briefCore + 1) + " of " + nCore + " \u00b7 " + conceptTag(core).toUpperCase();
        if (briefMode === "ELI5") {
          setBriefMsg(frustrated ? frustrationLine() : eli5Line(core));
          setBriefOpts([
            { label: "Yes, sir", primary: true, fn: briefAdvanceCore },
            { label: "Please repeat, sir", fn: function () { briefRepeat++; renderComms(); } }
          ]);
        } else {
          setBriefMsg(frustrated ? frustrationLine() : teachLine(core));
          setBriefOpts([
            { label: "I understand", primary: true, fn: briefAdvanceCore },
            { label: "Repeat", fn: function () { briefRepeat++; renderComms(); } },
            { label: "Explain further", fn: function () { briefMode = "ELI5"; renderComms(); } }
          ]);
        }
      }
    }
    function enterSector() {
      ship.x = ENTRY_X; ship.y = ENTRY_Y; ship.vx = ship.vy = 0; ship.angle = -Math.PI / 2;
      held = []; sectorLost = []; deriveStats(); charges = maxCharges; shields = maxShields; rechargeTimer = rechargeTime;
      buildSectorWorld(); hud(); setState("SECTOR");
      try { AUD.playTrack("arm"); } catch (e) {}
      showToast("Sector NCP-0" + sector + " — recover the five cores");
    }
    // Hyperdrive warp: a 3-2-1 countdown ("spinning up") then an accelerating streak tunnel.
    // Durations are reduced-motion aware and are the only knobs for the cinematic length.
    function warpCD() { return reducedMotion ? 1.0 : 1.0; }       // (v0.75.0, Jason) punchy 3-2-1 — a beat per number
    function warpStreak() { return reducedMotion ? 0.7 : 2.2; }   // (v0.75.0, Jason) shorter, FASTER tunnel — energy over slow-motion
    function warpTotal() { return warpCD() + warpStreak(); }
    function startWarp(done) { warpT = 0; warpBeat = -1; warpDone = done; setState("WARP"); }
    function coreLvl(core) { return Math.floor(core.idx / 2); }

    function onArrive(core) {
      if (core.state === "collected" || core.state === "lost" || core.qOpen) return;
      if (core.ch.kind === "puzzle") { openPuzzle(core); return; }
      if (core.state === "unlocked") { askCore(core); return; }
      if (!core.gateActive) {
        core.gateActive = true;
        if (core.ch.type === "drones") {
          var need = core.ch.need + Math.floor(coreLvl(core) / 2);
          spawnGuardians(core, need);
          setBanner("⚔ Eliminate " + need + " guardian drones, then extract the " + conceptTag(core) + " core");
        } else {
          setBanner("⚔ Shatter the asteroid encasing the " + conceptTag(core) + " core");
        }
        showToast("Threat detected — clear it to expose the core");
      } else {
        showToast("Clear the threat first");
      }
    }
    function checkCombatCleared() {
      for (var i = 0; i < cores.length; i++) {
        var core = cores[i];
        if (core.ch.kind !== "combat" || core.state !== "locked" || !core.gateActive) continue;
        var cleared = (core.ch.type === "drones") ? countEnemies(core.idx) === 0 : core.astHP <= 0;
        if (cleared) { core.state = "unlocked"; setBanner("✦ Core exposed — fly in to extract"); showToast("Core exposed — dock to extract"); }
      }
    }
    function askCore(core) {
      core.qOpen = true; clearActiveEBullets(); setState("QUESTION");
      showQuestion(core.q, "⟟ Core scan · " + conceptTag(core), false, function (ok) {
        if (ok) { coins += 15; held.push(core); core.state = "collected"; sfx("collect"); showToast("Core secured  +15 \u2b21"); burst(core.x, core.y, COL.aqua, 16); }
        else { core.state = "lost"; sectorLost.push(core.q); sfx("wrong"); showToast("Core destabilized — lost for now"); }
        core.qOpen = false; afterResolve();
      });
    }
    function clearActiveEBullets() { for (var i = 0; i < ebullets.length; i++) ebullets[i].active = false; for (var j = 0; j < missiles.length; j++) missiles[j].active = false; }
    function afterResolve() {
      hud(); invuln = 1.5;   // collect-beat i-frames (ship blinks) so a freshly-spawned wave can't insta-kill on resume
      var activeN = 0;
      for (var i = 0; i < cores.length; i++) { if (cores[i].state !== "collected" && cores[i].state !== "lost") activeN++; }
      if (bossActive && boss) {
        if (bossQueue.length > 0) {                 // more cores to shed -> activate the NEXT weakpoint
          boss.wpActive++;                           // the destroyed one is already marked dead in shedCore
          boss.active = true; boss.wpHp = boss.wpMax; boss.flash = 0;
          setBanner("\u2756 Next weakpoint exposed \u2014 destroy it to free the next core!");
          setState("SECTOR"); return;
        }
        if (activeN === 0) {                        // all five destroyed + resolved -> staged death sequence (updateBossDeath)
          boss.active = false; boss.dying = true; boss.deathT = 0; boss.exCD = 0;
          try { AUD.playTrack("arm", { intensity: tierOf(sector) >= 2 ? 1 : 0 }); } catch (eM) {}   // (v0.69.0, J2) boss destroyed -> the boss bed ends NOW, not at the next sector
          setBanner("\u2620 Dreadnought reactor breached!");
          setState("SECTOR"); return;
        }
      }
      if (activeN === 0) {
        returnReady = true;
        if (!panicSpawned) { panicSpawned = true; spawnPanic(10); }   // S3: escape gauntlet on full collection
        setBanner("\u2B22 All cores aboard \u2014 punch Hyperdrive to escape!");
      }
      else { setBanner(""); spawnWave(3); }
      setState("SECTOR");
    }
    // Inc2 boss: the weakpoint breaking frees one held core into the field for the player to catch + answer.
    function shedCore() {
      if (!boss || !bossQueue.length) return;
      boss.active = false; boss.flash = 0;
      boss.wps[boss.wpActive].dead = true;            // the active weakpoint is destroyed
      var ap = wpPos(boss.wpActive);
      var q = bossQueue.shift();
      cores.push({ idx: cores.length, q: q, x: ap.x, y: ap.y + 12, r: 24, pulse: 0,
        ch: { kind: "boss-core" }, state: "unlocked", gateActive: false, qOpen: false, puzType: null, astHP: 0,
        vy: 96, vx: rnd(-26, 26) });
      burst(ap.x, ap.y, COL.gold, 24); sfx("explode"); shakeAmt = Math.max(shakeAmt, 8);
      setBanner("\u2756 Weakpoint destroyed \u2014 a core broke loose! Fly under it to catch it.");
      showToast("Core freed \u2014 catch it");
    }
    var LASER_CHARGE = 1.3, LASER_FIRE = 0.55, LASER_HALF = 34, GAP_HALF = 64;   // (v0.97.0, A10) wall-mode safe half-width   // S4 boss laser: charge time, beam time, beam half-width
    // (v0.82.0, Jason) all 5 weakpoints sit on the PROW — the front of the ship, facing the
    // player below (prow points down, so front = positive oy). Arrow formation down the nose;
    // ox stays inside the vector-fallback wedge taper at each oy so both hull renderings work.
    // Offsets keep the CORE DISC (r=wpR) inside the fallback wedge taper at both W=360 and the
    // dw=460 cap, not just the centers (review finding: the art was overhanging the prow tip).
    var WP_DEFS = [
      { ox: -0.34, oy: +0.06 },   // 0 left forward battery
      { ox: +0.18, oy: +0.18 },   // 1 right prow port
      { ox:  0.00, oy: +0.24 },   // 2 nose lance
      { ox: -0.18, oy: +0.18 },   // 3 left prow port
      { ox: +0.34, oy: +0.06 }    // 4 right forward battery
    ];
    function makeWeakpoints() {
      var out = [];
      for (var i = 0; i < WP_DEFS.length; i++) out.push({ ox: WP_DEFS[i].ox, oy: WP_DEFS[i].oy, dead: false });
      return out;
    }
    function bossSpriteWH() { var dw = Math.min(W * 0.62, 460); return { dw: dw, dh: dw * (533 / 800) }; }
    function wpPos(i) { var s = bossSpriteWH(), w = boss.wps[i]; return { x: boss.x + w.ox * s.dw * 0.5, y: boss.y + w.oy * s.dh * 0.5 }; }
    function randomLiveWp() {                                      // a non-destroyed weakpoint position (fallback: boss centre)
      var live = [];
      for (var i = 0; i < boss.wps.length; i++) if (!boss.wps[i].dead) live.push(i);
      if (!live.length) return { x: boss.x, y: boss.y + boss.r };
      return wpPos(runRng.pick(live));
    }
    function bossPattern() { return BOSS_PATTERNS[bossIdxOf(sector)]; }   // (v0.142.0, ARM#2)
    function spawnEscortDrone(side) {   // (v0.142.0, ARM#2) B2/B4: drones launch from the flanks
      var s = bossSpriteWH(), BA0 = bossArena();
      var x = clamp(boss.x + side * s.dw * 0.45, BA0.l + 20, BA0.l + BA0.w - 20);
      enemies.push({ x: x, y: boss.y + s.dh * 0.35, vx: 0, vy: 0, r: 13, coreId: null, shootCD: rnd(1.2, 2.4), hp: enemyHpFor(sector), type: null, orb: 1, lstate: 0, lt: 0, lang: 0 });   // escorts stay chasers (the arena is narrow)
    }
    function updateBoss(dt) {
      if (!boss) return;
      var P = bossPattern();   // (v0.142.0, ARM#2) this dreadnought's fight table
      if (shakeAmt > 0) shakeAmt = Math.max(0, shakeAmt - dt * 26);   // shake decays (~0.5s)
      if (boss.dying) { updateBossDeath(dt); return; }
      // (v0.142.0, ARM#2) B4 enrage: three broken ports flip the finale into overdrive
      if (P.enrage && !boss.enraged) {
        var deadN = 0;
        for (var en0 = 0; en0 < boss.wps.length; en0++) if (boss.wps[en0].dead) deadN++;
        if (deadN >= 3) { boss.enraged = true; boss.vx *= 1.6; setBanner("\u26A0 The ANNIHILATOR is enraged \u2014 faster, angrier, closer"); sfx("lasercharge"); }
      }
      boss.x += boss.vx * dt;                        // gentle drift within the narrow channel (barely moves)
      var BA = bossArena(), wm = BA.w * (boss.enraged ? 0.16 : 0.10);   // enrage widens the weave
      if (boss.x < W / 2 - wm || boss.x > W / 2 + wm) { boss.vx = -boss.vx; boss.x = clamp(boss.x, W / 2 - wm, W / 2 + wm); }
      boss.flash += dt;
      boss.y = boss.baseY + Math.sin(boss.flash * 1.9) * 10;   // slow arcade bob (idle up/down)
      if (P.escortEvery > 0) {                       // (v0.142.0, ARM#2) B2/B4 launch escort pairs
        boss.escortCD -= dt;
        if (boss.escortCD <= 0) {
          boss.escortCD = P.escortEvery * (boss.enraged ? 0.7 : 1);
          if (countEnemies(null) < 3) { spawnEscortDrone(-1); spawnEscortDrone(1); }
        }
      }
      updateBossLaser(dt);                           // S4: telegraphed beam attack (charge -> fire -> shake)
      if (boss.laserState !== "fire") {              // ordinary aimed shots fire from the live weakpoints (paused while the beam is up)
        boss.shootCD -= dt;
        if (boss.shootCD <= 0) {
          boss.shootCD = rnd(1.1, 1.9);
          var src = randomLiveWp(), bang = Math.atan2(ship.y - src.y, ship.x - src.x), bsp = 215;
          spawnEBullet(src.x, src.y, Math.cos(bang) * bsp, Math.sin(bang) * bsp, 6); sfx("laser");
        }
        // (v0.97.0, A10, Jason) seeking missiles: slower and larger than shots — shoot them
        // down or fly around them. Cadence via runRng; steering is a capped turn toward the ship.
        boss.missileCD -= dt;
        if (boss.missileCD <= 0) {
          boss.missileCD = rnd(P.missLo, P.missHi) * (boss.enraged ? 0.8 : 1);   // (v0.142.0, ARM#2) per-boss salvo cadence
          var msrc = randomLiveWp(), ma = Math.atan2(ship.y - msrc.y, ship.x - msrc.x);
          var mm = null;
          for (var mi0 = 0; mi0 < missiles.length; mi0++) { if (!missiles[mi0].active) { mm = missiles[mi0]; break; } }
          if (mm) { mm.active = true; mm.x = msrc.x; mm.y = msrc.y; mm.ang = ma; mm.vx = Math.cos(ma) * MISSILE_SPEED; mm.vy = Math.sin(ma) * MISSILE_SPEED; mm.life = 9; sfx("missile"); }   // (v0.121.0, Jason) a unique launch, not the laser
        }
      }
      updateMissiles(dt);
      if (!boss.active) return;                      // active weakpoint sealed while a shed core is unresolved
      var ap = wpPos(boss.wpActive);                 // only the ACTIVE weakpoint takes damage; body + other points pass through
      for (var j = 0; j < bullets.length; j++) {
        var wb = bullets[j]; if (!wb.active) continue;
        if (dist2(wb.x, wb.y, ap.x, ap.y) < boss.wpR + 3) {
          wb.active = false; burst(ap.x, ap.y, COL.peach, 6); sfx("hit");
          if (--boss.wpHp <= 0) shedCore();
          break;
        }
      }
    }
    var MISSILE_SPEED = 130, MISSILE_TURN = 1.7, MISSILE_R = 10;   // (v0.97.0, A10) slower + larger than shots (215/3px)
    function updateMissiles(dt) {
      for (var i = 0; i < missiles.length; i++) {
        var m = missiles[i]; if (!m.active) continue;
        m.life -= dt; if (m.life <= 0) { m.active = false; continue; }
        var want = Math.atan2(ship.y - m.y, ship.x - m.x);
        var dA = Math.atan2(Math.sin(want - m.ang), Math.cos(want - m.ang));
        m.ang += Math.max(-MISSILE_TURN * dt, Math.min(MISSILE_TURN * dt, dA));
        m.vx = Math.cos(m.ang) * MISSILE_SPEED; m.vy = Math.sin(m.ang) * MISSILE_SPEED;
        m.x += m.vx * dt; m.y += m.vy * dt;
        var killed = false;
        for (var j = 0; j < bullets.length; j++) {          // shootable: any player bullet detonates it
          var pb = bullets[j]; if (!pb.active) continue;
          if (dist2(m.x, m.y, pb.x, pb.y) < MISSILE_R + 3) { pb.active = false; killed = true; break; }
        }
        if (killed) { m.active = false; burst(m.x, m.y, COL.peach, 12); sfx("explode"); continue; }
        if (invuln <= 0 && dist2(m.x, m.y, ship.x, ship.y) < MISSILE_R + shipR()) {
          m.active = false; burst(m.x, m.y, COL.peach, 14); damage(22); sfx("explode");
        }
      }
    }
    function drawMissiles() {
      if (!c2d) return;
      for (var i = 0; i < missiles.length; i++) {
        var m = missiles[i]; if (!m.active) continue;
        c2d.save(); c2d.translate(m.x, m.y); c2d.rotate(m.ang);
        c2d.shadowBlur = 14; c2d.shadowColor = COL.peach; c2d.fillStyle = COL.peach; c2d.strokeStyle = "#ffd9d2"; c2d.lineWidth = 1.5;
        c2d.beginPath(); c2d.moveTo(MISSILE_R + 4, 0); c2d.lineTo(-MISSILE_R * 0.7, -MISSILE_R * 0.62); c2d.lineTo(-MISSILE_R * 0.35, 0); c2d.lineTo(-MISSILE_R * 0.7, MISSILE_R * 0.62); c2d.closePath(); c2d.fill(); c2d.stroke();
        if (!reducedMotion) { c2d.globalAlpha = 0.6 + 0.4 * Math.sin(now() / 40); c2d.fillStyle = COL.gold; c2d.beginPath(); c2d.arc(-MISSILE_R * 0.8, 0, 3, 0, TAU); c2d.fill(); }
        c2d.restore();
      }
      c2d.shadowBlur = 0; c2d.globalAlpha = 1;
    }
    function updateBossLaser(dt) {
      var P = bossPattern();   // (v0.142.0, ARM#2)
      if (boss.laserState === "none") {
        boss.laserCD -= dt;
        if (boss.laserCD <= 0) {
          var lp = randomLiveWp(); boss.laserState = "charge"; boss.laserT = 0; boss.laserX = lp.x; boss.laserY = lp.y;
          // (v0.97.0, A10, Jason / v0.142.0, ARM#2) beam vs WALL is now the boss's call:
          // B1 never fields the wall (teach the fight); B2+ keep the classic 60/40 split.
          boss.laserMode = runRng.next() < (1 - P.wallP) ? "beam" : "wall";
          boss.laserX2 = null;
          if (P.twin && boss.laserMode === "beam") {   // (ARM#2) B3/B4: a second simultaneous column
            var lp2 = randomLiveWp();
            boss.laserX2 = (Math.abs(lp2.x - lp.x) < LASER_HALF * 2) ? clamp(2 * boss.x - lp.x, bossArena().l + LASER_HALF, bossArena().l + bossArena().w - LASER_HALF) : lp2.x;
            boss.laserY2 = lp2.y;
          }
          if (boss.laserMode === "wall") { var BAw = bossArena(); boss.gapX = BAw.l + BAw.w * (0.18 + runRng.next() * 0.64); }   // (v0.108.0, G4 HIGH) was .x = NaN — the wall never fired
          sfx("lasercharge");
        }
      } else if (boss.laserState === "charge") {
        boss.laserT += dt;
        if (boss.laserT >= LASER_CHARGE * (boss.laserMode === "wall" ? 1.5 : 1)) { boss.laserState = "fire"; boss.laserT = 0; shakeAmt = 16; sfx("laserfire"); }
      } else {                                        // firing: sustained shake; a hit costs 75% shields + a louder boom
        boss.laserT += dt;
        if (shakeAmt < 9) shakeAmt = 9;
        var lHit = boss.laserMode === "wall"
          ? Math.abs(ship.x - boss.gapX) >= GAP_HALF                      // wall: safe ONLY in the gap
          : ((Math.abs(ship.x - boss.laserX) < LASER_HALF && ship.y > boss.laserY)
             || (boss.laserX2 != null && Math.abs(ship.x - boss.laserX2) < LASER_HALF && ship.y > boss.laserY2));   // (ARM#2) twin column bites too
        if (lHit && invuln <= 0) { damage(maxShields * 0.75); sfx("laserhit"); shakeAmt = 20; }
        if (boss.laserT >= LASER_FIRE) { boss.laserState = "none"; boss.laserCD = rnd(P.laserLo, P.laserHi) * (boss.enraged ? 0.7 : 1); }
      }
    }
    function updateBossDeath(dt) {                    // S4: staged death — alarms, escalating blasts, then a timed hyperdrive window
      boss.deathT += dt;
      boss.exCD -= dt;
      if (boss.exCD <= 0) {
        boss.exCD = Math.max(0.12, rnd(0.3, 0.55) - boss.deathT * 0.03);
        var s = bossSpriteWH();
        var ex = boss.x + (Math.random() - 0.5) * s.dw * 0.8, ey = boss.y + (Math.random() - 0.5) * s.dh * 0.7;
        burst(ex, ey, Math.random() < 0.5 ? COL.gold : COL.peach, 18); sfx("explode");
        if (shakeAmt < 5 + boss.deathT * 1.4) shakeAmt = 5 + boss.deathT * 1.4;
      }
      if (boss.deathT < 2.2) {
        if (!boss.ph1) { boss.ph1 = true; setBanner("\u26A0 WARNING: reactor breach \u2014 explosion imminent. Hold position."); }
      } else if (boss.deathT < 4.4) {
        if (!boss.ph2) { boss.ph2 = true; setBanner("\u26A0 Hull failing \u2014 WARP OUT AS SOON AS POSSIBLE."); }
      } else {
        if (!returnReady) { returnReady = true; boss.warpDeadline = boss.deathT + 5; setBanner("\u26A0 HYPERDRIVE ONLINE \u2014 ENGAGE NOW! (5s)"); sfx("solve"); }
        if (returnReady && state === "SECTOR" && boss.deathT > boss.warpDeadline) {
          setBanner("\u2620 Too slow \u2014 the dreadnought took you with it."); gameOver();
        }
      }
    }
    function engageReturn() { if (!returnReady) return; startWarp(enterHome); }
    function enterHome() {
      shakeAmt = 0;   // (v0.69.0, J1) the home station is calm water
      enemies = []; clearProjectiles(); asteroids = []; clearParticles();
      commitLost();   // (v0.131.0, V1.1 ARM#1) the Increment-2 promise, finally kept
      ship.x = HOME_ENTRY_X; ship.y = HOME_ENTRY_Y; ship.vx = ship.vy = 0; ship.angle = -Math.PI / 2;
      setState("HOME"); setBanner("⬢ Fly to the MCI Station and dock to deliver your " + held.length + " core" + (held.length === 1 ? "" : "s")); hud();
    }
    function dockHome() { sfx("collect"); showToast("Docking clamps engaged"); beginDeposit(); }
    function beginDeposit() {
      if (held.length === 0) { depositSummary(); return; }
      dq = runRng.shuffle(held.slice()); dqi = 0; dIn = 0; dLost = 0; dCoins = 0; stepDeposit();
    }
    function stepDeposit() {
      if (dqi >= dq.length) { held = []; hud(); depositSummary(); return; }
      var core = dq[dqi];
      setState("DEPOT_Q");
      showQuestion(core.q, "⬢ Depot install " + (dqi + 1) + " / " + dq.length + " · " + conceptTag(core), true, function (ok) {
        if (ok) { var dPay = 25 + sector * 2; stationBuild++; coins += dPay; dIn++; dCoins += dPay; sfx("correct"); }   // (v0.161.0, ARM#5) install pay ramps with depth (27c s1 -> 49c s12)
        else { dLost++; sectorLost.push(core.q); sfx("wrong"); }   // (ARM#1) depot fails resurface too
        dqi++; hud(); stepDeposit();
      });
    }
    function depositSummary() {
      setState("DEPOT_SUM"); panel.className = "arm-panel green"; clear(panel);
      panel.appendChild(mk("div", "arm-eyebrow e-green", "⬢ MCI Station — sync complete"));
      panel.appendChild(mk("h1", null, "Cores delivered"));
      panel.appendChild(mk("p", "arm-body", dIn + " core" + (dIn === 1 ? "" : "s") + " locked into the station" + (dLost ? ", " + dLost + " lost to the field" : "") + ". The structure is taking shape."));
      panel.appendChild(mk("p", "arm-body", "\u2014 Cmdr. Vega: \u201cWell flown, pilot. Those cores are home where they belong.\u201d"));
      panel.appendChild(statLine([
        ["" + stationBuild + "/" + TOTAL, "Station built", COL.green],
        ["+" + dCoins, "Coins earned", COL.gold],
        ["" + coins, "Balance ⬡", COL.text],
      ]));
      panel.appendChild(btn("arm-act", "⚙ Dock — open Hangar", function () { sfx("click"); showShop(sectorClear); }));
    }
    // (v0.106.0, G2) checkpoint helpers — profile.saves.ARM via ctx.persistence
    function saveCheckpoint() {
      try {
        if (!PERS) return;
        var snap = { sector: sector, coins: coins, lvl: { engine: lvl.engine, maneuver: lvl.maneuver, capacitor: lvl.capacitor, shieldCell: lvl.shieldCell, rapid: lvl.rapid }, stationBuild: stationBuild, usedIds: usedIds.slice(0, 400), lostIds: lostPool.map(function (lp) { return lp.id; }).slice(0, 12), label: 'Sector ' + sector + ' of ' + SECTORS + ' \u00b7 ' + coins + ' \u2b21 \u00b7 station ' + stationBuild + '/' + TOTAL };
        // (v0.108.0, G4) LIVE-profile write — clone-writes were clobbered by the next answer
        if (PERS.update) PERS.update(function (p) { p.saves = p.saves || {}; p.saves.ARM = snap; });
        else if (PERS.load && PERS.save) PERS.load().then(function (p) { p.saves = p.saves || {}; p.saves.ARM = snap; return PERS.save(p); }).catch(function () {});
      } catch (eSv) {}
    }
    function clearCheckpoint() {
      try {
        if (PERS && PERS.update) PERS.update(function (p) { if (p.saves) delete p.saves.ARM; });
        else if (PERS && PERS.load && PERS.save) PERS.load().then(function (p) { if (p.saves && p.saves.ARM) { delete p.saves.ARM; return PERS.save(p); } }).catch(function () {});
      } catch (eCl) {}
    }
    function nextSector() {
      sector++;
      saveCheckpoint();   // (G2) the sector boundary IS the checkpoint
      runRng = RNG.fork("arm-run-" + sector + ":" + (runSeq++));   // deterministic per sector; usedIds keeps no-reuse across the run; (v0.91.0) runSeq varies replays
      drawCoreQuestions();                        // fresh cores (excluding usedIds), harder band, sector-aware briefing
      briefCore = -1; briefMode = "TEACH"; briefRepeat = 0;
      ship.x = ENTRY_X; ship.y = ENTRY_Y; ship.vx = ship.vy = 0; ship.angle = -Math.PI / 2;
      showBriefing();                             // commander briefing (no intro cutscene) -> engage -> warp -> enterSector
    }
    function sectorClear() {
      setState("SECTORCLEAR"); panel.className = "arm-panel iris"; clear(panel);
      var lastSector = sector >= SECTORS;
      if (lastSector) { safeTel({ t: "run_ended", game: "ARM", result: "win", score: coins }); safeBest(coins); }
      panel.appendChild(mk("div", "arm-eyebrow " + (lastSector ? "e-green" : "e-iris"), lastSector ? "✦ Station restored" : "Sector " + sector + " of " + SECTORS + " cleared"));
      panel.appendChild(mk("h1", null, lastSector ? "The MCI Station is whole" : "Sector cleared"));
      panel.appendChild(mk("p", "arm-body", lastSector
        ? "Every sector swept and the cores installed. The MCI Station is back online — the BCM's Disruptor strike undone."
        : "\u2014 Cmdr. Vega: \u201cSector " + sector + " secured, pilot. Next coordinates are locked \u2014 the BCM's dug in deeper, so stay sharp.\u201d"));
      panel.appendChild(statLine([
        ["" + stationBuild + "/" + TOTAL, "Station built", COL.green],
        ["" + coins, "Coins ⬡", COL.gold],
      ]));
      var row = mk("div", "arm-btnrow");
      row.appendChild(btn("arm-act", lastSector ? "Fly again ▸" : "Next sector ▸", function () { sfx("click"); lastSector ? newRun() : nextSector(); }));
      row.appendChild(btn("arm-act ghost", "Menu", function () { sfx("click"); requestExit(); }));
      panel.appendChild(row);
    }
    function requestExit() {
      if (typeof EXIT === "function") { try { EXIT(); return; } catch (e) {} }
      // standalone fallback: restart the run
      newRun();
    }
    function gameOver() {
      clearCheckpoint();   // (v0.106.0, G2) a dead run is not resumable
      shakeAmt = 0;   // (v0.69.0, J1) the death panel must not inherit boss shake
      setState("GAMEOVER"); sfx("explode");
      burst(ship.x, ship.y, COL.peach, 40); burst(ship.x, ship.y, COL.gold, 24); deathTimer = 1.1;
    }
    // (v0.161.0, V1.1 ARM#5) the death penalty stripped your TWO HIGHEST upgrades — up to
    // ~540c of spend, ~2 sectors of income, and it systematically flattened whatever build
    // you invested in. Now: ONE level, drawn at random among OWNED upgrades via runRng
    // (seeded, pinnable), and the panel prices the loss honestly.
    function applyDeathPenalty() {
      var owned = [];
      for (var k in lvl) if (lvl[k] > 0) owned.push(k);
      if (!owned.length) return null;
      owned.sort();                                             // stable draw order across engines
      var key = owned[Math.floor(runRng.next() * owned.length)];
      lvl[key]--;
      // mirrors the depot's price table (baseCost + lvl*60, arm shop) — the arm-run pin
      // cross-checks both, so a drift on either side goes red
      var penBase = { engine: 120, maneuver: 110, capacitor: 130, shieldCell: 130, rapid: 140 };
      var cost = penBase[key] + lvl[key] * 60;                  // what buying that level back costs
      deriveStats();
      return { key: key, cost: cost };
    }
    function showGameOverPanel() {
      var pen = applyDeathPenalty();
      var names = { engine: "Engine", maneuver: "Maneuvering", capacitor: "Capacitor", shieldCell: "Shield Cell", rapid: "Rapid Fire" };
      panel.className = "arm-panel peach"; clear(panel);
      panel.appendChild(mk("div", "arm-eyebrow e-peach", "✖ Hull lost"));
      panel.appendChild(mk("h1", null, "Ship destroyed"));
      var costTxt = "";
      if (pen) costTxt = " Salvage stress cost you: " + names[pen.key] + " (\u22121 level \u00b7 " + pen.cost + "c to rebuy).";
      panel.appendChild(mk("p", "arm-body", "Shields failed and your ship broke apart. The sector resets and any cargo you were carrying scatters back into the field." + costTxt + " Your coins and installed station are safe."));
      panel.appendChild(btn("arm-act aqua", "Relaunch sector ▸", function () {
        sfx("click"); held = []; sectorLost = []; deriveStats(); charges = maxCharges; shields = maxShields; rechargeTimer = rechargeTime;
        ship.x = ENTRY_X; ship.y = ENTRY_Y; ship.vx = ship.vy = 0; ship.angle = -Math.PI / 2;
        buildSectorWorld(); hud(); setState("SECTOR");
      }));
    }
    function statLine(items) {
      var s = mk("div", "arm-statline");
      for (var i = 0; i < items.length; i++) {
        var it = items[i], st = mk("div", "arm-stat");
        var n = mk("div", "arm-n", it[0]); if (it[2]) n.style.color = it[2];
        st.appendChild(n); st.appendChild(mk("div", "arm-l", it[1])); s.appendChild(st);
      }
      return s;
    }

    /* ---------------------------------------------------------------------- */
    /* question panel                                                         */
    /* ---------------------------------------------------------------------- */
    function showQuestion(q, eyebrowText, forgiving, done) {
      panel.className = "arm-panel iris"; clear(panel);
      panel.appendChild(mk("div", "arm-eyebrow e-iris", eyebrowText));
      panel.appendChild(mk("h2", null, q.stem));
      // (v0.91.0) defense-in-depth: games are provider-filtered away from exhibit questions;
      // if one ever leaks, fail LOUDLY instead of serving an unanswerable question.
      if (q.image) panel.appendChild(mk("div", "arm-exhibit-warn", "\u26A0 Exhibit question served in error \u2014 its image only renders in Study/Exam. Please report this."));
      var timerEl = mk("div", "arm-qtimer", ""); timerEl.style.display = "none"; panel.appendChild(timerEl);
      var opts = mk("div", "arm-opts"); panel.appendChild(opts);
      var ex = mk("div", "arm-explain"); ex.style.display = "none"; panel.appendChild(ex);
      var cont = btn("arm-act", "Continue ▸", function () { proceed(); }); cont.style.display = "none"; panel.appendChild(cont);

      var optButtons = [];
      var multi = isMultiQ(q), selected = [], submitBtn = null;
      for (var i = 0; i < q.options.length; i++) {
        (function (idx) {
          var b;
          if (multi) {
            b = btn("arm-opt", q.options[idx], function () {
              if (answered) return;
              var at = selected.indexOf(idx);
              if (at >= 0) { selected.splice(at, 1); b.classList.remove("sel"); }
              else { selected.push(idx); b.classList.add("sel"); }
              if (submitBtn) submitBtn.disabled = selected.length === 0;
            });
          } else {
            b = btn("arm-opt", q.options[idx], function () { choose(idx); });
          }
          optButtons.push(b); opts.appendChild(b); if (!reducedMotion) b.style.opacity = "0";
        })(i);
      }
      if (multi) {
        var hint = mk("div", "arm-multi-hint"); hint.textContent = "Select all that apply (" + q.correctIndices.length + "), then submit.";
        opts.appendChild(hint);
        submitBtn = btn("arm-act arm-submit", "Submit answer", function () { choose(selected.slice()); });
        submitBtn.disabled = true; opts.appendChild(submitBtn);
      }

      var answered = false, lastCorrect = false, timedOut = false, t0 = gnow();   // S3: gnow excludes paused time from the response clock
      function choose(answer) {
        if (answered) return; answered = true;
        if (submitBtn) submitBtn.disabled = true;
        lastCorrect = gradeAnswer(q, answer);
        var ms = Math.round(gnow() - t0);
        safeRecord(q.id, lastCorrect, { latencyMs: ms,
          timerPct: limitS ? Math.min(1, ms / (limitS * 1000)) : null,
          reason: timedOut ? "timeout" : "answered" });   // (v0.183.0, Backend#7)
        safeTel({ t: "question_answered", game: "ARM", id: q.id, correct: lastCorrect, ms: ms, difficulty: q.difficulty });
        var correctSet = multi ? q.correctIndices : [q.correctIndex];
        var chosenSet = multi ? answer : [answer];
        for (var k = 0; k < optButtons.length; k++) { optButtons[k].disabled = true; optButtons[k].classList.remove("sel"); }
        for (var m = 0; m < optButtons.length; m++) {
          if (correctSet.indexOf(m) >= 0) markOption(optButtons[m], "correct");
          else if (chosenSet.indexOf(m) >= 0) markOption(optButtons[m], "wrong");
        }
        ex.style.display = "block";
        var head = lastCorrect ? "\u2713 Correct. "
          : (timedOut ? (forgiving ? "\u23F1 Time\u2019s up \u2014 core scattered. " : "\u23F1 Time\u2019s up \u2014 incorrect. ")
                      : (forgiving ? "\u2717 Lost \u2014 core scattered. " : "\u2717 Incorrect. "));
        var capX = capWords(q.explanation, 120);   // (J8; 120 per Jason v0.75.0)
        ex.textContent = head + capX.s + (capX.rest ? "\u2026" : "");
        if (capX.rest) {
          var moreX = doc.createElement("details"); moreX.className = "arm-explain-more";
          var sumX = doc.createElement("summary"); sumX.textContent = "Show the full explanation (" + capX.extra + " more words)";
          var bodyX = doc.createElement("div"); bodyX.textContent = capX.rest;
          moreX.appendChild(sumX); moreX.appendChild(bodyX); ex.appendChild(moreX);
        }
        // (v0.88.0, L3) the authored rationale for the pilot's ACTUAL pick — the
        // misconception-correcting line, not just the generic explanation.
        if (!lastCorrect && !timedOut && Array.isArray(q.optionNotes)) {
          var wrongPick = -1;
          for (var wp = 0; wp < chosenSet.length; wp++) { if (correctSet.indexOf(chosenSet[wp]) < 0) { wrongPick = chosenSet[wp]; break; } }
          if (wrongPick >= 0 && q.optionNotes[wrongPick]) {
            var noteEl = doc.createElement("div"); noteEl.className = "arm-pick-note";
            noteEl.textContent = "Your pick \u2014 " + q.optionNotes[wrongPick];
            ex.appendChild(noteEl);
          }
        }
        cont.style.display = "block";
        sfx(lastCorrect ? "correct" : "wrong");
        // (v0.65.0, Jason's QA-A5 ruling) a timed-out FIELD scan (not the forgiving depot)
        // damages shields; at 0 the GAME OVER panel lands. On a lethal timeout the pending
        // question is cleared and Continue hidden so a stale proceed can't resurrect the run.
        if (timedOut && !forgiving) {
          damage(QUESTION_TIMEOUT_DMG);
          if (state === "GAMEOVER") { pendingQuestion = null; cont.style.display = "none"; }
        }
      }
      function proceed() { if (!answered) return; pendingQuestion = null; sfx("click"); done(lastCorrect); }

      // D6 per-question timer + R5 fade sequencing: options reveal one at a time, and the timer
      // starts only after the last option lands (so short timers aren't unfair on long questions).
      var limitS = 25;
      try { if (Q && typeof Q.timerSeconds === "function") limitS = Q.timerSeconds(q, { extraTime: extraTime }); } catch (e) {}
      var deadline = 0, timerStarted = false;
      function timeUp() { if (answered) return; timedOut = true; choose(multi ? [] : -1); }
      function tickTimer() {
        if (answered) return;
        var remain = deadline - gnow();
        if (remain <= 0) { timerEl.textContent = "\u23F1 0s"; timeUp(); return; }
        timerEl.textContent = "\u23F1 " + Math.ceil(remain / 1000) + "s";
        timerEl.className = "arm-qtimer" + (remain <= 5000 ? " low" : "");
        later(tickTimer, 200);
      }
      function startTimer() {
        if (timerStarted || answered) return;
        timerStarted = true; deadline = gnow() + limitS * 1000;
        timerEl.style.display = "block"; tickTimer();
      }
      if (reducedMotion) {                       // accessibility: no stagger, everything at once
        for (var rr = 0; rr < optButtons.length; rr++) optButtons[rr].style.opacity = "1";
        startTimer();
      } else {
        (function reveal(k) {
          if (answered || k >= optButtons.length) {
            for (var j = 0; j < optButtons.length; j++) optButtons[j].style.opacity = "1";
            startTimer(); return;
          }
          optButtons[k].style.opacity = "1";
          later(function () { reveal(k + 1); }, 180);
        })(0);
      }
      pendingQuestion = { choose: choose, proceed: proceed, correctIndex: q.correctIndex, correctIndices: q.correctIndices,
        limitS: limitS, timeUp: timeUp, startTimerNow: startTimer, isTimerStarted: function () { return timerStarted; },
        remainMs: function () { return timerStarted ? (deadline - gnow()) : (limitS * 1000); } };
    }
    function isMultiQ(q) { return !!(q && Array.isArray(q.correctIndices) && q.correctIndices.length); }
    function gradeAnswer(q, chosen) {
      if (isMultiQ(q)) {
        if (!Array.isArray(chosen) || chosen.length !== q.correctIndices.length) return false;
        for (var i = 0; i < q.correctIndices.length; i++) if (chosen.indexOf(q.correctIndices[i]) < 0) return false;
        return true;
      }
      return chosen === (q ? q.correctIndex : -1);
    }
    function markOption(node, kind) {
      node.classList.add(kind);
      var mark = mk("span", "arm-optmark", kind === "correct" ? "✓ " : "✗ ");
      node.insertBefore(mark, node.firstChild);   // shape + color (colorblind-safe)
    }

    /* ---------------------------------------------------------------------- */
    /* puzzles (ported; deterministic)                                        */
    /* ---------------------------------------------------------------------- */
    // (v0.176.0, V1.1 ARM#6) T0 = the classic six; T1 adds TRACE; T2 adds DECRYPT and deals
    // the hard half first so late-sector puzzle cores bite as hard as late-sector combat.
    function puzzleRosterFor(t) {
      if (t === 0) return runRng.shuffle(PUZZLE_TYPES.slice());
      if (t === 1) return runRng.shuffle(PUZZLE_TYPES.concat(["trace"]));
      return runRng.shuffle(PUZZLE_HARD.slice()).concat(runRng.shuffle(PUZZLE_EASY.slice()));
    }
    // (ARM#6) DECRYPT — 4-symbol mastermind against the stability timer. Tap slots to cycle
    // glyphs, TRANSMIT to grade: gold pips = right glyph right slot, aqua = right glyph
    // wrong slot. Crack it before the breach.
    function puzzleDecrypt(done) {
      panel.className = "arm-panel iris"; clear(panel);
      var GLY = ["\u25B2", "\u25C6", "\u25CF", "\u25A0", "\u2726"], N = 4, A = GLY.length;
      var secret = [], guess = [], tries = 0, lastEx = -1, lastNear = -1;
      for (var i = 0; i < N; i++) { secret.push(rint(A)); guess.push(0); }
      function grade(g) {
        var ex = 0, sc = [0, 0, 0, 0, 0], gc = [0, 0, 0, 0, 0];
        for (var k = 0; k < N; k++) { if (g[k] === secret[k]) ex++; else { sc[secret[k]]++; gc[g[k]]++; } }
        var near = 0; for (var s2 = 0; s2 < A; s2++) near += Math.min(sc[s2], gc[s2]);
        return { exact: ex, near: near };
      }
      activePuzzle = {
        type: "decrypt",
        probe: function () { return { len: N, alphabet: A, secret: secret.slice(), tries: tries, lastExact: lastEx, lastNear: lastNear, solved: lastEx === N }; },
        tryGuess: function (g) { guess = g.slice(); return transmit(); },      // test seam: grade an arbitrary guess
        tapSolve: function () { guess = secret.slice(); transmit(); }
      };
      panel.appendChild(mk("div", "arm-eyebrow e-iris", "\u26A1 Cipher lock"));
      panel.appendChild(mk("h2", null, "Decrypt the BCM cipher"));
      panel.appendChild(mk("p", "arm-sub", "Tap each slot to cycle its glyph, then TRANSMIT. Gold pips: right glyph, right slot. Aqua: right glyph, wrong slot."));
      var pwrap = mk("div", "arm-pwrap"); var row = mk("div", "arm-dec-row"); pwrap.appendChild(row);
      var pips = mk("div", "arm-dec-pips"); pwrap.appendChild(pips);
      var ph = mk("div", "arm-hint"); ph.textContent = "Crack the 4-glyph cipher"; pwrap.appendChild(ph); panel.appendChild(pwrap);
      var slotEls = [];
      for (var i3 = 0; i3 < N; i3++) {
        (function (i4) {
          var b = mk("button", "arm-dec-slot"); b.textContent = GLY[guess[i4]];
          on(b, "click", function () { guess[i4] = (guess[i4] + 1) % A; b.textContent = GLY[guess[i4]]; sfx("fire"); });
          slotEls.push(b); row.appendChild(b);
        })(i3);
      }
      var tx = mk("button", "arm-act aqua"); tx.textContent = "TRANSMIT \u25b8"; panel.appendChild(tx);
      function transmit() {
        tries++;
        var r = grade(guess); lastEx = r.exact; lastNear = r.near;
        clear(pips);
        for (var p1 = 0; p1 < r.exact; p1++) pips.appendChild(mk("span", "arm-pip gold"));
        for (var p2 = 0; p2 < r.near; p2++) pips.appendChild(mk("span", "arm-pip aqua"));
        for (var p3 = r.exact + r.near; p3 < N; p3++) pips.appendChild(mk("span", "arm-pip off"));
        if (r.exact === N) { ph.textContent = "Cipher cracked \u2726"; sfx("solve"); later(done, 450); }
        else { ph.textContent = r.exact + " locked \u00b7 " + r.near + " misplaced \u00b7 keep going"; }
        return r;
      }
      on(tx, "click", function () { sfx("click"); transmit(); });
    }
    // (ARM#6) TRACE — route the signal through the conduit maze. The path is generated FIRST
    // (a seeded lattice walk), then decoy conduits are added: solvable by construction, the
    // same guarantee rewire gives. Tap a linked node to extend the trace; tap the head to back up.
    function puzzleTrace(done) {
      panel.className = "arm-panel iris"; clear(panel);
      var GW = 4, GH = 4;
      var inY = rint(GH), outY = rint(GH);
      var cond = {};                                             // "x,y-x2,y2" (ordered) -> conduit exists
      function ck(x1, y1, x2, y2) { return (x1 < x2 || (x1 === x2 && y1 < y2)) ? x1 + "," + y1 + "-" + x2 + "," + y2 : x2 + "," + y2 + "-" + x1 + "," + y1; }
      var path = [[0, inY]], px = 0, py = inY;
      while (px < GW - 1 || py !== outY) {                       // lattice walk: step right, or drift toward outY
        var stepRight = (px < GW - 1) && (py === outY || rint(2) === 0);
        if (stepRight) { cond[ck(px, py, px + 1, py)] = 1; px++; }
        else { var ny = py + (outY > py ? 1 : -1); cond[ck(px, py, px, ny)] = 1; py = ny; }
        path.push([px, py]);
      }
      var pathOk = true;                                         // self-validation: every path hop has its conduit
      for (var v1 = 1; v1 < path.length; v1++) { if (!cond[ck(path[v1 - 1][0], path[v1 - 1][1], path[v1][0], path[v1][1])]) pathOk = false; }
      var decoys = 5 + rint(4);                                  // decoy conduits AFTER the true path (never removes it)
      for (var d1 = 0; d1 < decoys; d1++) {
        var dx = rint(GW), dy = rint(GH), dir = rint(2);
        var ex2 = dir === 0 ? dx + 1 : dx, ey2 = dir === 0 ? dy : dy + 1;
        if (ex2 < GW && ey2 < GH) cond[ck(dx, dy, ex2, ey2)] = 1;
      }
      var trace = [[0, inY]];
      function head() { return trace[trace.length - 1]; }
      function solvedNow() { var h = head(); return h[0] === GW - 1 && h[1] === outY; }
      activePuzzle = {
        type: "trace",
        probe: function () { return { w: GW, h: GH, inY: inY, outY: outY, pathOk: pathOk, pathLen: path.length, traceLen: trace.length, conduits: Object.keys(cond).length, solved: solvedNow() }; },
        tapSolve: function () { trace = path.slice(); render(); }
      };
      panel.appendChild(mk("div", "arm-eyebrow e-iris", "\u26A1 Signal trace"));
      panel.appendChild(mk("h2", null, "Route the signal to the relay"));
      panel.appendChild(mk("p", "arm-sub", "Tap a linked node to extend the trace from IN to OUT. Tap the trace head to back up. Only lit conduits carry signal."));
      var pwrap = mk("div", "arm-pwrap"); var grid = mk("div", "arm-trace"); grid.style.gridTemplateColumns = "repeat(" + GW + ", 1fr)"; pwrap.appendChild(grid);
      var ph = mk("div", "arm-hint"); pwrap.appendChild(ph); panel.appendChild(pwrap);
      var nodeEls = [];
      for (var gy = 0; gy < GH; gy++) for (var gx = 0; gx < GW; gx++) {
        (function (x, y) {
          var b = mk("button", "arm-trace-node");
          b.textContent = (x === 0 && y === inY) ? "IN" : (x === GW - 1 && y === outY) ? "OUT" : "\u25CF";
          on(b, "click", function () {
            var h = head();
            if (x === h[0] && y === h[1] && trace.length > 1) { trace.pop(); sfx("fire"); render(); return; }   // back up
            var adj = (Math.abs(x - h[0]) + Math.abs(y - h[1])) === 1;
            if (adj && cond[ck(h[0], h[1], x, y)] && !trace.some(function (t) { return t[0] === x && t[1] === y; })) {
              trace.push([x, y]); sfx("fire"); render();
            }
          });
          nodeEls[y * GW + x] = b; grid.appendChild(b);
        })(gx, gy);
      }
      function render() {
        for (var y2 = 0; y2 < GH; y2++) for (var x2 = 0; x2 < GW; x2++) {
          var el2 = nodeEls[y2 * GW + x2], onTrace = trace.some(function (t) { return t[0] === x2 && t[1] === y2; });
          var h2 = head(), isHead = h2[0] === x2 && h2[1] === y2;
          var linked = cond[ck(h2[0], h2[1], x2, y2)] && (Math.abs(x2 - h2[0]) + Math.abs(y2 - h2[1])) === 1;
          el2.className = "arm-trace-node" + (onTrace ? " lit" : "") + (isHead ? " head" : "") + (!onTrace && linked ? " link" : "");
        }
        if (solvedNow()) { ph.textContent = "Signal locked to the relay \u2726"; sfx("solve"); later(done, 450); }
        else ph.textContent = "Trace: " + trace.length + " node" + (trace.length === 1 ? "" : "s");
      }
      render();
    }
    function openPuzzle(core) {
      puzzleCore = core; puzzleDoneFlag = false;
      core.qOpen = true; clearActiveEBullets(); challengeLvl = coreLvl(core);
      setState("PUZZLE");
      pendingPuzzleDone = puzzleFinish;
      mountPuzzle();
    }
    function mountPuzzle() {
      var type = puzzleCore.puzType || puzzleCore.ch.type;
      if (type === "simon") { puzzleSimon(puzzleFinish); return; }   // Simon arms its own bar after playback (held during the watch phase)
      else if (type === "battery") puzzleBattery(puzzleFinish);
      else if (type === "vcpu") puzzleVcpu(puzzleFinish);
      else if (type === "rewire") puzzleRewire(puzzleFinish);
      else if (type === "sort") puzzleSort(puzzleFinish);
      else if (type === "decrypt") puzzleDecrypt(puzzleFinish);   // (v0.176.0, ARM#6)
      else if (type === "trace") puzzleTrace(puzzleFinish);
      else puzzleDials(puzzleFinish);
      armPuzzleTimer(puzzleSecsFor(type, 0, extraTime));   // panel already built; the bar goes on last
    }
    function puzzleFinish() {
      if (puzzleDoneFlag) return; puzzleDoneFlag = true;
      disarmPuzzleTimer(); pendingPuzzleDone = null;
      var core = puzzleCore; puzzleCore = null; core.qOpen = false; askCore(core);
    }
    function armPuzzleTimer(secs) {
      puzzleLimit = Math.max(PUZZLE_MIN, Math.round(secs || PUZZLE_MIN));   // S3: caller passes puzzleSecsFor(type,len,extra)
      puzzleTimer = puzzleLimit;
      puzzleWrap = mk("div", "arm-ptimer");
      puzzleWrap.appendChild(mk("span", "arm-ptimer-cap", "\u26A0 Core stability"));
      var track = mk("div", "arm-ptimer-track"); puzzleBar = mk("i", null); track.appendChild(puzzleBar);
      puzzleWrap.appendChild(track); panel.appendChild(puzzleWrap);
    }
    function disarmPuzzleTimer() { puzzleLimit = 0; puzzleTimer = 0; puzzleBar = null; puzzleWrap = null; puzzleTimerHold = false; activePuzzle = null; }
    function updatePuzzleTimer(dt) {
      if (puzzleLimit <= 0 || puzzleTimerHold) return;   // S3: hold freezes the bar during Simon's watch phase
      puzzleTimer -= dt;
      var f = puzzleTimer / puzzleLimit; if (f < 0) f = 0;
      if (puzzleBar) puzzleBar.style.width = (f * 100).toFixed(1) + "%";
      if (puzzleWrap) puzzleWrap.classList.toggle("low", puzzleTimer <= 5);
      if (puzzleTimer <= 0) puzzleExpire();
    }
    function puzzleExpire() {
      if (puzzleLimit <= 0) return;
      puzzleLimit = 0;                     // disarm first (prevents re-entry)
      sfx("wrong"); damage(PUZZLE_FAIL_DMG);
      if (shields > 0 && state === "PUZZLE") mountPuzzle();   // breach: rebuild a fresh challenge + re-arm
      // if shields hit 0, damage() already triggered gameOver()
    }
    function puzzleSimon(done) {
      panel.className = "arm-panel iris"; clear(panel);
      // (v0.93.0, A7, Jason) 9 was too much to hold: caps are easy 5 / medium 6 / hard 8
      var simonTier = tierOf(sector);
      var len = simonTier === 0 ? 5 : simonTier === 1 ? 6 : 8;
      activePuzzle = { type: "simon", len: len, probe: function () { return { len: len, playing: playing }; } };
      var seq = []; for (var i = 0; i < len; i++) seq.push(rint(4));
      panel.appendChild(mk("div", "arm-eyebrow e-iris", "⚙ Signal sequence"));
      panel.appendChild(mk("h2", null, "Repeat the core's pulse"));
      panel.appendChild(mk("p", "arm-sub", "Watch the sequence, then tap it back. One miss replays it. The timer starts when it's your turn."));
      var pwrap = mk("div", "arm-pwrap"); var padsEl = mk("div", "arm-pads");
      var pads = [];
      for (var p = 0; p < 4; p++) { var pad = mk("div", "arm-pad p" + p); pads.push(pad); padsEl.appendChild(pad); }
      pwrap.appendChild(padsEl);
      var ph = mk("div", "arm-hint", "Watch…"); pwrap.appendChild(ph); panel.appendChild(pwrap);
      var idx = 0, playing = true;
      var flashMs = extraTime ? 620 : 420, gapMs = extraTime ? 220 : 140, startMs = extraTime ? 720 : 500;
      function flash(i, cb) { pads[i].classList.add("lit"); sfx("click"); later(function () { pads[i].classList.remove("lit"); later(cb, gapMs); }, flashMs); }
      function play() {
        playing = true; ph.textContent = "Watch…";
        puzzleTimerHold = true;   // S3: freeze the stability bar while the sequence plays (no-op on the first pass — bar isn't armed yet)
        var j = 0;
        function step() {
          if (j >= seq.length) {
            playing = false; idx = 0; ph.textContent = "Your turn — 0 / " + len;
            if (puzzleLimit <= 0) armPuzzleTimer(puzzleSecsFor("simon", len, extraTime));   // first turn: arm the bar now, after playback
            puzzleTimerHold = false;   // unfreeze (first-arm and replay-resume both land here)
            return;
          }
          flash(seq[j], function () { j++; step(); });
        }
        later(step, startMs);
      }
      for (var q = 0; q < pads.length; q++) {
        (function (i) {
          on(pads[i], "click", function () {
            if (playing) return;
            pads[i].classList.add("lit"); sfx("fire"); later(function () { pads[i].classList.remove("lit"); }, gapMs);
            if (i === seq[idx]) {
              idx++; ph.textContent = "Your turn — " + idx + " / " + len;
              if (idx >= seq.length) { ph.textContent = "Locked ✦"; sfx("solve"); later(done, flashMs); }
            } else { ph.textContent = "Wrong — replaying…"; sfx("wrong"); later(play, 700); }
          });
        })(q);
      }
      play();
    }
    function puzzleRewire(done) {
      panel.className = "arm-panel iris"; clear(panel);
      var COLS = 3 + Math.min(2, challengeLvl), ROWS = 2 + (challengeLvl >= 2 ? 1 : 0);
      var srcRow = rint(ROWS), snkRow = rint(ROWS);
      var ROT = { N: "E", E: "S", S: "W", W: "N" }, OPP = { N: "S", S: "N", E: "W", W: "E" };
      var DX = { E: 1, W: -1, N: 0, S: 0 }, DY = { N: -1, S: 1, E: 0, W: 0 }, ALL = ["N", "E", "S", "W"];
      function key(r, c) { return r + "," + c; }
      function rotSet(set, n) { var s = set.slice(); for (var k = 0; k < n; k++) { for (var m = 0; m < s.length; m++) s[m] = ROT[s[m]]; } return s; }
      var sol = {}; var r = srcRow, c = 0;
      function add(rr, cc, d) { var k = key(rr, cc); (sol[k] = sol[k] || []).push(d); }
      while (!(r === snkRow && c === COLS - 1)) {
        var canR = c < COLS - 1, needV = r !== snkRow;
        var move = (canR && (!needV || runRng.next() < 0.55)) ? "E" : (snkRow > r ? "S" : "N");
        var nr = r + DY[move], nc = c + DX[move]; add(r, c, move); add(nr, nc, OPP[move]); r = nr; c = nc;
      }
      add(srcRow, 0, "W"); add(snkRow, COLS - 1, "E");
      var cells = [];
      for (var rr = 0; rr < ROWS; rr++) {
        cells[rr] = [];
        for (var cc = 0; cc < COLS; cc++) {
          var k = key(rr, cc), isPath = !!sol[k];
          var base;
          if (isPath) { base = uniq(sol[k]); }
          else { var mn = 1 + rint(2), perm = runRng.shuffle(ALL.slice()); base = perm.slice(0, mn); }
          var rot = rint(4); if (isPath && rot === 0) rot = 1 + rint(3);
          cells[rr][cc] = { base: base, rot: rot, isPath: isPath };
        }
      }
      function uniq(a) { var o = [], seen = {}; for (var i = 0; i < a.length; i++) if (!seen[a[i]]) { seen[a[i]] = 1; o.push(a[i]); } return o; }
      function open(cell) { return rotSet(cell.base, cell.rot); }
      function litSet() {
        var lit = {}, q = [];
        if (incl(open(cells[srcRow][0]), "W")) { lit[key(srcRow, 0)] = 1; q.push([srcRow, 0]); }
        while (q.length) {
          var cur = q.shift(), rr2 = cur[0], cc2 = cur[1], od = open(cells[rr2][cc2]);
          for (var i = 0; i < od.length; i++) {
            var d = od[i], nr2 = rr2 + DY[d], nc2 = cc2 + DX[d];
            if (nr2 < 0 || nc2 < 0 || nr2 >= ROWS || nc2 >= COLS) continue;
            if (incl(open(cells[nr2][nc2]), OPP[d]) && !lit[key(nr2, nc2)]) { lit[key(nr2, nc2)] = 1; q.push([nr2, nc2]); }
          }
        }
        return lit;
      }
      function incl(arr, v) { for (var i = 0; i < arr.length; i++) if (arr[i] === v) return true; return false; }
      function solved(lit) { return !!lit[key(snkRow, COLS - 1)] && incl(open(cells[snkRow][COLS - 1]), "E"); }
      panel.appendChild(mk("div", "arm-eyebrow e-iris", "⚙ Reroute the data path"));
      panel.appendChild(mk("h2", null, "Connect source to sink"));
      panel.appendChild(mk("p", "arm-sub", "Tap a node to rotate its conduits. Light a continuous path from SRC to SNK."));
      var pg = mk("div", "arm-pgrid"); panel.appendChild(pg);
      var ph = mk("div", "arm-hint"); panel.appendChild(ph);
      function svgFor(cell, lit) {
        var col = lit ? COL.aqua : "#4a4a60", mid = { N: [26, 3], S: [26, 49], E: [49, 26], W: [3, 26] };
        var s = "", od = open(cell);
        for (var i = 0; i < od.length; i++) { var d = od[i]; s += '<line x1="26" y1="26" x2="' + mid[d][0] + '" y2="' + mid[d][1] + '" stroke="' + col + '" stroke-width="6" stroke-linecap="round"/>'; }
        return '<svg viewBox="0 0 52 52" width="52" height="52">' + s + '<circle cx="26" cy="26" r="5" fill="' + col + '"/></svg>';
      }
      function render() {
        var lit = litSet(); clear(pg);
        for (var rr2 = 0; rr2 < ROWS; rr2++) {
          var row = mk("div", "arm-prow");
          var sl = mk("div", "arm-pend" + (rr2 === srcRow ? " on" : ""), rr2 === srcRow ? "SRC▸" : ""); row.appendChild(sl);
          for (var cc2 = 0; cc2 < COLS; cc2++) {
            (function (rr3, cc3) {
              var cell = cells[rr3][cc3];
              var b = mk("button", "arm-pcell" + (lit[key(rr3, cc3)] ? " lit" : ""));
              b.innerHTML = svgFor(cell, !!lit[key(rr3, cc3)]);   // static SVG, no dynamic text
              on(b, "click", function () { cell.rot = (cell.rot + 1) % 4; sfx("fire"); render(); });
              row.appendChild(b);
            })(rr2, cc2);
          }
          var sk = mk("div", "arm-pend" + (rr2 === snkRow ? " on" : ""), rr2 === snkRow ? "▸SNK" : ""); row.appendChild(sk);
          pg.appendChild(row);
        }
        var ok = solved(lit);
        ph.textContent = ok ? "Path connected ✦" : "Rotate the nodes to bridge SRC ▸ SNK";
        if (ok) { sfx("solve"); later(done, 450); }
      }
      render();
    }
    function puzzleDials(done) {
      panel.className = "arm-panel iris"; clear(panel);
      var n = 3 + (challengeLvl >= 2 ? 1 : 0), steps = 8;
      var cur = [], tgt = [];
      for (var i = 0; i < n; i++) { cur.push(rint(steps)); tgt.push(rint(steps)); }
      for (var j = 0; j < n; j++) { if (cur[j] === tgt[j]) cur[j] = (cur[j] + 1) % steps; }
      panel.appendChild(mk("div", "arm-eyebrow e-iris", "⚙ Align the replicas"));
      panel.appendChild(mk("h2", null, "Match every dial to its marker"));
      panel.appendChild(mk("p", "arm-sub", "Tap a dial to rotate it. Line each pointer up with its green marker."));
      var pwrap = mk("div", "arm-pwrap"); var dl = mk("div", "arm-dials");
      var ptrs = [], tgts = [], dials = [];
      for (var d = 0; d < n; d++) {
        var dial = mk("div", "arm-dial");
        var tg = mk("div", "arm-tgt"); var pt = mk("div", "arm-ptr");
        dial.appendChild(tg); dial.appendChild(pt);
        dials.push(dial); ptrs.push(pt); tgts.push(tg);
        (function (i) { on(dial, "click", function () { cur[i] = (cur[i] + 1) % steps; sfx("fire"); render(); }); })(d);
        dl.appendChild(dial);
      }
      pwrap.appendChild(dl); var ph = mk("div", "arm-hint"); pwrap.appendChild(ph); panel.appendChild(pwrap);
      function render() {
        var all = true;
        for (var i = 0; i < n; i++) {
          var ang = cur[i] / steps * 360, tang = tgt[i] / steps * 360;
          ptrs[i].style.transform = "translate(-50%,-100%) rotate(" + ang + "deg)";
          tgts[i].style.transform = "translateX(-50%) rotate(" + tang + "deg)";
          var m = cur[i] === tgt[i]; dials[i].classList.toggle("match", m); if (!m) all = false;
        }
        ph.textContent = all ? "Replicas aligned ✦" : "Aligning…";
        if (all) { sfx("solve"); later(done, 450); }
      }
      render();
    }
    // S3 NEW: polarity bank — tap an AA cell to flip it 180°; align every + terminal to its marked end.
    function puzzleBattery(done) {
      panel.className = "arm-panel iris"; clear(panel);
      var N = 4;
      var req = [], cur = [];
      for (var i = 0; i < N; i++) { req.push(rint(2)); cur.push(rint(2)); }   // 0 = + faces right, 1 = + faces left
      var matched = true; for (var i2 = 0; i2 < N; i2++) if (cur[i2] !== req[i2]) { matched = false; break; }
      if (matched) cur[rint(N)] ^= 1;   // never start already-aligned
      function allOk() { for (var i = 0; i < N; i++) if (cur[i] !== req[i]) return false; return true; }
      activePuzzle = {
        type: "battery",
        probe: function () { return { req: req.slice(), cur: cur.slice(), solved: allOk() }; },
        tapSolve: function () { for (var i = 0; i < N; i++) cur[i] = req[i]; render(); }   // test seam: force-align then render fires done
      };
      panel.appendChild(mk("div", "arm-eyebrow e-iris", "\u26A1 Polarity bank"));
      panel.appendChild(mk("h2", null, "Match every cell's polarity"));
      panel.appendChild(mk("p", "arm-sub", "Tap a cell to flip it 180\u00B0. Align each + terminal to the lit marker above it."));
      var pwrap = mk("div", "arm-pwrap"); var bank = mk("div", "arm-batt"); pwrap.appendChild(bank);
      var ph = mk("div", "arm-hint"); pwrap.appendChild(ph); panel.appendChild(pwrap);
      var cellEls = [];
      for (var i3 = 0; i3 < N; i3++) {
        (function (i) {
          var slot = mk("div", "arm-batt-slot");
          var b = mk("button", "arm-batt-cell"); b.innerHTML = battSvg(cur[i], req[i]);
          on(b, "click", function () { cur[i] ^= 1; sfx("fire"); render(); });
          slot.appendChild(b); cellEls[i] = b; bank.appendChild(slot);
        })(i3);
      }
      function battSvg(c, r) {
        var plusRight = (c === 0), reqRight = (r === 0);
        var cap = COL.gold, neg = "#8794ad", body = "#23232f";
        var nubX = plusRight ? 64 : -6, txtPlusX = plusRight ? 53 : 11, txtNegX = plusRight ? 11 : 53;
        var arrow = reqRight ? "+ \u25B8" : "\u25C2 +";   // marker shows which end the + should face
        var s = '<svg viewBox="-8 -20 80 52" width="86" height="56">';
        s += '<text x="32" y="-7" text-anchor="middle" font-size="12" font-weight="700" fill="' + COL.aqua + '">' + arrow + '</text>';
        s += '<rect x="0" y="0" width="64" height="28" rx="4" fill="' + body + '" stroke="#45455c" stroke-width="2"/>';
        s += '<rect x="' + nubX + '" y="9" width="6" height="10" rx="2" fill="' + cap + '"/>';
        s += '<text x="' + txtPlusX + '" y="20" text-anchor="middle" font-size="16" font-weight="800" fill="' + cap + '">+</text>';
        s += '<text x="' + txtNegX + '" y="20" text-anchor="middle" font-size="18" font-weight="800" fill="' + neg + '">\u2212</text>';
        s += '</svg>';
        return s;
      }
      function render() {
        var all = true;
        for (var i = 0; i < N; i++) {
          cellEls[i].innerHTML = battSvg(cur[i], req[i]);
          var m = cur[i] === req[i]; cellEls[i].parentNode.classList.toggle("ok", m); if (!m) all = false;
        }
        ph.textContent = all ? "Polarity aligned \u2726" : "Flip cells so every + meets its marker";
        if (all) { sfx("solve"); later(done, 450); }
      }
      render();
    }
    // S3 NEW: vCPU divide — split a node's vCPUs evenly across its VMs (capacity planning / oversubscription).
    function puzzleVcpu(done) {
      panel.className = "arm-panel iris"; clear(panel);
      var count = clamp(3 + (sector - 1) + rint(2), 3, 6);   // more VMs in later sectors
      var perVM = clamp(2 + (sector - 1) + rint(2), 2, 4);   // higher per-VM target in later sectors
      var cap = count * perVM, MAXV = perVM * 2 + 2;
      var alloc = []; for (var i = 0; i < count; i++) alloc.push(rint(perVM + 1));   // 0..perVM: generally uneven & under-full
      function isSolved() { var s = 0; for (var i = 0; i < count; i++) { if (alloc[i] !== perVM) return false; s += alloc[i]; } return s === cap; }
      if (isSolved()) { var z = rint(count); alloc[z] = Math.max(0, alloc[z] - 1); }   // never start solved
      activePuzzle = {
        type: "vcpu",
        probe: function () { var s = 0, ev = true; for (var i = 0; i < count; i++) { s += alloc[i]; if (alloc[i] !== alloc[0]) ev = false; } return { count: count, perVM: perVM, cap: cap, alloc: alloc.slice(), allocated: s, even: ev, solved: isSolved() }; },
        tapSolve: function () { for (var i = 0; i < count; i++) alloc[i] = perVM; render(); }   // test seam
      };
      panel.appendChild(mk("div", "arm-eyebrow e-iris", "\u2699 Capacity planner"));
      panel.appendChild(mk("h2", null, "Balance the node's vCPUs"));
      panel.appendChild(mk("p", "arm-sub", "Divide " + cap + " vCPUs evenly across " + count + " VMs \u2014 no spare, none oversubscribed."));
      var pwrap = mk("div", "arm-pwrap"); var vmwrap = mk("div", "arm-vms"); pwrap.appendChild(vmwrap);
      var readout = mk("div", "arm-vcpu-read"); pwrap.appendChild(readout);
      var allrow = mk("div", "arm-vcpu-all");
      allrow.appendChild(btn("arm-vcpu-allbtn", "\u22121 all", function () { for (var i = 0; i < count; i++) alloc[i] = Math.max(0, alloc[i] - 1); sfx("fire"); render(); }));
      allrow.appendChild(btn("arm-vcpu-allbtn", "+1 all", function () { for (var i = 0; i < count; i++) alloc[i] = Math.min(MAXV, alloc[i] + 1); sfx("fire"); render(); }));
      pwrap.appendChild(allrow);
      var ph = mk("div", "arm-hint"); pwrap.appendChild(ph); panel.appendChild(pwrap);
      var bars = [];
      for (var i4 = 0; i4 < count; i4++) {
        (function (i) {
          var row = mk("div", "arm-vm");
          row.appendChild(mk("span", "arm-vm-tag", "VM" + (i + 1)));
          row.appendChild(btn("arm-vm-step", "\u2212", function () { alloc[i] = Math.max(0, alloc[i] - 1); sfx("fire"); render(); }));
          var meter = mk("div", "arm-vm-meter"); var fill = mk("i", null); meter.appendChild(fill); row.appendChild(meter);
          var num = mk("b", "arm-vm-num", "0"); row.appendChild(num);
          row.appendChild(btn("arm-vm-step", "+", function () { alloc[i] = Math.min(MAXV, alloc[i] + 1); sfx("fire"); render(); }));
          vmwrap.appendChild(row); bars[i] = { fill: fill, num: num, row: row };
        })(i4);
      }
      function render() {
        var s = 0, even = true;
        for (var i = 0; i < count; i++) { s += alloc[i]; if (alloc[i] !== alloc[0]) even = false; }
        for (var i5 = 0; i5 < count; i5++) {
          bars[i5].fill.style.width = Math.round(alloc[i5] / MAXV * 100) + "%";
          bars[i5].num.textContent = String(alloc[i5]);
          bars[i5].row.classList.toggle("target", alloc[i5] === perVM);
        }
        var spare = cap - s;
        var spTxt = spare === 0 ? "No spare" : (spare > 0 ? ("Spare " + spare) : ("Over " + (-spare)));
        readout.innerHTML = '<span>Allocated <b>' + s + '</b> / ' + cap + '</span><span>' + spTxt + '</span><span class="' + (even ? "ok" : "no") + '">' + (even ? "Even \u2713" : "Even \u2717") + '</span>';
        var ok = isSolved();
        ph.textContent = ok ? "Node balanced \u2726" : "Make every VM equal with no spare capacity";
        if (ok) { sfx("solve"); later(done, 450); }
      }
      render();
    }
    // NEW: swap-to-sort — tap two signal bands to swap; order them low->high, left->right.
    function puzzleSort(done) {
      panel.className = "arm-panel iris"; clear(panel);
      var n = 4 + Math.min(2, challengeLvl);
      var vals = []; for (var i = 0; i < n; i++) vals.push(i + 1);
      vals = runRng.shuffle(vals.slice());
      function asc() { for (var i = 1; i < n; i++) if (vals[i] < vals[i - 1]) return false; return true; }
      if (asc()) { var t0 = vals[0]; vals[0] = vals[n - 1]; vals[n - 1] = t0; }   // never start sorted
      panel.appendChild(mk("div", "arm-eyebrow e-iris", "\u2699 Frequency realigner"));
      panel.appendChild(mk("h2", null, "Sort the signal bands"));
      panel.appendChild(mk("p", "arm-sub", "Tap two bands to swap them. Order them low to high, left to right."));
      var pwrap = mk("div", "arm-pwrap"); var row = mk("div", "arm-sort"); pwrap.appendChild(row);
      var ph = mk("div", "arm-hint"); pwrap.appendChild(ph); panel.appendChild(pwrap);
      var sel = -1;
      function pick(i) {
        if (sel < 0) { sel = i; sfx("fire"); render(); return; }
        if (sel === i) { sel = -1; render(); return; }
        var t = vals[sel]; vals[sel] = vals[i]; vals[i] = t; sel = -1; sfx("fire"); render();
      }
      function render() {
        clear(row);
        for (var i = 0; i < n; i++) {
          (function (i) {
            var b = mk("button", "arm-band" + (sel === i ? " sel" : ""));
            b.style.height = (30 + vals[i] / n * 66) + "px";
            b.appendChild(mk("b", null, String(vals[i])));
            on(b, "click", function () { pick(i); });
            row.appendChild(b);
          })(i);
        }
        if (asc()) { ph.textContent = "Bands aligned \u2726"; sfx("solve"); later(done, 450); }
        else ph.textContent = sel < 0 ? "Tap a band to pick it up" : "Tap another band to swap";
      }
      render();
    }

    /* ---------------------------------------------------------------------- */
    /* shop (ported)                                                          */
    /* ---------------------------------------------------------------------- */
    // (v0.93.0, A1) Consumables removed (Jason) — the hangar sells upgrades only; shields
    // come back from play (recharge, A8), not from a 20-coin tap.
    function showShop(back) {
      setState("SHOP"); panel.className = "arm-panel iris"; clear(panel);
      var ups = [
        { ic: "🚀", nm: "Engine Boost", ds: "+6% thrust", key: "engine" },
        { ic: "🎯", nm: "Maneuvering", ds: "+5% turn rate", key: "maneuver" },
        { ic: "🔋", nm: "Capacitor", ds: "+1 charge (fire bursts)", key: "capacitor" },
        { ic: "💠", nm: "Shield Cell", ds: "Faster shield recharge", key: "shieldCell" },   // (v0.93.0, A8) was +25 max shields
        { ic: "⚡", nm: "Rapid Fire", ds: "−7% recharge time", key: "rapid" },
      ];
      // (v0.96.0, A6) priced so a full-clear sector (~250 ⬡ post-retune) buys 1, sometimes 2
      var MAX_TIER = 8;
      var baseCost = { engine: 120, maneuver: 110, capacitor: 130, shieldCell: 130, rapid: 140 };
      function upCost(k) { return baseCost[k] + lvl[k] * 60; }

      panel.appendChild(mk("div", "arm-eyebrow e-gold", "⚙ Hangar bay"));
      var h = mk("h2", null, "Outfit your ship "); var bal = mk("span", "arm-balance", coins + " ⬡"); h.appendChild(bal); panel.appendChild(h);

      var grid = mk("div", "arm-shopgrid"); panel.appendChild(grid);
      {
        for (var i = 0; i < ups.length; i++) (function (it) {
          var L = lvl[it.key], capped = L >= MAX_TIER, cost = upCost(it.key), afford = coins >= cost && !capped;
          var item = mk("div", "arm-item");
          item.appendChild(mk("div", "arm-ic", it.ic));
          var info = mk("div", "arm-info");
          info.appendChild(mk("div", "arm-nm", it.nm)); info.appendChild(mk("div", "arm-ds", it.ds));
          var pips = mk("div", "arm-pips");
          for (var p = 0; p < MAX_TIER; p++) pips.appendChild(mk("span", "arm-pip" + (p < L ? " on" : "")));
          info.appendChild(pips); item.appendChild(info);
          var b = btn("arm-buy", capped ? "MAX" : (cost + " ⬡"), function () {
            if (coins >= cost && lvl[it.key] < MAX_TIER) { coins -= cost; lvl[it.key]++; deriveStats(); if (it.key === "capacitor") charges = maxCharges; sfx("correct"); hud(); showShop(back); }
          });
          if (!afford) b.disabled = true; item.appendChild(b); grid.appendChild(item);
        })(ups[i]);
      }
      panel.appendChild(btn("arm-act", "Leave hangar ▸", function () { sfx("click"); back(); }));
    }

    /* ---------------------------------------------------------------------- */
    /* settings (in-game menu; a11y toggles)                                  */
    /* ---------------------------------------------------------------------- */
    function devMode() {
      try { return !!(win && (win.STARNIX_DEV || (win.location && win.location.search && /[?&]dev\b/.test(win.location.search)))); } catch (e) { return false; }
    }
    function devSkipToBoss() {
      sector = 3; usedIds = []; held = []; sectorLost = [];   // jump straight to the first dreadnought
      drawCoreQuestions(); buildSectorWorld();
      shields = maxShields; charges = maxCharges; invuln = 0;  // give a clean ship so the fight is testable
      setState("SECTOR");
      try { showToast("Dev: jumped to boss \u2014 sector 3"); } catch (e) {}
    }
    function showSettings() {
      prevState = (state === "SETTINGS") ? prevState : state;
      setState("SETTINGS"); panel.className = "arm-panel iris"; clear(panel);
      panel.appendChild(mk("div", "arm-eyebrow e-iris", "⚙ Menu"));
      panel.appendChild(mk("h2", null, "Settings"));
      panel.appendChild(toggleRow("Music", musicOn, function (v) { musicOn = v; try { AUD.setMusic(v); } catch (e) {} persistSetting("music", v); }));
      panel.appendChild(toggleRow("Sound effects", sfxOn, function (v) { sfxOn = v; try { AUD.setSfx(v); } catch (e) {} persistSetting("sfx", v); }));
      panel.appendChild(toggleRow("Reduced motion", reducedMotion, function (v) { reducedMotion = v; persistSetting("reducedMotion", v); }));
      panel.appendChild(toggleRow("Extra time", extraTime, function (v) { extraTime = v; persistSetting("extraTime", v); }));
      panel.appendChild(toggleRow("Smooth difficulty", smoothDiff, function (v) { smoothDiff = v; persistSetting("armSmoothDiff", v); }));   // (v0.155.0, ARM#4 / 02 s3D)
      if (devMode()) {   // (cleanup) dev tools only in dev mode (STARNIX_DEV / ?dev) — no longer shipped to players
        panel.appendChild(mk("div", "arm-eyebrow e-peach", "\u2699 Dev tools"));
        var devrow = mk("div", "arm-btnrow");
        devrow.appendChild(btn("arm-act ghost", "Skip to boss fight \u25b8", function () { sfx("click"); devSkipToBoss(); }));
        panel.appendChild(devrow);
      }
      // (v0.189.0, V1.1 ARM#8) SHIP'S LOG — re-read this sector's briefings outside combat.
      // Renders what Vega actually SAYS: the composed teachLine, its answer landing LAST (A5).
      // Retrieval support right before a core scan, at zero new-content cost (02 s'ship's log').
      if (cores.length) {
        panel.appendChild(mk("div", "arm-eyebrow e-aqua", "\u25a4 Ship's log \u00b7 sector " + sector));
        var logWrap = mk("div", "arm-log");
        for (var li = 0; li < cores.length; li++) {
          (function (core) {
            var stL = core.state === "collected" ? "INSTALLED" : core.state === "lost" ? "LOST" : "PENDING";
            var entry = mk("div", "arm-log-entry" + (core.state === "collected" ? " got" : core.state === "lost" ? " lost" : ""));
            var head = mk("div", "arm-log-head");
            head.appendChild(mk("span", "arm-log-tag", conceptTag(core)));
            head.appendChild(mk("span", "arm-log-st arm-log-" + stL.toLowerCase(), stL));
            entry.appendChild(head);
            var tL = teachLine(core);
            if (tL.body) entry.appendChild(mk("div", "arm-log-why", tL.body));
            if (tL.close) entry.appendChild(mk("div", "arm-log-key", tL.close));   // (A5) the answer lands LAST
            logWrap.appendChild(entry);
          })(cores[li]);
        }
        panel.appendChild(logWrap);
      }
      var row = mk("div", "arm-btnrow");
      row.appendChild(btn("arm-act", "Resume ▸", function () { sfx("click"); setState(prevState || "SECTOR"); }));
      panel.appendChild(row);
      panel.appendChild(btn("arm-act ghost", "Quit to menu", function () { sfx("click"); requestExit(); }));
    }
    function toggleRow(label, val, onChange) {
      var r = mk("div", "arm-toggle"); r.appendChild(mk("span", null, label));
      var sw = mk("div", "arm-sw" + (val ? " on" : "")); sw.appendChild(mk("i"));
      on(sw, "click", function () { var nv = !sw.classList.contains("on"); sw.classList.toggle("on", nv); sfx("click"); onChange(nv); });
      r.appendChild(sw); return r;
    }
    // (v0.94.0, A3) hidden one-time achievement: every asteroid in the sector destroyed.
    // ARM only sets the profile flag (contract-clean via ctx.persistence); the core's
    // evaluate pass awards "Belt sweeper" at the next natural trigger (answer/run end).
    var beltClearedSent = false;
    function markBeltCleared() {
      if (beltClearedSent) return; beltClearedSent = true;
      try {
        if (PERS && PERS.update) PERS.update(function (p) { p.armBeltCleared = true; });   // (v0.108.0, G4) live profile — the award trigger reads THIS object
        else if (PERS && PERS.load && PERS.save) PERS.load().then(function (p) { if (!p.armBeltCleared) { p.armBeltCleared = true; return PERS.save(p); } }).catch(function () {});
      } catch (e) {}
    }
    function persistSetting(k, v) {
      try {
        if (PERS && PERS.update) PERS.update(function (p) { p.settings = p.settings || {}; p.settings[k] = v; });   // (v0.108.0, G4) live profile
        else if (PERS && PERS.load && PERS.save) PERS.load().then(function (p) { p.settings = p.settings || {}; p.settings[k] = v; return PERS.save(p); }).catch(function () {});
      } catch (e) {}
    }

    /* ---------------------------------------------------------------------- */
    /* update                                                                 */
    /* ---------------------------------------------------------------------- */
    // (v0.44.0 feel, A3) the camera LEADS the velocity and springs toward its target instead of
    // hard-locking to the hull — the frame breathes with flight. Reduced-motion = no lead, stiffer spring.
    function camTo(tx, ty, dt) {
      var k = dt ? Math.min(1, dt * (reducedMotion ? 14 : 8)) : 1;   // (v0.69.0, J1) tighter spring = less lag-chase swim
      camX += (tx - camX) * k; camY += (ty - camY) * k;
    }
    function camera(dt) {
      var lead = reducedMotion ? 0 : 0.15;
      camTo(clamp(ship.x + ship.vx * lead - W / 2, 0, Math.max(0, MAP_W - W)), clamp(ship.y + ship.vy * lead - H / 2, 0, Math.max(0, MAP_H - H)), dt);
    }
    function homeCamera(dt) {
      var lead = reducedMotion ? 0 : 0.15;
      camTo(clamp(ship.x + ship.vx * lead - W / 2, 0, Math.max(0, HOME_W - W)), clamp(ship.y + ship.vy * lead - H / 2, 0, Math.max(0, HOME_H - H)), dt);
    }

    function updateSector(dt) {
      var R = shipR();
      if (bossActive) {
        // Galaga arena: ship flies 4-directionally inside a narrow channel, always faces up (no turning)
        ship.angle = -Math.PI / 2;
        var asp = 372 * dt;
        if (input.left) ship.x -= asp;
        if (input.right) ship.x += asp;
        if (input.thrust) ship.y -= asp;   // Up / W / ▲
        if (input.down) ship.y += asp;     // Down / S
        var AR = bossArena();
        ship.x = clamp(ship.x, AR.l + R, AR.r - R);
        ship.y = clamp(ship.y, AR.top + R, AR.bot - R);
        ship.vx = ship.vy = 0;
        camX = 0; camY = 0;
      } else {
        if (input.left) ship.angle -= shipTurn * dt;
        if (input.right) ship.angle += shipTurn * dt;
        shipBank += (((input.right ? 1 : 0) - (input.left ? 1 : 0)) - shipBank) * Math.min(1, dt * 7);   // (A2) eased roll
        if (input.thrust) { ship.vx += Math.cos(ship.angle) * shipThrust * dt; ship.vy += Math.sin(ship.angle) * shipThrust * dt; }
        var damp = Math.exp(-DRAG * dt); ship.vx *= damp; ship.vy *= damp; ship.x += ship.vx * dt; ship.y += ship.vy * dt;
        ship.x = clamp(ship.x, R, MAP_W - R); ship.y = clamp(ship.y, R, MAP_H - R);
      }
      if (charges < maxCharges) { rechargeTimer -= dt; if (rechargeTimer <= 0) { charges++; rechargeTimer += rechargeTime; } if (charges < 1) hud(); }   // (v0.93.0, A9) live bar while empty
      if (invuln > 0) invuln -= dt; if (input.fire) shoot();
      regenT += dt; if (regenT > shieldRegenDelay && shields < maxShields && shields > 0) { shields = Math.min(maxShields, shields + shieldRegenRate * dt); hud(); }   // (v0.93.0, A8)

      var i, j;
      for (i = 0; i < enemies.length; i++) {
        var e = enemies[i]; var a = Math.atan2(ship.y - e.y, ship.x - e.x); var sp = 72;
        if (e.type === 'orbiter') {
          // (v0.148.0, ARM#3) hold a ~240px standoff and strafe around it; quicker trigger
          var dd = dist2(e.x, e.y, ship.x, ship.y);
          var rad = (dd > 300) ? 1 : (dd < 190 ? -1 : 0);                 // in: too far / out: too close
          var tang = a + Math.PI / 2 * e.orb;                             // strafe direction
          e.vx += (Math.cos(a) * rad * 150 + Math.cos(tang) * 110) * dt;
          e.vy += (Math.sin(a) * rad * 150 + Math.sin(tang) * 110) * dt;
          sp = 105;
          var vo = Math.sqrt(e.vx * e.vx + e.vy * e.vy); if (vo > sp) { e.vx = e.vx / vo * sp; e.vy = e.vy / vo * sp; }
          e.x += e.vx * dt; e.y += e.vy * dt; e.shootCD -= dt;
          if (e.shootCD <= 0 && dd < 620) {
            e.shootCD = rnd(1.0, 1.8);                                    // faster cadence than a chaser
            spawnEBullet(e.x, e.y, Math.cos(a) * 250, Math.sin(a) * 250, 2.6); sfx("laser");
          }
        } else if (e.type === 'lancer') {
          // (v0.148.0, ARM#3) no gun. Approach -> 0.6s telegraph (dead stop) -> ramming dash.
          if (e.lstate === 0) {                                           // approach (or post-dash cooldown)
            e.lt -= dt;
            e.vx += Math.cos(a) * 130 * dt; e.vy += Math.sin(a) * 130 * dt;
            sp = 90;
            var vl = Math.sqrt(e.vx * e.vx + e.vy * e.vy); if (vl > sp) { e.vx = e.vx / vl * sp; e.vy = e.vy / vl * sp; }
            e.x += e.vx * dt; e.y += e.vy * dt;
            if (e.lt <= 0 && dist2(e.x, e.y, ship.x, ship.y) < 260) { e.lstate = 1; e.lt = 0.6; e.vx = 0; e.vy = 0; }
          } else if (e.lstate === 1) {                                    // telegraph: locked, flashing
            e.lt -= dt;
            e.lang = a;                                                   // tracks until the last instant
            if (e.lt <= 0) { e.lstate = 2; e.lt = 0.55; sfx("laser"); }
          } else {                                                        // dash on the locked line
            e.lt -= dt;
            e.x += Math.cos(e.lang) * 340 * dt; e.y += Math.sin(e.lang) * 340 * dt;
            if (e.lt <= 0) { e.lstate = 0; e.lt = 1.2; }
          }
        } else {
          e.vx += Math.cos(a) * 130 * dt; e.vy += Math.sin(a) * 130 * dt;
          var v = Math.sqrt(e.vx * e.vx + e.vy * e.vy); if (v > sp) { e.vx = e.vx / v * sp; e.vy = e.vy / v * sp; }
          e.x += e.vx * dt; e.y += e.vy * dt; e.shootCD -= dt;
          if (e.shootCD <= 0 && dist2(e.x, e.y, ship.x, ship.y) < 620) {
            e.shootCD = rnd(1.6, 2.8); var ang = Math.atan2(ship.y - e.y, ship.x - e.x);
            spawnEBullet(e.x, e.y, Math.cos(ang) * 250, Math.sin(ang) * 250, 2.6); sfx("laser");
          }
        }
      }
      for (i = 0; i < bullets.length; i++) { var b = bullets[i]; if (!b.active) continue; b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt; if (b.life <= 0 || b.x < 0 || b.x > MAP_W || b.y < 0 || b.y > MAP_H) b.active = false; }
      for (i = 0; i < ebullets.length; i++) { var eb = ebullets[i]; if (!eb.active) continue; eb.x += eb.vx * dt; eb.y += eb.vy * dt; eb.life -= dt; if (eb.life <= 0) eb.active = false; }

      // bullet -> enemy
      for (i = enemies.length - 1; i >= 0; i--) {
        var en = enemies[i];
        for (j = 0; j < bullets.length; j++) {
          var bb = bullets[j]; if (!bb.active) continue;
          if (dist2(en.x, en.y, bb.x, bb.y) < en.r + 3) {
            bb.active = false;
            if (--en.hp <= 0) {
              burst(en.x, en.y, COL.peach, 12); sfx("explode");
              enemies[i] = enemies[enemies.length - 1]; enemies.pop();
              coins += 3 + tierOf(sector); hud();   // (v0.96.0, A6 / v0.161.0, ARM#5) bounty ramps 3/4/5 by tier — late tiers reachable when tier-2 difficulty needs them
            } else { burst(en.x, en.y, COL.peach, 5); sfx("hit"); }
            break;
          }
        }
      }
      // bullet -> asteroid-encased core
      for (i = 0; i < cores.length; i++) {
        var core = cores[i];
        if (core.ch.type === "asteroid" && core.state === "locked" && core.gateActive && core.astHP > 0) {
          for (j = 0; j < bullets.length; j++) {
            var ab = bullets[j]; if (!ab.active) continue;
            if (dist2(core.x, core.y, ab.x, ab.y) < core.r + 16) {
              ab.active = false; core.astHP--; burst(core.x, core.y, COL.mid || "#9a9aad", 8); sfx("hit");
              if (core.astHP <= 0) { burst(core.x, core.y, COL.gold, 24); sfx("explode"); } break;
            }
          }
        }
      }
      // ambient asteroids: shootable, fragmenting
      for (i = asteroids.length - 1; i >= 0; i--) {
        var ast = asteroids[i];
        for (j = 0; j < bullets.length; j++) {
          var sb = bullets[j]; if (!sb.active) continue;
          if (dist2(ast.x, ast.y, sb.x, sb.y) < ast.r + 3) {
            sb.active = false; ast.hp--; burst(ast.x, ast.y, "#aeb0c4", 5); sfx("hit");
            if (ast.hp <= 0) {
              burst(ast.x, ast.y, "#cfd2ff", 16); sfx("explode"); coins += 1; hud();
              if (ast.r >= 22) {
                for (var f = 0; f < 2; f++) {
                  var ang2 = runRng.next() * TAU, nr = ast.r * 0.58, vc = 7 + rint(3), vv = [];
                  for (var m2 = 0; m2 < vc; m2++) vv.push(rnd(0.72, 1.12));
                  asteroids.push({ x: ast.x, y: ast.y, vx: Math.cos(ang2) * rnd(35, 80), vy: Math.sin(ang2) * rnd(35, 80), r: nr, verts: vv, rot: runRng.next() * TAU, vrot: rnd(-1, 1), hp: Math.max(1, Math.round(nr / 12)) });
                }
              }
              asteroids[i] = asteroids[asteroids.length - 1]; asteroids.pop();
              if (!bossActive && asteroids.length === 0) markBeltCleared();   // (v0.94.0, A3) hidden achievement seam
            }
            break;
          }
        }
      }
      // asteroid drift + ship collision
      for (i = 0; i < asteroids.length; i++) {
        var a2 = asteroids[i]; a2.x += a2.vx * dt; a2.y += a2.vy * dt; a2.rot += a2.vrot * dt;
        if (a2.x < a2.r || a2.x > MAP_W - a2.r) a2.vx *= -1; if (a2.y < a2.r || a2.y > MAP_H - a2.r) a2.vy *= -1;
        var d = dist2(ship.x, ship.y, a2.x, a2.y);
        if (d < a2.r + R) {
          var nx = (ship.x - a2.x) / (d || 1), ny = (ship.y - a2.y) / (d || 1), ov = a2.r + R - d;
          ship.x += nx * ov; ship.y += ny * ov; var dot = ship.vx * nx + ship.vy * ny; if (dot < 0) { ship.vx -= 1.6 * dot * nx; ship.vy -= 1.6 * dot * ny; }
          if (invuln <= 0) damage(6);
        }
      }
      // enemy ram + enemy bullets
      for (i = enemies.length - 1; i >= 0; i--) { var er = enemies[i]; if (dist2(er.x, er.y, ship.x, ship.y) < er.r + R) { burst(er.x, er.y, COL.peach, 12); var ram = er.type === 'lancer' ? 26 : 18; enemies[i] = enemies[enemies.length - 1]; enemies.pop(); if (invuln <= 0) damage(ram); } }   // (v0.148.0, ARM#3) the lancer's whole threat is its hull
      for (i = 0; i < ebullets.length; i++) { var xb = ebullets[i]; if (!xb.active) continue; if (dist2(xb.x, xb.y, ship.x, ship.y) < R + 3) { xb.active = false; if (invuln <= 0) damage(shotDmgFor(sector)); } }   // (v0.155.0, ARM#4) lerped, no cliff

      updateParticles(dt);
      checkCombatCleared();
      if (shakeAmt > 0) shakeAmt = Math.max(0, shakeAmt - dt * 26);   // (v0.69.0, J1) decay ALWAYS — it was caged inside updateBoss, freezing leaked shake for whole sectors
      if (bossActive && boss) updateBoss(dt);
      for (i = 0; i < cores.length; i++) {
        var co = cores[i]; co.pulse += dt * 3;
        if (co.state === "collected" || co.state === "lost") continue;
        if (bossActive && co.vy) {                       // a shed core drifting down — strafe under it to catch
          co.x += (co.vx || 0) * dt; co.y += co.vy * dt;
          if (co.x < co.r || co.x > W - co.r) co.vx = -(co.vx || 0);
          if (co.y > H + 28) { co.state = "lost"; sectorLost.push(co.q); sfx("wrong"); showToast("Core slipped past \u2014 lost for now"); burst(co.x, H, COL.peach, 12); afterResolve(); continue; }
        }
        var engaging = (co.ch.kind === "combat" && co.state === "locked" && !co.gateActive);
        var pad = engaging ? COMBAT_RING_PAD : EXTRACT_PAD;
        if (dist2(ship.x, ship.y, co.x, co.y) < co.r + pad) onArrive(co);
      }
      if (!bossActive) camera(dt);
    }
    function damage(n) { shields -= n; invuln = 0.7; regenT = 0; sfx("hit"); burst(ship.x, ship.y, COL.aqua, 6); hud(); if (shields <= 0) { shields = 0; gameOver(); } }
    function updateParticles(dt) { for (var i = 0; i < particles.length; i++) { var p = particles[i]; if (!p.active) continue; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.96; p.vy *= 0.96; p.life -= dt; if (p.life <= 0) p.active = false; } }
    var AIM_ASSIST = 0.1;   // (v0.94.0, A2, Jason) whisper-level: 10% of the angle error, capped at ~3 degrees
    function shoot() {
      if (charges < 1) return;                                  // only gate: a ready charge (always regenerates)
      charges--;
      if (charges === maxCharges - 1) rechargeTimer = rechargeTime;  // just left full -> start the recharge clock
      var R = shipR();
      // (v0.94.0, A2) Rapid Fire tiers loosen the barrel a touch (deterministic via runRng),
      // and every shot drifts a whisper toward the nearest threat — enemies in the field,
      // the active weakpoint in the boss arena. Allocation-free scan per 01 §13.
      var ang = ship.angle + ((lvl.rapid > 0 && runRng) ? (runRng.next() - 0.5) * Math.min(0.06, 0.015 * lvl.rapid) * 2 : 0);
      var tx = 0, ty = 0, hasT = false, bd = 1e18;
      if (bossActive && boss && boss.active) { var wpA = wpPos(boss.wpActive); tx = wpA.x; ty = wpA.y; hasT = true; }
      else { for (var ei = 0; ei < enemies.length; ei++) { var en2 = enemies[ei]; var ddx = en2.x - ship.x, ddy = en2.y - ship.y, dd = ddx * ddx + ddy * ddy; if (dd < bd) { bd = dd; tx = en2.x; ty = en2.y; hasT = true; } } }
      if (hasT) {
        var ta = Math.atan2(ty - ship.y, tx - ship.x);
        var dA = Math.atan2(Math.sin(ta - ang), Math.cos(ta - ang));
        if (Math.abs(dA) < 0.35) ang += Math.max(-0.05, Math.min(0.05, dA * AIM_ASSIST));
      }
      spawnBullet(ship.x + Math.cos(ang) * R, ship.y + Math.sin(ang) * R, Math.cos(ang) * bulletSpeed + ship.vx, Math.sin(ang) * bulletSpeed + ship.vy, 1.2);
      sfx("fire"); hud();
    }
    function updateHome(dt) {
      if (input.left) ship.angle -= shipTurn * dt; if (input.right) ship.angle += shipTurn * dt;
      shipBank += (((input.right ? 1 : 0) - (input.left ? 1 : 0)) - shipBank) * Math.min(1, dt * 7);   // (A2) eased roll
      if (input.thrust) { ship.vx += Math.cos(ship.angle) * shipThrust * dt; ship.vy += Math.sin(ship.angle) * shipThrust * dt; }
      var damp = Math.exp(-DRAG * dt); ship.vx *= damp; ship.vy *= damp; ship.x += ship.vx * dt; ship.y += ship.vy * dt;
      var R = shipR(); ship.x = clamp(ship.x, R, HOME_W - R); ship.y = clamp(ship.y, R, HOME_H - R);
      if (dist2(ship.x, ship.y, HS_X, HS_Y) < 78 + R) dockHome();
      homeCamera(dt);
    }
    function updateWarp(dt) {
      warpT += dt;
      var cd = warpCD(), seg = cd / 3;
      var idx = warpT >= cd ? 3 : Math.floor(warpT / seg);   // 0,1,2 = "3","2","1"; 3 = engage
      if (idx !== warpBeat) { warpBeat = idx; sfx(idx >= 3 ? "hyperdrive" : "count" + (3 - idx)); }
      if (warpT >= warpTotal()) { var d = warpDone; warpDone = null; if (d) d(); }
    }

    function updateActionBtn() {
      if (returnReady) {
        if (action.innerHTML !== "HYPER<br>DRIVE") { action.classList.add("warp"); action.innerHTML = "HYPER<br>DRIVE"; }
        action.classList.add("huge");   // S3: escape cue — large + pulsing once all cores are aboard
      }
      else { if (action.innerHTML !== "FIRE") { action.classList.remove("warp"); action.innerHTML = "FIRE"; } action.classList.remove("huge"); }
    }

    /* ---------------------------------------------------------------------- */
    /* draw (all guarded by c2d so the headless harness runs without canvas)  */
    /* ---------------------------------------------------------------------- */
    // (v0.44.0 feel) parallax starfield in SCREEN space, wrapped per layer. fore=false draws the
    // three background layers (d<=1) behind the world; fore=true draws the d>1 layer OVER the ship
    // (foreground occluders). At speed, stars streak along -velocity, scaled by depth (A4).
    function drawStarsParallax(fore) {
      var amp = reducedMotion ? 0 : 0.45;
      var spd = Math.hypot(ship.vx, ship.vy);
      var streak = (!reducedMotion && spd > 140) ? Math.min(16, (spd - 140) * 0.035) : 0;
      var nvx = spd > 1 ? ship.vx / spd : 0, nvy = spd > 1 ? ship.vy / spd : 0;
      var TW = W + 120, TH = H + 120;
      c2d.fillStyle = STAR_COL; c2d.strokeStyle = STAR_COL; c2d.lineCap = "round";   // (v0.197.0, ARM#9) tier tint
      for (var i = 0; i < stars.length; i++) {
        var s = stars[i];
        if (fore ? s.d <= 1 : s.d > 1) continue;
        s.t += 0.015;
        var sx = (s.x - camX * s.d) % TW; if (sx < 0) sx += TW; sx -= 60;
        var sy = (s.y - camY * s.d) % TH; if (sy < 0) sy += TH; sy -= 60;
        c2d.globalAlpha = s.a * (0.55 + amp * Math.sin(s.t)) * (fore ? 0.55 : 1);
        var ln = streak * s.d;
        if (ln > 1.5) { c2d.lineWidth = s.s; c2d.beginPath(); c2d.moveTo(sx, sy); c2d.lineTo(sx - nvx * ln, sy - nvy * ln); c2d.stroke(); }
        else c2d.fillRect(sx, sy, s.s, s.s);
      }
      c2d.globalAlpha = 1;
    }
    function drawShipAt(x, y, angle, scale, bank) {
      c2d.save(); c2d.translate(x, y); c2d.rotate(angle); c2d.scale(scale, scale);
      if (bank) c2d.scale(1, 1 - 0.32 * Math.min(1, Math.abs(bank)));   // (A2) roll: the wingspan foreshortens as the hull banks
      var k;
      for (k = 0; k < held.length; k++) {
        var side = k % 2 ? 1 : -1, idx = Math.floor(k / 2);
        c2d.save(); c2d.translate(-4 - idx * 7, side * (10 + idx * 5)); c2d.rotate(Math.PI / 4);
        c2d.shadowBlur = 10; c2d.shadowColor = COL.aqua; c2d.fillStyle = COL.aqua; c2d.globalAlpha = 0.9; c2d.fillRect(-4, -4, 8, 8); c2d.restore();
      }
      c2d.globalAlpha = 1; c2d.shadowBlur = 0;
      if (input.thrust && state === "SECTOR") { c2d.shadowBlur = 16; c2d.shadowColor = TRAIL; c2d.fillStyle = TRAIL; c2d.globalAlpha = 0.85 + (reducedMotion ? 0.1 : 0.15 * runRng.next()); c2d.beginPath(); c2d.moveTo(-13, -5); c2d.lineTo(-13 - (9 + (reducedMotion ? 4 : runRng.next() * 10)), 0); c2d.lineTo(-13, 5); c2d.closePath(); c2d.fill(); c2d.globalAlpha = 1; }   // (v0.57.0) thruster flame wears the mastery trail tint
      if (spriteReady(SPR.hero)) { drawSprite(SPR.hero, 40); c2d.restore(); c2d.shadowBlur = 0; return; }   // S3: asset hull (cargo + thrust already drawn); below is the vector fallback
      c2d.shadowBlur = 8; c2d.shadowColor = COL.iris600; c2d.fillStyle = "#5a32c8"; c2d.strokeStyle = COL.aqua; c2d.lineWidth = 1.3;
      c2d.beginPath(); c2d.moveTo(-1, -3); c2d.lineTo(-7, -19); c2d.lineTo(-13, -17); c2d.lineTo(-12, -4); c2d.closePath(); c2d.fill(); c2d.stroke();
      c2d.beginPath(); c2d.moveTo(-1, 3); c2d.lineTo(-7, 19); c2d.lineTo(-13, 17); c2d.lineTo(-12, 4); c2d.closePath(); c2d.fill(); c2d.stroke();
      c2d.shadowBlur = 9; c2d.shadowColor = COL.aqua; c2d.fillStyle = COL.aqua;
      c2d.beginPath(); c2d.arc(-9, -18, 1.7, 0, TAU); c2d.fill(); c2d.beginPath(); c2d.arc(-9, 18, 1.7, 0, TAU); c2d.fill();
      c2d.shadowBlur = 14; c2d.shadowColor = COL.iris; c2d.fillStyle = COL.iris; c2d.strokeStyle = COL.iris300; c2d.lineWidth = 1.6;
      c2d.beginPath(); c2d.moveTo(19, 0); c2d.lineTo(7, -4); c2d.lineTo(-10, -5); c2d.lineTo(-14, -2.5); c2d.lineTo(-14, 2.5); c2d.lineTo(-10, 5); c2d.lineTo(7, 4); c2d.closePath(); c2d.fill(); c2d.stroke();
      c2d.shadowBlur = 0; c2d.strokeStyle = COL.aqua; c2d.lineWidth = 1; c2d.globalAlpha = 0.7;
      c2d.beginPath(); c2d.moveTo(15, 0); c2d.lineTo(-8, 0); c2d.stroke(); c2d.globalAlpha = 1;
      c2d.shadowBlur = 10; c2d.shadowColor = COL.aqua; c2d.fillStyle = "#15151e"; c2d.strokeStyle = COL.aqua; c2d.lineWidth = 1;
      c2d.beginPath(); c2d.rect(-15.5, -4, 3, 3); c2d.rect(-15.5, 1, 3, 3); c2d.fill(); c2d.stroke();
      c2d.shadowBlur = 8; c2d.shadowColor = "#fff"; c2d.fillStyle = "#bdf2ff";
      c2d.beginPath(); c2d.ellipse(6, 0, 3.4, 2.2, 0, 0, TAU); c2d.fill();
      c2d.restore(); c2d.shadowBlur = 0;
    }
    function drawEnemy(e) {
      c2d.save(); c2d.translate(e.x, e.y); var a = Math.atan2(ship.y - e.y, ship.x - e.x); c2d.rotate(a);
      if (e.type === 'orbiter') {                       // (v0.148.0, ARM#3) aqua RING-DIAMOND — shape+color double-coded
        c2d.shadowBlur = 12; c2d.shadowColor = COL.aqua; c2d.fillStyle = "#0e2a30"; c2d.strokeStyle = COL.aqua; c2d.lineWidth = 1.6;
        c2d.beginPath(); c2d.moveTo(12, 0); c2d.lineTo(0, -9); c2d.lineTo(-12, 0); c2d.lineTo(0, 9); c2d.closePath(); c2d.fill(); c2d.stroke();
        c2d.beginPath(); c2d.arc(0, 0, 5.5, 0, TAU); c2d.stroke();
        c2d.restore(); c2d.shadowBlur = 0; return;
      }
      if (e.type === 'lancer') {                        // (v0.148.0, ARM#3) long peach CHEVRON; telegraph = white charge ring
        c2d.shadowBlur = 12; c2d.shadowColor = COL.peach; c2d.fillStyle = "#2a1616"; c2d.strokeStyle = COL.peach; c2d.lineWidth = 1.6;
        c2d.beginPath(); c2d.moveTo(17, 0); c2d.lineTo(-9, -7); c2d.lineTo(-3, 0); c2d.lineTo(-9, 7); c2d.closePath(); c2d.fill(); c2d.stroke();
        if (e.lstate === 1) {
          var kT = 1 - Math.max(0, e.lt) / 0.6;
          c2d.strokeStyle = "#fff"; c2d.shadowColor = "#fff"; c2d.globalAlpha = reducedMotion ? 0.85 : (0.4 + 0.6 * kT);
          c2d.beginPath(); c2d.arc(0, 0, reducedMotion ? 12 : (6 + 10 * kT), 0, TAU); c2d.stroke();
          c2d.globalAlpha = 1;
        }
        c2d.restore(); c2d.shadowBlur = 0; return;
      }
      if (spriteReady(SPR.enemy)) { drawSprite(SPR.enemy, 30); c2d.restore(); c2d.shadowBlur = 0; return; }   // S3: asset enemy; vector below is the fallback
      c2d.shadowBlur = 12; c2d.shadowColor = COL.peach; c2d.fillStyle = "#2a1620"; c2d.strokeStyle = COL.peach; c2d.lineWidth = 1.6;
      c2d.beginPath(); c2d.moveTo(13, 0); c2d.lineTo(-6, -12); c2d.lineTo(-12, -5); c2d.lineTo(-7, 0); c2d.lineTo(-12, 5); c2d.lineTo(-6, 12); c2d.closePath(); c2d.fill(); c2d.stroke();
      c2d.shadowBlur = 10; c2d.shadowColor = COL.gold; c2d.fillStyle = COL.gold; c2d.beginPath(); c2d.arc(0, 0, 3.2, 0, TAU); c2d.fill();
      c2d.restore(); c2d.shadowBlur = 0;
    }
    // S3: boss draw seam — armBoss sprite (fallback: scaled enemy silhouette). bossActive is always false today;
    // the boss encounter is Increment 2 (flagged to Core). Wired so the sprite lands where the boss will fight.
    // Galaga boss: drawn prow-DOWN (toward the player), wide, at native aspect. The dreadnought sprite
    // is authored facing down, so it's blitted as-authored (no SPRITE_FACE rotation, no ship tracking).
    function bossArena() {                               // narrow Galaga channel: dreadnought width + 25% each side
      var dw = Math.min(W * 0.62, 460);                  // matches the dreadnought draw width in drawBossAt
      var aw = dw * 1.5, l = (W - aw) / 2;
      return { l: l, r: l + aw, w: aw, top: Math.max(H * 0.44, 280), bot: H - 50 };
    }
    function drawBossAura() {                             // (v0.123.0, Jason) the dreadnought looms out of a charged red void
      if (!c2d || !boss || boss.dying) return;
      var A = bossArena(), tE = now() / 1000;
      var pulse = reducedMotion ? 0.7 : (0.6 + 0.28 * Math.sin(tE * 2.1) + 0.12 * Math.sin(tE * 5.3));
      var gy = boss.y + 24;
      c2d.save();
      var rg = c2d.createRadialGradient(boss.x, gy, 16, boss.x, gy, Math.max(A.w, 520) * 0.58);
      rg.addColorStop(0, "rgba(255,66,52," + (0.20 * pulse) + ")");
      rg.addColorStop(0.45, "rgba(150,30,64," + (0.10 * pulse) + ")");
      rg.addColorStop(1, "rgba(0,0,0,0)");
      c2d.fillStyle = rg; c2d.fillRect(A.l, 0, A.w, H);
      // a thin scorched band right under the hull racks — the reactor heat bleed
      if (!reducedMotion) {
        c2d.globalAlpha = 0.10 + 0.06 * Math.sin(tE * 3.3);
        c2d.fillStyle = COL.peach; c2d.shadowColor = COL.peach; c2d.shadowBlur = 30;
        c2d.beginPath(); c2d.ellipse ? c2d.ellipse(boss.x, boss.y + 40, A.w * 0.34, 26, 0, 0, TAU) : c2d.arc(boss.x, boss.y + 40, 40, 0, TAU); c2d.fill();
      }
      c2d.restore(); c2d.globalAlpha = 1; c2d.shadowBlur = 0;
    }
    function drawArenaFrame() {                           // letterbox the sides so the field reads as a tight channel
      if (!c2d) return;
      var A = bossArena();
      c2d.save();
      c2d.fillStyle = "rgba(5,5,11,0.82)";
      c2d.fillRect(0, 0, A.l, H); c2d.fillRect(A.r, 0, W - A.r, H);
      c2d.globalAlpha = 0.5; c2d.strokeStyle = COL.iris; c2d.lineWidth = 2; c2d.shadowBlur = 10; c2d.shadowColor = COL.iris;
      c2d.beginPath(); c2d.moveTo(A.l, 0); c2d.lineTo(A.l, H); c2d.moveTo(A.r, 0); c2d.lineTo(A.r, H); c2d.stroke();
      c2d.restore();
    }
    function drawWeakpoints() {
      if (!c2d || !boss) return;
      for (var i = 0; i < boss.wps.length; i++) {
        var w = boss.wps[i], p = wpPos(i), isActive = (i === boss.wpActive && boss.active);
        c2d.save();
        if (w.dead) {                                 // destroyed: dark broken socket
          c2d.globalAlpha = 0.55; c2d.fillStyle = "#2c2c38"; c2d.strokeStyle = "#15151c"; c2d.lineWidth = 2;
          c2d.beginPath(); c2d.arc(p.x, p.y, boss.wpR * 0.7, 0, TAU); c2d.fill(); c2d.stroke();
        } else if (isActive) {                        // (v0.82.0) ACTIVE = beacon + burning core, NO gold ring (Jason)
          var pulse = 0.55 + 0.45 * Math.sin(boss.flash * 9);
          // beacon shaft: a gold quest-marker beam rising from the target
          var grad = c2d.createLinearGradient(p.x, p.y - 92, p.x, p.y);
          grad.addColorStop(0, "rgba(255,200,87,0)"); grad.addColorStop(1, "rgba(255,200,87,0.5)");
          c2d.fillStyle = grad; c2d.fillRect(p.x - 3, p.y - 92, 6, 88);
          // pulsing gold core
          c2d.shadowBlur = 26; c2d.shadowColor = COL.gold; c2d.globalAlpha = pulse; c2d.fillStyle = COL.gold;
          c2d.beginPath(); c2d.arc(p.x, p.y, boss.wpR, 0, TAU); c2d.fill();
          // HP arc stays the damage read
          c2d.globalAlpha = 1; c2d.shadowBlur = 0; c2d.strokeStyle = COL.peach; c2d.lineWidth = 3;
          c2d.beginPath(); c2d.arc(p.x, p.y, boss.wpR + 8, -Math.PI / 2, -Math.PI / 2 + TAU * (boss.wpHp / boss.wpMax)); c2d.stroke();
        } else {                                      // (v0.76.0) pending: recede hard — small, dim, glowless
          c2d.globalAlpha = 0.26; c2d.fillStyle = "#2c4850"; c2d.strokeStyle = "rgba(31,221,233,0.5)"; c2d.lineWidth = 1;
          c2d.beginPath(); c2d.arc(p.x, p.y, boss.wpR * 0.5, 0, TAU); c2d.fill(); c2d.stroke();
        }
        c2d.restore();
      }
    }
    function drawBossLaser() {
      if (!c2d || !boss || boss.dying) return;
      if (boss.laserState === "charge" && boss.laserMode === "wall") {   // (A10) inverse telegraph: everything burns EXCEPT the safe column
        var kw = boss.laserT / (LASER_CHARGE * 1.5), BAd = bossArena();
        c2d.save();
        c2d.globalAlpha = 0.12 + 0.24 * kw; c2d.fillStyle = COL.peach;   // (v0.123.0) hotter burn so the danger reads
        c2d.fillRect(BAd.l, 0, Math.max(0, boss.gapX - GAP_HALF - BAd.l), H);
        c2d.fillRect(boss.gapX + GAP_HALF, 0, Math.max(0, BAd.l + BAd.w - (boss.gapX + GAP_HALF)), H);
        c2d.globalAlpha = 0.10 + 0.06 * kw; c2d.fillStyle = COL.mantis;  // (v0.123.0) faint green wash = "stand HERE"
        c2d.fillRect(boss.gapX - GAP_HALF, 0, GAP_HALF * 2, H);
        var sp = reducedMotion ? 1 : (0.7 + 0.3 * Math.sin(now() / 1000 * 6));
        c2d.globalAlpha = (0.4 + 0.5 * kw) * sp; c2d.strokeStyle = COL.mantis; c2d.lineWidth = 3;
        c2d.shadowColor = COL.mantis; c2d.shadowBlur = reducedMotion ? 0 : 12;
        c2d.strokeRect(boss.gapX - GAP_HALF, 0, GAP_HALF * 2, H);        // the safe lane, outlined in green
        c2d.restore(); c2d.shadowBlur = 0; return;
      }
      if (boss.laserState === "fire" && boss.laserMode === "wall") {
        var BAf = bossArena();
        c2d.save(); c2d.shadowBlur = 26; c2d.shadowColor = COL.peach; c2d.globalAlpha = 0.85; c2d.fillStyle = COL.peach;
        c2d.fillRect(BAf.l, 0, Math.max(0, boss.gapX - GAP_HALF - BAf.l), H);
        c2d.fillRect(boss.gapX + GAP_HALF, 0, Math.max(0, BAf.l + BAf.w - (boss.gapX + GAP_HALF)), H);
        c2d.globalAlpha = 1; c2d.fillStyle = "#fff";
        
        c2d.restore(); return;
      }
      if (boss.laserState === "charge") {             // buildup: a widening warning beam + a growing orb at the muzzle
        var k = boss.laserT / LASER_CHARGE;
        c2d.save();
        c2d.globalAlpha = 0.10 + 0.22 * k; c2d.fillStyle = COL.peach;
        c2d.fillRect(boss.laserX - LASER_HALF * k, boss.laserY, LASER_HALF * 2 * k, H - boss.laserY);
        if (boss.laserX2 != null) c2d.fillRect(boss.laserX2 - LASER_HALF * k, boss.laserY2, LASER_HALF * 2 * k, H - boss.laserY2);   // (ARM#2) twin telegraph
        c2d.globalAlpha = 0.5 + 0.5 * k; c2d.shadowBlur = 20 + 30 * k; c2d.shadowColor = COL.peach; c2d.fillStyle = "#fff";
        c2d.beginPath(); c2d.arc(boss.laserX, boss.laserY, 6 + 14 * k, 0, TAU); c2d.fill();
        if (boss.laserX2 != null) { c2d.beginPath(); c2d.arc(boss.laserX2, boss.laserY2, 6 + 14 * k, 0, TAU); c2d.fill(); }
        c2d.restore();
      } else if (boss.laserState === "fire") {        // the beam: peach glow + white-hot core, full height
        c2d.save();
        c2d.shadowBlur = 26; c2d.shadowColor = COL.peach;
        c2d.globalAlpha = 0.85; c2d.fillStyle = COL.peach;
        c2d.fillRect(boss.laserX - LASER_HALF, boss.laserY, LASER_HALF * 2, H - boss.laserY);
        if (boss.laserX2 != null) c2d.fillRect(boss.laserX2 - LASER_HALF, boss.laserY2, LASER_HALF * 2, H - boss.laserY2);   // (ARM#2)
        c2d.globalAlpha = 1; c2d.fillStyle = "#fff";
        c2d.fillRect(boss.laserX - LASER_HALF * 0.45, boss.laserY, LASER_HALF * 0.9, H - boss.laserY);
        if (boss.laserX2 != null) c2d.fillRect(boss.laserX2 - LASER_HALF * 0.45, boss.laserY2, LASER_HALF * 0.9, H - boss.laserY2);
        c2d.restore();
      }
    }
    function drawDeathOverlay() {
      if (!c2d || !boss || !boss.dying) return;
      var cx = W / 2, t = boss.deathT, pulse = 0.45 + 0.35 * Math.sin(t * 7);
      c2d.save();
      // pulsing red vignette + hard edge bands (the frame glows red as the hull goes critical)
      var rg = c2d.createRadialGradient(cx, H / 2, Math.min(W, H) * 0.30, cx, H / 2, Math.max(W, H) * 0.72);
      rg.addColorStop(0, "rgba(255,40,40,0)"); rg.addColorStop(1, "rgba(255,28,28," + (0.5 * pulse) + ")");
      c2d.fillStyle = rg; c2d.fillRect(0, 0, W, H);
      c2d.globalAlpha = pulse; c2d.fillStyle = "rgba(255,45,45,0.55)"; c2d.shadowBlur = 40; c2d.shadowColor = "#ff2a2a";
      var bw = 16; c2d.fillRect(0, 0, W, bw); c2d.fillRect(0, H - bw, W, bw); c2d.fillRect(0, 0, bw, H); c2d.fillRect(W - bw, 0, bw, H);
      c2d.restore();
      // giant blinking WARNING
      if (Math.floor(t * 4) % 2 === 0) {
        c2d.save(); c2d.globalAlpha = 0.92; c2d.fillStyle = "#ff3b3b"; c2d.shadowBlur = 26; c2d.shadowColor = "#ff2a2a";
        c2d.font = "800 " + Math.round(Math.min(W * 0.13, 100)) + "px Montserrat"; c2d.textAlign = "center"; c2d.textBaseline = "middle";
        c2d.fillText("WARNING", cx, H * 0.30); c2d.restore(); c2d.textBaseline = "alphabetic";
      }
      // phase 3: HYPERDRIVE front and centre with a live countdown
      if (returnReady) {
        var left = Math.max(0, Math.ceil(boss.warpDeadline - t)), p2 = 0.6 + 0.4 * Math.sin(t * 10);
        c2d.save(); c2d.textAlign = "center"; c2d.textBaseline = "middle";
        var bw2 = Math.min(W * 0.62, 480), bh2 = 124;
        c2d.globalAlpha = p2; c2d.strokeStyle = COL.aqua; c2d.lineWidth = 3; c2d.shadowBlur = 30; c2d.shadowColor = COL.aqua;
        c2d.strokeRect(cx - bw2 / 2, H * 0.52 - bh2 / 2, bw2, bh2);
        c2d.globalAlpha = 1; c2d.fillStyle = COL.aqua; c2d.shadowBlur = 24;
        c2d.font = "800 " + Math.round(Math.min(W * 0.09, 58)) + "px Montserrat";
        c2d.fillText("ENGAGE HYPERDRIVE", cx, H * 0.52 - 14);
        c2d.fillStyle = "#fff"; c2d.shadowBlur = 0; c2d.font = "700 26px Montserrat";
        c2d.fillText(left + "s", cx, H * 0.52 + 34);
        c2d.restore(); c2d.textBaseline = "alphabetic";
      }
    }
    function drawBossAt(x, y, scale) {
      c2d.save(); c2d.translate(x, y); c2d.scale(scale || 1, scale || 1);
      // (v0.76.0 revamp, Jason: "more epic, less static") the dreadnought LIVES now:
      // a slow menacing hull sway, flickering engine wash at the stern, and running
      // lights sweeping the hull. All sin-clock driven (no rng draws, no shake).
      var tE = now() / 1000;
      if (!reducedMotion) c2d.rotate(Math.sin(tE * 0.42) * 0.02);
      if (!reducedMotion) {
        var wash = 0.5 + 0.35 * Math.sin(tE * 11) + 0.15 * Math.sin(tE * 23);
        c2d.save(); c2d.globalAlpha = 0.28 * wash; c2d.shadowBlur = 24; c2d.shadowColor = COL.peach; c2d.fillStyle = COL.peach;
        for (var eN = -1; eN <= 1; eN++) {
          c2d.beginPath(); c2d.ellipse ? c2d.ellipse(eN * 90, -46, 16, 30 + 12 * wash, 0, 0, TAU) : c2d.arc(eN * 90, -46, 18, 0, TAU);
          c2d.fill();
        }
        c2d.restore();
      }
      if (spriteReady(SPR.boss)) {
        var dw = Math.min(W * 0.62, 460), dh = dw * (SPR.boss.naturalHeight / SPR.boss.naturalWidth);
        c2d.drawImage(SPR.boss, -dw / 2, -dh / 2, dw, dh);     // as-authored: prow points down at the player
        if (!reducedMotion) {                                  // (v0.76.0) running lights sweep the hull
          var sw76 = ((now() / 1000) * 0.55) % 1;
          c2d.shadowBlur = 10; c2d.shadowColor = COL.gold; c2d.fillStyle = COL.gold;
          for (var rl = 0; rl < 3; rl++) {
            var lx = ((sw76 + rl / 3) % 1) * dw - dw / 2;
            c2d.globalAlpha = 0.5 + 0.4 * Math.sin((sw76 + rl / 3) * TAU);
            c2d.beginPath(); c2d.arc(lx, -dh * 0.18, 3.4, 0, TAU); c2d.fill();
          }
          c2d.globalAlpha = 1;
        }
        c2d.restore(); c2d.shadowBlur = 0; return;
      }
      // vector fallback: a broad dreadnought wedge, wide at the top, prow pointing DOWN
      var hw = Math.min(W * 0.28, 200);
      c2d.shadowBlur = 18; c2d.shadowColor = COL.peach; c2d.fillStyle = "#241019"; c2d.strokeStyle = COL.peach; c2d.lineWidth = 2.4;
      c2d.beginPath(); c2d.moveTo(-hw, -34); c2d.lineTo(hw, -34); c2d.lineTo(hw * 0.5, 14); c2d.lineTo(0, 52); c2d.lineTo(-hw * 0.5, 14); c2d.closePath(); c2d.fill(); c2d.stroke();
      c2d.shadowBlur = 10; c2d.strokeStyle = "rgba(255,107,91,.5)"; c2d.lineWidth = 1.2;
      for (var gx = -hw * 0.6; gx <= hw * 0.6; gx += hw * 0.4) { c2d.beginPath(); c2d.moveTo(gx, -30); c2d.lineTo(gx, 6); c2d.stroke(); }
      c2d.restore(); c2d.shadowBlur = 0;
    }
    function drawCore(core) {
      var lit = 0.5 + 0.5 * Math.sin(core.pulse); c2d.save(); c2d.translate(core.x, core.y);
      if (core.recovered && core.state !== "collected" && core.state !== "lost") {   // (ARM#1) a recovered core wears a gold halo
        c2d.save(); c2d.globalAlpha = 0.35 + 0.25 * lit; c2d.strokeStyle = COL.gold; c2d.lineWidth = 2;
        if (c2d.setLineDash) c2d.setLineDash([4, 6]);
        c2d.beginPath(); c2d.arc(0, 0, core.r + 12, 0, TAU); c2d.stroke();
        if (c2d.setLineDash) c2d.setLineDash([]);
        c2d.restore();
      }
      // danger ring: only combat cores (guardians/asteroid), and only before the fight is engaged.
      var ringOn = (core.ch.kind === "combat" && core.state === "locked" && !core.gateActive);
      if (ringOn) {
        c2d.save(); c2d.globalAlpha = 0.16 + 0.08 * lit; c2d.strokeStyle = COL.peach; c2d.lineWidth = 1.6;
        if (!reducedMotion && c2d.setLineDash) c2d.setLineDash([7, 11]);
        c2d.beginPath(); c2d.arc(0, 0, core.r + COMBAT_RING_PAD, 0, TAU); c2d.stroke();
        if (c2d.setLineDash) c2d.setLineDash([]); c2d.restore();
      }
      if (core.ch.type === "asteroid" && core.state === "locked") {
        c2d.shadowBlur = 8; c2d.shadowColor = "#888"; c2d.strokeStyle = "#6a6a7e"; c2d.fillStyle = "rgba(60,60,78,0.6)"; c2d.lineWidth = 2;
        c2d.beginPath(); for (var i = 0; i < 10; i++) { var an = i / 10 * TAU, rr = core.r + 10 + (i % 2 ? 4 : 0); var px = Math.cos(an) * rr, py = Math.sin(an) * rr; i === 0 ? c2d.moveTo(px, py) : c2d.lineTo(px, py); } c2d.closePath(); c2d.fill(); c2d.stroke();
        c2d.shadowBlur = 0; c2d.fillStyle = COL.gold; c2d.font = "700 11px Montserrat"; c2d.textAlign = "center"; c2d.fillText("HP " + core.astHP, 0, -core.r - 16);
      } else {
        var col = core.state === "unlocked" ? COL.green : (core.ch.kind === "combat" ? COL.peach : COL.aqua);
        c2d.shadowBlur = 18; c2d.shadowColor = col; c2d.strokeStyle = col; c2d.lineWidth = 2; c2d.globalAlpha = 0.3 + 0.4 * lit;
        c2d.beginPath(); c2d.arc(0, 0, core.r + 8 + lit * 4, 0, TAU); c2d.stroke(); c2d.globalAlpha = 1;
        c2d.fillStyle = "rgba(255,255,255,0.06)"; c2d.beginPath(); c2d.arc(0, 0, core.r, 0, TAU); c2d.fill();
        c2d.beginPath(); c2d.arc(0, 0, core.r, 0, TAU); c2d.stroke();
        c2d.fillStyle = col; c2d.beginPath(); c2d.moveTo(0, -10); c2d.lineTo(10, 0); c2d.lineTo(0, 10); c2d.lineTo(-10, 0); c2d.closePath(); c2d.fill();
      }
      c2d.restore(); c2d.shadowBlur = 0;
      c2d.fillStyle = "#aebbd6"; c2d.font = "11px Montserrat"; c2d.textAlign = "center";
      var lab = "◇ " + conceptTag(core).toUpperCase();
      if (core.ch.kind === "combat" && core.state === "locked" && core.gateActive) { lab = core.ch.type === "drones" ? ("⚔ " + countEnemies(core.idx) + " LEFT") : "⚔ SHATTER"; c2d.fillStyle = "#ff9d92"; }
      else if (core.state === "unlocked") { lab = "✦ EXTRACT"; c2d.fillStyle = "#bdf06a"; }
      c2d.fillText(lab, core.x, core.y + core.r + 22);
    }
    function drawAsteroid(a) {
      c2d.save(); c2d.translate(a.x, a.y); c2d.rotate(a.rot);
      c2d.strokeStyle = "#5a5a6e"; c2d.fillStyle = "rgba(55,55,72,0.55)"; c2d.lineWidth = 1.5; c2d.beginPath();
      for (var i = 0; i < a.verts.length; i++) { var an = i / a.verts.length * TAU, rr = a.r * a.verts[i], px = Math.cos(an) * rr, py = Math.sin(an) * rr; i === 0 ? c2d.moveTo(px, py) : c2d.lineTo(px, py); }
      c2d.closePath(); c2d.fill(); c2d.stroke(); c2d.restore();
    }
    function drawParticles() {
      for (var i = 0; i < particles.length; i++) { var p = particles[i]; if (!p.active) continue; c2d.globalAlpha = clamp(p.life * 1.4, 0, 1); c2d.fillStyle = p.col; c2d.shadowBlur = 8; c2d.shadowColor = p.col; c2d.beginPath(); c2d.arc(p.x, p.y, p.sz, 0, TAU); c2d.fill(); }
      c2d.globalAlpha = 1; c2d.shadowBlur = 0;
    }
    function drawNebula(camx, camy) {
      if (!c2d || !NEBULA || !c2d.createRadialGradient) return;
      // (v0.76.0 revamp) boss arenas dim the nebula wash hard — the fight reads against a
      // near-black void so the dreadnought + gold lock-on own the frame.
      var nbAlpha = bossActive ? 0.3 : 1;
      c2d.save(); c2d.globalAlpha = nbAlpha;
      for (var i = 0; i < NEBULA.length; i++) {
        var nb = NEBULA[i];
        if (!nb.grad) {
          var g = c2d.createRadialGradient(0, 0, 0, 0, 0, nb.r);
          if (!g || !g.addColorStop) { c2d.restore(); return; }   // headless mock ctx: skip nebula (balance the dim save)
          g.addColorStop(0, nb.c0); g.addColorStop(1, "rgba(0,0,0,0)"); nb.grad = g;
        }
        var x = nb.fx * W - camx * nb.p, y = nb.fy * H - camy * nb.p;
        c2d.save(); c2d.globalAlpha = nb.a * nbAlpha; c2d.translate(x, y); c2d.fillStyle = nb.grad; c2d.fillRect(-nb.r, -nb.r, nb.r * 2, nb.r * 2); c2d.restore();
      }
      // (v0.197.0, V1.1 ARM#9) the sector landmark — static far-parallax scenery (reduced-motion
      // safe by construction: nothing here animates)
      if (landmark) {
        var lx = landmark.x - camx * landmark.d, ly = landmark.y - camy * landmark.d;
        c2d.save();
        if (landmark.kind === 'planet') {
          c2d.globalAlpha = 0.4 * nbAlpha;
          c2d.beginPath(); c2d.arc(lx, ly, landmark.r, 0, TAU); c2d.clip();
          if (spriteReady(SPR.planet)) c2d.drawImage(SPR.planet, lx - landmark.r, ly - landmark.r, landmark.r * 2, landmark.r * 2);
          else { c2d.fillStyle = 'rgba(120,85,250,0.3)'; c2d.fillRect(lx - landmark.r, ly - landmark.r, landmark.r * 2, landmark.r * 2); }
        } else if (landmark.kind === 'derelict') {
          c2d.translate(lx, ly); c2d.rotate(landmark.rot);
          c2d.globalAlpha = 0.35 * nbAlpha;
          if (spriteReady(SPR.station)) c2d.drawImage(SPR.station, -landmark.r, -landmark.r, landmark.r * 2, landmark.r * 2);
          else { c2d.fillStyle = 'rgba(154,154,173,0.35)'; c2d.fillRect(-landmark.r * 0.8, -landmark.r * 0.25, landmark.r * 1.6, landmark.r * 0.5); }
        } else {
          c2d.translate(lx, ly); c2d.rotate(landmark.rot);
          c2d.fillStyle = 'rgba(154,154,173,0.5)';
          for (var lr2 = 0; lr2 < landmark.rocks.length; lr2++) {
            var rk = landmark.rocks[lr2];
            c2d.globalAlpha = rk.a * nbAlpha;
            c2d.beginPath(); c2d.arc(rk.ox * landmark.r, rk.oy * landmark.r, rk.r, 0, TAU); c2d.fill();
          }
        }
        c2d.restore(); c2d.globalAlpha = 1;
      }
      c2d.restore();

      c2d.globalAlpha = 1;
    }
    // (v0.82.0, Jason) boss backdrop: the arena tears UPWARD at hyperspeed — background only.
    // Camera is locked during the fight, so the rush is a pure function of time over the shared
    // stars array (like drawWarp's radial flow): no allocation, no per-star state, nothing
    // mutated. Reduced motion gets a calm path: three static faint shafts, no motion at all.
    var BOSS_FLOW = 920;                                            // px/s vertical rush
    function drawBossRush(gOpt) {
      var g = gOpt || c2d;                                          // injectable for the harness probe
      if (!g) return;
      g.save();
      if (reducedMotion) {
        g.globalAlpha = 0.08; g.fillStyle = COL.iris300;
        g.fillRect(W * 0.22, 0, 2, H); g.fillRect(W * 0.5, 0, 2, H); g.fillRect(W * 0.78, 0, 2, H);
        g.restore(); return;
      }
      var bt = now() / 1000;
      g.lineWidth = 2;
      for (var i = 0; i < stars.length; i++) {
        var st = stars[i];
        var depth = 0.35 + st.d * 0.75;                             // parallax: deep layers crawl, near layers scream
        var len = 22 + depth * 58;
        // wrap period covers the tail (H + pad + len) so a streak fully exits before it teleports
        var sy = (st.y + bt * BOSS_FLOW * depth) % (H + 70 + len) - 35;   // upward flight = streaks race DOWN the screen
        var sx = st.x % W;
        g.globalAlpha = (0.10 + 0.26 * depth) * (0.5 + 0.5 * st.a);
        g.strokeStyle = (i & 1) ? COL.aqua : COL.iris300;
        g.beginPath(); g.moveTo(sx, sy - len); g.lineTo(sx, sy); g.stroke();
      }
      g.restore(); g.globalAlpha = 1;
    }

    function drawSector() {
      if (!c2d) return;
      c2d.clearRect(0, 0, W, H);
      drawNebula(camX, camY);
      if (bossActive) drawBossRush();                               // (v0.82.0) vertical hyperspeed under the fight
      drawStarsParallax(false);                                     // (A1) layered backdrop, behind the world
      var shx = 0, shy = 0;
      if (shakeAmt > 0 && !reducedMotion) { shx = (Math.random() - 0.5) * shakeAmt * 2; shy = (Math.random() - 0.5) * shakeAmt * 2; }   // (v0.69.0, J1) 01 §12: no jitter under reduced motion
      c2d.save();
      if (!reducedMotion && shipBank) { c2d.translate(W / 2, H / 2); c2d.rotate(-shipBank * 0.02); c2d.translate(-W / 2, -H / 2); }   // (A3) the whole scene counter-banks with the turn
      c2d.translate(-camX + shx, -camY + shy);
      for (var i = 0; i < asteroids.length; i++) drawAsteroid(asteroids[i]);
      for (i = 0; i < cores.length; i++) { var c = cores[i]; if (c.state !== "collected" && c.state !== "lost") drawCore(c); }
      c2d.fillStyle = COL.aqua; c2d.shadowBlur = 8; c2d.shadowColor = COL.aqua;
      for (i = 0; i < bullets.length; i++) { var b = bullets[i]; if (!b.active) continue; c2d.beginPath(); c2d.arc(b.x, b.y, 2.6, 0, TAU); c2d.fill(); }
      c2d.shadowBlur = 0; c2d.fillStyle = COL.peach; c2d.shadowBlur = 8; c2d.shadowColor = COL.peach;
      for (i = 0; i < ebullets.length; i++) { var eb = ebullets[i]; if (!eb.active) continue; c2d.beginPath(); c2d.arc(eb.x, eb.y, 2.8, 0, TAU); c2d.fill(); }
      c2d.shadowBlur = 0;
      for (i = 0; i < enemies.length; i++) drawEnemy(enemies[i]);
      if (bossActive && boss) {
        drawBossAura();
        drawBossAt(boss.x, boss.y, boss.dying ? (1 + boss.deathT * 0.35) : 1);
        drawBossLaser(); drawMissiles();
        if (!boss.dying) drawWeakpoints();
      }
      drawParticles();
      var blink = invuln > 0 && !reducedMotion && Math.floor(invuln * 12) % 2 === 0 && state === "SECTOR";
      if (!blink) drawShipAt(ship.x, ship.y, ship.angle, 1, shipBank);
      c2d.restore();
      drawStarsParallax(true);                                      // (A5) foreground layer streams OVER the ship
      if (bossActive) drawArenaFrame();
      if (bossActive && boss && boss.dying) drawDeathOverlay();
      drawCompass();
      drawCockpitHud();
    }
    // (v0.111.0, D3) Cockpit-lite HUD: compass tape (top center) + radar disc (above FIRE).
    // Screen-space, allocation-free; markers — aqua hex = pending core, mantis star = the
    // EXPOSED core (extract), peach triangle = threat.
    var wrapAng = function (d) { while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; return d; };
    function tapeMarker(x, ty, kind, pulse) {
      c2d.save(); c2d.translate(x, ty);
      if (kind === 0) { c2d.strokeStyle = COL.aqua; c2d.shadowColor = COL.aqua; c2d.shadowBlur = 8; c2d.lineWidth = 1.6; c2d.beginPath(); for (var p6 = 0; p6 < 6; p6++) { var a6 = p6 / 6 * TAU - Math.PI / 2; var px6 = Math.cos(a6) * 6, py6 = Math.sin(a6) * 6; if (p6 === 0) c2d.moveTo(px6, py6); else c2d.lineTo(px6, py6); } c2d.closePath(); c2d.stroke(); }
      else if (kind === 1) { c2d.fillStyle = COL.green; c2d.shadowColor = COL.green; c2d.shadowBlur = 10; c2d.beginPath(); for (var p4 = 0; p4 < 8; p4++) { var a4 = p4 / 8 * TAU - Math.PI / 2, r4 = (p4 % 2 === 0) ? 7 : 3; var px4 = Math.cos(a4) * r4, py4 = Math.sin(a4) * r4; if (p4 === 0) c2d.moveTo(px4, py4); else c2d.lineTo(px4, py4); } c2d.closePath(); c2d.fill(); }
      else { c2d.globalAlpha = pulse; c2d.fillStyle = COL.peach; c2d.shadowColor = COL.peach; c2d.shadowBlur = 8; c2d.beginPath(); c2d.moveTo(0, -6); c2d.lineTo(6, 5); c2d.lineTo(-6, 5); c2d.closePath(); c2d.fill(); }
      c2d.restore(); c2d.globalAlpha = 1; c2d.shadowBlur = 0;
    }
    var TAPE_TXT = ["N", "30", "60", "E", "120", "150", "S", "210", "240", "W", "300", "330"];
    var hudCapStr = "", hudCapDeg = -1, hudCapDist = -2;   // (v0.116.0, R1) caption cache — no per-frame concat
    function drawCockpitHud() {
      if (!c2d || state === "HOME" || state === "INTRO" || state === "BRIEF" || state === "WARP") return;
      var tW = Math.min(460, W - 220), tX = W / 2 - tW / 2, tY = 12, tH = 38;
      var tNow = now() / 1000, pulse = reducedMotion ? 1 : 0.55 + 0.45 * Math.sin(tNow * 4.5);
      var headingDeg = ((ship.angle * 180 / Math.PI) + 90 + 720) % 360;
      if (bossActive) { drawRadarOnly(tNow, pulse); return; }   // (D3) the arena has its own banner; the tape would sit ON the dreadnought
      c2d.save();
      c2d.fillStyle = "rgba(8,8,14,.78)"; c2d.strokeStyle = "#26263a"; c2d.lineWidth = 1;
      if (c2d.roundRect) { c2d.beginPath(); c2d.roundRect(tX, tY, tW, tH, 10); c2d.fill(); c2d.stroke(); }
      else { c2d.fillRect(tX, tY, tW, tH); c2d.strokeRect(tX, tY, tW, tH); }
      c2d.beginPath(); c2d.rect(tX + 2, tY + 2, tW - 4, tH - 4); c2d.clip();
      var pxPerDeg = 46 / 15, off = (headingDeg % 15) * pxPerDeg;
      for (var tk = -1; tk * 46 - off < tW + 46; tk++) {
        var xk = tX + tk * 46 - off;
        c2d.strokeStyle = "rgba(255,255,255,.14)"; c2d.beginPath(); c2d.moveTo(xk, tY + 6); c2d.lineTo(xk, tY + tH - 12); c2d.stroke();
        var degAt = Math.round((headingDeg - (tW / 2 - (tk * 46 - off)) / pxPerDeg) / 15) * 15;
        degAt = ((degAt % 360) + 360) % 360;
        if (degAt % 30 === 0) {
          c2d.fillStyle = "rgba(255,255,255,.4)"; c2d.font = "700 10px Montserrat,Arial,sans-serif"; c2d.textAlign = "center";
          c2d.fillText(TAPE_TXT[degAt / 30], xk, tY + tH - 4);   // (v0.116.0, R1) fixed label table — no per-frame strings
        }
      }
      var mkY = tY + 14, shown = 0, i2, nearDist = -1;
      for (i2 = 0; i2 < cores.length && shown < 3; i2++) {
        var c9 = cores[i2]; if (c9.state === "collected" || c9.state === "lost") continue;
        var dA9 = wrapAng(Math.atan2(c9.y - ship.y, c9.x - ship.x) - ship.angle);
        var mx9 = W / 2 + (dA9 / Math.PI) * (tW / 2 - 10);
        if (mx9 < tX + 10) mx9 = tX + 10; if (mx9 > tX + tW - 10) mx9 = tX + tW - 10;
        tapeMarker(mx9, mkY, c9.state === "unlocked" ? 1 : 0, 1); shown++;
        var dd9 = Math.sqrt((c9.x - ship.x) * (c9.x - ship.x) + (c9.y - ship.y) * (c9.y - ship.y));
        if (nearDist < 0 || dd9 < nearDist) nearDist = dd9;
      }
      for (i2 = 0; i2 < enemies.length; i2++) {
        var e9 = enemies[i2];
        var dAe = wrapAng(Math.atan2(e9.y - ship.y, e9.x - ship.x) - ship.angle);
        var mxe = W / 2 + (dAe / Math.PI) * (tW / 2 - 10);
        if (mxe < tX + 10) mxe = tX + 10; if (mxe > tX + tW - 10) mxe = tX + tW - 10;
        tapeMarker(mxe, mkY, 2, pulse);
      }
      c2d.restore();
      c2d.save(); c2d.strokeStyle = "#fff"; c2d.shadowColor = COL.aqua; c2d.shadowBlur = 8; c2d.lineWidth = 2;
      c2d.beginPath(); c2d.moveTo(W / 2, tY + 3); c2d.lineTo(W / 2, tY + tH - 3); c2d.stroke(); c2d.restore(); c2d.shadowBlur = 0;
      c2d.fillStyle = "rgba(109,109,128,.9)"; c2d.font = "600 10px Montserrat,Arial,sans-serif"; c2d.textAlign = "center";
      var hcDeg = Math.round(headingDeg), hcDist = nearDist >= 0 ? Math.round(nearDist / 4) : -1;
      if (hcDeg !== hudCapDeg || hcDist !== hudCapDist) {
        hudCapDeg = hcDeg; hudCapDist = hcDist;
        hudCapStr = ("heading " + hcDeg + (hcDist >= 0 ? " \u00b7 nearest core " + hcDist + "m" : "")).toUpperCase();
      }
      c2d.fillText(hudCapStr, W / 2, tY + tH + 12);
      drawRadarOnly(tNow, pulse);
    }
    function drawRadarOnly(tNow, pulse) {
      var rX = W - 92, rY = H - 236, rR = 62, R_WORLD = 900, i2;   // (v0.116.0, R1) i2 was undeclared — strict mode threw every radar frame
      c2d.save();
      c2d.fillStyle = "rgba(8,8,14,.78)"; c2d.strokeStyle = "#26263a";
      c2d.beginPath(); c2d.arc(rX, rY, rR + 4, 0, TAU); c2d.fill(); c2d.stroke();
      c2d.strokeStyle = "rgba(255,255,255,.07)";
      c2d.beginPath(); c2d.arc(rX, rY, 21, 0, TAU); c2d.stroke();
      c2d.beginPath(); c2d.arc(rX, rY, 42, 0, TAU); c2d.stroke();
      c2d.beginPath(); c2d.arc(rX, rY, 62, 0, TAU); c2d.stroke();
      c2d.strokeStyle = "rgba(255,255,255,.05)";
      c2d.beginPath(); c2d.moveTo(rX - rR, rY); c2d.lineTo(rX + rR, rY); c2d.moveTo(rX, rY - rR); c2d.lineTo(rX, rY + rR); c2d.stroke();
      var swA = reducedMotion ? -Math.PI / 3 : (tNow / 3.5 % 1) * TAU;
      c2d.strokeStyle = COL.aqua; c2d.globalAlpha = 0.55; c2d.shadowColor = COL.aqua; c2d.shadowBlur = 10; c2d.lineWidth = 2;
      c2d.beginPath(); c2d.moveTo(rX, rY); c2d.lineTo(rX + Math.cos(swA) * rR, rY + Math.sin(swA) * rR); c2d.stroke();
      c2d.globalAlpha = 1; c2d.shadowBlur = 0;
      c2d.fillStyle = "#fff"; c2d.beginPath(); c2d.arc(rX, rY, 2.5, 0, TAU); c2d.fill();
      for (i2 = 0; i2 < cores.length; i2++) {
        var cb = cores[i2]; if (cb.state === "collected" || cb.state === "lost") continue;
        var bx = (cb.x - ship.x) / R_WORLD * rR, by = (cb.y - ship.y) / R_WORLD * rR;
        var bl = Math.sqrt(bx * bx + by * by); if (bl > rR - 4) { bx *= (rR - 4) / bl; by *= (rR - 4) / bl; }
        if (cb.state === "unlocked") { c2d.fillStyle = COL.green; c2d.beginPath(); c2d.arc(rX + bx, rY + by, 4, 0, TAU); c2d.fill(); }
        else { c2d.fillStyle = COL.aqua; c2d.fillRect(rX + bx - 3.5, rY + by - 3.5, 7, 7); }
      }
      c2d.globalAlpha = reducedMotion ? 1 : pulse;
      for (i2 = 0; i2 < enemies.length; i2++) {
        var eb = enemies[i2];
        var ex2 = (eb.x - ship.x) / R_WORLD * rR, ey2 = (eb.y - ship.y) / R_WORLD * rR;
        var el2 = Math.sqrt(ex2 * ex2 + ey2 * ey2); if (el2 > rR - 4) { ex2 *= (rR - 4) / el2; ey2 *= (rR - 4) / el2; }
        c2d.fillStyle = COL.peach; c2d.beginPath(); c2d.moveTo(rX + ex2, rY + ey2 - 4); c2d.lineTo(rX + ex2 + 4, rY + ey2 + 3); c2d.lineTo(rX + ex2 - 4, rY + ey2 + 3); c2d.closePath(); c2d.fill();
      }
      c2d.restore(); c2d.globalAlpha = 1;
    }
    function drawCompass() {
      if (!c2d) return;
      var tx, ty, col;
      if (state === "HOME") { if (dist2(ship.x, ship.y, HS_X, HS_Y) < HS_R + 40) return; tx = HS_X; ty = HS_Y; col = COL.green; }
      else {
        var near = null, nd = 1e9;
        for (var i = 0; i < cores.length; i++) { var core = cores[i]; if (core.state === "collected" || core.state === "lost") continue; var d = dist2(ship.x, ship.y, core.x, core.y); if (d < nd) { nd = d; near = core; } }
        if (!near || nd < 90) return;
        tx = near.x; ty = near.y; col = near.state === "unlocked" ? COL.green : (near.ch.kind === "combat" ? COL.peach : COL.aqua);
      }
      var sx = ship.x - camX, sy = ship.y - camY, ang = Math.atan2(ty - ship.y, tx - ship.x), rad = shipR() + 22;
      var ax = sx + Math.cos(ang) * rad, ay = sy + Math.sin(ang) * rad;
      c2d.save(); c2d.translate(ax, ay); c2d.rotate(ang); c2d.shadowBlur = 12; c2d.shadowColor = col; c2d.fillStyle = col; c2d.globalAlpha = 0.9;
      c2d.beginPath(); c2d.moveTo(11, 0); c2d.lineTo(-5, -6); c2d.lineTo(-1, 0); c2d.lineTo(-5, 6); c2d.closePath(); c2d.fill();
      c2d.restore(); c2d.globalAlpha = 1; c2d.shadowBlur = 0;
    }
    function drawStationGlyph(cx, cy) {
      var t = now() / 1000, coreR = 22;
      c2d.save(); c2d.translate(cx, cy);
      for (var i = 0; i < stationBuild; i++) {
        var ang = t * 0.2 + i / TOTAL * TAU;
        c2d.save(); c2d.rotate(ang);
        c2d.strokeStyle = COL.green; c2d.lineWidth = 3; c2d.shadowColor = COL.green; c2d.shadowBlur = 14;
        c2d.beginPath(); c2d.moveTo(coreR + 6, 0); c2d.lineTo(coreR + 24, 0); c2d.stroke();
        c2d.fillStyle = COL.green; c2d.beginPath(); c2d.arc(coreR + 30, 0, 6, 0, TAU); c2d.fill(); c2d.restore();
      }
      c2d.shadowColor = COL.iris; c2d.shadowBlur = 20; c2d.strokeStyle = COL.iris; c2d.lineWidth = 2; c2d.globalAlpha = 0.55 + (reducedMotion ? 0 : 0.2 * Math.sin(t * 2));
      var ringR = 38 + stationBuild * 7; c2d.beginPath(); c2d.arc(0, 0, ringR, 0, TAU); c2d.stroke(); c2d.globalAlpha = 1;
      c2d.shadowColor = COL.iris300; c2d.shadowBlur = 22; c2d.fillStyle = COL.iris; c2d.strokeStyle = COL.iris300; c2d.lineWidth = 2;
      c2d.beginPath(); for (var j = 0; j < 6; j++) { var a = j / 6 * TAU + t * 0.1; var px = Math.cos(a) * coreR, py = Math.sin(a) * coreR; j === 0 ? c2d.moveTo(px, py) : c2d.lineTo(px, py); } c2d.closePath(); c2d.fill(); c2d.stroke();
      c2d.shadowBlur = 8; c2d.shadowColor = "#fff"; c2d.fillStyle = "#eafcff"; c2d.beginPath(); c2d.arc(0, 0, 6, 0, TAU); c2d.fill();
      c2d.restore(); c2d.shadowBlur = 0;
    }
    function drawStationScene() {
      if (!c2d) return;
      c2d.clearRect(0, 0, W, H);
      drawNebula(0, 0);
      for (var i = 0; i < stars.length; i++) { var s = stars[i]; s.t += 0.01; var sx = (s.x * 0.4) % W, sy = (s.y * 0.4) % H; c2d.globalAlpha = s.a * (0.5 + (reducedMotion ? 0 : 0.5) * Math.sin(s.t)); c2d.fillStyle = "#cfd2ff"; c2d.fillRect(sx, sy, s.s, s.s); }
      c2d.globalAlpha = 1;
      var cx = W / 2, cy = H / 2 - 10;
      drawStationGlyph(cx, cy);
      c2d.fillStyle = "#aebbd6"; c2d.font = "600 12px Montserrat"; c2d.textAlign = "center";
      c2d.fillText("MCI STATION · " + stationBuild + "/" + TOTAL + " RESTORED", cx, cy + Math.max(78, 56 + stationBuild * 7));
      if (state === "BRIEF") drawShipAt(cx - Math.min(W * 0.28, 260), cy + 30, -Math.PI / 2, 1.1);
    }
    function drawHome() {
      if (!c2d) return;
      c2d.clearRect(0, 0, W, H);
      drawNebula(camX, camY);
      drawStarsParallax(false);
      c2d.save();
      if (!reducedMotion && shipBank) { c2d.translate(W / 2, H / 2); c2d.rotate(-shipBank * 0.02); c2d.translate(-W / 2, -H / 2); }
      c2d.translate(-camX, -camY);
      drawStationGlyph(HS_X, HS_Y);
      c2d.fillStyle = "#aebbd6"; c2d.font = "600 12px Montserrat"; c2d.textAlign = "center"; c2d.fillText("MCI STATION", HS_X, HS_Y + (52 + stationBuild * 7));
      drawShipAt(ship.x, ship.y, ship.angle, 1, shipBank);
      c2d.restore(); drawStarsParallax(true); drawCompass();
    }
    function drawWarp() {
      if (!c2d) return;
      c2d.fillStyle = "#05050b"; c2d.fillRect(0, 0, W, H); var cx = W / 2, cy = H / 2; var cd = warpCD();
      if (warpT < cd) {
        // ---- countdown: charging ring + big number "spinning up" ----
        var seg = cd / 3, n = 3 - Math.floor(warpT / seg); if (n < 1) n = 1; if (n > 3) n = 3;
        var frac = (warpT % seg) / seg;
        // S4: countdown rings removed — just the spinning-up number
        c2d.save(); c2d.fillStyle = "#fff"; c2d.shadowBlur = 26; c2d.shadowColor = COL.iris;
        c2d.globalAlpha = reducedMotion ? 1 : (0.45 + 0.55 * Math.sin(Math.min(1, frac) * Math.PI));
        var sc = reducedMotion ? 1 : (1.35 - 0.35 * Math.min(1, frac * 2.2));
        c2d.font = "800 " + Math.round(82 * sc) + "px Montserrat"; c2d.textAlign = "center"; c2d.textBaseline = "middle";
        c2d.fillText(String(n), cx, cy); c2d.restore(); c2d.textBaseline = "alphabetic";
        // S3: countdown caption removed (no "HYPERDRIVE" label on screen)
      } else {
        // ---- S3: 3D wormhole — receding concentric rings rushing past + accelerating star streaks ----
        var k = clamp((warpT - cd) / warpStreak(), 0, 1);
        var wt = warpT - cd;
        var maxR = Math.sqrt(cx * cx + cy * cy) * 1.18;
        var canFilter = ("filter" in c2d);
        if (reducedMotion) {                       // calm path: a soft center glow brightening into the jump (no rings)
          var rg = c2d.createRadialGradient(cx, cy, 0, cx, cy, maxR);
          rg.addColorStop(0, "rgba(120,230,230," + (0.18 + 0.5 * k) + ")");
          rg.addColorStop(1, "rgba(5,5,11,0)");
          c2d.fillStyle = rg; c2d.fillRect(0, 0, W, H);
          drawWarpShip(cx, cy, k);                  // (Jason) the player's hull, riding the calm glow into the jump
          if (k > 0.8) { c2d.fillStyle = "rgba(255,255,255," + ((k - 0.8) / 0.2 * 0.9) + ")"; c2d.fillRect(0, 0, W, H); }
          c2d.globalAlpha = 1; return;
        }
        if (canFilter) c2d.filter = "blur(" + (1 + 2.4 * k) + "px)";   // heavier blur as we accelerate
        // (v0.75.0, Jason: "more fluid, more animated, not slow motion") the tunnel now MOVES:
        // stars flow radially past the camera with per-star parallax (deterministic from warpT),
        // the speed floor keeps it energetic from frame one, and colors alternate per star.
        var WARP_FLOW = 340;                                           // px/s radial rush at full tilt
        var speed = (0.35 + 0.65 * k * k) * 110; c2d.lineWidth = 2;
        var maxR2 = maxR + 40;
        for (var i = 0; i < stars.length; i++) {
          var s = stars[i]; var dx = (s.x % W) - cx, dy = (s.y % H) - cy; var a = Math.atan2(dy, dx); var r0 = Math.sqrt(dx * dx + dy * dy);
          var depth = 0.45 + 0.9 * s.a;                                // parallax: bright stars rush harder
          var r = (r0 + wt * WARP_FLOW * depth * (0.4 + 0.6 * k)) % maxR2;
          var len = speed * (6 + 7 * k) * depth * (0.25 + r / maxR2);  // longer streaks toward the rim
          var x1 = cx + Math.cos(a) * r, y1 = cy + Math.sin(a) * r, x2 = cx + Math.cos(a) * (r + len), y2 = cy + Math.sin(a) * (r + len);
          c2d.strokeStyle = (i % 2) ? COL.iris300 : COL.aqua; c2d.globalAlpha = (0.3 + 0.4 * (r / maxR2)) * s.a + 0.4 * k;
          c2d.shadowBlur = 8 + 10 * k; c2d.shadowColor = COL.aqua;
          c2d.beginPath(); c2d.moveTo(x1, y1); c2d.lineTo(x2, y2); c2d.stroke();
        }
        c2d.shadowBlur = 0;
        // S4: receding concentric wormhole rings removed — star streaks carry the warp now
        c2d.globalAlpha = 1; c2d.shadowBlur = 0;
        if (canFilter) c2d.filter = "none";
        drawWarpShip(cx, cy, k);                    // (Jason) the player's hull punching into the jump — drawn crisp, over the streaks
        if (k > 0.78) { c2d.fillStyle = "rgba(255,255,255," + ((k - 0.78) / 0.22 * 0.9) + ")"; c2d.fillRect(0, 0, W, H); }   // crisp punch-through into the destination
      }
    }
    // (Jason) hyperdrive-cinematic hull — the dead-astern ship punching into the jump. Browser-only (c2d-guarded);
    // drawn as-authored (no SPRITE_FACE rotation, like the boss), centred just below the streak vanishing point,
    // with a growing engine bloom and a high-speed shudder. No-ops until a sprite decodes (then the streaks carry it).
    function drawWarpShip(cx, cy, k) {
      if (!c2d || !spriteReady(SPR.warp)) return;
      var w = Math.min(W, H) * 0.40;                                       // width — FIXED (Jason: don't change width)
      var env;                                                             // (Jason) length stretch builds to 10%, holds in the tunnel, then shrinks back to normal as the warp ends
      if (k < 0.18) { var u = k / 0.18; env = u * u * (3 - 2 * u); }        // ease up to full stretch
      else if (k > 0.78) { var v = (1 - k) / 0.22; env = v * v * (3 - 2 * v); } // ease back to normal through the punch-out
      else env = 1;                                                        // hold at full 10% in the tunnel
      var stretch = reducedMotion ? 1 : (1 + 0.10 * env);                  // (Jason) 10% forward (upward) length stretch only
      var h = w * stretch;
      var NOZ_Y = H * 0.90;                                                // (Jason) hull low on the screen — thrusters still in frame
      var sy = NOZ_Y - h * 0.075;                                          // anchor: nozzles (~57.5% down the sprite) land at NOZ_Y; the hull stretches UP/forward from there
      var bloomR = w * (0.16 + 0.18 * k);                                  // engine bloom at the nozzles, brightening into the jump
      var rg = c2d.createRadialGradient(cx, NOZ_Y, 0, cx, NOZ_Y, bloomR);
      rg.addColorStop(0, "rgba(180,245,255," + (0.35 + 0.4 * k) + ")");
      rg.addColorStop(1, "rgba(31,221,233,0)");
      c2d.save(); c2d.globalCompositeOperation = "lighter"; c2d.fillStyle = rg;
      c2d.beginPath(); c2d.arc(cx, NOZ_Y, bloomR, 0, TAU); c2d.fill(); c2d.restore();
      c2d.save(); c2d.shadowBlur = 18; c2d.shadowColor = COL.iris;          // soft iris rim lifts the hull off the streaks
      c2d.drawImage(SPR.warp, cx - w / 2, sy - h / 2, w, h);               // forward (vertical) stretch only; width stays w
      c2d.restore(); c2d.shadowBlur = 0;
    }
    function drawBackdrop() {
      if (!c2d) return;
      c2d.clearRect(0, 0, W, H);
      drawNebula(0, 0);
      for (var i = 0; i < stars.length; i++) { var s = stars[i]; s.t += 0.008; var sx = (s.x * 0.3) % W, sy = (s.y * 0.3) % H; c2d.globalAlpha = s.a * (0.4 + (reducedMotion ? 0 : 0.4) * Math.sin(s.t)); c2d.fillStyle = "#cfd2ff"; c2d.fillRect(sx, sy, s.s, s.s); }
      c2d.globalAlpha = 1;
    }

    /* ---------------------------------------------------------------------- */
    /* loop / tick                                                            */
    /* ---------------------------------------------------------------------- */
    var lastTs = 0;
    function loop(ts) {
      if (!running) return;
      if (!lastTs) lastTs = ts;
      var dt = (ts - lastTs) / 1000; lastTs = ts; if (dt > 0.05) dt = 0.05;
      tick(dt);
      if (raf && !paused) rafId = raf(loop);
    }
    function tick(dt) {
      if (paused) return;   // S3: shell-driven pause freezes all state advancement
      switch (state) {
        case "SECTOR": updateSector(dt); drawSector(); updateActionBtn(); break;
        case "INTRO": updateIntro(dt); drawIntro(); break;
        case "HOME": updateHome(dt); drawHome(); break;
        case "WARP": updateWarp(dt); drawWarp(); break;
        case "BRIEF": case "DEPOT_Q": case "DEPOT_SUM": case "SHOP": case "SECTORCLEAR": drawStationScene(); break;
        case "GAMEOVER": updateParticles(dt); drawSector(); if (deathTimer > 0) { deathTimer -= dt; if (deathTimer <= 0) showGameOverPanel(); } break;
        case "PUZZLE": updatePuzzleTimer(dt); drawSector(); break;
        case "QUESTION": drawSector(); break;
        default: drawBackdrop();
      }
    }

    /* ---------------------------------------------------------------------- */
    /* test-only seam (root.__armTest) — NOT used by the shell or players     */
    /* ---------------------------------------------------------------------- */
    function attachTestApi() {
      root.__armTest = {
        step: function (dt) { tick(dt == null ? 1 / 60 : dt); },
        bossRush: function (g) { drawBossRush(g); },               // (v0.83.0) explicit, ctx-injectable rush probe
        sector: function () { return sector; }, coins: function () { return coins; },   // (v0.108.0, G4) resume pins
        bossGapX: function () { return boss ? boss.gapX : NaN; },
        starCount: function () { return stars.length; },
        state: function () { return state; },
        palette: function () { return { highContrast: highContrast, border: COL.border, aqua: COL.aqua, text: COL.text, mid: COL.mid, trail: TRAIL }; },
        station: function () { return stationBuild; },
        total: function () { return TOTAL; },
        sectorNum: function () { return sector; },
        sectorsTotal: function () { return SECTORS; },
        coreQids: function () { return cores.map(function (c) { return c.q.id; }); },
        lostPoolIds: function () { return lostPool.map(function (lp) { return lp.id; }); },   // (ARM#1)
        recoveredIdx: function () { var o = []; for (var i = 0; i < cores.length; i++) if (cores[i].recovered) o.push(i); return o; },
        bandCeil: function (i) { return bandFor(i)[1]; },
        bandCeilAt: function (sec, i) { return bandFor(i, sec)[1]; },
        tierOf: function (sec) { return tierOf(sec); },
        isBossSector: function (sec) { return isBossSector(sec); },
        nextSector: function () { nextSector(); },
        rollTypes: function (n, sec) { var keep = sector; if (sec) sector = sec; var out = []; for (var i = 0; i < (n || 100); i++) out.push(rollEnemyType()); sector = keep; return out; },   // (v0.148.0, ARM#3)
        puzzleRoster: function (t) { return puzzleRosterFor(t); },   // (v0.176.0, ARM#6)
        puzzleSecs: function (t, len, extra) { return puzzleSecsFor(t, len, extra); },
        puzzleTryGuess: function (g) { return activePuzzle && activePuzzle.tryGuess ? activePuzzle.tryGuess(g) : null; },
        flushLater: function () { var fired = 0; timers.forEach(function (rec, id) { win.clearTimeout(id); }); var fns = []; timers.forEach(function (rec) { fns.push(rec.fn); }); timers.clear(); for (var i = 0; i < fns.length; i++) { try { fns[i](); fired++; } catch (eF) {} } return fired; },
        upgradeLvl: function (k) { return lvl[k]; },                 // (v0.179.0, Flow#7)
        regenDelay: function () { return shieldRegenDelay; },
        landmark: function () { return landmark ? { kind: landmark.kind, x: landmark.x, y: landmark.y, r: landmark.r } : null; },   // (v0.197.0, ARM#9)
        nebulaCols: function () { return NEBULA ? NEBULA.map(function (nb2) { return nb2.c0; }) : []; },
        starCol: function () { return STAR_COL; },
        typeProbe: function () { return { active: typing.active, shown: typing.shown, total: typing.total, forced: typeForced, layerOn: !!(typeLayer && typeLayer.style.display === "block"), optsWait: !!(commsOpts && commsOpts.classList.contains("wait")) }; },   // (v0.180.0, ARM#7)
        typeForce: function (onF) { typeForced = !!onF; },
        typeSkip: function () { skipReveal(); },
        openSettings: function () { showSettings(); },               // (v0.189.0, ARM#8)
        hpMix: function (n, sec) { var keep = sector; if (sec) sector = sec; var out = {}; for (var i = 0; i < (n || 300); i++) { var h = enemyHpFor(sector); out[h] = (out[h] || 0) + 1; } sector = keep; return out; },   // (v0.155.0, ARM#4)
        shotDmg: function (sec) { return shotDmgFor(sec); },
        setSmoothDiff: function (v) { smoothDiff = !!v; },
        spawnTyped: function (ty, x, y) { enemies.push({ x: x, y: y, vx: 0, vy: 0, r: 13, coreId: null, shootCD: 9, hp: 99, type: ty, orb: 1, lstate: 0, lt: 0, lang: 0 }); return enemies.length - 1; },
        enemyInfo: function () { return enemies.map(function (e) { return { type: e.type || 'chaser', x: e.x, y: e.y, lstate: e.lstate, d: dist2(e.x, e.y, ship.x, ship.y) }; }); },
        cargo: function () { return held.length; },
        coins: function () { return coins; },
        charges: function () { return charges; },
        maxCharges: function () { return maxCharges; },
        fire: function () { var b = charges; shoot(); return b !== charges; },  // true if a shot was fired
        listenerCount: function () { return listeners.length; },
        timerCount: function () { return timers.size; },
        rafCancelled: function () { return rafId === 0; },
        cores: function () {
          var out = [];
          for (var i = 0; i < cores.length; i++) { var c = cores[i]; out.push({ idx: c.idx, qid: c.q.id, kind: c.ch.kind, type: c.ch.type, state: c.state, x: c.x, y: c.y, r: c.r, gate: c.gateActive }); }
          return out;
        },
        shipTo: function (x, y) { ship.x = x; ship.y = y; ship.vx = ship.vy = 0; },
        coresForSector: function (n) { return randomCorePositions(RNG.fork("arm-run-" + n)); }, // test-only: seeded layout for sector n
        combatRing: function () { return COMBAT_RING_PAD; },
        extractPad: function () { return EXTRACT_PAD; },
        held: function () { var o = []; for (var i = 0; i < held.length; i++) o.push(held[i].q.id); return o; },
        skipBriefing: function () { if (state === "INTRO") endIntro(); if (state === "BRIEF") startWarp(enterSector); },
        endBriefingIntro: function () { if (state === "INTRO") endIntro(); },
        briefInfo: function () { return { core: briefCore, mode: briefMode, repeat: briefRepeat, frustrated: briefRepeat >= 3, total: cores.length }; },
        briefOptions: function () { return briefOpts.map(function (o) { return o.label; }); },
        briefPick: function (i) { if (briefOpts[i]) briefOpts[i].fn(); },
        briefText: function () { return commsMsg ? commsMsg.textContent : ""; },
        briefCoreAnswer: function () { var c = cores[briefCore]; if (!c || !c.q) return ""; return correctAnswerText(c.q)[0]; },
        commsFx: function () {
          return {
            scanline: !!(commsScan && commsScan.parentNode === comms),
            portraitFx: !!(commsPort && commsPort.querySelector(".arm-port-sweep")),
            signal: !!(commsSig && commsSig.querySelector(".arm-sig-bars")),
            animated: !!(comms && /\btx-live\b/.test(comms.className)),
          };
        },
        skipIntro: function () { if (state === "INTRO") endIntro(); },
        flushWarp: function () { if (state === "WARP") { var d = warpDone; warpDone = null; if (d) d(); } },
        warpInfo: function () {
          var cd = warpCD();
          return { t: warpT, cd: cd, total: warpTotal(), phase: (warpT < cd ? "countdown" : "streak"), number: (warpT < cd ? Math.max(1, 3 - Math.floor(warpT / (cd / 3))) : 0) };
        },
        prepCore: function (i) {
          var c = cores[i]; if (!c || c.ch.kind !== "combat") return;
          onArrive(c); // gate + spawn guardians
          if (c.ch.type === "drones") removeGuardians(c.idx); else c.astHP = 0;
          checkCombatCleared();
        },
        arrive: function (i) { if (cores[i]) onArrive(cores[i]); },
        bossEnabled: function () { return bossActive; },
        bossInfo: function () { var dead = 0; if (boss && boss.wps) for (var i = 0; i < boss.wps.length; i++) if (boss.wps[i].dead) dead++; return { active: !!(boss && boss.active), wpHp: boss ? boss.wpHp : 0, wpMax: boss ? boss.wpMax : 0, queue: bossQueue.length, dying: !!(boss && boss.dying), cores: cores.length, wpDead: dead, wpActive: boss ? boss.wpActive : 0, wpCount: boss && boss.wps ? boss.wps.length : 0, laserMode: boss ? boss.laserMode : null, laserState: boss ? boss.laserState : null, enraged: !!(boss && boss.enraged), twin: !!(boss && boss.laserX2 != null) }; },
        hitWeakpoint: function (n) { var k = 0; while (k++ < (n || 1)) { if (!boss || !boss.active || boss.dying) break; if (--boss.wpHp <= 0) shedCore(); } },
        spawnMissileAt: function (x, y) { var mm = null; for (var i = 0; i < missiles.length; i++) { if (!missiles[i].active) { mm = missiles[i]; break; } } if (mm) { mm.active = true; mm.x = x; mm.y = y; mm.ang = 0; mm.vx = MISSILE_SPEED; mm.vy = 0; mm.life = 9; } },
        missileInfo: function () { var n = 0, d = -1; for (var i = 0; i < missiles.length; i++) { if (missiles[i].active) { n++; d = Math.sqrt((missiles[i].x - ship.x) * (missiles[i].x - ship.x) + (missiles[i].y - ship.y) * (missiles[i].y - ship.y)); } } return { active: n, distToShip: d }; },
        shootAtMissile: function () { for (var i = 0; i < missiles.length; i++) { if (missiles[i].active) { spawnBullet(missiles[i].x - 30, missiles[i].y, 300, 0, 1.0); return true; } } return false; },
        setupBossSector: function (sec) { sector = (sec && sec % 3 === 0) ? sec : 3; usedIds = []; held = []; sectorLost = []; runRng = RNG.fork("arm-boss-test-" + sector); ship.x = ENTRY_X; ship.y = ENTRY_Y; ship.vx = ship.vy = 0; drawCoreQuestions(); buildSectorWorld(); setState("SECTOR"); return { enabled: bossActive, queue: bossQueue.length, cores: cores.length, pattern: BOSS_PATTERNS[bossIdxOf(sector)].name }; },
        bossPatternInfo: function () { return bossActive ? BOSS_PATTERNS[bossIdxOf(sector)] : null; },   // (v0.142.0, ARM#2)
        bossEscorts: function () { return countEnemies(null); },
        refillShields: function () { shields = maxShields; },
        breakWeakpoints: function (n) { if (!boss) return; for (var i = 0; i < n && i < boss.wps.length; i++) boss.wps[i].dead = true; },
        applyDeathPenalty: function () { return applyDeathPenalty(); },   // (v0.161.0, ARM#5)
        setLvl: function (o) { for (var k in o) if (Object.prototype.hasOwnProperty.call(lvl, k)) lvl[k] = o[k] | 0; deriveStats(); },
        getLvl: function () { return { engine: lvl.engine, maneuver: lvl.maneuver, capacitor: lvl.capacitor, shieldCell: lvl.shieldCell, rapid: lvl.rapid }; },
        solvePuzzle: function () { var d = pendingPuzzleDone; if (d) { pendingPuzzleDone = null; d(); return true; } return false; },
        openPuzzleAt: function (idx, type) { var c = cores[idx]; if (c) { if (type) c.puzType = type; else c.puzType = c.puzType || c.ch.type; openPuzzle(c); return puzzleCore && (puzzleCore.puzType || puzzleCore.ch.type); } return null; },
        puzzleInfo: function () {
          return {
            active: puzzleLimit > 0,
            type: puzzleCore ? (puzzleCore.puzType || puzzleCore.ch.type) : null,
            limit: puzzleLimit, remain: puzzleTimer,
            barShown: !!(puzzleWrap && puzzleWrap.parentNode === panel),
            shields: shields,
          };
        },
        puzzleProbe: function () { return activePuzzle && activePuzzle.probe ? activePuzzle.probe() : null; },
        puzzleTapSolve: function () { if (activePuzzle && activePuzzle.tapSolve) { activePuzzle.tapSolve(); return true; } return false; },
        simonLen: function () { return (activePuzzle && activePuzzle.type === "simon") ? activePuzzle.len : 0; },
        puzzleHold: function () { return puzzleTimerHold; },
        hasQuestion: function () { return !!pendingQuestion; },
        invuln: function () { return invuln; },
        questionLimit: function () { return pendingQuestion ? pendingQuestion.limitS : 0; },
        questionRemain: function () { return pendingQuestion && pendingQuestion.remainMs ? pendingQuestion.remainMs() : 0; },
        timerStarted: function () { return !!(pendingQuestion && pendingQuestion.isTimerStarted && pendingQuestion.isTimerStarted()); },
        forceTimeout: function () { if (pendingQuestion && pendingQuestion.timeUp) { pendingQuestion.timeUp(); return true; } return false; },
        answer: function (correct) {
          var pq = pendingQuestion; if (!pq) return false;
          var ans = pq.correctIndices
            ? (correct ? pq.correctIndices.slice() : [0])   // [0] alone is length 1 != >=2 -> graded wrong
            : (correct ? pq.correctIndex : (pq.correctIndex === 0 ? 1 : 0));
          pq.choose(ans); pq.proceed(); return true;
        },
        engageReturn: function () { returnReady = true; engageReturn(); },
        shake: function () { return shakeAmt; },   // (v0.69.0) J1 pins
        gnow: function () { return gnow(); },
        isPaused: function () { return paused; },
        pause: function () { pause(); },
        resume: function () { resume(); },
        panicCount: function () { return panicCount(); },
        panicActive: function () { return panicSpawned; },
        returnReady: function () { return returnReady; },
        dock: function () { if (state === "HOME") dockHome(); },
        closeSummary: function () { if (state === "DEPOT_SUM") showShop(sectorClear); },
        closeShop: function () { if (state === "SHOP") sectorClear(); },
      };
    }

    return { id: "ARM", mount: mount, unmount: unmount, pause: pause, resume: resume };
  }

  /* ---------------------------------------------------------------------- */
  /* no-op audio fallback (if ctx omits audio)                              */
  /* ---------------------------------------------------------------------- */
  function noopAudio() {
    return { ensure: function () {}, setMusic: function () {}, setSfx: function () {}, sfx: function () {}, playTrack: function () {} };
  }

  /* ---------------------------------------------------------------------- */
  /* original commander portrait (in-code art; briefing only)               */
  /* ---------------------------------------------------------------------- */
  var PORTRAIT = '<svg viewBox="0 0 56 56" xmlns="http://www.w3.org/2000/svg" width="56" height="56"><defs><linearGradient id="armhg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8a6dff"/><stop offset="1" stop-color="#4b00aa"/></linearGradient></defs><rect width="56" height="56" fill="#12121d"/><circle cx="28" cy="22" r="14" fill="url(#armhg)"/><rect x="16" y="18" width="24" height="9" rx="4.5" fill="#0a1418"/><rect x="18" y="20" width="20" height="5" rx="2.5" fill="#1FDDE9" opacity="0.9"/><path d="M14 56c0-9 6.3-15 14-15s14 6 14 15z" fill="url(#armhg)"/><path d="M20 14c2-5 14-5 16 0" stroke="#AC9BFD" stroke-width="2" fill="none" opacity="0.7"/></svg>';

  /* ---------------------------------------------------------------------- */
  /* scoped CSS                                                              */
  /* ---------------------------------------------------------------------- */
  function CSS(C) {
    return [
      ".arm-wrap{position:relative;width:100%;height:100%;overflow:hidden;font-family:'Montserrat',Arial,sans-serif;color:" + C.text + ";",
      "background:radial-gradient(130% 110% at 50% -10%, #15152a 0%, #0a0a16 55%, #050509 100%);-webkit-tap-highlight-color:transparent;user-select:none;}",
      ".arm-wrap *{box-sizing:border-box;}",
      ".arm-canvas{position:absolute;inset:0;width:100%;height:100%;display:block;}",
      ".arm-banner{position:absolute;top:64px;left:50%;transform:translateX(-50%);z-index:5;display:none;font-size:12.5px;letter-spacing:.12em;text-transform:uppercase;color:" + C.aqua + ";text-align:center;text-shadow:0 0 16px rgba(31,221,233,.55);pointer-events:none;background:rgba(10,10,18,.5);padding:6px 14px;border-radius:999px;border:1px solid rgba(31,221,233,.25);max-width:90%;}",
      ".arm-banner.boss{top:auto;bottom:104px;color:" + C.peach + ";text-shadow:0 0 16px rgba(255,107,91,.55);border-color:rgba(255,107,91,.3);}",
      ".arm-gear{position:absolute;top:14px;right:14px;z-index:7;border:1px solid #34344a;background:rgba(10,10,17,.92);border-radius:10px;color:" + C.mid + ";font-family:inherit;font-size:13px;font-weight:600;padding:8px 11px;cursor:pointer;display:none;letter-spacing:.04em;box-shadow:0 2px 10px rgba(0,0,0,.5);}",   // (P2·3, PLAYTEST A5) near-opaque backdrop + drop shadow: world markers scrolling beneath read as UNDER the HUD, not colliding with it
      ".arm-gear:hover{border-color:" + C.iris + ";color:" + C.text + ";}",
      ".arm-stats{position:absolute;left:16px;top:50%;transform:translateY(-50%);z-index:6;display:none;flex-direction:column;gap:8px;background:rgba(8,8,14,.72);border:1px solid #26263a;border-radius:14px;padding:12px;width:118px;}",
      ".arm-rrow{display:flex;align-items:center;gap:7px;}",
      ".arm-ric{font-size:13px;color:" + C.aqua + ";width:16px;text-align:center;} .arm-ric.gold{color:" + C.gold + ";}",
      ".arm-rrow .arm-meter{flex:1;height:6px;} .arm-rrow b{font-size:13px;}",
      ".arm-rdiv{height:1px;background:#26263a;margin:2px 0;}",
      ".arm-rtext{font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:" + C.dim + ";display:flex;flex-direction:column;gap:3px;}",
      ".arm-rtext b{color:" + C.iris300 + ";font-size:12px;letter-spacing:0;}",
      ".arm-vignette{position:absolute;inset:0;z-index:4;pointer-events:none;background:radial-gradient(120% 120% at 50% 45%, transparent 62%, rgba(4,4,10,.55) 88%, rgba(4,4,10,.85) 100%);}",
      ".arm-srow{display:flex;justify-content:space-between;align-items:center;gap:14px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:" + C.mid + ";}",
      /* (v0.189.0, V1.1 ARM#8) the ship's log — center-console CRT pages */
      ".arm-log{display:flex;flex-direction:column;gap:8px;max-height:210px;overflow-y:auto;margin:6px 0 10px;padding-right:4px;text-align:left;}",
      ".arm-log-entry{border:1px solid #26263a;border-left:3px solid " + C.aqua + ";border-radius:8px;padding:7px 9px;background:rgba(10,14,20,.65);}",
      ".arm-log-entry.got{border-left-color:#92DD23;}",
      ".arm-log-entry.lost{border-left-color:#FF6B5B;}",
      ".arm-log-head{display:flex;justify-content:space-between;gap:8px;margin-bottom:4px;}",
      ".arm-log-tag{font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:" + C.aqua + ";}",
      ".arm-log-st{font-size:11px;font-weight:700;letter-spacing:.08em;}",
      ".arm-log-installed{color:#92DD23;}.arm-log-lost{color:#FF6B5B;}.arm-log-pending{color:" + C.mid + ";}",
      ".arm-log-why{font-size:12px;color:#c9c9d6;line-height:1.45;}",
      ".arm-log-key{font-size:12px;color:#9ff0f7;font-weight:700;margin-top:3px;}",
      ".arm-srow b{color:" + C.text + ";font-weight:700;font-size:12.5px;letter-spacing:.02em;font-variant-numeric:tabular-nums;}.arm-srow b.gold{color:" + C.gold + ";}",   /* (v0.187.0, FE#8) */
      ".arm-meter{width:88px;height:8px;border-radius:5px;border:1px solid #33334a;overflow:hidden;}.arm-meter>i{display:block;height:100%;border-radius:5px;}",
      ".arm-m-shield>i{background:linear-gradient(90deg," + C.aqua + ",#19a9b3);box-shadow:0 0 10px rgba(31,221,233,.6);}",
      ".arm-m-ammo>i{background:linear-gradient(90deg," + C.gold + ",#e0a838);}",
      ".arm-steer{position:absolute;left:50%;transform:translateX(-50%);bottom:18px;z-index:6;display:none;gap:11px;}",
      ".arm-key{width:58px;height:58px;border-radius:50%;background:rgba(20,20,30,.45);border:1.5px solid rgba(120,85,250,.55);color:" + C.iris300 + ";font-size:21px;display:flex;align-items:center;justify-content:center;touch-action:none;cursor:pointer;}",   // (D3) quieter skin
      ".arm-key.thrust{border-color:" + C.aqua + ";color:" + C.aqua + ";}.arm-key:active{background:rgba(120,85,250,.3);transform:scale(.92);}",
      ".arm-action{position:absolute;right:16px;bottom:18px;z-index:6;display:none;width:78px;height:78px;border-radius:50%;background:rgba(40,18,18,.5);border:2px solid " + C.peach + ";color:" + C.peach + ";font-size:14px;font-weight:700;letter-spacing:.05em;align-items:center;justify-content:center;text-align:center;line-height:1.05;touch-action:none;cursor:pointer;box-shadow:0 0 18px rgba(255,107,91,.3);}",
      ".arm-action:active{transform:scale(.93);}.arm-action.warp{border-color:" + C.aqua + ";color:" + C.aqua + ";background:rgba(18,36,40,.55);box-shadow:0 0 26px rgba(31,221,233,.45);}",
      ".arm-action.huge{width:104px;height:104px;font-size:16px;animation:armHugePulse 1s ease-in-out infinite;}",
      ".arm-reduce .arm-action.huge{animation:none;box-shadow:0 0 30px rgba(31,221,233,.6);}",
      "@media (prefers-reduced-motion:reduce){.arm-action.huge{animation:none;}}",
      "[data-motion=reduced] .arm-action.huge{animation:none;box-shadow:0 0 30px rgba(31,221,233,.6);}",
      ".arm-action.huge:active{transform:scale(1.04);}",
      ".arm-comms{position:absolute;left:50%;transform:translateX(-50%);bottom:12%;z-index:12;display:none;width:min(560px,94%);background:linear-gradient(#23233a,#15151f);border:1px solid #3a3a55;border-radius:18px;padding:12px;overflow:hidden;box-shadow:0 18px 60px rgba(0,0,0,.7);}",
      ".arm-comms-inner-screen{}",
      ".arm-comms > *:not(.arm-comms-scan){position:relative;z-index:2;}",
      ".arm-comms::before{content:'';position:absolute;inset:12px;background:#04121a;border:1px solid rgba(31,221,233,.5);border-radius:10px;box-shadow:inset 0 0 26px rgba(31,221,233,.18);z-index:1;}",
      ".arm-brfscene{position:absolute;inset:0;z-index:10;display:none;pointer-events:none;}",
      ".arm-brf-canopy{position:absolute;left:0;right:0;top:0;height:58%;overflow:hidden;background:linear-gradient(rgba(4,4,10,.9), transparent 34px), radial-gradient(130% 110% at 50% -10%, #15152a 0%, #0a0a16 55%, #050509 100%);}",
      ".arm-brf-station{position:absolute;left:50%;top:52%;width:300px;height:300px;transform:translate(-50%,-50%);animation:armBrfFlick 6s steps(2) infinite;}",
      ".arm-brf-station .bsh{position:absolute;inset:0;background-size:contain;background-position:center;background-repeat:no-repeat;display:block;}",
      ".arm-brf-station .bsh.a{clip-path:polygon(28% 0, 72% 0, 63% 43%, 37% 43%);transform:translate(-9px,-19px) rotate(-5deg);}",
      ".arm-brf-station .bsh.b{clip-path:polygon(0 28%, 38% 40%, 34% 80%, 0 88%);transform:translate(-22px,12px) rotate(-7deg);}",
      ".arm-brf-station .bsh.c{clip-path:polygon(62% 40%, 100% 28%, 100% 88%, 66% 80%);transform:translate(20px,7px) rotate(6deg);}",
      ".arm-brf-station .bsh.d{clip-path:polygon(35% 44%, 65% 44%, 74% 100%, 26% 100%);transform:translate(3px,22px) rotate(2deg);}",
      ".arm-brf-station .bem{position:absolute;left:34%;top:38%;width:32%;height:26%;background:radial-gradient(circle, rgba(120,85,250,.6), transparent 70%);display:block;animation:sxEmberArm 3.4s ease-in-out infinite;}",
      "@keyframes sxEmberArm{0%,100%{opacity:.3;}50%{opacity:.65;}}",
      "@keyframes armBrfFlick{0%,90%{opacity:.92;}93%,95%{opacity:.6;}97%,100%{opacity:.92;}}",
      ".arm-brf-hex{position:absolute;color:" + C.aqua + ";font-size:22px;filter:drop-shadow(0 0 9px rgba(31,221,233,.8));animation:armBrfHex 8s ease-in-out infinite;}",
      ".arm-brf-hex.bh1{left:26%;top:30%;} .arm-brf-hex.bh2{right:24%;top:52%;color:" + C.gold + ";filter:drop-shadow(0 0 9px rgba(255,200,87,.8));animation-duration:7s;} .arm-brf-hex.bh3{left:33%;top:66%;font-size:18px;animation-duration:10s;}",
      "@keyframes armBrfHex{0%,100%{transform:translate(0,0);}50%{transform:translate(8px,-12px);}}",
      ".arm-brf-strut{position:absolute;top:-4%;bottom:38%;width:70px;background:linear-gradient(90deg,#0a0a12,#14141f,#05050a);box-shadow:0 0 30px rgba(0,0,0,.8);}",
      ".arm-brf-strut.sl{left:6%;transform:rotate(18deg);border-right:1px solid rgba(172,155,253,.35);}",
      ".arm-brf-strut.sr{right:6%;transform:rotate(-18deg);border-left:1px solid rgba(172,155,253,.35);}",
      ".arm-brf-dash{position:absolute;left:0;right:0;bottom:0;height:44%;background:linear-gradient(180deg,#191926,#101018 26%,#0a0a10);border-top:2px solid #2a2a3e;box-shadow:inset 0 2px 0 rgba(172,155,253,.14);}",
      ".arm-brf-dash::before,.arm-brf-dash::after{content:'';position:absolute;top:0;bottom:0;width:2px;background:linear-gradient(90deg,#000,rgba(255,255,255,.04));}",
      ".arm-brf-dash::before{left:24%;} .arm-brf-dash::after{left:76%;}",
      ".arm-screw{position:absolute;width:9px;height:9px;border-radius:50%;background:radial-gradient(circle at 35% 35%, #3c3c52, #15151f);}",
      ".arm-screw::after{content:'';position:absolute;left:1px;right:1px;top:4px;height:1px;background:rgba(255,255,255,.25);transform:rotate(40deg);}",
      ".arm-screw.s1{left:10px;top:10px;} .arm-screw.s2{right:10px;top:10px;} .arm-screw.s3{left:10px;bottom:10px;transform:rotate(70deg);} .arm-screw.s4{right:10px;bottom:10px;transform:rotate(-30deg);}",
      ".arm-brf-cluster{position:absolute;top:22px;width:250px;display:flex;flex-direction:column;gap:8px;}",
      ".arm-brf-cluster.left{left:calc(12% - 125px);} .arm-brf-cluster.right{right:calc(12% - 125px);}",
      ".arm-brf-lbl{font-size:10px;letter-spacing:.2em;color:" + C.dim + ";}",
      ".arm-brf-hexes{display:flex;gap:8px;}",
      ".arm-mhex{width:34px;height:34px;display:flex;align-items:center;justify-content:center;border-radius:9px;font-size:15px;color:" + C.dim + ";border:1px dashed #34344a;}",
      ".arm-mhex.on{color:" + C.aqua + ";border:1px solid rgba(31,221,233,.6);background:rgba(31,221,233,.14);box-shadow:0 0 10px rgba(31,221,233,.35);}",
      ".arm-brf-info{font-size:11px;color:#fff;line-height:1.6;} .arm-brf-info span{color:" + C.dim + ";}",
      ".arm-brf-hw{display:flex;align-items:flex-end;gap:12px;margin-top:4px;}",
      ".arm-thr{display:flex;flex-direction:column;align-items:center;gap:3px;font-size:7px;letter-spacing:.14em;color:" + C.dim + ";}",
      ".arm-thr .track{position:relative;width:9px;height:66px;background:#0a0a12;border:1px solid #2a2a3e;border-radius:5px;display:block;}",
      ".arm-thr .fill{position:absolute;left:1px;right:1px;bottom:1px;height:68%;background:" + C.aqua + ";opacity:.5;border-radius:4px;display:block;}",
      ".arm-thr .grip{position:absolute;left:-10px;width:28px;height:14px;top:22%;background:linear-gradient(#3c3c52,#1a1a28);border:1px solid #4a4a66;border-radius:4px;display:block;}",
      ".arm-thr .grip::after{content:'';position:absolute;left:4px;right:4px;top:6px;height:1px;background:rgba(255,255,255,.3);}",
      ".arm-thr .ro{color:" + C.aqua + ";font-size:9px;}",
      ".arm-togs{display:flex;gap:7px;}",
      ".arm-togs .tog{position:relative;width:13px;height:25px;background:#0a0a12;border:1px solid #2a2a3e;border-radius:4px;display:block;}",
      ".arm-togs .tog::after{content:'';position:absolute;left:2px;right:2px;height:7px;border-radius:3px;background:#3a3a4c;top:2px;}",
      ".arm-togs .tog.on::after{bottom:2px;top:auto;background:" + C.aqua + ";box-shadow:0 0 7px rgba(31,221,233,.7);}",
      ".arm-togs .tog.guard{border-color:rgba(255,107,91,.6);} .arm-togs .tog.guard::before{content:'';position:absolute;inset:-2px;border:1px solid rgba(255,107,91,.5);border-radius:5px;background:rgba(255,107,91,.09);}",
      ".arm-leds{display:flex;gap:5px;align-items:center;}",
      ".arm-leds i{width:6px;height:6px;border-radius:50%;background:#22222f;display:block;}",
      ".arm-leds i.g{background:" + C.green + ";box-shadow:0 0 6px rgba(146,221,35,.7);}",
      ".arm-leds i.y{background:" + C.gold + ";box-shadow:0 0 6px rgba(255,200,87,.7);} .arm-leds i.y.bl{animation:armLedBl 1.6s steps(2) infinite;}",
      "@keyframes armLedBl{50%{opacity:.25;}}",
      ".arm-wave{display:flex;gap:3px;align-items:flex-end;height:22px;}",
      ".arm-wave b{width:4px;background:" + C.aqua + ";display:block;animation:armWave .9s ease-in-out infinite;}",
      ".arm-wave b:nth-child(1){height:8px;} .arm-wave b:nth-child(2){height:16px;animation-delay:.12s;} .arm-wave b:nth-child(3){height:11px;animation-delay:.24s;} .arm-wave b:nth-child(4){height:19px;animation-delay:.36s;} .arm-wave b:nth-child(5){height:9px;animation-delay:.48s;} .arm-wave b:nth-child(6){height:14px;animation-delay:.6s;}",
      "@keyframes armWave{50%{transform:scaleY(.45);}}",
      ".arm-brf-link{font-size:10.5px;color:" + C.mid + ";}",
      ".arm-brf-log{font-size:10.5px;color:" + C.dim + ";line-height:1.7;} .arm-brf-log span{color:" + C.aqua + ";}",
      ".arm-gauge{width:64px;height:34px;} .arm-knob{position:relative;width:26px;height:26px;border-radius:50%;background:radial-gradient(circle at 35% 30%, #3c3c52, #191924);border:2px solid #4a4a66;display:block;}",
      ".arm-knob::after{content:'';position:absolute;left:50%;top:2px;width:2px;height:8px;background:" + C.aqua + ";transform-origin:50% 11px;transform:translateX(-50%) rotate(var(--rot,0deg));}",
      ".arm-knob.gold::after{background:" + C.gold + ";}",
      ".arm-reduce .arm-brf-station,.arm-reduce .arm-brf-station .bem,.arm-reduce .arm-brf-hex,.arm-reduce .arm-wave b,.arm-reduce .arm-leds i.y.bl{animation:none;}",
      ".arm-comms-top{display:flex;gap:13px;align-items:center;margin-bottom:11px;}",
      ".arm-comms-port{width:74px;height:74px;border-radius:12px;flex-shrink:0;overflow:hidden;position:relative;border:1px solid rgba(31,221,233,.55);box-shadow:0 0 14px rgba(31,221,233,.28),inset 0 0 12px rgba(31,221,233,.12);}",
      ".arm-comms-port svg{width:100%;height:100%;display:block;}",
      ".arm-port-sweep{position:absolute;left:0;right:0;top:-22%;height:26%;background:linear-gradient(rgba(31,221,233,0),rgba(31,221,233,.45),rgba(31,221,233,0));pointer-events:none;opacity:0;}",
      ".arm-port-scan{position:absolute;inset:0;pointer-events:none;background:repeating-linear-gradient(0deg,rgba(4,12,16,.34) 0,rgba(4,12,16,.34) 1px,transparent 1px,transparent 3px);mix-blend-mode:multiply;}",
      ".arm-comms-scan{position:absolute;inset:0;z-index:6;pointer-events:none;border-radius:16px;background:repeating-linear-gradient(0deg,rgba(0,0,0,0) 0,rgba(0,0,0,0) 2px,rgba(31,221,233,.045) 3px,rgba(0,0,0,.12) 4px);background-size:100% 4px;opacity:.7;}",
      ".arm-comms-sig{margin-left:auto;display:flex;align-items:center;gap:8px;align-self:flex-start;flex-shrink:0;padding-right:6px;}",
      ".arm-sig-bars{display:flex;align-items:flex-end;gap:2px;height:14px;}",
      ".arm-sig-bars b{width:3px;border-radius:1px;background:" + C.aqua + ";opacity:.45;}",
      ".arm-sig-bars b:nth-child(1){height:5px;}.arm-sig-bars b:nth-child(2){height:8px;}.arm-sig-bars b:nth-child(3){height:11px;}.arm-sig-bars b:nth-child(4){height:14px;}",
      ".arm-sig-rec{font-size:9px;letter-spacing:.14em;color:" + C.peach + ";font-weight:700;}",
      // motion only under .tx-live (cleared when reducedMotion is set)
      ".arm-comms.tx-live .arm-comms-scan{animation:armScan 7s linear infinite,armFlick 5.5s steps(1) infinite;}",
      ".arm-comms.tx-live .arm-port-sweep{animation:armSweep 2.7s linear infinite;}",
      ".arm-comms.tx-live .arm-comms-port{animation:armJit 1.3s steps(4) infinite;}",
      ".arm-comms.tx-live .arm-sig-bars b{animation:armBars 1.1s ease-in-out infinite;}",
      ".arm-comms.tx-live .arm-sig-bars b:nth-child(2){animation-delay:.15s;}.arm-comms.tx-live .arm-sig-bars b:nth-child(3){animation-delay:.3s;}.arm-comms.tx-live .arm-sig-bars b:nth-child(4){animation-delay:.45s;}",
      ".arm-comms.tx-live .arm-sig-rec{animation:armBlink 1.4s steps(1) infinite;}",
      "@keyframes armScan{to{background-position-y:64px;}}",
      "@keyframes armFlick{0%,96%,100%{opacity:.7;}97%{opacity:.4;}98%{opacity:.82;}99%{opacity:.55;}}",
      "@keyframes armSweep{0%{top:-22%;opacity:0;}10%{opacity:1;}90%{opacity:1;}100%{top:120%;opacity:0;}}",
      "@keyframes armJit{0%,100%{transform:translate(0,0);}25%{transform:translate(.4px,0);}50%{transform:translate(0,.4px);}75%{transform:translate(-.4px,-.3px);}}",
      "@keyframes armBars{0%,100%{opacity:.4;}50%{opacity:1;}}",
      "@keyframes armBlink{0%,58%{opacity:1;}60%,100%{opacity:.25;}}",
      "@keyframes armHugePulse{0%,100%{box-shadow:0 0 26px rgba(31,221,233,.5);transform:scale(1);}50%{box-shadow:0 0 44px rgba(31,221,233,.85);transform:scale(1.06);}}",
      ".arm-comms-who{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:" + C.aqua + ";}.arm-comms-who b{display:block;color:" + C.text + ";font-size:15px;letter-spacing:.01em;margin-top:2px;text-transform:none;}",
      ".arm-comms-subj{font-size:10.5px;letter-spacing:.18em;text-transform:uppercase;color:" + C.aqua + ";margin-bottom:7px;opacity:.85;}",
      ".arm-comms-msg{font-size:15px;line-height:1.6;color:#e6e6f2;min-height:58px;}",
      ".arm-comms-key{font-size:15px;line-height:1.5;color:#fff;font-weight:600;}",
      ".arm-comms-why{margin-top:9px;font-size:14px;line-height:1.62;color:#c5c5d4;}",
      ".arm-comms-opts{display:flex;flex-direction:column;gap:8px;margin-top:14px;}",
      ".arm-comms-opt{width:100%;text-align:left;border:1px solid #34344a;border-radius:10px;background:linear-gradient(#1d1d2c,#131320);color:" + C.text + ";font-family:inherit;font-weight:600;font-size:14px;padding:11px 14px;cursor:pointer;transition:border-color .15s,background .15s;position:relative;box-shadow:inset 0 1px 0 rgba(255,255,255,.1), 0 3px 0 #0a0a12;}",
      ".arm-comms-type{display:none;white-space:pre-wrap;font-size:14px;line-height:1.6;color:#9ff0f7;text-shadow:0 0 6px rgba(31,221,233,.35);}",   /* (v0.180.0, ARM#7) */
      ".arm-comms-type::after{content:'\u258e';color:" + C.aqua + ";animation:armCaret 1s steps(1) infinite;}",
      "@keyframes armCaret{50%{opacity:0;}}",
      "[data-motion=\"reduced\"] .arm-comms-type::after{animation:none;}",
      ".arm-comms-msg.arm-msg-ink{display:none;}",
      ".arm-comms-opts.wait .arm-comms-opt{opacity:.35;cursor:default;}",
      ".arm-comms-opt::after{content:'';position:absolute;left:12px;right:12px;bottom:5px;height:2px;border-radius:2px;background:#26263a;}",
      ".arm-comms-opt.pri{background:linear-gradient(#0e3a42,#092830);border-color:" + C.aqua + ";color:#9ff0f7;box-shadow:inset 0 1px 0 rgba(255,255,255,.14), 0 3px 0 #04181d;}",
      ".arm-comms-opt.pri::after{background:" + C.aqua + ";box-shadow:0 0 8px rgba(31,221,233,.6);}",
      ".arm-comms-opt:active{transform:translateY(2px);box-shadow:inset 0 1px 0 rgba(255,255,255,.1), 0 1px 0 #0a0a12;}",
      ".arm-comms-opt:hover{border-color:" + C.aqua + ";}",
      ".arm-comms-opt.pri{font-weight:700;}",
      ".arm-comms-ctl{display:flex;justify-content:space-between;align-items:center;margin-top:12px;}",
      ".arm-comms-dots{display:flex;gap:5px;}.arm-dot{width:7px;height:7px;border-radius:50%;background:#33334a;}.arm-dot.on{background:" + C.aqua + ";}",
      ".arm-comms-next{border:none;border-radius:9px;background:" + C.aqua + ";color:#04222a;font-family:inherit;font-weight:700;font-size:14px;padding:9px 16px;cursor:pointer;}",
      ".arm-overlay{position:absolute;inset:0;display:none;align-items:center;justify-content:center;padding:18px;z-index:12;background:rgba(4,4,10,.62);}",
      ".arm-panel{width:100%;max-width:560px;max-height:92%;overflow:auto;background:rgba(18,18,27,.96);border:1px solid #34344a;border-radius:18px;padding:26px;box-shadow:0 18px 70px rgba(0,0,0,.65);}",
      ".arm-panel.iris{border-color:" + C.iris + ";}.arm-panel.aqua{border-color:" + C.aqua + ";}.arm-panel.green{border-color:" + C.green + ";}.arm-panel.peach{border-color:" + C.peach + ";}",
      ".arm-eyebrow{font-size:11px;letter-spacing:.24em;text-transform:uppercase;font-weight:700;margin-bottom:10px;}",
      ".e-aqua{color:" + C.aqua + ";}.e-iris{color:" + C.iris300 + ";}.e-green{color:" + C.green + ";}.e-peach{color:" + C.peach + ";}.e-gold{color:" + C.gold + ";}",
      ".arm-panel h1{font-size:30px;font-weight:800;margin:0 0 8px;letter-spacing:.01em;}.arm-panel h2{font-size:21px;font-weight:700;margin:0 0 12px;line-height:1.25;}",
      ".arm-body{font-size:15px;line-height:1.62;color:#dcdce8;}.arm-sub{color:" + C.mid + ";font-size:13.5px;line-height:1.55;}",
      ".arm-act{margin-top:16px;width:100%;padding:13px;border:none;border-radius:11px;background:" + C.iris + ";color:#fff;font-family:inherit;font-weight:700;font-size:15px;cursor:pointer;letter-spacing:.01em;}",
      ".arm-act:hover{background:" + C.iris600 + ";}.arm-act.ghost{background:transparent;border:1px solid #34344a;color:" + C.mid + ";}.arm-act.ghost:hover{border-color:" + C.iris + ";color:" + C.text + ";}",
      ".arm-act.ghost.sel{border-color:" + C.iris + ";color:" + C.text + ";}.arm-act.aqua{background:" + C.aqua + ";color:#04222a;}",
      ".arm-btnrow{display:flex;gap:10px;}",
      ".arm-opts{margin-top:14px;display:flex;flex-direction:column;gap:9px;}",
      ".arm-opt{width:100%;text-align:left;padding:13px 15px;border:1px solid #34344a;border-radius:11px;background:" + C.panel2 + ";color:" + C.text + ";font-family:inherit;font-size:14.5px;cursor:pointer;transition:opacity .22s ease;}",
      ".arm-opt:hover{border-color:" + C.iris + ";}.arm-opt.correct{border-color:" + C.green + ";background:rgba(146,221,35,.13);color:#eafcd6;}.arm-opt.wrong{border-color:" + C.peach + ";background:rgba(255,107,91,.13);color:#ffe1db;}",
      ".arm-opt.sel{border-color:" + C.aqua + ";background:rgba(31,221,233,.14);}",
      ".arm-multi-hint{font-size:12.5px;color:" + C.aqua + ";margin:6px 2px 2px;}.arm-submit:disabled{opacity:.4;cursor:not-allowed;}",
      ".arm-optmark{font-weight:800;}",
      ".arm-qtimer{font-size:13px;font-weight:700;color:" + C.green + ";margin:0 0 10px;letter-spacing:.04em;}.arm-qtimer.low{color:" + C.peach + ";}",
      ".arm-explain{margin-top:13px;padding:12px 14px;border-radius:9px;background:rgba(255,255,255,.04);border:1px solid #34344a;font-size:13.5px;line-height:1.55;color:#d6d6e2;}",
      ".arm-pwrap{margin-top:16px;display:flex;flex-direction:column;align-items:center;gap:14px;}",
      ".arm-pads{display:flex;flex-wrap:wrap;gap:14px;justify-content:center;}",
      ".arm-pad{width:74px;height:74px;border-radius:16px;border:2px solid #34344a;background:" + C.panel2 + ";cursor:pointer;}",
      ".arm-pad.p0{--c:" + C.iris + ";}.arm-pad.p1{--c:" + C.aqua + ";}.arm-pad.p2{--c:" + C.green + ";}.arm-pad.p3{--c:" + C.gold + ";}",
      ".arm-pad.lit{transform:scale(1.06);border-color:var(--c);box-shadow:0 0 24px var(--c);background:#262633;}",
      ".arm-hint{text-align:center;color:" + C.mid + ";font-size:13px;}",
      ".arm-pgrid{margin-top:16px;display:flex;flex-direction:column;align-items:center;gap:6px;}",
      ".arm-prow{display:flex;gap:6px;align-items:center;justify-content:center;}",
      ".arm-pend{width:46px;font-size:10px;font-weight:700;letter-spacing:.08em;color:" + C.dim + ";text-align:center;}.arm-pend.on{color:" + C.aqua + ";text-shadow:0 0 10px rgba(31,221,233,.5);}",
      ".arm-pcell{width:52px;height:52px;border:1.5px solid #34344a;border-radius:10px;background:" + C.panel2 + ";cursor:pointer;padding:0;display:flex;align-items:center;justify-content:center;}",
      ".arm-pcell:hover{border-color:" + C.iris + ";}.arm-pcell.lit{border-color:" + C.aqua + ";box-shadow:0 0 12px rgba(31,221,233,.4);}",
      ".arm-dials{display:flex;gap:16px;flex-wrap:wrap;justify-content:center;}",
      ".arm-dial{width:84px;height:84px;border-radius:50%;border:2px solid #34344a;background:radial-gradient(circle,#21212e,#16161f);cursor:pointer;position:relative;}",
      ".arm-dial:hover{border-color:" + C.iris + ";}.arm-dial.match{border-color:" + C.green + ";box-shadow:0 0 20px rgba(146,221,35,.4);}",
      ".arm-dial .arm-ptr{position:absolute;left:50%;top:50%;width:4px;height:36px;background:" + C.iris300 + ";border-radius:3px;transform-origin:50% 100%;box-shadow:0 0 10px rgba(172,155,253,.7);}",
      ".arm-dial .arm-tgt{position:absolute;left:50%;top:6px;width:8px;height:8px;border-radius:50%;background:" + C.green + ";transform-origin:50% 36px;opacity:.85;}",
      // puzzle completion timer (core-stability bar)
      ".arm-ptimer{margin-top:16px;display:flex;flex-direction:column;gap:5px;}",
      ".arm-ptimer-cap{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:" + C.mid + ";}",
      ".arm-ptimer-track{height:7px;border-radius:4px;background:rgba(120,85,250,.16);overflow:hidden;}",
      ".arm-ptimer-track>i{display:block;height:100%;width:100%;border-radius:4px;background:linear-gradient(90deg," + C.iris + "," + C.aqua + ");transition:width .12s linear;}",
      ".arm-ptimer.low .arm-ptimer-cap{color:" + C.peach + ";}",
      ".arm-ptimer.low .arm-ptimer-track>i{background:" + C.peach + ";box-shadow:0 0 12px rgba(255,107,91,.6);}",
      // S3 polarity bank (battery)
      ".arm-dec-row{display:flex;gap:12px;justify-content:center;margin:8px 0;}",
      ".arm-dec-slot{width:58px;height:58px;border-radius:14px;border:2px solid #34344a;background:" + C.panel2 + ";font-size:26px;color:" + C.aqua + ";cursor:pointer;}",
      ".arm-dec-slot:active{transform:scale(.94);}",
      ".arm-dec-pips{display:flex;gap:7px;justify-content:center;margin:10px 0 4px;min-height:14px;}",
      ".arm-pip{width:12px;height:12px;border-radius:50%;border:1px solid #34344a;}",
      ".arm-pip.gold{background:" + C.gold + ";border-color:" + C.gold + ";}",
      ".arm-pip.aqua{background:" + C.aqua + ";border-color:" + C.aqua + ";}",
      ".arm-pip.off{background:transparent;}",
      ".arm-trace{display:grid;gap:10px;justify-content:center;margin:8px auto;max-width:280px;}",
      ".arm-trace-node{width:52px;height:52px;border-radius:12px;border:2px solid #34344a;background:" + C.panel2 + ";color:#9a9aad;font-size:13px;font-weight:700;cursor:pointer;}",
      ".arm-trace-node.link{border-color:" + C.iris300 + ";}",
      ".arm-trace-node.lit{border-color:" + C.aqua + ";color:" + C.aqua + ";background:rgba(31,221,233,.10);}",
      ".arm-trace-node.head{box-shadow:0 0 12px rgba(31,221,233,.6);}",
      ".arm-batt{display:flex;flex-wrap:wrap;gap:14px;justify-content:center;}",
      ".arm-batt-slot{padding:6px 6px 4px;border-radius:14px;border:2px solid #34344a;background:" + C.panel2 + ";transition:border-color .12s,box-shadow .12s;}",
      ".arm-batt-slot.ok{border-color:" + C.green + ";box-shadow:0 0 16px rgba(146,221,35,.35);}",
      ".arm-batt-cell{background:none;border:0;padding:0;cursor:pointer;display:block;line-height:0;}",
      ".arm-batt-cell:active{transform:scale(.94);}",
      // S3 capacity planner (vCPU)
      ".arm-vms{display:flex;flex-direction:column;gap:9px;width:min(420px,86vw);}",
      ".arm-vm{display:flex;align-items:center;gap:10px;}",
      ".arm-vm.target .arm-vm-num{color:" + C.green + ";}",
      ".arm-vm-tag{flex:0 0 38px;font-size:12px;font-weight:700;color:" + C.dim + ";letter-spacing:.04em;}",
      ".arm-vm-step{flex:0 0 34px;height:34px;border-radius:9px;border:1.5px solid " + C.iris + ";background:rgba(120,85,250,.14);color:" + C.iris300 + ";font-size:18px;font-weight:700;cursor:pointer;padding:0;line-height:1;}",
      ".arm-vm-step:active{transform:scale(.92);}",
      ".arm-vm-meter{flex:1;height:14px;border-radius:8px;border:1px solid #33334a;overflow:hidden;background:rgba(10,10,18,.5);}",
      ".arm-vm-meter>i{display:block;height:100%;width:0;border-radius:8px;background:linear-gradient(90deg," + C.iris + "," + C.aqua + ");transition:width .12s;}",
      ".arm-vm-num{flex:0 0 24px;text-align:center;font-size:15px;font-weight:800;color:" + C.text + ";}",
      ".arm-vcpu-read{display:flex;gap:14px;flex-wrap:wrap;justify-content:center;font-size:12.5px;color:" + C.mid + ";letter-spacing:.03em;}",
      ".arm-vcpu-read b{color:" + C.text + ";}.arm-vcpu-read .ok{color:" + C.green + ";}.arm-vcpu-read .no{color:" + C.peach + ";}",
      ".arm-vcpu-all{display:flex;gap:10px;}",
      ".arm-vcpu-allbtn{border-radius:9px;border:1.5px solid #34344a;background:rgba(16,16,24,.7);color:" + C.mid + ";font-family:inherit;font-size:12.5px;font-weight:700;padding:7px 12px;cursor:pointer;letter-spacing:.03em;}",
      ".arm-vcpu-allbtn:active{transform:scale(.95);}",
      // swap-to-sort signal bands
      ".arm-sort{display:flex;gap:10px;align-items:flex-end;justify-content:center;min-height:100px;}",
      ".arm-band{width:46px;border:2px solid #34344a;border-radius:10px 10px 6px 6px;background:linear-gradient(180deg,rgba(120,85,250,.35),rgba(120,85,250,.12));color:" + C.text + ";cursor:pointer;display:flex;align-items:flex-end;justify-content:center;padding:0 0 6px;font-size:13px;font-weight:700;transition:all .12s;}",
      ".arm-band:hover{border-color:" + C.iris + ";}",
      ".arm-band.sel{border-color:" + C.aqua + ";background:linear-gradient(180deg,rgba(31,221,233,.4),rgba(31,221,233,.15));box-shadow:0 0 16px rgba(31,221,233,.4);transform:translateY(-4px);}",
      ".arm-shoptabs{display:flex;gap:8px;margin-top:6px;}.arm-shoptabs .arm-act{margin-top:6px;}",
      ".arm-balance{float:right;color:" + C.gold + ";font-size:16px;}",
      ".arm-shopgrid{margin-top:14px;display:flex;flex-direction:column;gap:10px;}",
      ".arm-item{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 14px;border:1px solid #34344a;border-radius:12px;background:" + C.panel2 + ";}",
      ".arm-ic{width:38px;height:38px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:18px;border:1px solid #34344a;background:rgba(120,85,250,.08);flex-shrink:0;}",
      ".arm-info{flex:1;min-width:0;}.arm-nm{font-weight:700;font-size:14px;}.arm-ds{font-size:12px;color:" + C.mid + ";margin-top:1px;}",
      ".arm-pips{display:flex;gap:3px;margin-top:5px;}.arm-pip{width:14px;height:5px;border-radius:3px;background:#33334a;}.arm-pip.on{background:" + C.iris + ";box-shadow:0 0 7px rgba(120,85,250,.7);}",
      ".arm-buy{padding:9px 13px;border:1px solid " + C.iris + ";border-radius:9px;background:transparent;color:" + C.iris300 + ";font-family:inherit;font-weight:700;font-size:13px;cursor:pointer;white-space:nowrap;}",
      ".arm-buy:hover:not(:disabled){background:" + C.iris + ";color:#fff;}.arm-buy:disabled{opacity:.4;cursor:default;border-color:#34344a;color:" + C.dim + ";}",
      ".arm-toggle{display:flex;justify-content:space-between;align-items:center;padding:13px 4px;border-bottom:1px solid #34344a;}",
      ".arm-sw{width:50px;height:28px;border-radius:999px;background:#33334a;position:relative;cursor:pointer;}.arm-sw.on{background:" + C.green + ";}",
      ".arm-sw i{position:absolute;top:3px;left:3px;width:22px;height:22px;border-radius:50%;background:#fff;transition:left .15s;}.arm-sw.on i{left:25px;}",
      ".arm-statline{display:flex;gap:22px;margin-top:18px;flex-wrap:wrap;}.arm-n{font-size:26px;font-weight:800;}.arm-l{font-size:12px;color:" + C.mid + ";text-transform:uppercase;letter-spacing:.08em;}",
      ".arm-pick-note{margin-top:7px;padding:6px 9px;border-left:2px solid " + C.peach + ";background:rgba(255,107,91,.08);font-size:12.5px;color:" + C.mid + ";border-radius:0 8px 8px 0;}",
      ".arm-exhibit-warn{margin:6px 0;padding:6px 9px;border-left:2px solid " + C.gold + ";background:rgba(255,200,87,.1);font-size:12.5px;color:" + C.gold + ";}",
      ".arm-explain-more{margin-top:7px;}.arm-explain-more summary{cursor:pointer;color:" + C.aqua + ";font-size:12.5px;font-weight:600;}.arm-explain-more div{margin-top:5px;}",
      ".arm-toast{position:absolute;left:50%;bottom:104px;transform:translateX(-50%);background:rgba(18,18,27,.96);border:1px solid " + C.iris + ";border-radius:11px;padding:10px 17px;font-size:13px;z-index:9;opacity:0;transition:opacity .25s;pointer-events:none;white-space:nowrap;max-width:90%;text-align:center;}",
      "@media (max-width:560px){.arm-panel h1{font-size:25px;}.arm-panel{padding:20px;}.arm-pad{width:62px;height:62px;}.arm-dial{width:72px;height:72px;}.arm-stats{min-width:150px;}.arm-key{width:52px;height:52px;}.arm-action{width:68px;height:68px;}}",
    ].join("\n");
  }

  /* ---------------------------------------------------------------------- */
  /* register with the shell (load-order tolerant)                          */
  /* ---------------------------------------------------------------------- */
  var mod = createArm();
  if (typeof window !== "undefined") {
    if (window.StarNix && typeof window.StarNix.registerGame === "function") {
      window.StarNix.registerGame(mod);
    } else {
      window.__StarNixGames = window.__StarNixGames || [];
      window.__StarNixGames.push(mod);
    }
  }
})();
