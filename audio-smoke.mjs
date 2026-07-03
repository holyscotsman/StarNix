/* audio-smoke.mjs — exercises audio.js's synthesis path under a mock AudioContext.
 * jsdom has no AudioContext, so the main verifier can only confirm the API installs.
 * This drives every track (incl. boss + intensity + the P3 tesla voice) and every
 * SFX, catching runtime errors in the voice/scheduler code. No sound is produced. */
import fs from "fs";

// Capture timers so the scheduler can be ticked deterministically (no flaky real timers).
globalThis.setInterval = (fn) => { globalThis.__ints.push(fn); return globalThis.__ints.length; };
globalThis.clearInterval = () => {};
globalThis.setTimeout = () => 0;
globalThis.__ints = [];

function P(v) {
  return {
    value: v || 0,
    setValueAtTime() { return this; }, exponentialRampToValueAtTime() { return this; },
    linearRampToValueAtTime() { return this; }, setTargetAtTime() { return this; },
    cancelScheduledValues() { return this; }
  };
}
function N(extra) {
  const n = {
    connect() { return n; }, disconnect() {}, start() {}, stop() {},
    setPeriodicWave() {}, getByteTimeDomainData() {}, getByteFrequencyData() {},
    type: "", buffer: null, loop: false, curve: null, oversample: "", fftSize: 2048, frequencyBinCount: 1024,
    gain: P(1), frequency: P(440), detune: P(0), Q: P(1),
    threshold: P(0), knee: P(0), ratio: P(1), attack: P(0), release: P(0)
  };
  return Object.assign(n, extra || {});
}
class MockAC {
  constructor() { this.sampleRate = 44100; this.state = "running"; this.destination = N(); this._t = 0; globalThis.__AC = this; }
  get currentTime() { return this._t; }
  resume() {}
  createGain() { return N(); }
  createOscillator() { return N(); }
  createBiquadFilter() { return N(); }
  createWaveShaper() { return N(); }
  createBufferSource() { return N(); }
  createAnalyser() { return N(); }
  createDynamicsCompressor() { return N(); }
  createPeriodicWave() { return {}; }
  createBuffer(ch, len) { return { getChannelData() { return new Float32Array(len); } }; }
}

globalThis.window = globalThis;
globalThis.AudioContext = MockAC;

// load the plain-script module into global scope
const SRC = fs.readFileSync(new URL("./audio.js", import.meta.url), "utf8");
(0, eval)(SRC);
const A = globalThis.StarNix.core.audio;

let fails = 0; const errs = [];
function ok(name, cond) { console.log((cond ? "  \u2713 " : "  \u2717 ") + name); if (!cond) fails++; }

let threw = false; try { A.ensure(); } catch (e) { threw = true; errs.push(e); }
ok("ensure() builds the audio graph without throwing", !threw && A.isReady());

const AC = globalThis.__AC;
function drive(id, intensity) {
  globalThis.__ints.length = 0;
  A.playTrack(id, { intensity: !!intensity, exact: true });   // exact: drive the LITERAL def (playlist resolution tested separately)
  const fn = globalThis.__ints[globalThis.__ints.length - 1];
  if (!fn) return new Error("no scheduler registered for " + id);
  try { for (let k = 0; k < 400; k++) { AC._t += 0.03; fn(); } return null; } catch (e) { return e; }
}

console.log("\nTracks (schedule all 16 steps across all bars):");
for (const id of ["cinematic", "menu", "exam", "arm", "kbb", "cc", "boss"]) {
  const e = drive(id, false); ok('track "' + id + '" schedules clean (bass+arp+tesla+drums)', !e); if (e) errs.push(e);
}
{ drive("cc", false); const e = drive("boss", true); ok("boss + intensity schedules clean (sub + octave arp + double tesla)", !e); if (e) errs.push(e); }
{ drive("cc", false); const e = drive("kbb", true); ok("kbb + intensity schedules clean (arp + techno bass)", !e); if (e) errs.push(e); }
{ drive("menu", false); const e = drive("cc", true); ok("cc + intensity schedules clean (overdriven guitar power chords)", !e); if (e) errs.push(e); }

console.log("\n40-track library (v0.49.0 \u2014 4 contexts x 2 genres x 5; every def schedules clean):");
const LIB = [];
for (const c of ["menu", "arm", "kbb", "cc"]) {
  LIB.push(c);
  for (let n = 2; n <= 5; n++) LIB.push(c + "_up_" + n);
  for (let n = 1; n <= 5; n++) LIB.push(c + "_ch_" + n);
}
{
  let bad = null;
  for (const id of LIB) { const e = drive(id, false); if (e) { bad = id + ": " + e.message; errs.push(e); break; } }
  ok("all 40 playlist defs schedule clean" + (bad ? " (FAILED at " + bad + ")" : ""), !bad);
  ok("library is exactly 40 ids", LIB.length === 40);
}
console.log("\nGenre resolution + rotation (v0.49.0):");
{
  A.setMusicGenre("chill");
  A.playTrack("arm");
  const t1 = A.state().trackId;
  ok('chill: playTrack("arm") resolves into the arm chill list (got ' + t1 + ")", /^arm_ch_[1-5]$/.test(t1));
  A.playTrack("menu"); const m1 = A.state().trackId;
  A.playTrack("arm"); A.playTrack("menu"); const m2 = A.state().trackId;
  ok("rotation: consecutive menu picks differ (" + m1 + " -> " + m2 + ")", /^menu_ch_/.test(m1) && /^menu_ch_/.test(m2) && m1 !== m2);
  A.playTrack("exam");
  ok('fixed ids pass through untouched under chill (exam stays "exam")', A.state().trackId === "exam");
  A.setMusicGenre("upbeat");
  A.playTrack("kbb");
  ok('upbeat: playTrack("kbb") resolves into the kbb upbeat list (got ' + A.state().trackId + ")", /^kbb(_up_[2-5])?$/.test(A.state().trackId));
  ok("getMusicGenre reflects the setting", A.getMusicGenre() === "upbeat");
}

console.log("\n2-minute rotation (v0.70.0, J5):");
{
  A.setMusicGenre("upbeat");
  A.playTrack("arm");
  const r1 = A.state().trackId;
  A.nextTrack();                                   // the 120 s timer's tick, fired by hand
  const r2 = A.state().trackId;
  ok("nextTrack() rotates to a DIFFERENT def in the same playlist (" + r1 + " -> " + r2 + ")",
     /^arm(_up_[2-5])?$/.test(r1) && /^arm(_up_[2-5])?$/.test(r2) && r1 !== r2);
  A.playTrack("boss");
  A.nextTrack();
  ok("fixed beds never rotate (boss stays put)", A.state().trackId === "boss");
  ok("rotation cadence pinned at ~2 min per track", SRC.indexOf("ROTATE_SECS = 120") !== -1);
}

console.log("\nNode churn (v0.45.0 \u2014 persistent voice chains; only one-shot sources per note):");
{
  // Warm a track up so its persistent chains exist, then prove the steady state creates ONLY
  // oscillators / buffer sources \u2014 zero Gain / BiquadFilter / WaveShaper churn. Before v0.45.0
  // every note rebuilt its full chain (7\u201311 nodes/note); that GC pressure hitched game frames.
  function churnRun(id, intensity) {
    globalThis.__ints.length = 0;
    A.playTrack(id, intensity ? { intensity: true } : undefined);
    const fn = globalThis.__ints[globalThis.__ints.length - 1];
    if (!fn) return { err: new Error("no scheduler for " + id) };
    try {
      for (let k = 0; k < 80; k++) { AC._t += 0.03; fn(); }        // warmup: chains built here
      let heavy = 0, src = 0;
      // Capture the RAW current property values (audio.js's own instance wrappers for the
      // gain family — its TTL note-tracking) so we can restore those exact references.
      // A `delete` restore would strip audio.js's wrappers along with ours.
      const rG = AC.createGain, rF = AC.createBiquadFilter, rW = AC.createWaveShaper;
      const rO = AC.createOscillator, rB = AC.createBufferSource;
      AC.createGain = function () { heavy++; return rG.call(AC); };
      AC.createBiquadFilter = function () { heavy++; return rF.call(AC); };
      AC.createWaveShaper = function () { heavy++; return rW.call(AC); };
      AC.createOscillator = function () { src++; return rO.call(AC); };
      AC.createBufferSource = function () { src++; return rB.call(AC); };
      try { for (let k = 0; k < 400; k++) { AC._t += 0.03; fn(); } } finally {
        AC.createGain = rG; AC.createBiquadFilter = rF; AC.createWaveShaper = rW;
        AC.createOscillator = rO; AC.createBufferSource = rB;
      }
      return { heavy, src };
    } catch (e) { return { err: e }; }
  }
  const a = churnRun("arm", false);
  ok("steady-state 'arm' creates ZERO heavy nodes (gain/filter/shaper) across 400 ticks", !a.err && a.heavy === 0);
  ok("\u2026while still scheduling notes (oscillators/buffer sources flow)", !a.err && a.src > 50);
  const b = churnRun("boss", true);
  ok("intensity doublings (same-t chords) also create ZERO heavy nodes", !b.err && b.heavy === 0);
  const c = churnRun("kbb", true);
  ok("wobble-bass track (per-note LFO) also creates ZERO heavy nodes", !c.err && c.heavy === 0);
  if (a.err) errs.push(a.err); if (b.err) errs.push(b.err); if (c.err) errs.push(c.err);
}

console.log("\nScheduler resync (regression — no past-note burst after a stall / backgrounded tab):");
{
  A.setMusic(true);
  const origOsc = AC.createOscillator.bind(AC);
  let oscCount = 0;
  AC.createOscillator = function () { oscCount++; return origOsc(); };
  globalThis.__ints.length = 0;
  A.playTrack("arm");
  const fn = globalThis.__ints[globalThis.__ints.length - 1];
  let regErr = null, jumpCount = -1, steadyCount = -1;
  if (!fn) { regErr = new Error("no scheduler registered for the resync test"); }
  else {
    try {
      for (let k = 0; k < 10; k++) { AC._t += 0.03; fn(); }   // ~0.3s of normal-cadence ticks
      AC._t += 30.0;                                          // timer throttled ~30s (backgrounded): clock jumps, no ticks fired
      oscCount = 0; fn();                                     // ONE tick after the jump
      jumpCount = oscCount;                                   // clamped: ~1 bar of notes — NOT ~900 replayed into the past
      oscCount = 0; AC._t += 0.03; fn();                      // and the very next tick is back to steady state (no backlog left)
      steadyCount = oscCount;
    } catch (e) { regErr = e; }
  }
  delete AC.createOscillator;                                 // restore the prototype method
  ok("one tick after a 30s gap schedules a bounded number of notes (catch-up clamp)", !regErr && jumpCount >= 0 && jumpCount < 64);
  ok("scheduler resyncs cleanly — no leftover backlog on the next tick", !regErr && steadyCount >= 0 && steadyCount < 64);
  if (regErr) errs.push(regErr);
}

console.log("\nNode cleanup (v0.45.0 \u2014 music registers ~no heavy nodes; sfx still TTL-swept):");
{
  A.setMusic(true);
  globalThis.__ints.length = 0;
  A.playTrack("cc");   // different track from the resync test ("arm") so a NEW scheduler is registered
  const fn = globalThis.__ints[globalThis.__ints.length - 1];
  let err = null, peak = 0, finalPending = -1;
  if (!fn) { err = new Error("no scheduler registered for the node-cleanup test"); }
  else {
    try {
      for (let k = 0; k < 8000; k++) {                 // ~4 min of continuous play at ~30 ms ticks
        AC._t += 0.03; fn();
        const p = A._pendingNodes(); if (p > peak) peak = p;
      }
      finalPending = A._pendingNodes();
    } catch (e) { err = e; }
  }
  // Persistent-chain architecture: music notes create only one-shot sources, and chain builds are
  // exempted from the TTL registry \u2014 so ~4 min of pure music leaves the registry essentially empty.
  ok("music play leaves the TTL registry ~empty over ~4 min (chains exempt, notes are one-shots)", !err && peak < 64);
  ok("registry does not grow unbounded with elapsed time", !err && finalPending >= 0 && finalPending < 64);
  if (err) errs.push(err);

  // SFX still build per-call chains \u2014 they must register AND get swept after their TTL.
  let sErr = null, afterSfx = -1, afterSweep = -1;
  try {
    A.setSfx(true);
    A.sfx("correct");
    afterSfx = A._pendingNodes();
    AC._t += 3.0;                                      // past NODE_TTL (2.5 s)
    A.sfx("correct");                                  // sfxImpl sweeps on entry, then registers its own
    afterSweep = A._pendingNodes();
  } catch (e) { sErr = e; }
  ok("an sfx registers its note nodes in the TTL registry", !sErr && afterSfx > 0);
  ok("expired sfx nodes are swept (registry drains back to just the fresh call)", !sErr && afterSweep > 0 && afterSweep <= afterSfx);
  if (sErr) errs.push(sErr);
}

console.log("\nLead melody (catchiness pass):");
{
  // Count oscillators created over one full schedule of a track at a given lead state.
  // The authored lead adds vLead notes (osc + vibrato osc), so ON must exceed OFF on a
  // track that defines a melody, and a track without one must be identical either way.
  function oscOver(id, lead) {
    A.setLead(lead);
    A.playTrack(id === "cc" ? "menu" : "cc", { exact: true });   // switch away first (same-id playTrack is a no-op); exact -> deterministic def
    let count = 0;
    const orig = AC.createOscillator;
    AC.createOscillator = function () { count++; return N(); };
    globalThis.__ints.length = 0;
    A.playTrack(id, { exact: true });
    const fn = globalThis.__ints[globalThis.__ints.length - 1];
    try { for (let k = 0; k < 400; k++) { AC._t += 0.03; fn(); } } finally { AC.createOscillator = orig; }
    return count;
  }
  let me = null, onC = 0, offC = 0, onArm = 0, offArm = 0, onK = 0, offK = 0, onMenu = 0, offMenu = 0;
  try {
    onC = oscOver("cinematic", true); offC = oscOver("cinematic", false);   // the only track that keeps a lead
    onArm = oscOver("arm", true); offArm = oscOver("arm", false);
    onK = oscOver("kbb", true); offK = oscOver("kbb", false);
    onMenu = oscOver("menu", true); offMenu = oscOver("menu", false);       // lead removed -> toggle is a no-op
    A.setLead(true);                            // restore default
  } catch (e) { me = e; }
  ok("cinematic defines an authored lead: more oscillators with lead ON than OFF", !me && onC > offC);
  ok("setLead(false) silences only the lead (bass/arp/drums remain)", !me && offC > 0);
  ok("arm (no melody) is unaffected by the lead toggle — opt-in", !me && onArm === offArm && onArm > 0);
  ok("kbb has no lead (arp/techno bed) — lead toggle has no effect", !me && onK === offK && onK > 0);
  ok("menu has no lead (removed) — lead toggle has no effect", !me && onMenu === offMenu && onMenu > 0);
  if (me) errs.push(me);
}

console.log("\nSFX:");
for (const s of ["fire", "laser", "collect", "correct", "wrong", "click", "hit", "explode", "hyperdrive", "warp", "solve", "count1", "count2", "count3", "totally-unknown"]) {
  let e = null; try { A.sfx(s); } catch (ex) { e = ex; } ok('sfx "' + s + '" plays clean', !e); if (e) errs.push(e);
}

console.log("\nMix controls:");
let te = null; try { A.setMusic(false); A.setMusic(true); A.setSfx(false); A.setSfx(true); A.setMasterVolume(0.8); A.setMasterVolume(1.1); } catch (ex) { te = ex; }
ok("setMusic / setSfx / setMasterVolume clean", !te); if (te) errs.push(te);
ok("state() reports an active track", !!A.state().trackId);

if (errs.length) console.log("\nERRORS:\n" + errs.map((e) => (e && e.stack) || String(e)).join("\n\n"));
console.log("\n" + (fails ? ("AUDIO SMOKE: " + fails + " FAIL") : "AUDIO SMOKE: ALL GREEN"));
process.exit(fails ? 1 : 0);
