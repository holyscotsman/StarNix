/* =====================================================================
 * StarNix — shared core  (starnix-core.js)
 * Plain JS. No build step. Attaches everything to window.StarNix.
 *
 * Provides the frozen runtime contract (see 01 §9):
 *   window.StarNix = {
 *     core: { questions, mastery, persistence, rng, audio, theme,
 *             telemetry, ai, profile, ... },
 *     shell,                       // defined by starnix-shell.js
 *     registerGame(module),        // module = { id, mount(root,ctx), unmount() }
 *     registerAudio(impl),         // audio engine seam (real engine = audio.js)
 *     boot(root, opts),            // defined by starnix-shell.js
 *     initCore(opts)               // builds the live core; called by boot
 *   }
 *
 * The core ships a NoopAudio default; the Audio chat's audio.js replaces it
 * via registerAudio(). The core ships a tiny verified NCP-MCI fixture so the
 * shell/games run before the real bank arrives.
 * ===================================================================== */
(function (global) {
  "use strict";

  var StarNix = global.StarNix || (global.StarNix = {});
  var CORE_VERSION = "1.1.0";              // internal contract version (changes rarely)
  // User-facing playable-build stamp. BUMP THIS (and the date) on every delivered index.html so the
  // version shown in-game tells us exactly which build is being played/tested. Shown by the shell.
  var BUILD_VERSION = "0.187.0";
  var BUILD_DATE = "2026-07-03";
  var BUILD_LABEL = "v" + BUILD_VERSION + " \u00b7 " + BUILD_DATE;
  var SCHEMA_VERSION = 1;
  var STORAGE_KEY = "starnix:profile";

  /* ---- injectable clock (tests override core.clock.now) -------------- */
  var clock = { now: function () { return Date.now(); } };

  /* =================================================================== *
   * 1. Seeded RNG  (01 §6)  — mulberry32. No Math.random anywhere here.
   * =================================================================== */
  function hashStr(s) {
    var h = 1779033703 ^ s.length;
    for (var i = 0; i < s.length; i++) {
      h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return h >>> 0;
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function makeRng(seed) {
    var s = (typeof seed === "number") ? (seed >>> 0) : hashStr(String(seed == null ? "" : seed));
    var next = mulberry32(s);
    var rng = {
      seed: s,
      next: next,
      int: function (maxExclusive) { return Math.floor(next() * maxExclusive); },
      range: function (a, b) { return a + next() * (b - a); },
      pick: function (arr) { return arr[Math.floor(next() * arr.length)]; },
      shuffle: function (arr) {
        var a = arr.slice();
        for (var i = a.length - 1; i > 0; i--) {
          var j = Math.floor(next() * (i + 1));
          var t = a[i]; a[i] = a[j]; a[j] = t;
        }
        return a;
      },
      fork: function (salt) { return makeRng((s ^ hashStr(String(salt))) >>> 0); }
    };
    return rng;
  }

  /* =================================================================== *
   * 2. Question schema + validator  (01 §2, 06)  — tiny, Zod-shaped.
   * =================================================================== */
  var DOMAINS = [
    "architecture", "storage", "networking", "security",
    "vms", "data-protection", "lifecycle", "monitoring", "performance"
  ];
  var SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

  function normStem(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  }

  // Validates one question against a domain set. Returns array of error strings.
  function questionErrors(q, domainSet) {
    var e = [];
    if (!q || typeof q !== "object") return ["not an object"];
    if (typeof q.id !== "string" || !q.id) e.push("id: missing/empty");
    else if (!SLUG_RE.test(q.id)) e.push("id: not a slug (" + q.id + ")");
    if (typeof q.cert !== "string" || !q.cert) e.push("cert: missing/empty");
    if (typeof q.domain !== "string" || (domainSet && !domainSet[q.domain])) e.push("domain: invalid (" + q.domain + ")");
    if (q.difficulty !== 1 && q.difficulty !== 2 && q.difficulty !== 3) e.push("difficulty: must be 1|2|3");
    if (typeof q.stem !== "string" || !q.stem.trim()) e.push("stem: missing/empty");
    if (!Array.isArray(q.options)) e.push("options: not an array");
    else {
      if (q.options.length < 3 || q.options.length > 5) e.push("options: length " + q.options.length + " (need 3-5)");
      for (var i = 0; i < q.options.length; i++) {
        if (typeof q.options[i] !== "string" || !q.options[i].trim()) e.push("options[" + i + "]: empty");
      }
    }
    // answer key: single correctIndex, OR multi correctIndices (>=2 distinct, in range)
    if (Array.isArray(q.correctIndices)) {
      if (q.correctIndices.length < 2) e.push("correctIndices: need >=2 for multi");
      var seenCI = {};
      for (var ci = 0; ci < q.correctIndices.length; ci++) {
        var cv = q.correctIndices[ci];
        if (typeof cv !== "number" || (cv | 0) !== cv) e.push("correctIndices: non-integer");
        else if (Array.isArray(q.options) && (cv < 0 || cv >= q.options.length)) e.push("correctIndices: out of range");
        else if (seenCI[cv]) e.push("correctIndices: duplicate index"); else seenCI[cv] = 1;
      }
    } else {
      if (typeof q.correctIndex !== "number" || (q.correctIndex | 0) !== q.correctIndex) e.push("correctIndex: not an integer");
      else if (Array.isArray(q.options) && (q.correctIndex < 0 || q.correctIndex >= q.options.length)) e.push("correctIndex: out of range");
    }
    if (typeof q.explanation !== "string" || !q.explanation.trim()) e.push("explanation: missing/empty");
    if (q.briefing != null && typeof q.briefing !== "string") e.push("briefing: must be string");
    if (q.tags != null && !Array.isArray(q.tags)) e.push("tags: must be array");
    if (q.source != null && typeof q.source !== "string") e.push("source: must be string");
    // Quarantine flags must not reach the live bank (06 §6).
    if (q.review === true) e.push("review:true (must be quarantined out of live bank)");
    // multi-select is now supported via the correctIndices array (graded by set equality).
    return e;
  }

  // Validates a CertPack. Returns { ok, errors:[{id,msg}], stats }.
  function validateBank(pack) {
    var errors = [];
    var stats = { total: 0, byDomain: {}, byDifficulty: { 1: 0, 2: 0, 3: 0 } };
    if (!pack || typeof pack !== "object") return { ok: false, errors: [{ id: "(pack)", msg: "not an object" }], stats: stats };
    var domainList = Array.isArray(pack.domains) ? pack.domains : DOMAINS;
    var domainSet = {};
    for (var d = 0; d < domainList.length; d++) domainSet[domainList[d]] = true;
    var qs = Array.isArray(pack.questions) ? pack.questions : null;
    if (!qs) return { ok: false, errors: [{ id: "(pack)", msg: "questions: not an array" }], stats: stats };

    var seenId = {}, seenStem = {};
    for (var i = 0; i < qs.length; i++) {
      var q = qs[i];
      var errs = questionErrors(q, domainSet);
      var id = (q && q.id) ? q.id : "(index " + i + ")";
      for (var j = 0; j < errs.length; j++) errors.push({ id: id, msg: errs[j] });
      if (q && q.id) {
        if (seenId[q.id]) errors.push({ id: id, msg: "duplicate id" });
        seenId[q.id] = true;
      }
      if (q && typeof q.stem === "string") {
        var ns = normStem(q.stem);
        if (ns && seenStem[ns]) errors.push({ id: id, msg: "duplicate normalized stem (also " + seenStem[ns] + ")" });
        else if (ns) seenStem[ns] = id;
      }
      stats.total++;
      if (q && q.domain) stats.byDomain[q.domain] = (stats.byDomain[q.domain] || 0) + 1;
      if (q && (q.difficulty === 1 || q.difficulty === 2 || q.difficulty === 3)) stats.byDifficulty[q.difficulty]++;
    }
    return { ok: errors.length === 0, errors: errors, stats: stats };
  }

  /* =================================================================== *
   * 3. Leitner / spaced-retrieval policy constants  (01 §3, §4)
   * =================================================================== */
  var MAX_BUCKET = 8;               // (v0.89.0, L5) ladder extended past 24h — see INTERVALS
  var MASTERED_BUCKET = 4;          // summary().masteredCount threshold
  // Review interval per bucket (ms). bucket 0 is always due. (v0.89.0, L5) 3-day and 7-day
  // buckets added: mastered cards stop re-duing EVERY day forever, so the due queue stays a
  // signal instead of ballooning during multi-week exam prep.
  var INTERVALS = [0, 30e3, 2 * 60e3, 10 * 60e3, 60 * 60e3, 6 * 60 * 60e3, 24 * 60 * 60e3, 3 * 24 * 60 * 60e3, 7 * 24 * 60 * 60e3];
  // Selection weights by reason (tunable).
  var W = { due: 6, "new": 3, reinforce: 1, epsilon: 0.12 };

  /* =================================================================== *
   * 4. MasteryStore  (01 §4)
   * =================================================================== */
  function makeMasteryStore(profile, opts) {
    opts = opts || {};
    var onChange = opts.onChange || function () {};
    if (!profile.mastery) profile.mastery = {};
    var map = profile.mastery;

    function init(id) {
      return { id: id, seen: 0, correct: 0, incorrect: 0, streak: 0, bucket: 0, lastSeen: 0 };
    }
    return {
      record: function (id, correct, ctx) {
        var m = map[id] || (map[id] = init(id));
        var now = clock.now();
        var prevBucket = m.bucket;                 // v0.52.0: promotion detection for rank XP
        // (v0.89.0, L4) classic-Leitner gate: a correct answer PROMOTES only if the card was
        // actually DUE — cramming the same card across games in one sitting no longer mints
        // "mastered" (which feeds masteredPct, readiness, trails). Wrong answers always demote.
        var wasDue = !m.seen || (m.lastSeen + (INTERVALS[Math.min(m.bucket, INTERVALS.length - 1)] || 0)) <= now;
        m.seen++;
        // (v0.90.0, review) a non-due CORRECT answer must not restart the interval clock —
        // otherwise early re-answers defer the due date (and thus promotion) indefinitely.
        // Due answers and ALL wrong answers reset it (demotion restarts the rung's interval).
        if (wasDue || !correct) m.lastSeen = now;
        if (correct) {
          m.correct++; m.streak++;
          if (m.bucket < MAX_BUCKET && wasDue) m.bucket++;
          if (!m.firstCorrectAt) m.firstCorrectAt = now;
        } else {
          m.incorrect++; m.streak = 0;
          if (m.bucket > 0) m.bucket--;            // modified Leitner: gentle decay
        }
        // keep lifetime totals in sync for Stats (01 §5)
        if (profile.totals) {
          profile.totals.questionsSeen++;
          if (correct) profile.totals.correct++; else profile.totals.incorrect++;
        }
        // Commander-rank XP (v0.52.0 unit 2): every answer, every surface, feeds the one pool.
        addXP(profile, xpForAnswer(!!correct, prevBucket, m.bucket));
        // Achievements (v0.53.0 unit 3): per-surface answer streaks + unlock evaluation.
        // meta.game tags every caller (ARM/KBB/CC/EXAM); untagged callers pool under MISC.
        var g = (ctx && ctx.game) ? String(ctx.game) : "MISC";
        var sk = profile.streaks || (profile.streaks = {});
        var sb = profile.streaksBest || (profile.streaksBest = {});
        sk[g] = correct ? (sk[g] || 0) + 1 : 0;
        if ((sk[g] || 0) > (sb[g] || 0)) sb[g] = sk[g];
        // (v0.183.0, V1.1 Backend#7) telemetry is REAL: per-question rolling pace aggregates
        // (EMA 0.3) + ONE standardized answer event per grade. 'Slow but correct' is a study
        // signal Leitner buckets can't see; the aggregates are also the scheduler-tuning evidence base.
        var lat = (ctx && typeof ctx.latencyMs === "number" && isFinite(ctx.latencyMs) && ctx.latencyMs >= 0) ? Math.round(ctx.latencyMs) : null;
        var tpc = (ctx && typeof ctx.timerPct === "number" && isFinite(ctx.timerPct) && ctx.timerPct >= 0) ? Math.min(1, ctx.timerPct) : null;
        if (lat != null) {
          var qsA = profile.qstats || (profile.qstats = {});
          var qr = qsA[id] || (qsA[id] = { n: 0, lat: 0, pct: null });
          qr.n++;
          qr.lat = (qr.n === 1) ? lat : Math.round(qr.lat + 0.3 * (lat - qr.lat));
          if (tpc != null) qr.pct = (qr.pct == null) ? tpc : +(qr.pct + 0.3 * (tpc - qr.pct)).toFixed(4);
        }
        if (opts.onAnswer) {
          try { opts.onAnswer({ t: "answer", qid: id, game: g, correct: !!correct, latencyMs: lat, timerPct: tpc, reason: (ctx && ctx.reason) || "answered" }); } catch (eTA) {}
        }
        // (v0.186.0, V1.1 Flow#8) the station-rebuild fantasy is PERSISTENT: every surface's
        // mastery feeds ONE 60-module meter, latched like trailsUnlocked — decay never
        // un-builds a module. Recomputed only when a bucket actually moved.
        if (m.bucket !== prevBucket) {
          var mcS = 0; for (var mkS in map) { if (map[mkS] && map[mkS].bucket >= MASTERED_BUCKET) mcS++; }
          var poolNS = 0;
          try { poolNS = StarNix.core.questions ? StarNix.core.questions.pool().length : 0; } catch (ePS) {}
          if (poolNS > 0) {
            var stNS = Math.min(60, Math.floor(mcS / poolNS * 60));
            if (stNS > (profile.station | 0)) profile.station = stNS;
          }
        }
        // Daily missions (v0.56.0 unit 6): per-day counters off the same choke point.
        var dd = ensureDaily(profile);
        if (dd && correct) {
          dd.correct++;
          dd.byGame[g] = (dd.byGame[g] || 0) + 1;
          // (v0.90.0, review) at the ladder top a due correct COUNTS for the promote mission
          // (else late-prep days with <target due cards make it unclaimable).
          if (m.bucket > prevBucket || (correct && wasDue && m.bucket === MAX_BUCKET)) dd.promotions++;
          if (sk[g] > dd.bestStreak) dd.bestStreak = sk[g];
        }
        evaluateAchievements(profile);
        onChange();
        return m;
      },
      get: function (id) { return map[id]; },
      all: function () { return map; },
      // (v0.87.0, L1) ids whose review interval has lapsed — the servable due queue.
      dueList: function (now) {
        var out = [];
        for (var k in map) {
          if (!Object.prototype.hasOwnProperty.call(map, k)) continue;
          var m = map[k];
          var at = m.lastSeen + (INTERVALS[Math.min(m.bucket, INTERVALS.length - 1)] || 0);
          if (m.seen && at <= now) out.push({ id: k, at: at });
        }
        // (v0.90.0, review) most OVERDUE first = earliest due-time first — overdue-ness
        // depends on the interval, not on lastSeen alone.
        out.sort(function (a, b) { return a.at - b.at; });
        return out.map(function (x) { return x.id; });
      },
      summary: function () {
        var totalSeen = 0, uniqueCorrect = 0, uniqueIncorrect = 0, masteredCount = 0;
        for (var k in map) {
          if (!Object.prototype.hasOwnProperty.call(map, k)) continue;
          var m = map[k];
          totalSeen += m.seen;
          if (m.correct > 0) uniqueCorrect++;
          if (m.incorrect > 0) uniqueIncorrect++;
          if (m.bucket >= MASTERED_BUCKET) masteredCount++;
        }
        return {
          totalSeen: totalSeen, uniqueCorrect: uniqueCorrect,
          uniqueIncorrect: uniqueIncorrect, masteredCount: masteredCount
        };
      }
    };
  }

  /* =================================================================== *
   * 4b. Commander rank — cross-game XP meta-progression (v0.52.0 unit 2)
   * One pool (profile.xp) fed ONLY by existing seams: every answer through
   * makeMasteryStore.record (all three games + the exam route through it),
   * exam completions (shell _recordExam), and run scores (persistence
   * .submitScore — the 01 seam ARM already calls, completed in initCore).
   * All math is pure + deterministic; thresholds are pinned by the gate.
   * =================================================================== */
  var XP_AWARDS = {
    answerCorrect: 10,   // any correctly answered question, any surface
    answerWrong: 2,      // attempts still teach — small participation award
    promotion: 15,       // Leitner bucket moved UP (correct answers only)
    mastered: 40,        // bonus when a question first crosses MASTERED_BUCKET
    examComplete: 25,    // finishing any exam mode (never on abandon)
    examPass: 75,        // bonus at the exam module's own 80% pass mark
    runScore: 150        // a positive score submitted through persistence.submitScore (ARM campaign win)
  };
  // ~10 NX-SRC service ranks. Thresholds are FLAT data — the gate pins them; tune only with a version bump.
  var RANKS = [
    { name: "Recruit",       xp: 0 },
    { name: "Cadet",         xp: 150 },
    { name: "Ensign",        xp: 400 },
    { name: "Pilot",         xp: 800 },
    { name: "Lieutenant",    xp: 1400 },
    { name: "Lt. commander", xp: 2200 },
    { name: "Commander",     xp: 3300 },
    { name: "Captain",       xp: 4800 },
    { name: "Commodore",     xp: 6800 },
    { name: "Fleet admiral", xp: 9500 }
  ];
  /* (v0.179.0, V1.1 Flow#7) Commander ranks pay concrete cross-game rewards. Data-driven and
   * ADDITIVE ONLY — no retro-locking of live content ('Cadet unlocks Blitz' rejected: Blitz
   * already ships unlocked for everyone). Games read the accumulated perks via ctx.perks. */
  var RANK_REWARDS = [
    { rank: 3, kind: "crest",     label: "Bridge crest insignia" },
    { rank: 4, kind: "kbbCoins",  n: 25, label: "+25 KBB starting coins" },
    { rank: 4, kind: "armShield", n: 1,  label: "Free ARM Shield Cell level" },
    { rank: 8, kind: "goldTrail", label: "Commodore gold ship trail" }
  ];
  function rankPerks(xp) {
    var idx = rankFor(xp).index;
    var p = { crest: false, kbbCoins: 0, armShieldCell: 0, goldTrail: false };
    for (var i = 0; i < RANK_REWARDS.length; i++) {
      var rw = RANK_REWARDS[i];
      if (idx < rw.rank) continue;
      if (rw.kind === "crest") p.crest = true;
      else if (rw.kind === "kbbCoins") p.kbbCoins += rw.n;
      else if (rw.kind === "armShield") p.armShieldCell += rw.n;
      else if (rw.kind === "goldTrail") p.goldTrail = true;
    }
    return p;
  }
  function rankRewardsAt(index) {
    var out = [];
    for (var i = 0; i < RANK_REWARDS.length; i++) if (RANK_REWARDS[i].rank === index) out.push(RANK_REWARDS[i].label);
    return out;
  }
  function rankFor(xp) {
    xp = (typeof xp === "number" && xp > 0) ? Math.floor(xp) : 0;
    var i = RANKS.length - 1;
    while (i > 0 && xp < RANKS[i].xp) i--;
    var floor = RANKS[i].xp;
    var next = (i + 1 < RANKS.length) ? RANKS[i + 1].xp : null;
    var span = (next == null) ? 0 : next - floor;
    return {
      index: i, name: RANKS[i].name, floor: floor, next: next,
      into: xp - floor, span: span,
      progress: (next == null) ? 1 : (xp - floor) / span
    };
  }
  function xpForAnswer(correct, prevBucket, newBucket) {
    var n = correct ? XP_AWARDS.answerCorrect : XP_AWARDS.answerWrong;
    if (correct && newBucket > prevBucket) {
      n += XP_AWARDS.promotion;
      if (newBucket === MASTERED_BUCKET) n += XP_AWARDS.mastered;   // first step INTO mastered
    }
    return n;
  }
  function xpForExam(sum) {
    if (!sum || sum.abandoned || !sum.total) return 0;
    return XP_AWARDS.examComplete + (((sum.pct || 0) >= 80) ? XP_AWARDS.examPass : 0);
  }
  function xpForScore(game, score) {
    return (typeof score === "number" && score > 0) ? XP_AWARDS.runScore : 0;
  }
  function addXP(profile, n) {
    if (!profile) return 0;
    if (typeof profile.xp !== "number" || !(profile.xp >= 0)) profile.xp = 0;
    if (n > 0) profile.xp += Math.floor(n);
    return profile.xp;
  }

  /* =================================================================== *
   * 4c. Achievements — ~12 cross-game unlocks (v0.53.0 unit 3)
   * Pure predicates over a snapshot { profile, stats }; no new game seams —
   * per-game answer streaks are tracked in profile.streaks/streaksBest by
   * makeMasteryStore.record (the one choke point every graded answer already
   * crosses, tagged by meta.game). Unlocks persist in profile.achievements
   * (id -> unlock ts), award XP into the unit-2 pool, and surface through a
   * shell-settable onUnlock callback (toast) + the Progress screen panel.
   * =================================================================== */
  var ACH_LIST = [
    { id: "first-contact",    icon: "📡", xp: 25,  name: "First contact",    desc: "Answer your first question on any surface.",
      check: function (s) { var p = s.profile; return !!(p && p.totals && p.totals.questionsSeen >= 1); } },
    { id: "hot-streak",       icon: "🔥", xp: 50,  name: "Hot streak",       desc: "5 correct answers in a row on one surface.",
      check: function (s) { var b = s.profile && s.profile.streaksBest; if (!b) return false; for (var k in b) { if (b[k] >= 5) return true; } return false; } },
    { id: "gate-runner",      icon: "🌀", xp: 100, name: "Gate runner",      desc: "Chain 10 straight correct gates in Chasm Chase.",
      check: function (s) { var b = s.profile && s.profile.streaksBest; return !!(b && b.CC >= 10); } },
    { id: "void-discipline",  icon: "⚔",  xp: 100, name: "Void discipline",  desc: "Chain 10 straight correct answers in Kuiper Belt Battle.",
      check: function (s) { var b = s.profile && s.profile.streaksBest; return !!(b && b.KBB >= 10); } },
    { id: "deep-strike",      icon: "🚀", xp: 100, name: "Deep strike",      desc: "Chain 10 straight correct core scans in Acropolis Rescue.",
      check: function (s) { var b = s.profile && s.profile.streaksBest; return !!(b && b.ARM >= 10); } },
    { id: "station-restored", icon: "🛰", xp: 250, name: "Station restored", desc: "Complete the full ARM campaign — every sector swept.",
      check: function (s) { var p = s.profile; return !!(p && p.bests && typeof p.bests.ARM === "number"); } },
    { id: "sim-certified",    icon: "🎓", xp: 150, name: "Sim certified",    desc: "Score 80% or better on a full Exam sim.",
      check: function (s) { var h = s.profile && s.profile.examHistory; if (!h || !h.length) return false; for (var i = 0; i < h.length; i++) { if (h[i].mode === "sim" && (h[i].pct || 0) >= 80) return true; } return false; } },
    { id: "scholar",          icon: "📚", xp: 75,  name: "Scholar",          desc: "See 50 distinct questions from the bank.",
      check: function (s) { var m = s.profile && s.profile.mastery; if (!m) return false; var n = 0; for (var k in m) { if (Object.prototype.hasOwnProperty.call(m, k)) n++; if (n >= 50) return true; } return false; } },
    { id: "first-mastery",    icon: "✦",  xp: 50,  name: "First mastery",    desc: "Bring one question up to mastered.",
      check: function (s) { var m = s.profile && s.profile.mastery; if (!m) return false; for (var k in m) { if (m[k] && m[k].bucket >= MASTERED_BUCKET) return true; } return false; } },
    { id: "domain-sweep",     icon: "🗺", xp: 150, name: "Domain sweep",     desc: "Answer at least one question in every exam domain.",
      check: function (s) { var st = s.stats; if (!st || !st.domains || !st.domains.length) return false; for (var i = 0; i < st.domains.length; i++) { if (!(st.domains[i].seen > 0)) return false; } return true; } },
    { id: "archivist",        icon: "🏛", xp: 200, name: "Archivist",        desc: "Master 25 questions.",
      check: function (s) { var m = s.profile && s.profile.mastery; if (!m) return false; var n = 0; for (var k in m) { if (m[k] && m[k].bucket >= MASTERED_BUCKET) { n++; if (n >= 25) return true; } } return false; } },
    { id: "commander",        icon: "⭐", xp: 250, name: "Commander",        desc: "Reach the rank of Commander.",
      check: function (s) { var p = s.profile; return !!(p && rankFor(p.xp).index >= 6); } },
    // (v0.94.0, A3, Jason) HIDDEN until earned — ARM sets profile.armBeltCleared when a
    // sector's asteroid belt is fully destroyed; one-time like every achievement here.
    { id: "belt-sweeper",     icon: "☄️", xp: 150, name: "Belt sweeper",     desc: "Destroy every asteroid in a single sector.", hidden: true,
      check: function (s) { var p = s.profile; return !!(p && p.armBeltCleared); } }
  ];
  var achOnUnlock = null;   // shell-settable: function (newlyUnlockedDefs[]) — toast surface
  ACH_LIST.push(
    { id: "streak-7",  icon: "\ud83d\udd25", xp: 100, name: "Week of fire",  desc: "Study 7 days in a row.",
      check: function (s) { return studyStreakDays(s.profile) >= 7; } },
    { id: "streak-30", icon: "\ud83c\udf96\ufe0f", xp: 250, name: "Month of iron", desc: "Study 30 days in a row.",
      check: function (s) { return studyStreakDays(s.profile) >= 30; } }
  );   // (v0.153.0, V1.1 Flow#4) appended AFTER the pinned dozen — cascade order preserved
  function evaluateAchievements(profile) {
    if (!profile) return [];
    var a = profile.achievements || (profile.achievements = {});
    var stats = null;
    try {
      var qp = StarNix.core && StarNix.core.questions;
      if (qp && typeof qp.stats === "function") stats = qp.stats();
    } catch (e) { stats = null; }
    var snap = { profile: profile, stats: stats };
    var newly = [];
    for (var i = 0; i < ACH_LIST.length; i++) {           // list order — later defs see earlier awards' XP
      var def = ACH_LIST[i];
      if (a[def.id]) continue;
      var hit = false;
      try { hit = !!def.check(snap); } catch (e2) {}
      if (hit) { a[def.id] = clock.now(); addXP(profile, def.xp); newly.push(def); }
    }
    if (newly.length && achOnUnlock) { try { achOnUnlock(newly.slice()); } catch (e3) {} }
    return newly;
  }

  /* =================================================================== *
   * 4d. Daily missions — 3/day, date-seeded (v0.56.0 unit 6)
   * Generation is a PURE function of the calendar date (makeRng("daily:"+date)
   * — NOT ctx.rng.fork, which is boot-seeded and can't reproduce across boots;
   * the determinism pin requires date-only dependence, deviation logged).
   * Progress feeds from the SAME existing seams as XP/achievements: the
   * mastery.record choke point, _recordExam, and the XP pool itself.
   * Claiming pays mission XP into the unit-2 pool. State on profile.daily.
   * =================================================================== */
  var DAILY_TEMPLATES = [
    { id: "sharp",   icon: "🎯", name: "Sharpshooter",  xp: 40, targets: [10, 15, 20],
      desc: function (t) { return "Answer " + t + " questions correctly today."; },
      progress: function (d) { return d.correct || 0; } },
    { id: "spec",    icon: "🛰", name: "Specialist",    xp: 40, targets: [5, 8], games: ["ARM", "KBB", "CC", "EXAM"],
      desc: function (t, g) { return "Answer " + t + " correctly in " + (g === "EXAM" ? "the practice exam" : g) + " today."; },
      progress: function (d, m) { return (d.byGame && d.byGame[m.game]) || 0; } },
    { id: "chain",   icon: "🔗", name: "Chain reaction", xp: 50, targets: [3, 5, 7],
      desc: function (t) { return "Hit a streak of " + t + " correct answers today."; },
      progress: function (d) { return d.bestStreak || 0; } },
    { id: "exam",    icon: "🎓", name: "Examiner",      xp: 60, targets: [1],
      desc: function () { return "Complete an exam in any mode today."; },
      progress: function (d) { return d.exams || 0; } },
    { id: "collect", icon: "✦",  name: "Collector",     xp: 50, targets: [60, 100, 150],
      desc: function (t) { return "Earn " + t + " XP today."; },
      progress: function (d, m, profile) { return Math.max(0, ((profile && profile.xp) || 0) - (d.xpStart || 0)); } },
    { id: "promote", icon: "📈", name: "Drill sergeant", xp: 60, targets: [3, 5],
      desc: function (t) { return "Promote " + t + " questions up the mastery ladder today."; },
      progress: function (d) { return d.promotions || 0; } }
  ];
  function dayKey(ts) {
    var d = new Date(ts != null ? ts : clock.now());
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + "-" + (m < 10 ? "0" : "") + m + "-" + (day < 10 ? "0" : "") + day;
  }
  // Pure: date string -> the day's 3 missions (template id, target, per-template params).
  function genDaily(dateStr) {
    var rng = makeRng("daily:" + String(dateStr));
    var pool = DAILY_TEMPLATES.slice(), out = [];
    for (var i = 0; i < 3 && pool.length; i++) {
      var tpl = pool.splice(rng.int(pool.length), 1)[0];
      var target = tpl.targets[rng.int(tpl.targets.length)];
      var m = { tpl: tpl.id, target: target, xp: tpl.xp, claimed: false };
      if (tpl.games) m.game = tpl.games[rng.int(tpl.games.length)];
      out.push(m);
    }
    return out;
  }
  // Regenerate profile.daily when the calendar day changes (unclaimed progress expires — daily).
  // (v0.153.0, V1.1 Flow#4) study-day streak helpers. A day is ACTIVE when it recorded a
  // correct answer or a completed exam. The chain banks at rollover; today extends it live.
  function dayGap(a, b) {
    try {
      var pa = String(a).split("-"), pb = String(b).split("-");
      var da = new Date(+pa[0], +pa[1] - 1, +pa[2]), db = new Date(+pb[0], +pb[1] - 1, +pb[2]);
      return Math.round((db - da) / 86400000);
    } catch (e) { return 99; }
  }
  function dayActive(d) { return !!(d && ((d.correct | 0) > 0 || (d.exams | 0) > 0)); }
  function studyStreakDays(profile) {
    if (!profile) return 0;
    var d = profile.daily, base = profile.streakDays | 0, last = profile.streakLast || null;
    var linked = !!(last && d && dayGap(last, d.date) === 1);   // yesterday banked -> chain alive
    if (dayActive(d)) return linked ? base + 1 : 1;
    return linked ? base : 0;
  }
  function ensureDaily(profile, dateStr) {
    if (!profile) return null;
    var key = dateStr || dayKey();
    if (!profile.daily || profile.daily.date !== key) {
      // (v0.153.0, Flow#4) bank the OUTGOING day into the streak before regenerating
      var prevD = profile.daily;
      if (typeof profile.streakDays !== "number") profile.streakDays = 0;
      if (typeof profile.streakDaysBest !== "number") profile.streakDaysBest = 0;
      if (prevD && prevD.date && dayActive(prevD)) {
        profile.streakDays = (profile.streakLast && dayGap(profile.streakLast, prevD.date) === 1) ? profile.streakDays + 1 : 1;
        profile.streakLast = prevD.date;
        if (profile.streakDays > profile.streakDaysBest) profile.streakDaysBest = profile.streakDays;
      }
      profile.daily = {
        date: key, missions: genDaily(key),
        correct: 0, byGame: {}, bestStreak: 0, exams: 0, promotions: 0,
        xpStart: (typeof profile.xp === "number" && profile.xp >= 0) ? profile.xp : 0
      };
    }
    return profile.daily;
  }
  function dailyMissionState(profile, i) {
    var d = profile && profile.daily; if (!d || !d.missions[i]) return null;
    var m = d.missions[i], tpl = null;
    for (var t = 0; t < DAILY_TEMPLATES.length; t++) if (DAILY_TEMPLATES[t].id === m.tpl) tpl = DAILY_TEMPLATES[t];
    if (!tpl) return null;
    var prog = Math.min(m.target, tpl.progress(d, m, profile));
    return { index: i, tpl: tpl, mission: m, progress: prog, target: m.target,
      done: prog >= m.target, claimed: !!m.claimed,
      label: tpl.desc(m.target, m.game), icon: tpl.icon, name: tpl.name, xp: m.xp };
  }
  function claimDaily(profile, i) {
    var st = dailyMissionState(profile, i);
    if (!st || !st.done || st.claimed) return 0;
    profile.daily.missions[i].claimed = true;
    var paid = st.xp;
    // (v0.153.0, Flow#4) streak kicker: the FIRST claim of an on-streak day (>= 2) pays
    // +5 XP per chain day, capped at +25 — small, but it makes the flame worth feeding.
    var chain = studyStreakDays(profile);
    if (chain >= 2 && !profile.daily.streakBonusPaid) {
      profile.daily.streakBonusPaid = true;
      paid += Math.min(25, 5 * chain);
    }
    addXP(profile, paid);
    return paid;
  }

  /* =================================================================== *
   * 4e. Mastery-gated cosmetics — ship trail tints (v0.57.0 unit 7)
   * Pure vector color only (no new assets). One variant per exam domain,
   * unlocked when that domain's masteredPct crosses the threshold. Games
   * never call stats(): the SHELL resolves the pick and stores BOTH the id
   * (settings.shipTrail) and the resolved hex (settings.shipTrailColor);
   * render paths read the hex or fall back to their existing colors.
   * =================================================================== */
  var COSMETICS = [
    { id: "standard",    name: "NX standard", color: "#7855FA", domain: null },   // always unlocked
    { id: "aqua-stream", name: "Aqua stream", color: "#1FDDE9", domain: "storage" },
    { id: "mantis-wake", name: "Mantis wake", color: "#92DD23", domain: "vms" },
    { id: "gold-vector", name: "Gold vector", color: "#FFC857", domain: "networking" },
    { id: "peach-blaze", name: "Peach blaze", color: "#FF6B5B", domain: "security" },
    { id: "iris-bloom",  name: "Iris bloom",  color: "#AC9BFD", domain: "architecture" },
    { id: "commodore-gold", name: "Commodore gold", color: "#FFE08A", domain: null, rank: 8 }   // (v0.179.0, Flow#7) rank-gated, parallel to the domain gate
  ];
  var COSMETIC_THRESHOLD = 0.5;   // the domain's masteredPct needed to unlock its trail
  // (v0.65.0, Jason's ruling) unlocks are EARNED FOREVER: profile.trailsUnlocked latches a
  // variant the moment its threshold is seen, so later mastery decay never re-locks it.
  function cosmeticUnlocked(def, stats, profile) {
    if (!def) return false;
    if (def.rank != null) {   // (v0.179.0, Flow#7) rank-gated variant: latched forever, else live rank check
      if (profile && profile.trailsUnlocked && profile.trailsUnlocked[def.id]) return true;
      return !!(profile && rankFor(profile.xp).index >= def.rank);
    }
    if (!def.domain) return true;
    if (profile && profile.trailsUnlocked && profile.trailsUnlocked[def.id]) return true;   // latched = earned forever
    if (!stats || !stats.domains) return false;
    for (var i = 0; i < stats.domains.length; i++) {
      var d = stats.domains[i];
      if (d.domain === def.domain) return (d.masteredPct || 0) >= COSMETIC_THRESHOLD;
    }
    return false;
  }
  // Latch every currently-threshold-met variant into the profile; returns the newly earned ids.
  function latchCosmetics(profile, stats) {
    if (!profile) return [];
    var un = profile.trailsUnlocked || (profile.trailsUnlocked = {});
    var newly = [];
    for (var i = 0; i < COSMETICS.length; i++) {
      var def = COSMETICS[i];
      if ((!def.domain && def.rank == null) || un[def.id]) continue;
      var live = (def.rank != null) ? cosmeticUnlocked(def, stats, profile) : cosmeticUnlocked(def, stats, null);   // (Flow#7) rank latch reads the profile's xp
      if (live) { un[def.id] = clock.now(); newly.push(def.id); }
    }
    return newly;
  }
  // The selected variant if it exists AND is unlocked (live threshold OR latched); else standard.
  function resolveCosmetic(settings, stats, profile) {
    var id = settings && settings.shipTrail;
    for (var i = 0; i < COSMETICS.length; i++) {
      if (COSMETICS[i].id === id) return cosmeticUnlocked(COSMETICS[i], stats, profile) ? COSMETICS[i] : COSMETICS[0];
    }
    return COSMETICS[0];
  }

  /* =================================================================== *
   * 5. QuestionProvider + scheduler  (01 §3)
   * =================================================================== */
  function inBand(diff, band) {
    if (!band) return true;
    return diff >= band[0] && diff <= band[1];
  }

  // Return a clone of q with its options reordered (Fisher–Yates via rng) and the correct
  // index/indices remapped, so repeat runs can't be solved by memorising answer position.
  // Option TEXT is unchanged (stays as authored / as in the exam); grading against the returned
  // question stays correct. The original bank object is never mutated. Questions with <2 options
  // or no usable rng pass through untouched.
  function shuffleQuestionOptions(q, rng) {
    if (!q || !q.options || q.options.length < 2 || !rng || typeof rng.next !== "function") return q;
    var n = q.options.length, i, order = new Array(n);
    for (i = 0; i < n; i++) order[i] = i;
    for (i = n - 1; i > 0; i--) { var k = Math.floor(rng.next() * (i + 1)), t = order[i]; order[i] = order[k]; order[k] = t; }
    var newOptions = new Array(n), newPos = new Array(n);   // newPos[oldIndex] = newIndex
    for (i = 0; i < n; i++) { newOptions[i] = q.options[order[i]]; newPos[order[i]] = i; }
    var out = {}, key;
    for (key in q) if (Object.prototype.hasOwnProperty.call(q, key)) out[key] = q[key];
    out.options = newOptions;
    if (Array.isArray(q.correctIndices)) {
      out.correctIndices = q.correctIndices.map(function (ci) { return newPos[ci]; }).sort(function (a, b) { return a - b; });
    } else if (typeof q.correctIndex === "number") {
      out.correctIndex = newPos[q.correctIndex];
    }
    // (v0.88.0, L3) optionNotes ride the same permutation — they were copied UNSHUFFLED,
    // silently misaligning every per-option rationale on a shuffled draw.
    if (Array.isArray(q.optionNotes) && q.optionNotes.length === n) {
      var newNotes = new Array(n);
      for (i = 0; i < n; i++) newNotes[i] = q.optionNotes[order[i]];
      out.optionNotes = newNotes;
    } else if (out.optionNotes) {
      // (v0.90.0, review) length mismatch: the generic clone copied RAW notes indexed against
      // the ORIGINAL order — drop them; no rationale beats a wrong rationale.
      out.optionNotes = undefined;
    }
    return out;
  }

  // Dynamic per-question timer (D6): seconds a player gets to answer, derived from how much there is
  // to read (stem + options), single vs multi, and difficulty — "quick but learnable." An authored
  // numeric q.timer overrides the computed base. opts.extraTime (accessibility) extends the result.
  var TIMER = { BASE: 6, PER_WORD: 0.30, PER_OPTION: 1.0, DIFF_STEP: 2.5, MULTI_BONUS: 6, MIN: 12, MAX: 45, EXTRA_FACTOR: 1.6 };
  function wordCount(s) { return s ? String(s).split(/\s+/).filter(Boolean).length : 0; }
  function questionTimerSeconds(q, opts) {
    opts = opts || {};
    var t;
    if (q && typeof q.timer === "number" && q.timer > 0) {
      t = q.timer;                                  // authored override
    } else {
      var words = wordCount(q && q.stem), opt = (q && q.options) || [], i;
      for (i = 0; i < opt.length; i++) words += wordCount(opt[i]);
      var diff = (q && typeof q.difficulty === "number") ? q.difficulty : 1;
      var multi = !!(q && Array.isArray(q.correctIndices));
      t = TIMER.BASE + words * TIMER.PER_WORD + opt.length * TIMER.PER_OPTION
        + (diff - 1) * TIMER.DIFF_STEP + (multi ? TIMER.MULTI_BONUS : 0);
      if (t < TIMER.MIN) t = TIMER.MIN;
      if (t > TIMER.MAX) t = TIMER.MAX;             // clamp the computed base (not the extra-time bonus)
    }
    if (opts.extraTime) t *= TIMER.EXTRA_FACTOR;    // accessibility: extend, may exceed MAX by design
    return Math.round(t);
  }

  function makeQuestionProvider(pack, mastery) {
    var all = (pack && pack.questions) ? pack.questions.slice() : [];
    var byIdMap = {};
    for (var i = 0; i < all.length; i++) byIdMap[all[i].id] = all[i];

    function classify(q, now) {
      // (v0.172.0, Jason) q.priority (>1) multiplies the draw weight in EVERY state — priority
      // questions surface more often as new, come back harder when due, and reinforce more,
      // so they are asked and mastered ahead of the rest of the bank.
      var pw = (q.priority > 1) ? q.priority : 1;
      var m = mastery && mastery.get ? mastery.get(q.id) : undefined;
      if (!m || m.seen === 0) return { reason: "new", weight: (W["new"] + W.epsilon) * pw };
      var due = (m.lastSeen + (INTERVALS[Math.min(m.bucket, INTERVALS.length - 1)] || 0)) <= now;
      if (due) return { reason: "review-due", weight: (W.due + W.epsilon) * pw };
      return { reason: "reinforce", weight: (W.reinforce + W.epsilon) * pw };
    }

    // Build candidate list honoring domain/band/exclusions, relaxing if empty.
    function candidates(opts) {
      var domain = opts.domain;
      var band = opts.difficultyBand;
      var excl = {};
      if (opts.excludeIds) for (var i = 0; i < opts.excludeIds.length; i++) excl[opts.excludeIds[i]] = true;

      function build(useDomain, useBand, useExcl) {
        var out = [];
        for (var k = 0; k < all.length; k++) {
          var q = all[k];
          if (!opts.allowImages && q.image) continue;   // exhibit Qs are exam-only (need a full-screen image)
          if (useDomain && domain && q.domain !== domain) continue;
          if (useBand && !inBand(q.difficulty, band)) continue;
          if (useExcl && excl[q.id]) continue;
          out.push(q);
        }
        return out;
      }
      var c = build(true, true, true);
      if (c.length) return { list: c, relaxed: false };
      c = build(true, false, true); if (c.length) return { list: c, relaxed: true };   // drop band
      c = build(false, false, true); if (c.length) return { list: c, relaxed: true };  // drop domain
      c = build(false, false, false); return { list: c, relaxed: true };               // allow excluded
    }

    return {
      next: function (opts) {
        opts = opts || {};
        var rng = opts.rng || makeRng(clock.now());
        var now = clock.now();
        var res = candidates(opts);
        var list = res.list;
        if (!list.length) throw new Error("QuestionProvider.next: empty bank");

        // Weighted selection. Deterministic given rng + mastery + clock.
        var total = 0, weights = new Array(list.length), reasons = new Array(list.length);
        for (var i = 0; i < list.length; i++) {
          var c = classify(list[i], now);
          weights[i] = c.weight;
          reasons[i] = c.reason;
          total += c.weight;
        }
        var r = rng.next() * total, acc = 0, idx = 0;
        for (var j = 0; j < list.length; j++) {
          acc += weights[j];
          if (r <= acc) { idx = j; break; }
          idx = j;
        }
        var reason = res.relaxed ? "random" : reasons[idx];
        var picked = opts.shuffle ? shuffleQuestionOptions(list[idx], rng) : list[idx];
        return { question: picked, reason: reason };
      },
      byId: function (id) { return byIdMap[id]; },
      pool: function (filter) {
        if (!filter) return all.slice();
        var out = [];
        for (var i = 0; i < all.length; i++) {
          var q = all[i];
          if (filter.domain && q.domain !== filter.domain) continue;
          if (filter.difficulty && q.difficulty !== filter.difficulty) continue;
          if (filter.cert && q.cert !== filter.cert) continue;
          out.push(q);
        }
        return out;
      },
      // Progress rollup for the Stats/Codex screen (01 §3/§4). Centralizes the
      // Leitner interval/bucket math so the shell just renders numbers.
      stats: function () {
        var now = clock.now();
        function blank(d) { return { domain: d, total: 0, seen: 0, mastered: 0, fresh: 0, due: 0, correct: 0, attempts: 0 }; }
        var overall = blank(null), per = {};
        for (var i = 0; i < all.length; i++) {
          var q = all[i], p = per[q.domain] || (per[q.domain] = blank(q.domain));
          p.total++; overall.total++;
          var m = mastery && mastery.get ? mastery.get(q.id) : undefined;
          if (m && m.seen) {
            p.seen++; overall.seen++;
            p.attempts += m.seen; overall.attempts += m.seen;
            p.correct += m.correct; overall.correct += m.correct;
            if (m.bucket >= MASTERED_BUCKET) { p.mastered++; overall.mastered++; }
            var interval = INTERVALS[Math.min(m.bucket, INTERVALS.length - 1)] || 0;
            if ((m.lastSeen + interval) <= now) { p.due++; overall.due++; }
          } else { p.fresh++; overall.fresh++; }   // never seen
        }
        function finish(x) { x.accuracy = x.attempts ? x.correct / x.attempts : 0; x.masteredPct = x.total ? x.mastered / x.total : 0; return x; }
        var domains = [];
        for (var k in per) if (Object.prototype.hasOwnProperty.call(per, k)) domains.push(finish(per[k]));
        // weakest first (lowest mastery, then most due) — surfaces what to study
        domains.sort(function (a, b) { return (a.masteredPct - b.masteredPct) || (b.due - a.due) || (a.domain < b.domain ? -1 : 1); });
        return { overall: finish(overall), domains: domains };
      },
      count: function () { return all.length; },
      timerSeconds: function (q, opts) { return questionTimerSeconds(q, opts); }
    };
  }

  /* =================================================================== *
   * 6. PersistenceProvider + LocalStorageProvider  (01 §5)
   *    Only module allowed to touch localStorage (05 lint rule).
   * =================================================================== */
  function memoryStorage() {
    var m = {};
    return {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; },
      setItem: function (k, v) { m[k] = String(v); },
      removeItem: function (k) { delete m[k]; }
    };
  }
  function anonId() {
    try {
      if (global.crypto && global.crypto.getRandomValues) {
        var a = new Uint32Array(2); global.crypto.getRandomValues(a);
        return "anon-" + a[0].toString(36) + a[1].toString(36);
      }
    } catch (e) {}
    return "anon-" + clock.now().toString(36);
  }
  function defaultSettings() {
    return { music: true, sfx: true, masterVol: 1, musicVol: 1, sfxVol: 1, reducedMotion: false, extraTime: false, colorblind: false };
  }
  function defaultProfile() {
    return {
      schemaVersion: SCHEMA_VERSION,
      userId: anonId(),
      bests: {},
      totals: { questionsSeen: 0, correct: 0, incorrect: 0, points: 0, runs: 0 },
      mastery: {},
      xp: 0,                 // Commander-rank XP pool (v0.52.0 unit 2) — fed by answers/mastery/exams/run scores
      rankSeen: 0,           // last rank index acknowledged on the menu (drives the one-shot rank-up moment)
      streaks: {},           // (v0.53.0 unit 3) current consecutive-correct per surface (ARM/KBB/CC/EXAM)
      streaksBest: {},       // high-water streaks — achievement predicates read these
      achievements: {},      // unlocked achievement id -> unlock timestamp
      trailsUnlocked: {},    // (v0.65.0) cosmetic latches: trail id -> earn timestamp (earned forever)
      qstats: {},            // (v0.183.0, V1.1 Backend#7) per-question pace aggregates: id -> {n, lat(EMA ms), pct(EMA of window used)}
      station: 0,            // (v0.186.0, V1.1 Flow#8) MCI Station modules re-lit (0-60) — mastery-fed, latched forever
      settings: defaultSettings(),
      updatedAt: clock.now()
    };
  }
  // Migration hook: upgrade an older payload to the current schema.
  function migrate(old) {
    var p = old || {};
    // (no historical versions yet) — fill any missing fields against defaults.
    var def = defaultProfile();
    if (typeof p.schemaVersion !== "number") p.schemaVersion = 0;
    // future: while (p.schemaVersion < SCHEMA_VERSION) { ...; p.schemaVersion++; }
    p.userId = p.userId || def.userId;
    p.bests = p.bests || {};
    p.totals = Object.assign({}, def.totals, p.totals || {});
    p.mastery = p.mastery || {};
    if (typeof p.xp !== "number" || !(p.xp >= 0)) p.xp = 0;             // pre-rank profiles
    if (typeof p.rankSeen !== "number" || !(p.rankSeen >= 0)) p.rankSeen = 0;
    if (!p.streaks || typeof p.streaks !== "object") p.streaks = {};    // pre-achievement profiles
    if (!p.streaksBest || typeof p.streaksBest !== "object") p.streaksBest = {};
    if (!p.achievements || typeof p.achievements !== "object") p.achievements = {};
    if (!p.trailsUnlocked || typeof p.trailsUnlocked !== "object") p.trailsUnlocked = {};
    if (!p.qstats || typeof p.qstats !== "object") p.qstats = {};       // (v0.183.0, Backend#7)
    if (typeof p.station !== "number" || !(p.station >= 0)) p.station = 0;   // (v0.186.0, Flow#8)
    if (typeof p.streakDays !== "number") p.streakDays = 0;            // (v0.153.0, Flow#4)
    if (typeof p.streakDaysBest !== "number") p.streakDaysBest = 0;
    p.settings = Object.assign({}, def.settings, p.settings || {});
    p.schemaVersion = SCHEMA_VERSION;
    return p;
  }

  function makeLocalStorageProvider(opts) {
    opts = opts || {};
    var storage = opts.storage;
    if (!storage) {
      try { storage = global.localStorage; } catch (e) { storage = null; }
      if (!storage) storage = memoryStorage();   // jsdom / private mode fallback
    }
    var key = opts.key || STORAGE_KEY;
    var debounceMs = opts.debounceMs != null ? opts.debounceMs : 400;
    var timer = null, pending = null;

    function writeNow(p) {
      p.updatedAt = clock.now();
      // (v0.130.0, V1.1 Backend#1) rotate the previous good state into a backup key BEFORE
      // overwriting — one bad write can no longer take weeks of Leitner history with it.
      try { var prevRaw = storage.getItem(key); if (prevRaw) storage.setItem(key + ":bak", prevRaw); } catch (eB) {}
      try { storage.setItem(key, JSON.stringify(p)); } catch (e) { /* quota/serialize */ }
    }
    function parseProfile(raw) {   // shared by main + backup load paths
      var parsed = JSON.parse(raw);
      var p = (parsed && parsed.schemaVersion === SCHEMA_VERSION) ? parsed : migrate(parsed);
      if (!p || typeof p !== "object") return null;
      return migrate(p);
    }
    var provider = {
      load: function () {
        var p = null;
        try {
          var raw = storage.getItem(key);
          if (raw) p = parseProfile(raw);
        } catch (e) { p = null; }
        if (!p) {
          // (v0.130.0, V1.1 Backend#1) corrupt/missing main -> try the last-known-good backup
          try { var bak = storage.getItem(key + ":bak"); if (bak) p = parseProfile(bak); } catch (e2) { p = null; }
        }
        if (!p) p = defaultProfile();     // both gone/corrupt -> fresh profile, never crash
        return Promise.resolve(p);
      },
      save: function (p) {
        pending = p;
        if (timer) return Promise.resolve();
        timer = setTimeout(function () { timer = null; if (pending) writeNow(pending); pending = null; }, debounceMs);
        return Promise.resolve();
      },
      flush: function () {                  // run-end explicit save
        if (timer) { clearTimeout(timer); timer = null; }
        if (pending) { writeNow(pending); pending = null; }
      },
      // (v0.130.0, V1.1 Backend#1) portable progress: export the current stored profile as
      // JSON; import validates + migrates before it touches storage, so bad pastes can't wipe.
      exportProfile: function () {
        this.flush();
        try { return storage.getItem(key) || ""; } catch (e) { return ""; }
      },
      importProfile: function (json) {
        var p = parseProfile(json);       // throws on bad JSON; null on bad shape
        if (!p) throw new Error("not a StarNix profile");
        writeNow(p);
        return p;
      }
    };
    // (v0.130.0, V1.1 Backend#1) the debounce window is a data-loss window on tab close —
    // flush when the page hides. Guarded so headless/mock environments are unaffected.
    if (opts.autoFlush !== false) {
      try {
        if (global.addEventListener) {
          global.addEventListener("pagehide", function () { provider.flush(); });
          global.addEventListener("visibilitychange", function () {
            try { if (global.document && global.document.visibilityState === "hidden") provider.flush(); } catch (eV) {}
          });
        }
      } catch (eL) {}
    }
    return provider;
  }

  /* =================================================================== *
   * 7. Theme / brand tokens  (01 §8, 07)
   * =================================================================== */
  var THEME = {
    colors: {
      space: "#07070e", panel: "#14141d", panel2: "#1d1d29", border: "#34344a",
      charcoal: "#131313", text: "#F2F2F7", mid: "#9a9aad", dim: "#6d6d80",
      iris: "#7855FA", iris300: "#AC9BFD", iris600: "#6D40E6",
      aqua: "#1FDDE9", mantis: "#92DD23", peach: "#FF6B5B", gold: "#FFC857", white: "#FFFFFF"
    },
    // High-contrast / low-vision palette (#12 P1). Applied when <html data-contrast="high">.
    // Levers: pure-black ground, pure-white text, much lighter secondary/tertiary greys,
    // and a far brighter border (the signature change). Accents nudged brighter for use as
    // coloured text/icons on dark; --iris600 kept so the primary-button hover still differs.
    contrast: {
      space: "#000000", panel: "#1b1b28", panel2: "#28283c", border: "#9aa0e0",
      charcoal: "#0a0a0a", text: "#FFFFFF", mid: "#cfd2ec", dim: "#b0b4d2",
      iris: "#8b6bff", iris300: "#c4b8ff", iris600: "#6D40E6",
      aqua: "#3DE7F2", mantis: "#A6EE3C", peach: "#FF8473", gold: "#FFD479", white: "#FFFFFF"
    },
    font: "'Montserrat', system-ui, Arial, sans-serif",   // (v0.158.0) vendored face first, real fallbacks behind it
    // color meaning (07 §1) — always pair with a shape/icon; never color alone.
    meaning: { friendly: "iris", energy: "aqua", success: "mantis", danger: "peach", reward: "gold" }
  };
  function varBlock(sel, c) {
    return sel + "{--space:" + c.space + ";--panel:" + c.panel + ";--panel2:" + c.panel2 +
      ";--border:" + c.border + ";--charcoal:" + c.charcoal + ";--text:" + c.text +
      ";--mid:" + c.mid + ";--dim:" + c.dim + ";--iris:" + c.iris + ";--iris300:" + c.iris300 +
      ";--iris600:" + c.iris600 + ";--aqua:" + c.aqua + ";--mantis:" + c.mantis +
      ";--peach:" + c.peach + ";--gold:" + c.gold + ";--white:" + c.white + ";}";
  }
  function themeCSS() {
    // base vars carry --font; the HC override only swaps colours. The [data-contrast] attribute
    // adds specificity so the override wins when present. A few targeted rules cover cases a bare
    // var-swap can't (a bounded primary button now that --iris is lighter, and a visible focus ring).
    var base = varBlock(":root", THEME.colors).replace(";}", ";--font:" + THEME.font + ";}");
    var hc = varBlock(':root[data-contrast="high"]', THEME.contrast);
    var hcRules =
      ':root[data-contrast="high"] .sx-btn-iris{border:1px solid var(--white);}' +
      ':root[data-contrast="high"] .sx-stat{background:rgba(255,255,255,.09);}' +
      // (v0.135.0, V1.1 FE#1) the focus ring is ALWAYS on now — keyboard users on a dark bg
      // got invisible browser-default rings everywhere outside high-contrast mode.
      ':focus-visible{outline:2px solid var(--aqua);outline-offset:2px;border-radius:4px;}' +
      ':root[data-contrast="high"] :focus-visible{outline-width:3px;}';
    // (v0.187.0, V1.1 FE#8) type-scale tokens: shared sizes surfaces converge on (11px micro floor)
    var scale = ':root{--fs-micro:11px;--fs-body:13px;--fs-label:12px;--fs-num:14px;}';
    return base + scale + hc + hcRules;
  }
  function injectTheme(doc) {
    if (!doc || !doc.head) return;
    if (doc.getElementById("starnix-theme")) return;
    // (v0.158.0, V1.1 Backend#5) Montserrat is vendored into the build's <head> — the old
    // runtime Google-Fonts link is gone (it was the second, hidden CDN dependency).
    var st = doc.createElement("style");
    st.id = "starnix-theme";
    st.textContent = themeCSS();
    doc.head.appendChild(st);
  }

  /* =================================================================== *
   * 8. Telemetry  (01 §10)
   * =================================================================== */
  function defaultSink(e) {
    try { if (global.console && console.debug) console.debug("[telemetry]", e.t, e); } catch (x) {}
  }
  function makeTelemetry(opts) {
    opts = opts || {};
    var sink = opts.sink || defaultSink;
    var buf = [], max = opts.max || 500;
    return {
      emit: function (e) {
        e.ts = clock.now();
        buf.push(e);
        if (buf.length > max) buf.shift();
        sink(e);
      },
      events: function () { return buf.slice(); },
      clear: function () { buf.length = 0; }
    };
  }

  /* =================================================================== *
   * 9. AIAdapter seam (deferred — no-op only)  (01 §11, 00 §8)
   * =================================================================== */
  function escapeHTML(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (ch) {
      return ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : ch === ">" ? "&gt;" :
        ch === '"' ? "&quot;" : "&#39;";
    });
  }
  var CANNED_FLAVOR = {
    enemy: "BCM signal detected.",
    boss: "Heavy BCM unit inbound.",
    victory: "Sector secured.",
    defeat: "Squad scattered — regroup."
  };
  var StaticAI = {
    available: function () { return false; },
    rephraseBriefing: function (text) { return Promise.resolve(String(text == null ? "" : text)); },
    explainAnswer: function (q) { return Promise.resolve((q && q.explanation) || ""); },
    flavor: function (kind) { return Promise.resolve(CANNED_FLAVOR[kind] || ""); }
  };

  /* =================================================================== *
   * 10. Audio seam  (01 §7)  — real engine arrives as audio.js
   * =================================================================== */
  var NoopAudio = {
    ensure: function () {}, setMusic: function () {}, setSfx: function () {},
    sfx: function () {}, playTrack: function () {}
  };

  /* =================================================================== *
   * 11. Game registry + audio registration
   * =================================================================== */
  var games = StarNix._games || (StarNix._games = {});
  var KNOWN_GAMES = { ARM: true, KBB: true, CC: true };
  StarNix.registerGame = function (module) {
    if (!module || typeof module !== "object") throw new Error("registerGame: module required");
    if (typeof module.id !== "string") throw new Error("registerGame: module.id (string) required");
    if (typeof module.mount !== "function") throw new Error("registerGame: " + module.id + ".mount must be a function");
    if (typeof module.unmount !== "function") throw new Error("registerGame: " + module.id + ".unmount must be a function");
    if (!KNOWN_GAMES[module.id]) {
      try { if (global.console && console.warn) console.warn("registerGame: unknown game id '" + module.id + "' (expected ARM|KBB|CC)"); } catch (x) {}
    }
    games[module.id] = module;
    return module;
  };
  StarNix.getGame = function (id) { return games[id]; };

  StarNix.registerAudio = function (impl) {
    var a = impl || NoopAudio;
    if (StarNix.core) StarNix.core.audio = a;
    StarNix._audio = a;   // remembered so initCore (if it runs later) picks it up
    return a;
  };

  /* =================================================================== *
   * 12. Built-in NCP-MCI fixture (Phase 0).  Verified facts only.
   *     Real bank arrives from the owner via 06 ingestion.
   * =================================================================== */
  var SAMPLE_PACK = {
    id: "NCP-MCI",
    name: "Nutanix Certified Professional — Multicloud Infrastructure",
    domains: DOMAINS,
    questions: [
      { id: "mci-storage-0001", cert: "NCP-MCI", domain: "storage", difficulty: 2,
        stem: "What is the primary role of the OpLog in a Nutanix cluster?",
        options: ["Permanently store all data", "Buffer incoming writes before they drain to the Extent Store", "Cache reads for speed", "Hold cluster metadata"],
        correctIndex: 1,
        explanation: "The OpLog is the persistent (SSD-backed) write buffer; writes are coalesced there for a fast acknowledgement, then drained to the Extent Store. It is not the durable capacity tier.",
        briefing: "The OpLog is a fast, persistent landing zone for writes that later flush to the Extent Store.",
        tags: ["oplog", "write-path"] },
      { id: "mci-performance-0001", cert: "NCP-MCI", domain: "performance", difficulty: 2,
        stem: "Which Nutanix capability keeps a VM's working data on the node where the VM runs, avoiding network reads?",
        options: ["Data Tiering", "Data Locality", "Erasure Coding", "Deduplication"],
        correctIndex: 1,
        explanation: "Data Locality keeps a VM's active working set on its local node so reads are served locally instead of crossing the network.",
        briefing: "Data Locality keeps the working set on the VM's own node for fast local reads.",
        tags: ["data-locality"] },
      { id: "mci-data-protection-0001", cert: "NCP-MCI", domain: "data-protection", difficulty: 2,
        stem: "At Redundancy Factor 3 (RF3), how many copies of metadata does the cluster keep?",
        options: ["2", "3", "5", "7"],
        correctIndex: 2,
        explanation: "RF3 keeps three data copies but five metadata copies; the higher metadata count maintains quorum and lets the cluster survive two simultaneous failures.",
        briefing: "RF3 = 3 data copies and 5 metadata copies, to survive two failures.",
        tags: ["redundancy-factor", "rf3"] },
      { id: "mci-storage-0002", cert: "NCP-MCI", domain: "storage", difficulty: 3,
        stem: "Erasure Coding on an RF2 container requires a minimum of how many nodes?",
        options: ["2", "3", "4", "6"],
        correctIndex: 2,
        explanation: "Erasure Coding stores data stripes plus parity instead of full copies. On RF2 it needs at least four nodes so a stripe and its parity can survive a node failure.",
        briefing: "Erasure Coding trades space for stripes + parity; RF2 needs at least four nodes.",
        tags: ["erasure-coding"] },
      { id: "mci-storage-0003", cert: "NCP-MCI", domain: "storage", difficulty: 2,
        stem: "For a storage container, what does the Advertised Capacity setting define?",
        options: ["A guaranteed minimum (floor)", "A maximum size the container can grow to (ceiling)", "Its replication factor", "Its cache size"],
        correctIndex: 1,
        explanation: "Advertised Capacity is the ceiling — the maximum size a container reports/can grow to. Reserved Capacity is the opposite: a guaranteed floor carved from the shared pool.",
        briefing: "Advertised = ceiling; Reserved = floor.",
        tags: ["capacity", "advertised", "reserved"] },
      { id: "mci-vms-0001", cert: "NCP-MCI", domain: "vms", difficulty: 1,
        stem: "What is the default virtual disk bus type for VMs running on AHV?",
        options: ["IDE", "SATA", "SCSI", "NVMe"],
        correctIndex: 2,
        explanation: "AHV presents VM virtual disks on the SCSI bus by default, which provides good performance and broad guest OS support.",
        briefing: "AHV defaults VM disks to the SCSI bus.",
        tags: ["ahv", "disk-bus"] },
      { id: "mci-data-protection-0002", cert: "NCP-MCI", domain: "data-protection", difficulty: 2,
        stem: "What is the minimum number of nodes required for a cluster to self-heal from a single node failure at Redundancy Factor 2 (RF2)?",
        options: ["2", "3", "4", "5"],
        correctIndex: 1,
        explanation: "RF2 keeps two data copies, so three nodes are required: after one node fails, the cluster still has enough remaining nodes to restore a second copy and return to a protected state.",
        briefing: "RF2 needs a minimum of three nodes to tolerate and rebuild from one failure.",
        tags: ["redundancy-factor", "rf2", "fault-tolerance"] }
    ]
  };

  /* =================================================================== *
   * 13. Core assembly + init
   * =================================================================== */
  // Pre-populate a minimal core so consumers that read tokens/factories
  // before initCore() still work.
  StarNix.core = StarNix.core || {};
  StarNix.core.theme = THEME;
  StarNix.core.audio = StarNix._audio || StarNix.core.audio || NoopAudio;
  StarNix.core.makeRng = makeRng;
  StarNix.core.escapeHTML = escapeHTML;
  StarNix.core.sanitize = escapeHTML;
  StarNix.core.validateBank = validateBank;
  StarNix.core.clock = clock;
  StarNix.core.version = CORE_VERSION;
  StarNix.BUILD = BUILD_VERSION;           // "0.6.0"
  StarNix.BUILD_DATE = BUILD_DATE;
  StarNix.BUILD_LABEL = BUILD_LABEL;       // "v0.6.0 · 2026-06-24" — what the shell badge shows

  // Build the live core from a loaded profile. Idempotent-ish; returns core.
  StarNix.initCore = function (opts) {
    opts = opts || {};
    if (typeof document !== "undefined") injectTheme(document);

    var persistence = opts.persistence || makeLocalStorageProvider({ storage: opts.storage });
    return persistence.load().then(function (profile) {
      var telemetry = opts.telemetry || makeTelemetry({ sink: opts.telemetrySink });
      var mastery = makeMasteryStore(profile, {
        onChange: function () { persistence.save(profile); },
        onAnswer: function (e) { telemetry.emit(e); }   // (v0.183.0, Backend#7) the standardized answer event
      });

      // v0.52.0 unit 2: complete the 01 persistence seam ARM already calls (guarded — it was a
      // silent no-op until now). Records the game's best score + awards run XP into the pool.
      // Bound to the LIVE profile object here so it can never desync from core.profile.
      if (!persistence.update) {
        // (v0.108.0, G4 HIGH) the ONLY safe way for games to write profile fields: load()
        // returns storage CLONES, and the mastery store saves the LIVE profile on every
        // answer — so clone-writes (checkpoints, achievement flags, settings) were being
        // clobbered last-writer-wins. update() mutates the live object, then persists it.
        persistence.update = function (fn) {
          try { if (typeof fn === "function") fn(profile); } catch (eU) {}
          return persistence.save(profile);
        };
      }
      if (!persistence.submitScore) {
        persistence.submitScore = function (game, score, meta) {
          try {
            var g = String(game || "GAME");
            var b = profile.bests = profile.bests || {};
            if (typeof score === "number" && (typeof b[g] !== "number" || score > b[g])) b[g] = score;
            addXP(profile, xpForScore(g, score));
            evaluateAchievements(profile);   // v0.53.0 unit 3: score-fed unlocks (e.g. station-restored)
            persistence.save(profile);
          } catch (e) {}
          return Promise.resolve();
        };
      }

      // Real bank (window.STARNIX_QUESTIONS / opts.pack) merged with the verified
      // built-in fixture as a seed; dedup by id + normalized stem. Invalid -> fixture.
      var external = opts.pack || (typeof global !== "undefined" && global.STARNIX_QUESTIONS) || null;
      var pack;
      if (external && external !== SAMPLE_PACK && external.questions && external.questions.length) {
        var qs = external.questions.slice(), byId = {}, byStem = {}, ii;
        for (ii = 0; ii < qs.length; ii++) { byId[qs[ii].id] = 1; var nsx = normStem(qs[ii].stem || ""); if (nsx) byStem[nsx] = 1; }
        for (ii = 0; ii < SAMPLE_PACK.questions.length; ii++) {
          var fq = SAMPLE_PACK.questions[ii], nsf = normStem(fq.stem || "");
          if (!byId[fq.id] && !(nsf && byStem[nsf])) qs.push(fq);
        }
        pack = { id: external.id || SAMPLE_PACK.id, name: external.name || SAMPLE_PACK.name, domains: external.domains || DOMAINS, questions: qs };
      } else { pack = external || SAMPLE_PACK; }
      var report = validateBank(pack);
      if (!report.ok) {
        try { if (global.console && console.error) console.error("StarNix: question bank failed validation", report.errors); } catch (x) {}
        if (!opts.allowInvalidBank) {
          // Fail loud but stay alive: fall back to the verified fixture.
          pack = SAMPLE_PACK;
          report = validateBank(SAMPLE_PACK);
        }
      }
      var questions = makeQuestionProvider(pack, mastery);
      var seed = (opts.seed != null) ? opts.seed : clock.now();
      var rng = makeRng(seed);
      var ai = opts.ai || StaticAI;
      var audio = StarNix._audio || StarNix.core.audio || NoopAudio;

      var core = StarNix.core;
      core.questions = questions;
      core.mastery = mastery;
      core.persistence = persistence;
      core.rng = rng;
      core.audio = audio;
      core.theme = THEME;
      core.telemetry = telemetry;
      core.ai = ai;
      core.profile = profile;
      core.pack = pack;
      core.bankReport = report;
      core.makeRng = makeRng;
      core.escapeHTML = escapeHTML;
      core.sanitize = escapeHTML;
      core.validateBank = validateBank;
      core.clock = clock;
      core.version = CORE_VERSION;
      core.seed = seed;
      installErrorRing(core);   // (v0.147.0, V1.1 Backend#3) field errors land on the profile
      return core;
    });
  };

  /* Build the per-game CoreContext (01 §9). The shell calls this at mount.
   * Guaranteed keys (frozen contract): questions, mastery, persistence, rng,
   * audio, theme, telemetry. Also provided: ai (no-op seam), settings
   * (read-only, for a11y per 01 §12), sanitize (DOM-safety per 05). */
  var mountSeq = 0;   // (v0.91.0) per-mount fork salt — see 01 v1.6 §9a.2
  StarNix.makeContext = function (gameId) {
    var c = StarNix.core;
    return {
      questions: c.questions,
      mastery: c.mastery,
      persistence: c.persistence,
      // (v0.91.0, 01 v1.6 §9a.2) fork() derives from the rng's ORIGINAL seed, so the old
      // static salt ("game:"+id) handed every remount an IDENTICAL stream — same questions,
      // same order, same shuffled answer positions, every session in one loaded page. The
      // mount sequence varies each fork while staying fully deterministic from the boot seed.
      rng: c.rng.fork("game:" + (gameId || "anon") + ":" + (++mountSeq)),
      audio: c.audio,
      theme: c.theme,
      telemetry: c.telemetry,
      ai: c.ai,
      assets: global.STARNIX_ASSETS || {},   // inlined sprites/art (assets.js); games read e.g. ctx.assets.armBoss
      settings: c.profile ? c.profile.settings : defaultSettings(),
      perks: rankPerks(c.profile && typeof c.profile.xp === "number" ? c.profile.xp : 0),   // (v0.179.0, Flow#7) rank perks snapshot — additive ctx key (01 s9a)
      rewards: null,   // reserved
      sanitize: c.escapeHTML
    };
  };

  /* Commander-rank XP surface (v0.52.0 unit 2) — pure/deterministic; the shell renders from it.
   * Games never call this directly; XP flows through the existing seams only. */
  StarNix.xp = {
    AWARDS: XP_AWARDS, RANKS: RANKS, rankFor: rankFor,
    REWARDS: RANK_REWARDS, perks: rankPerks, rewardsAt: rankRewardsAt,   // (v0.179.0, V1.1 Flow#7)
    forAnswer: xpForAnswer, forExam: xpForExam, forScore: xpForScore, add: addXP
  };

  /* Achievements surface (v0.53.0 unit 3) — LIST is read-only data for renderers;
   * evaluate() is idempotent (unlocked ids never re-fire, XP awards once);
   * onUnlock(fn) is the shell's toast hook. */
  StarNix.achievements = {
    LIST: ACH_LIST,
    evaluate: evaluateAchievements,
    onUnlock: function (fn) { achOnUnlock = (typeof fn === "function") ? fn : null; }
  };

  /* Cosmetics surface (v0.57.0 unit 7; latch added v0.65.0) — defs + unlock/resolve/latch. */
  StarNix.cosmetics = {
    LIST: COSMETICS,
    THRESHOLD: COSMETIC_THRESHOLD,
    unlocked: cosmeticUnlocked,
    resolve: resolveCosmetic,
    latch: latchCosmetics
  };

  /* Daily-missions surface (v0.56.0 unit 6) — pure generation + profile-bound state.
   * TEMPLATES is renderer data; gen(date) is the determinism seam the gate pins. */
  StarNix.daily = {
    TEMPLATES: DAILY_TEMPLATES,
    dayKey: dayKey,
    gen: genDaily,
    ensure: ensureDaily,
    state: dailyMissionState,
    claim: claimDaily,
    streak: studyStreakDays
  };

  /* Flight plan (v0.141.0, V1.1 Flow#2) — "what should I do right now?" as a PURE ranking
   * over explicit signals, so the gate can pin every branch without live state. Order:
   * due reviews > first undone daily > sim recency (none ever / >=7 days stale) > weakest
   * domain (<80% mastered) > all clear. next() gathers the signals from a live core. */
  function flightPlan(sig) {
    sig = sig || {};
    var due = sig.dueCount | 0;
    if (due > 0) return { kind: "due", label: due + " review" + (due === 1 ? "" : "s") + " due \u2014 clear the queue first", cta: "Review \u25b8", action: "due" };
    var ds = sig.daily || [];
    for (var i = 0; i < ds.length; i++) {
      var st = ds[i];
      if (st && !st.done) {
        var g = (st.mission && st.mission.game) || null;
        return { kind: "daily", label: "Daily: " + (st.label || st.name || "mission"), cta: g ? "Launch " + g + " \u25b8" : "Go \u25b8", action: g ? "game" : "progress", game: g };
      }
    }
    var DAY = 86400000, now = sig.now != null ? sig.now : clock.now();
    if (!sig.lastSimAt) return { kind: "sim", label: "No exam sim on record \u2014 fly one to calibrate readiness", cta: "Run a sim \u25b8", action: "sim" };
    var days = Math.floor((now - sig.lastSimAt) / DAY);
    if (days >= 7) return { kind: "sim", label: "No sim in " + days + " days \u2014 time to re-calibrate", cta: "Run a sim \u25b8", action: "sim" };
    var wk = sig.weakest;
    if (wk && (wk.masteredPct || 0) < 0.8) return { kind: "domain", label: "Weakest domain: " + wk.domain + " (" + Math.round((wk.masteredPct || 0) * 100) + "% mastered) \u2014 drill it", cta: "Open Codex \u25b8", action: "progress", domain: wk.domain };
    return { kind: "clear", label: "All clear \u2014 fly any mission for XP", cta: null, action: null };
  }
  function flightPlanFromCore(core, now) {
    now = now != null ? now : clock.now();
    var sig = { now: now, dueCount: 0, daily: [], lastSimAt: 0, weakest: null };
    try { sig.dueCount = core.mastery.dueList(now).length; } catch (e1) {}
    try {
      ensureDaily(core.profile);
      for (var i = 0; i < core.profile.daily.missions.length; i++) {
        var st = dailyMissionState(core.profile, i);
        if (st && !st.claimed) sig.daily.push(st);
      }
    } catch (e2) {}
    try { var hist = core.profile.examHistory || []; for (var h = hist.length - 1; h >= 0; h--) { if (hist[h].mode === "sim") { sig.lastSimAt = hist[h].at || 0; break; } } } catch (e3) {}
    try { var stx = core.questions.stats(); if (stx.domains && stx.domains[0]) sig.weakest = { domain: stx.domains[0].domain, masteredPct: stx.domains[0].masteredPct }; } catch (e4) {}
    return flightPlan(sig);
  }
  StarNix.plan = { rank: flightPlan, next: flightPlanFromCore };

  /* Field error ring (v0.147.0, V1.1 Backend#3) — the v0.116 radar bug threw 60x/s in real
   * browsers for five releases while jsdom's null-context early-return kept every harness
   * green. These handlers catch that class in the FIELD: a capped ring on the profile turns
   * "it felt weird yesterday" into a stack head. record() must never throw and never spam —
   * a repeat of the newest message increments its count instead of burning ring slots. */
  var ERROR_RING_CAP = 20;
  function recordError(profile, e) {
    try {
      if (!profile) return null;
      var ring = profile.errors || (profile.errors = []);
      var msg = String((e && e.msg) || "unknown").slice(0, 200);
      var last = ring.length ? ring[ring.length - 1] : null;
      if (last && last.msg === msg) { last.n = (last.n | 0) + 1; last.ts = (e && e.ts) || clock.now(); return last; }
      var entry = {
        msg: msg,
        stk: String((e && e.stk) || "").slice(0, 300),
        scr: String((e && e.scr) || "").slice(0, 40),
        build: BUILD_VERSION,
        ts: (e && e.ts) || clock.now(),
        n: 1
      };
      ring.push(entry);
      if (ring.length > ERROR_RING_CAP) ring.splice(0, ring.length - ERROR_RING_CAP);
      return entry;
    } catch (eR) { return null; }
  }
  function installErrorRing(core) {
    try {
      if (!global.addEventListener || StarNix._errRingInstalled) return;
      StarNix._errRingInstalled = true;
      function scr() { try { return (StarNix._errScreen && StarNix._errScreen()) || ""; } catch (eS) { return ""; } }
      function land(msg, stack) {
        try {
          recordError(core.profile, { msg: msg, stk: stack, scr: scr() });
          if (core.persistence && core.persistence.save) core.persistence.save(core.profile);   // debounced
        } catch (eL2) {}
      }
      global.addEventListener("error", function (ev) {
        try { land((ev && ev.message) || "script error", ev && ev.error && ev.error.stack ? String(ev.error.stack).split("\n").slice(0, 3).join(" | ") : ""); } catch (eE) {}
      });
      global.addEventListener("unhandledrejection", function (ev) {
        try {
          var r = ev && ev.reason;
          land("unhandledrejection: " + (r && r.message ? r.message : String(r)).slice(0, 160), r && r.stack ? String(r.stack).split("\n").slice(0, 3).join(" | ") : "");
        } catch (eP) {}
      });
    } catch (eI) {}
  }
  StarNix.errors = { record: recordError, install: installErrorRing, CAP: ERROR_RING_CAP };

  /* Miss pile (v0.146.0, V1.1 NIT#3) — "the exact questions you got wrong", DERIVED from the
   * Leitner ledger instead of a second persisted store: every wrong bumps m.incorrect and
   * resets m.streak, so `incorrect > 0 && streak < 2` IS "missed and not yet redeemed by two
   * consecutive corrects" — across every surface (games + exams), with zero bookkeeping drift. */
  /* Blueprint quotas (v0.163.0, V1.1 Flow#5) — the MECHANISM ships; the WEIGHTS are
   * QUARANTINED. Checked 2026-07-11: the official NCP-MCI 6.5 Exam Blueprint Guide
   * (nutanix.com .../ebg-ncp-mci-6-5.pdf) publishes NO per-section weights — s1.5 says only
   * that question counts per objective "relate to the criticality of the task". Per the
   * learning-integrity rule, unverifiable values do not ship: WEIGHTS stays null and sims
   * keep today's flat shuffle until Jason ratifies a table (evidence packet in
   * BLUEPRINT_EVIDENCE.md, including the objectives-per-section proxy and the needed
   * official-section -> house-domain mapping). quota() itself is pure and gate-pinned. */
  StarNix.blueprint = {
    WEIGHTS: null,
    quota: function (pool, count, weights) {
      if (!weights || !pool || !pool.length || !(count > 0)) return null;   // quarantined / degenerate -> caller falls back to flat
      var byDom = {}, doms = [], i, d;
      for (i = 0; i < pool.length; i++) {
        d = pool[i].domain || "?";
        if (!byDom[d]) { byDom[d] = []; doms.push(d); }
        byDom[d].push(pool[i]);
      }
      var want = {}, assigned = 0;
      for (i = 0; i < doms.length; i++) {
        d = doms[i];
        var w = weights[d] || 0;
        want[d] = Math.min(byDom[d].length, Math.round(count * w));
        assigned += want[d];
      }
      // rounding drift + thin domains: top up round-robin from domains that still have stock
      var guard = 0;
      while (assigned < count && guard++ < 1000) {
        var grew = false;
        for (i = 0; i < doms.length && assigned < count; i++) {
          d = doms[i];
          if (want[d] < byDom[d].length) { want[d]++; assigned++; grew = true; }
        }
        if (!grew) break;                                     // the pool itself is smaller than count
      }
      while (assigned > count) {                               // trim overshoot from the largest takes
        var big = null;
        for (i = 0; i < doms.length; i++) { d = doms[i]; if (want[d] > 0 && (big === null || want[d] > want[big])) big = d; }
        if (big === null) break;
        want[big]--; assigned--;
      }
      var out = [];
      for (i = 0; i < doms.length; i++) { d = doms[i]; for (var k = 0; k < want[d]; k++) out.push(byDom[d][k]); }
      return out;
    }
  };

  StarNix.missPile = {
    ids: function (masteryMap, cap) {
      var out = [];
      for (var id in masteryMap) {
        if (!Object.prototype.hasOwnProperty.call(masteryMap, id)) continue;
        var m = masteryMap[id];
        if (m && m.seen > 0 && (m.incorrect | 0) > 0 && (m.streak | 0) < 2) out.push({ id: id, misses: m.incorrect | 0, at: m.lastSeen || 0 });
      }
      out.sort(function (a, b) { return (b.at - a.at) || (b.misses - a.misses) || (a.id < b.id ? -1 : 1); });
      if (cap && out.length > cap) out.length = cap;
      return out;
    }
  };

  /* ---- test/integration hooks (not part of the game-facing contract) - */
  StarNix._internal = {
    makeRng: makeRng, makeQuestionProvider: makeQuestionProvider,
    shuffleQuestionOptions: shuffleQuestionOptions,
    questionTimerSeconds: questionTimerSeconds,
    makeMasteryStore: makeMasteryStore, makeLocalStorageProvider: makeLocalStorageProvider,
    makeTelemetry: makeTelemetry, validateBank: validateBank, defaultProfile: defaultProfile,
    migrate: migrate, SAMPLE_PACK: SAMPLE_PACK, THEME: THEME, StaticAI: StaticAI,
    NoopAudio: NoopAudio, escapeHTML: escapeHTML, DOMAINS: DOMAINS, clock: clock,
    constants: { MAX_BUCKET: MAX_BUCKET, MASTERED_BUCKET: MASTERED_BUCKET, INTERVALS: INTERVALS, W: W }
  };

})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
