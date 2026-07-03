/* arm-headless.cjs — shared helpers for the ARM node harnesses (arm-run.cjs).
 * Mirrors kbb-headless.cjs (v0.50.0) with the ARM-specific ctx deltas:
 *   - rng gains shuffle(arr) (copy, Fisher-Yates) + range(a,b) — arm.js calls runRng.shuffle
 *   - questions gains pool() (pickDomain probes it, try/catch'd in arm.js)
 *   - ctx.test = true by default: arm.js honors TESTMODE and starts NO RAF loop —
 *     harnesses drive frames through root.__armTest.step(dt) instead.
 * Exports:
 *   ARM_SRC — the arm.js source string (harnesses eval it inside their own jsdom window)
 *   ok(cond, name) / group(title) — assertion tally; call summary() at the end (exits 1 on fails)
 *   makeCtx(opts) — a contract-shaped mock ctx (01 §ctx): seeded rng w/ fork/int/pick/shuffle,
 *     a deterministic questions.next provider ({question, reason}), Promise persistence,
 *     mastery/telemetry/audio recorders.
 * Run nothing directly — this is a library.
 */
'use strict';
var fs = require('fs'), path = require('path');

var ARM_SRC = fs.readFileSync(path.join(__dirname, 'arm.js'), 'utf8');

var fails = 0, total = 0;
function group(title) { console.log('\n' + title); }
function ok(cond, name) { total++; console.log((cond ? '  ✓ ' : '  ✗ ') + name + (cond ? '' : '  <-- FAIL')); if (!cond) fails++; }
function summary(tag) {
  console.log('\n' + (fails ? (tag + ': ' + fails + ' FAILED of ' + total) : (tag + ': ALL GREEN (' + total + '/' + total + ')')));
  if (fails) process.exit(1);
}

// xorshift32 — deterministic, matching the shape core.makeRng exposes
// (next/int/range/pick/shuffle/fork; shuffle returns a COPY, like the core's).
function makeRng(seed) {
  var s = (seed >>> 0) || 1;
  function next() { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }
  return {
    next: next,
    int: function (n) { return Math.floor(next() * n); },
    range: function (a, b) { return a + next() * (b - a); },
    pick: function (a) { return a[Math.floor(next() * a.length)]; },
    shuffle: function (arr) {
      var a = arr.slice();
      for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(next() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
      return a;
    },
    fork: function (label) { var h = 2166136261; label = String(label || ''); for (var i = 0; i < label.length; i++) { h ^= label.charCodeAt(i); h = (h * 16777619) >>> 0; } return makeRng((s ^ h) >>> 0); }
  };
}

// Deterministic question provider: 40 synthetic questions across two domains, single + multi,
// honoring excludeIds. correctIndex is always 0 pre-shuffle; when opts.shuffle the provider
// returns pre-shuffled options with correctIndex/correctIndices remapped (mirrors the core).
// pool() returns the raw bank (arm.js pickDomain probes it inside try/catch).
function makeQuestions(rng) {
  var bank = [];
  for (var i = 0; i < 40; i++) {
    var multi = (i % 7 === 3);
    bank.push({
      id: 'hq' + i,
      domain: i % 2 ? 'vms' : 'storage',
      difficulty: 1 + (i % 3),
      stem: 'Harness question ' + i + (multi ? ' (choose two)' : ''),
      options: ['right-' + i, 'wrong-a', 'wrong-b', multi ? 'right2-' + i : 'wrong-c'],
      correctIndex: multi ? undefined : 0,
      correctIndices: multi ? [0, 3] : undefined,
      multi: multi,
      explanation: 'Because ' + i + '.',
      optionNotes: ['yes', 'no', 'no', multi ? 'yes' : 'no']
    });
  }
  var served = 0;
  return {
    _bank: bank,
    pool: function () { return bank; },
    next: function (q) {
      q = q || {};
      var ex = {}; (q.excludeIds || []).forEach(function (id) { ex[id] = 1; });
      var cand = bank.filter(function (b) { return !ex[b.id]; });
      if (!cand.length) cand = bank;
      var base = cand[served++ % cand.length];
      var out = JSON.parse(JSON.stringify(base));
      if (q.shuffle) {
        var r = q.rng || rng, idx = out.options.map(function (_, k) { return k; });
        for (var j = idx.length - 1; j > 0; j--) { var k2 = Math.floor(r.next() * (j + 1)); var t = idx[j]; idx[j] = idx[k2]; idx[k2] = t; }
        var opts2 = idx.map(function (o) { return out.options[o]; });
        if (out.multi) out.correctIndices = out.correctIndices.map(function (ci) { return idx.indexOf(ci); }).sort();
        else out.correctIndex = idx.indexOf(out.correctIndex);
        out.options = opts2;
      }
      return { question: out, reason: null };   // core contract: next() -> { question, reason }
    }
  };
}

function makeCtx(opts) {
  opts = opts || {};
  var rng = makeRng(opts.seed != null ? opts.seed : 7);
  var store = {};
  var rec = { mastery: [], telemetry: [], tracks: [], sfx: [], scores: [] };
  return {
    rng: rng,
    questions: makeQuestions(rng),
    mastery: { record: function (id, correct, meta) { rec.mastery.push({ id: id, correct: !!correct, meta: meta }); } },
    // Promise-shaped, matching the core: load() resolves the whole profile object; save(p) persists it.
    persistence: {
      load: function () { return Promise.resolve(store.profile ? JSON.parse(store.profile) : { bests: {}, settings: {} }); },
      save: function (p) { store.profile = JSON.stringify(p); return Promise.resolve(); },
      submitScore: function (game, score, meta) { rec.scores.push({ game: game, score: score, meta: meta }); }
    },
    telemetry: { emit: function (ev) { rec.telemetry.push(ev); } },
    audio: {
      ensure: function () {}, setMusic: function () {}, setSfx: function () {},
      sfx: function (n) { rec.sfx.push(n); },
      playTrack: function (id, o) { rec.tracks.push({ id: id, intensity: !!(o && o.intensity) }); }
    },
    theme: {},
    assets: {},
    settings: { reducedMotion: !!opts.reducedMotion, extraTime: !!opts.extraTime, colorblind: !!opts.colorblind },
    test: opts.test !== false,   // TESTMODE: arm.js starts no RAF; drive via __armTest.step(dt)
    exit: function () { rec.exited = true; },
    _rec: rec, _store: store
  };
}

module.exports = { ARM_SRC: ARM_SRC, ok: ok, group: group, summary: summary, makeCtx: makeCtx, makeRng: makeRng };
