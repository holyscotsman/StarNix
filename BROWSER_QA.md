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
  - **⚠ v0.52.0 correction (harness-pinned — read before running this item):** the v0.50.0 trace is NOT what
    the code does. Question timeouts grade wrong and cost the core but **never call `damage()`** — at 1 shield
    the step above will NOT produce a game over (that half is now structural, `arm-run.cjs` 46/46: timeout →
    wrong → mastery false → live Continue → core lost, no hang). The real timeout→GAME OVER paths, also
    harness-pinned: the **puzzle stability breach chain** (each breach = −14 shields; at 0 the "Ship destroyed"
    panel appears) and, eyes-on only, the **boss 5 s warp deadline** ("Too slow" → same panel). Revised eyes-on
    for A5: (a) let a *question* timer expire and confirm the wrong-grade card, no death; (b) let a *puzzle*
    stability bar drain repeatedly and confirm the GAME OVER panel. **Open design call for Jason:** should a
    question timeout also damage (as spec 02 v1.3 §"Death by timeout" claims)? Code says no today; changing it
    is a one-line `damage(n)` in the timeout branch + a spec/QA re-sync.

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
