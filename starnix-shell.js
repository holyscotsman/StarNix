/* =====================================================================
 * StarNix — shell  (starnix-shell.js)
 * boot -> title -> shared cinematic (skippable) -> menu
 *      -> mount/unmount one game -> back to menu.  (01 §9)
 *
 * Depends on starnix-core.js (window.StarNix.core, initCore, makeContext,
 * registerGame/getGame). Defines window.StarNix.shell and window.StarNix.boot.
 *
 * Strict unmount lifecycle: leaving a game calls module.unmount() (the game
 * frees its own RAF/listeners/pools) and the shell removes the game root.
 * The shell tracks ALL its own listeners + RAF so destroy() leaves no residue.
 * ===================================================================== */
(function (global) {
  "use strict";

  var StarNix = global.StarNix;
  if (!StarNix) throw new Error("starnix-shell.js: load starnix-core.js first");

  var GAME_META = {
    ARM: { title: "Acropolis Rescue Mission", tag: "2D flight + collect", accent: "iris", track: "arm",
      blurb: "Gather scattered station cores, answer to install them, rebuild the MCI Station." },
    KBB: { title: "Kuiper Belt Battle", tag: "roguelike", accent: "peach", track: "kbb",
      blurb: "Hunt the BCM warship through escalating fights. Answer to attack; build artifact combos." },
    CC: { title: "Chasm Chase", tag: "3D endless runner", accent: "aqua", track: "cc",
      blurb: "Chase the BCM squadron down the chasm. Dodge, collect cores, answer to hold your shields." },
    NIT: { title: "Nutanix Interrogation Test", tag: "practice exam", accent: "gold", track: "exam",
      blurb: "No rescue op \u2014 the real exam. Face the live question bank one at a time against the clock; 80% to certify." }
  };

  function Shell() {
    this.root = null;
    this.stage = null;          // persistent container inside root
    this.screen = "boot";
    this.currentModule = null;
    this.currentGameRoot = null;
    this.lastGameId = null;
    this.cinematicPlayed = false;
    this._shellListeners = [];  // live for the whole session
    this._screenListeners = []; // cleared on every screen change
    this._raf = 0;              // cinematic RAF handle
    this._audioUnlocked = false;
  }

  Shell.prototype._on = function (target, type, fn, opts, bag) {
    target.addEventListener(type, fn, opts || false);
    (bag || this._screenListeners).push({ target: target, type: type, fn: fn, opts: opts || false });
  };
  Shell.prototype._clear = function (bag) {
    for (var i = 0; i < bag.length; i++) {
      var l = bag[i];
      l.target.removeEventListener(l.type, l.fn, l.opts);
    }
    bag.length = 0;
  };
  Shell.prototype._cancelRaf = function () {
    if (this._raf) { global.cancelAnimationFrame(this._raf); this._raf = 0; }
  };
  Shell.prototype._clearScreen = function () {
    this._cancelRaf();
    if (this._exam && this._exam.teardown) { try { this._exam.teardown(); } catch (e) {} this._exam = null; }
    this._clear(this._screenListeners);
    if (this.stage) this.stage.textContent = "";
  };

  /* ---- audio unlock on first gesture --------------------------------- */
  Shell.prototype._wireAudioUnlock = function () {
    var self = this;
    var unlock = function () {
      if (self._audioUnlocked) return;
      self._audioUnlocked = true;
      try { StarNix.core.audio.ensure(); } catch (e) {}
      var s = StarNix.core.profile ? StarNix.core.profile.settings : null;
      if (s) {
        try {
          var au = StarNix.core.audio;
          if (au.setMasterVolume) au.setMasterVolume(s.masterVol == null ? 1 : s.masterVol);
          if (au.setMusicVolume) au.setMusicVolume(s.musicVol == null ? 1 : s.musicVol);
          if (au.setSfxVolume) au.setSfxVolume(s.sfxVol == null ? 1 : s.sfxVol);
          if (au.setMusicGenre) au.setMusicGenre(s.musicGenre === "chill" ? "chill" : "upbeat");   // (v0.49.0)
          au.setMusic(!!s.music); au.setSfx(!!s.sfx);
        } catch (e) {}
      }
    };
    this._on(this.root, "pointerdown", unlock, false, this._shellListeners);
    this._on(this.root, "keydown", unlock, false, this._shellListeners);
  };

  /* ---- DOM helpers (static skeletons via innerHTML; dynamic via text) - */
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  /* Original neon "NX" wireframe-X motif, drawn in code (not the official mark). */
  var NX_TILE =
    '<svg xmlns="http://www.w3.org/2000/svg" width="84" height="84" viewBox="0 0 84 84">' +
    '<g fill="none" stroke-width="1.25">' +
    '<path d="M16 16 L68 68 M68 16 L16 68" stroke="#AC9BFD" stroke-opacity="0.55"/>' +
    '<rect x="34" y="34" width="16" height="16" transform="rotate(45 42 42)" stroke="#1FDDE9" stroke-opacity="0.5"/>' +
    '<path d="M42 7 L42 19 M42 65 L42 77 M7 42 L19 42 M65 42 L77 42" stroke="#AC9BFD" stroke-opacity="0.3"/>' +
    '</g></svg>';
  function nxTileUrl() { return 'url("data:image/svg+xml;utf8,' + encodeURIComponent(NX_TILE) + '")'; }
  var NX_CREST =
    '<svg class="sx-crest-x" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke-width="1.6">' +
    '<path d="M5 5 L19 19 M19 5 L5 19" stroke="#AC9BFD"/>' +
    '<rect x="9.5" y="9.5" width="5" height="5" transform="rotate(45 12 12)" stroke="#1FDDE9"/></svg>';

  /* =================================================================== *
   * boot
   * =================================================================== */
  Shell.prototype.boot = function (root, opts) {
    var self = this;
    this.root = (typeof root === "string") ? document.getElementById(root) : root;
    if (!this.root) throw new Error("boot: root element not found");
    // shell-owned scaffold
    this.root.classList.add("starnix-shell");
    this.stage = el("div", "sx-stage");
    this.root.appendChild(this.stage);
    // Persistent build-version badge (lives on root, not stage, so it survives screen swaps and
    // stays visible inside every game). Non-interactive. Tells us which build is being tested.
    var label = (StarNix && StarNix.BUILD_LABEL) || "";
    if (label) {
      this.buildBadge = el("div", "sx-build-badge", label);
      this.buildBadge.setAttribute("aria-hidden", "true");
      this.root.appendChild(this.buildBadge);
    }
    this._injectShellCSS();
    this._wireAudioUnlock();
    return StarNix.initCore(opts || {}).then(function () {
      self._applyContrast();        // #12: apply saved high-contrast preference on load
      // v0.53.0 unit 3: achievement unlock toasts. Registered once at boot; fires from the
      // core evaluator wherever the unlock happens — the toast overlays the stage, so it
      // shows mid-game too. Reward styling (gold), no animation beyond the toast itself.
      if (StarNix.achievements) {
        StarNix.achievements.onUnlock(function (defs) {
          for (var i = 0; i < defs.length; i++) {
            self._toast(defs[i].icon + " Achievement: " + defs[i].name + " (+" + defs[i].xp + " XP)", "sx-toast-gold");
          }
        });
      }
      self.showTitle();
      return self;
    });
  };

  /* High-contrast / low-vision mode (#12). The HC palette lives in the theme CSS
   * (core themeCSS) keyed on <html data-contrast="high">; this just flips the attribute
   * from the persisted `colorblind` setting. Stored key stays `colorblind` for profile compat. */
  Shell.prototype._applyContrast = function () {
    try {
      var p = StarNix.core && StarNix.core.profile;
      var on = !!(p && p.settings && p.settings.colorblind);
      var doc = (this.root && this.root.ownerDocument) || document;
      if (on) doc.documentElement.setAttribute("data-contrast", "high");
      else doc.documentElement.removeAttribute("data-contrast");
    } catch (e) {}
  };

  /* =================================================================== *
   * title
   * =================================================================== */
  Shell.prototype.showTitle = function () {
    this._clearScreen();
    this.screen = "title";
    var s = el("div", "sx-screen sx-title");
    // Official Nutanix wordmark (white SVG), title screen ONLY, unaltered (07 §3).
    s.innerHTML =
      '<div class="sx-title-photo" aria-hidden="true"></div>' +
      '<img class="sx-wordmark-img" alt="Nutanix" src="' + ((global.STARNIX_ASSETS && global.STARNIX_ASSETS.wordmark) || '') + '">' +
      '<h1 class="sx-h1">StarNix</h1>' +
      '<div class="sx-sub">NCP-MCI · Starlight Rescue Crew</div>' +
      '<div class="sx-row"></div>';
    var tphoto = s.querySelector(".sx-title-photo");
    var neb = global.STARNIX_ASSETS && global.STARNIX_ASSETS.nebulaBg;
    if (tphoto && neb) { tphoto.style.backgroundImage = 'url("' + neb + '")'; tphoto.classList.add("on"); }
    var row = s.querySelector(".sx-row");
    var start = el("button", "sx-btn sx-btn-iris", "Start");
    var self = this;
    this._on(start, "click", function () {
      try { StarNix.core.audio.playTrack("cinematic"); } catch (e) {}
      self.showCinematic();
    });
    row.appendChild(start);
    this.stage.appendChild(s);
  };

  /* =================================================================== *
   * shared cinematic (cold open, skippable)  (00 §2)
   * One RAF; pre-allocated buffers (no per-frame allocation, 01 §13).
   * Beats: station intact -> Disruptor beam + shatter -> warp to Kuiper
   *        belt -> squadron descends to planet.
   * =================================================================== */
  Shell.prototype.showCinematic = function () {
    this._clearScreen();
    this.screen = "cinematic";
    var self = this;
    var reduced = !!(StarNix.core.profile && StarNix.core.profile.settings.reducedMotion);

    var wrap = el("div", "sx-screen sx-cine");
    var canvas = el("canvas", "sx-cine-canvas");
    var cap = el("div", "sx-cap");
    var skip = el("button", "sx-skip", "Skip \u25B6");
    // finale mission panel (DOM = crisp + accessible); hidden until last beat
    var mission = el("div", "sx-mission");
    mission.innerHTML =
      '<div class="sx-mission-eyebrow">Nutanix Starlight Rescue Crew \u00B7 NX-SRC</div>' +
      '<h2 class="sx-mission-title">Your mission</h2>' +
      '<ul class="sx-mission-list">' +
        '<li><b>Rebuild</b> the MCI Station <span>\u2014 Acropolis Rescue</span></li>' +
        '<li><b>Capture</b> the escaped squadron <span>\u2014 Chasm Chase</span></li>' +
        '<li><b>Defeat</b> the BCM warship in the Kuiper Belt <span>\u2014 Kuiper Belt Battle</span></li>' +
      '</ul>';
    mission.style.opacity = "0";
    wrap.appendChild(canvas); wrap.appendChild(cap); wrap.appendChild(mission); wrap.appendChild(skip);
    this.stage.appendChild(wrap);

    var ctx = canvas.getContext("2d");
    var dpr = Math.min(global.devicePixelRatio || 1, 2);
    var W = 0, H = 0, cx = 0, cy = 0, scale = 1;
    function sizeCanvas() {
      W = wrap.clientWidth || 800; H = wrap.clientHeight || 600;
      canvas.width = W * dpr; canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cx = W / 2; cy = H * 0.46;                       // action sits slightly above middle
      scale = Math.max(0.7, Math.min(W, H) / 720);     // readable + centered on big monitors
    }
    sizeCanvas();

    var rng = StarNix.core.makeRng("cine-v2");

    // -------- pre-allocated buffers (no per-frame allocation, 01 §13) --------
    var STAR_N = 110, stars = new Array(STAR_N);
    for (var i = 0; i < STAR_N; i++) stars[i] = { x: rng.next(), y: rng.next(), s: 0.4 + rng.next() * 1.5, a: 0.18 + rng.next() * 0.6 };

    function hexPts(r) { var a = []; for (var p = 0; p < 6; p++) { var an = (p / 6) * Math.PI * 2 - Math.PI / 2; a.push([Math.cos(an) * r, Math.sin(an) * r]); } return a; }
    function buildStation() {
      return [
        { pts: [[-78, -3], [-46, -3], [-46, 3], [-78, 3]], fill: "#1FDDE9", stroke: "#1FDDE9" },              // left panel arm
        { pts: [[46, -3], [78, -3], [78, 3], [46, 3]], fill: "#1FDDE9", stroke: "#1FDDE9" },                  // right panel arm
        { pts: [[-104, -17], [-78, -17], [-78, 17], [-104, 17]], fill: "rgba(31,221,233,0.16)", stroke: "#1FDDE9" }, // left panel
        { pts: [[78, -17], [104, -17], [104, 17], [78, 17]], fill: "rgba(31,221,233,0.16)", stroke: "#1FDDE9" },     // right panel
        { pts: [[-46, -11], [-30, -11], [-30, 11], [-46, 11]], fill: "#1d1d4a", stroke: "#7855FA" },          // left module
        { pts: [[30, -11], [46, -11], [46, 11], [30, 11]], fill: "#1d1d4a", stroke: "#7855FA" },              // right module
        { pts: hexPts(27), fill: "#2a2566", stroke: "#AC9BFD", glow: "#7855FA", lw: 2 }                       // hub
      ];
    }
    var STATION = buildStation();
    var WARSHIP = [[28, 0], [20, -4], [-6, -9], [-26, 0], [-6, 9], [20, 4]];     // dart, nose at +x

    var SHARD_N = 46, shards = new Array(SHARD_N);
    for (var s2 = 0; s2 < SHARD_N; s2++) { var sa = rng.next() * Math.PI * 2, sp = 60 + rng.next() * 240; shards[s2] = { vx: Math.cos(sa) * sp, vy: Math.sin(sa) * sp, rot: rng.next() * 6.28, spin: (rng.next() - 0.5) * 7, sz: 3 + rng.next() * 7, hue: rng.next() }; }
    var CORE_N = 12, cores = new Array(CORE_N);
    for (var c2 = 0; c2 < CORE_N; c2++) { var cca = (c2 / CORE_N) * Math.PI * 2 + rng.next() * 0.4, ccs = 70 + rng.next() * 150; cores[c2] = { vx: Math.cos(cca) * ccs, vy: Math.sin(cca) * ccs, rot: rng.next() * 6.28, spin: (rng.next() - 0.5) * 4, col: (c2 % 2 ? "#1FDDE9" : "#FFC857") }; }
    var ROCK_N = 16, rocks = new Array(ROCK_N);
    for (var r2 = 0; r2 < ROCK_N; r2++) rocks[r2] = { x: rng.next(), y: 0.16 + rng.next() * 0.66, z: 0.4 + rng.next() * 1.2, rot: rng.next() * 6.28, spin: (rng.next() - 0.5) * 1.5, sz: 6 + rng.next() * 15, sides: 5 + (rng.next() * 3 | 0) };
    var SQ_N = 5, squad = new Array(SQ_N);
    for (var q2 = 0; q2 < SQ_N; q2++) squad[q2] = { dx: (q2 - (SQ_N - 1) / 2) * 26, ph: rng.next() * 6.28 };

    var planetImg = null, planetReady = false;
    try { var psrc = (global.STARNIX_ASSETS && global.STARNIX_ASSETS.planet) || ""; if (psrc) { planetImg = new Image(); planetImg.onload = function () { planetReady = true; }; planetImg.src = psrc; } } catch (e) {}

    // -------- beat timeline (seconds): station | beam | shatter | belt | planet | mission --------
    var B = reduced
      ? { station: 0.0, beam: 1.6, shatter: 2.8, belt: 4.0, planet: 5.2, mission: 6.4, end: 9.4 }
      : { station: 0.0, beam: 3.4, shatter: 6.4, belt: 9.2, planet: 12.0, mission: 14.8, end: 18.4 };
    var CAPS = [
      [B.station, "The MCI Station held every concept you need to pass."],
      [B.beam, "Then the Broad Communication Military fired the Microsegmentation Disruptor."],
      [B.shatter, "The station shattered into knowledge cores."],
      [B.belt, "The BCM warship jumped to the Kuiper Belt."],
      [B.planet, "A BCM squadron broke off toward the planet below."],
      [B.mission, ""]
    ];
    function caption(t) { var c = ""; for (var k = 0; k < CAPS.length; k++) { if (t >= CAPS[k][0]) c = CAPS[k][1]; } return c; }

    // -------- draw helpers (no per-frame allocation) --------
    function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
    function lerp(a, b, t) { return a + (b - a) * t; }
    function easeOut(t) { return 1 - (1 - t) * (1 - t); }
    function drawPolyPts(pts, fill, stroke, glow, lw) {
      ctx.beginPath();
      for (var p = 0; p < pts.length; p++) { var v = pts[p]; if (p === 0) ctx.moveTo(v[0], v[1]); else ctx.lineTo(v[0], v[1]); }
      ctx.closePath();
      if (glow && !reduced) { ctx.shadowColor = glow; ctx.shadowBlur = 12; }
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 1.5; ctx.stroke(); }
      ctx.shadowBlur = 0;
    }
    function regPoly(x, y, r, sides, rot) { ctx.beginPath(); for (var p = 0; p < sides; p++) { var an = rot + (p / sides) * Math.PI * 2; var px = x + Math.cos(an) * r, py = y + Math.sin(an) * r; if (p === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); } ctx.closePath(); }

    function drawStation(alpha, sx, sy) {
      ctx.save(); ctx.translate(cx + (sx || 0), cy + (sy || 0)); ctx.rotate(T * 0.16); ctx.scale(scale, scale); ctx.globalAlpha = alpha;
      for (var p = 0; p < STATION.length; p++) { var pg = STATION[p]; drawPolyPts(pg.pts, pg.fill, pg.stroke, pg.glow, pg.lw); }
      ctx.restore(); ctx.globalAlpha = 1;
    }
    function drawWarBeam(bk) {
      var enter = easeOut(clamp(bk / 1.0, 0, 1));
      var wsx = lerp(W + 90, cx + 160 * scale, enter), wsy = cy, sc = scale * 1.1, noseX = wsx - 30 * sc;
      var shake = (bk >= 2.0 && !reduced) ? (rng.next() - 0.5) * 6 : 0;
      drawStation(1, shake, shake * 0.6);
      if (bk >= 1.0) { var ch = clamp((bk - 1.0) / 1.0, 0, 1); ctx.save(); ctx.fillStyle = "#FF6B5B"; if (!reduced) { ctx.shadowColor = "#FF6B5B"; ctx.shadowBlur = 18; } ctx.beginPath(); ctx.arc(noseX, wsy, 3 + ch * 8, 0, 6.283); ctx.fill(); ctx.restore(); ctx.shadowBlur = 0; }
      if (bk >= 2.0) {
        var fk = clamp((bk - 2.0) / 1.0, 0, 1);
        ctx.save(); ctx.strokeStyle = "#FF6B5B"; if (!reduced) { ctx.shadowColor = "#FF6B5B"; ctx.shadowBlur = 20; }
        ctx.lineWidth = reduced ? 3 : (3 + Math.sin(T * 40) * 2 + fk * 3); ctx.globalAlpha = 0.9;
        ctx.beginPath(); ctx.moveTo(noseX, wsy); ctx.lineTo(cx, cy); ctx.stroke(); ctx.restore(); ctx.globalAlpha = 1; ctx.shadowBlur = 0;
        if (!reduced) { ctx.fillStyle = "rgba(255,107,91," + (0.05 + fk * 0.12) + ")"; ctx.fillRect(0, 0, W, H); }
      }
      ctx.save(); ctx.translate(wsx, wsy); ctx.scale(-sc, sc);
      if (!reduced) { ctx.shadowColor = "#FF6B5B"; ctx.shadowBlur = 10; }
      drawPolyPts(WARSHIP, "#3a1d22", "#FF6B5B", "#FF6B5B", 1.6);
      ctx.beginPath(); ctx.arc(8, 0, 3, 0, 6.283); ctx.fillStyle = "#FFC857"; ctx.fill();
      ctx.restore(); ctx.shadowBlur = 0;
    }
    function drawShards(k) {
      for (var s = 0; s < SHARD_N; s++) { var o = shards[s]; var a = clamp(1.2 - k * 0.45, 0, 1); if (a <= 0) continue; var x = cx + o.vx * k, y = cy + o.vy * k; ctx.save(); ctx.translate(x, y); ctx.rotate(o.rot + o.spin * k); ctx.globalAlpha = a; var col = o.hue < 0.5 ? "#7855FA" : "#AC9BFD"; if (!reduced) { ctx.shadowColor = col; ctx.shadowBlur = 8; } ctx.fillStyle = col; ctx.fillRect(-o.sz / 2, -o.sz / 2, o.sz, o.sz * 0.7); ctx.restore(); }
      ctx.globalAlpha = 1; ctx.shadowBlur = 0;
    }
    function drawCores(k) {
      for (var c = 0; c < CORE_N; c++) { var o = cores[c]; var a = clamp(1.0 - k * 0.16, 0.25, 1); var x = cx + o.vx * k * 0.6, y = cy + o.vy * k * 0.6; ctx.save(); ctx.translate(x, y); ctx.rotate(o.rot + o.spin * k); ctx.globalAlpha = a; if (!reduced) { ctx.shadowColor = o.col; ctx.shadowBlur = 14; } regPoly(0, 0, 7 + Math.sin(T * 4 + c) * 1.2, 6, 0); ctx.fillStyle = o.col; ctx.fill(); ctx.restore(); }
      ctx.globalAlpha = 1; ctx.shadowBlur = 0;
    }
    function drawWarpBelt(k) {
      var warpDur = reduced ? 0.4 : 0.9;
      if (k < warpDur) {
        var wk = k / warpDur; ctx.strokeStyle = "#AC9BFD"; ctx.lineWidth = 2;
        for (var w = 0; w < STAR_N; w++) { var sw = stars[w]; var sx = sw.x * W - cx, sy = sw.y * H - cy; var an = Math.atan2(sy, sx), r = Math.hypot(sx, sy); var x1 = cx + Math.cos(an) * r, y1 = cy + Math.sin(an) * r, x2 = cx + Math.cos(an) * (r + wk * 260), y2 = cy + Math.sin(an) * (r + wk * 260); ctx.globalAlpha = 0.5; if (!reduced) { ctx.shadowColor = "#1FDDE9"; ctx.shadowBlur = 8; } ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
        ctx.globalAlpha = 1; ctx.shadowBlur = 0;
      } else {
        var bk = k - warpDur;
        for (var rr = 0; rr < ROCK_N; rr++) { var o = rocks[rr]; var px = ((o.x - bk * 0.05 * o.z) % 1 + 1) % 1; var x = px * W, y = o.y * H, sz = o.sz * scale * o.z * 0.6; ctx.save(); ctx.translate(x, y); ctx.rotate(o.rot + o.spin * bk); ctx.globalAlpha = clamp(bk * 1.6, 0, 0.92); if (!reduced) { ctx.shadowColor = "#3a3a5a"; ctx.shadowBlur = 6; } regPoly(0, 0, sz, o.sides, 0); ctx.fillStyle = "#2b2b3e"; ctx.fill(); ctx.strokeStyle = "#5a5a78"; ctx.lineWidth = 1; ctx.stroke(); ctx.restore(); }
        ctx.globalAlpha = 1; ctx.shadowBlur = 0;
        var ek = clamp(bk / 1.4, 0, 1), wsc = scale * (1.1 - ek * 0.92);
        if (wsc > 0.05) { ctx.save(); ctx.translate(cx, cy - 10 * scale); ctx.scale(-wsc, wsc); ctx.globalAlpha = clamp(1 - ek, 0, 1); if (!reduced) { ctx.shadowColor = "#FF6B5B"; ctx.shadowBlur = 12; } drawPolyPts(WARSHIP, "#3a1d22", "#FF6B5B", "#FF6B5B", 1.5); ctx.restore(); ctx.globalAlpha = 1; ctx.shadowBlur = 0; }
      }
    }
    function drawPlanetSquad(k) {
      var pr = H * 0.42, pcx = cx, pcy = lerp(H * 1.34, H * 0.82, easeOut(clamp(k / 1.6, 0, 1)));
      ctx.save(); if (!reduced) { ctx.shadowColor = "#1FDDE9"; ctx.shadowBlur = 40; } ctx.fillStyle = "rgba(31,221,233,0.05)"; ctx.beginPath(); ctx.arc(pcx, pcy, pr * 1.02, 0, 6.283); ctx.fill(); ctx.restore(); ctx.shadowBlur = 0;
      ctx.save(); ctx.beginPath(); ctx.arc(pcx, pcy, pr, 0, 6.283); ctx.clip();
      if (planetReady) ctx.drawImage(planetImg, pcx - pr, pcy - pr, pr * 2, pr * 2); else { ctx.fillStyle = "#241a16"; ctx.fillRect(pcx - pr, pcy - pr, pr * 2, pr * 2); }
      ctx.restore();
      ctx.save(); ctx.strokeStyle = "rgba(172,155,253,0.45)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(pcx, pcy, pr, 0, 6.283); ctx.stroke(); ctx.restore();
      var sk = clamp((k - 0.4) / 2.2, 0, 1), startY = cy * 0.5, endY = pcy - pr - 18 * scale;
      for (var q = 0; q < SQ_N; q++) { var o = squad[q]; var qx = cx + o.dx * scale, qy = lerp(startY, endY, sk) + Math.sin(T * 3 + o.ph) * 3; ctx.save(); ctx.translate(qx, qy); if (!reduced) { ctx.shadowColor = "#FF6B5B"; ctx.shadowBlur = 10; } ctx.fillStyle = "#FF6B5B"; ctx.beginPath(); ctx.moveTo(0, 8); ctx.lineTo(6, -6); ctx.lineTo(-6, -6); ctx.closePath(); ctx.fill(); ctx.fillStyle = "#FFC857"; ctx.fillRect(-1.5, -2, 3, 3); ctx.restore(); ctx.shadowBlur = 0; }
    }

    var T = 0, last = global.performance.now();
    function frame(ts) {
      var dt = (ts - last) / 1000; last = ts; if (dt > 0.05) dt = 0.05; T += dt;
      ctx.clearRect(0, 0, W, H);
      var inBelt = (T >= B.belt && T < B.planet);
      if (!inBelt) { for (var i = 0; i < STAR_N; i++) { var st = stars[i]; ctx.globalAlpha = st.a * (0.6 + 0.4 * Math.sin(T * 2 + i)); ctx.fillStyle = "#cfd2ff"; ctx.fillRect(st.x * W, st.y * H, st.s, st.s); } ctx.globalAlpha = 1; }

      if (T < B.beam) { drawStation(1, 0, 0); }
      else if (T < B.shatter) { drawWarBeam(T - B.beam); }
      else if (T < B.belt) { var ks = T - B.shatter; if (!reduced) { var ff = clamp(0.3 - ks * 0.6, 0, 0.3); if (ff > 0) { ctx.fillStyle = "rgba(255,107,91," + ff + ")"; ctx.fillRect(0, 0, W, H); } } drawShards(ks); drawCores(ks); }
      else if (T < B.planet) { drawWarpBelt(T - B.belt); }
      else { drawPlanetSquad(T - B.planet); }

      if (T >= B.mission) mission.style.opacity = String(clamp((T - B.mission) / 0.8, 0, 1));
      cap.textContent = caption(T);
      if (T >= B.end) { self._endCinematic(); return; }
      self._raf = global.requestAnimationFrame(frame);
    }

    var onResize = function () { sizeCanvas(); };
    this._on(global, "resize", onResize);
    var doSkip = function () { try { StarNix.core.audio.sfx("click"); } catch (e) {} self._endCinematic(); };
    this._on(skip, "click", doSkip);
    this._on(global, "keydown", function (e) { if (e.key === "Escape" || e.key === " " || e.code === "Space") { e.preventDefault(); doSkip(); } });

    this.cinematicPlayed = true;
    this._raf = global.requestAnimationFrame(frame);
  };
  Shell.prototype._endCinematic = function () {
    this._cancelRaf();
    try { StarNix.core.audio.playTrack("menu"); } catch (e) {}
    this.showMenu();
  };

  /* =================================================================== *
   * main menu
   * =================================================================== */
  Shell.prototype.showMenu = function () {
    this._clearScreen();
    this.screen = "menu";
    var self = this;
    var s = el("div", "sx-screen sx-menu");
    s.innerHTML = '<div class="sx-menu-photo" aria-hidden="true"></div>' +
      '<div class="sx-menu-bg" aria-hidden="true"></div>' +
      '<div class="sx-menu-head"><div class="sx-crest">' + NX_CREST + '<span>NX-SRC \u00B7 Nutanix Starlight Rescue Crew</span></div>' +
      '<div class="sx-rank"></div>' +
      '<div class="sx-menu-top"></div>' +
      '<h2 class="sx-h2">Mission select</h2></div>' +
      '<div class="sx-cards"></div>';
    this._renderRank(s.querySelector(".sx-rank"));
    var photoEl = s.querySelector(".sx-menu-photo");
    var menuBg = global.STARNIX_ASSETS && global.STARNIX_ASSETS.menuBg;
    if (photoEl && menuBg) { photoEl.style.backgroundImage = 'url("' + menuBg + '")'; photoEl.classList.add("on"); }
    var bgEl = s.querySelector(".sx-menu-bg");
    if (bgEl) bgEl.style.backgroundImage = nxTileUrl();
    var cards = s.querySelector(".sx-cards");

    ["ARM", "CC", "KBB", "NIT"].forEach(function (id) {
      var m = GAME_META[id];
      var isExam = (id === "NIT");                              // the exam runs via its own flow, not registerGame
      var loaded = isExam ? !!(StarNix.exam && StarNix.exam.run) : !!StarNix.getGame(id);
      var card = el("button", "sx-card sx-acc-" + m.accent);
      var titleEl = el("div", "sx-card-title", m.title);
      var tagEl = el("div", "sx-card-tag", id + " · " + m.tag);
      var blurbEl = el("div", "sx-card-blurb", m.blurb);
      var stateEl = el("div", "sx-card-state", loaded ? "Ready" : "Not in this build");
      if (!loaded) card.classList.add("sx-card-disabled");
      card.appendChild(titleEl); card.appendChild(tagEl); card.appendChild(blurbEl); card.appendChild(stateEl);
      self._on(card, "click", function () {
        try { StarNix.core.audio.sfx("click"); } catch (e) {}
        if (!loaded) { self._toast(m.title + " isn't loaded in this build."); return; }
        if (isExam) self.showExamSetup();
        else self.enterGame(id);
      });
      cards.appendChild(card);
    });

    var top = s.querySelector(".sx-menu-top");
    function topBtn(label, fn) { var b = el("button", "sx-btn sx-btn-ghost", label); self._on(b, "click", fn); top.appendChild(b); }
    if (this.lastGameId && StarNix.getGame(this.lastGameId)) topBtn("Continue", function () { self.enterGame(self.lastGameId); });
    topBtn("Stats / Codex", function () { self.showStats(); });
    topBtn("Settings", function () { self.showSettings(); });
    topBtn("Replay intro", function () { try { StarNix.core.audio.playTrack("cinematic"); } catch (e) {} self.showCinematic(); });

    this.stage.appendChild(s);
  };

  /* Commander rank strip (v0.52.0 unit 2) — renders name + XP bar + to-next line from
   * profile.xp, and fires the ONE-SHOT rank-up moment (gold toast; pulse only when motion
   * is allowed — reduced-motion gets the same strip/toast, static). Rebuilt on every
   * showMenu, so it self-refreshes after any game/exam session. */
  Shell.prototype._renderRank = function (host) {
    if (!host) return;
    var core = StarNix.core, X = StarNix.xp;
    var prof = core && core.profile;
    if (!prof || !X) { host.style.display = "none"; return; }
    var xp = (typeof prof.xp === "number" && prof.xp >= 0) ? prof.xp : 0;
    var r = X.rankFor(xp);
    var name = el("span", "sx-rank-name", "✦ " + r.name);
    var bar = el("span", "sx-rank-bar");
    var fill = el("i");
    fill.style.width = Math.round(r.progress * 100) + "%";
    bar.appendChild(fill);
    var toNext = (r.next != null)
      ? (r.next - xp).toLocaleString() + " XP to " + X.RANKS[r.index + 1].name
      : "top rank";
    var line = el("span", "sx-rank-xp", xp.toLocaleString() + " XP · " + toNext);
    host.appendChild(name); host.appendChild(bar); host.appendChild(line);
    var seen = (typeof prof.rankSeen === "number" && prof.rankSeen >= 0) ? prof.rankSeen : 0;
    if (r.index > seen) {
      prof.rankSeen = r.index;
      try { if (core.persistence && core.persistence.save) core.persistence.save(prof); } catch (e) {}
      var rm = !!(prof.settings && prof.settings.reducedMotion);
      if (!rm) host.classList.add("sx-rank-up");           // pulse; reduced-motion stays static
      this._toast("✦ Promoted: " + r.name, "sx-toast-gold");
      try { core.audio.sfx("correct"); } catch (e2) {}
    }
  };

  /* =================================================================== *
   * practice exam  (Core study mode; full live bank, timer-as-score)
   * =================================================================== */
  Shell.prototype.showExamSetup = function () {
    this._clearScreen();
    this.screen = "exam-setup";
    var self = this, core = StarNix.core;
    var total = 0;
    try { total = core.questions.pool().length; } catch (e) {}
    try { core.audio.playTrack("exam"); } catch (e) {}
    var s = el("div", "sx-screen sx-panelwrap");
    if (!this._examMode) this._examMode = "study";                 // Study is the default experience
    s.innerHTML = '<div class="sx-panel">' +
      '<div class="sx-eyebrow">Practice exam</div>' +
      '<h2 class="sx-h2">Choose your mode and length</h2>' +
      '<div class="sx-exam-modes"></div>' +
      '<p class="sx-exam-blurb"></p>' +
      '<div class="sx-exam-lens"></div>' +
      '<div class="sx-row"></div></div>';
    var MODE_BLURB = {
      study: "Untimed. Pick an answer, confirm it, and read the explanation before moving on. Browse back through anything you\u2019ve answered.",
      sim: "One clock for the whole exam, like the real NCP-MCI (" + 96 + "s per question). Move freely, flag questions, review before you submit. Explanations at the end.",
      blitz: "The arcade mode: the clock is your score \u2014 answer before the points run down. First click commits. 80% passes; speed sets your best."
    };
    var modesEl = s.querySelector(".sx-exam-modes");
    var blurbEl = s.querySelector(".sx-exam-blurb");
    function modeBtn(id, label) {
      var b = el("button", "sx-exam-mode" + (self._examMode === id ? " on" : ""));
      b.type = "button"; b.textContent = label; b.setAttribute("data-mode", id);
      self._on(b, "click", function () {
        self._examMode = id;
        var all = modesEl.querySelectorAll(".sx-exam-mode");
        for (var i = 0; i < all.length; i++) all[i].classList.toggle("on", all[i].getAttribute("data-mode") === id);
        blurbEl.textContent = MODE_BLURB[id];
      });
      modesEl.appendChild(b);
    }
    modeBtn("study", "Study"); modeBtn("sim", "Exam sim"); modeBtn("blitz", "Blitz");
    blurbEl.textContent = MODE_BLURB[this._examMode];
    var lens = s.querySelector(".sx-exam-lens");
    function lenBtn(title, sub, count) {
      var b = el("button", "sx-exam-len");
      var best = "";
      try { var e = core.profile.bests && core.profile.bests.EXAM && core.profile.bests.EXAM[String(count)]; if (e) best = '<span class="b">Best: ' + (e.pts || 0).toLocaleString() + ' pts \u00b7 ' + (e.pct || 0) + '%</span>'; } catch (x) {}
      b.innerHTML = '<span class="t">' + title + '</span><span class="s">' + sub + '</span>' + best;
      self._on(b, "click", function () { self.showExam(count); });
      lens.appendChild(b);
    }
    if (total > 20) lenBtn("Quick", "20 questions \u00b7 a fast confidence check", 20);
    if (total > 65) lenBtn("Standard", "65 questions \u00b7 mirrors the real NCP-MCI exam", 65);
    lenBtn("Full bank", total + " questions \u00b7 everything that's live", total);
    var back = el("button", "sx-btn sx-btn-ghost", "\u2190 Menu");
    this._on(back, "click", function () { self.showMenu(); });
    s.querySelector(".sx-row").appendChild(back);
    this.stage.appendChild(s);
  };

  Shell.prototype.showExam = function (count, opts) {
    opts = opts || {};                                   // (v0.51.0) { questions, mode } — the weakest-drill path
    this._clearScreen();
    this.screen = "exam";
    var self = this, core = StarNix.core;
    var s = el("div", "sx-screen"); s.style.padding = "0"; s.style.display = "block";
    this.stage.appendChild(s);
    var rm = false;
    try { rm = !!(core.profile && core.profile.settings && core.profile.settings.reducedMotion); } catch (e) {}
    var pool = [];
    if (opts.questions && opts.questions.length) pool = opts.questions.slice();
    else { try { pool = core.questions.pool(); } catch (e) {} }
    var ec = (count && count > 0 && count < pool.length) ? count : pool.length;
    var prevBest = 0;
    try { var eb = core.profile.bests && core.profile.bests.EXAM && core.profile.bests.EXAM[String(ec)]; if (eb) prevBest = eb.pts || 0; } catch (e) {}
    try { core.audio.playTrack("exam"); } catch (e) {}   // chill study bed; no game/Vega audio in the exam
    if (StarNix.exam && StarNix.exam.run) {
      this._exam = StarNix.exam.run({
        mode: opts.mode || this._examMode || "study",
        container: s,
        questions: pool,
        count: count,
        bestPoints: prevBest,
        rng: core.makeRng("exam-" + (core.clock && core.clock.now ? core.clock.now() : Date.now())),
        audio: core.audio,
        mastery: core.mastery,
        reducedMotion: rm,
        onComplete: function (sum) { self._recordExam(sum); },
        onExit: function () { self.showMenu(); },
        onRetry: function () { self.showExam(count, opts); }
      });
    } else { self.showMenu(); }
  };

  // Record a completed exam's best speed-score per length (profile.bests.EXAM[count]).
  Shell.prototype._recordExam = function (sum) {
    if (!sum) return;
    // (v0.52.0 unit 2) Commander-rank XP: any COMPLETED exam awards into the one pool
    // (forExam returns 0 for abandoned/empty); pass bonus at the exam's own 80% mark.
    try {
      var pX = StarNix.core.profile;
      if (StarNix.xp && pX) {
        var nX = StarNix.xp.forExam(sum);
        if (nX > 0) {
          StarNix.xp.add(pX, nX);
          if (StarNix.core.persistence && StarNix.core.persistence.save) StarNix.core.persistence.save(pX);
        }
      }
    } catch (eX) {}
    // (v0.51.0) Exam-sim history feeds the readiness read on the Progress screen. Completed sims
    // only (no abandoned partials); capped at the last 20. Blitz bests below are untouched.
    if (sum.mode === "sim" && sum.total && !sum.abandoned) {
      try {
        var coreH = StarNix.core;
        var hist = coreH.profile.examHistory = coreH.profile.examHistory || [];
        hist.push({ mode: "sim", pct: sum.pct || 0, correct: sum.correct || 0, total: sum.total || 0, at: (coreH.clock && coreH.clock.now ? coreH.clock.now() : Date.now()) });
        if (hist.length > 20) hist.splice(0, hist.length - 20);
        if (coreH.persistence && coreH.persistence.save) coreH.persistence.save(coreH.profile);
      } catch (eH) {}
    }
    // (v0.53.0 unit 3) achievements see the freshly recorded history (sim-certified etc.).
    try { if (StarNix.achievements) StarNix.achievements.evaluate(StarNix.core.profile); } catch (eA) {}
    if (sum.mode && sum.mode !== "blitz") return;   // bests are the Blitz speed leaderboard; Study/Sim don't compete on speed
    var core = StarNix.core;
    try {
      var b = core.profile.bests = core.profile.bests || {};
      var ex = b.EXAM = b.EXAM || {};
      var key = String(sum.total);
      var prev = ex[key];
      if (!prev || (sum.speedPoints || 0) > (prev.pts || 0)) {
        ex[key] = { pts: sum.speedPoints || 0, pct: sum.pct || 0, correct: sum.correct || 0, total: sum.total || 0, at: (core.clock && core.clock.now ? core.clock.now() : Date.now()) };
      }
      if (core.persistence && core.persistence.save) core.persistence.save(core.profile);
    } catch (e) {}
  };

  /* =================================================================== *
   * stats / codex
   * =================================================================== */
  /* ---- shared control builders (reused by Settings, Stats, and the pause overlay) ---- */
  Shell.prototype._buildVolumeSliders = function (container) {
    var self = this, core = StarNix.core, settings = core.profile.settings;
    function makeSlider(key, label, onApply) {
      var cur = settings[key] == null ? 1 : settings[key];
      var row = el("div", "sx-slider");
      row.appendChild(el("span", "sx-slider-label", label));
      var input = el("input", "sx-range");
      input.type = "range"; input.min = "0"; input.max = "100"; input.step = "5";
      input.value = String(Math.round(cur * 100)); input.setAttribute("aria-label", label);
      var val = el("span", "sx-slider-val", Math.round(cur * 100) + "%");
      self._on(input, "input", function () {
        var v = (parseInt(input.value, 10) || 0) / 100;
        settings[key] = v; val.textContent = Math.round(v * 100) + "%";
        try { onApply(v); } catch (e) {}
      });
      self._on(input, "change", function () { core.persistence.save(core.profile); });
      row.appendChild(input); row.appendChild(val); container.appendChild(row);
    }
    makeSlider("masterVol", "Master volume", function (v) { if (core.audio.setMasterVolume) core.audio.setMasterVolume(v); });
    makeSlider("musicVol", "Music volume", function (v) {
      if (v === 0) { settings.music = false; core.audio.setMusic(false); }
      else { if (!settings.music) { settings.music = true; core.audio.setMusic(true); } if (core.audio.setMusicVolume) core.audio.setMusicVolume(v); }
    });
    makeSlider("sfxVol", "Effects volume", function (v) {
      if (v === 0) { settings.sfx = false; core.audio.setSfx(false); }
      else { if (!settings.sfx) { settings.sfx = true; core.audio.setSfx(true); } if (core.audio.setSfxVolume) core.audio.setSfxVolume(v); }
    });
  };
  Shell.prototype._buildToggles = function (container) {
    var self = this, core = StarNix.core, settings = core.profile.settings;
    var TOGGLES = [
      { key: "reducedMotion", label: "Reduced motion" },
      { key: "extraTime", label: "Extra time on timed questions" },
      { key: "colorblind", label: "High contrast", apply: function () { self._applyContrast(); } }
    ];
    TOGGLES.forEach(function (t) {
      var row = el("label", "sx-toggle");
      row.appendChild(el("span", "sx-toggle-label", t.label));
      var btn = el("button", "sx-switch" + (settings[t.key] ? " on" : ""));
      btn.setAttribute("role", "switch");
      btn.setAttribute("aria-checked", settings[t.key] ? "true" : "false");
      self._on(btn, "click", function () {
        settings[t.key] = !settings[t.key];
        btn.classList.toggle("on", settings[t.key]);
        btn.setAttribute("aria-checked", settings[t.key] ? "true" : "false");
        if (t.apply) t.apply();                    // live-apply (e.g. high contrast)
        core.persistence.save(core.profile);
      });
      row.appendChild(btn);
      container.appendChild(row);
    });
  };
  // Renders the stat grid + per-domain bars. opts.compact = fewer headline stats; opts.maxDomains = cap rows.
  Shell.prototype._buildStatsSummary = function (gridBox, listBox, opts) {
    opts = opts || {};
    var core = StarNix.core, st = core.questions.stats(), totals = core.profile.totals;
    function stat(label, val, cls) { var box = el("div", "sx-stat" + (cls ? " " + cls : "")); box.appendChild(el("div", "sx-stat-val", String(val))); box.appendChild(el("div", "sx-stat-label", label)); gridBox.appendChild(box); }
    var acc = st.overall.attempts ? Math.round(st.overall.accuracy * 100) : 0;
    if (opts.compact) {
      stat("Mastered", st.overall.mastered, "good");
      stat("Due for review", st.overall.due, st.overall.due ? "due" : "");
      stat("Accuracy", acc + "%");
    } else {
      stat("Questions in bank", st.overall.total);
      stat("Mastered", st.overall.mastered, "good");
      stat("Due for review", st.overall.due, st.overall.due ? "due" : "");
      stat("New", st.overall.fresh);
      stat("Accuracy", acc + "%");
      stat("Seen (lifetime)", totals.questionsSeen);
    }
    if (!listBox) return;
    function tier(pct) { return pct >= 0.67 ? "strong" : (pct >= 0.34 ? "mid" : "weak"); }
    var n = opts.maxDomains ? Math.min(opts.maxDomains, st.domains.length) : st.domains.length;
    for (var di = 0; di < n; di++) {
      var d = st.domains[di];
      var row = el("div", "sx-dom-row");
      row.appendChild(el("div", "sx-dom-name", d.domain));
      var bar = el("div", "sx-dom-bar"); var fill = el("i", "sx-dom-fill " + tier(d.masteredPct));
      fill.style.width = Math.round(d.masteredPct * 100) + "%";
      bar.appendChild(fill); row.appendChild(bar);
      row.appendChild(el("div", "sx-dom-count", d.mastered + "/" + d.total));
      var badge = el("div", "sx-dom-due", d.due ? (d.due + " due") : "");
      if (!d.due) badge.classList.add("none");
      row.appendChild(badge);
      listBox.appendChild(row);
    }
  };

  // (v0.51.0) Weakest questions: seen-and-shaky first — lowest Leitner bucket, then broken streak,
  // then most misses, then longest-unseen. Unseen questions are excluded (nothing to drill yet).
  Shell.prototype._weakestQuestions = function (n) {
    var core = StarNix.core, out = [];
    try {
      var pool = core.questions.pool();
      for (var i = 0; i < pool.length; i++) {
        var m = core.mastery.get(pool[i].id);
        if (m && m.seen) out.push({ q: pool[i], m: m });
      }
      out.sort(function (a, b) {
        return (a.m.bucket - b.m.bucket) || (a.m.streak - b.m.streak) || (b.m.incorrect - a.m.incorrect) || (a.m.lastSeen - b.m.lastSeen);
      });
    } catch (e) {}
    return out.slice(0, n || 20).map(function (x) { return x.q; });
  };

  // (v0.51.0) Readiness: an explicitly APPROXIMATE composite against the exam module's own 80% pass
  // mark — 50% recent Exam-sim average (last 3 completed sims), 30% bank mastery, 20% bank coverage.
  // With zero sims the score is null (mastery/coverage alone can't stand in for exam conditions).
  Shell.prototype._readiness = function () {
    var core = StarNix.core, st = null;
    try { st = core.questions.stats(); } catch (e) {}
    var overall = (st && st.overall) || { seen: 0, total: 1, masteredPct: 0 };
    var coverage = overall.total ? overall.seen / overall.total : 0;
    var mastered = overall.masteredPct || 0;
    var hist = [];
    try { hist = (core.profile.examHistory || []).filter(function (h) { return h.mode === "sim" && h.total; }); } catch (e) {}
    var last3 = hist.slice(-3);
    var simAvg = null;
    if (last3.length) { var acc = 0; for (var i = 0; i < last3.length; i++) acc += (last3[i].pct || 0); simAvg = acc / last3.length; }
    var score = (simAvg == null) ? null : Math.round(0.5 * simAvg + 30 * mastered + 20 * coverage);
    var trend = 0;
    if (hist.length >= 2) trend = (hist[hist.length - 1].pct || 0) - (hist[hist.length - 2].pct || 0);
    return { score: score, simAvg: simAvg, mastered: mastered, coverage: coverage, sims: hist.length, last: hist.slice(-5), trend: trend, target: 80 };
  };

  Shell.prototype.showStats = function () {
    this._clearScreen();
    this.screen = "stats";
    var self = this;

    var core = StarNix.core;
    var s = el("div", "sx-screen sx-panelwrap");
    s.innerHTML = '<div class="sx-panel"><div class="sx-eyebrow">Codex</div><h2 class="sx-h2">Your progress</h2>'
      + '<div class="sx-ready"></div>'
      + '<div class="sx-stat-grid"></div>'
      + '<div class="sx-dom-head">Domain mastery heatmap</div><div class="sx-heatmap"></div>'
      + '<div class="sx-dom-head">Achievements <span class="sx-ach-count"></span></div><div class="sx-ach"></div>'
      + '<div class="sx-dom-head">By domain · weakest first</div><div class="sx-domain-list"></div>'
      + '<div class="sx-dom-head">Weakest questions</div><div class="sx-weak"></div>'
      + '<div class="sx-row"></div></div>';

    // ---- readiness (v0.51.0): sim-anchored composite vs the exam's own 80% pass mark ----
    (function buildReadiness(box) {
      var r = self._readiness();
      var head = el("div", "sx-ready-head");
      var scoreEl = el("div", "sx-ready-score" + (r.score == null ? " none" : (r.score >= r.target ? " good" : (r.score >= r.target - 15 ? " close" : " far"))));
      scoreEl.textContent = (r.score == null) ? "—" : (r.score + "%");
      head.appendChild(scoreEl);
      var lab = el("div", "sx-ready-lab");
      lab.innerHTML = '<div class="sx-ready-title">Exam readiness <span class="sx-ready-approx">approximate</span></div>'
        + '<div class="sx-ready-sub">' + (r.score == null
          ? "Complete an <b>Exam sim</b> to calibrate — mastery alone can\u2019t stand in for exam conditions."
          : "vs the " + r.target + "% pass mark \u00b7 sims avg " + Math.round(r.simAvg) + "% \u00b7 mastery " + Math.round(r.mastered * 100) + "% \u00b7 coverage " + Math.round(r.coverage * 100) + "%"
            + (r.sims >= 2 ? (' \u00b7 trend ' + (r.trend >= 0 ? "+" : "") + Math.round(r.trend) + " pts") : "")) + "</div>";
      head.appendChild(lab);
      box.appendChild(head);
      if (r.last.length) {
        var strip = el("div", "sx-ready-sims");
        for (var i = 0; i < r.last.length; i++) {
          var h = r.last[i];
          var chip = el("span", "sx-simchip" + ((h.pct || 0) >= r.target ? " pass" : ""), Math.round(h.pct || 0) + "%");
          chip.title = h.correct + "/" + h.total;
          strip.appendChild(chip);
        }
        box.appendChild(strip);
      }
      var simBtn = el("button", "sx-btn sx-btn-ghost sx-ready-go", r.sims ? "Run another Exam sim" : "Take an Exam sim");
      self._on(simBtn, "click", function () { self._examMode = "sim"; self.showExam(); });
      box.appendChild(simBtn);
    })(s.querySelector(".sx-ready"));

    this._buildStatsSummary(s.querySelector(".sx-stat-grid"), s.querySelector(".sx-domain-list"));

    // ---- per-domain mastery heatmap (v0.51.0): tile color = mastered share; badge = due count ----
    (function buildHeatmap(box) {
      var st = null; try { st = core.questions.stats(); } catch (e) {}
      var doms = (st && st.domains) || [];
      for (var i = 0; i < doms.length; i++) {
        var d = doms[i], pct = Math.round((d.masteredPct || 0) * 100);
        var tier = d.seen === 0 ? "t0" : pct >= 70 ? "t4" : pct >= 45 ? "t3" : pct >= 20 ? "t2" : "t1";
        var tile = el("div", "sx-heat " + tier);
        tile.innerHTML = '<div class="sx-heat-dom">' + d.domain + '</div>'
          + '<div class="sx-heat-pct">' + (d.seen === 0 ? "new" : pct + "%") + "</div>"
          + (d.due ? '<div class="sx-heat-due">' + d.due + " due</div>" : "");
        tile.title = d.mastered + "/" + d.total + " mastered \u00b7 " + d.seen + " seen \u00b7 " + d.fresh + " unseen";
        box.appendChild(tile);
      }
    })(s.querySelector(".sx-heatmap"));

    // ---- achievements panel (v0.53.0 unit 3): 12 tiles, locked dim / unlocked gold ----
    (function buildAch(box) {
      if (!box || !StarNix.achievements) return;
      var list = StarNix.achievements.LIST;
      var un = (core.profile && core.profile.achievements) || {};
      var got = 0;
      for (var i = 0; i < list.length; i++) {
        var d = list[i], has = !!un[d.id];
        if (has) got++;
        var tile = el("div", "sx-ach-tile" + (has ? " got" : ""));
        tile.appendChild(el("span", "sx-ach-ic", d.icon));
        var body = el("span", "sx-ach-body");
        body.appendChild(el("span", "sx-ach-name", d.name));
        body.appendChild(el("span", "sx-ach-desc", d.desc));
        tile.appendChild(body);
        tile.appendChild(el("span", "sx-ach-xp", (has ? "✓ " : "") + "+" + d.xp + " XP"));
        tile.title = has ? "Unlocked" : "Locked";
        box.appendChild(tile);
      }
      var cnt = s.querySelector(".sx-ach-count");
      if (cnt) cnt.textContent = got + " / " + list.length;
    })(s.querySelector(".sx-ach"));

    // ---- weakest-questions drill (v0.51.0): worst-20 by bucket/streak/misses -> Study mode ----
    (function buildWeak(box) {
      var weak = self._weakestQuestions(20);
      if (!weak.length) {
        box.appendChild(el("div", "sx-weak-empty", "Nothing to drill yet \u2014 answer some questions first."));
        return;
      }
      var list = el("div", "sx-weak-list");
      var show = Math.min(6, weak.length);
      for (var i = 0; i < show; i++) {
        var q = weak[i], m = core.mastery.get(q.id) || {};
        var row = el("div", "sx-weak-row");
        row.innerHTML = '<span class="sx-weak-dom">' + (q.domain || "") + '</span>'
          + '<span class="sx-weak-stem">' + String(q.stem || "").slice(0, 72).replace(/&/g, "&amp;").replace(/</g, "&lt;") + (String(q.stem || "").length > 72 ? "\u2026" : "") + "</span>"
          + '<span class="sx-weak-miss">' + (m.incorrect || 0) + "\u2715</span>";
        list.appendChild(row);
      }
      box.appendChild(list);
      if (weak.length > show) box.appendChild(el("div", "sx-weak-more", "+ " + (weak.length - show) + " more in the drill"));
      var drill = el("button", "sx-btn sx-btn-primary sx-drill", "Drill these " + weak.length + " in Study mode");
      self._on(drill, "click", function () { self.showExam(null, { questions: self._weakestQuestions(20), mode: "study" }); });
      box.appendChild(drill);
    })(s.querySelector(".sx-weak"));

    var back = el("button", "sx-btn sx-btn-ghost", "← Menu");
    this._on(back, "click", function () { self.showMenu(); });
    s.querySelector(".sx-row").appendChild(back);
    this.stage.appendChild(s);
  };

  /* =================================================================== *
   * settings  (01 §12)
   * =================================================================== */
  Shell.prototype.showSettings = function () {
    this._clearScreen();
    this.screen = "settings";
    var self = this;
    var core = StarNix.core;
    var settings = core.profile.settings;

    var s = el("div", "sx-screen sx-panelwrap");
    s.innerHTML = '<div class="sx-panel"><div class="sx-eyebrow">Settings</div><h2 class="sx-h2">Options</h2>'
      + '<div class="sx-seclabel">Audio</div><div class="sx-sliders"></div>'
      + '<div class="sx-seclabel">Display &amp; input</div><div class="sx-toggles"></div>'
      + '<div class="sx-seclabel">Data</div><div class="sx-data"></div>'
      + '<div class="sx-row"></div></div>';
    var sliderBox = s.querySelector(".sx-sliders");
    var box = s.querySelector(".sx-toggles");
    var dataBox = s.querySelector(".sx-data");

    this._buildVolumeSliders(sliderBox);
    this._buildToggles(box);

    // ---- reset progress (two-tap confirm; persists a fresh profile, then reloads) ----
    var resetBtn = el("button", "sx-btn sx-btn-danger", "Reset all progress");
    var armed = false;
    self._on(resetBtn, "click", function () {
      if (!armed) { armed = true; resetBtn.textContent = "Tap again to confirm — erases mastery & best scores"; resetBtn.classList.add("armed"); return; }
      try {
        var fresh = StarNix._internal.defaultProfile();
        fresh.settings = settings;                 // keep preferences; wipe only progress
        core.persistence.save(fresh);
        if (core.persistence.flush) core.persistence.flush();
      } catch (e) {}
      try { self.root.ownerDocument.defaultView.location.reload(); }
      catch (e) { resetBtn.textContent = "Progress reset \u2014 restart to apply"; resetBtn.classList.remove("armed"); resetBtn.disabled = true; }
    });
    dataBox.appendChild(resetBtn);

    var back = el("button", "sx-btn sx-btn-ghost", "\u2190 Menu");
    this._on(back, "click", function () { if (core.persistence.flush) core.persistence.flush(); self.showMenu(); });
    s.querySelector(".sx-row").appendChild(back);
    this.stage.appendChild(s);
  };

  /* =================================================================== *
   * mount / unmount a game  (strict lifecycle)
   * =================================================================== */
  Shell.prototype.enterGame = function (id) {
    var module = StarNix.getGame(id);
    if (!module) { this._toast("Game " + id + " not registered."); return; }
    this._clearScreen();
    this.screen = "game:" + id;
    this.lastGameId = id;

    var bar = el("div", "sx-gamebar");
    var back = el("button", "sx-btn sx-btn-ghost sx-back", "← Menu");
    bar.appendChild(back);
    var pauseBtn = el("button", "sx-btn sx-btn-ghost sx-pausebtn", "⏸ Pause");
    bar.appendChild(pauseBtn);
    bar.appendChild(el("div", "sx-gamebar-title", GAME_META[id].title));
    this.stage.appendChild(bar);

    var gameRoot = el("div", "sx-game-root");
    this.stage.appendChild(gameRoot);
    this.currentGameRoot = gameRoot;
    this.currentModule = module;

    var self = this;
    this._on(back, "click", function () { self.exitGame(); });
    this._paused = false; this._pauseOverlay = null;
    this._on(pauseBtn, "click", function () { self.togglePause(); });
    this._on(global, "keydown", function (e) {
      if (self.screen !== ("game:" + id)) return;
      if (e.key === "Escape" || e.key === "Esc") { e.preventDefault(); self.togglePause(); }
    });

    var ctx = StarNix.makeContext(id);
    // Menu-return handshake (ARM 02 §D3 / CC): optional callback a game may call
    // from its own debrief to return to the shell menu. The ← Menu bar above
    // does the same via exitGame(); this just lets a game request it in-code.
    ctx.exit = function () { self.exitGame(); };
    try { StarNix.core.audio.playTrack(GAME_META[id].track); } catch (e) {}
    try {
      module.mount(gameRoot, ctx);
    } catch (err) {
      try { if (global.console) console.error("mount(" + id + ") threw:", err); } catch (x) {}
      this.exitGame();
      this._toast("Failed to start " + id + ".");
    }
  };

  /* ---- pause overlay (shell-driven; calls the module's optional pause()/resume()) ----
   * Menu-styled overlay: Resume + Menu. Entering STOPS the music and resuming
   * RESTARTS it (fresh scheduler) so an audio glitch self-heals via pause -> resume. */
  Shell.prototype.togglePause = function () {
    if (!this.screen || this.screen.indexOf("game:") !== 0) return;
    if (this._paused) this.closePause(); else this.openPause();
  };
  Shell.prototype.openPause = function () {
    if (this._paused || !this.stage) return;
    this._paused = true;
    var self = this, core = StarNix.core;
    try { if (this.currentModule && this.currentModule.pause) this.currentModule.pause(); } catch (e) {}
    try { core.audio.setMusic(false); } catch (e) {}
    var ov = el("div", "sx-pause");
    var card = el("div", "sx-pause-card");
    card.appendChild(el("div", "sx-pause-eyebrow", "Mission paused"));
    card.appendChild(el("div", "sx-pause-title", "Paused"));

    // live settings — same controls as the Settings screen (audio applies immediately)
    card.appendChild(el("div", "sx-seclabel", "Audio"));
    var sliders = el("div", "sx-sliders"); card.appendChild(sliders);
    try { this._buildVolumeSliders(sliders); } catch (e) {}
    // (Jason v0.49.0) music style — Upbeat / Chill. Persists, and swaps the current game's bed
    // immediately (the new track starts when the pause lifts; setMusic(true) restarts `current`).
    try {
      var st = core.profile.settings;
      var grow = el("div", "sx-genre-row");
      grow.appendChild(el("span", "sx-genre-label", "Music style"));
      var gUp = el("button", "sx-btn sx-btn-ghost sx-genre-btn", "Upbeat");
      var gCh = el("button", "sx-btn sx-btn-ghost sx-genre-btn", "Chill");
      function paintGenre() {
        var g = st.musicGenre === "chill" ? "chill" : "upbeat";
        gUp.className = "sx-btn sx-genre-btn" + (g === "upbeat" ? " sx-btn-primary" : " sx-btn-ghost");
        gCh.className = "sx-btn sx-genre-btn" + (g === "chill" ? " sx-btn-primary" : " sx-btn-ghost");
      }
      function pickGenre(g) {
        try { core.audio.sfx("click"); } catch (e) {}
        st.musicGenre = g; paintGenre();
        try { if (core.persistence && core.persistence.save) core.persistence.save(core.profile); } catch (e) {}
        try { if (core.audio.setMusicGenre) core.audio.setMusicGenre(g); } catch (e) {}
        try { if (self.lastGameId) core.audio.playTrack(self.lastGameId); } catch (e) {}
      }
      this._on(gUp, "click", function () { pickGenre("upbeat"); });
      this._on(gCh, "click", function () { pickGenre("chill"); });
      paintGenre();
      grow.appendChild(gUp); grow.appendChild(gCh); card.appendChild(grow);
    } catch (e) {}
    card.appendChild(el("div", "sx-seclabel", "Display & input"));
    var toggles = el("div", "sx-toggles"); card.appendChild(toggles);
    try { this._buildToggles(toggles); } catch (e) {}

    // compact progress — guarded (the questions provider may not expose stats())
    try {
      if (core.questions && core.questions.stats) {
        card.appendChild(el("div", "sx-seclabel", "Progress · weakest domains"));
        var grid = el("div", "sx-stat-grid"); card.appendChild(grid);
        var dlist = el("div", "sx-domain-list"); card.appendChild(dlist);
        this._buildStatsSummary(grid, dlist, { compact: true, maxDomains: 5 });
      }
    } catch (e) {}

    var actions = el("div", "sx-pause-actions");
    var resume = el("button", "sx-btn sx-btn-primary sx-pause-resume", "Resume");
    var menu = el("button", "sx-btn sx-btn-ghost", "← Menu");
    actions.appendChild(resume); actions.appendChild(menu);
    card.appendChild(actions);

    ov.appendChild(card); this.stage.appendChild(ov); this._pauseOverlay = ov;
    this._on(resume, "click", function () { try { core.audio.sfx("click"); } catch (e) {} self.closePause(); });
    this._on(menu, "click", function () { try { core.audio.sfx("click"); } catch (e) {} self.exitGame(); });
  };
  Shell.prototype.closePause = function () {
    if (!this._paused) return;
    this._paused = false;
    if (this._pauseOverlay && this._pauseOverlay.parentNode) this._pauseOverlay.parentNode.removeChild(this._pauseOverlay);
    this._pauseOverlay = null;
    try { StarNix.core.audio.setMusic(!!StarNix.core.profile.settings.music); } catch (e) {}
    try { if (this.currentModule && this.currentModule.resume) this.currentModule.resume(); } catch (e) {}
  };

  Shell.prototype.exitGame = function () {
    this._paused = false;
    if (this._pauseOverlay && this._pauseOverlay.parentNode) this._pauseOverlay.parentNode.removeChild(this._pauseOverlay);
    this._pauseOverlay = null;
    try { StarNix.core.audio.setMusic(!!StarNix.core.profile.settings.music); } catch (e) {}
    if (this.currentModule) {
      try { this.currentModule.unmount(); }
      catch (err) { try { if (global.console) console.error("unmount threw:", err); } catch (x) {} }
      this.currentModule = null;
    }
    if (this.currentGameRoot && this.currentGameRoot.parentNode) this.currentGameRoot.parentNode.removeChild(this.currentGameRoot);
    this.currentGameRoot = null;
    try { StarNix.core.audio.playTrack("menu"); } catch (e) {}
    this.showMenu();
  };

  /* =================================================================== *
   * teardown (test isolation) — removes ALL residue
   * =================================================================== */
  Shell.prototype.destroy = function () {
    if (this.currentModule) { try { this.currentModule.unmount(); } catch (e) {} this.currentModule = null; }
    this._cancelRaf();
    this._clear(this._screenListeners);
    this._clear(this._shellListeners);
    if (this.root) { this.root.classList.remove("starnix-shell"); this.root.textContent = ""; }
    this.stage = null; this.screen = "destroyed";
  };

  /* ---- toast --------------------------------------------------------- */
  Shell.prototype._toast = function (msg, cls) {
    if (!this.stage) return;
    var t = el("div", "sx-toast" + (cls ? " " + cls : ""), msg);
    this.stage.appendChild(t);
    var self = this;
    global.setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 2200);
  };

  /* ---- shell CSS (static; tokens via core theme vars) ---------------- */
  Shell.prototype._injectShellCSS = function () {
    if (document.getElementById("starnix-shell-css")) return;
    var st = document.createElement("style");
    st.id = "starnix-shell-css";
    st.textContent = [
      ".starnix-shell{position:relative;width:100%;height:100%;min-height:480px;overflow:hidden;",
      "background:radial-gradient(130% 110% at 50% -10%,#15152a 0%,#0a0a16 55%,#050509 100%);",
      "color:var(--text);font-family:var(--font);}",
      ".sx-stage{position:absolute;inset:0;}",
      ".sx-build-badge{position:absolute;right:8px;bottom:7px;z-index:9999;pointer-events:none;font-family:var(--font);font-size:11px;font-weight:600;letter-spacing:.02em;color:var(--dim);background:rgba(5,5,9,.55);border:1px solid var(--border);border-radius:6px;padding:2px 7px;opacity:.8;}",
      ".sx-screen{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px;text-align:center;}",
      ".sx-h1{font-size:46px;font-weight:800;margin:0;letter-spacing:.02em;color:var(--text);text-shadow:0 0 26px rgba(120,85,250,.6);}",
      ".sx-h2{font-size:22px;font-weight:700;margin:0 0 4px;}",
      ".sx-sub{color:var(--mid);letter-spacing:.18em;text-transform:uppercase;font-size:12px;}",
      ".sx-wordmark{color:var(--mid);letter-spacing:.34em;text-transform:lowercase;font-weight:700;font-size:13px;opacity:.8;}",
      ".sx-wordmark-img{height:26px;width:auto;display:block;opacity:.94;filter:drop-shadow(0 0 14px rgba(120,85,250,.35));}",
      ".sx-mission{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(560px,88%);background:rgba(13,13,24,.82);border:1px solid var(--border);border-radius:18px;padding:22px 26px;text-align:left;box-shadow:0 0 50px rgba(120,85,250,.25);transition:opacity .5s ease;pointer-events:none;}",
      ".sx-mission-eyebrow{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--aqua);margin-bottom:6px;}",
      ".sx-mission-title{font-size:23px;font-weight:800;margin:0 0 14px;color:var(--text);}",
      ".sx-mission-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:11px;}",
      ".sx-mission-list li{font-size:15px;color:#d6d6e6;padding-left:24px;position:relative;line-height:1.4;}",
      ".sx-mission-list li::before{content:'\\25B8';position:absolute;left:3px;color:var(--mantis);}",
      ".sx-mission-list b{color:var(--text);}",
      ".sx-mission-list span{color:var(--mid);font-size:13px;}",
      ".sx-row{display:flex;gap:10px;justify-content:center;margin-top:8px;flex-wrap:wrap;}",
      ".sx-btn{font-family:inherit;font-weight:700;font-size:15px;padding:12px 22px;border-radius:11px;border:none;cursor:pointer;transition:transform .05s,background .12s,border-color .12s;}",
      ".sx-btn:active{transform:scale(.98);}",
      ".sx-btn-iris{background:var(--iris);color:#fff;}.sx-btn-iris:hover{background:var(--iris600);}",
      ".sx-btn-ghost{background:transparent;border:1px solid var(--border);color:var(--mid);}",
      ".sx-btn-exam{background:linear-gradient(90deg,#7855FA,#1FDDE9);color:#fff;box-shadow:0 8px 22px rgba(120,85,250,.35);}",
      ".sx-btn-exam:hover{transform:translateY(-1px);}",
      ".sx-exam-blurb{color:var(--mid);font-size:13.5px;line-height:1.55;margin:0 0 18px;}",
      ".sx-exam-lens{display:flex;flex-direction:column;gap:10px;margin-bottom:18px;}",
      ".sx-exam-modes{display:flex;gap:8px;margin:2px 0 10px;}",
      ".sx-exam-mode{flex:1;background:rgba(255,255,255,.04);border:1.5px solid var(--border);border-radius:10px;padding:10px 8px;color:var(--dim);font:700 13px Montserrat,Arial,sans-serif;cursor:pointer;transition:border-color .12s,color .12s;}",
      ".sx-exam-mode.on{border-color:var(--aqua);color:var(--text);background:rgba(31,221,233,.08);}",
      ".sx-exam-len{display:flex;flex-direction:column;gap:3px;text-align:left;background:rgba(255,255,255,.04);border:1.5px solid var(--border);border-radius:12px;padding:14px 16px;cursor:pointer;transition:border-color .12s,background .12s;font-family:inherit;}",
      ".sx-exam-len:hover{border-color:var(--iris300);background:rgba(120,85,250,.10);}",
      ".sx-exam-len .t{font-size:16px;font-weight:700;}",
      ".sx-exam-len .s{font-size:12.5px;color:var(--mid);}",
      ".sx-exam-len .b{font-size:12px;font-weight:700;color:var(--gold,#FFC857);margin-top:5px;}",
      ".sx-btn-ghost:hover{border-color:var(--iris);color:var(--text);}",
      ".sx-cine{padding:0;}.sx-cine-canvas{position:absolute;inset:0;width:100%;height:100%;}",
      ".sx-cap{position:absolute;left:50%;bottom:54px;transform:translateX(-50%);max-width:620px;width:86%;font-size:16px;font-weight:600;color:#eef;text-shadow:0 0 12px #000,0 0 4px #000;pointer-events:none;line-height:1.4;}",
      ".sx-skip{position:absolute;top:16px;right:16px;background:rgba(16,16,24,.7);border:1px solid var(--border);color:var(--mid);border-radius:10px;padding:8px 14px;font-family:inherit;font-weight:600;cursor:pointer;}",
      ".sx-skip:hover{border-color:var(--aqua);color:var(--text);}",
      ".sx-menu{justify-content:flex-start;padding-top:40px;}",
      ".sx-menu-photo,.sx-title-photo{position:absolute;inset:0;z-index:0;pointer-events:none;background-size:cover;background-position:center;opacity:0;transition:opacity .8s ease;will-change:transform;}",
      ".sx-menu-photo.on,.sx-title-photo.on{opacity:.62;animation:sx-bg-drift 64s ease-in-out infinite alternate;}",
      ".sx-title-photo.on{opacity:.55;}",
      ".sx-title>.sx-wordmark-img,.sx-title>.sx-h1,.sx-title>.sx-sub,.sx-title>.sx-row{position:relative;z-index:2;}",
      "@keyframes sx-bg-drift{from{transform:scale(1.08) translate3d(-1.6%,-1.1%,0);}to{transform:scale(1.16) translate3d(1.6%,1.1%,0);}}",
      "@media (prefers-reduced-motion: reduce){.sx-menu-photo.on,.sx-title-photo.on{animation:none;transform:scale(1.04);}}",
      ".sx-menu-bg{position:absolute;inset:0;z-index:1;pointer-events:none;background-repeat:repeat;background-position:center;opacity:.10;}",
      ".sx-menu-head,.sx-cards,.sx-menu-foot{position:relative;z-index:2;}",
      ".sx-menu-head,.sx-cards,.sx-menu-foot{position:relative;z-index:1;}",
      ".sx-menu-head{display:flex;flex-direction:column;align-items:center;}",
      ".sx-crest{display:inline-flex;align-items:center;gap:8px;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--iris300);margin-bottom:8px;opacity:.9;}",
      ".sx-crest-x{flex-shrink:0;}",
      ".sx-menu-top{display:flex;gap:10px;flex-wrap:wrap;justify-content:center;margin:6px 0 18px;}",
      ".sx-cards{display:flex;flex-direction:column;align-items:center;gap:14px;width:100%;max-width:480px;margin:0 auto;}",
      ".sx-card{width:100%;max-width:440px;text-align:left;background:rgba(20,20,29,.9);border:1px solid var(--border);border-radius:16px;padding:20px;cursor:pointer;font-family:inherit;color:var(--text);transition:transform .08s,border-color .12s,box-shadow .12s;}",
      ".sx-card:hover{transform:translateY(-3px);}",
      ".sx-acc-iris:hover{border-color:var(--iris);box-shadow:0 0 24px rgba(120,85,250,.25);}",
      ".sx-acc-peach:hover{border-color:var(--peach);box-shadow:0 0 24px rgba(255,107,91,.25);}",
      ".sx-acc-aqua:hover{border-color:var(--aqua);box-shadow:0 0 24px rgba(31,221,233,.25);}",
      ".sx-acc-gold:hover{border-color:var(--gold,#FFC857);box-shadow:0 0 24px rgba(255,200,87,.25);}",
      ".sx-card-disabled{opacity:.55;}",
      ".sx-card-title{font-size:18px;font-weight:700;margin-bottom:3px;}",
      ".sx-card-tag{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--mid);margin-bottom:10px;}",
      ".sx-card-blurb{font-size:13.5px;line-height:1.5;color:#cfcfe0;margin-bottom:12px;}",
      ".sx-card-state{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--aqua);}",
      ".sx-card-disabled .sx-card-state{color:var(--dim);}",
      ".sx-menu-foot{display:flex;gap:10px;flex-wrap:wrap;justify-content:center;margin-top:26px;}",
      ".sx-panelwrap{padding:24px;}",
      ".sx-panel{width:100%;max-width:560px;background:rgba(18,18,27,.96);border:1px solid var(--border);border-radius:18px;padding:26px;text-align:left;max-height:88vh;overflow:auto;}",
      ".sx-eyebrow{font-size:11px;letter-spacing:.24em;text-transform:uppercase;font-weight:700;color:var(--iris300);margin-bottom:8px;}",
      ".sx-stat-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:14px 0;}",
      ".sx-stat{background:rgba(255,255,255,.04);border:1px solid var(--border);border-radius:12px;padding:14px;text-align:center;}",
      ".sx-stat-val{font-size:24px;font-weight:800;color:var(--text);}",
      ".sx-stat-label{font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--mid);margin-top:4px;}",
      ".sx-dom-row{display:flex;align-items:center;gap:10px;margin:7px 0;font-size:12.5px;}",
      ".sx-dom-name{width:120px;color:var(--mid);text-transform:capitalize;}",
      ".sx-dom-bar{flex:1;height:8px;border-radius:5px;border:1px solid var(--border);overflow:hidden;}",
      ".sx-dom-fill{display:block;height:100%;background:linear-gradient(90deg,var(--mantis),#6fae18);}",
      ".sx-dom-count{width:48px;text-align:right;color:var(--text);font-weight:700;}",
      ".sx-dom-due{width:52px;text-align:right;font-size:10.5px;font-weight:800;letter-spacing:.03em;color:var(--aqua);}",
      ".sx-dom-due.none{opacity:0;}",
      ".sx-dom-fill.weak{background:linear-gradient(90deg,#ff8a7d,#ff6b5b);}",
      ".sx-dom-fill.mid{background:linear-gradient(90deg,#ffc857,#e0a93e);}",
      ".sx-dom-fill.strong{background:linear-gradient(90deg,var(--mantis),#6fae18);}",
      ".sx-dom-head{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--mid);margin:18px 0 6px;text-align:left;}",
      /* (v0.51.0) Progress & readiness */
      ".sx-ready{display:flex;flex-direction:column;gap:10px;margin:6px 0 14px;padding:14px;border:1px solid rgba(255,255,255,0.10);border-radius:14px;background:rgba(255,255,255,0.03);}",
      ".sx-ready-head{display:flex;align-items:center;gap:14px;}",
      ".sx-ready-score{font-size:34px;font-weight:800;min-width:86px;text-align:center;}",
      ".sx-ready-score.good{color:var(--mantis);} .sx-ready-score.close{color:var(--gold);} .sx-ready-score.far{color:var(--peach);} .sx-ready-score.none{color:var(--mid);}",
      ".sx-ready-title{font-weight:700;text-align:left;} .sx-ready-approx{font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--mid);margin-left:6px;}",
      ".sx-ready-sub{font-size:12px;color:var(--mid);text-align:left;margin-top:2px;}",
      ".sx-ready-sims{display:flex;gap:6px;flex-wrap:wrap;}",
      ".sx-simchip{font-size:11px;padding:3px 8px;border-radius:999px;border:1px solid rgba(255,255,255,0.14);color:var(--peach);}",
      ".sx-simchip.pass{color:var(--mantis);border-color:rgba(146,221,35,0.4);}",
      ".sx-ready-go{align-self:flex-start;}",
      ".sx-heatmap{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-start;}",
      ".sx-heat{min-width:96px;flex:1 1 96px;max-width:150px;padding:9px 10px;border-radius:10px;border:1px solid rgba(255,255,255,0.10);text-align:left;}",
      ".sx-heat-dom{font-size:11px;color:var(--fg);opacity:.9;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
      ".sx-heat-pct{font-size:17px;font-weight:800;margin-top:2px;}",
      ".sx-heat-due{font-size:10px;color:var(--gold);margin-top:1px;}",
      ".sx-heat.t0{background:rgba(255,255,255,0.03);color:var(--mid);}",
      ".sx-heat.t1{background:rgba(255,107,91,0.14);border-color:rgba(255,107,91,0.35);} .sx-heat.t1 .sx-heat-pct{color:var(--peach);}",
      ".sx-heat.t2{background:rgba(255,200,87,0.12);border-color:rgba(255,200,87,0.32);} .sx-heat.t2 .sx-heat-pct{color:var(--gold);}",
      ".sx-heat.t3{background:rgba(146,221,35,0.10);border-color:rgba(146,221,35,0.30);} .sx-heat.t3 .sx-heat-pct{color:var(--mantis);}",
      ".sx-heat.t4{background:rgba(146,221,35,0.18);border-color:rgba(146,221,35,0.50);} .sx-heat.t4 .sx-heat-pct{color:var(--mantis);}",
      ".sx-weak-list{display:flex;flex-direction:column;gap:5px;}",
      ".sx-weak-row{display:flex;gap:10px;align-items:baseline;font-size:12px;text-align:left;}",
      ".sx-weak-dom{color:var(--aqua);font-size:10px;letter-spacing:.06em;text-transform:uppercase;flex:0 0 auto;}",
      ".sx-weak-stem{color:var(--fg);opacity:.85;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1 1 auto;}",
      ".sx-weak-miss{color:var(--peach);flex:0 0 auto;font-weight:700;}",
      ".sx-weak-more{font-size:11px;color:var(--mid);margin-top:4px;text-align:left;}",
      ".sx-weak-empty{font-size:12px;color:var(--mid);text-align:left;}",
      ".sx-drill{margin-top:10px;}",
      ".sx-stat.good .sx-stat-val{color:var(--mantis);}",
      ".sx-stat.due .sx-stat-val{color:var(--aqua);}",
      ".sx-toggles{display:flex;flex-direction:column;gap:4px;margin:10px 0;}",
      ".sx-seclabel{font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:var(--aqua);margin:16px 0 4px;}",
      ".sx-sliders{display:flex;flex-direction:column;gap:6px;margin:4px 0;}",
      ".sx-slider{display:grid;grid-template-columns:1fr auto;align-items:center;gap:6px 10px;padding:8px 4px;}",
      ".sx-slider-label{font-size:14px;color:var(--text);}",
      ".sx-slider-val{font-size:13px;color:var(--mid);min-width:42px;text-align:right;font-variant-numeric:tabular-nums;}",
      ".sx-range{grid-column:1/3;width:100%;height:26px;accent-color:var(--iris);cursor:pointer;}",
      ".sx-data{margin:4px 0 2px;}",
      ".sx-btn-danger{background:transparent;border:1px solid var(--peach);color:var(--peach);width:100%;font-size:14px;}",
      ".sx-btn-danger.armed{background:rgba(255,107,91,.16);}.sx-btn-danger:disabled{opacity:.6;cursor:default;}",
      ".sx-toggle{display:flex;align-items:center;justify-content:space-between;padding:12px 4px;border-bottom:1px solid rgba(255,255,255,.05);}",
      ".sx-toggle-label{font-size:14.5px;}",
      ".sx-switch{width:48px;height:27px;border-radius:999px;border:1px solid var(--border);background:#23232f;position:relative;cursor:pointer;transition:background .12s,border-color .12s;}",
      ".sx-switch::after{content:'';position:absolute;top:2px;left:2px;width:21px;height:21px;border-radius:50%;background:var(--mid);transition:left .12s,background .12s;}",
      ".sx-switch.on{background:rgba(120,85,250,.35);border-color:var(--iris);}",
      ".sx-switch.on::after{left:23px;background:var(--iris300);}",
      ".sx-gamebar{position:absolute;top:0;left:0;right:0;height:48px;display:flex;align-items:center;gap:12px;padding:0 12px;z-index:20;background:rgba(8,8,16,.6);border-bottom:1px solid var(--border);}",
      ".sx-gamebar-title{font-size:13px;font-weight:700;letter-spacing:.04em;color:var(--mid);}",
      ".sx-back{padding:7px 14px;font-size:13px;}",
      ".sx-game-root{position:absolute;top:48px;left:0;right:0;bottom:0;}",
      ".sx-pausebtn{padding:7px 14px;font-size:13px;}",
      ".sx-pause{position:absolute;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;padding:24px;background:radial-gradient(120% 100% at 50% 0%,rgba(21,21,42,.86),rgba(5,5,9,.93));backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);}",
      ".sx-pause-card{display:flex;flex-direction:column;align-items:stretch;gap:11px;text-align:left;padding:24px 26px;border-radius:18px;background:rgba(13,13,24,.86);border:1px solid var(--border);box-shadow:0 18px 60px rgba(0,0,0,.55),0 0 42px rgba(120,85,250,.18);width:min(380px,92vw);max-height:calc(100vh - 40px);overflow-y:auto;}",
      ".sx-genre-row{display:flex;align-items:center;gap:8px;}",
      ".sx-genre-label{font-size:12px;color:var(--dim);margin-right:auto;letter-spacing:.3px;}",
      ".sx-genre-btn{padding:7px 14px;font-size:12.5px;}",
      ".sx-pause-eyebrow{font-size:12px;font-weight:700;letter-spacing:.22em;text-transform:uppercase;color:var(--iris300);text-align:center;}",
      ".sx-pause-title{font-size:30px;font-weight:800;margin:0 0 2px;color:var(--text);text-shadow:0 0 22px rgba(120,85,250,.5);text-align:center;}",
      ".sx-pause-actions{display:flex;gap:10px;margin-top:6px;}",
      ".sx-pause-actions .sx-btn{flex:1;min-width:0;}",
      ".sx-pause .sx-stat-grid{gap:8px;margin:4px 0 8px;}",
      ".sx-pause .sx-stat-val{font-size:20px;}",
      ".sx-toast{position:absolute;left:50%;bottom:28px;transform:translateX(-50%);background:rgba(10,10,18,.92);border:1px solid var(--peach);color:#ffe1db;padding:10px 16px;border-radius:999px;font-size:13px;font-weight:600;z-index:40;}",
      // Commander rank strip (v0.52.0 unit 2) — gold = reward per 07 §1; bar copies the sx-dom-bar pattern.
      ".sx-rank{display:flex;align-items:center;gap:10px;justify-content:center;margin:2px 0 4px;font-size:13px;}",
      ".sx-rank-name{color:var(--gold);font-weight:800;letter-spacing:.06em;text-transform:uppercase;font-size:12px;}",
      ".sx-rank-bar{width:150px;height:8px;border-radius:5px;border:1px solid var(--border);overflow:hidden;display:inline-block;background:rgba(5,5,9,.6);}",
      ".sx-rank-bar i{display:block;height:100%;background:linear-gradient(90deg,var(--iris),var(--gold));}",
      ".sx-rank-xp{color:var(--mid);font-size:12px;}",
      ".sx-rank-up{animation:sxRankPulse 1.6s ease-out 3;}",
      "@keyframes sxRankPulse{0%{filter:brightness(1);}30%{filter:brightness(1.7);}100%{filter:brightness(1);}}",
      "@media (prefers-reduced-motion: reduce){.sx-rank-up{animation:none;}}",
      ".sx-toast-gold{border-color:var(--gold);color:#ffedc2;}",
      // Achievements panel (v0.53.0 unit 3) — Progress screen grid; locked = dim, unlocked = gold edge.
      ".sx-ach{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:8px;text-align:left;margin:4px 0 10px;}",
      ".sx-ach-count{color:var(--mid);font-weight:600;font-size:11px;margin-left:6px;}",
      ".sx-ach-tile{display:flex;align-items:center;gap:9px;border:1px solid var(--border);border-radius:10px;padding:8px 10px;opacity:.45;background:rgba(10,10,18,.5);}",
      ".sx-ach-tile.got{opacity:1;border-color:var(--gold);box-shadow:0 0 10px rgba(255,200,87,.12);}",
      ".sx-ach-ic{font-size:17px;width:22px;text-align:center;flex:none;}",
      ".sx-ach-body{display:flex;flex-direction:column;gap:1px;min-width:0;flex:1;}",
      ".sx-ach-name{font-size:12px;font-weight:700;color:var(--text);}",
      ".sx-ach-desc{font-size:11px;color:var(--mid);line-height:1.25;}",
      ".sx-ach-xp{font-size:11px;font-weight:700;color:var(--gold);flex:none;}"
    ].join("");
    document.head.appendChild(st);
  };

  /* =================================================================== *
   * public API
   * =================================================================== */
  var shell = new Shell();
  StarNix.shell = shell;
  StarNix.boot = function (root, opts) { return shell.boot(root, opts); };

  /* ---- optional freeze monitor (diagnostic) ----------------------------------
   * Runs its OWN requestAnimationFrame loop and measures the gap between its own
   * frames. A main-thread stall (GC pause, heavy frame, sync work) delays this loop
   * exactly as it delays the running game, no matter which game owns the screen — so
   * it catches every hitch and reports how long + when + how often. Cost is negligible
   * and it only console.warns when a stall actually happens.
   * Enable EITHER way: add ?perf to the URL, OR run StarNix.startPerfMonitor() in the
   * devtools console at any time. */
  var _perfRunning = false;
  function startFreezeMonitor() {
    if (_perfRunning || !global.requestAnimationFrame) return;
    _perfRunning = true;
    var nowFn = (global.performance && global.performance.now) ? function () { return global.performance.now(); } : function () { return Date.now(); };
    var THRESH = 50, last = nowFn(), t0 = last, count = 0, worst = 0;
    function tick() {
      var now = nowFn(), gap = now - last; last = now;
      if (gap > THRESH) {
        count++; if (gap > worst) worst = gap;
        try { console.warn("[StarNix perf] freeze #" + count + ": " + gap.toFixed(0) + "ms  (at +" + ((now - t0) / 1000).toFixed(1) + "s, worst so far " + worst.toFixed(0) + "ms)"); } catch (e) {}
      }
      global.requestAnimationFrame(tick);
    }
    try { console.log("[StarNix perf] freeze monitor ON — frames slower than " + THRESH + "ms will be logged here. Play until a freeze, then copy the lines."); } catch (e) {}
    global.requestAnimationFrame(tick);
  }
  StarNix.startPerfMonitor = startFreezeMonitor;
  try { if ((global.location && global.location.search && /[?&]perf\b/.test(global.location.search)) || global.STARNIX_PERF) startFreezeMonitor(); } catch (e) {}

})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
