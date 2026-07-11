/* ============================================================================
 * StarNix — CC · Chasm Chase  (04_CC_chasm_chase.md)
 * 3D endless runner. Self-contained plain-JS GameModule on window.StarNix.
 *
 * ARCHITECTURE (so logic is testable headless, Three mocked / absent):
 *   CCSim   — PURE simulation. Zero THREE, zero DOM. All game logic:
 *             pooling, lanes, jump/duck, spawner (+solvability), collision,
 *             coins/cores, shields, buffs, scoring, question flow, mastery.
 *             Deterministic given an injected rng. THIS is the test target.
 *   CCView  — Three.js renderer. The ONLY part importing THREE. Thin: reads
 *             sim state each frame and syncs instanced/pooled meshes. dispose().
 *   module  — DOM/canvas/input/RAF(fixed-timestep)/audio/overlay/HUD wiring.
 *
 * Loads in browser (attaches to window.StarNix, registers) AND in Node
 * (module.exports = { CCSim, CCView, createCCModule, CONFIG }).
 * ==========================================================================*/
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api; // Node/tests
  if (typeof window !== 'undefined') {
    window.CC = api;                                   // exposed for in-page self-test
    if (window.StarNix && typeof window.StarNix.registerGame === 'function') {
      window.StarNix.registerGame(api.createCCModule());
    }
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ========================== TUNING (named constants) =====================
   * All tuning, not design. Easy to adjust. Overridable per-CCSim via config. */
  var CONFIG = {
    // World / lanes
    LANE_W: 2.2,                  // x distance between lane centers
    LANE_TWEEN: 0.16,             // seconds to change lane (< JUMP_TIME, so lane switch never the binding constraint)
    DRAW_DIST: 120,              // spawn distance ahead (m); fog hides pop-in
    CULL_BEHIND: -12,            // recycle once an object passes this z

    // Player hitbox (AABB)
    PLAYER_HW: 0.7,              // half width (x)
    PLAYER_DEPTH: 0.7,           // half depth (z) — collision slab half
    PLAYER_H: 1.9,              // standing top (y) — raised to match the visual ship (1.9) so the arch underside can sit higher (bigger, more visible duck gap) while standing still hits it
    PLAYER_DUCK_H: 0.7,         // ducked top (y)

    // Jump / duck (discrete, not holdable)
    JUMP_TIME: 0.62,            // full arc duration
    JUMP_HEIGHT: 2.4,
    JUMP_HANG_MAX: 0.5,         // (Jason) extra seconds the player floats at the apex while the jump button is HELD
    DUCK_TIME: 0.55,

    // Obstacles
    OBST_DEPTH: 0.7,           // half depth (z)
    ROCK_H: 1.25,             // (Jason v0.47.0) the jump obstacle is now a FULL-WIDTH low wall, "a lot bigger": collision top raised 0.6 -> 1.25. Still comfortably jumpable — sin arc clears it for ~63% of JUMP_TIME (base > 1.25/2.4 of apex), vs a ~0.03 s crossing at MAX_SPEED.
    SWEEP_FREQ: 0.30,         // (v0.56.0) OB_SWEEP lateral pan, radians per metre of approach — a full sweep cycle every ~21 m; beam x = sin(phase + z*freq) * LANE_W (pure fn of z: deterministic, one source of truth for sim + view)
    CEIL_BOTTOM: 1.5,         // (Jason) arch underside / duck clearance — raised from 1.0 so the gap is bigger and reads clearly (duck top 0.7 still passes; stand top 1.9 still hits)
    ARCH_H: 5.3,             // (Jason) arch TOP raised to the chasm rim — ARCH_H = RIM_Y(6.8) - CEIL_BOTTOM(1.5) = 5.3, so the top sits flush with the chasm lip (no gap above; unlike the old 5.5 whose top at 7.0 poked ABOVE the rim) while the underside stays at the duck clearance (1.5). A duck obstacle whose top reaches the rim MUST be this tall — its underside can't rise above head height or it stops being duckable.

    // Speed ramp (distance-based so slow-mo never changes spatial layout).
    // Raised hard for a much faster read (04 task 2). Perceived speed is mostly the
    // view's job (scroll/ticks/dust/FOV); these set the real spatial pace.
    BASE_SPEED: 44,
    MAX_SPEED: 84,
    SPEED_RAMP: 0.009,         // +units/s per meter (reaches MAX ~4.4 km in) — faster run (Jason feedback)

    // Spawner cadence (meters between rows). MIN_GAP >= MAX_SPEED*JUMP_TIME
    // guarantees consecutive discrete actions never temporally overlap.
    BASE_GAP: 72,
    MIN_GAP: 54,             // 84*0.62 = 52.1 -> 54 w/ reaction margin (rows stay dodgeable at the higher MAX_SPEED)
    GAP_K: 0.45,             // gap shrink per (speed-BASE_SPEED): 72 - 40*0.45 = 54 at MAX

    // Cores (questions) — sparse so questions feel "every so often"
    GATE_GAP_MIN: 150,
    GATE_GAP_MAX: 260,
    GATE_CLEAR: 40,            // widened (04 task 6): no obstacle within this z-window of a gate (clean approach to every gate)
    POWER_GATE_CHANCE: 0.10,   // ~10% of gates are power gates (grant a buff)

    // Distance scoring (04 task 7). The SCORE is distance travelled, shown in km. The displayed travel
    // rate is dramatized to SCORE_SPEED m/s — the REAL world-scroll stays at BASE/MAX_SPEED so the run
    // stays dodgeable (literal 500 m/s collision speed would be unreactable). A question gate lands every
    // GATE_KM of scored distance; coins are removed (score is distance only).
    SCORE_SPEED: 500,          // dramatized metres/second the HUD shows + the rate scored distance accrues
    TURN_KM: 250,              // (v0.104.0, C4) a 90° turn every N scored km; matching lane or you clip the wall
    TURN_WARN_S: 4,            // seconds of MOVE LEFT/RIGHT warning before the turn hits
    GATE_KM: 10,               // a question gate every 10 km of scored distance

    // Boost power-up (04 task 8): every GATES_PER_BOOST gates, the ship blasts forward — invulnerable,
    // the canyon fast-forwards (real scroll jumps to BOOST_SPEED), and scored distance covers BOOST_KM
    // over ~BOOST_TIME seconds (no timer UI — it ends when that distance is reached). Gates don't fire
    // during the skip; the normal cadence resumes after.
    GATES_PER_BOOST: 2,          // (v0.77.0, JB6) boost every 2 gates = every 20 km (was 5 = 50 km)
    BOOST_KM: 100,             // scored distance the boost covers
    BOOST_TIME: 6,             // (v0.103.0, C7, Jason) doubled — ~seconds the boost lasts (score rate: BOOST_KM*1000/BOOST_TIME)
    BOOST_SPEED: 200,          // real world-scroll during boost (≈2.4× MAX_SPEED) — the fast-forward visual

    // Coins
    COIN_VALUE: 1,            // (v0.101.0, C12, Jason) each coin is worth exactly 1
    COIN_RUN_MIN: 3,           // coins per laid coin-line
    COIN_RUN_MAX: 6,
    COIN_SPACING: 3.0,
    COIN_LINE_CHANCE: 0.7,
    MAGNET_RANGE: 14,
    MAGNET_PULL: 18,           // units/s toward player x while magnet active

    // Scoring / shields
    DIST_FACTOR: 1,            // points per meter of distance
    SHIELDS_START: 5,
    SHIELDS_MAX: 5,
    COLLISION_SHIELD_COST: 1,  // <-- spec gap (04): obstacle hit costs 1 shield. 0 = no penalty.
    // Shield-loss grace (04 task 4): after a crash, ALL obstacles are no-ops for this many
    // seconds, so you can never lose two shields back-to-back with no time to react. This is
    // both the i-frame window and the tunable "grace gap" the spec asks for.
    COLLIDE_IFRAME: 1.0,
    HIT_FLASH: 0.34,           // view-side: duration of the sharp damage flash on a crash (≠ the protected glow)
    POST_Q_GRACE: 1.5,         // <-- fairness: invuln seconds after a question resumes (ship glows), so an
                               //     obstacle spawned just ahead (near the gate that paused us)
                               //     while the world was paused can't be an instant, unreactable hit.

    // Buff durations (seconds). shieldPlus is instant.
    BUFF_MAGNET: 10,
    BUFF_INVINCIBLE: 7,
    BUFF_COINX2: 10,
    BUFF_SLOWMO: 4,
    SLOWMO_FACTOR: 0.55,

    // Pool capacities (fixed; sized > worst-case simultaneously-alive). Never grow.
    POOL_OBSTACLES: 32,
    POOL_COINS: 96,
    POOL_GATES: 8,
    POOL_PARTICLES: 128,       // view-side only

    // Fixed timestep
    FIXED_DT: 1 / 120
  };

  // Obstacle / buff enums (ints — no string compares in hot loop where avoidable)
  // OB_NARROW: a canyon-wall extension that closes ONE outer lane (3->2 lanes). side L/R.
  // OB_LOWROCK: (Jason v0.47.0) a full-width LOW WALL spanning ALL lanes — JUMP it (lane-independent).
  //             The mirror of the arch: same wall-to-wall slab, same rock texture; the arch leaves a
  //             gap at the BOTTOM (duck under), the wall is solid at the bottom (jump over).
  // OB_ARCH: a full-width rock arch spanning ALL lanes — duck under it (lane-independent).
  // OB_SWEEP: (v0.56.0) a low energy beam that PANS the canyon laterally as it approaches —
  // jump is the guaranteed out (worst case); slipping past where it isn't is the skill play.
  var OB_NARROW = 0, OB_LOWROCK = 1, OB_ARCH = 2, OB_SWEEP = 3;
  var SIDE_LEFT = 0, SIDE_RIGHT = 1;   // OB_NARROW.side -> which outer lane it seals (left=lane0, right=lane2)
  var BUFF_MAGNET = 'magnet', BUFF_INVINCIBLE = 'invincible', BUFF_SHIELDPLUS = 'shieldPlus',
      BUFF_COINX2 = 'coinX2', BUFF_SLOWMO = 'slowmo';
  var TIMED_BUFFS = [BUFF_MAGNET, BUFF_INVINCIBLE, BUFF_COINX2, BUFF_SLOWMO]; // shieldPlus instant
  var POWER_KINDS = [BUFF_MAGNET, BUFF_INVINCIBLE, BUFF_SHIELDPLUS, BUFF_COINX2, BUFF_SLOWMO];

  // Phases
  var PHASE_RUN = 'RUN', PHASE_QUESTION = 'QUESTION', PHASE_EXPLAIN = 'EXPLAIN', PHASE_OVER = 'OVER';

  /* Camera poses (browser-tuned — adjust here in one place). The chasm chase is a high-angle
   * drone shot that sits just above the planet surface, looking down INTO the chasm at the ship
   * and the fleeing squadron, so the rim surface reads as a planet with a gash cut through it.
   * The intro starts high and wide (establishing the planet + chasm) and eases into the chase. */
  var CAM = {
    chasePos: [0, 5.4, 9.2], chaseLook: [0, 0.35, -14],   // (Jason v0.47.0) look-at pulled DOWN + nearer -> the horizon rises and the ship sits noticeably higher in the frame (knobs: raise chaseLook[1] to lower the ship on screen)
    introPos: [7.0, 23.0, 27.0], introLook: [0, 3.4, -12]
  };
  var RIM_Y = 6.8;   // planet-surface height = chasm lip (flush with the canyon-wall tops)

  /* =============================== POOL =====================================
   * Pre-allocated, zero-allocation-after-construction object pool with O(1)
   * acquire/release via a preallocated free-stack. Tracks counters so the
   * harness can prove stable allocation + no leaks. */
  function makePool(capacity, factory) {
    var items = new Array(capacity);
    var freeStack = new Int32Array(capacity);
    var i;
    for (i = 0; i < capacity; i++) {
      items[i] = factory();          // factory runs ONLY here (construction)
      items[i].active = false;
      items[i]._i = i;
      freeStack[i] = i;
    }
    return {
      items: items,
      capacity: capacity,
      _top: capacity,                // free indices live in freeStack[0.._top-1]
      factoryCalls: capacity,        // must stay == capacity forever (no growth)
      acquiredEver: 0,
      releasedEver: 0,
      live: 0,
      exhaustions: 0,                // times acquire() failed (sizing bug if >0)
      acquire: function () {
        if (this._top === 0) { this.exhaustions++; return null; }
        var idx = freeStack[--this._top];
        var o = items[idx];
        o.active = true;
        this.acquiredEver++; this.live++;
        return o;
      },
      release: function (o) {
        if (!o.active) return;
        o.active = false;
        freeStack[this._top++] = o._i;
        this.releasedEver++; this.live--;
      }
    };
  }

  // Record factories (all numeric/boolean fields pre-declared — no shape changes)
  function newObstacle() { return { active: false, _i: 0, type: 0, lane: 0, side: 0, x: 0, z: 0, tested: false, span: 1, sweepPhase: 0 }; }
  function newCoin() { return { active: false, _i: 0, lane: 0, x: 0, y: 0, z: 0, tested: false, collected: false }; }
  function newGate() { return { active: false, _i: 0, lane: 0, x: 0, z: 0, power: false, kind: '', tested: false }; }

  /* =============================== CCSim ====================================
   * Pure logic. deps = { ctx, rng, config }. ctx supplies questions/mastery/
   * telemetry (audio/theme/etc. are the module's concern, not the sim's). */
  function CCSim(deps) {
    deps = deps || {};
    var cfg = this.cfg = Object.assign({}, CONFIG, deps.config || {});
    this.ctx = deps.ctx || {};
    this.rng = deps.rng || makeFallbackRng(1);

    this.obstacles = makePool(cfg.POOL_OBSTACLES, newObstacle);
    this.coins = makePool(cfg.POOL_COINS, newCoin);
    this.gates = makePool(cfg.POOL_GATES, newGate);
    this._pools = [this.obstacles, this.coins, this.gates];

    // Player state
    this.player = {
      lane: 1,
      x: 0, fromX: 0, targetX: 0, laneT: 1,    // laneT: 1 = settled; fromX = lane being left
      jumpT: 0, jumping: false,       // discrete arc 0..1
      jumpHeld: false, jumpHang: 0,   // (Jason) hold-to-extend: held = floating at apex; jumpHang = seconds floated
      duckT: 0, ducking: false,
      y: 0, topY: cfg.PLAYER_H        // derived each tick
    };

    // Buff timers (fixed object — no per-frame alloc)
    this.buffs = { magnet: 0, invincible: 0, coinX2: 0, slowmo: 0 };

    this.reset();
  }

  CCSim.prototype.reset = function () {
    var cfg = this.cfg, p = this.player, i;
    // free everything
    for (i = 0; i < this._pools.length; i++) {
      var pool = this._pools[i], items = pool.items;
      for (var k = 0; k < items.length; k++) if (items[k].active) pool.release(items[k]);
    }
    p.lane = 1; p.x = 0; p.fromX = 0; p.targetX = 0; p.laneT = 1;
    p.jumpT = 0; p.jumping = false; p.jumpHeld = false; p.jumpHang = 0; p.duckT = 0; p.ducking = false; p.y = 0; p.topY = cfg.PLAYER_H;
    this.buffs.magnet = 0; this.buffs.invincible = 0; this.buffs.coinX2 = 0; this.buffs.slowmo = 0;

    this.phase = PHASE_RUN;
    this.shields = cfg.SHIELDS_START + (this._up ? this._up.hull : 0);   // (J9) hull tiers
    this._platingLeft = (this._up && this._up.plating) ? 1 : 0;          // (J9) once per run
    this.distance = 0;
    this.scoreDistance = 0;          // 04 task 7: dramatized distance (km HUD + 10km gate cadence), decoupled from world-scroll
    this.scoreSpeed = cfg.SCORE_SPEED;
    this.coinScore = 0;
    this.iframe = 0;
    this.hitFlash = 0;               // >0 = currently showing the sharp damage flash (view reads this)
    this.speed = cfg.BASE_SPEED;
    this.collisions = 0;             // diagnostic (harness solvability)

    this._nextRowAt = cfg.BASE_GAP;      // distance threshold for next obstacle row
    this._nextGateAt = this.rng.next() * (cfg.GATE_GAP_MAX - cfg.GATE_GAP_MIN) + cfg.GATE_GAP_MIN + 20;
    this._nextGateScore = cfg.GATE_KM * 1000;   // 04 task 7: first gate at 10 km of scored distance, then every 10 km
    this._gatesSpawned = 0;
    this.boostActive = false;                   // 04 task 8: boost power-up state
    this._gatesPassed = 0;
    this._boostPending = false;
    this._boostTargetScore = 0; this._boostCalmUntil = 0;
    this._nextCoinAt = cfg.BASE_GAP * 0.5;
    // (v0.102.0, C9, Jason) squeeze stretches: the canyon narrows to TWO lanes for 1-2 km
    this._squeezeUntil = 0; this._squeezeSide = SIDE_LEFT; this._nextSqueezeAt = 700;
    // (v0.104.0, C4, Jason) a 90° TURN every 250 km scored: be in the matching lane when it hits
    this._nextTurnScore = cfg.TURN_KM * 1000 + 5000;   // +5 km off the 10-km gate grid — a corner never lands ON a question
    this.turnPending = null;                   // { dir: 'left'|'right', atScore } while the warning is up
    this._gateZones = [];                // absolute distances of live gates; obstacle rows keep clear of these (fairness)

    this.pending = null;             // { question, power, kind, startedMs }
    this.lastResult = null;          // { correct, question, chosen, shieldDelta } for UI
    this._askedIds = [];             // exclude within this run
    this._answered = Object.create(null); // id -> {c:bool,i:bool} for unique tracking
    this.runStats = { uniqueCorrect: 0, uniqueIncorrect: 0, points: 0, distance: 0, answered: 0 };
    this._nowMs = 0;
  };

  // ---- input (pure; module calls these) ----
  CCSim.prototype.moveLeft = function () {
    if (this.phase !== PHASE_RUN || this.boostActive) return;   // (v0.103.0, C7) no steering in Boost Mode
    if (this.player.lane > 0) { this.player.lane--; this._retarget(); }
  };
  CCSim.prototype.moveRight = function () {
    if (this.phase !== PHASE_RUN || this.boostActive) return;   // (C7)
    if (this.player.lane < 2) { this.player.lane++; this._retarget(); }
  };
  CCSim.prototype._retarget = function () {
    this.player.fromX = this.player.x;
    this.player.targetX = (this.player.lane - 1) * this.cfg.LANE_W;
    this.player.laneT = 0;
  };
  CCSim.prototype.jump = function () {
    if (this.phase !== PHASE_RUN) return;
    var p = this.player;
    if (!p.jumping && !p.ducking) { p.jumping = true; p.jumpT = 0; p.jumpHang = 0; p.jumpHeld = false; }
  };
  // (Jason) hold-to-extend: a press calls jump() then holdJump(); release calls releaseJump(). Instant inputs (swipe/tap) call jump() only -> no hang.
  CCSim.prototype.holdJump = function () { if (this.phase === PHASE_RUN) this.player.jumpHeld = true; };
  CCSim.prototype.releaseJump = function () { this.player.jumpHeld = false; };
  CCSim.prototype.duck = function () {
    if (this.phase !== PHASE_RUN) return;
    var p = this.player;
    if (!p.ducking && !p.jumping) { p.ducking = true; p.duckT = 0; }
  };

  // ---- main fixed-step update (alloc-free hot path) ----
  CCSim.prototype.step = function (dt) {
    this._nowMs += dt * 1000;
    if (this.phase !== PHASE_RUN) return;        // paused during question / over
    var cfg = this.cfg, p = this.player;

    // speed ramp (distance-based) + slow-mo
    this.speed = cfg.BASE_SPEED + this.distance * cfg.SPEED_RAMP;
    if (this.speed > cfg.MAX_SPEED) this.speed = cfg.MAX_SPEED;
    if (this.boostActive) this.speed = cfg.BOOST_SPEED;          // 04 task 8: fast-forward the canyon
    var effSpeed = this.buffs.slowmo > 0 ? this.speed * cfg.SLOWMO_FACTOR : this.speed;

    var adv = effSpeed * dt;
    this.distance += adv;
    // 04 task 7/8: scored distance accrues at SCORE_SPEED — or covers BOOST_KM over ~BOOST_TIME during a boost
    this.scoreSpeed = this.boostActive ? ((cfg.BOOST_KM + (this._up ? this._up.boostKm : 0)) * 1000 / cfg.BOOST_TIME) : cfg.SCORE_SPEED;
    this.scoreDistance += this.scoreSpeed * dt;
    // (v0.104.0, C4) turn lifecycle: warn TURN_WARN_S ahead (never during a boost ride),
    // then require the matching lane the instant the threshold crosses. Miss = wall clip.
    if (!this.turnPending && !this.boostActive && this.scoreDistance >= this._nextTurnScore - cfg.SCORE_SPEED * cfg.TURN_WARN_S) {
      if (this.scoreDistance >= this._nextTurnScore) {
        // a boost overran this corner — boost is autopilot, the turn is flown for you
        this._nextTurnScore += cfg.TURN_KM * 1000;
      } else {
      this.turnPending = { dir: this.rng.next() < 0.5 ? 'left' : 'right', atScore: this._nextTurnScore };
      // keep the corridor clear through the corner (rows + coins respect gate zones)
      this._gateZones.push(this.distance + (this._nextTurnScore - this.scoreDistance) * (this.speed / this.scoreSpeed));
      this._emit && this._emit('turnwarn');
      }
    }
    if (this.turnPending && !this.boostActive && this.scoreDistance >= this.turnPending.atScore) {
      var needLane = this.turnPending.dir === 'right' ? 2 : 0;
      var madeIt = this.player.lane === needLane || this.iframe > 0;   // (v0.108.0, G4) grace windows apply to corners too — no undodgeable clip off a question
      this.turnMade = madeIt; this.turnDir = this.turnPending.dir;   // view reads these for the yaw flourish
      if (!madeIt) this._onCrash();                                  // clipped the corner wall — shield cost, run continues
      this._emit && this._emit(madeIt ? 'turn' : 'turnfail');
      if (this.ctx.telemetry && typeof this.ctx.telemetry.emit === 'function') this.ctx.telemetry.emit({ t: 'turn', game: 'CC', made: madeIt, dir: this.turnPending.dir });
      this.turnPending = null;
      this._nextTurnScore += cfg.TURN_KM * 1000;
    }
    if (this.boostActive && this.scoreDistance >= this._boostTargetScore) {
      this.boostActive = false;
      this._boostCalmUntil = this.distance + this.cfg.MAX_SPEED * 5;   // (v0.103.0, C7) ~5s of clear road at cruise (boost speed would triple it)
      // (v0.108.0, G4) a warning with less than 3/4 of its window left is autopiloted too —
      // a boost ending mid-warning left near-zero reaction from the forced center lane
      if (this.turnPending && (this.turnPending.atScore - this.scoreDistance) < cfg.SCORE_SPEED * cfg.TURN_WARN_S * 0.75) {
        this.turnPending = null; this._nextTurnScore += cfg.TURN_KM * 1000; this._emit && this._emit('turnauto');
      }
      this.iframe = Math.max(this.iframe, 1.0);      // hand control back gently — no instant faceplant
      this._nextGateScore = (Math.floor(this.scoreDistance / (cfg.GATE_KM * 1000)) + 1) * (cfg.GATE_KM * 1000);   // (v0.108.0, G4) SNAP to the 10-km grid — drift was letting gates land inside turn warnings
    }

    // player lane tween (linear from the lane being left to the target)
    if (p.laneT < 1) {
      p.laneT += dt / cfg.LANE_TWEEN;
      if (p.laneT >= 1) { p.laneT = 1; p.x = p.targetX; }
      else { var _lt = p.laneT * p.laneT * (3 - 2 * p.laneT); p.x = p.fromX + (p.targetX - p.fromX) * _lt; }   // smoothstep: eases in AND out (no robotic linear slide)
    }

    // jump arc — (Jason) while the button is HELD, float at the apex up to JUMP_HANG_MAX seconds longer
    if (p.jumping) {
      if (p.jumpT >= 0.5 && p.jumpHeld && p.jumpHang < cfg.JUMP_HANG_MAX) {
        p.jumpHang += dt;                                          // hang at the top
        p.jumpT = 0.5; p.y = cfg.JUMP_HEIGHT;
      } else {
        p.jumpT += dt / cfg.JUMP_TIME;
        if (p.jumpT >= 1) { p.jumpT = 1; p.jumping = false; p.jumpT = 0; p.jumpHang = 0; p.y = 0; }
        else { p.y = cfg.JUMP_HEIGHT * Math.sin(Math.PI * p.jumpT); }
      }
    } else { p.y = 0; }

    // duck timer
    if (p.ducking) {
      p.duckT += dt / cfg.DUCK_TIME;
      if (p.duckT >= 1) { p.ducking = false; p.duckT = 0; }
    }
    // derived hitbox top
    p.topY = (p.ducking ? cfg.PLAYER_DUCK_H : cfg.PLAYER_H) + p.y;
    // baseY (bottom) is p.y when jumping (whole box lifted)

    // buff timers
    if (this.iframe > 0) this.iframe -= dt;
    if (this.hitFlash > 0) this.hitFlash -= dt;
    var b = this.buffs;
    if (b.magnet > 0) b.magnet -= dt;
    if (b.invincible > 0) b.invincible -= dt;
    if (b.coinX2 > 0) b.coinX2 -= dt;
    if (b.slowmo > 0) b.slowmo -= dt;

    // advance + test world objects
    // advance + test world objects. Gates go FIRST: passing a gate pauses (phase=QUESTION), and
    // we bail before obstacle collision so a gate and an obstacle at the same z can't both hit on
    // the same frame (the gate wins; POST_Q_GRACE then covers the now-near obstacle on resume).
    this._advanceGates(adv);
    if (this.phase !== PHASE_RUN) return;          // a gate just triggered — question is up, world is paused
    this._advanceObstacles(adv);
    this._advanceCoins(adv, dt);

    // spawn (distance-driven)
    this._maybeSpawn();
  };

  CCSim.prototype._advanceObstacles = function (adv) {
    var cfg = this.cfg, p = this.player, items = this.obstacles.items, n = items.length, i;
    var invinc = this.buffs.invincible > 0 || this.iframe > 0 || this.boostActive;   // 04 task 8: no damage during boost
    for (i = 0; i < n; i++) {
      var o = items[i]; if (!o.active) continue;
      o.z -= adv;
      if (!o.tested && o.z <= 0) {                  // closest-approach test (once)
        o.tested = true;
        if (!invinc && this._hitsObstacle(o, p)) {
          this.collisions++;
          this._onCrash();
          this.obstacles.release(o);
          continue;
        }
      }
      if (o.z < cfg.CULL_BEHIND) this.obstacles.release(o);
    }
  };

  // AABB clear-rule encoder.
  //   OB_NARROW: a wall sealing one outer lane — x-overlap with that lane => hit at any height (dodge to an open lane).
  //   OB_LOWROCK: x-overlap with its lane AND player base below ROCK_H => hit (jump lifts the base clear).
  //   OB_ARCH:   spans the WHOLE canyon (no x test) — player top above CEIL_BOTTOM => hit (duck lowers the top clear).
  CCSim.prototype._hitsObstacle = function (o, p) {
    var cfg = this.cfg;
    var pLo = p.y;            // player bottom (lifted while jumping)
    var pHi = p.topY;         // player top (lowered while ducking)
    if (o.type === OB_ARCH) return (pHi > cfg.CEIL_BOTTOM);          // full-width: lane-independent (duck)
    if (o.type === OB_NARROW) {
      // (clear-lane fix) clean lane-based wall collision: hit iff the player's CENTRE sits inside the
      // wall's lane. No false-positives once you've crossed into a clear lane, and no pass-through.
      return Math.abs(p.x - o.x) < cfg.LANE_W * 0.5;
    }
    if (o.type === OB_SWEEP) {
      // (v0.56.0) live phase: the beam only hits where it ACTUALLY is right now (lane-dodging
      // past it is real skill); jumping lifts the base clear of the low beam either way.
      return Math.abs(p.x - this._sweepX(o)) < cfg.LANE_W * 0.5 && (pLo < cfg.ROCK_H);
    }
    // OB_LOWROCK — (Jason v0.47.0) full-width low wall: lane-independent (no x test), player base
    // below the wall top => hit; jumping lifts the base clear. Mirrors OB_ARCH's lane-independence.
    return (pLo < cfg.ROCK_H);
  };

  // Test/solvability seam: would a player standing/jumping/ducking in `lane` collide with `o`?
  // action: 'stand' | 'jump' (apex) | 'duck'. Builds a hypothetical player and reuses _hitsObstacle.
  CCSim.prototype._wouldHit = function (o, lane, action) {
    var cfg = this.cfg;
    // (v0.56.0) OB_SWEEP solvability is WORST-CASE phase: the beam can be over ANY lane at
    // crossing time, so only the jump (base above the low beam) is a guaranteed clear.
    // Live gameplay stays phase-honest via _hitsObstacle — this pessimism is only for fairness.
    if (o.type === OB_SWEEP) return action !== 'jump';
    var x = (lane - 1) * cfg.LANE_W;
    var y = 0, topY = cfg.PLAYER_H;
    if (action === 'jump') { y = cfg.JUMP_HEIGHT; topY = y + cfg.PLAYER_H; }
    else if (action === 'duck') { topY = cfg.PLAYER_DUCK_H; }
    return this._hitsObstacle(o, { x: x, y: y, topY: topY });
  };

  // (v0.56.0) OB_SWEEP: the beam's lateral centre is a pure function of its remaining approach
  // distance — deterministic (no wall clock, no dt plumbing), one source of truth for sim + view.
  CCSim.prototype._sweepX = function (o) {
    return Math.sin((o.sweepPhase || 0) + o.z * this.cfg.SWEEP_FREQ) * this.cfg.LANE_W;
  };

  // (v0.73.0, J9) Garage upgrades — persistent, profile-fed, help-only (fairness untouched).
  CCSim.prototype.applyUpgrades = function (u) {
    u = u || {};
    this._up = {
      hull: Math.max(0, Math.min(2, u.hull | 0)),
      boostKm: u.boost ? this.cfg.BOOST_KM * 0.5 : 0,
      magnet: !!u.magnet,
      plating: !!u.plating
    };
    if (this.phase === 'RUN' && this.distance < 1 && !this._resumed) {           // fresh run: apply immediately
      this.shields = this.cfg.SHIELDS_START + this._up.hull;
      this._platingLeft = this._up.plating ? 1 : 0;
    }
  };
  CCSim.prototype._onCrash = function () {
    if (this._platingLeft > 0) {                               // (J9) ablative plating eats the first hit
      this._platingLeft--;
      this.iframe = this.cfg.COLLIDE_IFRAME; this.hitFlash = this.cfg.HIT_FLASH;
      return;
    }
    this.shields -= this.cfg.COLLISION_SHIELD_COST;
    this.iframe = this.cfg.COLLIDE_IFRAME;     // shield-loss grace: blocks chained hits for this window
    this.hitFlash = this.cfg.HIT_FLASH;        // sharp damage flash (view); distinct from the protected glow
    if (this.shields <= 0) { this.shields = 0; this._gameOver(); }
  };

  CCSim.prototype._advanceCoins = function (adv, dt) {
    var cfg = this.cfg, p = this.player, items = this.coins.items, n = items.length, i;
    var magnetR = this.buffs.magnet > 0 ? cfg.MAGNET_RANGE : ((this._up && this._up.magnet) ? cfg.MAGNET_RANGE * 0.4 : 0);   // (J9) passive Garage magnet
    var magnet = magnetR > 0;
    var mult = this.buffs.coinX2 > 0 ? 2 : 1;
    for (i = 0; i < n; i++) {
      var c = items[i]; if (!c.active) continue;
      c.z -= adv;
      if (magnet && !c.collected && c.z > 0 && c.z < magnetR) {
        var dx = p.x - c.x; var step = cfg.MAGNET_PULL * dt;
        if (dx > step) c.x += step; else if (dx < -step) c.x -= step; else c.x = p.x;
        var dy = p.y + 0.5 - c.y; if (dy > step) c.y += step; else if (dy < -step) c.y -= step; else c.y = p.y + 0.5;
      }
      if (!c.tested && c.z <= 0) {
        c.tested = true;
        if (!c.collected &&
            Math.abs(p.x - c.x) < (cfg.PLAYER_HW + 0.5) &&
            (c.y < p.topY + 0.6 && c.y > p.y - 0.6)) {
          c.collected = true;
          this.coinScore += cfg.COIN_VALUE * mult;
          this._emit && this._emit('coin');
          this.coins.release(c);
          continue;
        }
      }
      if (c.z < cfg.CULL_BEHIND) this.coins.release(c);
    }
  };

  CCSim.prototype._advanceGates = function (adv) {
    var cfg = this.cfg, items = this.gates.items, n = items.length, i;
    for (i = 0; i < n; i++) {
      var c = items[i]; if (!c.active) continue;
      c.z -= adv;
      if (!c.tested && c.z <= 0) {                 // reached the gate plane -> unmissable (spans all lanes)
        c.tested = true;
        this._passGate(c);
        this.gates.release(c);
        return;                                     // one question at a time; the pause is now set
      }
      if (c.z < cfg.CULL_BEHIND) this.gates.release(c);
    }
  };

  // ---- gate => pause + question ----
  CCSim.prototype._passGate = function (c) {
    this._gatesPassed++;                                                          // 04 task 8
    if (this._gatesPassed % this.cfg.GATES_PER_BOOST === 0) this._boostPending = true;  // boost every 5 gates (fires on resume)
    var q = null;
    var prov = this.ctx.questions;
    if (prov && typeof prov.next === 'function') {
      var draw = prov.next({
        game: 'CC',
        difficultyBand: this._band(),
        excludeIds: this._askedIds,
        rng: this.rng,
        shuffle: true
      });
      if (draw && draw.question) q = draw.question;
    }
    if (!q) {                       // no bank available -> treat as bonus, no pause
      this.coinScore += this.cfg.COIN_VALUE * 5;
      return;
    }
    if (this._askedIds.indexOf(q.id) === -1) this._askedIds.push(q.id);
    var limitS = 20;
    try {
      if (this.ctx.questions && typeof this.ctx.questions.timerSeconds === 'function') {
        limitS = this.ctx.questions.timerSeconds(q, { extraTime: !!(this.ctx.settings && this.ctx.settings.extraTime) });
      }
    } catch (e) {}
    this.pending = { question: q, power: c.power, kind: c.kind, startedMs: this._nowMs, limitS: limitS, remainS: limitS };
    this.lastResult = null;
    this.phase = PHASE_QUESTION;    // PAUSE
    this._emit && this._emit('gatePassed');
  };

  // Per-frame question countdown (D6). The view loop calls this every frame; it only acts during a
  // question (sim is otherwise frozen — step() isn't called while paused). On expiry the question is
  // auto-resolved as incorrect (time ran out), which moves to EXPLAIN like any answer.
  CCSim.prototype.tickQuestion = function (dt) {
    if (this.phase !== PHASE_QUESTION || !this.pending) return;
    this.pending.remainS -= dt;
    if (this.pending.remainS <= 0) { this.pending.remainS = 0; this.answer(null, { timedOut: true }); }
  };

  CCSim.prototype._band = function () {
    if (this.distance < 1500) return [1, 2];
    if (this.distance < 6000) return [1, 3];
    return [2, 3];
  };

  // Grade an answer: `chosen` is a number (single) or an array of indices (multi).
  // Multi is correct iff the selected set equals the correctIndices set.
  function gradeAnswer(q, chosen) {
    if (q && Array.isArray(q.correctIndices) && q.correctIndices.length) {
      if (!Array.isArray(chosen) || chosen.length !== q.correctIndices.length) return false;
      for (var i = 0; i < q.correctIndices.length; i++) if (chosen.indexOf(q.correctIndices[i]) < 0) return false;
      return true;
    }
    return chosen === (q ? q.correctIndex : -1);
  }
  // ---- answer (called by overlay or harness) ----
  CCSim.prototype.answer = function (chosen, opts) {
    if (this.phase !== PHASE_QUESTION || !this.pending) return null;
    var q = this.pending.question;
    var timedOut = !!(opts && opts.timedOut);
    var correct = !timedOut && gradeAnswer(q, chosen);
    var cfg = this.cfg;
    var delta = 0;

    if (correct) {
      if (this.shields < cfg.SHIELDS_MAX) { this.shields++; delta = 1; }
    } else {
      this.shields -= 2; delta = -2;            // 04 task 4: a wrong gate answer costs 2 shields
    }

    // unique-per-run tracking
    var rec = this._answered[q.id] || (this._answered[q.id] = { c: false, i: false });
    if (correct && !rec.c) { rec.c = true; this.runStats.uniqueCorrect++; }
    if (!correct && !rec.i) { rec.i = true; this.runStats.uniqueIncorrect++; }
    this.runStats.answered++;

    // route through shared providers
    var ms = Math.round(this._nowMs - this.pending.startedMs);
    if (this.ctx.mastery && typeof this.ctx.mastery.record === 'function') {
      this.ctx.mastery.record(q.id, correct, { game: 'CC' });
    }
    if (this.ctx.telemetry && typeof this.ctx.telemetry.emit === 'function') {
      this.ctx.telemetry.emit({ t: 'question_answered', game: 'CC', id: q.id, correct: correct, ms: ms, difficulty: q.difficulty });
    }

    // power gate: grant a buff (regardless of correctness)
    if (this.pending.power) this._grantBuff(this.pending.kind);

    this.lastResult = { correct: correct, question: q, chosen: chosen, shieldDelta: delta, timedOut: timedOut };
    this.pending = null;

    if (this.shields <= 0) { this.shields = 0; this._gameOver(); }
    else { this.phase = PHASE_EXPLAIN; }    // STAY PAUSED through the explanation; resume only on Continue
    return this.lastResult;
  };

  // Called by the Continue button after the explanation. Resumes the world and grants the
  // post-question invulnerability window (ship glows) so a just-spawned obstacle can't insta-hit.
  CCSim.prototype.resumeAfterQuestion = function () {
    if (this.phase !== PHASE_EXPLAIN) return;
    this.phase = PHASE_RUN;
    if (this.iframe < this.cfg.POST_Q_GRACE) this.iframe = this.cfg.POST_Q_GRACE;
    if (this._boostPending) { this._boostPending = false; this._activateBoost(); }   // 04 task 8: every-5-gates boost fires here
  };

  // 04 task 8: blast forward — invulnerable, canyon fast-forwards, scored distance covers BOOST_KM over ~BOOST_TIME.
  CCSim.prototype._activateBoost = function () {
    this.boostActive = true;
    // (v0.104.0, C4) boost is autopilot: a pending corner warning is flown for you
    if (this.turnPending) { this.turnPending = null; this._nextTurnScore += this.cfg.TURN_KM * 1000; this._emit && this._emit('turnauto'); }
    // (v0.103.0, C7, Jason) the ship auto-centers and steering locks for the ride
    this.player.lane = 1; this._retarget();
    this._boostCalmUntil = 0;                        // set when the boost ENDS (+5s of clear road)
    this._boostTargetScore = this.scoreDistance + (this.cfg.BOOST_KM + (this._up ? this._up.boostKm : 0)) * 1000;   // (J9) overcharged boost
    this._emit && this._emit('boost');
    if (this.ctx.telemetry && typeof this.ctx.telemetry.emit === 'function') {
      this.ctx.telemetry.emit({ t: 'powerup', game: 'CC', kind: 'boost' });
    }
  };

  CCSim.prototype._grantBuff = function (kind) {
    var cfg = this.cfg, b = this.buffs;
    if (kind === BUFF_SHIELDPLUS) { if (this.shields < cfg.SHIELDS_MAX) this.shields++; }
    else if (kind === BUFF_MAGNET) b.magnet = cfg.BUFF_MAGNET;
    else if (kind === BUFF_INVINCIBLE) b.invincible = cfg.BUFF_INVINCIBLE;
    else if (kind === BUFF_COINX2) b.coinX2 = cfg.BUFF_COINX2;
    else if (kind === BUFF_SLOWMO) b.slowmo = cfg.BUFF_SLOWMO;
    if (this.ctx.telemetry && typeof this.ctx.telemetry.emit === 'function') {
      this.ctx.telemetry.emit({ t: 'powerup', game: 'CC', kind: kind });
    }
    this._emit && this._emit('powerup');
  };

  CCSim.prototype._gameOver = function () {
    this.phase = PHASE_OVER;
    this.runStats.points = this.score();
    this.runStats.distance = Math.floor(this.distance);
    if (this.ctx.telemetry && typeof this.ctx.telemetry.emit === 'function') {
      this.ctx.telemetry.emit({ t: 'run_ended', game: 'CC', result: 'loss', score: this.runStats.points });
    }
    this._emit && this._emit('gameover');
  };

  CCSim.prototype.score = function () {
    return Math.floor(this.scoreDistance);   // 04 task 7: score IS distance travelled (metres; the HUD renders it as km)
  };

  /* ----------------------------- SPAWNER --------------------------------
   * Distance-driven. Solvability rule: a row has >=1 lane WITHOUT a lane-block.
   * Spacing >= MIN_GAP (>= MAX_SPEED*JUMP_TIME) guarantees consecutive discrete
   * actions never temporally overlap. Cores never share a lane with an obstacle. */
  CCSim.prototype._maybeSpawn = function () {
    var cfg = this.cfg;

    // gates first (04 task 7): one lands every GATE_KM of scored distance, spawned at the draw distance ahead.
    // Each records a keep-clear zone + sweeps nearby obstacles so rows in this pass steer clear (04 task 6).
    while (!this.boostActive && this.scoreDistance >= this._nextGateScore) {
      this._spawnGate(cfg.DRAW_DIST);
      this._gatesSpawned++;
      this._nextGateScore += cfg.GATE_KM * 1000;
    }
    // obstacle rows — skip any that would land inside a gate's keep-clear window
    var calm = this.boostActive || this.distance < this._boostCalmUntil;   // (v0.103.0, C7)
    while (this.distance + cfg.DRAW_DIST >= this._nextRowAt) {
      // (v0.102.0, C9) periodic squeeze: pick a side, hold it for 1-2 km, rest 1.5-2.5 km.
      // Same side for the WHOLE stretch — consistent open lanes stay fair at MIN_GAP.
      if (this._nextRowAt >= this._nextSqueezeAt && this._nextRowAt >= this._squeezeUntil) {
        this._squeezeSide = this.rng.next() < 0.5 ? SIDE_LEFT : SIDE_RIGHT;
        this._squeezeUntil = this._nextRowAt + 1000 + this.rng.next() * 1000;
        this._nextSqueezeAt = this._squeezeUntil + 1500 + this.rng.next() * 1000;
      }
      if (!this._nearGateZone(this._nextRowAt)) {
        // (C7) Boost Mode + 5s after: nothing but occasional SIDE walls (never the center lane)
        if (calm) { if (this.rng.next() < 0.4) this._spawnNarrow(this.rng.next() < 0.5 ? SIDE_LEFT : SIDE_RIGHT, this._nextRowAt - this.distance); }
        else this._spawnRow(this._nextRowAt - this.distance);
      }
      var gap = cfg.BASE_GAP - (this.speed - cfg.BASE_SPEED) * cfg.GAP_K;
      if (gap < cfg.MIN_GAP) gap = cfg.MIN_GAP; else if (gap > cfg.BASE_GAP) gap = cfg.BASE_GAP;
      this._nextRowAt += gap;
    }
    // (v0.73.0, J9) energy CELLS — the v0.28 coin pipeline revived as the Garage currency.
    // Lines spawn between rows, never inside a gate's keep-clear zone; collecting feeds
    // coinScore, banked into profile.ccCells at run end.
    // (v0.102.0, C6) coins trail the ROW horizon by a full line-length: every obstacle a
    // line could overlap is already live, so _coinFix sees the whole truth when routing.
    while (this.distance + cfg.DRAW_DIST - 20 >= this._nextCoinAt) {
      if (!this._nearGateZone(this._nextCoinAt) && !calm) this._spawnCoinLine(this._nextCoinAt - this.distance);
      this._nextCoinAt += cfg.BASE_GAP * (0.9 + this.rng.next() * 0.6);
    }
  };

  /* Spawn one solvable obstacle row at `zAhead`. Every pattern leaves a single-action-clear
   * path; `_rowOpenLane` records a guaranteed-clear lane. */
  CCSim.prototype._spawnRow = function (zAhead) {
    var rng = this.rng, r = rng.next();
    // (v0.102.0, C9) inside a squeeze stretch: the wall holds ONE side the whole time —
    // no new wall obstacles, no ducks; only the persistent side wall, sometimes + a jump.
    if (this.distance + zAhead < this._squeezeUntil) {
      this._spawnNarrow(this._squeezeSide, zAhead);
      if (r < 0.35) this._spawnLowRock(1, zAhead);              // jump obstacles allowed, NO ducking
      this._rowOpenLane = (this._squeezeSide === SIDE_LEFT) ? 2 : 0;
      return;
    }
    if (r < 0.10) {                                  // (v0.56.0) sweeper: a low beam panning the canyon — jump it (or slip past where it isn't)
      this._spawnSweep(zAhead);
      this._rowOpenLane = 1;                         // jump clears from anywhere (worst case); coins stay centre
      return;
    }
    r = (r - 0.10) / 0.90;                           // renormalize: the original pattern mix keeps its relative proportions
    if (r < 0.26) {                                  // narrowing: seal one outer lane (3 -> 2)
      var side = rng.next() < 0.5 ? SIDE_LEFT : SIDE_RIGHT;
      this._spawnNarrow(side, zAhead);
      this._rowOpenLane = (side === SIDE_LEFT) ? 2 : 0;   // far open lane (center also open)
    } else if (r < 0.46) {                           // (Jason v0.47.0) full-width low wall: JUMP it (no lane escapes)
      this._spawnLowRock(rng.int(3), zAhead);
      this._rowOpenLane = 1;                         // coins center — every lane clears the same way (jump)
    } else if (r < 0.64) {                           // full-width arch: duck (every lane clears by ducking)
      this._spawnArch(zAhead);
      this._rowOpenLane = 1;
    } else if (r < 0.74) {                           // pinch: both canyon walls close in (3 -> 1), only the CENTER clears
      this._spawnPinch(zAhead);
      this._rowOpenLane = 1;                         // center is reachable from any lane in one move -> always fair
    } else if (r < 0.86) {                           // wall-extend (04 task 5): one wall pushes in TWO lanes; only the FAR lane clears
      var wside = rng.next() < 0.5 ? SIDE_LEFT : SIDE_RIGHT;
      this._spawnWallExtend(wside, zAhead);
      this._rowOpenLane = (wside === SIDE_LEFT) ? 2 : 0;   // far-right open if left wall extends, else far-left
    } else {                                         // combo (Jason v0.47.0): narrowing + the full-width jump wall —
      var side2 = rng.next() < 0.5 ? SIDE_LEFT : SIDE_RIGHT;   // move OFF the sealed lane AND time a jump
      this._spawnNarrow(side2, zAhead);
      this._spawnLowRock(1, zAhead);
      this._rowOpenLane = (side2 === SIDE_LEFT) ? 2 : 0;       // coins on the far open lane (cleared by jumping there)
    }
  };

  // Pinch = a narrowing wall from BOTH sides at the same row (lanes 0 and 2 sealed), leaving only the
  // center lane. Reuses two OB_NARROW so collision + rendering are unchanged; reads as the chasm
  // squeezing down to a single passage. Center-open keeps it ≤1 lane move from anywhere (fair).
  CCSim.prototype._spawnPinch = function (zAhead) {
    this._placeObstacle(OB_NARROW, 0, SIDE_LEFT, zAhead);
    this._placeObstacle(OB_NARROW, 2, SIDE_RIGHT, zAhead);
  };

  // Wall-extend (04 task 5): one canyon wall pushes inward by TWO lanes, sealing the outer + the
  // center lane and leaving ONLY the far opposite lane open. Reuses OB_NARROW (collision/render
  // unchanged). Fair: two quick lane taps cross all three lanes in ~one tween (_retarget continues
  // from the current x), so the far lane is reachable within the approach window.
  CCSim.prototype._spawnWallExtend = function (side, zAhead) {
    var outer, inner;
    if (side === SIDE_RIGHT) {                       // seal lanes 2 + 1 -> only lane 0 (far left) open
      outer = this._placeObstacle(OB_NARROW, 2, SIDE_RIGHT, zAhead);
      inner = this._placeObstacle(OB_NARROW, 1, SIDE_RIGHT, zAhead);
    } else {                                         // seal lanes 0 + 1 -> only lane 2 (far right) open
      outer = this._placeObstacle(OB_NARROW, 0, SIDE_LEFT, zAhead);
      inner = this._placeObstacle(OB_NARROW, 1, SIDE_LEFT, zAhead);
    }
    // Render fix (Jason): the bulge geometry is baked at the canyon wall, so a centre-lane NARROW would
    // draw back at the outer wall and leave the sealed centre lane LOOKING open. Instead the outer wall
    // draws a DEEP 2-lane bulge that visibly fills both sealed lanes, and the centre NARROW is collision-only.
    if (outer) outer.span = 2;
    if (inner) inner.span = 0;
  };

  CCSim.prototype._spawnNarrow = function (side, zAhead) {
    this._placeObstacle(OB_NARROW, side === SIDE_LEFT ? 0 : 2, side, zAhead);
  };
  CCSim.prototype._spawnLowRock = function (lane, zAhead) { this._placeObstacle(OB_LOWROCK, lane, 0, zAhead); }; // lane retained for call-compat; the wall is full-width (lane-independent)
  CCSim.prototype._spawnSweep = function (zAhead) {   // (v0.56.0) phase from the run rng -> deterministic per seed
    var o = this._placeObstacle(OB_SWEEP, 1, 0, zAhead);
    if (o) o.sweepPhase = this.rng.next() * Math.PI * 2;
    return o;
  };
  CCSim.prototype._spawnArch = function (zAhead) { this._placeObstacle(OB_ARCH, 1, 0, zAhead); }; // lane irrelevant (full-width)

  CCSim.prototype._placeObstacle = function (type, lane, side, zAhead) {
    var o = this.obstacles.acquire();
    if (!o) return null;                             // sized to never happen; harness asserts pooling
    o.type = type; o.lane = lane; o.side = side; o.span = 1;   // span = render width in lanes (2 = wall-extend deep bulge; 0 = collision-only)
    o.x = (lane - 1) * this.cfg.LANE_W; o.z = zAhead; o.tested = false; o.sweepPhase = 0;
    return o;
  };

  // (v0.102.0, C6, Jason) coins never clip obstacles: the line SNAKES into open lanes at
  // sealed rows, hops over jump walls, stays low near arches, and skips the sweeper's z
  // (its beam pans every lane). Reads only existing obstacle state — zero extra rng draws,
  // so downstream spawn sequences are untouched.
  CCSim.prototype._coinFix = function (lane, z) {
    var cfg = this.cfg, items = this.obstacles.items, n = items.length;
    var outLane = lane, hop = false, low = false, skip = false, i, o, dz;
    for (i = 0; i < n; i++) {
      o = items[i]; if (!o.active) continue;
      dz = Math.abs(o.z - z); if (dz >= 2.4) continue;
      if (o.type === OB_SWEEP) { if (dz < 1.4) skip = true; }
      else if (o.type === OB_LOWROCK) { hop = true; }
      else if (o.type === OB_ARCH) { low = true; }
    }
    // sealed-lane check via the SAME truth the collision uses
    var probe = { x: 0, y: 0, topY: cfg.PLAYER_H }, tryLanes = [outLane, 1, 0, 2], t;
    for (t = 0; t < tryLanes.length; t++) {
      var L = tryLanes[t], sealed = false;
      probe.x = (L - 1) * cfg.LANE_W;
      for (i = 0; i < n; i++) {
        o = items[i]; if (!o.active || o.type !== OB_NARROW) continue;
        if (Math.abs(o.z - z) >= 2.4) continue;
        if (this._hitsObstacle(o, probe)) { sealed = true; break; }
      }
      if (!sealed) { outLane = L; break; }
    }
    return { lane: outLane, hop: hop, low: low, skip: skip };
  };
  CCSim.prototype._spawnCoinLine = function (zAhead) {
    var cfg = this.cfg, rng = this.rng;
    if (rng.next() > cfg.COIN_LINE_CHANCE) return;
    var lane = rng.int(3);
    var count = cfg.COIN_RUN_MIN + rng.int(cfg.COIN_RUN_MAX - cfg.COIN_RUN_MIN + 1);
    var arc = rng.next() < 0.3;                  // some lines arc up (collect by jumping)
    for (var i = 0; i < count; i++) {
      var cz = zAhead + i * cfg.COIN_SPACING;
      var fix = this._coinFix(lane, cz);
      lane = fix.lane;                           // the line follows the dodge — a visible guide path
      if (fix.skip) continue;
      var c = this.coins.acquire();
      if (!c) return;
      var baseY = arc && !fix.low ? 0.6 + cfg.JUMP_HEIGHT * Math.sin(Math.PI * (i + 1) / (count + 1)) * 0.5 : 0.6;
      if (fix.hop && !fix.low) baseY = Math.max(baseY, 0.6 + cfg.JUMP_HEIGHT * 0.55);
      c.lane = lane; c.x = (lane - 1) * cfg.LANE_W; c.z = cz;
      c.y = baseY;
      c.tested = false; c.collected = false;
    }
  };

  CCSim.prototype._spawnGate = function (zAhead) {
    var rng = this.rng, cfg = this.cfg;
    var c = this.gates.acquire();
    if (!c) return;
    // a gate spans the whole chasm — you can't miss it, so no lane choice / obstacle avoidance
    c.lane = 1; c.x = 0; c.z = zAhead; c.tested = false;
    c.power = rng.next() < cfg.POWER_GATE_CHANCE;   // ~10% grant a buff on answer
    c.kind = c.power ? POWER_KINDS[rng.int(POWER_KINDS.length)] : '';
    // fairness: a gate must never sit on an obstacle. Record its keep-clear zone (absolute distance) and
    // sweep any obstacle already within the window; rows spawned later avoid it via _nearGateZone.
    var zones = this._gateZones, w = 0;
    for (var k = 0; k < zones.length; k++) { if (zones[k] > this.distance - 4) zones[w++] = zones[k]; } // prune passed gates
    zones.length = w;
    zones.push(this.distance + zAhead);
    this._clearObstaclesNear(zAhead, cfg.GATE_CLEAR);
  };

  // true if absolute distance `absZ` is within GATE_CLEAR of any live gate
  CCSim.prototype._nearGateZone = function (absZ) {
    var zones = this._gateZones, w = this.cfg.GATE_CLEAR, k;
    for (k = 0; k < zones.length; k++) { if (Math.abs(zones[k] - absZ) < w) return true; }
    return false;
  };

  // release every active obstacle whose (relative) z is within `zWin` of `zRel` — a gate spans all lanes
  CCSim.prototype._clearObstaclesNear = function (zRel, zWin) {
    var items = this.obstacles.items, n = items.length, i;
    for (i = 0; i < n; i++) { var o = items[i]; if (o.active && Math.abs(o.z - zRel) < zWin) this.obstacles.release(o); }
  };

  CCSim.prototype._obstacleNear = function (lane, z, zWin) {
    var items = this.obstacles.items, n = items.length;
    for (var i = 0; i < n; i++) {
      var o = items[i];
      if (o.active && o.lane === lane && Math.abs(o.z - z) < zWin) return true;
    }
    return false;
  };

  // optional sfx hook the module can set: sim._emit = function(name){...}
  CCSim.prototype._emit = null;

  // diagnostics for the harness
  CCSim.prototype.poolReport = function () {
    var r = {}, names = ['obstacles', 'coins', 'gates'], i;
    for (i = 0; i < names.length; i++) {
      var p = this[names[i]];
      r[names[i]] = { cap: p.capacity, live: p.live, factoryCalls: p.factoryCalls,
        acquiredEver: p.acquiredEver, releasedEver: p.releasedEver, exhaustions: p.exhaustions,
        balance: p.acquiredEver - p.releasedEver };
    }
    return r;
  };

  /* ============================== CCView ====================================
   * Three.js renderer. Only file section that touches THREE. Pooled/instanced
   * meshes; reads sim each frame; zero per-frame allocation (scratch reused). */
  function CCView(THREE, sim, canvas, opts) {
    this.THREE = THREE; this.sim = sim; this.canvas = canvas;
    opts = opts || {};
    this.reducedMotion = !!opts.reducedMotion;
    // (v0.57.0 unit 7) mastery cosmetic: shell-resolved trail hex ("#RRGGBB") or null = stock gold plume
    this.shipTrailColor = (typeof opts.shipTrailColor === "string" && /^#[0-9a-fA-F]{6}$/.test(opts.shipTrailColor)) ? opts.shipTrailColor : null;
    // Own RNG for purely-visual randomness (dust, sparks). Forked, so it NEVER consumes the
    // sim's stream — spawns/solvability stay deterministic and harness-reproducible.
    this.vrng = (sim.rng && typeof sim.rng.fork === 'function') ? sim.rng.fork('ccview') : makeFallbackRng(0xC0FFEE);
    var cfg = sim.cfg;

    this._disposables = [];
    this._track = function (x) { this._disposables.push(x); return x; };

    // (v0.43.0 feel pass) motion-continuity state: camera lateral follow + counter-roll,
    // velocity-driven ship bank, eased duck, landing squash/dip. All view-only.
    this._camFX = 0;        // camera x, easing toward a fraction of the player's x
    this._camPX = 0; this._camLatV = 0;   // player-x history + smoothed lateral velocity (camera roll)
    this._shipPX = 0; this._bank = 0; this._rollT = 0; this._rollDir = 1; this._turnKickT = 0; this._turnKickDir = 1; this._turnSeen = undefined;   // (v0.104.0, C10/C4)     // ship bank from smoothed lateral velocity
    this._duckF = 0;                      // eased 0..1 duck factor
    this._wasJump = false; this._landT = 0; this._landDip = 0;   // landing squash + camera dip

    var renderer = this.renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1, 2));
    if (THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.setClearColor(0x1a1326, 1);
    if (renderer.shadowMap) { renderer.shadowMap.enabled = true; if (THREE.PCFSoftShadowMap) renderer.shadowMap.type = THREE.PCFSoftShadowMap; }   // (Jason) shadows — depth cue so overhead arches read differently from ground rocks (guarded: headless mock renderer has no shadowMap)

    var A = this._A = (typeof window !== 'undefined' && window.STARNIX_ASSETS) || {};

    var scene = this.scene = new THREE.Scene();
    var FOG = 0xB9885E;                                            // warm dusk haze (matches sky horizon)
    scene.fog = new THREE.Fog(FOG, cfg.DRAW_DIST * 0.34, cfg.DRAW_DIST * 0.95); // (04 task 5) tuned: hold near detail, fade the far chasm into haze
    if (A.ccSky) {
      var sky = new THREE.TextureLoader().load(A.ccSky);
      if (THREE.sRGBEncoding) sky.encoding = THREE.sRGBEncoding;
      this._disposables.push(sky); scene.background = sky;
    } else { scene.background = new THREE.Color(0x241a30); }

    var camera = this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, cfg.DRAW_DIST * 1.2);
    camera.position.set(CAM.chasePos[0], CAM.chasePos[1], CAM.chasePos[2]);
    camera.lookAt(CAM.chaseLook[0], CAM.chaseLook[1], CAM.chaseLook[2]);

    // dusk lighting: warm low sun + sky/ground hemisphere + dim ambient + faint neon fill
    scene.add(new THREE.HemisphereLight(0xE9A06A, 0x2a1c2e, 0.95));
    var sun = new THREE.DirectionalLight(0xFFCDA0, 1.05); sun.position.set(-6, 7, 4); scene.add(sun);
    sun.castShadow = true;
    if (sun.shadow && sun.shadow.camera) { sun.shadow.mapSize.set(1024, 1024); sun.shadow.bias = -0.0005; var _sc = sun.shadow.camera; _sc.left = -22; _sc.right = 22; _sc.top = 22; _sc.bottom = -22; _sc.near = 0.5; _sc.far = 60; _sc.updateProjectionMatrix(); }   // (Jason) sun is the shadow caster; frustum covers the foreground canyon (map size / bias / frustum tunable)
    scene.add(new THREE.AmbientLight(0x3a2a40, 0.5));
    var fill = new THREE.PointLight(0x1FDDE9, 0.35, 60); fill.position.set(0, 3, 6); scene.add(fill);

    // materials (shared)
    var M = this.M = {
      iris: this._mat(0x7855FA, 0x4a2ec8),
      aqua: this._mat(0x1FDDE9, 0x0c8f99),
      mantis: this._mat(0x92DD23, 0x4f7a10),
      peach: this._mat(0xFF6B5B, 0xa32f24),
      gold: this._mat(0xFFC857, 0xa8801f),
      rock: this._rockMat(2.2, 1.6)                               // obstacle low-rocks: textured chunk
    };

    // --- floor (sandstone, kept clearly DARKER than the walls; scrolls toward camera) ---
    var floorG = this._track(new THREE.PlaneGeometry(cfg.LANE_W * 3 + 6, cfg.DRAW_DIST * 1.3));
    var floorMat = this._groundMat(3, 18);                        // (04 task 3) dedicated dark-floor material
    this.texFloor = floorMat.map; this.texFloorN = floorMat.normalMap || null; // animated: offset.y
    this._mirrorScroll(floorMat, "t");                            // seamless loop along the track
    var floor = new THREE.Mesh(floorG, floorMat);
    floor.rotation.x = -Math.PI / 2; floor.position.set(0, -0.02, -cfg.DRAW_DIST * 0.45);
    floor.receiveShadow = true;                                  // (Jason) the floor catches obstacle shadows
    scene.add(floor);

    this._buildWalls(cfg);
    this._buildSurface(cfg);     // planet ground flanking the chasm (the "not a rectangle" fix)
    this._buildPeaks(cfg);       // distant mountains on the rim surface (intro/overhead scenery — Jason)
    this._buildLightShafts(cfg); // (04 task 5) faint god-ray planes from the rim
    // this._buildLaneLines(cfg);   // (Jason) blue lane indicators removed

    // --- instanced pools (one InstancedMesh per visual kind) ---
    this.scratchM = new THREE.Matrix4();
    this.scratchQ = new THREE.Quaternion();
    this.scratchP = new THREE.Vector3();
    this.scratchS = new THREE.Vector3();
    this._hide = new THREE.Matrix4().makeScale(0.0001, 0.0001, 0.0001);

    // OB_NARROW now renders as a craggy promontory bulging inward FROM the wall (04 task 1),
    // one instanced mesh per wall (geometry baked at that wall's world x/y; instances translate in z only).
    this.iNarrowL = this._instanced(this._bulgeGeo(SIDE_LEFT, cfg), M.rock, cfg.POOL_OBSTACLES);
    this.iNarrowR = this._instanced(this._bulgeGeo(SIDE_RIGHT, cfg), M.rock, cfg.POOL_OBSTACLES);
    this.iNarrowDeepL = this._instanced(this._bulgeGeo(SIDE_LEFT, cfg, 2), M.rock, cfg.POOL_OBSTACLES);   // wall-extend: deep 2-lane bulge
    this.iNarrowDeepR = this._instanced(this._bulgeGeo(SIDE_RIGHT, cfg, 2), M.rock, cfg.POOL_OBSTACLES);
    var _archHalf = cfg.LANE_W * 1.5 + 2.6;                       // canyon wall-centre |x| (matches _buildWalls)
    var _archW = 2 * (_archHalf - 0.4);                           // (Jason) span the whole canyon and embed ~0.8 into each wall -> reads CONNECTED to the walls, not floating
    // (Jason v0.47.0) the jump obstacle is the arch's MIRROR: the same wall-to-wall slab, the SAME
    // rock material/texture (M.rock) — solid at the bottom (jump over) vs the arch's bottom gap (duck under).
    this.iRock = this._instanced(this._track(new THREE.BoxGeometry(_archW, cfg.ROCK_H, cfg.OBST_DEPTH * 2.2)), M.rock, cfg.POOL_OBSTACLES);
    this.iArch = this._instanced(this._track(new THREE.BoxGeometry(_archW, cfg.ARCH_H, cfg.OBST_DEPTH * 2.2)), M.rock, cfg.POOL_OBSTACLES);      // full-width overhead lintel, wall-to-wall — duck under
    // (Jason v0.47.0) action telegraphs, colorblind-safe by SHAPE + color: gold UP-chevrons over the
    // jump wall, aqua DOWN-chevrons hanging in the arch's duck gap. 3 per obstacle (one per lane), bobbing.
    var chevGeo = new THREE.ConeGeometry(0.34, 0.55, 4); if (chevGeo.scale) chevGeo.scale(1, 1, 0.4);
    var chevDownGeo = new THREE.ConeGeometry(0.34, 0.55, 4); if (chevDownGeo.rotateX) chevDownGeo.rotateX(Math.PI); if (chevDownGeo.scale) chevDownGeo.scale(1, 1, 0.4);
    var chevUpMat = new THREE.MeshBasicMaterial({ color: 0xFFC857, transparent: true, opacity: 0.95 });
    var chevDnMat = new THREE.MeshBasicMaterial({ color: 0x1FDDE9, transparent: true, opacity: 0.95 });
    if (THREE.AdditiveBlending !== undefined) { chevUpMat.blending = THREE.AdditiveBlending; chevDnMat.blending = THREE.AdditiveBlending; }
    this._disposables.push(chevUpMat); this._disposables.push(chevDnMat);
    this.iChevUp = this._instanced(this._track(chevGeo), chevUpMat, cfg.POOL_OBSTACLES * 3);
    this.iChevDown = this._instanced(this._track(chevDownGeo), chevDnMat, cfg.POOL_OBSTACLES * 3);
    // (v0.101.0, C1, Jason) shafts turn the bare cones into REAL arrows (head + stem)
    var shaftGeo = new THREE.BoxGeometry(0.12, 0.34, 0.12);
    this.iChevUpShaft = this._instanced(this._track(shaftGeo), chevUpMat, cfg.POOL_OBSTACLES * 3);
    this.iChevDownShaft = this._instanced(this._track(shaftGeo), chevDnMat, cfg.POOL_OBSTACLES * 3);
    // (v0.56.0) OB_SWEEP: a lane-wide low energy beam that pans the canyon — PEACH (danger per
    // 07 §1), additive so it reads as energy, not rock. Telegraph = peach SIDEWAYS arrows
    // (horizontal cone ≠ the up/down jump/duck cones — colorblind-safe by shape + color).
    var sweepMat = new THREE.MeshBasicMaterial({ color: 0xFF6B5B, transparent: true, opacity: 0.85 });
    var chevSideGeo = new THREE.ConeGeometry(0.34, 0.55, 4);
    if (chevSideGeo.rotateZ) chevSideGeo.rotateZ(-Math.PI / 2);        // tip points +x -> a horizontal arrow
    if (chevSideGeo.scale) chevSideGeo.scale(1, 1, 0.4);
    var chevSideMat = new THREE.MeshBasicMaterial({ color: 0xFF6B5B, transparent: true, opacity: 0.95 });
    if (THREE.AdditiveBlending !== undefined) { sweepMat.blending = THREE.AdditiveBlending; chevSideMat.blending = THREE.AdditiveBlending; }
    this._disposables.push(sweepMat); this._disposables.push(chevSideMat);
    this.iSweep = this._instanced(this._track(new THREE.BoxGeometry(cfg.LANE_W, cfg.ROCK_H, 0.5)), sweepMat, cfg.POOL_OBSTACLES);
    this.iChevSide = this._instanced(this._track(chevSideGeo), chevSideMat, cfg.POOL_OBSTACLES * 3);
    // (v0.101.0, C2, Jason: "no idea what that thing is") the beam now has an EMITTER — a
    // peach scanner drone riding its top edge, so it reads as a machine dragging a light-wall.
    this.iSweepHead = this._instanced(this._track(new THREE.OctahedronGeometry(0.42, 0)), chevSideMat, cfg.POOL_OBSTACLES);
    this.iCoin = this._instanced(this._track(new THREE.CylinderGeometry(0.34, 0.34, 0.1, 6)), M.gold, cfg.POOL_COINS);
    var _obs = [this.iNarrowL, this.iNarrowR, this.iNarrowDeepL, this.iNarrowDeepR, this.iRock, this.iArch];   // (Jason) shadows: obstacles cast + catch so height/depth reads at a glance
    for (var _oi = 0; _oi < _obs.length; _oi++) { _obs[_oi].castShadow = true; _obs[_oi].receiveShadow = true; }
    // Gates are neon rings spanning the chasm — the ship flies through every one (the trigger is
    // logical, no physical collision). Regular = aqua; power (grants a buff on answer) = gold.
    // gates: chunky METALLIC SQUARE frames you fly through (Jason) — a 4-segment torus rotated 45° reads as an
    // upright square; dedicated metallic+emissive mats so they look like energized doorways (NOT the coin/tick aqua/gold).
    var gateMat = new THREE.MeshStandardMaterial({ color: 0x0c3036, emissive: 0x1FDDE9, emissiveIntensity: 0.65, roughness: 0.28, metalness: 0.9 });
    var gatePowMat = new THREE.MeshStandardMaterial({ color: 0x33280a, emissive: 0xFFC857, emissiveIntensity: 0.65, roughness: 0.28, metalness: 0.9 });
    this._disposables.push(gateMat); this._disposables.push(gatePowMat);
    this._gateMat = gateMat; this._gatePowMat = gatePowMat;   // kept for the render-loop glow pulse
    // (Jason v0.47.0) futuristic portal: a sleek flat-top HEX ring (slimmer tube, sharper cross-section)
    // with an additive ENERGY FILM shimmering inside it — a stargate, not a rock hoop. Film opacity
    // pulses with the ring glow in the render loop; both instanced (one draw call each).
    var gateGeo = new THREE.TorusGeometry(3.4, 0.30, 4, 6); if (gateGeo.rotateZ) gateGeo.rotateZ(Math.PI / 6);
    var gatePowGeo = new THREE.TorusGeometry(3.6, 0.34, 4, 6); if (gatePowGeo.rotateZ) gatePowGeo.rotateZ(Math.PI / 6);
    this.iGate = this._instanced(this._track(gateGeo), gateMat, cfg.POOL_GATES);
    this.iGatePow = this._instanced(this._track(gatePowGeo), gatePowMat, cfg.POOL_GATES);
    var filmGeo = new THREE.CircleGeometry(3.05, 6); if (filmGeo.rotateZ) filmGeo.rotateZ(Math.PI / 6);
    var filmPowGeo = new THREE.CircleGeometry(3.2, 6); if (filmPowGeo.rotateZ) filmPowGeo.rotateZ(Math.PI / 6);
    var filmMat = new THREE.MeshBasicMaterial({ color: 0x1FDDE9, transparent: true, opacity: 0.14, depthWrite: false });
    var filmPowMat = new THREE.MeshBasicMaterial({ color: 0xFFC857, transparent: true, opacity: 0.14, depthWrite: false });
    if (THREE.AdditiveBlending !== undefined) { filmMat.blending = THREE.AdditiveBlending; filmPowMat.blending = THREE.AdditiveBlending; }
    if (THREE.DoubleSide !== undefined) { filmMat.side = THREE.DoubleSide; filmPowMat.side = THREE.DoubleSide; }
    this._disposables.push(filmMat); this._disposables.push(filmPowMat);
    this._gateFilmMat = filmMat; this._gateFilmPowMat = filmPowMat;   // pulsed with the ring glow
    this.iGateFilm = this._instanced(this._track(filmGeo), filmMat, cfg.POOL_GATES);
    this.iGateFilmPow = this._instanced(this._track(filmPowGeo), filmPowMat, cfg.POOL_GATES);

    // player ship (low-poly neon)
    this.ship = this._buildShip(cfg);
    scene.add(this.ship);
    this._buildSquadron(cfg);    // the BCM ships you're chasing, far ahead in the chasm

    // particle pool (visual only) — instanced sparks
    this.particles = makePool(cfg.POOL_PARTICLES, function () { return { active: false, _i: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1 }; });
    this.iSpark = this._instanced(this._track(new THREE.BoxGeometry(0.12, 0.12, 0.12)), M.gold, cfg.POOL_PARTICLES);

    this._buildSpeedTicks(cfg);  // (04 task 2) streaming edge ticks
    this._buildDust(cfg);        // (04 task 5) drifting/rushing dust

    this._t = 0;
    this.resize();
  }

  CCView.prototype._mat = function (color, emissive) {
    var m = new this.THREE.MeshStandardMaterial({ color: color, emissive: emissive, emissiveIntensity: 0.9, roughness: 0.5, metalness: 0.1 });
    this._disposables.push(m); return m;
  };
  CCView.prototype._tex = function (url, repX, repY, srgb) {
    var THREE = this.THREE;
    var t = new THREE.TextureLoader().load(url);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repX, repY);
    if (srgb && THREE.sRGBEncoding) t.encoding = THREE.sRGBEncoding;
    t.anisotropy = 16;   // max; kills distance shimmer/strobe on the scrolling rock
    this._disposables.push(t);
    return t;
  };
  // textured sandstone material (falls back to solid colour if assets absent).
  // Each call makes its own texture instances so surfaces scroll independently.
  // Walls/obstacle-rock prefer the documented `ccSurface` key (ASSET_PROMPTS: walls use ccSurface),
  // falling back to the older `ccRock` key, then to colour.
  CCView.prototype._rockMat = function (repX, repY) {
    var THREE = this.THREE, A = this._A || {};
    var m = new THREE.MeshStandardMaterial({ color: 0xb07a4e, roughness: 0.96, metalness: 0.02 });
    var src = A.ccSurface || A.ccRock;
    if (src) m.map = this._tex(src, repX, repY, true);
    if (A.ccRockN) { m.normalMap = this._tex(A.ccRockN, repX, repY, false); if (m.normalScale) m.normalScale.set(1.1, 1.1); }
    this._disposables.push(m);
    return m;
  };
  // Chasm FLOOR material (04 task 3 + 6) — kept clearly DARKER than the walls. Prefers the dedicated
  // dark `ccGround` texture; else falls back to the shared sandstone pushed darker by tint; else a dark colour.
  CCView.prototype._groundMat = function (repX, repY) {
    var THREE = this.THREE, A = this._A || {};
    var m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.99, metalness: 0.0 });
    if (A.ccGround) {
      m.map = this._tex(A.ccGround, repX, repY, true);
      if (m.color && m.color.setHex) m.color.setHex(0x7a7a7a);     // darker floor so obstacles stand out (Jason); texture * this tint
    } else if (A.ccRock || A.ccSurface) {
      m.map = this._tex(A.ccRock || A.ccSurface, repX, repY, true);
      if (m.color && m.color.setHex) m.color.setHex(0x4a3320);     // shared sandstone forced well below wall tone (darkened — Jason)
    } else {
      if (m.color && m.color.setHex) m.color.setHex(0x3f2c1b);     // no texture: dark sandstone solid (darkened — Jason)
    }
    if (A.ccGroundN) { m.normalMap = this._tex(A.ccGroundN, repX, repY, false); if (m.normalScale) m.normalScale.set(1, 1); }
    this._disposables.push(m);
    return m;
  };
  // (v0.47.0) _bumpMat removed — the lane-scoped rock it textured became the full-width wall
  // sharing the arch's M.rock; the `ccBumps`/`ccBumpsN` asset keys are RETIRED (see 07 §11).
    CCView.prototype._bulgeGeo = function (side, cfg, lanes) {
    var THREE = this.THREE;
    var half = cfg.LANE_W * 1.5 + 2.6;          // wall centre |x|
    var wallInnerAbs = half - 1.2;              // wall inner face |x| (wall box half-width 1.2)
    var sign = (side === SIDE_LEFT) ? -1 : 1;   // which wall (left at -x, right at +x)
    var Wd = (lanes >= 2) ? (3.8 + cfg.LANE_W) : 3.8;   // 1-lane: just inside the sealed lane. 2-lane (wall-extend) reaches one lane deeper to visibly fill BOTH sealed lanes (Jason: centre lane looked open)
    var H = 8.0, yBottom = -1.2;                // full wall height (floor -> rim); centre y = 2.8
    var Lz = 12.0;                              // promontory length along travel
    var outerWorldX = sign * (wallInnerAbs + 0.6);     // tuck 0.6 into the wall (overlap hides the join)
    var geo = new THREE.BoxGeometry(Wd, H, Lz, 1, 6, 26);
    var localInnerFaceX = -sign * (Wd / 2);     // inner (canyon-facing) face in local coords
    var localOuterFaceX = sign * (Wd / 2);      // outer (wall-side) face in local coords
    this._jagInnerFace(geo, localInnerFaceX, H);       // craggy inner face (matches the walls; tapers at rim)
    // z-hump taper: scale each vertex's inward offset (from the outer/wall plane) by a smooth hump that is
    // 1 across the middle and 0 at the ends -> the cross-section collapses onto the wall at the z-ends.
    if (geo.attributes && geo.attributes.position && geo.attributes.position.array) {
      var a = geo.attributes.position.array, halfLz = Lz / 2, plateau = 0.42, i, x, z, t, bump;
      for (i = 0; i < a.length; i += 3) {
        x = a[i]; z = a[i + 2];
        t = Math.abs(z) / halfLz; if (t > 1) t = 1;
        bump = (t <= plateau) ? 1 : 0.5 * (1 + Math.cos(Math.PI * (t - plateau) / (1 - plateau)));
        a[i] = localOuterFaceX + (x - localOuterFaceX) * bump;
      }
      geo.attributes.position.needsUpdate = true; geo.computeVertexNormals();
    }
    // bake world position (so instances only translate in z). Guarded for the geometry-less THREE stub.
    if (typeof geo.translate === 'function') geo.translate(outerWorldX - sign * (Wd / 2), (yBottom + H / 2), 0);
    return this._track(geo);
  };
  // (04 task 2) Edge speed-ticks: short bright bars at the playfield edges that STREAM toward the camera
  // (real z-motion = the strongest sense of speed) without cluttering the lanes. Pooled/instanced.
  CCView.prototype._buildSpeedTicks = function (cfg) {
    var THREE = this.THREE;
    this._tickN = 22;                              // per side
    this._tickSpacing = 6.5;                       // metres between ticks
    this._tickEdgeX = cfg.LANE_W * 1.5 + 0.15;     // just inside the wall, outside the outer lanes
    var g = this._track(new THREE.BoxGeometry(0.16, 0.05, 1.2));
    this.iTick = this._instanced(g, this.M.aqua, this._tickN * 2);
  };
  // (04 task 5 + task 2) Drifting dust/particulate that also rushes past the camera, doubling as a
  // near-field speed cue. Pooled/instanced; uses the view's own rng (never the sim's).
  CCView.prototype._buildDust = function (cfg) {
    var THREE = this.THREE, rng = this.vrng;
    this._dustN = this.reducedMotion ? 0 : 56;     // reduced-motion: no drifting particulate
    this.iDust = this._instanced(this._track(new THREE.BoxGeometry(0.06, 0.06, 0.06)), this.M.gold, (this._dustN || 1));
    this._dust = new Array(this._dustN);
    this._dustSpanX = cfg.LANE_W * 3.2; this._dustSpanY = 5.5; this._dustSpanZ = cfg.DRAW_DIST;
    for (var i = 0; i < this._dustN; i++) {
      this._dust[i] = {
        x: (rng.next() - 0.5) * this._dustSpanX,
        y: 0.3 + rng.next() * this._dustSpanY,
        z: rng.next() * this._dustSpanZ,           // metres ahead
        dx: (rng.next() - 0.5) * 0.5, dy: (rng.next() - 0.5) * 0.3, ph: rng.next() * 6.28
      };
    }
  };
  // (04 task 5) Subtle light shafts from the sky lip — a couple of faint additive planes angled into the
  // chasm. Static atmosphere; lightweight. NB: crisp volumetric rays would need post-processing (deferred).
  CCView.prototype._buildLightShafts = function (cfg) {
    var THREE = this.THREE;
    if (this.reducedMotion) return;                // reduced-motion: skip the extra glow planes
    var zc = -cfg.DRAW_DIST * 0.45;
    for (var s = -1; s <= 1; s += 2) {
      var m = new THREE.MeshBasicMaterial({ color: 0xFFE6B0, transparent: true });
      if (m.opacity !== undefined) m.opacity = 0.05;
      if (THREE.AdditiveBlending) m.blending = THREE.AdditiveBlending;
      if (m.depthWrite !== undefined) m.depthWrite = false;
      this._disposables.push(m);
      var g = this._track(new THREE.PlaneGeometry(3.4, 16));
      var shaft = new THREE.Mesh(g, m);
      shaft.position.set(s * cfg.LANE_W * 0.7, 4.4, zc - 16);
      shaft.rotation.set(-0.5, s * 0.5, s * 0.22);
      this.scene.add(shaft);
    }
  };
  // Planet-top surface material — its own texture (ccSurface), distinct from the canyon rock so
  // the rim reads as planetary ground rather than more chasm wall. Falls back to ccRock then colour.
  CCView.prototype._surfaceMat = function (repX, repY) {
    var THREE = this.THREE, A = this._A || {};
    var m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.98, metalness: 0.0 });
    var src = A.ccSurface || A.ccRock;
    if (src) m.map = this._tex(src, repX, repY, true);
    this._disposables.push(m);
    return m;
  };
  // Mirror-wrap the scroll axis so the looping texture has no hard seam at the tile boundary.
  CCView.prototype._mirrorScroll = function (mat, axis) {
    var W = this.THREE.MirroredRepeatWrapping, maps = [mat.map, mat.normalMap], i, t;
    for (i = 0; i < maps.length; i++) { t = maps[i]; if (!t) continue; if (axis === "s") t.wrapS = W; else t.wrapT = W; t.needsUpdate = true; }
  };
  CCView.prototype._instanced = function (geo, mat, count) {
    var im = new this.THREE.InstancedMesh(geo, mat, count);
    im.frustumCulled = false;        // we manage visibility via scale-hide
    im.instanceMatrix.setUsage && im.instanceMatrix.setUsage(this.THREE.DynamicDrawUsage);
    this.scene.add(im);
    return im;
  };
  CCView.prototype._buildWalls = function (cfg) {
    var THREE = this.THREE;
    var H = 8;                                                   // canyon walls — lowered from 16 (less slot, more sky)
    var LEN = cfg.DRAW_DIST * 1.3;
    var half = cfg.LANE_W * 1.5 + 2.6;                           // widened a touch for a broader sky strip
    var matL = this._rockMat(18, 2), matR = this._rockMat(18, 2); // larger tiles (was 60x3) -> no strobe
    this.texWallL = matL.map; this.texWallR = matR.map;          // animated: offset.x
    this.texWallLN = matL.normalMap || null; this.texWallRN = matR.normalMap || null;
    this._mirrorScroll(matL, "s"); this._mirrorScroll(matR, "s"); // seamless loop along the track
    // per-wall geometries so each INNER face can be made craggy (canyon widest at the rim, rougher below)
    var gL = this._track(new THREE.BoxGeometry(2.4, H, LEN, 1, 5, 110));
    var gR = this._track(new THREE.BoxGeometry(2.4, H, LEN, 1, 5, 110));
    // (P2·3, PLAYTEST A7) end-cap: a fog-colored plane sealing the corridor just inside the
    // draw distance, so the run fades into haze instead of exposing the backdrop as a bare
    // grey column between the wall ends at the vanishing point. fog:false = it IS the fog.
    var capMat = new THREE.MeshBasicMaterial({ color: 0xB9885E, fog: false });
    this._disposables.push(capMat);
    this._endCap = new THREE.Mesh(this._track(new THREE.PlaneGeometry((half + 2.4) * 2 + 4, H * 2.4)), capMat);
    this._endCap.position.set(0, H * 0.5, -(cfg.DRAW_DIST - 2));
    this.scene.add(this._endCap);
    this._jagInnerFace(gL, 1.2, H);                              // left wall: inner face is +x (toward centre)
    this._jagInnerFace(gR, -1.2, H);                             // right wall: inner face is -x
    var left = new THREE.Mesh(gL, matL); left.position.set(-half, H / 2 - 1.2, -cfg.DRAW_DIST * 0.45);
    var right = new THREE.Mesh(gR, matR); right.position.set(half, H / 2 - 1.2, -cfg.DRAW_DIST * 0.45);
    left.castShadow = left.receiveShadow = true; right.castShadow = right.receiveShadow = true;   // (Jason) walls cast + catch shadows — the lintel reads as joined to them
    this.scene.add(left); this.scene.add(right);
  };
  // Displace only the inner face of a wall box in x, tapering to 0 at the top edge so the rim lip
  // stays flush with the planet surface (no gaps) and the lanes stay clear (max inward < 1.0 unit).
  CCView.prototype._jagInnerFace = function (geo, faceX, H) {
    if (!geo || !geo.attributes || !geo.attributes.position || !geo.attributes.position.array) return;
    var pos = geo.attributes.position, a = pos.array, top = H / 2, inward = faceX > 0 ? -1 : 1, i, x, y, z, taper, n;
    for (i = 0; i < a.length; i += 3) {
      x = a[i]; y = a[i + 1]; z = a[i + 2];
      if (Math.abs(x - faceX) > 0.01) continue;                 // inner face only
      taper = (top - y) / (H * 0.8); if (taper < 0) taper = 0; if (taper > 1) taper = 1;
      if (taper <= 0) continue;                                 // lip vertices untouched -> flush with rim
      n = Math.sin(z * 0.55 + y * 0.9) * 0.55 + Math.sin(z * 0.17 + 1.7) * 0.45 + Math.sin(y * 2.1 + z * 0.07) * 0.22;
      a[i] = x + inward * (n * 0.5 + 0.32) * taper;             // craggy, pushed slightly into the canyon
    }
    pos.needsUpdate = true; geo.computeVertexNormals();
  };
  CCView.prototype._buildLaneLines = function (cfg) {
    var THREE = this.THREE;
    var g = this._track(new THREE.BoxGeometry(0.05, 0.02, cfg.DRAW_DIST * 1.3));
    var m = this.M.aqua;
    for (var l = -1; l <= 1; l += 2) {
      var line = new THREE.Mesh(g, m);
      line.position.set(l * cfg.LANE_W * 0.5, 0.01, -cfg.DRAW_DIST * 0.45);
      this.scene.add(line);
    }
  };
  // Planet surface flanking the chasm. Two large ground planes sit flush with the canyon-wall
  // tops (RIM_Y), starting at the chasm lip and running out toward the horizon — so the canyon
  // reads as a gash cut into a planet's surface, not a free-floating rectangular trench. Fog +
  // the wide intro pose do the rest. The surface scrolls along travel like the floor.
  CCView.prototype._buildSurface = function (cfg) {
    var THREE = this.THREE;
    var lip = cfg.LANE_W * 1.5 + 2.6 - 1.2;       // chasm lip x = wall inner face (half - wallHalfWidth)
    var SPAN = 220, LEN = cfg.DRAW_DIST * 1.6, zc = -cfg.DRAW_DIST * 0.45;
    for (var s = -1; s <= 1; s += 2) {
      var mat = this._surfaceMat(SPAN * 0.16, LEN * 0.16);
      if (mat.color && mat.color.setHex) mat.color.setHex(0xdcdcdc);  // slight dim so the rim sits under the sky, hue intact
      var g = this._track(new THREE.PlaneGeometry(SPAN, LEN));
      var m = new THREE.Mesh(g, mat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(s * (lip + SPAN / 2), RIM_Y, zc);
      this._mirrorScroll(mat, "t");
      if (s < 0) { this.texSurfL = mat.map; this.texSurfLN = mat.normalMap || null; }
      else { this.texSurfR = mat.map; this.texSurfRN = mat.normalMap || null; }
      this.scene.add(m);
    }
  };
  // (intro scenery) Distant mountains on the planet surface flanking the chasm — static far-off terrain
  // sitting near the fog edge, so the high establishing pose reads as a planet's surface with a gash cut
  // through it (Jason: distant chasms/mountains in the overhead view). Held well outside the wall + lanes
  // so they never occlude gameplay; static (the world scrolls via texture) so they read as the far horizon.
  // (Jason v0.47.0) "make the mountains look like mountains": two overlapping ridge rows per side.
  // Near row: fewer, sharper, CRAGGY peaks (per-vertex jitter on the cone, like the wall rock) with a
  // slightly warmer rock tone. Far row: taller, wider, darker silhouettes half-sunk into the fog so
  // the horizon reads as a continuous hazed range instead of isolated traffic cones. Deterministic
  // (position-hashed jitter, no RNG) and static — built once, zero per-frame cost.
  CCView.prototype._buildPeaks = function (cfg) {
    var THREE = this.THREE;
    var grp = this.peaks = new THREE.Group();
    // (P2·2) near row opts OUT of the distance fog so it keeps its true dark rock value —
    // the fog was washing BOTH rows to the same pale tint and erasing the layered read
    // QA-C1 asks for. Far row stays fogged: that wash IS the haze.
    var matNear = new THREE.MeshStandardMaterial({ color: 0x39313f, roughness: 1.0, metalness: 0.0, fog: false });
    var matFar = new THREE.MeshStandardMaterial({ color: 0x241d2c, roughness: 1.0, metalness: 0.0 });
    // (v0.105.0, C5, Jason: "better texture") rock texture on the near ridge when the asset
    // exists — tinted by the same pinned color, so flat-color fallback and pins are unchanged.
    try {
      var Apk = this._A || {};
      if (Apk.ccRock || Apk.ccSurface) {
        matNear.map = this._tex(Apk.ccRock || Apk.ccSurface, 4, 4, true);
        // (v0.118.0) run the rock strata VERTICALLY (down the slopes) instead of wrapping them
        // horizontally around the cone — the horizontal rings read as wood-grain, not rock.
        if (matNear.map.center && matNear.map.center.set) matNear.map.center.set(0.5, 0.5);
        matNear.map.rotation = Math.PI / 2;
        if (matNear.needsUpdate !== undefined) matNear.needsUpdate = true;
        // (v0.117.0, Jason) the FAR ridge was flat "default gray" (color only) beside the textured
        // near ridge — give it the SAME rock map, tinted by its own darker color + still fogged, so
        // the mountains you pass read as one range instead of textured-vs-plastic.
        matFar.map = matNear.map; if (matFar.needsUpdate !== undefined) matFar.needsUpdate = true;
      }
    } catch (ePk) {}
    this._peakMatNear = matNear; this._peakMatFar = matFar;   // (P2·2) pinned by cc-view-smoke
    this._disposables.push(matNear); this._disposables.push(matFar);
    var lip = cfg.LANE_W * 1.5 + 2.6;             // outer wall |x|
    // (v0.61.0 P2·2, PLAYTEST A2) crag rewrite. ROOT CAUSE of the smooth traffic-cones: the
    // cones were built with ONE height segment, so the only vertices were the apex (x=z=0 —
    // radial jitter multiplies zero) and the planted base ring — crag() was a geometric no-op.
    // Cones now carry height segments (rings between base and tip), and those rings get BOTH
    // radial jitter (silhouette breaks) and a height wobble (jagged shoulders). Base ring
    // stays planted; the apex gets a lateral kink so summits stop being perfect spikes.
    var CRAG_AMT = 0.52;                          // radial jitter amplitude (near row; far row runs lower)
    function crag(geo, amt, h) {                  // deterministic; guarded for the headless mock
      var pa = geo.attributes && geo.attributes.position;
      if (!pa || !pa.array) return geo;
      var a = pa.array, half = (h || 2) / 2;
      for (var vi = 0; vi < a.length; vi += 3) {
        var y = a[vi + 1];
        if (y <= -half + 0.01) continue;                                        // keep the base ring planted
        var hsh = Math.sin(a[vi] * 12.9 + y * 78.2 + a[vi + 2] * 37.7) * 43758.5453;
        var n01 = hsh - Math.floor(hsh);
        if (a[vi] === 0 && a[vi + 2] === 0) {                                   // apex: kink it sideways
          a[vi] += (n01 - 0.5) * amt * 3.2; a[vi + 2] += (((n01 * 7.13) % 1) - 0.5) * amt * 3.2;
          continue;
        }
        var j = 1 + amt * (n01 - 0.5) * 2;
        a[vi] *= j; a[vi + 2] *= j;                                             // radial: breaks the cone silhouette
        a[vi + 1] += (((n01 * 3.77) % 1) - 0.5) * amt * half * 0.5;             // height wobble: jagged shoulders
      }
      pa.needsUpdate = true;
      if (geo.computeVertexNormals) geo.computeVertexNormals();
      return geo;
    }
    for (var side = -1; side <= 1; side += 2) {
      // near ridge: 9 sharp craggy peaks, overlapping bases so the ridgeline is continuous
      for (var i = 0; i < 9; i++) {
        var f = i / 8;
        var h = 7 + ((i * 37) % 13);                              // 7..19
        var r = 5.5 + ((i * 23) % 5) + h * 0.16;                  // wider bases under taller peaks
        // (v0.105.0, C5, Jason) near ridge pushed OUT (+9) so no peak ever reads as
        // crossing the chasm from the raised intro camera; heights unchanged.
        var xOff = lip + 26 + f * 58 + ((i * 13) % 6);            // (v0.118.0) inner pushed out -> clear sky over the corridor
        var z = -22 - f * 40 - ((i * 7) % 9);                     // z ~-22..-70
        var g = this._track(crag(new THREE.ConeGeometry(r, h, 9, 5), CRAG_AMT, h));   // (v0.118.0) 9 radial x 5 height -> jaggeder silhouette
        var m = new THREE.Mesh(g, matNear);
        m.position.set(side * xOff, RIM_Y + h / 2 - 0.8, z);
        if (m.rotation) m.rotation.y = i * 1.1;
        if (m.scale) m.scale.set(1 + ((i * 17) % 4) * 0.12, 1, 0.8 + ((i * 11) % 3) * 0.18);   // asymmetric footprints
        m.userData = m.userData || {}; m.userData.par = 0.30; m.userData.z0 = z; m.userData.x0 = side * xOff; m.userData.wrap = 96;   // (v0.105.0, C8) pass-by parallax; x0 = lateral home (v0.118.0)
        grp.add(m);
      }
      // far ridge: 6 tall dark silhouettes sitting in the fog band — the hazed range on the horizon
      for (var k = 0; k < 6; k++) {
        var fk = k / 5;
        var hk = 16 + ((k * 29) % 15);                            // 16..30
        var rk = 11 + ((k * 19) % 7) + hk * 0.2;
        var xk = lip + 24 + fk * 56 + ((k * 31) % 10);            // (v0.118.0) inner pushed OUT hard — the shallow far peaks were capping the chasm opening
        var zk = -62 - fk * 44 - ((k * 5) % 7);                   // z ~-62..-110 (deep in the fog)
        var gk = this._track(crag(new THREE.ConeGeometry(rk, hk, 8, 4), CRAG_AMT * 0.6, hk));   // (v0.118.0) softer far-row crags, more facets
        var mk = new THREE.Mesh(gk, matFar);
        mk.position.set(side * xk, RIM_Y + hk / 2 - 1.2, zk);
        if (mk.rotation) mk.rotation.y = k * 0.9 + 0.4;
        if (mk.scale) mk.scale.set(1.15, 1, 0.75);                // flattened toward the camera = layered backdrop
        mk.userData = mk.userData || {}; mk.userData.par = 0.12; mk.userData.z0 = zk; mk.userData.x0 = side * xk; mk.userData.wrap = 96;   // (C8) far row crawls; x0 = lateral home (v0.118.0)
        grp.add(mk);
      }
    }
    this.scene.add(grp);
  };
  // The fleeing BCM squadron — a loose cluster of small ships far ahead in the chasm, near the
  // fog so they read as distant and uncatchable. Held at a fixed depth (the world scrolls via
  // texture offset, not by moving geometry), bobbing/weaving so the chase feels alive.
  CCView.prototype._buildSquadron = function (cfg) {
    var THREE = this.THREE;
    var grp = this.squadron = new THREE.Group();
    var n = 5, baseZ = cfg.DRAW_DIST * 0.55;       // brought closer so they read clearly (Jason: see distant ships better; was 0.68)
    var cols = [this.M.peach, this.M.iris, this.M.peach, this.M.aqua, this.M.peach];
    this._squad = [];
    for (var i = 0; i < n; i++) {
      var ship = new THREE.Group();                 // ship + its thruster glow move together (render loop is 1:1 with _squad)
      var bodyG = this._track(new THREE.ConeGeometry(0.95, 2.7, 4));   // larger so they read at distance (Jason)
      var mesh = new THREE.Mesh(bodyG, cols[i % cols.length]);
      mesh.rotation.x = Math.PI / 2;                // nose pointing forward (down -z, away from camera)
      ship.add(mesh);
      var thrG = this._track(new THREE.BoxGeometry(0.34, 0.34, 1.35));  // glowing thruster streak behind the nose (enlarged with the body)
      var thr = new THREE.Mesh(thrG, cols[i % cols.length]); thr.position.z = 1.45;
      ship.add(thr);
      var lane = i - (n - 1) / 2;
      var bx = lane * 1.2, by = 2.0 + (i % 2) * 0.9, bz = -baseZ - Math.abs(lane) * 3.0 - (i % 3) * 4.0;
      ship.position.set(bx, by, bz);
      this._squad.push({ x: bx, y: by, ph: i * 1.27 });
      grp.add(ship);
    }
    this.scene.add(grp);
  };
  CCView.prototype._buildShip = function (cfg) {
    var THREE = this.THREE, A = this._A || {};
    var grp = new THREE.Group();

    if (A.ccShip) {
      // (04 task 6) rear-view billboard on a camera-facing plane — recommended over a 3D model for the fixed chase cam.
      var tex = this._tex(A.ccShip, 1, 1, true);
      if (tex && tex.repeat && tex.repeat.set) { tex.repeat.set(1, 1); if (THREE.ClampToEdgeWrapping) { tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; } }
      var pm = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
      if (pm.depthWrite !== undefined) pm.depthWrite = false;
      this._disposables.push(pm);
      var pg = this._track(new THREE.PlaneGeometry(1.9, 1.9));
      var plane = new THREE.Mesh(pg, pm);
      plane.rotation.x = -0.32;                 // tilt up slightly toward the behind-and-above camera
      grp.add(plane);
      this._shipBillboard = plane;
    } else {
      // low-poly neon fallback. OWN materials (not the shared palette) so the ship can flash/glow
      // without tinting gates/lane-lines that share those colours.
      var bodyMat = this._mat(0x7855FA, 0x4a2ec8), wingMat = this._mat(0x1FDDE9, 0x0c8f99), coreMat = this._mat(0x1FDDE9, 0x0c8f99);
      var bodyG = this._track(new THREE.ConeGeometry(0.5, 1.5, 4));
      var body = new THREE.Mesh(bodyG, bodyMat); body.rotation.x = Math.PI / 2; grp.add(body);
      var wingG = this._track(new THREE.BoxGeometry(1.6, 0.08, 0.5));
      var wing = new THREE.Mesh(wingG, wingMat); wing.position.z = 0.2; grp.add(wing);
      var coreG = this._track(new THREE.OctahedronGeometry(0.18, 0));
      var core = new THREE.Mesh(coreG, coreMat); core.position.z = -0.1; grp.add(core);
    }

    // (04 task 4) protective glow shell — own additive material; opacity/colour animated each frame:
    //   soft pulsing aqua/iris = protected (i-frame grace or invincibility); sharp peach = damage.
    var glowMat = new THREE.MeshBasicMaterial({ color: 0x1FDDE9, transparent: true });
    if (glowMat.opacity !== undefined) glowMat.opacity = 0;
    if (THREE.AdditiveBlending) glowMat.blending = THREE.AdditiveBlending;
    if (glowMat.depthWrite !== undefined) glowMat.depthWrite = false;
    this._disposables.push(glowMat);
    this.shipGlowMat = glowMat;
    var glowG = this._track(new THREE.SphereGeometry(1.25, 12, 10));
    this.shipGlow = new THREE.Mesh(glowG, glowMat);
    if (this.shipGlow.visible !== undefined) this.shipGlow.visible = false;
    grp.add(this.shipGlow);

    // (04 task 8) boost rocket plume — additive cone trailing behind the ship; shown + flickered during boost
    var plumeMat = new THREE.MeshBasicMaterial({ color: this.shipTrailColor ? parseInt(this.shipTrailColor.slice(1), 16) : 0xFFC857, transparent: true });   // (v0.57.0) plume wears the mastery trail tint
    if (plumeMat.opacity !== undefined) plumeMat.opacity = 0;
    if (THREE.AdditiveBlending) plumeMat.blending = THREE.AdditiveBlending;
    if (plumeMat.depthWrite !== undefined) plumeMat.depthWrite = false;
    this._disposables.push(plumeMat);
    this.shipPlumeMat = plumeMat;
    var plumeG = this._track(new THREE.ConeGeometry(0.42, 2.6, 12));
    this.shipPlume = new THREE.Mesh(plumeG, plumeMat);
    this.shipPlume.rotation.x = -Math.PI / 2;          // axis along z; flame trails behind (+z, toward the chase cam)
    this.shipPlume.position.set(0, 0, 1.7);
    if (this.shipPlume.visible !== undefined) this.shipPlume.visible = false;
    grp.add(this.shipPlume);

    grp.position.set(0, 0.6, 0);
    return grp;
  };

  // sync visuals to sim — alloc-free
  // Intro fly-in: lerp the camera from a cinematic high-angle pose down into the chase pose.
  // t in [0,1]; t>=1 leaves the camera exactly at the gameplay pose (render() never moves it).
  CCView.prototype.setIntroCamera = function (t) {
    var cam = this.camera; if (!cam) return;
    var e = t < 0 ? 0 : t > 1 ? 1 : t;
    e = e < 0.5 ? 4 * e * e * e : 1 - Math.pow(-2 * e + 2, 3) / 2;   // easeInOutCubic
    var P = CAM.introPos, Q = CAM.chasePos, L = CAM.introLook, K = CAM.chaseLook;
    cam.position.set(P[0] + (Q[0] - P[0]) * e, P[1] + (Q[1] - P[1]) * e, P[2] + (Q[2] - P[2]) * e);
    cam.lookAt(L[0] + (K[0] - L[0]) * e, L[1] + (K[1] - L[1]) * e, L[2] + (K[2] - L[2]) * e);
    // ship descent: the ship starts high above the chasm and dives to its gameplay height as the fly-in
    // completes, so the intro reads as the ship descending INTO the chasm rather than already sitting in
    // it (Jason). Synced to the same camera ease; 0 at t>=1 so gameplay is untouched, and reduced motion
    // (which calls this with t=1) skips the descent entirely.
    this._introLift = (1 - e) * 14;
  };
  // (04 task 2) Speed-driven camera: widen FOV and add a subtle shake as speed ramps, so the velocity
  // READS even though geometry is texture-scrolled. `moving` gates the shake (off during questions/pause).
  // Reduced-motion zeroes the shake. Stub-safe: only writes fov when the camera exposes a numeric fov.
  // (v0.104.0, C10, Jason) double-tap left/right = a barrel roll into that lane (visual —
  // the lane moves are the two ordinary taps; reduced motion skips the spin entirely)
  CCView.prototype.startBarrelRoll = function (dir) {
    if (this.reducedMotion || this._rollT > 0) return;
    this._rollT = 1; this._rollDir = dir >= 0 ? 1 : -1;
  };
  CCView.prototype.applySpeedCamera = function (speed, moving, px, dt) {
    px = px || 0; dt = dt || 0;
    var cam = this.camera; if (!cam) return;
    var cfg = this.sim.cfg;
    var frac = (speed - cfg.BASE_SPEED) / (cfg.MAX_SPEED - cfg.BASE_SPEED);
    if (frac < 0) frac = 0; else if (frac > 1) frac = 1;
    var fov = 62 + frac * 10;                                   // 62 -> 72 with speed
    if (typeof cam.fov === 'number') {
      if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; if (cam.updateProjectionMatrix) cam.updateProjectionMatrix(); }
    }
    // (v0.77.0, JB5) the speed shake now CYCLES: it builds across each 40 km window of scored
    // distance (quadratic — calm early, alive late) then resets at the boundary, so intensity
    // breathes with the run instead of pinning at max forever (Jason: "too much eventually").
    var cyc40 = ((this.sim.scoreDistance / 1000) % 40) / 40;
    var amp = (this.reducedMotion || !moving) ? 0 : frac * 0.05 * (cyc40 * cyc40);
    this._lastShakeAmp = amp;                                    // pinned by cc-view-smoke
    var t = this._t, sx = Math.sin(t * 37.0) * amp, sy = Math.cos(t * 31.0) * amp * 0.7;
    // (C1) lateral follow: ease toward ~45% of the player's x so lane changes carry the frame;
    // (C1) counter-roll: the horizon tilts slightly against the smoothed lateral velocity.
    if (dt > 0) {
      this._camFX += (px * 0.45 - this._camFX) * Math.min(1, dt * 7);
      var lv = (px - this._camPX) / Math.max(dt, 1e-3); this._camPX = px;
      this._camLatV += (lv - this._camLatV) * Math.min(1, dt * 10);
      this._landDip *= Math.pow(0.002, dt);                       // fast decay of the landing dip
    }
    var roll = this.reducedMotion ? 0 : Math.max(-0.05, Math.min(0.05, -this._camLatV * 0.006));
    var dip = this.reducedMotion ? 0 : this._landDip;
    var P = CAM.chasePos, K = CAM.chaseLook;
    if (cam.position && cam.position.set) cam.position.set(P[0] + sx + this._camFX, P[1] + sy - dip, P[2]);
    if (cam.lookAt) cam.lookAt(K[0] + this._camFX * 0.65, K[1] + sy * 0.5 - dip * 0.5, K[2]);
    if (cam.rotation && typeof cam.rotation.z === 'number') cam.rotation.z += roll;   // small view-space roll after lookAt
  };
  CCView.prototype.render = function (dt) {
    this._t += dt;
    var sim = this.sim, cfg = sim.cfg, THREE = this.THREE;
    var hide = this._hide, sm = this.scratchM, sp = this.scratchP, sq = this.scratchQ, ss = this.scratchS;

    // obstacles -> instanced meshes by type (narrow split L/R: each bulge is baked at its wall's world x/y)
    var bL = 0, bR = 0, rN = 0, cN = 0, dL = 0, dR = 0, chU = 0, chD = 0, swN = 0, chS = 0;
    var chBob = this.reducedMotion ? 0 : Math.sin(this._t * 4.2) * 0.12;   // (Jason v0.47.0) telegraph chevrons bob toward their action
    var items = sim.obstacles.items, n = items.length, i;
    for (i = 0; i < n; i++) {
      var o = items[i];
      if (o.active && o.z < cfg.DRAW_DIST && o.z > cfg.CULL_BEHIND) {
        if (o.type === OB_NARROW) {
          if (o.span === 0) continue;                                  // collision-only centre of a wall-extend (the deep bulge covers it)
          setPos(sm, sp, sq, ss, 0, 0, -o.z);                          // bulge geometry carries x/y; translate in z only
          if (o.span === 2) {                                          // wall-extend: deep 2-lane bulge
            if (o.side === SIDE_LEFT) this.iNarrowDeepL.setMatrixAt(dL++, sm); else this.iNarrowDeepR.setMatrixAt(dR++, sm);
          } else {
            if (o.side === SIDE_LEFT) this.iNarrowL.setMatrixAt(bL++, sm); else this.iNarrowR.setMatrixAt(bR++, sm);
          }
        } else if (o.type === OB_LOWROCK) {
          setPos(sm, sp, sq, ss, 0, cfg.ROCK_H * 0.5, -o.z); this.iRock.setMatrixAt(rN++, sm);       // (Jason v0.47.0) full-width wall — centered, x irrelevant
          for (var chu = -1; chu <= 1; chu++) {
            setPos(sm, sp, sq, ss, chu * cfg.LANE_W, cfg.ROCK_H + 0.55 + chBob, -o.z); this.iChevUp.setMatrixAt(chU++, sm);
            setPos(sm, sp, sq, ss, chu * cfg.LANE_W, cfg.ROCK_H + 0.55 + chBob - 0.42, -o.z); this.iChevUpShaft.setMatrixAt(chU - 1, sm);   // (C1) stem below the head
          }
        } else if (o.type === 3 /* OB_SWEEP */) {
          // (v0.56.0) beam x comes from the sim's single source of truth; telegraph arrows point
          // along the CURRENT pan direction and slide sideways (reduced-motion: static, no slide).
          var swx = sim._sweepX(o);
          setPos(sm, sp, sq, ss, swx, cfg.ROCK_H * 0.5, -o.z); this.iSweep.setMatrixAt(swN++, sm);
          setPos(sm, sp, sq, ss, swx, cfg.ROCK_H + 0.45, -o.z); this.iSweepHead.setMatrixAt(swN - 1, sm);   // (C2) the emitter drone rides the beam
          var swDir = Math.cos(o.sweepPhase + o.z * cfg.SWEEP_FREQ) >= 0 ? 1 : -1;   // d(sweepX)/d(z) sign — where the beam is heading as it nears
          var chSlide = this.reducedMotion ? 0 : Math.sin(this._t * 4.2) * 0.12;
          for (var chs = -1; chs <= 1; chs++) {
            setPosRot(sm, sp, sq, ss, chs * cfg.LANE_W + chSlide * swDir, cfg.ROCK_H + 0.55, -o.z, swDir > 0 ? 0 : Math.PI, THREE);
            this.iChevSide.setMatrixAt(chS++, sm);
          }
        }
        else {
          setPos(sm, sp, sq, ss, 0, cfg.CEIL_BOTTOM + cfg.ARCH_H / 2, -o.z); this.iArch.setMatrixAt(cN++, sm);   // wall-to-wall lintel; underside stays at CEIL_BOTTOM (duck clearance)
          for (var chd = -1; chd <= 1; chd++) {
            setPos(sm, sp, sq, ss, chd * cfg.LANE_W, cfg.CEIL_BOTTOM - 0.5 - chBob, -o.z); this.iChevDown.setMatrixAt(chD++, sm);
            setPos(sm, sp, sq, ss, chd * cfg.LANE_W, cfg.CEIL_BOTTOM - 0.5 - chBob + 0.42, -o.z); this.iChevDownShaft.setMatrixAt(chD - 1, sm);   // (C1) stem above the head
          }
        }
      }
    }
    fillHidden(this.iNarrowL, bL, hide); fillHidden(this.iNarrowR, bR, hide); fillHidden(this.iRock, rN, hide); fillHidden(this.iArch, cN, hide);
    fillHidden(this.iNarrowDeepL, dL, hide); fillHidden(this.iNarrowDeepR, dR, hide);
    this.iNarrowL.count = this.iNarrowL.instanceMatrix.count; this.iNarrowR.count = this.iNarrowR.instanceMatrix.count;
    this.iRock.count = this.iRock.instanceMatrix.count; this.iArch.count = this.iArch.instanceMatrix.count;
    this.iNarrowDeepL.count = this.iNarrowDeepL.instanceMatrix.count; this.iNarrowDeepR.count = this.iNarrowDeepR.instanceMatrix.count;
    this.iNarrowL.instanceMatrix.needsUpdate = this.iNarrowR.instanceMatrix.needsUpdate = this.iRock.instanceMatrix.needsUpdate = this.iArch.instanceMatrix.needsUpdate = true;
    this.iNarrowDeepL.instanceMatrix.needsUpdate = this.iNarrowDeepR.instanceMatrix.needsUpdate = true;
    fillHidden(this.iChevUp, chU, hide); fillHidden(this.iChevDown, chD, hide);
    fillHidden(this.iChevUpShaft, chU, hide); fillHidden(this.iChevDownShaft, chD, hide);
    this.iChevUp.count = this.iChevUp.instanceMatrix.count; this.iChevDown.count = this.iChevDown.instanceMatrix.count;
    this.iChevUpShaft.count = this.iChevUpShaft.instanceMatrix.count; this.iChevDownShaft.count = this.iChevDownShaft.instanceMatrix.count;
    this.iChevUpShaft.instanceMatrix.needsUpdate = this.iChevDownShaft.instanceMatrix.needsUpdate = true;
    this.iChevUp.instanceMatrix.needsUpdate = this.iChevDown.instanceMatrix.needsUpdate = true;
    fillHidden(this.iSweep, swN, hide); fillHidden(this.iChevSide, chS, hide); fillHidden(this.iSweepHead, swN, hide);
    this.iSweep.count = this.iSweep.instanceMatrix.count; this.iChevSide.count = this.iChevSide.instanceMatrix.count;
    this.iSweepHead.count = this.iSweepHead.instanceMatrix.count;
    this.iSweep.instanceMatrix.needsUpdate = this.iChevSide.instanceMatrix.needsUpdate = this.iSweepHead.instanceMatrix.needsUpdate = true;

    // coins (spin)
    var coN = 0, citems = sim.coins.items, cn = citems.length;
    var spin = this._t * 3.0;
    for (i = 0; i < cn; i++) {
      var co = citems[i];
      if (co.active && !co.collected && co.z < cfg.DRAW_DIST && co.z > cfg.CULL_BEHIND) {
        setPosRot(sm, sp, sq, ss, co.x, co.y, -co.z, spin, THREE);
        this.iCoin.setMatrixAt(coN++, sm);
      }
    }
    fillHidden(this.iCoin, coN, hide);
    this.iCoin.instanceMatrix.needsUpdate = true;

    // gates (normal + power) — face-on rings (ry=0 keeps the hole facing the player to fly through)
    var crN = 0, crP = 0, critems = sim.gates.items, crn = critems.length;
    for (i = 0; i < crn; i++) {
      var cr = critems[i];
      if (cr.active && cr.z < cfg.DRAW_DIST && cr.z > cfg.CULL_BEHIND) {
        setPosRot(sm, sp, sq, ss, cr.x, 1.7, -cr.z, 0, THREE);
        if (cr.power) { this.iGatePow.setMatrixAt(crP, sm); this.iGateFilmPow.setMatrixAt(crP++, sm); }
        else { this.iGate.setMatrixAt(crN, sm); this.iGateFilm.setMatrixAt(crN++, sm); }
      }
    }
    fillHidden(this.iGate, crN, hide); fillHidden(this.iGatePow, crP, hide);
    fillHidden(this.iGateFilm, crN, hide); fillHidden(this.iGateFilmPow, crP, hide);
    this.iGateFilm.count = this.iGateFilm.instanceMatrix.count; this.iGateFilmPow.count = this.iGateFilmPow.instanceMatrix.count;
    this.iGateFilm.instanceMatrix.needsUpdate = this.iGateFilmPow.instanceMatrix.needsUpdate = true;
    this.iGate.instanceMatrix.needsUpdate = this.iGatePow.instanceMatrix.needsUpdate = true;
    // gate glow pulse — gentle emissive throb so the frames read as energized fly-through portals
    // (reduced-motion holds them steady; stub-safe — only writes a numeric emissiveIntensity)
    if (!this.reducedMotion && this._gateMat && typeof this._gateMat.emissiveIntensity === "number") {
      var gpulse = 0.55 + 0.35 * (0.5 + 0.5 * Math.sin(this._t * 3.0));   // ~0.55..0.90
      this._gateMat.emissiveIntensity = gpulse;
      if (this._gatePowMat && typeof this._gatePowMat.emissiveIntensity === "number") this._gatePowMat.emissiveIntensity = gpulse + 0.06;
      // (Jason v0.47.0) the energy film shimmers faster than the ring — reads as live power, not paint
      if (this._gateFilmMat && typeof this._gateFilmMat.opacity === "number") this._gateFilmMat.opacity = 0.10 + 0.10 * (0.5 + 0.5 * Math.sin(this._t * 7.3));
      if (this._gateFilmPowMat && typeof this._gateFilmPowMat.opacity === "number") this._gateFilmPowMat.opacity = 0.10 + 0.10 * (0.5 + 0.5 * Math.sin(this._t * 7.3 + 1.1));
    }

    // ship — (C2) bank follows smoothed lateral VELOCITY (eases in and out; no snap at lane arrival),
    // (C3) duck is eased both ways with squash-and-stretch, (C4) landings get a squash + camera dip + dust puff.
    var p = sim.player;
    if (dt > 0) {
      var lvx = (p.x - this._shipPX) / Math.max(dt, 1e-3); this._shipPX = p.x;
      var bankTarget = Math.max(-0.55, Math.min(0.55, lvx * 0.10));
      this._bank += (bankTarget - this._bank) * Math.min(1, dt * 12);
      this._duckF += ((p.ducking ? 1 : 0) - this._duckF) * Math.min(1, dt * 14);
      if (this._landT > 0) this._landT = Math.max(0, this._landT - dt * 5);
      var landedNow = this._wasJump && !p.jumping && p.y <= 0;
      this._wasJump = p.jumping;
      if (landedNow) {
        this._landT = 1; this._landDip = this.reducedMotion ? 0 : 0.12;
        this.spawnSparks(p.x, 0.15, 0, this.reducedMotion ? 0 : 6);            // dust puff at the touch-down point
      }
    }
    // (v0.72.0, J4) duck rework — Jason disliked the deflate. The read is now a COMMITTED
    // POWER-DIVE: steep nose-down (0.5 rad), a real drop toward the deck, a slight forward
    // stretch (speed), NO vertical squash at all (landing squash stays), and the engine
    // plume flares during the dive like an afterburner kick.
    var squash = 1 - 0.22 * this._landT * this._landT;                        // landing squash only
    this.ship.position.x = p.x;
    this.ship.position.y = 0.6 + p.y - 0.28 * this._duckF + (this._introLift || 0);   // dives toward the deck (was 0.10)
    // (v0.104.0, C10) barrel roll: a full additive 2π spin on double-tap — _bank stays
    // untouched (its feel pins hold); reduced motion never spins. (C4) turn kick: a brief
    // yaw-flavored roll impulse when a corner resolves.
    if (this._rollT > 0) {
      this._rollT = Math.max(0, this._rollT - dt / 0.55);
      var rk = 1 - this._rollT, rEase = 1 - Math.pow(1 - rk, 3);
      this.ship.rotation.z = this._bank + this._rollDir * Math.PI * 2 * rEase;
    } else this.ship.rotation.z = this._bank;
    if (this.sim.turnMade !== this._turnSeen) {
      this._turnSeen = this.sim.turnMade;
      if (!this.reducedMotion) this._turnKickT = 1;
      this._turnKickDir = this.sim.turnDir === 'right' ? -1 : 1;
    }
    if (this._turnKickT > 0) { this._turnKickT = Math.max(0, this._turnKickT - dt / 0.7); this.ship.rotation.z += this._turnKickDir * 0.35 * Math.sin(Math.PI * this._turnKickT); }
    if (this.ship.rotation && typeof this.ship.rotation.x === 'number') this.ship.rotation.x = 0.5 * this._duckF;   // steep dive-under
    this.ship.scale.y = squash;
    this.ship.scale.x = 1 + 0.06 * this._duckF + 0.12 * this._landT;
    if (this.ship.scale && typeof this.ship.scale.z === 'number') this.ship.scale.z = 1 + 0.10 * this._duckF;   // forward stretch = speed

    // (04 task 8) boost rocket plume — flare + fast flicker while boosting; (J4) it also
    // flares as an afterburner kick during the dive-under
    if (this.shipPlume) {
      var boosting = !!sim.boostActive || this._duckF > 0.35;
      if (this.shipPlume.visible !== boosting) this.shipPlume.visible = boosting;
      if (boosting && this.shipPlumeMat && typeof this.shipPlumeMat.opacity === "number") {
        this.shipPlumeMat.opacity = 0.6 + 0.35 * Math.sin(this._t * 38);   // rocket-exhaust flicker
      }
    }

    // particles
    this._stepParticles(dt);

    // (04 task 2) edge speed-ticks: stream toward the camera. Real z-motion = strongest speed cue.
    var tk = 0, tickN = this._tickN, spc = this._tickSpacing, ex = this._tickEdgeX, total = tickN * spc;
    // (v0.119.0, Jason) the edge ticks only guide the first 5 km; then they thin out over the
    // next 600 m and vanish (scoreDistance = the HUD km, so a resumed run past 5 km stays clear).
    var overTick = sim.scoreDistance - 5000;
    var visTicks = overTick <= 0 ? tickN : (overTick >= 600 ? 0 : Math.round(tickN * (1 - overTick / 600)));
    this._tickVisN = visTicks;
    var phase = sim.distance - Math.floor(sim.distance / spc) * spc;
    for (i = 0; i < visTicks; i++) {
      var zc = i * spc - phase; if (zc < 0) zc += total;          // wrap the just-passed tick to the far end
      setPos(sm, sp, sq, ss, -ex, 0.04, -zc); this.iTick.setMatrixAt(tk++, sm);
      setPos(sm, sp, sq, ss, ex, 0.04, -zc); this.iTick.setMatrixAt(tk++, sm);
    }
    fillHidden(this.iTick, tk, hide);
    this.iTick.count = this.iTick.instanceMatrix.count; this.iTick.instanceMatrix.needsUpdate = true;

    // (04 task 5 + 2) dust: drift + rush past the camera (near-field speed reference). View rng only.
    if (this._dustN) {
      var dk = 0, dn = this._dustN, du = this._dust, spz = this._dustSpanZ, spx = this._dustSpanX;
      var dustSpeed = sim.speed * 0.55;
      for (i = 0; i < dn; i++) {
        var mo = du[i];
        mo.z -= dustSpeed * dt;
        mo.x += mo.dx * dt + Math.sin((this._t + mo.ph) * 0.7) * 0.01;
        mo.y += mo.dy * dt;
        if (mo.z < -4) { mo.z += spz + 4; mo.x = (this.vrng.next() - 0.5) * spx; }   // recycle to far
        if (mo.y < 0.2) mo.y = 0.2; else if (mo.y > 6) mo.y = 6;
        setPos(sm, sp, sq, ss, mo.x, mo.y, -mo.z); this.iDust.setMatrixAt(dk++, sm);
      }
      fillHidden(this.iDust, dk, hide);
      this.iDust.count = this.iDust.instanceMatrix.count; this.iDust.instanceMatrix.needsUpdate = true;
    }

    // scroll canyon rock by distance travelled (sense of speed).
    // NOTE: if a surface scrolls the wrong way/axis in-browser, flip the sign
    // or swap offset.x/offset.y here — pure-2D harness can't verify this.
    var d = sim.distance;
    // (04 task 2) scroll near TRUE ground speed so the world reads fast: rate ≈ 1/tileSize, so apparent
    // texture motion ≈ player speed (tiles ≈ 8.7 m on floor/walls, 6.25 m on the rim surface). The old
    // rates were ~8x too slow, which is why speed didn't read. anisotropy(16)+large tiles hold strobe back;
    // if the distant floor shimmers in-browser, dial these down.
    var fo = -d * 0.10, wo = d * 0.095;
    if (this.texFloor) this.texFloor.offset.y = fo;
    if (this.texFloorN) this.texFloorN.offset.y = fo;
    if (this.texWallL) this.texWallL.offset.x = wo;
    if (this.texWallR) this.texWallR.offset.x = wo;
    if (this.texWallLN) this.texWallLN.offset.x = wo;
    if (this.texWallRN) this.texWallRN.offset.x = wo;
    // (v0.105.0, C8, Jason) the mountains actually PASS: each peak drifts +z at its row's
    // parallax rate and wraps far ahead with a deterministic re-jitter (position-hash — no
    // rng, zero allocation, same 30 children forever). Frozen under reduced motion.
    if (this.peaks && this.peaks.children && !this.reducedMotion) {
      // (v0.117.0, Jason) drift by WORLD-DISTANCE delta, not speed*dt — the peaks now ride the
      // exact clock the walls/floor scroll on (d = sim.distance), which is FROZEN while a question
      // holds the world (sim.step isn't called), so they stop dead behind the card instead of sliding.
      var pv = (this._peakDist === undefined) ? 0 : (d - this._peakDist);
      this._peakDist = d;
      var pk = this.peaks.children;
      if (pv > 0) for (var pi = 0; pi < pk.length; pi++) {
        var pm = pk[pi], pu = pm.userData;
        if (!pu || !pu.par) continue;
        pm.position.z += pv * pu.par;
        if (pm.position.z > 24) {
          pm.position.z -= pu.wrap;
          var ph2 = Math.sin((pm.position.x + pm.position.z) * 12.9898 + pi * 78.233) * 43758.5453;
          var pn = ph2 - Math.floor(ph2);
          pm.position.x = (pu.x0 !== undefined ? pu.x0 : pm.position.x) + (pn - 0.5) * 6;   // (v0.118.0) re-jitter around the lateral HOME, never wander toward center
          if (pm.rotation) pm.rotation.y += pn * 2.4;
        }
      }
    }
    // (v0.105.0, C3, Jason) ambient flythrough: every so often one squadron ship peels off
    // and sweeps across the sky band — pure view-side set dressing off the forked view clock.
    if (this.squadron && this.squadron.children.length && !this.reducedMotion) {
      if (!this._flyT && ((this._t + 11) % 26) < dt * 2) { this._flyT = 0.0001; this._flyIdx = (this._flyIdx || 0) % this.squadron.children.length; }
      if (this._flyT) {
        this._flyT += dt / 5;                                    // a 5s sweep
        var fsh = this.squadron.children[this._flyIdx], fk2 = Math.min(1, this._flyT);
        var fe = fk2 * fk2 * (3 - 2 * fk2);
        fsh.position.x = -16 + 32 * fe;
        fsh.position.y = 8.5 + Math.sin(fe * Math.PI) * 3.2;
        if (this._flyT >= 1) { this._flyT = 0; this._flyIdx++; }   // bob loop re-adopts it next frame
      }
    }
    // planet surface scrolls along travel like the floor (its own rate for the larger tiles)
    var so = -d * 0.14;
    if (this.texSurfL) this.texSurfL.offset.y = so;
    if (this.texSurfLN) this.texSurfLN.offset.y = so;
    if (this.texSurfR) this.texSurfR.offset.y = so;
    if (this.texSurfRN) this.texSurfRN.offset.y = so;

    // fleeing squadron: bob + weave in place (held at a fixed far depth = never caught)
    if (this.squadron) {
      var sc = this.squadron.children, sq2 = this._squad, tt = this._t;
      for (i = 0; i < sc.length; i++) {
        if (this._flyT && i === this._flyIdx) continue;          // (v0.105.0, C3) mid-flyby: the sweep owns this ship
        var qb = sq2[i];
        sc[i].position.y = qb.y + Math.sin(tt * 1.5 + qb.ph) * 0.34;
        sc[i].position.x = qb.x + Math.sin(tt * 0.8 + qb.ph) * 0.72;
        sc[i].rotation.z = Math.sin(tt * 0.8 + qb.ph) * 0.22;
      }
    }

    // (04 task 4) feedback split by meaning (a11y: distinct *behaviour* of light, not just colour):
    //   damage / shield loss = SHARP peach flash (decays over HIT_FLASH);
    //   protected (i-frame grace OR invincibility power) = SOFT pulsating glow (aqua grace / iris invincible).
    // Reduced-motion: steady glow (no pulse) and a gentler flash. The ship itself never blinks now.
    var gm = this.shipGlowMat;
    if (gm && gm.opacity !== undefined) {
      var op = 0, R = 0.31, G = 0.87, B = 0.91;
      if (sim.hitFlash > 0) {
        op = (sim.hitFlash / cfg.HIT_FLASH) * (this.reducedMotion ? 0.5 : 0.95);
        R = 1.0; G = 0.42; B = 0.36;                                   // peach
      } else if (sim.buffs.invincible > 0 || sim.iframe > 0) {
        op = this.reducedMotion ? 0.34 : (0.30 + 0.20 * (0.5 + 0.5 * Math.sin(this._t * 6.0)));
        if (sim.buffs.invincible > 0) { R = 0.57; G = 0.33; B = 1.0; } // iris while fully invincible
      }
      gm.opacity = op;
      if (gm.color && gm.color.setRGB) gm.color.setRGB(R, G, B);
      if (this.shipGlow && this.shipGlow.visible !== undefined) this.shipGlow.visible = op > 0.001;
    }
    if (this.ship && this.ship.visible !== undefined) this.ship.visible = true;

    this.renderer.render(this.scene, this.camera);
  };

  CCView.prototype.spawnSparks = function (x, y, z, n) {
    var rng = this.vrng || this.sim.rng;
    for (var i = 0; i < n; i++) {
      var pt = this.particles.acquire(); if (!pt) return;
      pt.x = x; pt.y = y; pt.z = z;
      pt.vx = (rng.next() - 0.5) * 4; pt.vy = rng.next() * 4; pt.vz = (rng.next() - 0.5) * 4;
      pt.life = 0; pt.max = 0.4 + rng.next() * 0.3;
    }
  };
  CCView.prototype._stepParticles = function (dt) {
    var items = this.particles.items, n = items.length, k = 0, i;
    var sm = this.scratchM, sp = this.scratchP, sq = this.scratchQ, ss = this.scratchS;
    for (i = 0; i < n; i++) {
      var p = items[i]; if (!p.active) continue;
      p.life += dt;
      if (p.life >= p.max) { this.particles.release(p); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt - 4 * dt * dt; p.z += p.vz * dt; p.vy -= 8 * dt;
      setPos(sm, sp, sq, ss, p.x, p.y, p.z); this.iSpark.setMatrixAt(k++, sm);
    }
    fillHidden(this.iSpark, k, this._hide);
    this.iSpark.instanceMatrix.needsUpdate = true;
  };

  CCView.prototype.resize = function () {
    var c = this.canvas;
    var w = c.clientWidth || c.width || 1, h = c.clientHeight || c.height || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  };

  CCView.prototype.dispose = function () {
    try { this.renderer.dispose(); } catch (e) {}
    try {
      var gl = this.renderer.getContext && this.renderer.getContext();
      var ext = gl && gl.getExtension && gl.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
    } catch (e) {}
    for (var i = 0; i < this._disposables.length; i++) {
      var d = this._disposables[i];
      if (d && typeof d.dispose === 'function') { try { d.dispose(); } catch (e) {} }
    }
    this._disposables.length = 0;
    this.scene = this.camera = this.renderer = null;
  };

  // instanced-matrix helpers (module-private; reuse scratch)
  function setPos(m, p, q, s, x, y, z) {
    p.set(x, y, z); q.set(0, 0, 0, 1); s.set(1, 1, 1); m.compose(p, q, s);
  }
  function setPosRot(m, p, q, s, x, y, z, ry, THREE) {
    p.set(x, y, z); q.setFromAxisAngle(AXIS_Y(THREE), ry); s.set(1, 1, 1); m.compose(p, q, s);
  }
  var _axisY = null;
  function AXIS_Y(THREE) { if (!_axisY) _axisY = new THREE.Vector3(0, 1, 0); return _axisY; }
  function fillHidden(im, from, hide) {
    var cap = im.instanceMatrix.count, i;
    for (i = from; i < cap; i++) im.setMatrixAt(i, hide);
  }

  /* ============================== MODULE ====================================
   * The StarNix GameModule: DOM, input, RAF (fixed timestep), audio, overlay,
   * HUD, persistence. Fully cleans up in unmount(). */
  function createCCModule() {
    var state = null;

    function mount(rootEl, ctx) {
      ctx = ctx || {};
      var cfg = CONFIG;
      var rng = (ctx.rng && typeof ctx.rng.fork === 'function') ? ctx.rng.fork('CC') : (ctx.rng || makeFallbackRng(Date.now()));
      var sim = new CCSim({ ctx: ctx, rng: rng });
      try { if (window.CC) window.CC._lastSim = sim; } catch (eLS) {}   // (v0.106.0, G2) test seam
      // (v0.106.0, G2) Resume: pick the run back up at the checkpointed gate
      if (ctx.resumeData && ctx.resumeData.scoreDistance) {
        var rz = ctx.resumeData;
        sim.scoreDistance = rz.scoreDistance; sim.shields = Math.max(1, rz.shields | 0);
        sim.coinScore = rz.coinScore | 0; sim._gatesPassed = rz.gatesPassed | 0;
        if (rz.nextTurnScore) sim._nextTurnScore = rz.nextTurnScore;
        sim._nextGateScore = (Math.floor(sim.scoreDistance / (sim.cfg.GATE_KM * 1000)) + 1) * (sim.cfg.GATE_KM * 1000);   // (G4) grid snap
        sim._resumed = true;                                              // (G4) applyUpgrades must NOT re-fill the checkpointed shields
        if (rz.boostLeft > 0) { sim._activateBoost(); sim._boostTargetScore = sim.scoreDistance + rz.boostLeft; }   // (G4) an earned boost survives the save
      }

      // settings (apply async; defaults until loaded)
      var settings = { reducedMotion: false, music: true, sfx: true };
      if (ctx.persistence && typeof ctx.persistence.load === 'function') {
        Promise.resolve(ctx.persistence.load()).then(function (prof) {
          if (prof && prof.settings) {
            if (prof.settings.reducedMotion != null) settings.reducedMotion = !!prof.settings.reducedMotion;
            garageProfile = prof;                              // (v0.73.0, J9)
            if (prof.ccUpgrades) sim.applyUpgrades(prof.ccUpgrades);
            if (prof.settings.music != null && ctx.audio) ctx.audio.setMusic && ctx.audio.setMusic(!!prof.settings.music);
            if (prof.settings.sfx != null && ctx.audio) ctx.audio.setSfx && ctx.audio.setSfx(!!prof.settings.sfx);
            if (view) view.reducedMotion = settings.reducedMotion;
          }
        }).catch(function () {});
      }

      // sfx hook
      sim._emit = function (name) {
        if (!ctx.audio || !ctx.audio.sfx) return;
        if (name === 'coin') ctx.audio.sfx('collect');
        else if (name === 'gatePassed') ctx.audio.sfx('click');
        else if (name === 'powerup') ctx.audio.sfx('correct');
        else if (name === 'gameover') ctx.audio.sfx('explode');
      };

      // ---- DOM ----
      var el = buildDom();
      rootEl.appendChild(el.root);
      if (ctx.audio && ctx.audio.ensure) ctx.audio.ensure();
      if (ctx.audio && ctx.audio.playTrack) ctx.audio.playTrack('cc');

      // ---- view (graceful: THREE/WebGL optional) ----
      var view = null;
      var THREE = (typeof window !== 'undefined') ? window.THREE : (typeof self !== 'undefined' ? self.THREE : undefined);
      if (THREE) {
        try { view = new CCView(THREE, sim, el.canvas, { reducedMotion: settings.reducedMotion, shipTrailColor: (ctx.settings && ctx.settings.shipTrailColor) || null }); }
        catch (e) { view = null; el.fallback.style.display = 'flex'; el.fallback.textContent = '3D unavailable — ' + (e && e.message || e); }
      } else {
        el.fallback.style.display = 'flex';
        el.fallback.textContent = '3D engine (Three.js) not loaded.';
      }

      // ---- input ----
      var lastTapDir = 0, lastTapAt = 0;   // (v0.104.0, C10) double-tap window
      function tapMove(dir) {
        var now2 = Date.now();
        if (dir === lastTapDir && now2 - lastTapAt < 260 && view && view.startBarrelRoll) view.startBarrelRoll(dir);
        lastTapDir = dir; lastTapAt = now2;
      }
      var actions = {
        left: function () { sim.moveLeft(); tapMove(-1); flashKey(el.kLeft); },
        right: function () { sim.moveRight(); tapMove(1); flashKey(el.kRight); },
        jump: function () { sim.jump(); flashKey(el.kJump); },                       // instant (swipe): normal jump, no hang
        jumpPress: function () { sim.jump(); sim.holdJump(); flashKey(el.kJump); },   // (Jason) press-and-hold (keyboard/button): extends at the apex
        jumpRelease: function () { sim.releaseJump(); },
        duck: function () { sim.duck(); flashKey(el.kDuck); }
      };
      function onKey(e) {
        if (sim.phase === PHASE_OVER) return;
        var k = e.key;
        if (k === 'ArrowLeft' || k === 'a' || k === 'A') { actions.left(); e.preventDefault(); }
        else if (k === 'ArrowRight' || k === 'd' || k === 'D') { actions.right(); e.preventDefault(); }
        else if (k === 'ArrowUp' || k === 'w' || k === 'W' || k === ' ') { if (!e.repeat) actions.jumpPress(); e.preventDefault(); }   // (Jason) ignore key auto-repeat so holding doesn't re-jump
        else if (k === 'ArrowDown' || k === 's' || k === 'S') { actions.duck(); e.preventDefault(); }
      }
      function onKeyUp(e) {                                   // (Jason) releasing the jump key ends the apex float
        var k = e.key;
        if (k === 'ArrowUp' || k === 'w' || k === 'W' || k === ' ') actions.jumpRelease();
      }
      var touch = { x: 0, y: 0, on: false };
      function onTS(e) { var t = e.changedTouches[0]; touch.x = t.clientX; touch.y = t.clientY; touch.on = true; }
      function onTE(e) {
        if (!touch.on) return; touch.on = false;
        var t = e.changedTouches[0]; var dx = t.clientX - touch.x, dy = t.clientY - touch.y;
        if (Math.abs(dx) < 24 && Math.abs(dy) < 24) return;
        if (Math.abs(dx) > Math.abs(dy)) { if (dx > 0) actions.right(); else actions.left(); }
        else { if (dy > 0) actions.duck(); else actions.jump(); }
        e.preventDefault();
      }
      window.addEventListener('keydown', onKey);
      window.addEventListener('keyup', onKeyUp);                                  // (Jason) jump-key release ends the hang
      el.canvas.addEventListener('touchstart', onTS, { passive: false });
      el.canvas.addEventListener('touchend', onTE, { passive: false });
      bindBtn(el.kLeft, actions.left); bindBtn(el.kRight, actions.right);
      bindBtn(el.kDuck, actions.duck);
      bindHold(el.kJump, actions.jumpPress, actions.jumpRelease);                 // (Jason) press-and-hold the on-screen jump button to extend

      var onResize = debounce(function () { if (view) view.resize(); }, 120);
      window.addEventListener('resize', onResize);
      function onVis() { if (document.hidden) pause(); else resume(); }
      document.addEventListener('visibilitychange', onVis);

      // ---- overlay (question) ----
      var overlayBtns = [];
      var multiSubmit = null;
      var feedbackShown = false;
      function isMulti(q) { return !!(q && Array.isArray(q.correctIndices) && q.correctIndices.length); }
      function showQuestion() {
        var q = sim.pending.question;
        el.qStem.textContent = q.stem + (q.image ? ' \u26A0 [Exhibit question served in error \u2014 image only renders in Study/Exam]' : '');   // (v0.91.0) loud leak guard
        el.qOpts.textContent = '';
        overlayBtns.length = 0; multiSubmit = null; feedbackShown = false;
        updateQTimer();
        var multi = isMulti(q), selected = [];
        for (var i = 0; i < q.options.length; i++) {
          (function (idx) {
            var b = document.createElement('button');
            b.className = 'cc-opt';
            b.textContent = String.fromCharCode(65 + idx) + '.  ' + q.options[idx];
            if (multi) {
              b.addEventListener('click', function () {
                var at = selected.indexOf(idx);
                if (at >= 0) { selected.splice(at, 1); b.classList.remove('sel'); }
                else { selected.push(idx); b.classList.add('sel'); }
                if (multiSubmit) multiSubmit.disabled = selected.length === 0;
              });
            } else {
              b.addEventListener('click', function () { onAnswer(idx); });
            }
            el.qOpts.appendChild(b); overlayBtns.push(b);
          })(i);
        }
        if (multi) {
          var hint = document.createElement('div'); hint.className = 'cc-multi-hint';
          hint.textContent = 'Select all that apply (' + q.correctIndices.length + '), then submit.';
          el.qOpts.appendChild(hint);
          multiSubmit = document.createElement('button'); multiSubmit.className = 'cc-cont cc-submit';
          multiSubmit.textContent = 'Submit answer'; multiSubmit.disabled = true;
          multiSubmit.addEventListener('click', function () { onAnswer(selected.slice()); });
          el.qOpts.appendChild(multiSubmit);
        }
        el.qFeedback.style.display = 'none';
        el.qStem.style.display = ''; el.qOpts.style.display = '';
        el.overlay.style.display = 'flex';
      }
      function onAnswer(answer) {
        var res = sim.answer(answer);   // applies shield/mastery/telemetry/buff
        if (!res) return;
        showFeedback(res);
      }
      function showFeedback(res) {
        if (feedbackShown) return; feedbackShown = true;   // render once (click OR timeout)
        if (multiSubmit) multiSubmit.disabled = true;
        var q = res.question, multi = isMulti(q);
        var correctSet = multi ? q.correctIndices : [q.correctIndex];
        var chosenSet = multi ? (res.chosen || []) : [res.chosen];   // timeout: chosen is null -> no "wrong" marks
        // feedback (colorblind-safe: icon + word + color). Mark every correct option; mark chosen-but-wrong.
        for (var i = 0; i < overlayBtns.length; i++) {
          overlayBtns[i].disabled = true; overlayBtns[i].classList.remove('sel');
          if (correctSet.indexOf(i) >= 0) overlayBtns[i].classList.add('correct');
          else if (chosenSet.indexOf(i) >= 0) overlayBtns[i].classList.add('wrong');
        }
        el.qFeedback.style.display = 'block';
        el.qFeedback.innerHTML = '';
        var head = document.createElement('div');
        head.className = 'cc-fb-head ' + (res.correct ? 'ok' : 'no');
        var sd = res.shieldDelta == null ? (res.correct ? 1 : -2) : res.shieldDelta;   // (v0.83.0) say the REAL cost (wrong = -2, was mislabelled -1)
        var sdTxt = (sd > 0 ? '+' : '\u2212') + Math.abs(sd) + ' shield' + (Math.abs(sd) === 1 ? '' : 's');
        head.textContent = res.timedOut ? '\u23F1 Time\u2019s up \u2014 incorrect  (' + sdTxt + ')'
          : (res.correct ? '\u2713 Correct  (' + sdTxt + ')' : '\u2717 Incorrect  (' + sdTxt + ')');
        var exp = document.createElement('div'); exp.className = 'cc-fb-exp';
        (function () {                                             // (v0.71.0, J8) 150-word display cap
          var wx = String(res.question.explanation || '').trim().split(/\s+/);
          if (wx.length <= 120) { exp.textContent = res.question.explanation || ''; return; }
          exp.textContent = wx.slice(0, 120).join(' ') + '\u2026';
          var det = document.createElement('details'); det.className = 'cc-fb-more';
          var sm = document.createElement('summary'); sm.textContent = 'Show the full explanation (' + (wx.length - 120) + ' more words)';
          var bd = document.createElement('div'); bd.textContent = wx.slice(120).join(' ');
          det.appendChild(sm); det.appendChild(bd); exp.appendChild(det);
        })();
        var cont = document.createElement('button'); cont.className = 'cc-cont';
        cont.textContent = (sim.phase === PHASE_OVER) ? 'See results' : 'Continue';
        cont.addEventListener('click', function () {
          el.overlay.style.display = 'none';
          if (sim.phase === PHASE_OVER) showOver();
          else {
            sim.resumeAfterQuestion(); resume();
            // (v0.106.0, G2) each survived gate is the checkpoint
            try {
              var P4 = ctx.persistence;
              if (P4 && P4.load && P4.save) {
                var snap = { scoreDistance: sim.scoreDistance, shields: sim.shields, coinScore: sim.coinScore, gatesPassed: sim._gatesPassed, nextTurnScore: sim._nextTurnScore,
                  boostLeft: sim.boostActive ? Math.max(0, sim._boostTargetScore - sim.scoreDistance) : 0,   // (v0.108.0, G4) an earned ride is part of the save
                  label: (sim.scoreDistance / 1000).toFixed(1) + ' km \u00b7 ' + sim.shields + ' shields \u00b7 ' + sim.coinScore + ' cells' };
                if (P4.update) P4.update(function (p) { p.saves = p.saves || {}; p.saves.CC = snap; });   // (G4 HIGH) live profile
                else P4.load().then(function (p) { p.saves = p.saves || {}; p.saves.CC = snap; return P4.save(p); }).catch(function () {});
              }
            } catch (eSv) {}
          }
        });
        // (v0.88.0, L3) per-option rationale for the actual wrong pick
        var noteEl3 = null, qn3 = res.question, ch3 = res.chosen;
        if (!res.correct && !res.timedOut && qn3 && Array.isArray(qn3.optionNotes)) {
          var cs3 = Array.isArray(qn3.correctIndices) ? qn3.correctIndices : [qn3.correctIndex];
          var picks3 = Array.isArray(ch3) ? ch3 : (ch3 == null ? [] : [ch3]), pick3 = -1;
          for (var p3 = 0; p3 < picks3.length; p3++) { if (cs3.indexOf(picks3[p3]) < 0) { pick3 = picks3[p3]; break; } }
          if (pick3 >= 0 && qn3.optionNotes[pick3]) {
            noteEl3 = document.createElement('div'); noteEl3.className = 'cc-fb-note';
            noteEl3.textContent = 'Your pick \u2014 ' + qn3.optionNotes[pick3];
          }
        }
        el.qFeedback.appendChild(head); if (noteEl3) el.qFeedback.appendChild(noteEl3); el.qFeedback.appendChild(exp); el.qFeedback.appendChild(cont);
        cont.focus();
        if (view && !settings.reducedMotion) view.spawnSparks(sim.player.x, 1.2, 0, res.correct ? 14 : 0);
      }

      // ---- game over ----
      function showOver() {
        try { var P5 = ctx.persistence; if (P5 && P5.update) P5.update(function (p) { if (p.saves) delete p.saves.CC; }); else if (P5 && P5.load && P5.save) P5.load().then(function (p) { if (p.saves && p.saves.CC) { delete p.saves.CC; return P5.save(p); } }).catch(function () {}); } catch (eCl) {}   // (v0.108.0, G4) live profile
        var banked = sim.coinScore | 0;                        // (v0.73.0, J9) cells earned this run
        if (ctx.persistence && typeof ctx.persistence.load === 'function') {
          Promise.resolve(ctx.persistence.load()).then(function (prof) {
            prof = prof || {}; prof.bests = prof.bests || {};
            var best = prof.bests.CC || 0;
            if (sim.runStats.points > best) { prof.bests.CC = sim.runStats.points; }
            prof.totals = prof.totals || {};
            prof.ccCells = (prof.ccCells | 0) + banked;        // (J9) bank the wallet
            garageProfile = prof;
            if (ctx.persistence.save) ctx.persistence.save(prof);
            if (el.ovrCells) el.ovrCells.textContent = '\u2b21 +' + banked + ' cells banked \u00b7 balance ' + (prof.ccCells | 0);
          }).catch(function () {});
        }
        el.ovrTitle.textContent = '\ud83d\udca5 SHIP DOWN \u2014 you crashed';   // (v0.77.0, JB4) say what happened
        el.ovrStats.innerHTML =
          row('Distance', (sim.runStats.points / 1000).toFixed(2) + ' km') +
          row('Cells collected', banked) +
          row('Unique correct', sim.runStats.uniqueCorrect) +
          row('Unique incorrect', sim.runStats.uniqueIncorrect);
        el.gameover.style.display = 'flex';
        // (v0.77.0, JB4) surface the Garage immediately — refit is part of the death loop
        if (el.garagePanel) {
          el.garagePanel.style.display = 'block';
          if (el.btnGarage) el.btnGarage.textContent = 'Close garage \u25b4';
          setTimeout(renderGarage, 60);              // after the wallet banks (async load->save)
        }
      }
      // (v0.73.0, J9) The Garage — pricey persistent upgrades bought with banked cells.
      var garageProfile = null;
      function renderGarage() {
        if (!el.garagePanel) return;
        var p = garageProfile || {};
        var st = garageState(p);
        el.garagePanel.textContent = '';
        var bal = document.createElement('div'); bal.className = 'cc-gar-bal';
        bal.textContent = '\u2b21 ' + ((p.ccCells | 0)) + ' cells';
        el.garagePanel.appendChild(bal);
        st.forEach(function (it) {
          var rowEl = document.createElement('div'); rowEl.className = 'cc-gar-row' + (it.canBuy ? '' : ' locked');
          var body = document.createElement('div'); body.className = 'cc-gar-body';
          var nm = document.createElement('div'); nm.className = 'cc-gar-name';
          nm.textContent = it.name + (it.max > 1 ? ' \u00b7 ' + it.tier + '/' + it.max : (it.tier ? ' \u00b7 owned' : ''));
          var ds = document.createElement('div'); ds.className = 'cc-gar-desc'; ds.textContent = it.desc;
          body.appendChild(nm); body.appendChild(ds); rowEl.appendChild(body);
          if (it.price != null) {
            var buy = document.createElement('button'); buy.className = 'cc-btn cc-gar-buy';
            buy.textContent = '\u2b21 ' + it.price;
            buy.disabled = !it.canBuy;
            buy.addEventListener('click', function () {
              var r = garageBuy(garageProfile, it.id);
              if (r.ok) {
                if (ctx.persistence && ctx.persistence.save) ctx.persistence.save(garageProfile);
                sim.applyUpgrades(garageProfile.ccUpgrades);   // next run (and a fresh one) wears it
                renderGarage();
              }
            });
            rowEl.appendChild(buy);
          } else {
            var done = document.createElement('span'); done.className = 'cc-gar-max'; done.textContent = '\u2713 maxed';
            rowEl.appendChild(done);
          }
          el.garagePanel.appendChild(rowEl);
        });
      }

      // ---- HUD ----
      var hudCache = { shields: -1, score: -1, dist: -1, buffs: '', cells: -1 };
      function updateHud() {
        if (sim.shields !== hudCache.shields) {
          hudCache.shields = sim.shields;
          el.shieldPips.textContent = '';
          for (var i = 0; i < CONFIG.SHIELDS_MAX; i++) {
            var pip = document.createElement('span');
            pip.className = 'cc-pip' + (i < sim.shields ? ' on' : '');
            el.shieldPips.appendChild(pip);
          }
        }
        var km10 = Math.floor(sim.scoreDistance / 100);                 // 0.1 km display granularity
        if (km10 !== hudCache.score) { hudCache.score = km10; el.score.textContent = (km10 / 10).toFixed(1) + ' km'; }
        var spd = sim.boostActive ? -1 : Math.round(sim.scoreSpeed);
        if (spd !== hudCache.dist) { hudCache.dist = spd; el.dist.textContent = sim.boostActive ? 'BOOST \u26A1' : spd + ' m/s'; }
        var bOn = !!sim.boostActive;
        if (hudCache.boostOvr !== bOn) { hudCache.boostOvr = bOn; el.boostOvr.style.display = bOn ? 'flex' : 'none'; }   // (v0.103.0, C7)
        var tp = sim.turnPending ? sim.turnPending.dir : '';
        if (hudCache.turn !== tp) {
          hudCache.turn = tp;
          el.turnBanner.style.display = tp ? 'block' : 'none';
          el.turnBanner.textContent = tp === 'left' ? '\u25C0 MOVE LEFT' : tp === 'right' ? 'MOVE RIGHT \u25B6' : '';
          el.turnBanner.className = 'cc-turn-banner' + (tp ? ' on' : '');
        }
        var cl = sim.coinScore | 0;
        if (el.cells && cl !== hudCache.cells) { hudCache.cells = cl; el.cells.textContent = '\u2b21 ' + cl; }   // (J9)
        var bk = buffStr(sim.buffs);
        if (bk !== hudCache.buffs) { hudCache.buffs = bk; el.buffs.textContent = bk; }
      }

      // ---- intro cutscene (3D camera fly-in + caption beats; skippable + replayable) ----
      // Orchestrated here (no new sim phase): while active the loop freezes sim.step and only
      // renders the camera move, so the world is held still behind the captions.
      var INTRO_BEATS = [
        [0.0, 'You chased the BCM squadron into the chasm.'],
        [1.7, 'Fly below their radar \u2014 dodge the canyon walls.'],
        [3.4, 'Fly through the gates. Answer to hold your shields.']
      ];
      var INTRO_DUR = 4.8;
      var intro = { active: false, t: 0, beat: -1, dur: INTRO_DUR, rm: false, onDone: null };
      function introCaption() {
        var idx = 0;
        var sc = intro.dur / INTRO_DUR;   // #13: compress the caption schedule with the (shorter) reduced-motion duration
        for (var i = 0; i < INTRO_BEATS.length; i++) { if (intro.t >= INTRO_BEATS[i][0] * sc) idx = i; }
        if (idx === intro.beat) return;
        intro.beat = idx;
        el.introCap.textContent = INTRO_BEATS[idx][1];
        el.introCap.classList.remove('show'); void el.introCap.offsetWidth; el.introCap.classList.add('show'); // restart fade
      }
      function startIntro(onDone) {
        intro.active = true; intro.t = 0; intro.beat = -1;
        intro.onDone = onDone || null;
        intro.rm = !!settings.reducedMotion;          // #13: read here (runs post how-to, so async settings are loaded)
        intro.dur = intro.rm ? 2.2 : INTRO_DUR;       // shorter under reduced motion
        el.intro.style.display = 'flex';
        el.hud.classList.add('dim');
        if (view) view.setIntroCamera(intro.rm ? 1 : 0);   // reduced motion: hold the gameplay pose, skip the sweep
        introCaption();
      }
      function endIntro() {
        if (!intro.active) return;
        intro.active = false;
        el.intro.style.display = 'none';
        el.hud.classList.remove('dim');
        if (view) view.setIntroCamera(1);   // snap to the gameplay pose
        last = 0; acc = 0;                   // clean hand-off into the run (no time jump)
        var cb = intro.onDone; intro.onDone = null; if (cb) cb();   // #11: how-to fires here, AFTER the descent
      }
      bindBtn(el.introSkip, endIntro);
      bindBtn(el.replay, function () { if (!intro.active && sim.phase === PHASE_RUN) startIntro(); });

      var howToTimers = [];   // (Jason) staggered how-to reveal timers; cleared on Continue + on unmount
      // ---- #11 how-to card: shown once AFTER the descent cinematic (endIntro fires its onDone); Continue resumes the run.
      // Restart goes straight to the run (this is never re-shown), matching the intro. The world is
      // held frozen via pause() while the card is up (render still runs, so the descended scene shows behind it).
      function showHowTo(done) {
        pause();
        var ov = ce('div', 'cc-howto');
        var panel = ce('div', 'cc-howto-panel'); ov.appendChild(panel);
        var eyebrow = ce('div', 'cc-howto-eyebrow'); eyebrow.textContent = 'Chasm Chase'; panel.appendChild(eyebrow);
        var h = ce('div', 'cc-howto-h'); h.textContent = 'How to play'; panel.appendChild(h);
        var list = ce('div', 'cc-howto-list'); panel.appendChild(list);
        var rules = [
          ['\u2194', 'Switch lanes with \u25C0 \u25B6 (or swipe). When the canyon narrows, slide to the open side; \u25B2 jump the low rocks, \u25BC duck under the arches.'],
          ['\u271A', 'Shields are your hull. Clipping an obstacle costs a shield \u2014 lose them all and the chase ends.'],
          ['\u25C8', 'Gates span the chasm at intervals \u2014 you fly through every one, and each stops the chase for an exam question. Some gates carry a power-up.'],
          ['\u221E', 'A right answer restores a shield; a wrong one costs two. The canyon is endless \u2014 score is the distance you reach.'],
          ['\u26A1', 'SCANNER DRONE: the peach machine dragging a light-beam across the floor. JUMP the beam \u2014 never duck it, never race it sideways.']   // (v0.101.0, C2) the thing finally has a name
        ];
        // (v0.101.0, C11, Jason) your Garage loadout, visible BEFORE the run (async-load safe)
        var loadout = ce('div', 'cc-howto-loadout'); panel.appendChild(loadout);
        var ldT = setTimeout(function () {
          try {
            var gp = garageProfile, parts = [];
            if (gp && CC.garage && CC.garage.state) {
              var itemsL = CC.garage.state(gp);
              for (var li2 = 0; li2 < itemsL.length; li2++) { if (itemsL[li2].tier > 0) parts.push(itemsL[li2].name + (itemsL[li2].max > 1 ? ' Mk' + itemsL[li2].tier : '')); }
            }
            loadout.textContent = parts.length ? '\u2699 EQUIPPED: ' + parts.join(' \u00b7 ') : '\u2699 No upgrades fitted yet \u2014 bank cells, refit in the Garage after a run.';
          } catch (eLd) { loadout.textContent = ''; }
        }, 120);
        if (typeof howToTimers !== 'undefined' && howToTimers && howToTimers.push) howToTimers.push(ldT); else if (state && state.timers) state.timers.push(ldT);   // (v0.108.0, G4) tracked for teardown
        var lis = [];
        for (var i = 0; i < rules.length; i++) {
          var li = ce('div', 'cc-howto-li');
          var ic = ce('span', 'cc-howto-ic'); ic.textContent = rules[i][0]; li.appendChild(ic);
          var tx = ce('span'); tx.textContent = rules[i][1]; li.appendChild(tx);
          list.appendChild(li);
          lis.push(li);
        }
        // (Jason) reveal the rules one at a time, ~1.1 s apart; reduced motion shows them all at once.
        if (settings.reducedMotion) {
          for (var r = 0; r < lis.length; r++) lis[r].classList.add('show');
        } else {
          for (var s = 0; s < lis.length; s++) {
            (function (li, delay) { howToTimers.push(setTimeout(function () { li.classList.add('show'); }, delay)); })(lis[s], 180 + s * 1100);
          }
        }
        var btn = ce('button', 'cc-btn cc-howto-cont'); btn.textContent = 'Continue \u25B8'; panel.appendChild(btn);
        bindBtn(btn, function () {
          for (var k = 0; k < howToTimers.length; k++) clearTimeout(howToTimers[k]);
          howToTimers.length = 0;
          if (ov.parentNode) ov.parentNode.removeChild(ov); resume(); done();
        });
        el.root.appendChild(ov);
      }

      // ---- RAF / fixed timestep ----
      var raf = 0, last = 0, acc = 0, running = true;
      var MAX_STEPS = 6;
      function frame(now) {
        raf = window.requestAnimationFrame(frame);
        if (!last) last = now;
        var dt = (now - last) / 1000; last = now;
        if (dt > 0.25) dt = 0.25;                 // tab-stall clamp (no spiral)

        if (!running) {                            // HARD PAUSE (Core overlay / tab hidden / how-to / paused intro):
          // freeze the sim, the question timer, AND view animation. Hold one static frame so the canvas
          // keeps the scene without advancing. Don't touch the camera while the intro owns it.
          if (view) { if (!intro.active) view.applySpeedCamera(sim.speed, false, sim.player.x, 0); view.render(0); }
          return;
        }

        if (intro.active) {                        // cinematic: advance captions + camera, world frozen
          intro.t += dt;
          if (view) view.setIntroCamera(intro.rm ? 1 : (intro.t / intro.dur));
          introCaption();
          if (intro.t >= intro.dur) endIntro();
          if (view) view.render(Math.min(dt, 0.05));
          return;
        }

        if (sim.phase === PHASE_RUN) {
          acc += dt;
          var steps = 0;
          while (acc >= CONFIG.FIXED_DT && steps < MAX_STEPS) { sim.step(CONFIG.FIXED_DT); acc -= CONFIG.FIXED_DT; steps++; }
        } else {
          acc = 0;                                 // resume cleanly (no time jump)
        }

        // react to phase
        if (sim.phase === PHASE_QUESTION && el.overlay.style.display === 'none') showQuestion();
        // question countdown (the sim is frozen while in a question, so the loop drives the timer)
        if (sim.phase === PHASE_QUESTION) { sim.tickQuestion(Math.min(dt, 0.05)); updateQTimer(); }
        // sim auto-resolved the question without a click (timed out) -> render the feedback now.
        // (v0.81.0) ALSO when the timeout was lethal: phase jumps straight to OVER, and without
        // this the question overlay stayed up forever with dead options (full softlock).
        if ((sim.phase === PHASE_EXPLAIN || sim.phase === PHASE_OVER) && el.overlay.style.display !== 'none' && !feedbackShown && sim.lastResult) showFeedback(sim.lastResult);
        // (v0.81.0) collision deaths never reached showOver — it only ran from the See-results
        // click. Surface the crash screen from the loop; the overlay-hidden guard keeps the
        // question-death path (which routes through See results) in charge of its own timing.
        if (sim.phase === PHASE_OVER && el.gameover.style.display === 'none' && el.overlay.style.display === 'none') showOver();

        if (view) { view.applySpeedCamera(sim.speed, sim.phase === PHASE_RUN, sim.player.x, Math.min(dt, 0.05)); view.render(Math.min(dt, 0.05)); }
        updateHud();
      }
      function updateQTimer() {
        if (!sim.pending) { el.qTimer.textContent = ''; return; }
        var r = Math.max(0, Math.ceil(sim.pending.remainS));
        el.qTimer.textContent = '\u23F1 ' + r + 's';
        el.qTimer.className = (sim.pending.remainS <= 5) ? 'cc-qtimer low' : 'cc-qtimer';   // low-time cue (class, not just colour)
      }
      function pause() { running = false; acc = 0; }
      function resume() { running = true; last = 0; acc = 0; }

      raf = window.requestAnimationFrame(frame);
      startIntro(function () { showHowTo(function () {}); });   // #11: descent cinematic -> how-to card -> run (both skipped on restart)

      // restart / exit buttons
      bindBtn(el.btnRestart, function () {
        sim.reset(); el.gameover.style.display = 'none'; hudCache.shields = -1; resume();
      });
      bindBtn(el.btnGarage, function () {                    // (v0.73.0, J9) toggle the Garage
        var open = el.garagePanel.style.display !== 'none';
        el.garagePanel.style.display = open ? 'none' : 'block';
        el.btnGarage.textContent = open ? 'Garage \u25B8' : 'Close garage \u25B4';
        if (!open) renderGarage();
      });
      bindBtn(el.btnExit, function () {
        if (ctx.exit) ctx.exit();   // contract: shell injects ctx.exit in enterGame -> returns to menu
      });

      // store for unmount
      state = {
        rootEl: rootEl, el: el, sim: sim, view: view,
        pause: pause, resume: resume,
        teardown: function () {
          window.cancelAnimationFrame(raf);
          for (var i = 0; i < howToTimers.length; i++) clearTimeout(howToTimers[i]);   // (Jason) clear any pending staggered how-to reveals
          window.removeEventListener('keydown', onKey);
          window.removeEventListener('keyup', onKeyUp);
          window.removeEventListener('resize', onResize);
          document.removeEventListener('visibilitychange', onVis);
          el.canvas.removeEventListener('touchstart', onTS);
          el.canvas.removeEventListener('touchend', onTE);
          if (view) view.dispose();
          if (el.root.parentNode) el.root.parentNode.removeChild(el.root);
        }
      };
    }

    function unmount() {
      if (!state) return;
      state.teardown();
      state = null;
    }

    return {
      id: 'CC', mount: mount, unmount: unmount,
      // Surfaced for Core's pause overlay (04 / work order). Freezes sim + question timer + view
      // animation via the loop's hard-pause path, and resumes with no time jump. No-ops if unmounted.
      pause: function () { if (state && state.pause) state.pause(); },
      resume: function () { if (state && state.resume) state.resume(); },
      _sim: function () { return state && state.sim; }
    };
  }

  /* ----- small DOM/util helpers (module-only) ----- */
  function buildDom() {
    var root = ce('div', 'cc-root');
    root.innerHTML = CC_CSS;
    var canvas = ce('canvas', 'cc-canvas'); root.appendChild(canvas);
    var fallback = ce('div', 'cc-fallback'); root.appendChild(fallback);

    var hud = ce('div', 'cc-hud'); root.appendChild(hud);
    // (v0.103.0, C7, Jason) unmistakable Boost Mode: haze veil + banner; steering is locked sim-side
    var boostOvr = ce('div', 'cc-boost-ovr'); boostOvr.innerHTML = '<span>BOOST MODE</span>'; root.appendChild(boostOvr);
    var turnBanner = ce('div', 'cc-turn-banner'); root.appendChild(turnBanner);   // (v0.104.0, C4)
    var shieldWrap = ce('div', 'cc-shieldwrap'); var slabel = ce('span', 'cc-lbl'); slabel.textContent = 'Shields';
    var shieldPips = ce('div', 'cc-pips'); shieldWrap.appendChild(slabel); shieldWrap.appendChild(shieldPips); hud.appendChild(shieldWrap);
    var score = ce('div', 'cc-score'); hud.appendChild(score);
    var dist = ce('div', 'cc-dist'); hud.appendChild(dist);
    var cells = ce('div', 'cc-cells'); hud.appendChild(cells);   // (J9) this-run energy cells
    var buffs = ce('div', 'cc-buffs'); hud.appendChild(buffs);
    var replay = ce('button', 'cc-replay'); replay.textContent = '↻ intro'; hud.appendChild(replay);

    var ctrl = ce('div', 'cc-ctrl'); root.appendChild(ctrl);
    var kLeft = key('◀'), kJump = key('▲'), kDuck = key('▼'), kRight = key('▶');
    ctrl.appendChild(kLeft); ctrl.appendChild(kJump); ctrl.appendChild(kDuck); ctrl.appendChild(kRight);

    var overlay = ce('div', 'cc-overlay'); overlay.style.display = 'none'; root.appendChild(overlay);
    var qPanel = ce('div', 'cc-panel'); overlay.appendChild(qPanel);
    var qTag = ce('div', 'cc-tag'); qTag.textContent = 'Core breached — answer to hold shields'; qPanel.appendChild(qTag);
    var qTimer = ce('div', 'cc-qtimer'); qPanel.appendChild(qTimer);
    var qStem = ce('div', 'cc-stem'); qPanel.appendChild(qStem);
    var qOpts = ce('div', 'cc-opts'); qPanel.appendChild(qOpts);
    var qFeedback = ce('div', 'cc-feedback'); qPanel.appendChild(qFeedback);

    var gameover = ce('div', 'cc-gameover'); gameover.style.display = 'none'; root.appendChild(gameover);
    var ovrPanel = ce('div', 'cc-panel'); gameover.appendChild(ovrPanel);
    var ovrTitle = ce('div', 'cc-ovr-title'); ovrPanel.appendChild(ovrTitle);
    var ovrStats = ce('div', 'cc-ovr-stats'); ovrPanel.appendChild(ovrStats);
    var ovrCells = ce('div', 'cc-ovr-cells'); ovrPanel.appendChild(ovrCells);   // (J9) banked-cells line
    var garagePanel = ce('div', 'cc-garage'); garagePanel.style.display = 'none'; ovrPanel.appendChild(garagePanel);   // (J9)
    var ovrBtns = ce('div', 'cc-ovr-btns'); ovrPanel.appendChild(ovrBtns);
    var btnRestart = ce('button', 'cc-btn'); btnRestart.textContent = 'Run again'; ovrBtns.appendChild(btnRestart);
    var btnGarage = ce('button', 'cc-btn ghost'); btnGarage.textContent = 'Garage \u25B8'; ovrBtns.appendChild(btnGarage);   // (J9)
    var btnExit = ce('button', 'cc-btn ghost'); btnExit.textContent = 'Menu'; ovrBtns.appendChild(btnExit);

    // intro cutscene overlay (camera fly-in happens on the 3D layer; captions + Skip live here)
    var intro = ce('div', 'cc-intro'); intro.style.display = 'none'; root.appendChild(intro);
    var introInner = ce('div', 'cc-intro-inner'); intro.appendChild(introInner);
    var introEyebrow = ce('div', 'cc-intro-eyebrow'); introEyebrow.textContent = 'Chasm Chase'; introInner.appendChild(introEyebrow);
    var introCap = ce('div', 'cc-intro-cap'); introInner.appendChild(introCap);
    var introSkip = ce('button', 'cc-intro-skip'); introSkip.textContent = 'Skip \u25B8'; intro.appendChild(introSkip);

    return { root: root, canvas: canvas, fallback: fallback, hud: hud, shieldPips: shieldPips, score: score, dist: dist, buffs: buffs,
      kLeft: kLeft, kRight: kRight, kJump: kJump, kDuck: kDuck, replay: replay,
      overlay: overlay, qStem: qStem, qOpts: qOpts, qFeedback: qFeedback, qTimer: qTimer, cells: cells, boostOvr: boostOvr, turnBanner: turnBanner,
      intro: intro, introCap: introCap, introEyebrow: introEyebrow, introSkip: introSkip,
      gameover: gameover, ovrTitle: ovrTitle, ovrStats: ovrStats, ovrCells: ovrCells, garagePanel: garagePanel, btnGarage: btnGarage, btnRestart: btnRestart, btnExit: btnExit };
  }
  function ce(tag, cls) { var e = document.createElement(tag); if (cls) e.className = cls; return e; }
  function key(label) { var k = ce('button', 'cc-key'); k.textContent = label; return k; }
  function bindBtn(b, fn) { b.addEventListener('click', function (e) { e.preventDefault(); fn(); }); }
  // (Jason) press-and-hold binding for the jump button (mouse + touch, via pointer events); release on up / leave / cancel.
  function bindHold(b, press, release) {
    b.addEventListener('pointerdown', function (e) { e.preventDefault(); press(); });
    b.addEventListener('pointerup', function (e) { e.preventDefault(); release(); });
    b.addEventListener('pointerleave', function () { release(); });
    b.addEventListener('pointercancel', function () { release(); });
  }
  function flashKey(k) { if (!k) return; k.classList.add('hit'); setTimeout(function () { k.classList.remove('hit'); }, 90); }
  function debounce(fn, ms) { var t; return function () { clearTimeout(t); t = setTimeout(fn, ms); }; }
  function row(k, v) { return '<div class="cc-row"><span>' + k + '</span><b>' + v + '</b></div>'; }
  function buffStr(b) {
    var s = '';
    if (b.magnet > 0) s += '🧲' + Math.ceil(b.magnet) + ' ';
    if (b.invincible > 0) s += '★' + Math.ceil(b.invincible) + ' ';
    if (b.coinX2 > 0) s += '×2 ' + Math.ceil(b.coinX2) + ' ';
    if (b.slowmo > 0) s += '⏱' + Math.ceil(b.slowmo) + ' ';
    return s.trim();
  }

  // fallback deterministic rng (mulberry32) if ctx.rng absent
  function makeFallbackRng(seed) {
    var s = (typeof seed === 'string') ? hashStr(seed) : (seed >>> 0) || 1;
    function next() { s |= 0; s = (s + 0x6D2B79F5) | 0; var t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
    return {
      next: next,
      int: function (m) { return Math.floor(next() * m); },
      pick: function (a) { return a[Math.floor(next() * a.length)]; },
      shuffle: function (a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(next() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; },
      fork: function (salt) { return makeFallbackRng((s ^ hashStr(String(salt))) >>> 0); }
    };
  }
  function hashStr(str) { var h = 2166136261 >>> 0; for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

  var CC_CSS = '<style>' +
    '.cc-root{position:absolute;inset:0;overflow:hidden;font-family:Montserrat,Arial,sans-serif;color:#F2F2F7;background:radial-gradient(120% 100% at 50% -10%,#15152a 0%,#0a0a16 55%,#05050b 100%);}' +
    '.cc-canvas{position:absolute;inset:0;width:100%;height:100%;display:block;}' +
    '.cc-fallback{position:absolute;inset:0;display:none;align-items:center;justify-content:center;text-align:center;padding:24px;color:#AC9BFD;font-size:14px;}' +
    '.cc-hud{position:absolute;top:12px;left:12px;right:12px;display:flex;gap:14px;align-items:center;z-index:5;pointer-events:none;flex-wrap:wrap;}' +
    '.cc-shieldwrap{display:flex;flex-direction:column;gap:3px;}' +
    '.cc-lbl{font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#9a9aad;}' +
    '.cc-pips{display:flex;gap:5px;}' +
    '.cc-pip{width:16px;height:8px;border-radius:3px;border:1px solid #34344a;background:transparent;}' +
    '.cc-pip.on{background:linear-gradient(90deg,#1FDDE9,#19a9b3);border-color:#1FDDE9;box-shadow:0 0 8px rgba(31,221,233,.6);}' +
    '.cc-score{font-size:22px;font-weight:800;color:#FFC857;text-shadow:0 0 10px rgba(255,200,87,.4);margin-left:auto;}' +
    '.cc-dist{font-size:13px;color:#9a9aad;}' +
    '.cc-buffs{font-size:13px;color:#92DD23;min-width:30px;}' +
    '.cc-ctrl{position:absolute;bottom:18px;left:50%;transform:translateX(-50%);display:flex;gap:10px;z-index:5;}' +
    '.cc-key{width:56px;height:56px;border-radius:14px;background:rgba(28,28,40,.5);border:1.5px solid #7855FA;color:#AC9BFD;font-size:20px;display:flex;align-items:center;justify-content:center;cursor:pointer;touch-action:none;backdrop-filter:blur(4px);transition:transform .05s,background .1s;}' +
    '.cc-key.hit{background:rgba(120,85,250,.35);transform:scale(.92);}' +
    '.cc-overlay,.cc-gameover{position:absolute;inset:0;display:none;align-items:center;justify-content:center;z-index:8;background:rgba(5,5,11,.78);backdrop-filter:blur(3px);}' +
    '.cc-panel{width:min(560px,92vw);max-height:88vh;overflow:auto;background:rgba(20,20,29,.96);border:1px solid #34344a;border-radius:18px;padding:22px;box-shadow:0 0 40px rgba(120,85,250,.25);}' +
    '.cc-tag{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#1FDDE9;margin-bottom:10px;}' +
    '.cc-qtimer{font-size:13px;font-weight:700;color:#92DD23;margin-bottom:8px;letter-spacing:.04em;}' +
    '.cc-qtimer.low{color:#FF6B5B;}' +
    '.cc-stem{font-size:17px;font-weight:600;line-height:1.4;margin-bottom:16px;}' +
    '.cc-opts{display:flex;flex-direction:column;gap:9px;}' +
    '.cc-opt{text-align:left;padding:12px 14px;border-radius:11px;border:1.5px solid #34344a;background:rgba(28,28,40,.6);color:#F2F2F7;font-size:14px;font-family:inherit;cursor:pointer;transition:border-color .1s,background .1s;}' +
    '.cc-opt:hover{border-color:#7855FA;background:rgba(120,85,250,.12);}' +
    '.cc-opt.correct{border-color:#92DD23;background:rgba(146,221,35,.18);}' +
    '.cc-opt.wrong{border-color:#FF6B5B;background:rgba(255,107,91,.18);}' +
    '.cc-opt.sel{border-color:#1FDDE9;background:rgba(31,221,233,.16);}' +
    '.cc-multi-hint{font-size:12px;color:#1FDDE9;margin:4px 2px 2px;letter-spacing:.02em;}' +
    '.cc-submit{margin-top:10px;width:100%;}' +
    '.cc-submit:disabled{opacity:.4;cursor:not-allowed;}' +
    '.cc-feedback{display:none;margin-top:16px;}' +
    '.cc-fb-head{font-weight:700;font-size:15px;margin-bottom:8px;}' +
    '.cc-fb-head.ok{color:#92DD23;}.cc-fb-head.no{color:#FF6B5B;}' +
    '.cc-fb-note{margin:0 0 10px;padding:6px 9px;border-left:2px solid #FF6B5B;background:rgba(255,107,91,.08);font-size:12.5px;color:#c9c9d6;border-radius:0 8px 8px 0;}' +
    '.cc-fb-exp{font-size:13.5px;line-height:1.5;color:#c9c9d6;margin-bottom:14px;}' +
    '.cc-cont,.cc-btn{padding:11px 20px;border-radius:11px;border:none;background:linear-gradient(90deg,#7855FA,#6D40E6);color:#fff;font-weight:700;font-family:inherit;font-size:14px;cursor:pointer;}' +
    '.cc-btn.ghost{background:transparent;border:1.5px solid #34344a;color:#AC9BFD;}' +
    '.cc-ovr-title{font-size:24px;font-weight:800;margin-bottom:14px;}' +
    '.cc-row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #23232f;font-size:14px;}' +
    '.cc-row b{color:#FFC857;}' +
    '.cc-ovr-btns{display:flex;gap:10px;margin-top:18px;}' +
    '.cc-cells{font-size:13px;color:#1FDDE9;font-weight:700;}' +
    '.cc-ovr-cells{margin:6px 0 2px;color:#1FDDE9;font-size:14px;font-weight:700;}' +
    '.cc-garage{margin:10px 0 4px;text-align:left;display:flex;flex-direction:column;gap:7px;}' +
    '.cc-gar-bal{color:#1FDDE9;font-weight:800;font-size:14px;margin-bottom:2px;}' +
    '.cc-gar-row{display:flex;align-items:center;gap:10px;border:1px solid #34344a;border-radius:10px;padding:8px 10px;background:rgba(10,10,18,.55);}' +
    '.cc-gar-row.locked{opacity:.55;}' +
    '.cc-gar-body{flex:1;min-width:0;}' +
    '.cc-gar-name{font-size:13px;font-weight:700;color:#F2F2F7;}' +
    '.cc-gar-desc{font-size:11.5px;color:#9a9aad;}' +
    '.cc-gar-buy{flex:none;padding:6px 12px;}' +
    '.cc-gar-max{flex:none;color:#92DD23;font-weight:700;font-size:12px;}' +
    '.cc-fb-more{margin-top:7px;}.cc-fb-more summary{cursor:pointer;color:#1FDDE9;font-size:12.5px;font-weight:600;}.cc-fb-more div{margin-top:5px;}' +
    '.cc-replay{pointer-events:auto;position:absolute;top:44px;right:0;padding:5px 11px;border-radius:9px;border:1px solid #34344a;background:rgba(20,20,29,.55);color:#9a9aad;font-family:inherit;font-size:11px;cursor:pointer;backdrop-filter:blur(3px);}' +   /* (P2·3, PLAYTEST A4) own row below the readout — no km/speed collision */
    '.cc-replay:hover{border-color:#7855FA;color:#AC9BFD;}' +
    '.cc-hud{transition:opacity .3s;}.cc-hud.dim{opacity:0;}' +
    '.cc-intro{position:absolute;inset:0;flex-direction:column;align-items:center;justify-content:center;z-index:9;background:linear-gradient(180deg,rgba(5,5,11,.18),rgba(5,5,11,.5));pointer-events:auto;}' +
    '.cc-intro-inner{text-align:center;padding:0 28px;max-width:700px;}' +
    '.cc-intro-eyebrow{font-size:12px;letter-spacing:.34em;text-transform:uppercase;color:#1FDDE9;margin-bottom:16px;text-shadow:0 0 14px rgba(31,221,233,.55);}' +
    '.cc-intro-cap{font-size:clamp(18px,3.4vw,28px);font-weight:700;line-height:1.42;color:#F2F2F7;min-height:2.7em;opacity:0;transform:translateY(9px);text-shadow:0 2px 20px rgba(0,0,0,.75);}' +
    '.cc-intro-cap.show{animation:ccCapIn .5s ease forwards;}' +
    '@keyframes ccCapIn{to{opacity:1;transform:translateY(0);}}' +
    '.cc-intro-skip{position:absolute;bottom:22px;right:22px;padding:9px 18px;border-radius:11px;border:1.5px solid #34344a;background:rgba(20,20,29,.72);color:#AC9BFD;font-weight:700;font-family:inherit;font-size:13px;cursor:pointer;backdrop-filter:blur(4px);}' +
    '.cc-intro-skip:hover{border-color:#7855FA;color:#fff;}' +
    '.cc-howto{position:absolute;inset:0;z-index:14;display:flex;align-items:center;justify-content:center;padding:18px;background:rgba(5,5,11,.84);backdrop-filter:blur(4px);pointer-events:auto;}' +
    '.cc-howto-panel{width:min(460px,94%);background:rgba(20,20,29,.97);border:1px solid #34344a;border-radius:16px;padding:22px;box-shadow:0 0 40px rgba(120,85,250,.28);}' +
    '.cc-howto-eyebrow{font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:#1FDDE9;margin-bottom:6px;}' +
    '.cc-turn-banner{position:absolute;top:38%;left:50%;transform:translateX(-50%);display:none;font-size:26px;font-weight:800;letter-spacing:.22em;color:#FFC857;text-shadow:0 0 18px rgba(255,200,87,.8);pointer-events:none;z-index:12;animation:ccTurnFlash 0.4s step-end infinite;}' +
    '@keyframes ccTurnFlash{0%{opacity:1;}50%{opacity:.45;}}' +
    '@media (prefers-reduced-motion: reduce){.cc-turn-banner{animation:none;}}' +
    '.cc-boost-ovr{position:absolute;inset:0;display:none;align-items:center;justify-content:center;pointer-events:none;z-index:7;background:radial-gradient(ellipse at center, rgba(31,221,233,.06) 30%, rgba(31,221,233,.18) 100%);backdrop-filter:blur(1.5px);}' +
    '.cc-boost-ovr span{font-size:34px;font-weight:800;letter-spacing:.3em;color:#1FDDE9;text-shadow:0 0 24px rgba(31,221,233,.8);animation:ccBoostPulse 0.5s ease-in-out infinite alternate;}' +
    '@keyframes ccBoostPulse{from{opacity:.75;}to{opacity:1;}}' +
    '@media (prefers-reduced-motion: reduce){.cc-boost-ovr{backdrop-filter:none;}.cc-boost-ovr span{animation:none;}}' +
    '.cc-howto-loadout{margin:8px 0 2px;padding:6px 9px;border:1px solid rgba(255,200,87,.35);border-radius:8px;font-size:12px;color:#FFC857;background:rgba(255,200,87,.07);}' +
    '.cc-howto-h{font-size:21px;font-weight:800;color:#F2F2F7;margin-bottom:14px;}' +
    '.cc-howto-list{display:flex;flex-direction:column;gap:11px;margin-bottom:18px;}' +
    '.cc-howto-li{display:flex;gap:11px;align-items:flex-start;font-size:13.5px;line-height:1.45;color:#c9c9d6;opacity:0;transform:translateY(7px);transition:opacity .55s ease,transform .55s ease;}' +
    '.cc-howto-li.show{opacity:1;transform:none;}' +
    '.cc-howto-ic{flex:none;width:24px;height:24px;border-radius:7px;display:flex;align-items:center;justify-content:center;background:rgba(120,85,250,.16);border:1px solid #7855FA;color:#AC9BFD;font-size:13px;}' +
    '.cc-howto-cont{width:100%;}' +
    '</style>';

  // (v0.73.0, J9) The Garage — pure catalog + purchase math (DOM-free, harness-pinned).
  // Pricey by design (Jason): multi-run saves. Wallet: profile.ccCells; tiers: profile.ccUpgrades.
  var GARAGE_ITEMS = [
    // (v0.101.0, C12, Jason) value-1 coins + prices tuned a notch ABOVE the /10 line so a
    // full build takes several runs — no more buying everything at once.
    { id: 'hull',    name: 'Reinforced hull',   desc: '+1 starting shield per tier.',          tiers: [50, 120] },
    { id: 'boost',   name: 'Overcharged boost', desc: 'Boost covers +50% distance.',           tiers: [75] },
    { id: 'magnet',  name: 'Cell magnet',       desc: 'Cells drift toward you, always.',       tiers: [60] },
    { id: 'plating', name: 'Ablative plating',  desc: 'First crash each run costs no shield.', tiers: [100] }
  ];
  function garageState(profile) {
    var up = (profile && profile.ccUpgrades) || {};
    var cells = (profile && profile.ccCells) | 0;
    return GARAGE_ITEMS.map(function (it) {
      var tier = up[it.id] | 0;
      var next = tier < it.tiers.length ? it.tiers[tier] : null;
      return { id: it.id, name: it.name, desc: it.desc, tier: tier, max: it.tiers.length, price: next, canBuy: next != null && cells >= next };
    });
  }
  function garageBuy(profile, id) {
    if (!profile) return { ok: false, reason: 'no-profile' };
    var it = null;
    for (var i = 0; i < GARAGE_ITEMS.length; i++) if (GARAGE_ITEMS[i].id === id) it = GARAGE_ITEMS[i];
    if (!it) return { ok: false, reason: 'unknown' };
    var up = profile.ccUpgrades || (profile.ccUpgrades = {});
    var tier = up[id] | 0;
    if (tier >= it.tiers.length) return { ok: false, reason: 'maxed' };
    var price = it.tiers[tier];
    if ((profile.ccCells | 0) < price) return { ok: false, reason: 'cells' };
    profile.ccCells = (profile.ccCells | 0) - price;
    up[id] = tier + 1;
    return { ok: true, price: price, tier: tier + 1 };
  }

  return { CCSim: CCSim, CCView: CCView, createCCModule: createCCModule, CONFIG: CONFIG,
    _enums: { OB_NARROW: OB_NARROW, OB_LOWROCK: OB_LOWROCK, OB_ARCH: OB_ARCH, OB_SWEEP: OB_SWEEP, SIDE_LEFT: SIDE_LEFT, SIDE_RIGHT: SIDE_RIGHT, POWER_KINDS: POWER_KINDS },
    garage: { ITEMS: GARAGE_ITEMS, state: garageState, buy: garageBuy },
    makeFallbackRng: makeFallbackRng };
});
