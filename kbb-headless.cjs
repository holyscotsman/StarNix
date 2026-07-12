/* kbb-headless.cjs — shared helpers for the KBB node harnesses (kbb-run.cjs, kbb-draw.cjs).
 * Rebuilt v0.50.0 (the originals lived in the KBB chat's environment and never landed in this repo,
 * which left kbb-draw.cjs unrunnable). Exports:
 *   KBB_SRC  — the kbb.js source string (harnesses eval it inside their own jsdom window)
 *   ok(cond, name) / group(title) — assertion tally; call summary() at the end (exits 1 on fails)
 *   makeCtx(KBB, opts) — a contract-shaped mock ctx (01 §ctx): seeded rng w/ fork/int/pick/next,
 *     a deterministic questions.next provider, mastery/persistence/telemetry/audio recorders.
 * Run nothing directly — this is a library.
 */
'use strict';
var fs = require('fs'), path = require('path');

var KBB_SRC = fs.readFileSync(path.join(__dirname, 'kbb.js'), 'utf8');

var fails = 0, total = 0;
function group(title) { console.log('\n' + title); }
function ok(cond, name) { total++; console.log((cond ? '  \u2713 ' : '  \u2717 ') + name + (cond ? '' : '  <-- FAIL')); if (!cond) fails++; }
function summary(tag) {
  console.log('\n' + (fails ? (tag + ': ' + fails + ' FAILED of ' + total) : (tag + ': ALL GREEN (' + total + '/' + total + ')')));
  if (fails) process.exit(1);
}

// xorshift32 — deterministic, matching the shape core.makeRng exposes (next/int/pick/fork)
function makeRng(seed) {
  var s = (seed >>> 0) || 1;
  function next() { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }
  return {
    next: next,
    int: function (n) { return Math.floor(next() * n); },
    pick: function (a) { return a[Math.floor(next() * a.length)]; },
    fork: function (label) { var h = 2166136261; label = String(label || ''); for (var i = 0; i < label.length; i++) { h ^= label.charCodeAt(i); h = (h * 16777619) >>> 0; } return makeRng((s ^ h) >>> 0); }
  };
}

// Deterministic question provider: 40 synthetic questions across two domains, single + multi,
// honoring excludeIds. correctIndex is always 0 pre-shuffle; when opts.shuffle the provider
// returns pre-shuffled options with correctIndex/correctIndices remapped (mirrors the core).
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
      optionNotes: ['note-right', 'note-wrong-a', 'note-wrong-b', multi ? 'note-right2' : 'note-wrong-c']
    });
  }
  var served = 0;
  return {
    _bank: bank,
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

function makeCtx(KBB, opts) {
  opts = opts || {};
  var rng = makeRng(opts.seed != null ? opts.seed : 7);
  var store = {};
  var rec = { mastery: [], telemetry: [], tracks: [], sfx: [] };
  return {
    rng: rng,
    questions: makeQuestions(rng),
    mastery: { record: function (id, correct, meta) { rec.mastery.push({ id: id, correct: !!correct, meta: meta }); } },
    // Promise-shaped, matching the core: load() resolves the whole profile object; save(p) persists it.
    persistence: {
      load: function () { return Promise.resolve(store.profile ? JSON.parse(store.profile) : { bests: {}, settings: {} }); },
      save: function (p) { store.profile = JSON.stringify(p); return Promise.resolve(); },
      update: function (fn) { var p = store.profile ? JSON.parse(store.profile) : { bests: {}, settings: {} }; try { fn(p); } catch (e) {} store.profile = JSON.stringify(p); return Promise.resolve(); }   // (v0.201.0, KBB#10) live-profile seam, mock-shaped
    },
    telemetry: { emit: function (ev, data) { rec.telemetry.push({ ev: ev, data: data }); } },
    audio: {
      ensure: function () {}, setMusic: function () {}, setSfx: function () {},
      sfx: function (n) { rec.sfx.push(n); },
      playTrack: function (id, o) { rec.tracks.push({ id: id, intensity: !!(o && o.intensity) }); }
    },
    theme: {},
    assets: {},
    settings: { reducedMotion: !!opts.reducedMotion },
    _rec: rec, _store: store
  };
}

module.exports = { KBB_SRC: KBB_SRC, ok: ok, group: group, summary: summary, makeCtx: makeCtx, makeRng: makeRng };
