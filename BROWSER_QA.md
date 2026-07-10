# StarNix — Browser QA pass (v0.42.0 → v0.49.0 blind surface)

> **Version under test:** v0.49.0 (title bar / `BUILD_VERSION`). **Why this doc:** everything below shipped
> green through the headless gate, which proves structure and logic — not looks, feel, or sound. This is the
> ordered checklist for a laptop session. For each item: what to do, what CORRECT looks like, and the knob
> (file + constant) to report a number against if it's wrong. Report failures as `QA-<id>: <what you saw>`.

## How to run
Open `index.html` (or the GAS deployment). Do the passes in order — Shell first (it gates everything),
then per-game. Sound on. Do one pass with **Reduced motion** ON at the end (Settings) — listed last.

---

## 1. Shell + Audio (v0.45, v0.49)

- **QA-S1 — Opening cinematic planet.** Watch the cold-open cinematic to the "planet" beat (~12 s, don't skip).
  CORRECT: a real photographic planet rises (circular, aqua rim stroke), squadron descends to it. WRONG: a flat
  dark square or plain disc. (This one was never broken headlessly — confirm it so we can close the report.)
- **QA-S2 — Menu music variety.** Land on the menu, then re-enter the menu 3–4 times (enter/exit a game).
  CORRECT: the menu bed is not the same track every time (5-track rotation). Knob: `audio.js PLAYLISTS.menu`.
- **QA-S3 — Pause-menu music style toggle.** Start ARM → Pause. CORRECT: an **Audio → Music style** row with
  `Upbeat` / `Chill`, current one highlighted. Click **Chill** → resume. CORRECT: the game bed swaps to a slower,
  softer, snare-free track within ~1 s of resume. Re-pause: Chill still highlighted. Reload the page: Chill
  persisted (menu plays a chill bed). Switch back to Upbeat and confirm the reverse.
- **QA-S4 — The 36 new tracks (ears pass).** In each game, Pause → toggle style → resume, several times per game,
  and idle the menu. You're sampling `menu/arm/kbb/cc × upbeat/chill × 5`. For each track that's WRONG (grating,
  out-of-key clash, drums overpowering, too loud/quiet vs its siblings), report `QA-S4: <game> <genre> <what you
  heard>` — I can identify the slot from the description and rewrite it. Baseline: upbeat = the old beds' energy;
  chill = no snare, no guitar, 76–112 BPM. Knob: per-def `level` (0.32–0.52) and the def itself in `audio.js`.
- **QA-S5 — Audio churn (frame feel).** Play CC for 2+ minutes with music on. CORRECT: no periodic hitching
  (the v0.45 rewrite removed per-note node churn). WRONG: rhythmic stutter aligned to the music.
- **QA-S6 — Music self-heal.** Let a game run 5+ min, Pause → Resume. CORRECT: music restarts cleanly in sync.

## 2. Exam module (v0.42)

- **QA-E1 — Study mode (new default).** Practice exam → Study. CORRECT: untimed; selecting an option does NOT
  commit; a **Confirm** button commits; after EVERY answer the authored explanation + per-option notes render;
  **Prev/Next** browse already-graded questions with your marks intact.
- **QA-E2 — Exam sim.** CORRECT: ONE whole-exam clock (96 s × question count), free navigation, changing answers
  allowed, **Flag** (F) marks for review, a review screen lists flagged/unanswered, grading + mastery only at
  **Submit**. Let the clock hit 0 on a short run: it auto-submits, no hang.
- **QA-E3 — Blitz unchanged.** The original decay-timer game still plays; multi-answer shows a live "n selected".
- **QA-E4 — Keyboard.** A–E select, Enter confirm/continue, ←/→ navigate, F flags (sim). All three modes.
- **QA-E5 — Exhibits.** Find an exhibit question (image icon) in each mode. CORRECT: the image renders and
  enlarges on click in Study, Sim, and Blitz.

## 3. ARM (v0.44 feel + v0.47 planet)

- **QA-A1 — Intro dive-beat planet.** Start a new campaign, watch the intro to the final beat. CORRECT: the
  dive-to-planet beat shows the **real planet image** rising from the bottom (photo texture, circular), BCM dive
  enemies + your ship diving toward it. WRONG: a plain purple-dark gradient disc (that's the fallback).
- **QA-A2 — Parallax starfield.** Fly around. CORRECT: 4 star layers at different speeds, including a FOREGROUND
  layer that streams OVER the ship; speed streaks appear above ~140 spd. Knob: `arm.js drawStarsParallax` depths.
- **QA-A3 — Banking.** Turn hard left/right. CORRECT: the hull banks and the wingspan visibly foreshortens;
  the world counter-rolls slightly. WRONG: flat rotation only. Knob: `shipBank` ease `dt*7`, roll `0.045`.
- **QA-A4 — Camera.** Accelerate/stop. CORRECT: camera leads your velocity (~0.35) with a springy settle, tighter
  and lead-free in the home view. WRONG: rigid center-lock or seasick overshoot. Knob: `camTo` lead/spring consts.

## 4. Chasm Chase (v0.43 feel + v0.47 pass) — the biggest blind surface

- **QA-C1 — Mountains.** Look at the horizon in the establishing shot and while running. CORRECT: two overlapping
  craggy ridge rows per side — sharp near peaks, taller hazed silhouettes behind, reading as a continuous range.
  WRONG: isolated traffic-cones. Knob: `cc.js _buildPeaks` (counts, `h`, `z` bands, crag `amt`).
- **QA-C2 — Gates.** CORRECT: sleek flat-top HEX rings (aqua; gold = power) with a translucent energy film
  shimmering inside, film pulsing faster than the ring glow. WRONG: film invisible (report — likely blending) or
  blindingly bright (knob: film opacity `0.10+0.10*sin` in the pulse block).
- **QA-C3 — Jump wall.** CORRECT: the jump obstacle is a FULL-WIDTH low wall, same rock texture as the duck arch,
  solid at the bottom; **you cannot lane-dodge it** — only jumping clears; it's clearly bigger than the old rock
  (height 1.25). Grazing any lane while grounded = hit.
- **QA-C4 — Duck arch telegraphs.** CORRECT: aqua DOWN-chevrons bob in the arch's gap; gold UP-chevrons bob over
  jump walls; readable at approach speed BEFORE the obstacle is close. Colorblind check: shapes alone distinguish
  them. Knob: chevron y-offsets (`ROCK_H+0.55`, `CEIL_BOTTOM-0.5`), bob `sin(t*4.2)*0.12`.
- **QA-C5 — Duck feel.** Hold duck under an arch. CORRECT: the ship pitches nose-DOWN (dive-under read), mild
  squash, barely sinks. WRONG: deflates into the floor (old behavior). Knob: pitch `0.22*_duckF`, sink `0.10`.
- **QA-C6 — Framing.** CORRECT: the ship sits noticeably HIGHER in frame than before — roughly lower-third, not
  hugging the bottom edge. Too high/low → report where it sits. Knob: `CAM.chaseLook` (y `0.35`, z `-14`).
- **QA-C7 — Feel pass (v0.43).** Lane changes: camera follows laterally + counter-rolls, ship banks with velocity
  (no snap at arrival). Landings: squash + dust puff + small camera dip. Should feel weighty, not floaty.
- **QA-C8 — Fairness at speed.** Play to high speed. Every wall row must be jumpable on reaction with the chevron
  warning; combo rows (wall + narrowing) must be survivable by moving off the sealed lane AND jumping.

## 5. KBB (v0.46 agency + v0.48 cinematic/intuitiveness)

- **QA-K1 — Opening cinematic.** Watch without skipping (~7 s). CORRECT beats: squad WARP-IN (streaks resolve to
  ships) → radar sweep + pulsing peach blip → warship DECLOAKS (scanline shimmer) and fires a warning bolt across
  your bow (near-miss flash, squad jinks) → it flips and burns away with an engine flare under a slow zoom.
  Captions match the beats. Skip works at any point.
- **QA-K2 — Action row.** CORRECT: ⚔ Attack / 🛡 Brace / ✚ Repair above the answers, Attack preselected, hint line
  under it ("Correct fires your action · Wrong = the enemy strikes free"). Brace on a correct answer visibly adds
  shield; Repair heals; wrong answer = nothing happens except the enemy's counter.
- **QA-K3 — Strike telegraph.** When the enemy's counterattack lands, its panel flashes a peach ring. Clears on the
  next question.
- **QA-K4 — FINAL ATTACK.** On the enemy's last turn the statline becomes a pulsing peach "FINAL ATTACK — finish it
  or it escapes". Confirm it appears exactly on the last turn (attack N/N).
- **QA-K5 — Impact shake.** Taking hull damage shakes the combat canvas noticeably; shield-only absorption shakes
  less; no shake on your own hits. WRONG: nauseating or imperceptible. Knob: `s.shakeT` 0.45/0.2, scale `*9`.
- **QA-K6 — Layout.** Combat canvas and question panel read as equal-weight (4fr/4fr); nothing clipped at 820px-wide
  window (mobile breakpoint: combat 250px tall).

## 6. Reduced-motion pass (last)

Settings → Reduced motion ON, then quickly re-touch: KBB cinematic (short 3.2 s, no zoom/shimmer/jink, still
skippable), KBB shake (none), CC chevrons (no bob, still visible), ARM/CC camera effects damped, FINAL-ATTACK
pulse (static color, no animation), pause/genre toggle unaffected.

---

**Reporting format:** `QA-C2: films invisible on Chrome/Win — rings fine` beats "gates look wrong". Screenshots
help for C1/C2/C6. For audio, game + genre + a few words is enough to find the slot.

- **QA-A5 — Death by timeout.** (Added v0.50.0 confirm.) In ARM at 1 shield, let a question timer expire.
  CORRECT: it grades as wrong → damage → the GAME OVER panel (artifact-loss summary) appears. WRONG: a hang on
  the question card. (Code-trace confirmed `timeUp → wrong → damage → gameOver`; this is the eyes-on confirm.)
  - **✅ v0.65.0 resolution (Jason's ruling, harness-pinned):** the design call is settled — **field core-scan
    timeouts now damage shields** (`QUESTION_TIMEOUT_DMG = 14`, the puzzle-breach magnitude), so the ORIGINAL
    A5 text above is finally what the code does: at ≤14 shields a question-timer expiry lands on the
    "Ship destroyed" panel (pinned end-to-end in `arm-run.cjs` 52/52, incl. the stale-Continue guard on a
    lethal timeout). Plain wrong answers still only lose the core; DEPOT installs stay forgiving (core
    scattered, no damage) — deliberate. The v0.52.0 correction note that lived here is superseded. Eyes-on
    = the original step: at low shields let a field timer expire → wrong-grade card + shield hit; at ≤14 →
    the GAME OVER panel. (Puzzle breach chain + the boss 5 s warp deadline remain the other timeout deaths.)

- **QA-M1 — Commander rank strip + rank-up moment (added v0.53.0, browser-blind).** On the menu: a gold rank
  line under the crest — "✦ <rank>" + a thin iris→gold progress bar + "N XP · M XP to <next>". CORRECT: legible
  at both desktop and ~560px widths, doesn't crowd the crest or "Mission select", bar fill matches the XP line.
  Rank-up: play until a threshold crosses (fastest: Study-mode answers, +10–25 each, Cadet at 150), return to
  the menu — a GOLD-bordered toast "✦ Promoted: <rank>" + the strip pulses brighter 3×. WRONG: peach/error
  styling on the toast, a re-fire on every menu visit, or a pulse under reduced motion. Reduced-motion ON:
  same toast + strip, zero animation. The structural halves (strip DOM, one-shot rankSeen, static-under-rm)
  are gate-pinned (K4); this item is the look/fit/feel confirm.

- **QA-M2 — Achievements panel + unlock toasts (added v0.54.0, browser-blind).** Progress screen (Stats/Codex):
  an "Achievements N / 12" section between the heatmap and the domain list — locked tiles dim, unlocked tiles
  gold-edged with a ✓ +XP tag. CORRECT: 12 tiles, readable two-column grid on desktop collapsing cleanly on
  mobile, icons render (emoji), locked/unlocked contrast obvious at a glance. Unlock moment: earn one mid-game
  (fastest: 5 straight correct anywhere → "Hot streak") — a GOLD toast "🔥 Achievement: Hot streak (+50 XP)"
  should appear OVER the running game without breaking it, and the tile shows unlocked on the next Progress
  visit. WRONG: peach styling, toast re-firing for the same achievement, or a tile count ≠ 12. Structure is
  gate-pinned (K5); this is the look/fit confirm.

- **QA-K6 — The six v0.55 artifacts in the shop (added v0.55.0, browser-blind).** Reach a KBB shop and reroll a
  few times. CORRECT: Prism Focus / One-Click Repair / Erasure Coding / Snapshot Ledger / Cluster Expand /
  LCM Pipeline appear in the rotation with readable descriptions at shop-card size; rarity pricing looks
  consistent with peers (common 6 / uncommon 10 / rare 16 base). Play with one equipped and confirm the
  effect FEELS legible in combat (e.g. Erasure Coding's every-third-halved isn't confusing without a visual
  cue — if it is, report; a proc flash would be a follow-up). Engine behavior is gate-pinned (kbb-run 26/26);
  this is the fit/readability confirm.

- **QA-C9 — Sweeper hazard (added v0.56.0, browser-blind).** Play CC until the new obstacle appears (~10% of
  rows): a low PEACH glowing beam that pans left-right across the canyon as it approaches, with peach
  SIDEWAYS arrows above it pointing where it's heading. CORRECT: reads as energy (additive glow, not rock);
  the pan is smooth and predictable enough to either jump it or dodge to where it isn't; the horizontal
  arrows are clearly a different signal from the gold-up (jump) and aqua-down (duck) cones; at high speed
  the beam is still reactable (jump always works). Reduced motion: arrows static, beam still pans (that's
  gameplay, not decoration). WRONG: beam invisible/too dim, arrows confusable with the jump chevrons, or
  deaths that feel unreadable. Knobs: `cc.js SWEEP_FREQ` (0.30 rad/m pan rate), beam opacity 0.85, arrow
  slide `0.12`. Fairness is machine-proven (25/25); this is the readability/feel confirm.

- **QA-M3 — Daily missions strip (added v0.57.0, browser-blind).** Menu: under the rank line, "Daily missions ·
  <date>" with 3 compact rows (icon, name, one-line goal, n/target in aqua). CORRECT: legible, doesn't push
  "Mission select" below the fold at laptop sizes; completed missions get a gold border + "Claim +N XP"
  button; claiming flips the row to a dimmed ✓ state, pays XP (rank bar moves), and shows a gold toast.
  Same strip appears on the Progress screen. Next calendar day: three NEW missions, unclaimed progress gone.
  WRONG: rows overflowing/truncated badly on mobile widths, a claim that doesn't stick, or the same missions
  two days running. Logic is gate-pinned (K6, 14 asserts); this is the fit/legibility confirm.

- **QA-M4 — Ship trail cosmetics (added v0.58.0, browser-blind).** Settings → "Ship trail": six swatches;
  locked ones dimmed with "Master 50% of <domain>". With a variant equipped: ARM's thruster flame (thrust in
  a sector), KBB's hero engine flames (2D fighters), and CC's boost plume (every 5th gate) all wear the color.
  CORRECT: the tint is obvious in each game but doesn't hurt readability (ARM flame vs enemy fire, CC plume
  vs gold gates); swatch selection persists across reload; the standard iris option always available.
  WRONG: a tint bleeding into non-ship UI, a locked swatch selectable, or the color not surviving reload.
  Logic is gate-pinned (K7 + view-smoke); this is the in-game look confirm.

- **QA-E6 — Blitz combo meter (added v0.59.0, browser-blind).** Run a Blitz exam and chain correct answers.
  CORRECT: after the first correct, an aqua "⚡ 1 chain · ×1.1" chip appears left of the score, growing to
  ×1.5 at 5+; it pulses briefly on each link (static with Reduced motion ON); a wrong answer or timeout
  clears it instantly; banked points visibly jump once chained (a fast chained answer can exceed 1000).
  WRONG: the chip crowding the score/quit on narrow widths, a pulse under reduced motion, or the chip
  visible in Study/Sim. Math + reset are gate-pinned; this is the fit/feel confirm. Note for Jason: old
  Blitz bests predate the multiplier — expect them to fall.

- **QA-C10 — The Garage + energy cells (added v0.73.0, browser-blind).** In CC: aqua cell lines spawn between
  obstacles (some arc — jump to collect); a ⬡ counter ticks in the HUD; the game-over panel shows "+N cells
  banked · balance M" and a "Garage ▸" button opening four upgrade rows (hull ×2 tiers / boost / magnet /
  plating; 400–900 cells). CORRECT: cells readable at speed but not distracting; prices FEEL pricey (a
  multi-run save per Jason's intent); buys persist across reload; hull tiers visibly add starting shield
  pips; plating's free first hit reads via the flash-without-pip-loss. WRONG: cells inside a gate's clear
  zone, a buy that doesn't stick, or the panel overflowing at mobile widths. Engine/economy math is
  gate-pinned (cc-run 38/38); this is the look/feel/price-sanity confirm.

- **QA-E7 — NIT nebula backdrop (added v0.74.0, browser-blind).** Open any exam mode: the title screen's
  purple/teal nebula now sits behind the drifting starfield, darkened toward the center. CORRECT: cards and
  option text stay fully readable (the gradient does the work), the nebula reads at the edges, no banding
  on your display, and the Blitz meter/combo chip still pop. WRONG: text contrast suffering anywhere, or
  the photo overpowering the exam. Knob: the two gradient stops in `exam.js` (0.62 / 0.82).

- **QA-A6 — Boss revamp + deeper boss bed (added v0.76.0, browser-blind/deaf).** Dev-skip to the boss.
  EARS: the boss track should now sit DEEP — no piercing highs (solo lives an octave down, dark triangle
  arp, sparse tesla). If it's still sharp, name what stings (lead/arp/zaps) — each has its own knob.
  EYES: **superseded by QA-A7 (v0.82.0 removed the reticle/ping on request)** — still valid here:
  the dreadnought sways slowly with flickering engine wash and sweeping running lights; the arena void
  is near-black; no screen shake during normal boss flight (shake only on laser hits/blasts).

- **QA-C11 — CC crash/cadence bundle (added v0.77.0, browser-blind).** Crash a run: the overlay reads
  "💥 SHIP DOWN — you crashed" with the Garage OPEN beneath it (wallet correct, purchases work, then a
  new run). On a long run the cockpit shake builds across each 40 km stretch and calmly resets right
  after each 40 km boundary — never escalating without relief. Boost gate fires every 2 gates (20 km).
  Knobs: cyc40 quadratic in cc.js applySpeedCamera; GATES_PER_BOOST in CONFIG.

- **QA-K7 — KBB slots + pinned shop actions (added v0.78.0, browser-blind).** Left panel shows 5 slot
  cards (empties dashed); buying an artifact fills its slot with the full card (color bar + rarity +
  description). In the shop, Reroll/Next battle stay visible while the wares scroll. On a phone-width
  window the shop scrolls naturally instead. WRONG: any scrolling needed to reach the two buttons.

- **QA-S7 — Dev Jukebox (added v0.79.0, browser-deaf).** Settings → Dev · Jukebox. Every button plays
  its exact track (browsers need one prior click for audio); the active button glows gold and the ♪
  line names it; Stop returns to the menu bed; leaving Settings returns to menu music. Spot-check a
  few from each group — especially chill variants you could never reach directly before.

- **QA-K8 — KBB battle cinematics (added v0.80.0, browser-blind).** Attacks: charge glow → beam bolt →
  sparks + damage number. Blocked hits/braces raise an aqua hex dome; repairs spiral green motes with
  a +N. Kills: staged explosions crawl the hull → core detonation with shockwave + shake → gold
  TARGET DESTROYED banner (BOSS DESTROYED on bosses); the hull stays visible until the core blows.
  Numbers/banners render in the normal 3D view via the new overlay. Reduced motion: none of it plays.

- **QA-C12 — CC crash screen on EVERY death (added v0.81.0).** Die by obstacle chips (no gate): SHIP
  DOWN + Garage appear immediately. Die by wrong answer at a gate: feedback first, then See results →
  SHIP DOWN. Let the question TIMER expire with ≤2 shields: feedback still appears (no stuck overlay),
  See results → SHIP DOWN. WRONG: any death that freezes the world with no overlay.

- **QA-D1 — KBB sprites (added v0.109.0).** The squad is now your three shipped hero designs, the
  enemy is the BCM dart, asteroids are the drawn rocks — 2D and 3D battle views both. Check glow
  tints still read (peach/iris/mantis) and nothing looks stretched.

- **QA-G7 — G4 repair verifications (added v0.108.0).** (a) Save/Resume FOR REAL: play ARM into
  sector 2, answer a few more questions, exit, re-enter — Resume must still be offered (it used to
  vanish after any answer). (b) Belt sweeper: clear a sector's asteroids — the toast should now
  actually arrive on your next answer. (c) ARM boss: the WALL laser (green safe column) must
  actually appear and hurt — it was invisible since v0.97. (d) CC: corners should never ambush you
  right out of a question anymore.

- **QA-G6 — Intro cinematic (added v0.107.0).** Replay the intro: stars have depth and streak hard
  when the Disruptor fires; the camera leans into each beat; the blast/jump have real sound. EARS:
  flag anything piercing. Reduced motion: calm flat version.

- **QA-G5 — Save & Resume (added v0.106.0).** Play ARM into sector 2, exit to menu, re-enter:
  chooser offers Resume (lands at the sector briefing with your coins/upgrades) or New game.
  Same for KBB (mid-depth, artifacts back) and CC (picks up at your km). Dying wipes the save.

- **QA-C17 — Living canyon (added v0.105.0).** Intro shot: no mountain crosses the chasm; near
  ridge shows rock texture. In flight: the ranges visibly slide past (near faster than far) with
  fresh silhouettes; every ~26 s a BCM ship sweeps across the sky. Reduced motion: ranges hold still.

- **QA-C16 — Turns + barrel roll (added v0.104.0).** At ~255 km a gold MOVE LEFT/RIGHT banner
  flashes ~4 s out: reach the matching outer lane or you clip the wall (one shield). Made corners
  kick a satisfying roll. Double-tap a direction: two-lane move with a full barrel roll (single
  taps: normal). Reduced motion: banner static, no spin.

- **QA-C15 — Boost Mode (added v0.103.0).** Hit a boost: ship snaps to center, controls lock, the
  screen hazes with a pulsing BOOST MODE banner, ~6 s of flight, then ~5 s of clear road (side
  walls only) before traffic resumes. Reduced motion: banner static, no blur.

- **QA-C14 — Coin routing + squeezes (added v0.102.0).** Coin lines visibly dodge into open lanes
  and arc over rocks — following them should always be SAFE (that's the design: coins teach the
  path). Every ~2.5-4 km the canyon squeezes to two lanes for 1-2 km: wall holds one side, jumps
  only, never ducks. Flag if a squeeze feels unfair at high speed.

- **QA-C13 — CC unit 1 (added v0.101.0).** Telegraphs read as real arrows (head + stem). The panning
  hazard is now visibly a scanner DRONE dragging a beam, and the how-to names it. Before a run, the
  how-to card lists what you have equipped. Coins are worth 1 each; check Garage prices feel right
  (50/120/75/60/100 vs runs banking ~30-60 cells).

- **QA-K12 — Battle choreography + sound (added v0.100.0).** Battle start: squad flies in left,
  enemy right, with a sting. Enemy attacks: long charge whine → thick beam → crunchy impact (~2.4 s).
  Hero attacks: snappy three-shot volley (~1.1 s). Victory: detonation booms, banner, then the squad
  flies off right. EARS: say if any effect is piercing or the mix is off.

- **QA-K11 — KBB balance rework (added v0.99.0).** First shop: overwhelmingly common/uncommon offers
  (64/30/5/1). New "Ship fittings" section: +1 permanent stats, one per visit. First enemy takes two
  correct answers; rounds run longer (7-attack window). Leaner squad (40 HP), smaller heals. Say
  where the difficulty curve feels off — every knob is in CONFIG.

- **QA-K10 — KBB unit 1 (added v0.98.0).** THE BIG ONE: the battle canvas should be SHARP now
  (was rendering at 320px stretched). Tour: bigger card, and you cannot answer until it's done.
  No Purge in shops. Kill an enemy: its panel flips to ☠ DESTROYED immediately.

- **QA-A13 — Dreadnought arsenal (added v0.97.0).** Boss fight: peach diamond missiles arc toward
  you — shootable, dodgeable, chunky but slower than shots. Two laser patterns: the familiar single
  beam, and a WALL blast where everything burns except one green-outlined column — get inside it
  before the charge (longer telegraph) completes. Say if the wall frequency (40%) feels wrong.

- **QA-A12 — Economy + cadence (added v0.96.0).** Sector 3 is now the first Dreadnought (two
  regulars before every boss). Hangar: 8 pips per upgrade, each tier subtler; after a full-clear
  sector you should afford ONE upgrade (occasionally two). Say if the squeeze feels wrong — knobs
  are baseCost/slope in arm.js showShop and the income constants.

- **QA-A11 — Briefing rework (added v0.95.0).** Core briefs: Vega explains the why FIRST and only
  names the answer in his final line — confirm you actually read differently now. Before a boss
  sector: he announces a Dreadnought holding your cores and gives the kill plan at the engage beat.

- **QA-A10 — Spread + assist + hidden achievement (added v0.94.0).** With Rapid Fire tiers, volleys
  fan very slightly; shots near a target drift subtly onto it (should feel generous, never magnetic).
  Clear every asteroid in one sector: next answer pops a hidden achievement toast (Belt sweeper);
  before earning it, the Progress grid shows a ❓ mystery tile.

- **QA-A9 — ARM unit 1 (added v0.93.0).** Hangar: upgrades only, no Consumables tab. Simon: max 5
  pads early sectors, 6 mid, 8 late. Shield Cell tiers make shields come back noticeably sooner/faster
  (capacity stays 100). The Charge bar: full exactly when you can fire; watch it refill between shots.

- **QA-G4 — Question variety (added v0.91.0).** Without reloading the page: enter KBB, note the first
  2-3 questions, exit to menu, re-enter — they must DIFFER now (they were identical before). Same for
  ARM's "Fly again". ARM sectors 2+ should open with a visibly wider mix (not the same handful of easy
  cards). In any exam, miss a picture question: the end-of-exam review must show the image.

- **QA-G3 — Review-sweep verifications (added v0.90.0).** (a) Exam with misses → "Redrill the N
  missed" must actually OPEN a study session (it was landing on the menu). (b) KBB on a phone: the
  first-run tour must scroll each highlighted zone into view — Next/Skip always reachable. (c) With
  Extra time ON, Blitz "Best" shows a separate slot from your normal bests. (d) A scan/reveal artifact
  on a multi-answer question must never cross out a correct option.

- **QA-G2 — Leitner pacing feel (added v0.89.0).** Play the same question correctly twice within a
  minute (any two games): mastery must NOT jump two rungs (Progress heatmap moves slower now — that's
  the anti-cram gate, not a bug). Due counts should stop re-listing your fully-mastered cards every
  single day once they climb past the 24h rung.

- **QA-G1 — Wrong-pick rationale in games (added v0.88.0).** Answer wrong in ARM, KBB, and CC (single-
  choice): under the explanation a peach-edged line reads "Your pick — <why that option is wrong>",
  matching the option you actually chose (not a shuffled neighbor — this was misaligned in core before).
  No line on timeouts or when the item has no notes.

- **QA-E9 — Due chip + redrill (added v0.87.0).** After some play, the menu grows a gold "⏰ N due ·
  Review ▸" chip — tapping it opens Study mode on your lapsed cards (chip hides at zero due). Finish
  any exam with misses: the end screen's primary button is now "Redrill the N missed ▸" and reruns
  exactly those questions in Study mode.

- **QA-K9 — Reduced-motion info + phone stack (added v0.85.0).** Reduced motion ON in KBB: damage/heal
  numbers and the DESTROYED banner still appear (static, no slide/shake/beams). On a phone: the question
  panel sits directly under the battle view (no scrolling past artifacts each turn), and in the shop
  Reroll/Next battle stay pinned at the screen bottom while wares scroll. NOTE: tab order still follows
  DOM order (artifacts before questions) — flag if that bothers keyboard play on desktop-narrow windows.

- **QA-E8 — Sim length + extra time (added v0.84.0).** Progress → readiness "take a sim": it must
  launch 75 questions, not the whole bank. Exam setup: Standard says 75. Settings → Extra time ON:
  Blitz decay bars run visibly slower (1.6×) and the sim clock starts at 3:12:00-ish for 75 q... 
  actually 75 × 96 s × 1.6 = 3 h 12 m; with it OFF, 2 h 0 m. WRONG: any timed surface ignoring the toggle.

- **QA-A7 — Boss rework: no ring, prow ports, hyperspeed rush (added v0.82.0, browser-blind).**
  Dev-skip to the boss. EYES: NO gold ring around the hit area — the active weakpoint reads via the
  rising gold beacon + pulsing gold core; the thin PEACH circle is its HP bar (flag if you want that
  gone too). All five ports sit on the FRONT half of the hull facing you (forward batteries → prow
  ports → nose lance). The background is a fast upward-hyperspeed streak field (aqua/iris vertical
  streaks racing down — background only; hull/HUD steady; streaks must vanish cleanly at the bottom
  edge, no popping). Reduced motion: three faint static shafts, zero motion. Knobs: BOSS_FLOW (920),
  WP_DEFS offsets in arm.js.
