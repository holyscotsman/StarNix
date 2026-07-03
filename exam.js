/* StarNix — Practice Exam  (Core-owned study mode, not a game).
 * window.StarNix.exam.run(opts). All questions, randomized, one per screen.
 *
 * Scoring: the timer IS the score. Each question opens at MAX points that decay
 * linearly to 0 over a difficulty-scaled window; answering correctly banks the
 * points still on the clock, a wrong answer or timeout banks 0. The end screen
 * reports % correct (>=80% PASS) and the summed speed-points (correct only),
 * plus a per-domain breakdown and a review of every missed question.
 *
 * Pure logic (gradeAnswer / windowFor / pointsAt / shuffleOptions / summarize)
 * is exported for headless tests; the DOM + RAF + Three.js backdrop are the
 * imperative shell and degrade gracefully when those APIs are absent (jsdom).
 */
(function (root, factory) {
  var api = factory();
  if (typeof window !== "undefined") {
    window.StarNix = window.StarNix || {};
    window.StarNix.exam = api;
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var root = (typeof self !== "undefined") ? self : ((typeof window !== "undefined") ? window : ((typeof global !== "undefined") ? global : this));
  var MAX_POINTS = 1000;
  var WINDOW_SECS = { 1: 30, 2: 40, 3: 50 };   // per-question time budget by difficulty
  var PALETTE = { bg: "#0a0b1a", iris: "#7855FA", aqua: "#1FDDE9", mantis: "#92DD23", peach: "#FF6B5B", gold: "#FFC857", ink: "#e8e9f5", dim: "#9aa0c8" };

  /* ---- pure helpers ------------------------------------------------------- */
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]; }); }
  // (v0.71.0, J8) DISPLAY cap for authored explanations: never edit bank content — show the
  // first EXPLAIN_CAP words, tuck the rest behind a native <details> expander.
  var EXPLAIN_CAP = 120;   // (v0.75.0) Jason: 120, not 150
  function capExplainHTML(text) {
    var w = String(text || "").trim().split(/\s+/);
    if (w.length <= EXPLAIN_CAP) return '<div class="ex">' + esc(text) + "</div>";
    return '<div class="ex">' + esc(w.slice(0, EXPLAIN_CAP).join(" ")) + "\u2026"
      + '<details class="sx-exam-more"><summary>Show the full explanation (' + (w.length - EXPLAIN_CAP)
      + ' more words)</summary><div>' + esc(w.slice(EXPLAIN_CAP).join(" ")) + "</div></details></div>";
  }
  function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }
  function shuffle(arr, rng) { var a = arr.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rng() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

  // Grade: chosen is an index (single) or an array of indices (multi). Multi is
  // correct iff the chosen set equals the correctIndices set. Matches KBB/CC.
  function gradeAnswer(q, chosen) {
    if (q && Array.isArray(q.correctIndices) && q.correctIndices.length) {
      if (!Array.isArray(chosen) || chosen.length !== q.correctIndices.length) return false;
      for (var i = 0; i < q.correctIndices.length; i++) if (chosen.indexOf(q.correctIndices[i]) < 0) return false;
      return true;
    }
    var idx = Array.isArray(chosen) ? (chosen.length ? chosen[0] : -1) : chosen;
    return typeof idx === "number" && idx === q.correctIndex;
  }

  function windowFor(difficulty) { return (WINDOW_SECS[difficulty] || 40) * 1000; }            // ms
  function pointsAt(elapsedMs, windowMs, max) { max = max || MAX_POINTS; return Math.round(max * clamp(1 - elapsedMs / windowMs, 0, 1)); }
  // (v0.58.0 unit 8) Blitz combo: the multiplier applied to the NEXT correct answer after
  // `streak` consecutive corrects. +10% per chain link, capped at x1.5 (5+). Blitz ONLY —
  // Study/Sim never touch it. Stored bests stay schema-valid (still summed speedPoints).
  function comboMult(streak) { return 1 + 0.1 * Math.min(5, streak || 0); }

  // Shuffle a question's options for display, remapping correctIndex/correctIndices
  // AND the parallel optionNotes so every option carries its own rationale. Keeps
  // the original id (mastery records against it).
  function shuffleOptions(q, rng) {
    var n = q.options.length, perm = []; for (var i = 0; i < n; i++) perm.push(i);
    for (var k = n - 1; k > 0; k--) { var j = Math.floor(rng() * (k + 1)); var t = perm[k]; perm[k] = perm[j]; perm[j] = t; }
    var inv = {}; perm.forEach(function (orig, ni) { inv[orig] = ni; });
    var dq = { id: q.id, cert: q.cert, domain: q.domain, difficulty: q.difficulty, stem: q.stem, options: perm.map(function (p) { return q.options[p]; }), explanation: q.explanation };
    if (q.optionNotes) dq.optionNotes = perm.map(function (p) { return q.optionNotes[p]; });
    if (q.image) dq.image = q.image;
    if (Array.isArray(q.correctIndices)) dq.correctIndices = q.correctIndices.map(function (c) { return inv[c]; }).sort(function (a, b) { return a - b; });
    else dq.correctIndex = inv[q.correctIndex];
    return dq;
  }

  // Reduce a results array to the score report.
  function summarize(results, total) {
    var correct = 0, speed = 0, byDomain = {}, wrong = [];
    results.forEach(function (r) {
      var d = r.q.domain || "?"; if (!byDomain[d]) byDomain[d] = { correct: 0, total: 0 };
      byDomain[d].total++;
      if (r.correct) { correct++; speed += r.points; byDomain[d].correct++; } else wrong.push(r);
    });
    var n = total || results.length;
    var pct = n ? Math.round((correct / n) * 100) : 0;
    return { correct: correct, total: n, pct: pct, pass: pct >= 80, speedPoints: speed, byDomain: byDomain, wrong: wrong };
  }

  /* ---- DOM + CSS ---------------------------------------------------------- */
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

  function injectCSS() {
    if (document.getElementById("sx-exam-css")) return;
    var P = PALETTE;
    var css = [
      ".sx-exam{position:absolute;inset:0;overflow:hidden;background:" + P.bg + ";color:" + P.ink + ";font-family:Montserrat,Arial,sans-serif;}",
      ".sx-exam-bg{position:absolute;inset:0;width:100%;height:100%;display:block;z-index:0;}",
      ".sx-exam-wrap{position:absolute;inset:0;z-index:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;padding:18px 16px;overflow-y:auto;}",
      ".sx-exam-top{width:100%;max-width:760px;display:flex;align-items:center;gap:12px;margin-bottom:14px;}",
      ".sx-exam-prog{font-size:12.5px;letter-spacing:.04em;color:" + P.dim + ";font-weight:600;}",
      ".sx-exam-score{margin-left:auto;font-size:13px;font-weight:700;color:" + P.gold + ";font-variant-numeric:tabular-nums;}",
      // (v0.58.0) blitz combo meter — aqua chain chip; pulses on growth, static under reduced motion
      ".sx-exam-combo{margin-left:auto;font-size:12px;font-weight:700;color:" + P.aqua + ";font-variant-numeric:tabular-nums;}",
      ".sx-exam-combo.on + .sx-exam-score{margin-left:10px;}",
      ".sx-exam-combo.pulse{animation:sxComboPulse .45s ease-out 1;}",
      "@keyframes sxComboPulse{0%{transform:scale(1);}40%{transform:scale(1.25);}100%{transform:scale(1);}}",
      "@media (prefers-reduced-motion: reduce){.sx-exam-combo.pulse{animation:none;}}",
      ".sx-exam-more{margin-top:8px;}",
      ".sx-exam-more summary{cursor:pointer;color:" + P.aqua + ";font-size:12.5px;font-weight:600;}",
      ".sx-exam-more div{margin-top:6px;}",
      ".sx-exam-quit{background:transparent;border:1px solid rgba(255,255,255,.16);color:" + P.dim + ";border-radius:8px;padding:5px 11px;font:600 12px Montserrat,Arial,sans-serif;cursor:pointer;}",
      ".sx-exam-quit:hover{border-color:" + P.peach + ";color:" + P.peach + ";}",
      ".sx-exam-bars{width:100%;max-width:760px;display:flex;flex-direction:column;gap:6px;margin-bottom:14px;}",
      ".sx-exam-meter{height:7px;border-radius:5px;background:rgba(255,255,255,.08);overflow:hidden;}",
      ".sx-exam-meter > i{display:block;height:100%;width:100%;background:linear-gradient(90deg," + P.mantis + "," + P.gold + ");transition:width .12s linear;}",
      ".sx-exam-meterlbl{display:flex;justify-content:space-between;font-size:11px;color:" + P.dim + ";font-variant-numeric:tabular-nums;}",
      ".sx-exam-card{width:100%;max-width:760px;background:rgba(16,18,38,.86);border:1px solid rgba(120,85,250,.28);border-radius:16px;padding:22px 22px 18px;box-shadow:0 18px 50px rgba(0,0,0,.45);}",
      ".sx-exam-eyebrow{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:" + P.aqua + ";font-weight:700;margin-bottom:9px;}",
      ".sx-exam-stem{font-size:17px;line-height:1.5;font-weight:600;margin-bottom:16px;white-space:pre-wrap;}",
      ".sx-exam-img{display:block;max-width:100%;border-radius:10px;margin:0 0 14px;border:1px solid rgba(255,255,255,.12);}",
      ".sx-exam-opts{display:flex;flex-direction:column;gap:9px;}",
      ".sx-exam-opt{display:flex;gap:11px;align-items:flex-start;text-align:left;background:rgba(255,255,255,.04);border:1.5px solid rgba(255,255,255,.12);border-radius:11px;padding:12px 14px;font:600 15px Montserrat,Arial,sans-serif;color:" + P.ink + ";cursor:pointer;transition:border-color .12s,background .12s;}",
      ".sx-exam-opt:hover{border-color:" + P.iris + ";background:rgba(120,85,250,.10);}",
      ".sx-exam-opt .k{flex:0 0 22px;height:22px;border-radius:6px;background:rgba(255,255,255,.10);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:" + P.dim + ";}",
      ".sx-exam-opt.sel{border-color:" + P.aqua + ";background:rgba(31,221,233,.12);}",
      ".sx-exam-opt.sel .k{background:" + P.aqua + ";color:#06222a;}",
      ".sx-exam-opt.ok{border-color:" + P.mantis + ";background:rgba(146,221,35,.16);}",
      ".sx-exam-opt.bad{border-color:" + P.peach + ";background:rgba(255,107,91,.16);}",
      ".sx-exam-opt:disabled{cursor:default;}",
      ".sx-exam-multi{font-size:12px;color:" + P.aqua + ";margin:11px 1px 2px;font-weight:600;}",
      ".sx-exam-submit{margin-top:13px;width:100%;background:linear-gradient(90deg," + P.iris + "," + P.aqua + ");border:0;color:#fff;border-radius:11px;padding:13px;font:700 15px Montserrat,Arial,sans-serif;cursor:pointer;opacity:.5;pointer-events:none;}",
      ".sx-exam-submit.on{opacity:1;pointer-events:auto;}",
      // end screen
      ".sx-exam-end{width:100%;max-width:760px;background:rgba(16,18,38,.9);border:1px solid rgba(120,85,250,.3);border-radius:18px;padding:26px;text-align:center;}",
      ".sx-exam-verdict{font-size:15px;letter-spacing:.18em;text-transform:uppercase;font-weight:800;}",
      ".sx-exam-verdict.pass{color:" + P.mantis + ";} .sx-exam-verdict.fail{color:" + P.peach + ";}",
      ".sx-exam-pct{font-size:64px;font-weight:800;line-height:1.05;margin:6px 0 2px;font-variant-numeric:tabular-nums;}",
      ".sx-exam-sub{color:" + P.dim + ";font-size:14px;margin-bottom:18px;}",
      ".sx-exam-statline{display:flex;gap:14px;justify-content:center;flex-wrap:wrap;margin-bottom:20px;}",
      ".sx-exam-best{font-size:13px;font-weight:700;color:" + P.dim + ";margin:-8px 0 18px;}",
      ".sx-exam-best.new{color:" + P.gold + ";font-size:15px;letter-spacing:.02em;}",
      ".sx-exam-stat{background:rgba(255,255,255,.05);border-radius:12px;padding:12px 18px;min-width:120px;}",
      ".sx-exam-stat b{display:block;font-size:24px;font-weight:800;color:" + P.gold + ";font-variant-numeric:tabular-nums;}",
      ".sx-exam-stat span{font-size:11.5px;color:" + P.dim + ";letter-spacing:.03em;}",
      ".sx-exam-dom{text-align:left;margin:4px 0 18px;}",
      ".sx-exam-dom h4{font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:" + P.dim + ";margin:0 0 9px;}",
      ".sx-exam-domrow{display:flex;align-items:center;gap:10px;margin:5px 0;font-size:13px;}",
      ".sx-exam-domrow .n{flex:0 0 118px;color:" + P.ink + ";text-transform:capitalize;}",
      ".sx-exam-dombar{flex:1;height:7px;border-radius:5px;background:rgba(255,255,255,.08);overflow:hidden;}",
      ".sx-exam-dombar > i{display:block;height:100%;}",
      ".sx-exam-domrow .c{flex:0 0 52px;text-align:right;color:" + P.dim + ";font-variant-numeric:tabular-nums;}",
      ".sx-exam-review{text-align:left;max-height:280px;overflow-y:auto;margin:6px 0 18px;border-top:1px solid rgba(255,255,255,.1);}",
      ".sx-exam-rv{padding:12px 2px;border-bottom:1px solid rgba(255,255,255,.08);}",
      ".sx-exam-rv .q{font-size:14px;font-weight:600;margin-bottom:7px;}",
      ".sx-exam-rv .a{font-size:12.5px;margin:3px 0;}",
      ".sx-exam-rv .a.ok{color:" + P.mantis + ";} .sx-exam-rv .a.bad{color:" + P.peach + ";}",
      ".sx-exam-rv .ex{font-size:12.5px;color:" + P.dim + ";margin-top:6px;line-height:1.5;}",
      ".sx-exam-actions{display:flex;gap:12px;justify-content:center;}",
      ".sx-exam-btn{border:0;border-radius:11px;padding:12px 22px;font:700 14px Montserrat,Arial,sans-serif;cursor:pointer;}",
      ".sx-exam-btn.primary{background:linear-gradient(90deg," + P.iris + "," + P.aqua + ");color:#fff;}",
      ".sx-exam-btn.ghost{background:transparent;border:1px solid rgba(255,255,255,.2);color:" + P.dim + ";}",
      ".sx-exam-opt.sel{outline:2px solid " + P.aqua + ";outline-offset:-2px;background:rgba(31,221,233,.10);}",
      ".sx-exam-confirm{display:block;margin:14px auto 0;border:0;border-radius:11px;padding:12px 30px;font:700 14px Montserrat,Arial,sans-serif;cursor:pointer;background:linear-gradient(90deg," + P.iris + "," + P.aqua + ");color:#fff;opacity:.35;pointer-events:none;}",
      ".sx-exam-confirm.on{opacity:1;pointer-events:auto;}",
      ".sx-exam-fb{margin-top:16px;padding:14px 16px;border-radius:12px;background:rgba(20,20,29,.85);border:1px solid rgba(255,255,255,.12);}",
      ".sx-exam-fb .v{font-weight:800;font-size:14px;margin-bottom:6px;}",
      ".sx-exam-fb .v.ok{color:" + P.mantis + ";} .sx-exam-fb .v.bad{color:" + P.peach + ";}",
      ".sx-exam-fb .ex{font-size:14px;line-height:1.55;color:" + P.text + ";}",
      ".sx-exam-fb .on{font-size:13px;line-height:1.5;color:" + P.dim + ";margin-top:8px;}",
      ".sx-exam-nav{display:flex;gap:10px;justify-content:space-between;margin-top:16px;}",
      ".sx-exam-nav .sx-exam-btn{padding:10px 18px;}",
      ".sx-exam-flag{border:1px solid rgba(255,200,87,.5);background:transparent;color:" + P.gold + ";border-radius:11px;padding:10px 16px;font:700 13px Montserrat,Arial,sans-serif;cursor:pointer;}",
      ".sx-exam-flag.on{background:rgba(255,200,87,.16);}",
      ".sx-exam-rvw{max-width:820px;margin:0 auto;}",
      ".sx-exam-rvw h3{font:800 18px Montserrat,Arial,sans-serif;margin:6px 0 12px;}",
      ".sx-exam-rvrow{display:flex;gap:10px;align-items:center;width:100%;text-align:left;background:rgba(20,20,29,.7);border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:10px 12px;margin-bottom:8px;color:" + P.text + ";cursor:pointer;font:500 13px Montserrat,Arial,sans-serif;}",
      ".sx-exam-rvrow .n{color:" + P.dim + ";min-width:34px;} .sx-exam-rvrow .st{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
      ".sx-exam-rvrow .tag{font-size:11px;font-weight:800;} .sx-exam-rvrow .tag.blank{color:" + P.peach + ";} .sx-exam-rvrow .tag.done{color:" + P.mantis + ";} .sx-exam-rvrow .tag.flag{color:" + P.gold + ";margin-left:6px;}",
      ".sx-exam-kbd{font-size:11px;color:" + P.dim + ";text-align:center;margin-top:10px;letter-spacing:.04em;}",
      "@media (prefers-reduced-motion: reduce){.sx-exam-meter > i{transition:none;}}"
    ].join("\n");
    var style = el("style"); style.id = "sx-exam-css"; style.textContent = css; document.head.appendChild(style);
  }

  /* ---- simple procedural 3D backdrop (degrades to null) ------------------- */
  function initBackdrop(canvas, rng, reducedMotion) {
    var THREE = (typeof window !== "undefined") ? window.THREE : (typeof self !== "undefined" ? self.THREE : undefined);
    if (!THREE || !canvas) return null;
    try {
      var w = canvas.clientWidth || 800, h = canvas.clientHeight || 600;
      var renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: false });
      renderer.setPixelRatio(Math.min(2, (window.devicePixelRatio || 1)));
      renderer.setSize(w, h, false);
      var scene = new THREE.Scene();
      var camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 1000); camera.position.z = 46;
      var N = reducedMotion ? 240 : 520, pos = new Float32Array(N * 3);
      for (var i = 0; i < N; i++) { pos[i * 3] = (rng() - 0.5) * 200; pos[i * 3 + 1] = (rng() - 0.5) * 130; pos[i * 3 + 2] = (rng() - 0.5) * 200; }
      var geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      var mat = new THREE.PointsMaterial({ color: 0x7f8be0, size: 0.75, transparent: true, opacity: 0.7, sizeAttenuation: true });
      var stars = new THREE.Points(geo, mat); scene.add(stars);
      // two dim drifting nebula planes for depth (kept very faint)
      var neb = [];
      try {
        for (var p = 0; p < 2; p++) {
          var pm = new THREE.MeshBasicMaterial({ color: p ? 0x4a2e8e : 0x123b54, transparent: true, opacity: 0.10, depthWrite: false });
          var pl = new THREE.Mesh(new THREE.PlaneGeometry(180, 120), pm);
          pl.position.set((rng() - 0.5) * 60, (rng() - 0.5) * 40, -60 - p * 20); scene.add(pl); neb.push({ mesh: pl, mat: pm });
        }
      } catch (e2) {}
      return { THREE: THREE, renderer: renderer, scene: scene, camera: camera, stars: stars, geo: geo, mat: mat, neb: neb, reducedMotion: reducedMotion, w: w, h: h };
    } catch (e) { return null; }
  }

  function disposeBackdrop(bg) {
    if (!bg) return;
    try { bg.geo.dispose(); bg.mat.dispose(); (bg.neb || []).forEach(function (n) { n.mesh.geometry.dispose(); n.mat.dispose(); }); bg.renderer.dispose(); } catch (e) {}
  }

  /* ---- run ---------------------------------------------------------------- */
  // Modes: 'blitz' (default — the original speed game: per-question decay timer, first
  // click commits), 'study' (untimed, select→confirm, explanation after every answer,
  // back-browse graded questions), 'sim' (one whole-exam clock like the real NCP-MCI,
  // free navigation, flag-for-review, grade only at final submit).
  var SIM_SECS_PER_Q = 96;   // 120 min / 75 q on the real exam
  var EXTRA_FACTOR = 1.6;    // (v0.84.0, B2) mirrors core TIMER.EXTRA_FACTOR — a11y extra time

  function run(opts) {
    opts = opts || {};
    injectCSS();
    var container = opts.container; if (!container) return;
    // (v0.84.0, B2) 'Extra time on timed questions' finally reaches the ONE heavily-timed
    // surface. (v0.90.0 correction) the curve is identical only as a FRACTION of the window —
    // the same absolute answer time scores more under a stretched window, so Blitz bests are
    // kept in a separate ':xt' slot by the shell rather than mixed into one leaderboard.
    var XT = opts.extraTime ? EXTRA_FACTOR : 1;
    var rngIn = opts.rng || Math.random;
    var rng = (typeof rngIn === "function") ? rngIn : ((rngIn && typeof rngIn.next === "function") ? rngIn.next : Math.random);
    var audio = opts.audio || null;
    var mastery = opts.mastery || null;
    var onExit = typeof opts.onExit === "function" ? opts.onExit : function () {};
    var reducedMotion = !!opts.reducedMotion;
    var mode = (opts.mode === "study" || opts.mode === "sim") ? opts.mode : "blitz";
    var nowMs = function () { return (root.performance && root.performance.now) ? root.performance.now() : Date.now(); };
    var RAF = root.requestAnimationFrame ? root.requestAnimationFrame.bind(root) : function (cb) { return setTimeout(function () { cb(nowMs()); }, 16); };
    var CAF = root.cancelAnimationFrame ? root.cancelAnimationFrame.bind(root) : clearTimeout;

    var pool = (opts.questions && opts.questions.length) ? opts.questions.slice() : [];
    var order = shuffle(pool, rng);
    if (opts.count && opts.count > 0 && opts.count < order.length) order = order.slice(0, opts.count);
    order = order.map(function (q) { return shuffleOptions(q, rng); });

    var S = { running: true, mode: mode, i: 0, view: 0, results: [], score: 0, locked: false,
      combo: 0,                                        // (v0.58.0) blitz-only consecutive-correct chain
      qStart: null, qWindow: 0, examDone: false, raf: 0, listeners: [], bg: null, multiSel: [],
      selected: null,                                  // study: pending single choice
      drafts: [], flags: [], simEnd: 0 };              // sim: editable answers + review flags + deadline
    S.order = order;
    for (var di = 0; di < order.length; di++) { S.drafts.push(null); S.flags.push(false); }
    function on(t, type, fn) { t.addEventListener(type, fn); S.listeners.push({ t: t, type: type, fn: fn }); }

    container.textContent = "";
    var rootEl = el("div", "sx-exam");
    // (v0.74.0, Jason's ask) the title screen's nebula backs the whole NIT — the alpha-true
    // starfield canvas floats over it; a darkening gradient keeps the text-heavy cards
    // readable. Missing asset -> the flat PALETTE.bg fallback (unchanged behavior).
    try {
      var nebBg = (typeof window !== "undefined") && window.STARNIX_ASSETS && window.STARNIX_ASSETS.nebulaBg;
      if (nebBg) {
        rootEl.style.backgroundImage = 'linear-gradient(rgba(7,7,16,.62), rgba(7,7,16,.82)), url("' + nebBg + '")';
        rootEl.style.backgroundSize = "cover";
        rootEl.style.backgroundPosition = "center";
      }
    } catch (eBg) {}
    // (v0.50.0) exhibit lightbox: click any exhibit image to enlarge; click the overlay to close.
    // Delegated on rootEl so it survives every innerHTML rebuild and dies with the screen.
    rootEl.addEventListener("click", function (ev) {
      var t = ev.target;
      if (t && t.tagName === "IMG" && t.parentNode && /sx-exam-exhibit/.test(t.parentNode.className || "")) {
        var zoom = el("div", "sx-exhibit-zoom");
        zoom.style.cssText = "position:fixed;inset:0;z-index:120;background:rgba(5,5,12,.9);display:flex;align-items:center;justify-content:center;cursor:zoom-out;";
        var big = el("img"); big.src = t.src; big.alt = t.alt || "exhibit";
        big.style.cssText = "max-width:94vw;max-height:92vh;border-radius:12px;border:1px solid rgba(255,255,255,0.2);box-shadow:0 24px 80px rgba(0,0,0,.7);";
        zoom.appendChild(big); rootEl.appendChild(zoom);
        zoom.addEventListener("click", function () { if (zoom.parentNode) zoom.parentNode.removeChild(zoom); });
      }
    });
    if (!order.length) {
      rootEl.innerHTML = '<div class="sx-exam-wrap"><div class="sx-exam-card"><div class="sx-exam-stem">No questions are available for the exam.</div></div></div>';
      container.appendChild(rootEl);
      return;
    }
    var canvas = el("canvas", "sx-exam-bg"); rootEl.appendChild(canvas);
    var wrap = el("div", "sx-exam-wrap");
    wrap.innerHTML =
      '<div class="sx-exam-top"><span class="sx-exam-prog"></span><span class="sx-exam-combo"></span><span class="sx-exam-score"></span><button class="sx-exam-quit" type="button">End exam</button></div>' +
      '<div class="sx-exam-bars"><div class="sx-exam-meterlbl"><span class="pts"></span><span class="tmr"></span></div><div class="sx-exam-meter"><i></i></div></div>' +
      '<div class="sx-exam-host"></div>';
    rootEl.appendChild(wrap);
    container.appendChild(rootEl);

    var progEl = wrap.querySelector(".sx-exam-prog");
    var scoreEl = wrap.querySelector(".sx-exam-score");
    var comboEl = wrap.querySelector(".sx-exam-combo");
    // (v0.58.0) blitz combo meter: shows the chain + the multiplier the NEXT correct earns.
    // Hidden at chain 0 and in Study/Sim. Pulse on growth; reduced-motion stays static.
    function renderCombo(grew) {
      if (!comboEl) return;
      if (S.mode !== "blitz" || S.combo < 1) { comboEl.textContent = ""; comboEl.className = "sx-exam-combo"; return; }
      comboEl.textContent = "⚡ " + S.combo + " chain · ×" + comboMult(S.combo).toFixed(1);
      comboEl.className = "sx-exam-combo on" + ((grew && !reducedMotion) ? " pulse" : "");
    }
    var meterFill = wrap.querySelector(".sx-exam-meter > i");
    var ptsEl = wrap.querySelector(".sx-exam-meterlbl .pts");
    var tmrEl = wrap.querySelector(".sx-exam-meterlbl .tmr");
    var host = wrap.querySelector(".sx-exam-host");
    var barsEl = wrap.querySelector(".sx-exam-bars");
    on(wrap.querySelector(".sx-exam-quit"), "click", function () { if (S.mode === "sim" && !S.examDone) submitSim(true); else finish(true); });

    S.bg = initBackdrop(canvas, rng, reducedMotion);
    if (S.mode === "sim") S.simEnd = nowMs() + order.length * SIM_SECS_PER_Q * 1000 * XT;
    if (S.mode === "study") barsEl.style.visibility = "hidden";

    function fmtClock(ms) {
      var s = Math.max(0, Math.ceil(ms / 1000)), m = Math.floor(s / 60);
      return m + ":" + ("0" + (s % 60)).slice(-2);
    }

    function frame() {
      if (!S.running) return;
      if (S.bg) {
        if (!S.bg.reducedMotion) { S.bg.stars.rotation.y += 0.0009; S.bg.stars.rotation.x += 0.00035; (S.bg.neb || []).forEach(function (n, k) { n.mesh.rotation.z += (k ? -0.0006 : 0.0005); }); }
        try { S.bg.renderer.render(S.bg.scene, S.bg.camera); } catch (e) {}
      }
      if (!S.examDone) {
        if (S.mode === "blitz" && S.qStart != null && !S.locked) {
          var elapsed = nowMs() - S.qStart;
          var frac = clamp(1 - elapsed / S.qWindow, 0, 1);
          var pts = pointsAt(elapsed, S.qWindow, MAX_POINTS);
          if (meterFill) meterFill.style.width = (frac * 100).toFixed(1) + "%";
          if (ptsEl) ptsEl.textContent = pts + " pts on the clock";
          if (tmrEl) tmrEl.textContent = Math.ceil(Math.max(0, S.qWindow - elapsed) / 1000) + "s";
          if (elapsed >= S.qWindow) commit(null);
        } else if (S.mode === "sim") {
          var rem = S.simEnd - nowMs(), tot = S.order.length * SIM_SECS_PER_Q * 1000 * XT;
          if (meterFill) meterFill.style.width = (clamp(rem / tot, 0, 1) * 100).toFixed(1) + "%";
          var ans = 0; for (var k = 0; k < S.drafts.length; k++) if (S.drafts[k] != null) ans++;
          if (ptsEl) ptsEl.textContent = ans + " of " + S.order.length + " answered";
          if (tmrEl) tmrEl.textContent = fmtClock(rem);
          if (rem <= 0) submitSim(false);
        }
      }
      S.raf = RAF(frame);
    }
    S.raf = RAF(frame);

    /* ---- question rendering (all modes) ---------------------------------- */
    function renderQuestion(idx) {
      S.locked = false; S.multiSel = []; S.selected = null; S.view = idx;
      var q = order[idx];
      var multi = Array.isArray(q.correctIndices) && q.correctIndices.length;
      var graded = (S.mode !== "sim") && !!S.results[idx];        // study back-browse: read-only graded view
      progEl.textContent = "Question " + (idx + 1) + " of " + order.length;
      scoreEl.textContent = (S.mode === "blitz") ? (S.score + " pts") : (S.mode === "sim" ? "Exam sim" : "Study");
      if (S.mode === "blitz") barsEl.style.visibility = "visible";

      var card = el("div", "sx-exam-card");
      var inner = '<div class="sx-exam-eyebrow">' + esc(q.domain) + " &middot; difficulty " + (q.difficulty || 2) + '</div><div class="sx-exam-stem">' + esc(q.stem) + "</div>";
      if (q.image) {
        var exMap = (root && root.STARNIX_EXHIBITS) || {};
        var exSrc = exMap[q.image];
        if (exSrc) inner += '<div class="sx-exam-exhibit" style="margin:2px 0 14px;"><img src="' + exSrc + '" alt="exhibit ' + esc(q.image) + '" style="display:block;max-width:100%;max-height:46vh;margin:0 auto;border-radius:10px;border:1px solid rgba(255,255,255,0.14);background:#0c0c16;" /></div>';
        else inner += '<div class="sx-exam-imgnote" style="font-size:12px;color:' + PALETTE.peach + ';margin:-6px 0 12px;">[exhibit ' + esc(q.image) + " — image pending]</div>";
      }
      inner += '<div class="sx-exam-opts"></div>';
      if (multi) inner += '<div class="sx-exam-multi">Select ' + q.correctIndices.length + " answers." + (S.mode === "blitz" ? " Then Submit." : "") + '</div>';
      if (S.mode === "blitz" && multi) inner += '<button class="sx-exam-submit" type="button">Submit</button>';
      if (S.mode === "study" && !graded) inner += '<button class="sx-exam-confirm" type="button">Confirm answer</button>';
      card.innerHTML = inner;
      var optsHost = card.querySelector(".sx-exam-opts");
      var letters = "ABCDE";
      var draft = S.drafts[idx];

      q.options.forEach(function (text, oi) {
        var b = el("button", "sx-exam-opt"); b.type = "button";
        b.innerHTML = '<span class="k">' + letters.charAt(oi) + '</span><span class="t">' + esc(text) + "</span>";
        if (S.mode === "sim" && draft != null) {
          var dArr = Array.isArray(draft) ? draft : [draft];
          if (dArr.indexOf(oi) >= 0) b.classList.add("sel");
        }
        on(b, "click", function () { pick(oi, b, card); });
        optsHost.appendChild(b);
      });

      if (S.mode === "blitz" && multi) {
        var sub = card.querySelector(".sx-exam-submit");
        on(sub, "click", function () { if (!S.locked && S.multiSel.length === q.correctIndices.length) commit(S.multiSel.slice()); });
      }
      if (S.mode === "study" && !graded) {
        var cf = card.querySelector(".sx-exam-confirm");
        on(cf, "click", function () {
          if (S.locked) return;
          if (multi) { if (S.multiSel.length >= 1) commit(S.multiSel.slice()); }
          else if (S.selected != null) commit(S.selected);
        });
      }
      if (S.mode === "sim") {
        var nav = el("div", "sx-exam-nav");
        var pv = el("button", "sx-exam-btn ghost", "&larr; Previous"); pv.type = "button"; pv.disabled = (idx === 0);
        var fg = el("button", "sx-exam-flag" + (S.flags[idx] ? " on" : ""), (S.flags[idx] ? "&#9873; Flagged" : "&#9873; Flag for review")); fg.type = "button";
        var nx = el("button", "sx-exam-btn primary", idx === order.length - 1 ? "Review &rarr;" : "Next &rarr;"); nx.type = "button";
        on(pv, "click", function () { if (idx > 0) renderQuestion(idx - 1); });
        on(fg, "click", function () { S.flags[idx] = !S.flags[idx]; fg.classList.toggle("on", S.flags[idx]); fg.innerHTML = S.flags[idx] ? "&#9873; Flagged" : "&#9873; Flag for review"; });
        on(nx, "click", function () { if (idx === order.length - 1) renderReview(); else renderQuestion(idx + 1); });
        nav.appendChild(pv); nav.appendChild(fg); nav.appendChild(nx);
        card.appendChild(nav);
      }
      if (S.mode !== "blitz") card.appendChild(el("div", "sx-exam-kbd", "A&ndash;E select &middot; Enter " + (S.mode === "sim" ? "next" : "confirm") + " &middot; &larr;/&rarr; navigate" + (S.mode === "sim" ? " &middot; F flag" : "")));

      host.textContent = ""; host.appendChild(card);
      if (graded) paintGraded(idx, card);
      else if (S.mode === "blitz") { S.qStart = nowMs(); S.qWindow = windowFor(q.difficulty) * XT; }
    }

    // A single option was clicked/keyed — behavior depends on mode.
    function pick(oi, btnEl, card) {
      if (S.locked) return;
      var q = order[S.view];
      var multi = Array.isArray(q.correctIndices) && q.correctIndices.length;
      if (S.mode === "blitz") { if (multi) toggleMulti(oi, btnEl, card); else commit(oi); return; }
      if ((S.mode === "study") && S.results[S.view]) return;      // graded view is read-only
      var host2 = card || host;
      if (multi) {
        var k = S.multiSel.indexOf(oi);
        if (k >= 0) S.multiSel.splice(k, 1); else S.multiSel.push(oi);
        btnEl.classList.toggle("sel", k < 0);
        if (S.mode === "sim") S.drafts[S.view] = S.multiSel.length ? S.multiSel.slice() : null;
        var hint = host2.querySelector(".sx-exam-multi");
        if (hint) hint.textContent = "Select " + q.correctIndices.length + " answers \u00b7 " + S.multiSel.length + " selected.";
        var cf1 = host2.querySelector(".sx-exam-confirm"); if (cf1) cf1.classList.toggle("on", S.multiSel.length >= 1);
      } else {
        var all = host2.querySelectorAll(".sx-exam-opt");
        for (var bi = 0; bi < all.length; bi++) all[bi].classList.remove("sel");
        btnEl.classList.add("sel");
        S.selected = oi;
        if (S.mode === "sim") S.drafts[S.view] = oi;
        var cf2 = host2.querySelector(".sx-exam-confirm"); if (cf2) cf2.classList.add("on");
      }
    }

    function toggleMulti(oi, btn, card) {           // blitz multi (original behavior + live hint)
      var k = S.multiSel.indexOf(oi);
      if (k >= 0) { S.multiSel.splice(k, 1); btn.classList.remove("sel"); } else { S.multiSel.push(oi); btn.classList.add("sel"); }
      var q = order[S.i]; var sub = card.querySelector(".sx-exam-submit");
      if (sub) sub.classList.toggle("on", S.multiSel.length === q.correctIndices.length);
      var hint = card.querySelector(".sx-exam-multi");
      if (hint) hint.textContent = "Select " + q.correctIndices.length + " answers \u00b7 " + S.multiSel.length + " selected. Then Submit.";
    }

    /* ---- grading + feedback ---------------------------------------------- */
    function paintGraded(idx, card) {               // mark options + attach explanation (study feedback + back-browse)
      var q = order[idx], r = S.results[idx];
      var correctSet = Array.isArray(q.correctIndices) ? q.correctIndices : [q.correctIndex];
      var chosenArr = Array.isArray(r.chosen) ? r.chosen : (r.chosen == null ? [] : [r.chosen]);
      var btns = card.querySelectorAll(".sx-exam-opt");
      for (var bi = 0; bi < btns.length; bi++) {
        btns[bi].disabled = true; btns[bi].classList.remove("sel");
        if (correctSet.indexOf(bi) >= 0) btns[bi].classList.add("ok");
        else if (chosenArr.indexOf(bi) >= 0) btns[bi].classList.add("bad");
      }
      var cf = card.querySelector(".sx-exam-confirm"); if (cf) cf.style.display = "none";
      var fb = el("div", "sx-exam-fb");
      var h = '<div class="v ' + (r.correct ? "ok" : "bad") + '">' + (r.correct ? "Correct" : "Not quite") + "</div>";
      if (q.explanation) h += capExplainHTML(q.explanation);   // (J8) 150-word display cap
      if (q.optionNotes) {
        for (var ci = 0; ci < chosenArr.length; ci++) {
          var oi = chosenArr[ci];
          if (correctSet.indexOf(oi) < 0 && q.optionNotes[oi]) h += '<div class="on"><b>' + esc(q.options[oi]) + ":</b> " + esc(q.optionNotes[oi]) + "</div>";
        }
      }
      fb.innerHTML = h;
      var nav = el("div", "sx-exam-nav");
      var pv = el("button", "sx-exam-btn ghost", "&larr; Previous"); pv.type = "button"; pv.disabled = (idx === 0);
      var isLastAnswered = (idx === S.results.length - 1);
      var nx = el("button", "sx-exam-btn primary", (isLastAnswered && S.results.length === order.length) ? "Results &rarr;" : "Next &rarr;"); nx.type = "button";
      on(pv, "click", function () { if (idx > 0) renderQuestion(idx - 1); });
      on(nx, "click", function () {
        if (idx + 1 < S.results.length) renderQuestion(idx + 1);              // browsing forward through graded
        else if (S.results.length >= order.length) finish(false);             // everything answered
        else renderQuestion(S.results.length);                                // back to the frontier
      });
      nav.appendChild(pv); nav.appendChild(nx);
      fb.appendChild(nav);
      card.appendChild(fb);
    }

    function commit(chosen) {                        // blitz + study: grade the current frontier question
      if (S.locked) return; S.locked = true;
      var idx = (S.mode === "study") ? S.view : S.i;
      var q = order[idx];
      var correct = gradeAnswer(q, chosen);
      var elapsed = (S.mode === "blitz" && S.qStart != null) ? (nowMs() - S.qStart) : 0;
      // (v0.58.0) blitz combo: the chain multiplies the decayed points; wrong/timeout resets it
      var pts = (S.mode === "blitz" && correct) ? Math.round(pointsAt(elapsed, S.qWindow, MAX_POINTS) * comboMult(S.combo)) : 0;
      S.results[idx] = { q: q, chosen: chosen, correct: correct, points: pts, timeMs: elapsed };
      S.score += pts;
      if (S.mode === "blitz") { S.combo = correct ? S.combo + 1 : 0; renderCombo(correct); }
      if (mastery && mastery.record) { try { mastery.record(q.id, correct, { game: "EXAM" }); } catch (e) {} }
      if (audio && audio.sfx) { try { audio.sfx(correct ? "correct" : "wrong"); } catch (e) {} }
      scoreEl.textContent = (S.mode === "blitz") ? (S.score + " pts") : scoreEl.textContent;

      if (S.mode === "study") {                      // hold: mark + explanation + Next (no auto-advance)
        S.locked = false;
        var card = host.querySelector(".sx-exam-card");
        if (card) paintGraded(idx, card);
        return;
      }
      // blitz: brief reveal, then auto-advance (original behavior)
      var btns = host.querySelectorAll(".sx-exam-opt");
      var correctSet = Array.isArray(q.correctIndices) ? q.correctIndices : [q.correctIndex];
      var chosenArr = Array.isArray(chosen) ? chosen : (chosen == null ? [] : [chosen]);
      for (var bi = 0; bi < btns.length; bi++) {
        btns[bi].disabled = true;
        if (correctSet.indexOf(bi) >= 0) btns[bi].classList.add("ok");
        else if (chosenArr.indexOf(bi) >= 0) btns[bi].classList.add("bad");
      }
      setTimeout(next, correct ? 260 : 560);
    }

    function next() { S.i++; if (S.i >= order.length) finish(false); else renderQuestion(S.i); }

    /* ---- sim: review + submit --------------------------------------------- */
    function renderReview() {
      progEl.textContent = "Review"; barsEl.style.visibility = "visible";
      var rv = el("div", "sx-exam-rvw");
      var blanks = 0; for (var k = 0; k < S.drafts.length; k++) if (S.drafts[k] == null) blanks++;
      var h = "<h3>Review before you submit</h3>";
      h += '<div class="sx-exam-sub" style="margin-bottom:12px;">' + (S.drafts.length - blanks) + " answered &middot; " + blanks + " blank &middot; " + S.flags.filter(Boolean).length + " flagged</div>";
      rv.innerHTML = h;
      order.forEach(function (q, qi) {
        var row = el("button", "sx-exam-rvrow"); row.type = "button";
        row.innerHTML = '<span class="n">' + (qi + 1) + '</span><span class="st">' + esc(q.stem) + '</span>' +
          '<span class="tag ' + (S.drafts[qi] == null ? 'blank">blank' : 'done">answered') + "</span>" +
          (S.flags[qi] ? '<span class="tag flag">&#9873;</span>' : "");
        on(row, "click", function () { renderQuestion(qi); });
        rv.appendChild(row);
      });
      var nav = el("div", "sx-exam-nav");
      var back = el("button", "sx-exam-btn ghost", "&larr; Back to questions"); back.type = "button";
      var sub = el("button", "sx-exam-btn primary", "Submit exam"); sub.type = "button";
      on(back, "click", function () { renderQuestion(S.order.length - 1); });
      on(sub, "click", function () { submitSim(false); });
      nav.appendChild(back); nav.appendChild(sub);
      rv.appendChild(nav);
      host.textContent = ""; host.appendChild(rv);
    }

    function submitSim(abandoned) {                  // grade every draft in order; mastery at submit
      if (S.examDone) return;
      S.results = [];
      for (var qi = 0; qi < order.length; qi++) {
        var q = order[qi], chosen = S.drafts[qi];
        var correct = gradeAnswer(q, chosen);
        S.results.push({ q: q, chosen: chosen, correct: correct, points: 0, timeMs: 0 });
        if (mastery && mastery.record) { try { mastery.record(q.id, correct, { game: "EXAM" }); } catch (e) {} }
      }
      finish(!!abandoned);
    }

    /* ---- keyboard ---------------------------------------------------------- */
    if (root.document) on(root.document, "keydown", function (ev) {
      if (!S.running || S.examDone) return;
      var key = ev.key || "";
      var card = host.querySelector(".sx-exam-card");
      var kIdx = "abcde".indexOf(key.toLowerCase());
      if (kIdx >= 0 && card) {
        var btns = card.querySelectorAll(".sx-exam-opt");
        if (btns[kIdx] && !btns[kIdx].disabled) btns[kIdx].click();
      } else if (key === "Enter") {
        if (S.mode === "study") { var cf = card && card.querySelector(".sx-exam-confirm.on"); if (cf) cf.click(); else { var nx = host.querySelector(".sx-exam-fb .primary"); if (nx) nx.click(); } }
        else if (S.mode === "sim") { var nx2 = card && card.querySelector(".sx-exam-nav .primary"); if (nx2) nx2.click(); }
        else { var sb = card && card.querySelector(".sx-exam-submit.on"); if (sb) sb.click(); }
      } else if (key === "ArrowLeft" && S.mode !== "blitz") {
        var pv = host.querySelector(".sx-exam-nav .ghost"); if (pv && !pv.disabled) pv.click();
      } else if (key === "ArrowRight" && S.mode !== "blitz") {
        var nx3 = host.querySelector(".sx-exam-nav .primary"); if (nx3) nx3.click();
      } else if ((key === "f" || key === "F") && S.mode === "sim") {
        var fg = host.querySelector(".sx-exam-flag"); if (fg) fg.click();
      }
    });

    /* ---- results ----------------------------------------------------------- */
    function finish(abandoned) {
      S.examDone = true;
      var sum = summarize(S.results, abandoned ? S.results.length : order.length);
      sum.mode = S.mode;
      if (!abandoned && typeof opts.onComplete === "function") { try { opts.onComplete(sum); } catch (e) {} }
      barsEl.style.visibility = "hidden";
      progEl.textContent = "Results";
      scoreEl.textContent = (S.mode === "blitz") ? (S.score + " pts") : "";

      var end = el("div", "sx-exam-end");
      var avgS = S.results.length ? (S.results.reduce(function (a, r) { return a + r.timeMs; }, 0) / S.results.length / 1000) : 0;
      var html = "";
      if (!abandoned) html += '<div class="sx-exam-verdict ' + (sum.pass ? "pass" : "fail") + '">' + (sum.pass ? "PASS" : "Not yet passing") + "</div>";
      html += '<div class="sx-exam-pct">' + sum.pct + "%</div>";
      html += '<div class="sx-exam-sub">' + sum.correct + " of " + sum.total + " correct" + (abandoned ? " &middot; exam ended early" : " &middot; pass mark 80%") + "</div>";
      if (S.mode === "blitz") {
        html += '<div class="sx-exam-statline">' +
          '<div class="sx-exam-stat"><b>' + sum.speedPoints.toLocaleString() + '</b><span>SPEED POINTS</span></div>' +
          '<div class="sx-exam-stat"><b>' + sum.correct + "/" + sum.total + '</b><span>CORRECT</span></div>' +
          '<div class="sx-exam-stat"><b>' + avgS.toFixed(1) + 's</b><span>AVG / QUESTION</span></div></div>';
        var prevBest = opts.bestPoints || 0;
        if (!abandoned) {
          if (sum.speedPoints > prevBest) html += '<div class="sx-exam-best new">\uD83C\uDFC6 New best speed score!</div>';
          else if (prevBest > 0) html += '<div class="sx-exam-best">Best for this length: ' + prevBest.toLocaleString() + ' pts</div>';
        }
      }

      // per-domain, weakest first
      var doms = Object.keys(sum.byDomain).map(function (d) { var o = sum.byDomain[d]; return { d: d, pct: o.total ? o.correct / o.total : 0, c: o.correct, t: o.total }; });
      doms.sort(function (a, b) { return a.pct - b.pct; });
      if (doms.length) {
        html += '<div class="sx-exam-dom"><h4>By domain &middot; weakest first</h4>';
        doms.forEach(function (r) {
          var col = r.pct >= 0.67 ? PALETTE.mantis : (r.pct >= 0.34 ? PALETTE.gold : PALETTE.peach);
          html += '<div class="sx-exam-domrow"><span class="n">' + esc(r.d) + '</span><span class="sx-exam-dombar"><i style="width:' + Math.round(r.pct * 100) + "%;background:" + col + '"></i></span><span class="c">' + r.c + "/" + r.t + "</span></div>";
        });
        html += "</div>";
      }

      // review of missed questions
      if (sum.wrong.length) {
        html += '<div class="sx-exam-dom"><h4>Review &middot; ' + sum.wrong.length + " missed</h4></div>";
        html += '<div class="sx-exam-review"></div>';
      }
      var redrill = (sum.wrong.length && typeof opts.onRedrill === "function")
        ? '<button class="sx-exam-btn primary" type="button" data-a="redrill">Redrill the ' + sum.wrong.length + ' missed \u25b8</button>' : "";   // (v0.87.0, L2)
      html += '<div class="sx-exam-actions">' + redrill + '<button class="sx-exam-btn ' + (redrill ? "ghost" : "primary") + '" type="button" data-a="retry">Retake</button><button class="sx-exam-btn ghost" type="button" data-a="menu">&larr; Menu</button></div>';
      end.innerHTML = html;

      if (sum.wrong.length) {
        var rv = end.querySelector(".sx-exam-review");
        sum.wrong.forEach(function (r) {
          var q = r.q;
          var correctSet = Array.isArray(q.correctIndices) ? q.correctIndices : [q.correctIndex];
          var chosenArr = Array.isArray(r.chosen) ? r.chosen : (r.chosen == null ? [] : [r.chosen]);
          var item = el("div", "sx-exam-rv");
          var s = '<div class="q">' + esc(q.stem) + "</div>";
          var yourTxt = chosenArr.length ? chosenArr.map(function (i) { return esc(q.options[i]); }).join("; ") : "(no answer" + (S.mode === "blitz" ? " — timed out" : "") + ")";
          s += '<div class="a bad">Your answer: ' + yourTxt + "</div>";
          s += '<div class="a ok">Correct: ' + correctSet.map(function (i) { return esc(q.options[i]); }).join("; ") + "</div>";
          if (q.explanation) s += capExplainHTML(q.explanation);   // (J8) 150-word display cap
          item.innerHTML = s; rv.appendChild(item);
        });
      }

      var actions = end.querySelectorAll(".sx-exam-btn[data-a]");
      for (var ai = 0; ai < actions.length; ai++) {
        (function (btn) {
          on(btn, "click", function () {
            var a = btn.getAttribute("data-a");
            teardown();
            // (v0.90.0, review) branches CHAINED — the unchained form also fired onExit on
            // redrill, tearing down the freshly mounted redrill session (feature-dead in prod).
            if (a === "redrill") { opts.onRedrill(sum.wrong.map(function (r) { return r.q; })); }   // (v0.87.0, L2) miss -> immediate retrieval
            else if (a === "retry") { if (typeof opts.onRetry === "function") opts.onRetry(); else run(opts); }
            else onExit();
          });
        })(actions[ai]);
      }

      host.textContent = ""; host.appendChild(end);
    }

    function teardown() {
      S.running = false;
      try { CAF(S.raf); } catch (e) {}
      disposeBackdrop(S.bg); S.bg = null;
      S.listeners.forEach(function (l) { try { l.t.removeEventListener(l.type, l.fn); } catch (e) {} });
      S.listeners = [];
    }

    renderQuestion(0);
    return { teardown: teardown, _state: S };
  }

  return {
    run: run,
    gradeAnswer: gradeAnswer,
    shuffleOptions: shuffleOptions,
    windowFor: windowFor,
    pointsAt: pointsAt,
    summarize: summarize,
    MAX_POINTS: MAX_POINTS,
    SIM_SECS_PER_Q: SIM_SECS_PER_Q,
    comboMult: comboMult,
    version: "2.0"
  };
});
