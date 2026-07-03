'use strict';
var H = require('./kbb-headless.cjs');
var group = H.group, ok = H.ok, makeCtx = H.makeCtx;
var JSDOM = require('jsdom').JSDOM, VC = require('jsdom').VirtualConsole;

function mount(opts) {
  opts = opts || {};
  var vc = new VC(); vc.on('jsdomError', function () {});
  var dom = new JSDOM('<!DOCTYPE html><body></body>', { runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
  var win = dom.window, rafQ = [];
  win.requestAnimationFrame = function (cb) { rafQ.push(cb); return rafQ.length; };
  win.cancelAnimationFrame = function () {};
  win.STARNIX_ASSETS = {};
  var mod = null; win.StarNix = { registerGame: function (m) { mod = m; } };
  win.eval(H.KBB_SRC);
  var tbase = 0;
  function step(n, dt) { dt = dt || 16; for (var k = 0; k < n; k++) { tbase += dt; var gen = rafQ.slice(); rafQ.length = 0; for (var i = 0; i < gen.length; i++) { try { gen[i](tbase); } catch (e) { step._err = step._err || e; } } } }
  return { win: win, doc: win.document, root: win.document.body, mod: mod, KBB: win.KBB, step: step };
}
function q(c, s) { return c.querySelector(s); }
function cineSkip(d) { return Array.prototype.slice.call(d.querySelectorAll('.kbb-skip')).find(function (b) { return /skip/i.test(b.textContent || ''); }); }
function clickText(c, sel, t) { var e = Array.prototype.slice.call(c.querySelectorAll(sel)); for (var i = 0; i < e.length; i++) { if ((e[i].textContent || '').indexOf(t) >= 0) { e[i].click(); return true; } } return true; }
function canvasOf(KBB) { var st = KBB._test.state(); return st ? st.canvas : null; }
function nonBlank(cv) { if (!cv || !cv.width) return false; var g = cv.getContext('2d'); var d; try { d = g.getImageData(0, 0, cv.width, cv.height).data; } catch (e) { return false; } for (var i = 0; i < d.length; i += 4) { if (d[i] > 8 || d[i + 1] > 8 || d[i + 2] > 8) return true; } return false; }

(function drawLoop() {
  group('draw loop: real 2D context (node-canvas), every phase executes + paints');
  var V = mount(), KBB = V.KBB, mod = V.mod, doc = V.doc;
  // sanity: real context present
  var probe = doc.createElement('canvas'); probe.width = 8; probe.height = 8;
  ok(!!probe.getContext('2d') && typeof probe.getContext('2d').getImageData === 'function', 'jsdom is using a real 2D context (node-canvas)');

  var ctxRef = makeCtx(KBB, { seed: 9, reducedMotion: false });
  mod.mount(V.root, ctxRef);
  V.step(2);
  var cv = canvasOf(KBB);
  ok(!!cv && cv.width > 0 && cv.height > 0, 'combat canvas has real pixel dimensions (' + (cv ? cv.width + 'x' + cv.height : 'none') + ')');

  // (v0.68.0, J6) cinematic FIRST at mount (no how-to gate, no pre-run shop)
  V.step(20, 60);                              // ~1.2s of intro frames
  ok(!V.step._err, 'intro cutscene frames do not throw');
  ok(nonBlank(cv), 'intro paints the canvas');
  cineSkip(doc).click();                        // end intro -> LIVE first battle with the how-to tour over it

  V.step(10);
  ok(!V.step._err, 'live battle + how-to overlay frames do not throw');
  ok(nonBlank(cv), 'belt backdrop paints under the how-to tour');
  q(doc, '.kbb-ht-skip').click();               // (J6) the tour rides on top of the populated battle
  V.step(4);

  // battle is already live (straight-to-battle opening)
  var s = KBB._test.state(), sid = null;
  for (var i = 0; i < KBB.ARTIFACTS.length; i++) { if (KBB.isSellable(KBB.ARTIFACTS[i])) { sid = KBB.ARTIFACTS[i].id; break; } }
  KBB.equipArtifact(s.run, sid);
  V.step(12);
  ok(!V.step._err, 'battle frames (heroes + enemy + belt) do not throw');
  ok(nonBlank(cv), 'battle scene paints');

  // exercise hero attack FX with one correct answer (hero lunge + impact + likely win/transition)
  (function () {
    var st = KBB._test.state(); if (!st || !st.run.battle || !st.run.battle.question) return;
    var qq = st.run.battle.question;
    var b = q(doc, '.kbb-main .kbb-opt[data-idx="' + qq.correctIndex + '"]'); if (b) b.click();
    V.step(16, 24);                            // animate hero lunge + impact ring
    var cont = q(doc, '.kbb-main .kbb-cont:not(.kbb-submit)'); if (cont) cont.click();
    V.step(6);
  })();
  ok(!V.step._err, 'correct-answer FX (hero lunge + impact + win transition) frames do not throw');
  ok(nonBlank(cv), 'scene still paints after the attack');

  // (v0.80.0, JB3) render EVERY cinematic fx type under a real canvas in one burst:
  // telegraph, bolt, debris, shield dome, heal motes, shockwave, quake, banner, offset flash
  (function () {
    var st = KBB._test.state(); if (!st) return;
    if (!st.fx) st.fx = [];
    var t0 = st.lastTs || 0;
    var burst = [
      { type: 'charge', side: 'player', dur: 180, col: '#1FDDE9' },
      { type: 'beam', side: 'enemy', dur: 190, col: '#1FDDE9' },
      { type: 'sparks', side: 'enemy', dur: 620, col: '#FF6B5B', count: 12, seed: 3 },
      { type: 'dome', side: 'player', dur: 520 },
      { type: 'motes', side: 'player', dur: 900 },
      { type: 'shock', side: 'enemy', dur: 700, col: '#FFC857' },
      { type: 'quake', side: 'enemy', dur: 340, amt: 0.5 },
      { type: 'banner', side: 'enemy', dur: 1500, text: 'TARGET DESTROYED', col: '#FFC857' },
      { type: 'flash', side: 'enemy', dur: 240, flashR: 30, dx: -18, dy: -10 }
    ];
    for (var bi = 0; bi < burst.length; bi++) { burst[bi].start = t0; st.fx.push(burst[bi]); }
    V.step(30, 30);
  })();
  ok(!V.step._err, 'JB3: all nine cinematic fx types render clean under a real canvas');
  // (v0.100.0, K6) the sfx fx type FIRES through the audio seam when its beat renders
  (function () {
    var st = KBB._test.state(); if (!st || !st.fx) return;
    var n0 = ctxRef._rec.sfx.length;
    st.fx.push({ type: 'sfx', name: 'laserfire', side: 'enemy', dur: 60, start: st.lastTs || 0 });
    V.step(4, 30);
    ok(ctxRef._rec.sfx.indexOf('laserfire') >= n0 - 1 && ctxRef._rec.sfx.length > n0,
       'K6: beat-synced sfx fires through ctx.audio when rendered');
  })();
  mod.unmount();

  // Fresh mount: drive an all-wrong battle to lost (never wins -> stays in battle),
  // exercising the enemy-attack FX every turn and the draw loop under the lost modal.
  group('draw loop: enemy-attack FX + frames under the lost modal');
  var V2 = mount(), KBB2 = V2.KBB, mod2 = V2.mod, doc2 = V2.doc;
  mod2.mount(V2.root, makeCtx(KBB2, { seed: 4, reducedMotion: false }));
  V2.step(2);
  var cv2 = canvasOf(KBB2);
  cineSkip(doc2).click();                       // (v0.68.0, J6) cinematic first...
  V2.step(2);
  q(doc2, '.kbb-ht-skip').click();              // ...then the tour over the live battle
  V2.step(6);
  var lost = false, guard = 0;
  while (guard++ < 32) {   // (v0.100.0) leaner squad + softer chip = more turns to reach lost
    var st2 = KBB2._test.state(); if (!st2) break;
    if (st2.run.phase === 'lost') { lost = true; break; }
    var qq2 = st2.run.battle && st2.run.battle.question;
    if (!qq2) { var c0 = q(doc2, '.kbb-main .kbb-cont:not(.kbb-submit)'); if (c0) { c0.click(); V2.step(2); continue; } break; }
    // wrong pick for single AND multi draws. (v0.100.0) multi needs a FULL selection or the
    // submit button never enables (the old one-right-index pick stalled the driver here).
    if (qq2.multi) {
      var need = qq2.correctIndices.length, picked = 0;
      var okSet = {}; for (var ci3 = 0; ci3 < qq2.correctIndices.length; ci3++) okSet[qq2.correctIndices[ci3]] = true;
      var firstPick = q(doc2, '.kbb-main .kbb-opt[data-idx="' + qq2.correctIndices[0] + '"]'); if (firstPick) { firstPick.click(); picked++; }
      for (var oi3 = 0; oi3 < qq2.options.length && picked < need; oi3++) {
        if (okSet[oi3]) continue;
        var wOb = q(doc2, '.kbb-main .kbb-opt[data-idx="' + oi3 + '"]'); if (wOb) { wOb.click(); picked++; }
      }
    } else {
      var wi = (qq2.correctIndex + 1) % qq2.options.length;
      var ob = q(doc2, '.kbb-main .kbb-opt[data-idx="' + wi + '"]'); if (!ob) break;
      ob.click();
    }
    var sb2 = q(doc2, '.kbb-submit'); if (sb2 && !sb2.disabled) sb2.click();
    V2.step(12, 24);               // animate the enemy attack each turn
    var cont = q(doc2, '.kbb-main .kbb-cont:not(.kbb-submit)'); if (cont) cont.click(); V2.step(2);
  }
  ok(lost, 'all-wrong battle reaches lost');
  ok(!V2.step._err, 'enemy-attack FX frames do not throw');
  V2.step(10);
  ok(!V2.step._err, 'draw loop runs clean under the lost modal');
  mod2.unmount();
  V2.step(2);
  ok((V.step._err === undefined) && (V2.step._err === undefined), 'ZERO draw-loop exceptions across intro+shop+battle+hero FX+enemy FX+lost+unmount');
})();

H.summary('KBB DRAW');   // (v0.100.0) exits 1 on fails — reds here used to be invisible to the gate
