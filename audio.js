/* StarNix — core/audio (audio.js)
 * Installs window.StarNix.core.audio implementing the Audio API from 01 §7.
 * All sound is generated in-browser via Web Audio (no audio files) — required
 * for the single-file Apps Script build. Timbre family ported from ARM:
 * 16-bit re-skin (P0): detuned-saw Reese bass -> soft-clip waveshaper -> resonant
 * low-pass + sine sub; detuned super-saw arp with a snappy resonant filter sweep
 * (Tron); punchy techno kick + click transient, 3-burst clap, bright tight hat;
 * gritty Tesla-coil lead accent. Dark-techno / metal feel. See 08_AUDIO.md.
 *
 * Public API (01 §7):   ensure() setMusic(on) setSfx(on) sfx(name) playTrack(id, opts?)
 * Convenience (non-contract): isReady() state()
 */
(function (global) {
  "use strict";

  // ----------------------------------------------------------------- constants
  var MUSIC_LEVEL = 0.54;  // master music ceiling (per-track mix scales under it) — P3: +bass headroom
  var XFADE = 0.9;         // crossfade seconds
  var SMOOTH = 0.12;       // music on/off smoothing seconds
  var LOOKAHEAD = 0.12;    // scheduler horizon seconds
  var TICK_MS = 25;        // scheduler timer
  var STEPS = 16;          // steps per bar (16th grid)
  var BASS_DETUNE = [-14, 14];    // Reese saw pair (cents) — fat detuned bass (P0)
  var LEAD_DETUNE = [-12, 12];    // super-saw lead pair (cents) — Tron arpeggio (P0)
  var INTENSITY_DETUNE = -9;      // cents for the boss octave-up arp

  // ----------------------------------------------------------- note name -> Hz
  var SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  var NOTE_RE = /^([A-G])([#b]?)(\d)$/;
  function noteHz(name) {
    var x = NOTE_RE.exec(name);
    if (!x) throw new Error("bad note " + name);
    var acc = x[2] === "#" ? 1 : x[2] === "b" ? -1 : 0;
    var s = SEMI[x[1]] + acc + ((+x[3]) + 1) * 12;
    return 440 * Math.pow(2, (s - 69) / 12);
  }
  function maskFromSteps(steps) {
    var m = new Uint8Array(STEPS);
    for (var i = 0; i < steps.length; i++) m[steps[i]] = 1;
    return m;
  }

  // -------------------------------------------------------------- track config
  // Authored note names + patterns (08 §2). Converted to Hz / masks once below.
  var CFG = {
    cinematic: {
      bpm: 92, level: 0.42, arpWave: "thin",
      bars: [
        { bass: "A1", arp: ["A3", "C4", "E4", "C4"] },
        { bass: "F1", arp: ["F3", "A3", "C4", "A3"] },
        { bass: "D1", arp: ["D3", "F3", "A3", "F3"] },
        { bass: "E1", arp: ["E3", "G#3", "B3", "G#3"] }
      ],
      // sparse early, fuller late -> swell within the loop (per-bar arp masks)
      arpStepsByBar: [[0, 8], [0, 8], [0, 4, 8, 12], [0, 4, 8, 12]],
      teslaSteps: [0], kick: [0], hat: [], snare: [],
      mel: [
        ["A4","","","","","","C5","","E5","","","","","","D5",""],
        ["C5","","","","","","A4","","F4","","","","","","",""],
        ["D5","","","","F5","","","","A5","","","","F5","","D5",""],
        ["E5","","","","G#5","","","","B5","","","","E5","","",""]
      ]
    },
    menu: {
      bpm: 124, level: 0.46, arpWave: "thin",
      bars: [
        { bass: "C2", arp: ["C4", "E4", "G4", "E4"] },
        { bass: "G1", arp: ["G3", "B3", "D4", "B3"] },
        { bass: "A1", arp: ["A3", "C4", "E4", "C4"] },
        { bass: "F1", arp: ["F3", "A3", "C4", "A3"] }
      ],
      arpSteps: [0, 4, 8, 12], teslaSteps: [0, 10], kick: [0, 8], hat: [6, 14], snare: []
      // no lead melody — removed (the intro cinematic keeps its hook); menu is bed-only
    },
    exam: {
      // chill study bed for the NIT practice exam — slow, soft, no percussion, no lead (concentration over energy)
      bpm: 84, level: 0.34, arpWave: "thin",
      bars: [
        { bass: "A1", arp: ["A3", "C4", "E4", "C4"] },
        { bass: "F1", arp: ["F3", "A3", "C4", "A3"] },
        { bass: "C2", arp: ["C4", "E4", "G4", "E4"] },
        { bass: "G1", arp: ["G3", "B3", "D4", "B3"] }
      ],
      arpSteps: [0, 4, 8, 12], teslaSteps: [0], kick: [], hat: [], snare: []
    },
    arm: {
      bpm: 140, level: 0.50, arpWave: "thin",
      bars: [
        { bass: "A1", arp: ["A3", "C4", "E4", "A4"] },
        { bass: "F1", arp: ["F3", "A3", "C4", "F4"] },
        { bass: "C2", arp: ["C3", "E3", "G3", "C4"] },
        { bass: "G1", arp: ["G2", "B2", "D3", "G3"] }
      ],
      arpSteps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      teslaSteps: [0, 8], kick: [0, 4, 8, 12], hat: [2, 6, 10, 14], snare: []
    },
    kbb: {
      bpm: 160, level: 0.50, arpWave: "square",
      bars: [
        { bass: "D1", arp: ["D3", "F3", "A3", "D4"] },
        { bass: "Bb1", arp: ["Bb3", "D4", "F4", "D4"] },
        { bass: "F1", arp: ["F3", "A3", "C4", "F4"] },
        { bass: "A1", arp: ["A3", "C#4", "E4", "A4"] }
      ],
      arpSteps: [0, 2, 4, 6, 8, 10, 12, 14], teslaSteps: [0, 6, 12], kick: [0, 8], hat: [0, 2, 4, 6, 8, 10, 12, 14], snare: [4, 12]
      // arp + driving techno bass + rock backbeat; no guitar (only CC keeps the guitar bed), no lead
    },
    cc: {
      bpm: 172, level: 0.50, arpWave: "thin",
      bars: [
        { bass: "E1", arp: ["E4", "G#4", "B4", "E5"] },
        { bass: "B1", arp: ["B3", "D#4", "F#4", "B4"] },
        { bass: "C#2", arp: ["C#4", "E4", "G#4", "C#5"] },
        { bass: "A1", arp: ["A3", "C#4", "E4", "A4"] }
      ],
      arpSteps: [0, 2, 4, 6, 8, 10, 12, 14],
      teslaSteps: [0, 8], kick: [0, 8], hat: [0, 2, 4, 6, 8, 10, 12, 14], snare: [4, 12],
      // arp carries the melody up top; overdriven-guitar power chords sit UNDER it as a backing bed (no lead); rock backbeat
      guitar: { steps: [0, 4, 8, 12], hold: 3.6, bassSteps: [0, 8] }
    },
    // 6th track (P3): heavy minor boss loop. Designed to play with {intensity:true}
    // for a future KBB boss; nothing auto-plays it (shell drives the other five).
    boss: {
      // (v0.76.0, Jason: "too piercing — deeper") the solo dropped a full octave (D4 ceiling,
      // was A5), the arp swapped square -> triangle (dark hollow tone, no harsh harmonics),
      // and the tesla stabs halved. Menace now lives in the low mids, not the treble.
      bpm: 150, level: 0.52, arpWave: "triangle", leadGuitar: true,
      bars: [
        { bass: "D1", arp: ["D3", "F3", "A3", "D4"] },
        { bass: "D1", arp: ["D3", "F3", "Bb3", "D4"] },
        { bass: "C1", arp: ["C3", "Eb3", "G3", "C4"] },
        { bass: "A1", arp: ["A3", "C4", "E4", "A4"] }
      ],
      mel: [
        ["D4","","","","A3","","D4","","F4","","","","E4","","D4",""],
        ["F4","","","","D4","","Bb3","","D4","","","","G4","","F4",""],
        ["Eb4","","","","C4","","G3","","Eb4","","","","D4","","Eb4",""],
        ["A4","","","","G4","","E4","","C4","","E4","","A3","","",""]
      ],
      arpSteps: [0, 2, 4, 6, 8, 10, 12, 14], teslaSteps: [0, 8], kick: [0, 4, 8, 12], hat: [2, 6, 10, 14], snare: [4, 12]
    },
    // ================= (Jason v0.49.0) 40-track library: 4 contexts x 2 genres x 5 =================
    // Upbeat slot 1 per context = the original menu/arm/kbb/cc defs above (unchanged ids).
    // Chill rules: slower bpm, softer level, NO snare, sparse/no percussion, no guitar.
    // ---- ARM upbeat 2-5 (flight: driving arps, minor keys) ----
    arm_up_2: {
      bpm: 148, level: 0.50, arpWave: "thin",
      bars: [
        { bass: "E1", arp: ["E3", "G3", "B3", "E4"] },
        { bass: "C2", arp: ["C3", "E3", "G3", "C4"] },
        { bass: "G1", arp: ["G3", "B3", "D4", "G4"] },
        { bass: "D2", arp: ["D3", "F#3", "A3", "D4"] }
      ],
      arpSteps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      teslaSteps: [0, 8], kick: [0, 4, 8, 12], hat: [2, 6, 10, 14], snare: [4, 12]
    },
    arm_up_3: {
      bpm: 144, level: 0.50, arpWave: "square",
      bars: [
        { bass: "D1", arp: ["D3", "F3", "A3", "D4"] },
        { bass: "Bb1", arp: ["Bb2", "D3", "F3", "Bb3"] },
        { bass: "F1", arp: ["F3", "A3", "C4", "F4"] },
        { bass: "C2", arp: ["C3", "E3", "G3", "C4"] }
      ],
      arpSteps: [0, 2, 4, 6, 8, 10, 12, 14], teslaSteps: [0, 6, 12], kick: [0, 8], hat: [0, 4, 8, 12], snare: [4, 12]
    },
    arm_up_4: {
      bpm: 152, level: 0.50, arpWave: "thin",
      bars: [
        { bass: "B1", arp: ["B3", "D4", "F#4", "B4"] },
        { bass: "G1", arp: ["G3", "B3", "D4", "G4"] },
        { bass: "D2", arp: ["D3", "F#3", "A3", "D4"] },
        { bass: "A1", arp: ["A3", "C#4", "E4", "A4"] }
      ],
      arpSteps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      teslaSteps: [0, 8], kick: [0, 4, 8, 12], hat: [2, 6, 10, 14], snare: [8]
    },
    arm_up_5: {
      bpm: 138, level: 0.48, arpWave: "square",
      bars: [
        { bass: "C1", arp: ["C3", "Eb3", "G3", "C4"] },
        { bass: "Ab1", arp: ["Ab2", "C3", "Eb3", "Ab3"] },
        { bass: "Eb1", arp: ["Eb3", "G3", "Bb3", "Eb4"] },
        { bass: "Bb1", arp: ["Bb2", "D3", "F3", "Bb3"] }
      ],
      arpSteps: [0, 2, 4, 6, 8, 10, 12, 14], teslaSteps: [0, 10], kick: [0, 6, 8, 14], hat: [2, 6, 10, 14], snare: [4, 12]
    },
    // ---- ARM chill 1-5 (drift: slow beds, airy arps) ----
    arm_ch_1: {
      bpm: 92, level: 0.38, arpWave: "thin",
      bars: [
        { bass: "A1", arp: ["A3", "C4", "E4", "C4"] },
        { bass: "F1", arp: ["F3", "A3", "C4", "A3"] },
        { bass: "C2", arp: ["C4", "E4", "G4", "E4"] },
        { bass: "G1", arp: ["G3", "B3", "D4", "B3"] }
      ],
      arpSteps: [0, 4, 8, 12], teslaSteps: [0, 8], kick: [], hat: [8], snare: []
    },
    arm_ch_2: {
      bpm: 88, level: 0.36, arpWave: "thin",
      bars: [
        { bass: "E1", arp: ["E3", "G3", "B3", "G3"] },
        { bass: "C2", arp: ["C4", "E4", "G4", "E4"] },
        { bass: "A1", arp: ["A3", "C4", "E4", "C4"] },
        { bass: "D2", arp: ["D4", "F#4", "A4", "F#4"] }
      ],
      arpSteps: [0, 4, 8, 12], teslaSteps: [0], kick: [], hat: [], snare: []
    },
    arm_ch_3: {
      bpm: 96, level: 0.38, arpWave: "thin",
      bars: [
        { bass: "D1", arp: ["D4", "F4", "A4", "F4"] },
        { bass: "F1", arp: ["F3", "A3", "C4", "A3"] },
        { bass: "Bb1", arp: ["Bb3", "D4", "F4", "D4"] },
        { bass: "C2", arp: ["C4", "E4", "G4", "E4"] }
      ],
      arpSteps: [0, 2, 8, 10], teslaSteps: [0, 8], kick: [0], hat: [8], snare: []
    },
    arm_ch_4: {
      bpm: 90, level: 0.36, arpWave: "thin",
      bars: [
        { bass: "G1", arp: ["G3", "Bb3", "D4", "Bb3"] },
        { bass: "Eb1", arp: ["Eb3", "G3", "Bb3", "G3"] },
        { bass: "Bb1", arp: ["Bb3", "D4", "F4", "D4"] },
        { bass: "F1", arp: ["F3", "A3", "C4", "A3"] }
      ],
      arpSteps: [0, 4, 8, 12], teslaSteps: [4, 12], kick: [], hat: [], snare: []
    },
    arm_ch_5: {
      bpm: 100, level: 0.40, arpWave: "thin",
      bars: [
        { bass: "A1", arp: ["A3", "C4", "E4", "C4"] },
        { bass: "G1", arp: ["G3", "B3", "D4", "B3"] },
        { bass: "F1", arp: ["F3", "A3", "C4", "A3"] },
        { bass: "E1", arp: ["E3", "G#3", "B3", "G#3"] }
      ],
      arpSteps: [0, 2, 4, 8, 10, 12], teslaSteps: [0, 8], kick: [0, 8], hat: [4, 12], snare: []
    },
    // ---- KBB upbeat 2-5 (battle: square techno, backbeat) ----
    kbb_up_2: {
      bpm: 156, level: 0.50, arpWave: "square",
      bars: [
        { bass: "A1", arp: ["A3", "C4", "E4", "A4"] },
        { bass: "F1", arp: ["F3", "A3", "C4", "F4"] },
        { bass: "G1", arp: ["G3", "B3", "D4", "G4"] },
        { bass: "E1", arp: ["E3", "G#3", "B3", "E4"] }
      ],
      arpSteps: [0, 2, 4, 6, 8, 10, 12, 14], teslaSteps: [0, 6, 12], kick: [0, 4, 8, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], snare: [4, 12]
    },
    kbb_up_3: {
      bpm: 164, level: 0.50, arpWave: "square",
      bars: [
        { bass: "G1", arp: ["G3", "Bb3", "D4", "G4"] },
        { bass: "Bb1", arp: ["Bb3", "D4", "F4", "Bb4"] },
        { bass: "Eb2", arp: ["Eb3", "G3", "Bb3", "Eb4"] },
        { bass: "F1", arp: ["F3", "A3", "C4", "F4"] }
      ],
      arpSteps: [0, 2, 4, 6, 8, 10, 12, 14], teslaSteps: [0, 8], kick: [0, 8], hat: [2, 6, 10, 14], snare: [4, 12]
    },
    kbb_up_4: {
      bpm: 158, level: 0.50, arpWave: "square",
      bars: [
        { bass: "E1", arp: ["E3", "G3", "B3", "E4"] },
        { bass: "G1", arp: ["G3", "B3", "D4", "G4"] },
        { bass: "A1", arp: ["A3", "C4", "E4", "A4"] },
        { bass: "C2", arp: ["C3", "E3", "G3", "C4"] }
      ],
      arpSteps: [0, 1, 2, 4, 6, 8, 9, 10, 12, 14], teslaSteps: [0, 4, 8, 12], kick: [0, 4, 8, 12], hat: [2, 6, 10, 14], snare: [4, 12]
    },
    kbb_up_5: {
      bpm: 168, level: 0.52, arpWave: "square",
      bars: [
        { bass: "C1", arp: ["C3", "Eb3", "G3", "C4"] },
        { bass: "F1", arp: ["F3", "Ab3", "C4", "F4"] },
        { bass: "Ab1", arp: ["Ab2", "C3", "Eb3", "Ab3"] },
        { bass: "G1", arp: ["G3", "B3", "D4", "G4"] }
      ],
      arpSteps: [0, 2, 4, 6, 8, 10, 12, 14], teslaSteps: [0, 6, 12], kick: [0, 4, 8, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], snare: [4, 12]
    },
    // ---- KBB chill 1-5 (belt drift: halftime, no snare) ----
    kbb_ch_1: {
      bpm: 96, level: 0.38, arpWave: "thin",
      bars: [
        { bass: "D1", arp: ["D3", "F3", "A3", "F3"] },
        { bass: "Bb1", arp: ["Bb3", "D4", "F4", "D4"] },
        { bass: "F1", arp: ["F3", "A3", "C4", "A3"] },
        { bass: "C2", arp: ["C4", "E4", "G4", "E4"] }
      ],
      arpSteps: [0, 4, 8, 12], teslaSteps: [0, 8], kick: [0], hat: [8], snare: []
    },
    kbb_ch_2: {
      bpm: 92, level: 0.36, arpWave: "thin",
      bars: [
        { bass: "A1", arp: ["A3", "C4", "E4", "C4"] },
        { bass: "G1", arp: ["G3", "B3", "D4", "B3"] },
        { bass: "F1", arp: ["F3", "A3", "C4", "A3"] },
        { bass: "E1", arp: ["E3", "G3", "B3", "G3"] }
      ],
      arpSteps: [0, 4, 8, 12], teslaSteps: [0], kick: [], hat: [], snare: []
    },
    kbb_ch_3: {
      bpm: 100, level: 0.38, arpWave: "square",
      bars: [
        { bass: "G1", arp: ["G3", "Bb3", "D4", "Bb3"] },
        { bass: "Eb1", arp: ["Eb3", "G3", "Bb3", "G3"] },
        { bass: "F1", arp: ["F3", "Ab3", "C4", "Ab3"] },
        { bass: "D1", arp: ["D3", "F3", "A3", "F3"] }
      ],
      arpSteps: [0, 2, 8, 10], teslaSteps: [0, 8], kick: [0, 8], hat: [4, 12], snare: []
    },
    kbb_ch_4: {
      bpm: 104, level: 0.38, arpWave: "thin",
      bars: [
        { bass: "E1", arp: ["E3", "G3", "B3", "G3"] },
        { bass: "C2", arp: ["C4", "E4", "G4", "E4"] },
        { bass: "D2", arp: ["D4", "F#4", "A4", "F#4"] },
        { bass: "B1", arp: ["B3", "D4", "F#4", "D4"] }
      ],
      arpSteps: [0, 4, 8, 12], teslaSteps: [4, 12], kick: [0], hat: [8], snare: []
    },
    kbb_ch_5: {
      bpm: 94, level: 0.36, arpWave: "thin",
      bars: [
        { bass: "B1", arp: ["B3", "D4", "F#4", "D4"] },
        { bass: "G1", arp: ["G3", "B3", "D4", "B3"] },
        { bass: "A1", arp: ["A3", "C#4", "E4", "C#4"] },
        { bass: "F#1", arp: ["F#3", "A3", "C#4", "A3"] }
      ],
      arpSteps: [0, 4, 8, 12], teslaSteps: [0, 8], kick: [], hat: [], snare: []
    },
    // ---- CC upbeat 2-5 (runner: fast arps, guitar beds on 2/3/5) ----
    cc_up_2: {
      bpm: 176, level: 0.50, arpWave: "thin",
      bars: [
        { bass: "F#1", arp: ["F#4", "A4", "C#5", "F#5"] },
        { bass: "D2", arp: ["D4", "F#4", "A4", "D5"] },
        { bass: "A1", arp: ["A3", "C#4", "E4", "A4"] },
        { bass: "E2", arp: ["E4", "G#4", "B4", "E5"] }
      ],
      arpSteps: [0, 2, 4, 6, 8, 10, 12, 14], teslaSteps: [0, 8], kick: [0, 8], hat: [0, 2, 4, 6, 8, 10, 12, 14], snare: [4, 12],
      guitar: { steps: [0, 8], hold: 7.2, bassSteps: [0, 8] }
    },
    cc_up_3: {
      bpm: 168, level: 0.50, arpWave: "thin",
      bars: [
        { bass: "B1", arp: ["B3", "D4", "F#4", "B4"] },
        { bass: "G1", arp: ["G3", "B3", "D4", "G4"] },
        { bass: "D2", arp: ["D4", "F#4", "A4", "D5"] },
        { bass: "A1", arp: ["A3", "C#4", "E4", "A4"] }
      ],
      arpSteps: [0, 2, 4, 6, 8, 10, 12, 14], teslaSteps: [0, 6, 12], kick: [0, 8], hat: [2, 6, 10, 14], snare: [4, 12],
      guitar: { steps: [0, 4, 8, 12], hold: 3.6, bassSteps: [0, 8] }
    },
    cc_up_4: {
      bpm: 180, level: 0.50, arpWave: "square",
      bars: [
        { bass: "A1", arp: ["A3", "C4", "E4", "A4"] },
        { bass: "F1", arp: ["F3", "A3", "C4", "F4"] },
        { bass: "C2", arp: ["C4", "E4", "G4", "C5"] },
        { bass: "G1", arp: ["G3", "B3", "D4", "G4"] }
      ],
      arpSteps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      teslaSteps: [0, 8], kick: [0, 4, 8, 12], hat: [2, 6, 10, 14], snare: [4, 12]
    },
    cc_up_5: {
      bpm: 170, level: 0.50, arpWave: "thin",
      bars: [
        { bass: "D1", arp: ["D4", "F4", "A4", "D5"] },
        { bass: "Bb1", arp: ["Bb3", "D4", "F4", "Bb4"] },
        { bass: "C2", arp: ["C4", "E4", "G4", "C5"] },
        { bass: "A1", arp: ["A3", "C#4", "E4", "A4"] }
      ],
      arpSteps: [0, 2, 4, 6, 8, 10, 12, 14], teslaSteps: [0, 8], kick: [0, 8], hat: [0, 4, 8, 12], snare: [4, 12],
      guitar: { steps: [0, 8], hold: 7.2, bassSteps: [0, 8] }
    },
    // ---- CC chill 1-5 (glide: rolling arps, NO guitar, no snare) ----
    cc_ch_1: {
      bpm: 104, level: 0.40, arpWave: "thin",
      bars: [
        { bass: "E1", arp: ["E4", "G#4", "B4", "G#4"] },
        { bass: "C#2", arp: ["C#4", "E4", "G#4", "E4"] },
        { bass: "A1", arp: ["A3", "C#4", "E4", "C#4"] },
        { bass: "B1", arp: ["B3", "D#4", "F#4", "D#4"] }
      ],
      arpSteps: [0, 2, 4, 8, 10, 12], teslaSteps: [0, 8], kick: [0, 8], hat: [4, 12], snare: []
    },
    cc_ch_2: {
      bpm: 108, level: 0.40, arpWave: "thin",
      bars: [
        { bass: "A1", arp: ["A3", "C#4", "E4", "C#4"] },
        { bass: "E1", arp: ["E4", "G#4", "B4", "G#4"] },
        { bass: "F#1", arp: ["F#3", "A3", "C#4", "A3"] },
        { bass: "D2", arp: ["D4", "F#4", "A4", "F#4"] }
      ],
      arpSteps: [0, 2, 4, 8, 10, 12], teslaSteps: [0], kick: [0, 8], hat: [8], snare: []
    },
    cc_ch_3: {
      bpm: 100, level: 0.38, arpWave: "thin",
      bars: [
        { bass: "D1", arp: ["D4", "F4", "A4", "F4"] },
        { bass: "Bb1", arp: ["Bb3", "D4", "F4", "D4"] },
        { bass: "F1", arp: ["F3", "A3", "C4", "A3"] },
        { bass: "C2", arp: ["C4", "E4", "G4", "E4"] }
      ],
      arpSteps: [0, 4, 8, 12], teslaSteps: [0, 8], kick: [0], hat: [8], snare: []
    },
    cc_ch_4: {
      bpm: 112, level: 0.40, arpWave: "thin",
      bars: [
        { bass: "G1", arp: ["G3", "B3", "D4", "B3"] },
        { bass: "D2", arp: ["D4", "F#4", "A4", "F#4"] },
        { bass: "E1", arp: ["E3", "G3", "B3", "G3"] },
        { bass: "C2", arp: ["C4", "E4", "G4", "E4"] }
      ],
      arpSteps: [0, 2, 4, 8, 10, 12], teslaSteps: [4, 12], kick: [0, 8], hat: [4, 12], snare: []
    },
    cc_ch_5: {
      bpm: 106, level: 0.38, arpWave: "thin",
      bars: [
        { bass: "B1", arp: ["B3", "D4", "F#4", "D4"] },
        { bass: "A1", arp: ["A3", "C#4", "E4", "C#4"] },
        { bass: "G1", arp: ["G3", "B3", "D4", "B3"] },
        { bass: "F#1", arp: ["F#3", "A#3", "C#4", "A#3"] }
      ],
      arpSteps: [0, 4, 8, 12], teslaSteps: [0, 8], kick: [0], hat: [], snare: []
    },
    // ---- MENU upbeat 2-5 (bright beds, light percussion) ----
    menu_up_2: {
      bpm: 120, level: 0.46, arpWave: "thin",
      bars: [
        { bass: "G1", arp: ["G3", "B3", "D4", "B3"] },
        { bass: "E1", arp: ["E3", "G3", "B3", "G3"] },
        { bass: "C2", arp: ["C4", "E4", "G4", "E4"] },
        { bass: "D2", arp: ["D4", "F#4", "A4", "F#4"] }
      ],
      arpSteps: [0, 4, 8, 12], teslaSteps: [0, 10], kick: [0, 8], hat: [4, 12], snare: []
    },
    menu_up_3: {
      bpm: 128, level: 0.46, arpWave: "thin",
      bars: [
        { bass: "F1", arp: ["F3", "A3", "C4", "A3"] },
        { bass: "D1", arp: ["D3", "F3", "A3", "F3"] },
        { bass: "Bb1", arp: ["Bb3", "D4", "F4", "D4"] },
        { bass: "C2", arp: ["C4", "E4", "G4", "E4"] }
      ],
      arpSteps: [0, 2, 4, 8, 10, 12], teslaSteps: [0, 8], kick: [0, 8], hat: [2, 6, 10, 14], snare: []
    },
    menu_up_4: {
      bpm: 118, level: 0.44, arpWave: "square",
      bars: [
        { bass: "A1", arp: ["A3", "C4", "E4", "C4"] },
        { bass: "C2", arp: ["C4", "E4", "G4", "E4"] },
        { bass: "G1", arp: ["G3", "B3", "D4", "B3"] },
        { bass: "F1", arp: ["F3", "A3", "C4", "A3"] }
      ],
      arpSteps: [0, 4, 8, 12], teslaSteps: [0, 8], kick: [0, 8], hat: [4, 12], snare: []
    },
    menu_up_5: {
      bpm: 126, level: 0.46, arpWave: "thin",
      bars: [
        { bass: "D2", arp: ["D4", "F#4", "A4", "F#4"] },
        { bass: "B1", arp: ["B3", "D4", "F#4", "D4"] },
        { bass: "G1", arp: ["G3", "B3", "D4", "B3"] },
        { bass: "A1", arp: ["A3", "C#4", "E4", "C#4"] }
      ],
      arpSteps: [0, 2, 8, 10], teslaSteps: [0, 6, 12], kick: [0, 8], hat: [4, 12], snare: []
    },
    // ---- MENU chill 1-5 (lounge: percussion-free or hat-only, seventh-color arps) ----
    menu_ch_1: {
      bpm: 80, level: 0.34, arpWave: "thin",
      bars: [
        { bass: "C2", arp: ["C4", "E4", "G4", "B4"] },
        { bass: "A1", arp: ["A3", "C4", "E4", "G4"] },
        { bass: "F1", arp: ["F3", "A3", "C4", "E4"] },
        { bass: "G1", arp: ["G3", "B3", "D4", "F4"] }
      ],
      arpSteps: [0, 4, 8, 12], teslaSteps: [0], kick: [], hat: [], snare: []
    },
    menu_ch_2: {
      bpm: 78, level: 0.34, arpWave: "thin",
      bars: [
        { bass: "F1", arp: ["F3", "A3", "C4", "E4"] },
        { bass: "Bb1", arp: ["Bb3", "D4", "F4", "A4"] },
        { bass: "G1", arp: ["G3", "Bb3", "D4", "F4"] },
        { bass: "C2", arp: ["C4", "E4", "G4", "Bb4"] }
      ],
      arpSteps: [0, 4, 8, 12], teslaSteps: [0, 8], kick: [], hat: [], snare: []
    },
    menu_ch_3: {
      bpm: 84, level: 0.34, arpWave: "thin",
      bars: [
        { bass: "G1", arp: ["G3", "B3", "D4", "F#4"] },
        { bass: "C2", arp: ["C4", "E4", "G4", "B4"] },
        { bass: "E1", arp: ["E3", "G3", "B3", "D4"] },
        { bass: "D2", arp: ["D4", "F#4", "A4", "C5"] }
      ],
      arpSteps: [0, 4, 8, 12], teslaSteps: [0], kick: [], hat: [8], snare: []
    },
    menu_ch_4: {
      bpm: 76, level: 0.32, arpWave: "thin",
      bars: [
        { bass: "A1", arp: ["A3", "C4", "E4", "G4"] },
        { bass: "D1", arp: ["D3", "F3", "A3", "C4"] },
        { bass: "F1", arp: ["F3", "A3", "C4", "E4"] },
        { bass: "E1", arp: ["E3", "G3", "B3", "D4"] }
      ],
      arpSteps: [0, 8], teslaSteps: [0], kick: [], hat: [], snare: []
    },
    menu_ch_5: {
      bpm: 88, level: 0.36, arpWave: "thin",
      bars: [
        { bass: "D2", arp: ["D4", "F#4", "A4", "C#5"] },
        { bass: "G1", arp: ["G3", "B3", "D4", "F#4"] },
        { bass: "B1", arp: ["B3", "D4", "F#4", "A4"] },
        { bass: "A1", arp: ["A3", "C#4", "E4", "G4"] }
      ],
      arpSteps: [0, 4, 8, 12], teslaSteps: [0, 8], kick: [], hat: [8], snare: []
    },
  };

  // Pre-compute Hz tables + step masks once (no parsing/alloc in the hot path).
  var TRACKS = {};
  (function buildTracks() {
    for (var id in CFG) {
      if (!CFG.hasOwnProperty(id)) continue;
      var c = CFG[id], bars = [];
      for (var b = 0; b < c.bars.length; b++) {
        var bar = c.bars[b];
        var arpHz = new Float32Array(4);
        for (var k = 0; k < 4; k++) arpHz[k] = noteHz(bar.arp[k]);
        var arpMask = c.arpStepsByBar
          ? maskFromSteps(c.arpStepsByBar[b])
          : maskFromSteps(c.arpSteps);
        // authored lead melody -> per-bar Float32Array(STEPS) of Hz (0 = rest). Absent -> null (no lead).
        var melHz = null;
        if (c.mel && c.mel[b]) {
          melHz = new Float32Array(STEPS);
          for (var ms = 0; ms < STEPS; ms++) { var nm = c.mel[b][ms]; melHz[ms] = nm ? noteHz(nm) : 0; }
        }
        bars.push({ bassHz: noteHz(bar.bass), arpHz: arpHz, arpMask: arpMask, melHz: melHz });
      }
      var step16v = 60 / c.bpm / 4;
      TRACKS[id] = {
        id: id, bpm: c.bpm, level: c.level, arpWave: c.arpWave,
        bars: bars,
        kickMask: maskFromSteps(c.kick),
        hatMask: maskFromSteps(c.hat),
        snareMask: maskFromSteps(c.snare),
        teslaMask: maskFromSteps(c.teslaSteps || []),
        step16: step16v,
        dark: c.dark || 1,                                            // <1 = darker arp/lead (dubstep)
        wobMask: c.wob ? maskFromSteps(c.wob.steps) : null,           // null = no wobble bass (use techno bass)
        wobHold: c.wob ? c.wob.hold * step16v : 0,                    // sustained note length (s)
        wobHz: c.wob ? (c.bpm / 60) * c.wob.cyclesPerBeat : 0,        // tempo-synced LFO rate (Hz)
        leadGuitar: !!c.leadGuitar,
        guitarMask: c.guitar ? maskFromSteps(c.guitar.steps) : null,
        guitarHold: c.guitar ? c.guitar.hold * step16v : 0,
        guitarBassMask: c.guitar ? maskFromSteps(c.guitar.bassSteps) : null
      };
    }
  })();

  // --------------------------------------------------------------------- state
  var AC = null, master = null, musicBus = null, sfxBus = null, analyser = null;
  var noiseBuf = null, pulseSquare = null, pulseThin = null, SHAPER = null, GTR_SHAPER = null;

  // --- per-note node cleanup --------------------------------------------------
  // Every voice connects gain/filter/shaper nodes to the bus; oscillators stop and are GC'd,
  // but those gain-family nodes stay connected forever and pile up, eventually starving the
  // audio thread (music "slows then glitches" the longer you play; a reload = fresh context =
  // the apparent fix). We register any gain-family node created WHILE building a note/sfx and
  // disconnect it once its tail is long over. Persistent nodes (buses/track gain) are created
  // with the flag off and never registered. Sweep is in-place (no per-tick allocation).
  var nodeReg = [], trackNotes = false, NODE_TTL = 2.5;
  function sweepNodes(now) {
    var reg = nodeReg, w = 0, i, node;
    for (i = 0; i < reg.length; i++) {
      node = reg[i];
      if (node._killAt <= now) { try { node.disconnect(); } catch (e) { /* already gone */ } }
      else reg[w++] = node;
    }
    reg.length = w;
  }
  var ready = false, musicOn = true, sfxOn = true, musicVol = 1, sfxVol = 1;
  var leadOn = true;           // authored lead-melody layer (diagnostic A/B toggle; on by default)
  var current = null;          // active TrackPlayer
  var outgoing = [];           // players fading out
  var pending = null;          // { id, intensity } requested before ensure()

  // ------------------------------------------------------------ engine builders
  function makePulse(duty) {
    var n = 20, real = new Float32Array(n), imag = new Float32Array(n);
    for (var i = 1; i < n; i++) imag[i] = (2 / (i * Math.PI)) * Math.sin(Math.PI * i * duty);
    return AC.createPeriodicWave(real, imag);
  }
  function buildShaper() {
    var n = 1024, c = new Float32Array(n);
    for (var i = 0; i < n; i++) { var x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(x * 3.2); } // P0: more grit
    SHAPER = c;
  }
  // Harder curve for the overdriven-guitar voice — more crunch/saturation than SHAPER.
  function buildGtrShaper() {
    var n = 1024, c = new Float32Array(n);
    for (var i = 0; i < n; i++) { var x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(x * 5.5); } // hard overdrive crunch
    GTR_SHAPER = c;
  }
  function buildNoise() {
    // deterministic white noise (xorshift32) — avoids Math.random in core (05 lint)
    var len = (AC.sampleRate * 0.5) | 0;
    noiseBuf = AC.createBuffer(1, len, AC.sampleRate);
    var d = noiseBuf.getChannelData(0), s = 0x9e3779b9 >>> 0;
    for (var i = 0; i < len; i++) {
      s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
      d[i] = (s / 4294967295) * 2 - 1;
    }
  }

  // ----------------------------------------------------------------- music voices
  // out = the active TrackPlayer's gain node.
  //
  // (v0.45.0 node-churn fix) Every WaveShaper / BiquadFilter / Gain a voice needs is now
  // built ONCE per (voice, track output) and reused for the life of the track; per NOTE we
  // create only OscillatorNodes and BufferSourceNodes, which are one-shots by Web Audio
  // spec and cannot be reused. Before this, every note built its full chain (7–11 nodes);
  // now a note costs 1–6 one-shot sources and zero heavy nodes — the GC pressure that was
  // hitching game frames is gone. Envelopes and filter sweeps run as sequential automation
  // on the persistent nodes (the lookahead scheduler emits notes in ascending time), and
  // each pitched voice keeps a small ROUND-ROBIN POOL of chains so intensity doublings
  // (two notes at the same t) and release tails never share an envelope. LFO/vibrato
  // oscillators stay per-note so their phase still locks to note-on, exactly as before.
  var chainCache = (typeof WeakMap === "function") ? new WeakMap() : null;
  function chainsFor(out, key, k, build) {
    if (!chainCache) { return build(); }                       // degenerate fallback: old per-note behavior
    var m = chainCache.get(out);
    if (!m) { m = {}; chainCache.set(out, m); }
    var slot = m[key];
    if (!slot) {
      // Persistent chains must NOT enter the TTL cleanup registry (ensure() wraps the
      // gain-family factories to auto-disconnect note nodes after their tail — that sweep
      // would sever these chains 2.5 s in and silence the track). Suspend tracking to build.
      var prevTrack = trackNotes; trackNotes = false;
      try {
        slot = m[key] = { i: 0, arr: [] };
        for (var n = 0; n < k; n++) slot.arr.push(build());
      } finally { trackNotes = prevTrack; }
    }
    slot.i = (slot.i + 1) % slot.arr.length;
    return slot.arr[slot.i];
  }

  // Reese-style detuned-saw bass -> soft-clip -> resonant low-pass + clean sine sub.
  function vBass(out, freq, t, dur, peak) {
    var c = chainsFor(out, "bass", 3, function () {
      var ws = AC.createWaveShaper(); ws.curve = SHAPER; ws.oversample = "2x";
      var f = AC.createBiquadFilter(); f.type = "lowpass"; f.Q.value = 8;
      var g = AC.createGain(); g.gain.value = 0.0001;
      var sg = AC.createGain(); sg.gain.value = 0.0001;
      ws.connect(f); f.connect(g); g.connect(out); sg.connect(out);
      return { ws: ws, f: f, g: g, sg: sg };
    });
    c.f.frequency.setValueAtTime(1900, t); c.f.frequency.exponentialRampToValueAtTime(260, t + dur * 0.85);
    c.g.gain.setValueAtTime(0.0001, t); c.g.gain.exponentialRampToValueAtTime(peak, t + 0.005);
    c.g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    for (var i = 0; i < BASS_DETUNE.length; i++) {
      var o = AC.createOscillator(); o.type = "sawtooth";
      o.frequency.setValueAtTime(freq, t); o.detune.setValueAtTime(BASS_DETUNE[i], t);
      o.connect(c.ws); o.start(t); o.stop(t + dur + 0.03);
    }
    // clean sine sub one octave down for weight (bypasses the bright shaper/filter)
    var sub = AC.createOscillator(); sub.type = "sine"; sub.frequency.setValueAtTime(freq * 0.5, t);
    c.sg.gain.setValueAtTime(0.0001, t); c.sg.gain.exponentialRampToValueAtTime(peak * 0.6, t + 0.012);
    c.sg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    sub.connect(c.sg); sub.start(t); sub.stop(t + dur + 0.03);
  }
  // Dubstep wobble bass: detuned saws -> soft-clip -> resonant low-pass whose cutoff is swept by a
  // per-note LFO (phase locks to note-on, as before).
  function vWobBass(out, freq, t, dur, peak, wobHz) {
    var c = chainsFor(out, "wob", 3, function () {
      var f = AC.createBiquadFilter(); f.type = "lowpass"; f.Q.value = 11;   // resonant -> vowel-y wob
      var lg = AC.createGain(); lg.gain.value = 640;                          // sweep depth (Hz)
      lg.connect(f.frequency);                                                // cutoff = base +/- depth at wobHz
      var ws = AC.createWaveShaper(); ws.curve = SHAPER; ws.oversample = "2x";
      var g = AC.createGain(); g.gain.value = 0.0001;
      var sg = AC.createGain(); sg.gain.value = 0.0001;
      ws.connect(f); f.connect(g); g.connect(out); sg.connect(out);
      return { f: f, lg: lg, ws: ws, g: g, sg: sg };
    });
    c.f.frequency.setValueAtTime(420, t);                                     // dark base cutoff
    var lfo = AC.createOscillator(); lfo.type = "sine"; lfo.frequency.setValueAtTime(wobHz, t);
    lfo.connect(c.lg);
    c.g.gain.setValueAtTime(0.0001, t); c.g.gain.exponentialRampToValueAtTime(peak, t + 0.010);
    c.g.gain.setValueAtTime(peak, t + dur * 0.9);
    c.g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    for (var i = 0; i < BASS_DETUNE.length; i++) {
      var o = AC.createOscillator(); o.type = "sawtooth";
      o.frequency.setValueAtTime(freq, t); o.detune.setValueAtTime(BASS_DETUNE[i], t);
      o.connect(c.ws); o.start(t); o.stop(t + dur + 0.03);
    }
    lfo.start(t); lfo.stop(t + dur + 0.03);
    // clean sine sub one octave down for weight
    var sub = AC.createOscillator(); sub.type = "sine"; sub.frequency.setValueAtTime(freq * 0.5, t);
    c.sg.gain.setValueAtTime(0.0001, t); c.sg.gain.exponentialRampToValueAtTime(peak * 0.95, t + 0.012);
    c.sg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    sub.connect(c.sg); sub.start(t); sub.stop(t + dur + 0.03);
  }
  // Overdriven electric-guitar power chord: root + fifth + octave, each a slightly detuned saw pair,
  // summed into a pre-gain -> hard soft-clip (overdrive) -> high-pass (tighten) + low-pass "cab"
  // roll-off, so it crunches like an amped guitar rather than a fizzy synth. Played low by design.
  function vGuitar(out, freq, t, dur, peak) {
    var c = chainsFor(out, "gtr", 2, function () {
      var pre = AC.createGain(); pre.gain.value = 1.7;                                     // drive into the shaper
      var ws = AC.createWaveShaper(); ws.curve = GTR_SHAPER; ws.oversample = "4x";
      var hp = AC.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 85;     // tighten low mud
      var lp = AC.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 3000; lp.Q.value = 0.8; // cab roll-off
      var g = AC.createGain(); g.gain.value = 0.0001;
      pre.connect(ws); ws.connect(hp); hp.connect(lp); lp.connect(g); g.connect(out);
      return { pre: pre, g: g };
    });
    c.g.gain.setValueAtTime(0.0001, t); c.g.gain.exponentialRampToValueAtTime(peak, t + 0.006);
    c.g.gain.setValueAtTime(peak, t + dur * 0.7);
    c.g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    var ratios = [1, 1.498307, 2];                                                       // root, perfect fifth, octave
    for (var ci = 0; ci < ratios.length; ci++) {
      var f0 = freq * ratios[ci];
      for (var d2 = 0; d2 < 2; d2++) {
        var o = AC.createOscillator(); o.type = "sawtooth";
        o.frequency.setValueAtTime(f0, t); o.detune.setValueAtTime(d2 === 0 ? -7 : 7, t);
        o.connect(c.pre); o.start(t); o.stop(t + dur + 0.03);
      }
    }
  }
  // Single-note overdriven LEAD — the "guitar solo" voice. One chorused saw pair into the guitar
  // shaper, with sustain + vibrato (per-note, phase-locked), so it sings like a soloing lead.
  function vGuitarLead(out, freq, t, dur, peak) {
    var c = chainsFor(out, "gtrLead", 2, function () {
      var pre = AC.createGain(); pre.gain.value = 2.0;                                    // drive into the shaper
      var ws = AC.createWaveShaper(); ws.curve = GTR_SHAPER; ws.oversample = "4x";
      var hp = AC.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 130;
      var lp = AC.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 3400; lp.Q.value = 1.1; // cab roll-off
      var g = AC.createGain(); g.gain.value = 0.0001;
      var vg = AC.createGain(); vg.gain.value = 9;                                        // vibrato depth (cents)
      pre.connect(ws); ws.connect(hp); hp.connect(lp); lp.connect(g); g.connect(out);
      return { pre: pre, g: g, vg: vg };
    });
    c.g.gain.setValueAtTime(0.0001, t); c.g.gain.exponentialRampToValueAtTime(peak, t + 0.02); // pick attack
    c.g.gain.setValueAtTime(peak, t + dur * 0.62); c.g.gain.exponentialRampToValueAtTime(0.0001, t + dur); // sustain + release
    var vib = AC.createOscillator(); vib.type = "sine"; vib.frequency.setValueAtTime(5.5, t);
    vib.connect(c.vg);
    for (var d2 = 0; d2 < 2; d2++) {
      var o = AC.createOscillator(); o.type = "sawtooth"; o.frequency.setValueAtTime(freq, t); o.detune.setValueAtTime(d2 === 0 ? -6 : 6, t);
      c.vg.connect(o.detune); o.connect(c.pre); o.start(t); o.stop(t + dur + 0.03);
    }
    vib.start(t); vib.stop(t + dur + 0.03);
  }
  // Detuned super-saw arp with a snappy resonant filter sweep (Tron-style).
  // `wave` is retained for signature compatibility but the lead is always saws now.
  function vArp(out, wave, freq, t, dur, peak, det, bright) {
    bright = bright || 1;   // <1 darkens (lower cutoff) for dubstep tracks
    var c = chainsFor(out, "arp", 3, function () {
      var f = AC.createBiquadFilter(); f.type = "lowpass"; f.Q.value = 7;
      var g = AC.createGain(); g.gain.value = 0.0001;
      f.connect(g); g.connect(out);
      return { f: f, g: g };
    });
    c.f.frequency.setValueAtTime(4200 * bright, t); c.f.frequency.exponentialRampToValueAtTime(900 * bright, t + dur * 0.8);
    c.g.gain.setValueAtTime(0.0001, t); c.g.gain.exponentialRampToValueAtTime(peak * 0.65, t + 0.006); // 2 saws -> trim
    c.g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    for (var i = 0; i < LEAD_DETUNE.length; i++) {
      var o = AC.createOscillator(); o.type = "sawtooth";
      o.frequency.setValueAtTime(freq, t); o.detune.setValueAtTime(LEAD_DETUNE[i] + (det || 0), t);
      o.connect(c.f); o.start(t); o.stop(t + dur + 0.03);
    }
  }
  // Bright pulse lead for the authored melody hook — the "song" that sits on top of the
  // arp. 50%-pulse + gentle low-pass + subtle vibrato gives a singing, catchy voice that
  // is distinct from the buzzy saw arp. (Catchiness pass: adds a real melody line.)
  function vLead(out, freq, t, dur, peak, bright) {
    bright = bright || 1;   // <1 darkens further (dubstep tracks)
    var c = chainsFor(out, "lead", 2, function () {
      var f = AC.createBiquadFilter(); f.type = "lowpass"; f.Q.value = 2;
      var g = AC.createGain(); g.gain.value = 0.0001;
      var vg = AC.createGain(); vg.gain.value = 6;                  // vibrato depth (cents)
      var sg = AC.createGain(); sg.gain.value = 0.0001;
      f.connect(g); g.connect(out); sg.connect(out);
      return { f: f, g: g, vg: vg, sg: sg };
    });
    var o = AC.createOscillator(); o.setPeriodicWave(pulseSquare); o.frequency.setValueAtTime(freq, t);
    var vib = AC.createOscillator(); vib.type = "sine"; vib.frequency.setValueAtTime(5.0, t);
    vib.connect(c.vg); c.vg.connect(o.detune);
    // darker: lower low-pass so the pulse reads muted/round, not bright & reedy
    c.f.frequency.setValueAtTime(3200 * bright, t); c.f.frequency.exponentialRampToValueAtTime(1250 * bright, t + dur * 0.9);
    c.g.gain.setValueAtTime(0.0001, t);
    c.g.gain.exponentialRampToValueAtTime(peak, t + 0.016);         // soft attack
    c.g.gain.setValueAtTime(peak, t + dur * 0.55);                  // sustain (legato singing)
    c.g.gain.exponentialRampToValueAtTime(0.0001, t + dur);        // release
    o.connect(c.f);
    o.start(t); o.stop(t + dur + 0.03);
    vib.start(t); vib.stop(t + dur + 0.03);
    // deeper: clean sine one octave down adds body/weight under the lead (bypasses the filter)
    var sub = AC.createOscillator(); sub.type = "sine"; sub.frequency.setValueAtTime(freq * 0.5, t);
    c.sg.gain.setValueAtTime(0.0001, t); c.sg.gain.exponentialRampToValueAtTime(peak * 0.55, t + 0.016);
    c.sg.gain.setValueAtTime(peak * 0.55, t + dur * 0.55);
    c.sg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    sub.connect(c.sg); sub.start(t); sub.stop(t + dur + 0.03);
  }
  function vKick(out, t) {
    var c = chainsFor(out, "kick", 1, function () {
      var g = AC.createGain(); g.gain.value = 0.0001;
      var cf = AC.createBiquadFilter(); cf.type = "highpass"; cf.frequency.value = 4000;
      var cg = AC.createGain(); cg.gain.value = 0.0001;
      g.connect(out); cf.connect(cg); cg.connect(out);
      return { g: g, cf: cf, cg: cg };
    });
    var o = AC.createOscillator(); o.type = "triangle";
    o.frequency.setValueAtTime(165, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.10);
    c.g.gain.setValueAtTime(0.0001, t); c.g.gain.exponentialRampToValueAtTime(0.62, t + 0.005);
    c.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(c.g); o.start(t); o.stop(t + 0.2);
    // click transient (techno snap)
    var k = AC.createBufferSource(); k.buffer = noiseBuf;
    c.cg.gain.setValueAtTime(0.25, t); c.cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.012);
    k.connect(c.cf); k.start(t); k.stop(t + 0.02);
  }
  function vHat(out, t, peak) {
    var c = chainsFor(out, "hat", 1, function () {
      var f = AC.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 9000;
      var g = AC.createGain(); g.gain.value = 0.0001;
      f.connect(g); g.connect(out);
      return { f: f, g: g };
    });
    var s = AC.createBufferSource(); s.buffer = noiseBuf;
    c.g.gain.setValueAtTime(peak, t); c.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    s.connect(c.f); s.start(t); s.stop(t + 0.04);
  }
  // clap (3 quick noise bursts through a band-pass) — dark-techno backbeat.
  function vSnare(out, t) {
    var c = chainsFor(out, "snare", 1, function () {
      var bp = AC.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1700; bp.Q.value = 0.8;
      var g = AC.createGain(); g.gain.value = 0.0001;
      bp.connect(g); g.connect(out);
      return { bp: bp, g: g };
    });
    for (var i = 0; i < 3; i++) {
      var s = AC.createBufferSource(); s.buffer = noiseBuf; s.connect(c.bp);
      s.start(t + i * 0.011); s.stop(t + i * 0.011 + 0.03);
    }
    c.g.gain.setValueAtTime(0.0001, t);
    c.g.gain.exponentialRampToValueAtTime(0.34, t + 0.004);
    c.g.gain.exponentialRampToValueAtTime(0.12, t + 0.03);
    c.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
  }
  // P3: electric "Tesla-coil" lead — gritty saw -> soft-clip -> bandpass, with a
  // fast square AM "buzz" and a high-passed noise "zap" on the attack.
  function vTesla(out, freq, t, dur, peak) {
    var c = chainsFor(out, "tesla", 3, function () {
      var ws = AC.createWaveShaper(); ws.curve = SHAPER; ws.oversample = "2x";
      var bp = AC.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 1.4;
      var am = AC.createGain(); am.gain.value = 0.6;                         // AM baseline
      var lg = AC.createGain(); lg.gain.value = 0.4;                         // AM depth
      lg.connect(am.gain);
      var g = AC.createGain(); g.gain.value = 0.0001;
      var nf = AC.createBiquadFilter(); nf.type = "highpass"; nf.frequency.value = 3500;
      var ng = AC.createGain(); ng.gain.value = 0.0001;
      ws.connect(bp); bp.connect(am); am.connect(g); g.connect(out);
      nf.connect(ng); ng.connect(out);
      return { ws: ws, bp: bp, lg: lg, g: g, nf: nf, ng: ng };
    });
    var o = AC.createOscillator(); o.type = "sawtooth"; o.frequency.setValueAtTime(freq, t);
    c.bp.frequency.setValueAtTime(Math.min(freq * 3, 6000), t);
    var lfo = AC.createOscillator(); lfo.type = "square"; lfo.frequency.setValueAtTime(72, t);
    lfo.connect(c.lg);
    c.g.gain.setValueAtTime(0.0001, t); c.g.gain.exponentialRampToValueAtTime(peak, t + 0.006);
    c.g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(c.ws);
    o.start(t); o.stop(t + dur + 0.03); lfo.start(t); lfo.stop(t + dur + 0.03);
    var n = AC.createBufferSource(); n.buffer = noiseBuf;
    c.ng.gain.setValueAtTime(peak * 0.7, t); c.ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    n.connect(c.nf); n.start(t); n.stop(t + 0.06);
  }

  // --------------------------------------------------------------- TrackPlayer
  function TrackPlayer(def, intensity) {
    this.def = def;
    this.id = def.id;
    this.intensity = !!intensity;
    this.gain = AC.createGain();
    this.gain.gain.value = 0;        // ramped up by playTrack
    this.gain.connect(musicBus);
    this.wave = def.arpWave === "square" ? pulseSquare : pulseThin;
    this.step = 0; this.bar = 0;
    this.nextNoteTime = 0;
    this.timer = null;
    this.running = false;
    var self = this;
    this._fn = function () { self._schedule(); };
  }
  TrackPlayer.prototype._playStep = function (step, t) {
    var def = this.def, bar = def.bars[this.bar], d = def.step16, out = this.gain, dark = def.dark || 1;
    // bass: dubstep wobble-bass (sustained, replaces the techno pluck) on tracks with `wob`, else the techno bass
    if (def.guitarMask) {
      // overdriven guitar power chords (low chord roots) + a low root bass; no wobble/pluck, no arp
      if (def.guitarMask[step]) vGuitar(out, bar.bassHz * 2, t, def.guitarHold, 0.05); // backing bed — well under the arp
      if (def.guitarBassMask[step]) vBass(out, bar.bassHz, t, def.step16 * 3.2, 0.34);
    } else if (def.wobMask) {
      if (def.wobMask[step]) {
        vWobBass(out, bar.bassHz, t, def.wobHold, 0.34, def.wobHz);
        if (this.intensity) vWobBass(out, bar.bassHz * 0.5, t, def.wobHold, 0.14, def.wobHz);
      }
    } else if (step % 2 === 0) {
      var up = (step % 4 === 2);
      var root = bar.bassHz;
      vBass(out, up ? root * 2 : root, t, d * 1.8, 0.36);
      if (this.intensity) vBass(out, (up ? root * 2 : root) * 0.5, t, d * 1.8, 0.16); // sub
    }
    // arp (darkened on dubstep tracks via `dark`)
    if (bar.arpMask[step]) {
      var af = bar.arpHz[step % 4];
      vArp(out, this.wave, af, t, d * 0.9, 0.11, 0, dark);
      if (this.intensity) vArp(out, this.wave, af * 2, t, d * 0.9, 0.07, INTENSITY_DETUNE, dark); // octave-up layer
    }
    // authored lead melody (the hook) — only on tracks that define one; A/B via setLead()
    if (leadOn && bar.melHz) {
      var mf = bar.melHz[step];
      if (mf > 0) {
        if (def.leadGuitar) vGuitarLead(out, mf, t, d * 1.6, this.intensity ? 0.17 : 0.14);
        else vLead(out, mf, t, d * 1.9, this.intensity ? 0.22 : 0.18, dark);
      }
    }
    // electric tesla lead accent (P3) — top arp note an octave up
    if (def.teslaMask[step]) {
      var tf = bar.arpHz[3] * 2;
      vTesla(out, tf, t, d * 1.3, this.intensity ? 0.12 : 0.085);
      if (this.intensity) vTesla(out, tf * 1.5, t, d * 1.1, 0.06); // a fifth up under boss intensity
    }
    // drums
    if (def.kickMask[step]) vKick(out, t);
    if (def.snareMask[step]) vSnare(out, t);
    if (def.hatMask[step]) vHat(out, t, 0.10);
    else if (this.intensity && step % 2 === 0) vHat(out, t, 0.06); // intensity drive
  };
  TrackPlayer.prototype._schedule = function () {
    if (!ready || !this.running) return;
    var now = AC.currentTime, d = this.def.step16, nBars = this.def.bars.length;
    // Catch-up clamp. AC.currentTime advances in real time, but the setInterval driving this
    // gets throttled when the tab is backgrounded and delayed by GC / heavy CC frames. If we've
    // fallen behind, replaying every missed 16th at its original (now-past) time would make the
    // browser fire a burst of overlapping immediate notes AND allocate a wall of nodes in one
    // synchronous tick — that is the "music goes slow then sounds weird" failure. Skip the gap
    // instead: fast-forward silently to the present, preserving pattern phase on small drifts.
    if (this.nextNoteTime < now) {
      if (now - this.nextNoteTime > 1.0) {
        this.nextNoteTime = now + 0.02;                       // large gap (backgrounded): snap to the present
      } else {
        while (this.nextNoteTime < now) {                     // small drift: advance without sounding the missed steps
          this.nextNoteTime += d; this.step++;
          if (this.step >= STEPS) { this.step = 0; this.bar = (this.bar + 1) % nBars; }
        }
      }
    }
    var ahead = now + LOOKAHEAD;
    trackNotes = true;
    while (this.nextNoteTime < ahead) {
      this._playStep(this.step, this.nextNoteTime);
      this.nextNoteTime += d;
      this.step++;
      if (this.step >= STEPS) { this.step = 0; this.bar = (this.bar + 1) % nBars; }
    }
    trackNotes = false;
    sweepNodes(now);                                           // disconnect note nodes whose tail has long passed
  };
  TrackPlayer.prototype.start = function (resume) {
    if (!resume) { this.step = 0; this.bar = 0; }
    this.nextNoteTime = AC.currentTime + 0.05;
    if (this.timer) clearInterval(this.timer);
    this.running = true;
    this.timer = setInterval(this._fn, TICK_MS);
  };
  TrackPlayer.prototype.stop = function () {
    this.running = false;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  };
  TrackPlayer.prototype.fade = function (target, secs) {
    var now = AC.currentTime, p = this.gain.gain;
    p.cancelScheduledValues(now);
    p.setValueAtTime(p.value, now);
    p.linearRampToValueAtTime(target, now + secs); // linear so 0 is reachable
  };
  TrackPlayer.prototype.dispose = function () {
    this.stop();
    try { this.gain.disconnect(); } catch (e) { /* already gone */ }
  };

  // ------------------------------------------------------------------- SFX
  function sfxImpl(type) {
    if (!ready || !sfxOn) return;
    trackNotes = true; sweepNodes(AC.currentTime);
    try {
    var t = AC.currentTime;
    var g = AC.createGain(); g.connect(sfxBus);

    if (type === "explode" || type === "hit") {
      var s = AC.createBufferSource(); s.buffer = noiseBuf;
      var f = AC.createBiquadFilter(); f.type = "lowpass";
      f.frequency.value = type === "explode" ? 900 : 1600;
      s.connect(f); f.connect(g);
      var dur = type === "explode" ? 0.34 : 0.09;
      g.gain.setValueAtTime(type === "explode" ? 0.5 : 0.25, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      s.start(t); s.stop(t + dur); return;
    }
    if (type === "lasercharge") {                 // the charge-up half of the hyperdrive spin (no jump / wind-down)
      var lc = 1.25;
      var o1 = AC.createOscillator(); o1.type = "sawtooth";
      o1.frequency.setValueAtTime(80, t); o1.frequency.exponentialRampToValueAtTime(900, t + lc);
      var o1g = AC.createGain(); o1g.gain.setValueAtTime(0.0001, t); o1g.gain.linearRampToValueAtTime(0.15, t + lc * 0.85); o1g.gain.exponentialRampToValueAtTime(0.0001, t + lc);
      o1.connect(o1g); o1g.connect(sfxBus); o1.start(t); o1.stop(t + lc);
      var pq = AC.createOscillator(); pq.type = "square"; pq.frequency.setValueAtTime(150, t); pq.frequency.exponentialRampToValueAtTime(340, t + lc);
      var pg = AC.createGain(); pg.gain.value = 0;
      var plfo = AC.createOscillator(); plfo.type = "sawtooth"; plfo.frequency.setValueAtTime(5, t); plfo.frequency.exponentialRampToValueAtTime(26, t + lc);
      var plg = AC.createGain(); plg.gain.setValueAtTime(0.1, t); plg.gain.linearRampToValueAtTime(0.18, t + lc);
      plfo.connect(plg); plg.connect(pg.gain);
      var plp = AC.createBiquadFilter(); plp.type = "lowpass"; plp.frequency.value = 2400;
      pq.connect(pg); pg.connect(plp); plp.connect(sfxBus);
      pq.start(t); pq.stop(t + lc); plfo.start(t); plfo.stop(t + lc); return;
    }
    if (type === "missile") {   // (v0.121.0, Jason) the dreadnought's MISSILE launch — a rocket, NOT the laser zap:
      var md = 0.5;             // an ignition THUMP + a rising motor WHOOSH + a thin projectile tone screaming away
      var mth = AC.createOscillator(); mth.type = "sine";
      mth.frequency.setValueAtTime(180, t); mth.frequency.exponentialRampToValueAtTime(46, t + 0.16);
      var mtg = AC.createGain(); mtg.gain.setValueAtTime(0.0001, t); mtg.gain.linearRampToValueAtTime(0.42, t + 0.012); mtg.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      mth.connect(mtg); mtg.connect(sfxBus); mth.start(t); mth.stop(t + 0.24);
      var mn = AC.createBufferSource(); mn.buffer = noiseBuf;
      var mbf = AC.createBiquadFilter(); mbf.type = "bandpass"; mbf.Q.value = 1.1;
      mbf.frequency.setValueAtTime(300, t); mbf.frequency.exponentialRampToValueAtTime(2600, t + md);
      var mng = AC.createGain(); mng.gain.setValueAtTime(0.0001, t); mng.gain.linearRampToValueAtTime(0.24, t + 0.05); mng.gain.exponentialRampToValueAtTime(0.0001, t + md);
      mn.connect(mbf); mbf.connect(mng); mng.connect(sfxBus); mn.start(t); mn.stop(t + md);
      var mt2 = AC.createOscillator(); mt2.type = "triangle";
      mt2.frequency.setValueAtTime(420, t); mt2.frequency.exponentialRampToValueAtTime(1100, t + md * 0.9);
      var mt2g = AC.createGain(); mt2g.gain.setValueAtTime(0.0001, t); mt2g.gain.linearRampToValueAtTime(0.09, t + 0.06); mt2g.gain.exponentialRampToValueAtTime(0.0001, t + md);
      mt2.connect(mt2g); mt2g.connect(sfxBus); mt2.start(t); mt2.stop(t + md); return;
    }
    if (type === "laserfire" || type === "laserhit") {   // BZZZT + boom; "laserhit" punches a bigger, deeper boom
      var loud = (type === "laserhit"), bd = 0.42;
      var bz = AC.createOscillator(); bz.type = "square"; bz.frequency.setValueAtTime(190, t); bz.frequency.linearRampToValueAtTime(115, t + bd);
      var bzs = AC.createWaveShaper(); bzs.curve = GTR_SHAPER || SHAPER; bzs.oversample = "2x";
      var bzg = AC.createGain(); bzg.gain.setValueAtTime(loud ? 0.26 : 0.3, t); bzg.gain.exponentialRampToValueAtTime(0.001, t + bd);
      bz.connect(bzs); bzs.connect(bzg); bzg.connect(sfxBus); bz.start(t); bz.stop(t + bd);
      var nz = AC.createBufferSource(); nz.buffer = noiseBuf;
      var nzf = AC.createBiquadFilter(); nzf.type = "bandpass"; nzf.frequency.value = 1700; nzf.Q.value = 0.7;
      var nzg = AC.createGain(); nzg.gain.setValueAtTime(loud ? 0.16 : 0.2, t); nzg.gain.exponentialRampToValueAtTime(0.001, t + bd * 0.7);
      nz.connect(nzf); nzf.connect(nzg); nzg.connect(sfxBus); nz.start(t); nz.stop(t + bd * 0.7);
      var bmDur = loud ? 0.75 : 0.5;
      var bm = AC.createOscillator(); bm.type = "sine"; bm.frequency.setValueAtTime(loud ? 135 : 110, t); bm.frequency.exponentialRampToValueAtTime(loud ? 30 : 44, t + bmDur);
      var bmg = AC.createGain(); bmg.gain.setValueAtTime(0.0001, t); bmg.gain.linearRampToValueAtTime(loud ? 0.52 : 0.32, t + 0.02); bmg.gain.exponentialRampToValueAtTime(0.0001, t + bmDur);
      bm.connect(bmg); bmg.connect(sfxBus); bm.start(t); bm.stop(t + bmDur); return;
    }
    if (type === "hyperdrive" || type === "warp") {
      var dur2 = 2.2;                         // longer — a real charging buildup, then the jump
      var build = dur2 * 0.72;                // spin-up ends here; the "jump" release follows
      // --- 1) rising drive tone: two detuned saws sweep up across the buildup, then shriek into the jump ---
      for (var di = 0; di < 2; di++) {
        var det = di === 0 ? 0 : -12;
        var o = AC.createOscillator(); o.type = "sawtooth"; o.detune.value = det;
        o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(900, t + build);
        o.frequency.exponentialRampToValueAtTime(2000, t + dur2);
        var og = AC.createGain();
        og.gain.setValueAtTime(0.0001, t); og.gain.linearRampToValueAtTime(0.13, t + build);
        og.gain.exponentialRampToValueAtTime(0.0001, t + dur2);
        o.connect(og); og.connect(sfxBus); o.start(t); o.stop(t + dur2);
      }
      // --- 2) accelerating "charging" pulse: a tone gated by a sawtooth LFO whose rate ramps from
      //        slow to fast, so the pulses speed up as the drive spins up (the warp-buildup signature) ---
      var pq = AC.createOscillator(); pq.type = "square";
      pq.frequency.setValueAtTime(140, t); pq.frequency.exponentialRampToValueAtTime(330, t + build);
      var pg = AC.createGain(); pg.gain.value = 0.0;
      var plfo = AC.createOscillator(); plfo.type = "sawtooth";
      plfo.frequency.setValueAtTime(4, t); plfo.frequency.exponentialRampToValueAtTime(22, t + build); // accelerate
      var plg = AC.createGain(); plg.gain.setValueAtTime(0.12, t); plg.gain.linearRampToValueAtTime(0.20, t + build);
      plfo.connect(plg); plg.connect(pg.gain);
      var plp = AC.createBiquadFilter(); plp.type = "lowpass"; plp.frequency.value = 2200;
      pq.connect(pg); pg.connect(plp); plp.connect(sfxBus);
      pq.start(t); pq.stop(t + build); plfo.start(t); plfo.stop(t + build);
      // --- 3) rising band-passed noise whoosh across the buildup into the jump ---
      var ns = AC.createBufferSource(); ns.buffer = noiseBuf; ns.loop = true;
      var nf = AC.createBiquadFilter(); nf.type = "bandpass"; nf.Q.value = 1.6;
      nf.frequency.setValueAtTime(300, t); nf.frequency.exponentialRampToValueAtTime(5000, t + dur2);
      var ng = AC.createGain();
      ng.gain.setValueAtTime(0.0001, t); ng.gain.linearRampToValueAtTime(0.16, t + build);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + dur2);
      ns.connect(nf); nf.connect(ng); ng.connect(sfxBus); ns.start(t); ns.stop(t + dur2);
      // --- 4) heavy bass: rises while charging, then SLAMS deep on the jump and holds ---
      var sub = AC.createOscillator(); sub.type = "sine";
      sub.frequency.setValueAtTime(70, t); sub.frequency.linearRampToValueAtTime(110, t + build);
      sub.frequency.exponentialRampToValueAtTime(28, t + dur2);                         // deep drop at the jump
      var sg = AC.createGain();
      sg.gain.setValueAtTime(0.0001, t); sg.gain.linearRampToValueAtTime(0.30, t + build);
      sg.gain.exponentialRampToValueAtTime(0.46, t + build + 0.06);                     // slam
      sg.gain.setValueAtTime(0.46, t + dur2 * 0.92);
      sg.gain.exponentialRampToValueAtTime(0.0001, t + dur2);
      sub.connect(sg); sg.connect(sfxBus); sub.start(t); sub.stop(t + dur2);
      // saturated, filter-wobbled sub-saw doubles the bass for audible weight on small speakers
      var bs = AC.createOscillator(); bs.type = "sawtooth";
      bs.frequency.setValueAtTime(70, t); bs.frequency.linearRampToValueAtTime(110, t + build);
      bs.frequency.exponentialRampToValueAtTime(28, t + dur2);
      var bws = AC.createWaveShaper(); bws.curve = SHAPER; bws.oversample = "2x";
      var bf = AC.createBiquadFilter(); bf.type = "lowpass"; bf.Q.value = 9; bf.frequency.setValueAtTime(240, t);
      var blfo = AC.createOscillator(); blfo.type = "sine"; blfo.frequency.setValueAtTime(7, t);
      var blg = AC.createGain(); blg.gain.setValueAtTime(170, t); blfo.connect(blg); blg.connect(bf.frequency);
      var bg = AC.createGain();
      bg.gain.setValueAtTime(0.0001, t); bg.gain.linearRampToValueAtTime(0.18, t + build);
      bg.gain.exponentialRampToValueAtTime(0.34, t + build + 0.06);                     // slam
      bg.gain.setValueAtTime(0.34, t + dur2 * 0.92);
      bg.gain.exponentialRampToValueAtTime(0.0001, t + dur2);
      bs.connect(bws); bws.connect(bf); bf.connect(bg); bg.connect(sfxBus);
      bs.start(t); bs.stop(t + dur2); blfo.start(t); blfo.stop(t + dur2);
      // --- (epic) rising chord swell: a detuned power-chord pad that brightens across the buildup and blooms into the jump ---
      var CHRD = [110, 164.81, 220, 329.63];                 // A2 · E3 · A3 · E4 — an open, heroic stack
      var chFilt = AC.createBiquadFilter(); chFilt.type = "lowpass";
      chFilt.frequency.setValueAtTime(200, t); chFilt.frequency.exponentialRampToValueAtTime(4200, t + build);
      chFilt.frequency.exponentialRampToValueAtTime(1200, t + dur2);
      var chGain = AC.createGain();
      chGain.gain.setValueAtTime(0.0001, t); chGain.gain.linearRampToValueAtTime(0.10, t + build);
      chGain.gain.exponentialRampToValueAtTime(0.16, t + build + 0.06);     // bloom at the jump
      chGain.gain.exponentialRampToValueAtTime(0.0001, t + dur2);
      chFilt.connect(chGain); chGain.connect(sfxBus);
      for (var chi = 0; chi < CHRD.length; chi++) {
        var chOsc = AC.createOscillator(); chOsc.type = "sawtooth"; chOsc.detune.value = (chi % 2 ? 7 : -7);
        chOsc.frequency.setValueAtTime(CHRD[chi], t);
        chOsc.connect(chFilt); chOsc.start(t); chOsc.stop(t + dur2);
      }
      // --- (epic) cinematic impact at the jump: a deep boom + a high noise crash that lands the warp (master limiter tames the peak) ---
      var boom = AC.createOscillator(); boom.type = "sine";
      boom.frequency.setValueAtTime(120, t + build); boom.frequency.exponentialRampToValueAtTime(38, t + build + 0.5);
      var boomG = AC.createGain();
      boomG.gain.setValueAtTime(0.0001, t + build); boomG.gain.linearRampToValueAtTime(0.42, t + build + 0.02);
      boomG.gain.exponentialRampToValueAtTime(0.0001, t + build + 0.7);
      boom.connect(boomG); boomG.connect(sfxBus); boom.start(t + build); boom.stop(t + build + 0.7);
      var crash = AC.createBufferSource(); crash.buffer = noiseBuf;
      var crashF = AC.createBiquadFilter(); crashF.type = "highpass"; crashF.frequency.value = 1100;
      var crashG = AC.createGain();
      crashG.gain.setValueAtTime(0.0001, t + build); crashG.gain.linearRampToValueAtTime(0.20, t + build + 0.01);
      crashG.gain.exponentialRampToValueAtTime(0.0001, t + build + 0.45);
      crash.connect(crashF); crashF.connect(crashG); crashG.connect(sfxBus); crash.start(t + build); crash.stop(t + build + 0.45);
      // --- (epic) triumphant shimmer: a bright major triad that stabs at the jump and rings out ---
      var SHMR = [880, 1108.73, 1318.51];                    // A5 · C#6 · E6
      for (var shi = 0; shi < SHMR.length; shi++) {
        var shOsc = AC.createOscillator(); shOsc.type = "triangle";
        shOsc.frequency.setValueAtTime(SHMR[shi], t + build + 0.02);
        var shG = AC.createGain();
        shG.gain.setValueAtTime(0.0001, t + build + 0.02); shG.gain.linearRampToValueAtTime(0.06, t + build + 0.07);
        shG.gain.exponentialRampToValueAtTime(0.0001, t + dur2 + 0.15);
        shOsc.connect(shG); shG.connect(sfxBus); shOsc.start(t + build + 0.02); shOsc.stop(t + dur2 + 0.15);
      }
      // --- 5) descending "jump zap" at the release ---
      var sh = AC.createOscillator(); sh.type = "triangle";
      sh.frequency.setValueAtTime(2400, t + build); sh.frequency.exponentialRampToValueAtTime(420, t + dur2);
      var shg = AC.createGain();
      shg.gain.setValueAtTime(0.0001, t + build); shg.gain.exponentialRampToValueAtTime(0.16, t + build + 0.04);
      shg.gain.exponentialRampToValueAtTime(0.0001, t + dur2);
      sh.connect(shg); shg.connect(sfxBus); sh.start(t + build); sh.stop(t + dur2);
      // --- 6) wind-down: the drive spools down after the jump, settling the warp (a short tail past the jump) ---
      var wt = t + dur2 - 0.05;
      var wo = AC.createOscillator(); wo.type = "sawtooth";
      wo.frequency.setValueAtTime(900, wt); wo.frequency.exponentialRampToValueAtTime(90, wt + 0.6);
      var wg = AC.createGain();
      wg.gain.setValueAtTime(0.0001, wt); wg.gain.linearRampToValueAtTime(0.12, wt + 0.05);
      wg.gain.exponentialRampToValueAtTime(0.0001, wt + 0.62);
      var wlp = AC.createBiquadFilter(); wlp.type = "lowpass";
      wlp.frequency.setValueAtTime(1800, wt); wlp.frequency.exponentialRampToValueAtTime(300, wt + 0.6);
      wo.connect(wg); wg.connect(wlp); wlp.connect(sfxBus); wo.start(wt); wo.stop(wt + 0.62);
      var wns = AC.createBufferSource(); wns.buffer = noiseBuf; wns.loop = true;
      var wnf = AC.createBiquadFilter(); wnf.type = "bandpass"; wnf.Q.value = 1.2;
      wnf.frequency.setValueAtTime(2400, wt); wnf.frequency.exponentialRampToValueAtTime(200, wt + 0.6);
      var wng = AC.createGain();
      wng.gain.setValueAtTime(0.0001, wt); wng.gain.linearRampToValueAtTime(0.10, wt + 0.06); wng.gain.exponentialRampToValueAtTime(0.0001, wt + 0.62);
      wns.connect(wnf); wnf.connect(wng); wng.connect(sfxBus); wns.start(wt); wns.stop(wt + 0.62);
      return;
    }
    if (type === "solve") {
      // "lock engaged" — bright ascending triad + a sparkle ping (distinct from collect/correct)
      var triad = [523.25, 659.25, 783.99];   // C5 E5 G5
      for (var si = 0; si < triad.length; si++) {
        var so = AC.createOscillator(), sg2 = AC.createGain(); so.connect(sg2); sg2.connect(sfxBus);
        so.type = "triangle"; so.frequency.value = triad[si];
        var st0 = t + si * 0.075;
        sg2.gain.setValueAtTime(0.0001, st0); sg2.gain.exponentialRampToValueAtTime(0.17, st0 + 0.02);
        sg2.gain.exponentialRampToValueAtTime(0.0001, st0 + 0.26);
        so.start(st0); so.stop(st0 + 0.28);
      }
      var sp = AC.createOscillator(), spg = AC.createGain(); sp.connect(spg); spg.connect(sfxBus);
      sp.type = "sine"; sp.frequency.setValueAtTime(1567.98, t + 0.22); sp.frequency.exponentialRampToValueAtTime(2093, t + 0.42);
      spg.gain.setValueAtTime(0.0001, t + 0.22); spg.gain.exponentialRampToValueAtTime(0.11, t + 0.25);
      spg.gain.exponentialRampToValueAtTime(0.0001, t + 0.46);
      sp.start(t + 0.22); sp.stop(t + 0.46); return;
    }
    if (type === "count1" || type === "count2" || type === "count3") {
      // hyperdrive spin-up pulse; count3 (lowest) -> count1 (highest) builds toward the jump
      var cf = type === "count3" ? 392 : (type === "count2" ? 523.25 : 659.25);
      var co = AC.createOscillator(), cog = AC.createGain();
      var clp = AC.createBiquadFilter(); clp.type = "lowpass"; clp.frequency.value = cf * 4;
      co.type = "sawtooth";
      co.frequency.setValueAtTime(cf * 0.7, t); co.frequency.exponentialRampToValueAtTime(cf, t + 0.12);  // sweep up = charging
      co.connect(clp); clp.connect(cog); cog.connect(sfxBus);
      cog.gain.setValueAtTime(0.0001, t); cog.gain.exponentialRampToValueAtTime(0.13, t + 0.02);
      cog.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      co.start(t); co.stop(t + 0.24);
      var cs = AC.createOscillator(), csg = AC.createGain(); cs.connect(csg); csg.connect(sfxBus);
      cs.type = "sine"; cs.frequency.value = cf * 0.5;
      csg.gain.setValueAtTime(0.0001, t); csg.gain.exponentialRampToValueAtTime(0.09, t + 0.01); csg.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
      cs.start(t); cs.stop(t + 0.15); return;
    }

    if (type === "laser") {
      // enemy laser bolt — a hard descending "pew", deliberately distinct from 'fire' (player) and 'click' (UI)
      for (var li = 0; li < 2; li++) {
        var lo = AC.createOscillator(); lo.type = "sawtooth"; lo.detune.value = li === 0 ? 0 : 22;
        lo.frequency.setValueAtTime(1500, t); lo.frequency.exponentialRampToValueAtTime(180, t + 0.16);
        var lg = AC.createGain();
        lg.gain.setValueAtTime(0.0001, t); lg.gain.linearRampToValueAtTime(li === 0 ? 0.16 : 0.09, t + 0.008);
        lg.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
        var lf = AC.createBiquadFilter(); lf.type = "lowpass"; lf.frequency.value = 2600;
        lo.connect(lg); lg.connect(lf); lf.connect(sfxBus); lo.start(t); lo.stop(t + 0.18);
      }
      var lns = AC.createBufferSource(); lns.buffer = noiseBuf;
      var lnf = AC.createBiquadFilter(); lnf.type = "bandpass"; lnf.Q.value = 0.9; lnf.frequency.value = 1800;
      var lng = AC.createGain(); lng.gain.setValueAtTime(0.12, t); lng.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      lns.connect(lnf); lnf.connect(lng); lng.connect(sfxBus); lns.start(t); lns.stop(t + 0.05);
      return;
    }

    var osc = AC.createOscillator(); osc.connect(g);
    function set(wave, f0, f1, dur, vol) {
      osc.type = wave; osc.frequency.setValueAtTime(f0, t); osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.start(t); osc.stop(t + dur);
    }
    if (type === "fire") set("square", 680, 360, 0.08, 0.12);
    else if (type === "collect") set("sine", 520, 900, 0.18, 0.2);
    else if (type === "correct") {
      set("sine", 520, 780, 0.16, 0.2);
      var o2 = AC.createOscillator(), g2 = AC.createGain(); o2.connect(g2); g2.connect(sfxBus);
      o2.type = "sine"; o2.frequency.setValueAtTime(780, t + 0.12); o2.frequency.exponentialRampToValueAtTime(1040, t + 0.28);
      g2.gain.setValueAtTime(0.18, t + 0.12); g2.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      o2.start(t + 0.12); o2.stop(t + 0.3);
    }
    else if (type === "wrong") set("sawtooth", 300, 120, 0.3, 0.16);
    else if (type === "click") set("triangle", 440, 440, 0.05, 0.08);
    else set("sine", 440, 440, 0.1, 0.1); // unknown -> soft blip, never fails silently
    } finally { trackNotes = false; }
  }

  // ------------------------------------------------------------------- public
  function ensure() {
    if (ready) {
      if (AC && AC.state === "suspended" && AC.resume) AC.resume();
      return;
    }
    try {
      AC = new (global.AudioContext || global.webkitAudioContext)();
      // Tag gain-family nodes built during a note/sfx so they can be disconnected after their tail.
      ["createGain", "createBiquadFilter", "createWaveShaper"].forEach(function (fn) {
        var orig = AC[fn];
        AC[fn] = function () { var node = orig.apply(AC, arguments); if (trackNotes) { node._killAt = AC.currentTime + NODE_TTL; nodeReg.push(node); } return node; };
      });
      if (AC.state === "suspended" && AC.resume) AC.resume();
      master = AC.createGain(); master.gain.value = 1.0;
      // P3: gentle master limiter — lets us run hotter without hard-clipping thick bass
      var limiter = AC.createDynamicsCompressor();
      limiter.threshold.value = -3; limiter.knee.value = 6; limiter.ratio.value = 12;
      limiter.attack.value = 0.003; limiter.release.value = 0.16;   // P0: slight techno pump
      // passthrough analyser for diagnostics/visualization (transparent, one-time)
      analyser = AC.createAnalyser(); analyser.fftSize = 2048;
      master.connect(limiter); limiter.connect(analyser); analyser.connect(AC.destination);
      musicBus = AC.createGain(); musicBus.gain.value = musicOn ? MUSIC_LEVEL * musicVol : 0; musicBus.connect(master);
      sfxBus = AC.createGain(); sfxBus.gain.value = sfxVol; sfxBus.connect(master);
      buildNoise(); pulseSquare = makePulse(0.5); pulseThin = makePulse(0.26); buildShaper(); buildGtrShaper();
      ready = true;
      if (pending) { var p = pending; pending = null; playTrack(p.id, { intensity: p.intensity }); }
    } catch (e) { ready = false; }
  }

  function setMusic(on) {
    musicOn = !!on;
    if (!ready) return;
    if (musicOn) {
      musicBus.gain.setTargetAtTime(MUSIC_LEVEL * musicVol, AC.currentTime, SMOOTH);
      if (current) {
        if (!current.running) current.start(true);   // resume where it left off
        current.fade(current.def.level, SMOOTH);      // ensure its bus is up (e.g. started while muted)
      }
    } else {
      musicBus.gain.setTargetAtTime(0, AC.currentTime, SMOOTH);
      if (current) current.stop();
      for (var i = 0; i < outgoing.length; i++) outgoing[i].dispose();
      outgoing.length = 0;
    }
  }

  function setSfx(on) { sfxOn = !!on; }

  // additive convenience (non-contract): master trim for the audition harness / settings
  function setMasterVolume(v) {
    v = Math.max(0, Math.min(1.2, +v || 0));
    if (ready && master) master.gain.setTargetAtTime(v, AC.currentTime, 0.03);
  }
  function setMusicVolume(v) {
    musicVol = Math.max(0, Math.min(1, +v || 0));
    if (ready && musicBus && musicOn) musicBus.gain.setTargetAtTime(MUSIC_LEVEL * musicVol, AC.currentTime, 0.03);
  }
  function setSfxVolume(v) {
    sfxVol = Math.max(0, Math.min(1, +v || 0));
    if (ready && sfxBus) sfxBus.gain.setTargetAtTime(sfxVol, AC.currentTime, 0.03);
  }

  function sfx(name) { sfxImpl(name); }

  // (Jason v0.49.0) 40-track system: 4 contexts (menu/arm/kbb/cc) x 2 genres (upbeat/chill) x 5 tracks.
  // The CONTEXT ids stay the public contract — playTrack('arm') resolves to a concrete def through the
  // active genre's playlist, rotating per call so remounts get variety. exam/cinematic/boss stay fixed.
  var GENRE = "upbeat";
  var PLAYLISTS = {
    menu: { upbeat: ["menu", "menu_up_2", "menu_up_3", "menu_up_4", "menu_up_5"], chill: ["menu_ch_1", "menu_ch_2", "menu_ch_3", "menu_ch_4", "menu_ch_5"] },
    arm:  { upbeat: ["arm", "arm_up_2", "arm_up_3", "arm_up_4", "arm_up_5"],     chill: ["arm_ch_1", "arm_ch_2", "arm_ch_3", "arm_ch_4", "arm_ch_5"] },
    kbb:  { upbeat: ["kbb", "kbb_up_2", "kbb_up_3", "kbb_up_4", "kbb_up_5"],     chill: ["kbb_ch_1", "kbb_ch_2", "kbb_ch_3", "kbb_ch_4", "kbb_ch_5"] },
    cc:   { upbeat: ["cc", "cc_up_2", "cc_up_3", "cc_up_4", "cc_up_5"],          chill: ["cc_ch_1", "cc_ch_2", "cc_ch_3", "cc_ch_4", "cc_ch_5"] }
  };
  // (v0.70.0, J5) in-place rotation: ~2 min per track, then a RANDOM different track from the
  // same context+genre playlist (Jason: "cycle randomly once the song ends"). Deterministic
  // xorshift picker (no Math.random); fixed beds (exam/cinematic/boss) never rotate.
  var ROTATE_SECS = 120;
  var rotateTimer = null, currentContext = null, lastPick = {};
  var rotSeed = 0xC0FFEE >>> 0;
  function rotRand() { rotSeed ^= rotSeed << 13; rotSeed >>>= 0; rotSeed ^= rotSeed >>> 17; rotSeed ^= rotSeed << 5; rotSeed >>>= 0; return rotSeed / 4294967296; }
  function armRotation() {
    if (rotateTimer) { clearTimeout(rotateTimer); rotateTimer = null; }
    if (!currentContext) return;
    rotateTimer = setTimeout(nextTrack, ROTATE_SECS * 1000);
    if (rotateTimer && rotateTimer.unref) rotateTimer.unref();   // node harnesses: never hold the process open
  }
  function nextTrack() {                    // also the future "skip track" seam
    if (!currentContext) return;
    playTrack(currentContext, current && current.intensity ? { intensity: true } : undefined);
  }
  function setMusicGenre(g) { GENRE = (g === "chill") ? "chill" : "upbeat"; }
  function getMusicGenre() { return GENRE; }
  function resolveTrack(id) {
    // (v0.68.0, J3 defense) tolerate caller-case drift: context ids are lowercase by contract,
    // but a stray "ARM" must resolve, not silently vanish at the TRACKS lookup downstream.
    var pl = PLAYLISTS[id];
    if (!pl && PLAYLISTS[String(id).toLowerCase()]) { id = String(id).toLowerCase(); pl = PLAYLISTS[id]; }
    if (!pl) { currentContext = null; return id; }   // fixed ids (exam/cinematic/boss): no rotation
    currentContext = id;
    var list = pl[GENRE] || pl.upbeat, key = id + ":" + GENRE;
    var pick = list[(rotRand() * list.length) | 0], tries = 0;      // (J5) random-not-same beats the old sequential cursor
    while (list.length > 1 && pick === lastPick[key] && tries++ < 8) pick = list[(rotRand() * list.length) | 0];
    lastPick[key] = pick;
    return TRACKS[pick] ? pick : id;                                // def missing -> fall back to the context def
  }
  function playTrack(id, opts) {
    var intensity = !!(opts && opts.intensity);
    if (!(opts && opts.exact)) { id = resolveTrack(id); armRotation(); }   // opts.exact: bypass playlist resolution (tests/boss)
    var def = TRACKS[id];
    if (!def) return; // unknown track id: ignore (contract is the known context ids)
    if (!ready) { pending = { id: id, intensity: intensity }; return; }
    if (current && current.id === id) {
      current.intensity = intensity; // same track: toggle the boss layer live, no crossfade
      if (!current.running && musicOn) current.start(true);
      return;
    }
    var next = new TrackPlayer(def, intensity);
    if (musicOn) {
      next.start(false);
      next.fade(def.level, XFADE);
    }
    if (current) {
      var old = current;
      old.fade(0, XFADE);
      outgoing.push(old);
      // stop & free the outgoing player after the crossfade completes
      setTimeout(function () {
        old.dispose();
        var idx = outgoing.indexOf(old);
        if (idx >= 0) outgoing.splice(idx, 1);
      }, XFADE * 1000 + 60);
    }
    current = next;
  }

  function isReady() { return ready; }
  function state() {
    return {
      ready: ready, musicOn: musicOn, sfxOn: sfxOn,
      trackId: current ? current.id : null,
      intensity: current ? current.intensity : false
    };
  }

  // ------------------------------------------------------------------- install
  global.StarNix = global.StarNix || {};
  global.StarNix.core = global.StarNix.core || {};
  global.StarNix.core.audio = {
    ensure: ensure,
    setMusic: setMusic,
    setSfx: setSfx,
    setMasterVolume: setMasterVolume,
    setMusicVolume: setMusicVolume,
    setSfxVolume: setSfxVolume,
    sfx: sfx,
    playTrack: playTrack,
    setMusicGenre: setMusicGenre,   // (v0.49.0) 'upbeat' | 'chill' — the pause-menu toggle
    getMusicGenre: getMusicGenre,
    nextTrack: nextTrack,           // (v0.70.0, J5) rotate now — the 2-min timer's tick, exposed as a seam
    isReady: isReady,
    trackIds: function () { return Object.keys(TRACKS); },  // (v0.79.0, JB1) full library listing for the Jukebox
    state: state,
    analyser: function () { return analyser; }, // read-only diagnostics tap (null before ensure)
    context: function () { return AC; },          // read-only AudioContext handle
    setLead: function (on) { leadOn = !!on; },    // diagnostic: A/B the authored lead-melody layer
    _pendingNodes: function () { return nodeReg.length; }  // diagnostics: per-note nodes awaiting cleanup
  };
})(typeof window !== "undefined" ? window : this);
