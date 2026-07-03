/* cc-death-paths.cjs — (v0.81.0) every way a CC run can end must land on the crash screen.
 * Mounts the REAL module UI (createCCModule, no-THREE fallback) in jsdom and drives the three
 * death paths end to end: B collision (chip drain during RUN), A wrong-click at a gate,
 * C killing timeout (must render the feedback FIRST — learning integrity — then See results
 * leads to SHIP DOWN). Born from a live bug: showOver's only call site was the See-results
 * click, so collision deaths froze on a dead world and killing timeouts soft-locked the
 * question overlay. Run: node cc-death-paths.cjs [path-to-cc.js]
 */
'use strict';
var fs = require('fs');
var REPO = __dirname;
var SRC = process.argv[2] || (REPO + '/cc.js');
var { JSDOM } = require(REPO + '/node_modules/jsdom');
var code = fs.readFileSync(SRC, 'utf8');

function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function makeRng(seed) { var f = mulberry32(seed); return { next: f, int: function (n) { return Math.floor(f() * n); }, pick: function (a) { return a[Math.floor(f() * a.length)]; }, fork: function () { return makeRng(seed + 7); } }; }

function freshMount() {
  var dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>');
  var win = dom.window;
  var RAF = [], RID = 0, NOW = 1000;
  win.requestAnimationFrame = function (cb) { RID++; RAF.push({ id: RID, cb: cb }); return RID; };
  win.cancelAnimationFrame = function (id) { for (var i = 0; i < RAF.length; i++) if (RAF[i].id === id) { RAF.splice(i, 1); return; } };
  function flush(n, dtMs) { dtMs = dtMs || (1000 / 60); for (var i = 0; i < n && RAF.length; i++) { NOW += dtMs; var j = RAF.shift(); j.cb(NOW); } }
  globalThis.window = win; globalThis.document = win.document; globalThis.self = win;
  try { Object.defineProperty(globalThis, 'navigator', { value: win.navigator, configurable: true }); } catch (e) {}
  (0, eval)(code);
  var ctx = {
    rng: makeRng(13),
    questions: {
      next: function () { return { question: { id: 'q1', domain: 'storage', difficulty: 1, stem: 'Pick A', options: ['A-right', 'B-wrong', 'C-wrong', 'D-wrong'], correctIndex: 0, explanation: 'because' }, reason: 'probe' }; },
      timerSeconds: function () { return 2; }
    },
    mastery: { record: function () {} },
    persistence: { load: function () { return Promise.resolve({}); }, save: function () {} },
    telemetry: { emit: function () {} },
    audio: { sfx: function () {}, ensure: function () {}, playTrack: function () {}, setMusic: function () {}, setSfx: function () {} },
    theme: {}, exit: function () {}
  };
  var mod = win.CC.createCCModule();
  mod.mount(win.document.getElementById('host'), ctx);
  return { win: win, doc: win.document, mod: mod, sim: mod._sim(), flush: flush };
}

function startRun(h) {
  h.flush(360);
  var cont = h.doc.querySelector('.cc-howto-cont');
  if (cont) cont.dispatchEvent(new h.win.MouseEvent('click', { bubbles: true }));
  h.flush(10);
}
function report(h, tag) {
  var d = h.doc;
  var seeResults = null;
  d.querySelectorAll('button').forEach(function (b) { if (b.textContent === 'See results') seeResults = b; });
  var r = {
    phase: h.sim.phase,
    gameover: d.querySelector('.cc-gameover').style.display,
    title: d.querySelector('.cc-ovr-title').textContent,
    garage: d.querySelector('.cc-garage') ? d.querySelector('.cc-garage').style.display : '?',
    overlay: d.querySelector('.cc-overlay').style.display,
    seeResults: !!seeResults
  };
  console.log(tag + ': phase=' + r.phase + ' gameover="' + r.gameover + '" title="' + r.title + '" garage="' + r.garage + '" qOverlay="' + r.overlay + '" seeResults=' + r.seeResults);
  return r;
}

(async function () {
  console.log('SOURCE: ' + SRC + '\n');

  // PATH B: collision death
  var h = freshMount(); await Promise.resolve(); startRun(h);
  h.sim.shields = 1; h.sim._onCrash();
  h.flush(30); await new Promise(function (r) { setTimeout(r, 150); }); h.flush(10);
  var B = report(h, '[B collision ]');

  // PATH A: question wrong-click death
  h = freshMount(); await Promise.resolve(); startRun(h);
  h.sim.shields = 1; h.sim._passGate({ power: false, kind: null }); h.flush(5);
  var opts = h.doc.querySelectorAll('.cc-opt');
  opts[1].dispatchEvent(new h.win.MouseEvent('click', { bubbles: true }));
  h.flush(5);
  var sr = null; h.doc.querySelectorAll('button').forEach(function (b) { if (b.textContent === 'See results') sr = b; });
  var prematureOver = h.doc.querySelector('.cc-gameover').style.display !== 'none';  // fired behind the feedback?
  if (sr) sr.dispatchEvent(new h.win.MouseEvent('click', { bubbles: true }));
  await new Promise(function (r) { setTimeout(r, 150); }); h.flush(10);
  var A = report(h, '[A wrong-click]');
  console.log('               premature gameover behind feedback: ' + prematureOver);

  // PATH C: killing timeout
  h = freshMount(); await Promise.resolve(); startRun(h);
  h.sim.shields = 2; h.sim._passGate({ power: false, kind: null }); h.flush(5);
  h.flush(200); await new Promise(function (r) { setTimeout(r, 150); }); h.flush(60);
  // the design: a killing timeout must render the feedback (explanation stays readable),
  // then See results leads to the crash screen — click it like a real player would
  var srC = null; h.doc.querySelectorAll('button').forEach(function (b) { if (b.textContent === 'See results') srC = b; });
  var cFeedback = !!srC;
  if (srC) srC.dispatchEvent(new h.win.MouseEvent('click', { bubbles: true }));
  await new Promise(function (r) { setTimeout(r, 150); }); h.flush(10);
  var C = report(h, '[C timeout    ]');
  console.log('               timeout rendered feedback + See results: ' + cFeedback);

  var fails = 0;
  function ok(cond, name) { console.log((cond ? '  \u2713 ' : '  \u2717 ') + name + (cond ? '' : '  <-- FAIL')); if (!cond) fails++; }
  console.log('');
  ok(B.gameover === 'flex' && /SHIP DOWN/.test(B.title) && B.garage === 'block',
     'collision death shows SHIP DOWN + auto-opened Garage (no See-results click needed)');
  ok(B.overlay === 'none', 'collision death leaves no stuck question overlay');
  ok(A.gameover === 'flex' && /SHIP DOWN/.test(A.title) && A.garage === 'block' && !prematureOver,
     'wrong-click death: feedback first, SHIP DOWN after See results, never behind the feedback');
  ok(cFeedback, 'killing timeout renders the feedback + See results (no soft-lock, explanation readable)');
  ok(C.gameover === 'flex' && /SHIP DOWN/.test(C.title) && C.garage === 'block' && C.overlay === 'none',
     'killing timeout: See results lands on SHIP DOWN + Garage, overlay closed');
  console.log(fails ? '\nCC DEATH PATHS: ' + fails + ' FAILED of 5' : '\nCC DEATH PATHS: ALL GREEN (5/5)');
  process.exit(fails ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(2); });
