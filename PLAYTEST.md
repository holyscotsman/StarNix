# PLAYTEST.md — machine-eye visual review (v0.59.0, NIGHT_RUN unit 9)

56 screenshots from real headless Chromium (real canvas + CDN Three.js) at 1280×800, driven by
`visual-playtest.mjs` through the shipped test seams; shots in `playtest-shots/`. Reviewed
against 07 (palette/composition/readability/clipping/contrast) and the open `BROWSER_QA.md`
items. **This does not replace Jason's pass** — motion feel and ALL audio remain human-only,
and a machine eye is not a player's eye. Findings ranked; objective defects separated from
taste calls. Fixes deliberately NOT implemented here (they feed Phase 2).

## A. Objective defects (ranked)

- **A1 — The menu no longer fits at 1280×800 and cannot scroll.** `04-menu-stock.png` /
  `05-menu-progression-lit.png`: the menu head (crest + rank strip + daily strip + top buttons
  + "Mission select") pushes the KBB card half below the fold and the **NIT exam tile fully
  off-screen**; `.sx-screen`/`.sx-menu` have no `overflow-y:auto` (shell root is
  `overflow:hidden`), so the exam is **unreachable by mouse at laptop heights**. The headless
  gate never caught it because jsdom clicks don't need visibility — exactly the blind spot
  this unit exists for. *Fix shape (Phase 2): `overflow-y:auto` on `.sx-menu` + compact the
  daily strip (e.g. collapsed one-row summary that expands).* **Severity: high.** → **FIXED v0.61.0** (menu scrolls; compact strip; Playwright-verified NIT reachable).
- **A2 — CC mountains render as smooth pyramids — QA-C1's literal WRONG description.**
  `21-cc-establishing.png`, `34/42-cc-live`: the `_buildPeaks` ridge rows read as isolated
  smooth grey-pink cones — no crags, no far-row haze, uniform faces. The v0.47 crag rewrite is
  code-green but its look does not land in a real renderer (vertex jitter too small at this
  scale, and/or missing fog on the far row; the flat-shaded normals make faces read smooth).
  QA-C1 defines this exact look as WRONG, so it's objective by contract. *Knobs: `_buildPeaks`
  crag `amt`, per-vertex noise scale, a fog/haze tint on the far row.* **Severity: high
  (CC's establishing shot is the game's face).** → **FIXED v0.62.0** (root cause: 1-height-segment cones made the jitter a no-op; now segmented + rewritten crag + near-row fog opt-out; see `59/60-cc-peaks-v2/v3.png` — Jason's QA-C1 eyes-on still the final word).
- **A3 — Progress screen shows a doubled "Daily missions" header.** `06-progress-top.png`:
  the `.sx-dom-head` "DAILY MISSIONS" section label sits directly above the strip's own
  "Daily missions · <date>" head. *Fix: suppress the inner head when hosted on the stats
  screen (or drop the dom-head).* **Severity: low, but visibly sloppy.** → **FIXED v0.61.0** (strip head suppressed on Progress).
- **A4 — CC top-right HUD collision.** `34-cc-live-03.png`: the km/speed readout overlaps the
  "↻ intro" chip; the speed line is partially unreadable. *Fix: margin/right-offset for the
  readout or move the intro chip.* **Severity: low-medium.** → **FIXED v0.63.0** (chip on its own row; probe: zero overlap).
- **A5 — ARM in-game top-right collision.** `12-arm-flight-thrust.png`: the ⚙ Menu button
  overlaps a world marker ring + its label (compass/extract indicator) at the top-right edge.
  *Fix: inset the gear or clamp marker rings away from the corner.* **Severity: low.** → **FIXED v0.63.0** (near-opaque gear backdrop).
- **A6 — KBB intro cinematic sits above a large empty content panel.** `16-kbb-cine-decloak.png`:
  more than half the viewport is a blank rounded rectangle while the cinematic plays; the
  layout reads broken even though it's just the not-yet-populated battle panel. *Fix: hide the
  panel until the battle mounts, or letterbox the cinematic full-width.* **Severity: medium.** → **FIXED v0.63.0** (grid-span full-bleed; probe 624×336 → 1256×728; also C4).
- **A7 — CC canyon end-cap reads as a bare grey column.** `34/42-cc-live`: at the vanishing
  point between the peaks a flat grey vertical slab is visible (canyon end geometry / missing
  fog). *Fix: fog to the horizon or extend the wall texture.* **Severity: low-medium.** → **FIXED v0.63.0** (fog-colored end-cap plane).

## B. Confirmations (things the QA list was waiting on — machine-eye PASS)

- **QA-A1 planet (structural):** the ARM dive beat shows the real photographic planet with the
  aqua rim, ships diving (`10-arm-intro-dive-beat.png`). Composition reads well.
- **QA-M1/M3:** rank strip ("✦ PILOT · 950 XP · 450 to Lieutenant") and daily rows with gold
  Claim buttons render clean and legible (`05`); claimed/locked states styled as intended.
- **QA-M2:** achievements panel — 12 tiles, locked dim/unlocked gold ✓ counts (`07`).
- **QA-M4 (partial):** the trail picker renders with swatches + lock hints (`08`); in-game
  tint confirmation still needs eyes on motion.
- **QA-E6:** the Blitz combo chip lives — "⚡ 1 chain · ×1.1" aqua, beside the gold score,
  no crowding at 1280 (`30-exam-blitz-combo-lit.png`).
- **KBB battle screen** (`19`): squad/enemy panels, action row + hint, numbered options, boss
  flag swap (`20`) — all read clean. **CC hit feedback** (`42`): the peach hit-flash bubble is
  unmistakable. **CC canyon walls** (`34`): the orange rock texture reads great in motion
  shots; **shield pips + km HUD** clear.

## C. Taste calls (Jason's eye, not defects)

- **C1 — CC palette temperature.** The orange-desert + grey-pink peaks + purple sky combo is
  striking but sits outside the iris/aqua/space-black identity the shell and 07 lean on. If
  intended as "alien surface", fine; if not, a cooler rock tint or purple-greyer peaks would
  pull it back on-brand.
- **C2 — ARM thruster flame size.** Even held, the flame is a small triangle at ship scale
  (`12`); with trail cosmetics now purchasable, a ~1.5× flame would sell the tint better.
- **C3 — Menu daily-strip header** ("DAILY MISSIONS · date") could drop the date on the menu
  (it's on the Progress screen anyway) to save a line of head height (also helps A1).
- **C4 — KBB cinematic framing** is small relative to the viewport (`15–17`); a larger stage
  (like CC's full-bleed descent) would carry more drama.

## D. Coverage notes / limits

- Sweeper, wall/arch chevron approaches, and gate films did NOT land in the captured frames
  (spawn timing vs. capture cadence; the second CC pass captured 26 frames of clean canyon +
  narrows). A targeted capture that force-spawns each obstacle at fixed z is the Phase-2
  companion if wanted. Fairness/solvability for all of them is machine-proven (25/25).
- Cinematic beat timings in the script hit the warp beat instead of the shell planet beat
  (`03`) — the shell planet confirm stays on Jason's QA-S1.
- Everything audio, all motion feel, and touch ergonomics remain human-gated.

---

## E. Balance/pacing analysis (P2·5, v0.64.0 — the standing report-mode unit)

600-run instrumented sweep of the kbb-balance fuzz (70% cohort, random-affordable buys) +
a 4-seed × 120 s CC row-mix count. **Conclusion: NO tuning change shipped — the data shows
no pathological knob, and the two strongest signals are properties of the fuzz model, not
the game.** Locked targets untouched and green throughout.

- **Tonight's six artifacts sit in the healthy band.** Owned-run avg cleared depth vs the
  4.76 cohort mean: snapshot-ledger 4.91 (n=132 — the most-bought common, working as the
  cheap staple), one-click-repair 4.82, erasure-coding 4.75, cluster-expand 5.39,
  lcm-pipeline 4.07 (fuzz-dead by design — the synthetic bank is all storage-domain),
  prism-focus n=2 (rares are rarely affordable to this cohort; no signal).
- **All four LEGENDARIES were never bought in 600 runs** (metadata-ring, aegis-capacitor,
  golden-cache, singularity-seed): base price 24 + section scaling exceeds what the random
  cohort ever holds. A fuzz-visibility fact, but also a real question for Jason: should
  legendaries be reachable outside long/good runs? (Design lever = price curve or a pity
  offer; deliberately NOT tuned tonight — it moves locked distributions.)
- **Domain artifacts split by fuzz construction, not merit:** data-locality reads 9.94
  because the synthetic bank is 100% storage (it's a pure ×2 in-fuzz); lcm-pipeline reads
  4.07 for the mirror reason. In the real bank both are ~1/9-domain conditionals.
  Correlation-vs-causation caveat on the whole table: the buy policy is random-affordable,
  so weak-looking artifacts are partly "owned by runs that found no damage."
- **CC row mix (actual spawns):** narrow 26.0% · arch 17.9% · wall 15.8% · combo 12.2% ·
  extend 11.1% · pinch 9.5% · **sweeper 7.5%** (10% draw share minus gate-zone skips —
  present, not dominant; matches intent).
