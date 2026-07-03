# NIGHT_LOG — autonomous session, started 2026-07-03

Morning report per `NIGHT_RUN.md` v2. One entry per unit (version, unit, what shipped,
assertion delta, negative-control result, punts). Blockers logged here, not asked.

---

## ☀️ MORNING SUMMARY (kept current; latest state at time of writing: v0.64.0)

**Shipped: 13 green-gated units — all nine Phase-1 units (v0.52.0–v0.60.0) + four Phase-2
iterations (v0.61.0–v0.64.0).** Every code unit: full gate green + a negative control that
provably bit + one commit. Gate grew 345 → **412** verify-build assertions, plus NEW suites:
ARM RUN 46, CC RUN 26, KBB RUN 20→26, fairness 20→25, view-smoke +9. Playwright (unit 9's
granted exception) gave the night real eyes: 63 screenshots, 7 objective defects found —
**all 7 fixed and re-verified the same night** (see PLAYTEST.md, all A-items annotated).

**The features, one line each:** ARM engine harness · Commander-rank XP (one pool, 10 ranks,
menu strip + one-shot promotion toast) · 12 achievements (pure predicates, mid-game toasts,
Progress panel) · +6 KBB artifacts (balance targets untouched) · CC sweeper hazard (first
moving obstacle; fairness 25/25 with worst-case solvability) · daily missions (3/day,
date-seeded, claimable XP) · mastery-gated ship trails (per-domain unlocks, applied in all
three games) · Blitz combo multiplier (×1.5 cap, exploit-proofed) · the visual playtest +
its 7 fixes (menu fold/scroll!, CC craggy peaks root-cause, full-bleed KBB cinematic, HUD
collisions, fog end-cap) · cc-run.cjs harness parity.

**Top 3 things to look at first:**
1. **Play the menu → Progress → a CC run** (`npm run build`, open index.html): the whole
   progression surface (rank/daily/achievements) + the new CC look (craggy peaks, sweeper
   hazard, end-cap) shipped browser-blind-then-machine-eyed; your eyes are the final gate.
   `playtest-shots/` (local, 63 PNGs) is the before/after tour; start with `05`, `21` vs `60`.
2. **The QA-A5 doc/code discrepancy** (NIGHT_LOG v0.52.0 entry): question timeouts NEVER
   damage — the documented `timeUp→wrong→damage→gameOver` trace doesn't exist in code.
   Design call needed: should they? (One line + doc re-sync if yes.)
3. **Blitz bests are soft now** (combo inflates ≤50%) and **cosmetics revert if a domain's
   mastery decays below 50%** — both deliberate, both one-liners to change if you disagree.

**Open/blocked (carried):** browser QA pass v0.42–0.64 (QA-M1–M4, K6, C9, E6 added tonight);
ten `kbb*` sprites; D1 bank expansion (your dumps); a1q13/a1q27/a3q7 quarantined; a4q50
orphan; 01 doc-sync owed (xp/rankSeen/StarNix.xp/submitScore/achievements/daily/cosmetics
surfaces); KBB-win/ARM-sector-clear telemetry emits (would unlock the literal "flawless
battle"/"full-collection" achievements); performance-domain artifact slot.

Baseline at start: v0.51.0, commit 068168c, `npm run check` ALL GREEN (verify-build 345,
fairness 20/20, kbb-run 20/20, kbb-draw green). Node v26.4.0 via Homebrew.

---

## v0.52.0 — Unit 1: ARM engine harness (`arm-headless.cjs` + `arm-run.cjs`)

**Shipped:** the KBB-pattern harness pair for ARM, wired into `npm run check`.
- `arm-headless.cjs` — mock ctx mirroring `kbb-headless.cjs` + ARM deltas: `rng.shuffle`/`range`
  (copy semantics matching `starnix-core.makeRng`), `questions.pool()`, `ctx.test = true`
  (arm.js TESTMODE: no RAF; frames via `root.__armTest.step(dt)`).
- `arm-run.cjs` — **46 assertions** (target was ≥15): registration shape; INTRO→BRIEF walked via
  real briefing option clicks→WARP→SECTOR (5 distinct-qid cores, 'arm' bed); grading right/wrong
  (mastery args, telemetry, +25/cargo vs lost); forceTimeout → wrong grade + live Continue + clean
  resolve (no hang); depot round-trip (HOME→DEPOT_Q→+40/station+1→DEPOT_SUM→SHOP→SECTORCLEAR→
  sector-2 BRIEF); death-by-timeout via 8× puzzle stability breaches → GAMEOVER → "Ship destroyed"
  panel → Relaunch; pause/resume freezing gnow() across wall time; zero-residue unmount;
  reduced-motion (intro auto-end, immediate countdown) vs stagger-delayed countdown; seeded
  determinism (`coresForSector`).

**Assertion delta:** +46 (new suite). Gate: ALL GREEN end-to-end, exit 0.

**Negative control:** flipped ARM `gradeAnswer` single-answer equality → exactly the 12
grading-dependent new assertions failed + 1 PRE-EXISTING verify-build pin ("a timed-out core is
graded incorrect") — same behavior, correctly co-tripped. Restored, re-ran, ALL GREEN.

**⚠ Discrepancy logged (not a blocker; unit shipped on actual behavior):** NIGHT_RUN unit 1 said
"use `_test.forceTimeout` to pin death-by-timeout landing on the GAME OVER panel". Code reality:
question timeouts NEVER damage — `showQuestion`'s two consumers (core scan `arm.js:1092`, depot
`arm.js:1240`) cost the core only. The claimed trace `timeUp → wrong → damage → gameOver`
(QA-A5, spec 02 v1.3 §"Death by timeout", v0.50.0 changelog) does not exist. Real timeout→
GAME OVER paths: puzzle stability breach (`puzzleExpire` → `damage(14)`, now pinned) and the
boss 5 s warp deadline (eyes-on). Pinned both truths; annotated QA-A5 with a revised eyes-on
protocol. **Jason's design call:** should question timeout damage (as the docs claim)? One-line
change if yes + spec/QA re-sync. Did NOT change gameplay — learning-integrity/spec rules say ask,
NIGHT_RUN says log and move on.

**Punted:** nothing else. Commit: `v0.52.0 — ARM engine harness`.

---

## v0.53.0 — Unit 2: Commander rank (cross-game XP meta-progression)

**Shipped:** one XP pool + 10 ranks + menu display + one-shot rank-up moment, fed ONLY by
existing seams (per the unit's "read the seams" rule):
- **Answers** — `makeMasteryStore.record` (the ONE choke point all three games AND the exam
  already route through): correct +10 / wrong +2 / Leitner promotion +15 / first cross into
  `MASTERED_BUCKET` +40.
- **Exam completions** — shell `_recordExam`: +25 any completed mode, +75 pass bonus (≥80,
  the exam's own mark), 0 on abandon.
- **Run scores** — `persistence.submitScore`: this 01-contract seam has been called by ARM
  (guarded) since the boss shipped, but NO provider implemented it — a silent no-op. Completed
  it in `initCore`, bound to the live profile (bests.<GAME> high-water + flat +150). ARM's
  campaign-win call now works with zero game-module edits.
- Ranks pinned (0/150/400/800/1400/2200/3300/4800/6800/9500, Recruit→Fleet admiral); pure
  math on `StarNix.xp`; `profile.xp`+`rankSeen` in defaultProfile + migrate repair.
- Shell: `.sx-rank` strip in the menu head (gold name, iris→gold bar, to-next line; textContent
  per house rule), rebuilt each `showMenu`; rank-up = gold `.sx-toast-gold` toast + 3-pulse
  brightness on the strip; reduced-motion (flag + CSS guard) = same surface, static;
  `rankSeen` makes it one-shot. `_toast` gained an optional class param (additive).

**Assertion delta:** verify-build 345 → **360** (+15, section K4). Full gate ALL GREEN, exit 0.

**Negative control:** gutted the `addXP` mutation → exactly the 4 live-wiring pins failed
(mastery award, submitScore ×2, _recordExam award; 356/360), pure-math and DOM pins
correctly unaffected. Restored, re-ran, ALL GREEN 360/360.

**Punted (logged, not blocking):**
- CC/KBB per-run score XP: both write `profile.bests.CC/KBB` directly inside their modules
  (load→mutate→save) — no core seam passes their scores; tapping them means editing game
  files. Their gameplay already feeds the pool per-answer. Phase-2 candidate if wanted.
- 01 doc-sync for `profile.xp`/`rankSeen`/`StarNix.xp`/completed `submitScore` — spec
  versioning (01_SHARED_CORE_v1_5.md) is its own unit; noted in STATE Open.
- Rank-up detection is menu-entry (not mid-game): games own their screens while mounted;
  the shell moment fires on the next menu visit. Deliberate, pinned as designed.

Commit: `v0.53.0 — Commander rank XP meta-progression`.

---

## v0.54.0 — Unit 3: Achievements (12, cross-game)

**Shipped:** pure-predicate achievements over `{profile, stats}` snapshots; zero new game seams.
- Streak tracking at the ONE choke point every graded answer crosses (`mastery.record`,
  tagged by the `meta.game` its callers already pass): `profile.streaks` current +
  `streaksBest` high-water per surface (ARM/KBB/CC/EXAM).
- The 12: First contact +25 · Hot streak (5-chain) +50 · Gate runner / Void discipline /
  Deep strike (10-chains CC/KBB/ARM) +100 · Station restored (ARM win) +250 · Sim certified
  (sim ≥80) +150 · Scholar (50 seen) +75 · First mastery +50 · Domain sweep +150 ·
  Archivist (25 mastered) +200 · Commander (rank ≥6) +250.
- Evaluation at mastery.record + submitScore + _recordExam (after the history write).
  List-ordered so intra-pass XP can cascade into Commander (pinned). One-shot via
  `profile.achievements` id→ts. XP flows into the unit-2 pool.
- Shell: boot registers core `onUnlock` → gold toast, works MID-GAME (toast overlays stage).
  Progress screen: 12-tile panel (locked dim / unlocked gold + ✓, N/12 count line).

**Assertion delta:** verify-build 360 → **378** (+18, section K5; K4 gained an all-unlocked
sentinel so its exact XP-delta pins stay deterministic). Full gate ALL GREEN, exit 0.

**Negative control:** severed the mastery-point `evaluateAchievements` call → exactly the
2 live-wiring pins failed (376/378; submitScore/_recordExam paths kept their own evaluate
calls and correctly stayed green). Restored, re-ran, 378/378.

**Deviations/punts (logged):**
- NIGHT_RUN's examples "flawless KBB battle" and "ARM full-collection escape" are impossible
  without new game-side signals (KBB `winBattle` and ARM sector-clear emit NO telemetry).
  Shipped same-spirit replacements on existing signals (per-game 10-chains + campaign win).
  Adding the two telemetry emits (KBB battle-won w/ damage-taken, ARM sector-clear w/
  collected count) = a small Phase-2 candidate that would unlock the literal versions.
- Multi-unlock toasts stack on the same spot (last wins visually) — cosmetic, rare, logged.
- 01 doc-sync now also owes the achievements surface.

Commit: `v0.54.0 — Achievements`.

---

## v0.55.0 — Unit 4: KBB artifact batch (+6)

**Shipped:** six artifacts on existing `fireSide`/hook seams; pool 58 → 64; **balance targets
untouched** and the locked gate re-ran green with identical margins (random median 4 ≥3, poor
median 1 ≤2, good cap 36% ≤50%).
- Prism Focus (rare, damage): +12 flat on the first attack of each battle.
- One-Click Repair (uncommon, sustain): consumables also +6 shield — first consumer of the
  previously-UNUSED `onConsumableUsed` hook seam.
- Erasure Coding (uncommon, defense): every third incoming attack halved (`inst.state` counter
  through `applyIncoming`'s chained onEnemyAttack).
- Snapshot Ledger (common, economy): +1 coin per correct answer.
- Cluster Expand (uncommon, scaling): +1 block per battle won (permanent; mirrors
  Reinforced Hull's direct `squad.block` mutation pattern).
- LCM Pipeline (uncommon, domain lifecycle): +0.8 mult on lifecycle questions.

**Balance strategy:** two fuzz-dead by construction (the balance harness never uses
consumables; its synthetic bank is all storage-domain), four mid-power within rarity norms.
Verified empirically before writing tests — margins didn't move.

**Catch during design:** the first draft had `affinity-rules` (vms domain) — the full-pool
survey showed `hypervisor-core` already owns vms (+0.6 mult), and that lifecycle +
performance were the only uncovered domains. Swapped to LCM Pipeline. Performance domain
remains open for a future artifact.

**Assertion delta:** kbb-run 20 → **26** (+6 targeted engine tests: paired same-seed damage
deltas, per-hit `lastIncoming` trace, coin/shield/block deltas through the public seams +
`equipArtifact`). Full gate ALL GREEN 378/378 + 26/26 + balance, exit 0.

**Negative control:** stripped Prism Focus's first-attack condition (fires every attack) →
exactly its pin failed (25/26). Restored, re-green.

**Punted:** a visual proc cue for Erasure Coding (flagged in QA-K6 — needs eyes first);
a performance-domain artifact (the last empty domain slot).

Commit: `v0.55.0 — KBB artifact batch (+6)`.

---

## v0.56.0 — Unit 5: CC sweeper hazard (OB_SWEEP)

**Shipped:** the first MOVING CC obstacle — a low peach energy beam panning the canyon.
- Deterministic by construction: beam x = `sin(phase + z·SWEEP_FREQ)·LANE_W`, phase from the
  run rng at spawn. Pure function of approach distance — no wall clock, no dt plumbing;
  `_sweepX` is the single source of truth for collision AND render.
- **Live collision is phase-honest** (one hot lane at the closest-approach test; dodging to
  where the beam isn't is real skill). **Solvability is worst-case phase** (`_wouldHit`
  treats all lanes as potentially hot → jump, which lifts the base over the low beam, is the
  guaranteed out). This split keeps gameplay generous and fairness rigorous.
- Spawn: own row at 10%; original pattern mix renormalized (relative proportions kept).
- Telegraph: a NEW third tier — peach SIDEWAYS arrows (horizontal cones; shape+color distinct
  from gold-up/aqua-down) pointing along the pan direction, sliding laterally; reduced-motion
  = static arrows (the sweep itself is gameplay and stays identical — equity, not decoration).
- Hygiene: `sweepPhase` (and `span`) pre-declared in the pool factory; `OB_SWEEP` in `_enums`.

**Assertion delta:** fairness 20 → **25** (worst-case stand/jump/duck, exactly-one-hot-lane
live pin, spawn presence; all 20 existing asserts untouched and re-green over the new spawn
mix), view-smoke +3 (meshes, 90 panning frames clean, reduced-motion clean). Full gate ALL
GREEN 378/378, exit 0.

**Negative control (the strong kind):** made `_wouldHit` claim nothing clears the sweeper →
ALL FOUR pre-existing solvability seeds failed + the new jump pin (5 fails) — proving the
extended net catches a genuinely unfair hazard, not just its own bookkeeping. Restored,
re-green 25/25.

**Punted:** none functional. Beam visuals/pan-rate feel are QA-C9 (eyes).

Commit: `v0.56.0 — CC sweeper hazard`.

---

## v0.57.0 — Unit 6: Daily missions (3/day, date-seeded)

**Shipped:** six templates (Sharpshooter / Specialist / Chain reaction / Examiner / Collector /
Drill sergeant), three per calendar day drawn without replacement + rng-drawn targets.
- **Deviation (logged, deliberate):** the unit said "deterministic via `ctx.rng.fork(dateString)`"
  — but ctx.rng is boot-seeded from `clock.now()` (initCore), so a fork of it produces
  DIFFERENT missions every boot. The determinism pin ("same date → same missions") requires
  date-only dependence, so generation uses `makeRng("daily:"+date)` instead. Letter broken,
  intent kept.
- Progress rides existing seams only: the mastery.record choke point (correct / per-game /
  best-streak / promotions counters on `profile.daily`), `_recordExam` (Examiner), and
  Collector = `profile.xp − daily.xpStart` (needs no counter at all).
- Rollover: local calendar day via the injectable core `clock` (tests override it); a new day
  regenerates missions, unclaimed progress expires.
- Claims: one-shot, pay pinned XP into the unit-2 pool.
- Shell: menu strip (dated head + 3 rows + gold Claim / ✓ claimed) + the same strip on the
  Progress screen. **Smoke caught a real bug:** claiming re-rendered the screen, which wiped
  the stage INCLUDING the just-shown toast — reordered to re-render first, toast after.

**Assertion delta:** verify-build 378 → **392** (+14, K6): gen determinism + distinct
templates, pinned 2026-07-03 roll (drift is loud), ensure seeding, choke-point wiring incl.
promotions, Examiner tick, chain completion capped at target, claim-before-done guard,
one-shot claim, rollover regen, menu DOM, live claim-click (XP + row flip + toast survives
re-render), Progress rows. Full gate ALL GREEN, exit 0.

**Negative control:** removed the claim latch (the infinite-XP hazard) → exactly the 2 claim
pins failed (390/392). Restored, re-green 392/392.

**Punted:** a "time until reset" countdown on the strip (needs a live ticker — trivial but
pure cosmetics); mission variety beyond 6 templates.

Commit: `v0.57.0 — Daily missions`.

---

## v0.58.0 — Unit 7: Mastery-gated cosmetics (ship trails)

**Shipped:** six pure-vector trail tints; each domain variant unlocks at 50% of that
domain mastered (`questions.stats().domains[].masteredPct`); standard iris always free.
- **Architecture call:** games never touch stats() or globals. The Settings picker persists
  BOTH `settings.shipTrail` (id) and `settings.shipTrailColor` (shell-resolved hex);
  `StarNix.cosmetics.resolve` re-validates the lock so a hand-edited locked pick falls back
  to standard (the negctrl proves this bites). Render paths read the hex or fall back.
- Applied in all three games, jsdom-guarded, one visible accent each:
  ARM thruster flame (sprite + vector hulls; `_test.palette().trail`), KBB procedural hero
  engine flames (`liveState.trailColor`), CC boost plume (CCView `opts.shipTrailColor`).
- Settings: "Ship trail" swatch grid; locked = dimmed + "Master 50% of <domain>".

**Assertion delta:** verify-build 392 → **402** (+10 K7) + cc-view-smoke +2. Full gate ALL
GREEN, exit 0. The K7 domain unlock is REAL: it masters half of the smallest bank domain's
questions and drives the actual picker DOM + both game mounts through the shell.

**Negative control:** resolve() lock bypass (locked picks stick — the cosmetic-cheating
hazard) → exactly the resolve pin failed (401/402). Restored, re-green.

**Punted:** CC always-on engine glow variant (only the boost plume is ship-owned; an
always-on glow would need a new mesh — Phase-2 candidate); mastery-decay behavior (if a
domain later drops below 50%, resolve() reverts the trail to standard on next mount —
deliberate and pinned via resolve, but Jason may prefer earned-forever; one-line change).

Commit: `v0.58.0 — Mastery-gated ship trails`.

---

## v0.59.0 — Unit 8: Blitz combo multiplier

**Shipped:** `comboMult(streak) = 1 + 0.1·min(5, streak)` applied to the NEXT correct answer's
decayed points; wrong/timeout banks 0 and resets the chain. Aqua meter chip in the exam top
bar ("⚡ N chain · ×M"), pulse on growth, static under reduced motion (settings flag + CSS
guard). **Blitz only** — `S.combo`, the meter, and the multiplier are all mode-guarded;
Study's zero-touch is pinned. Bests: schema untouched (`speedPoints` summed as before);
perfect chains inflate ≤50%, so pre-combo bests are soft benchmarks now — flagged for Jason
in QA-E6 (a "bests reset" is his call, not mine).

**Assertion delta:** verify-build 402 → **407** (+5): comboMult boundaries incl. the ×1.5 cap;
live chain start + meter text; the chained answer scoring ABOVE the 1000 un-multiplied
ceiling (timing-jitter-proof — only the multiplier can exceed it); wrong-answer reset +
meter clear; Study untouched. Full gate ALL GREEN, exit 0.

**Negative control:** chain never resets (the exploit) → exactly the reset pin failed
(406/407). Restored, re-green.

**Punted:** a combo SFX tick (audio is human-gated; would be blind); best-score migration.

Commit: `v0.59.0 — Blitz combo multiplier`.

---

---

## v0.60.0 — Unit 9: Playwright visual playtest

**Shipped:** Playwright + Chromium (the unit's granted exception); `visual-playtest.mjs`
drives the built index.html through the shipped test seams; **56 shots** (incl. a second
CC pass after the first sweep failed to dismiss the how-to card); reviewed against 07 +
BROWSER_QA into **`PLAYTEST.md`** — ranked, objective vs taste separated, no fixes (Phase-2
feed per spec). Shots stay local (`playtest-shots/`, 43 MB, gitignored).

**The two headliners (both invisible to jsdom, both objective):**
- **A1 — the menu doesn't fit 1280×800 and can't scroll**: rank + daily strips (units 2/6)
  push the NIT exam tile fully off-screen; no `overflow-y` anywhere in the chain. The exam is
  mouse-unreachable at laptop heights. Gate stayed green because jsdom clicks ignore
  visibility. Highest-priority Phase-2 fix (one-line overflow + strip compaction).
- **A2 — CC peaks are QA-C1's literal WRONG**: smooth grey-pink pyramids, no crags, no haze.
  The v0.47 crag rewrite runs (code-green) but does not land visually in a real renderer.
Also: A3 doubled daily header (Progress), A4 CC km/speed vs ↻ intro collision, A5 ARM ⚙ vs
marker ring, A6 KBB cinematic over a blank panel, A7 CC end-cap grey column. Confirms:
dive-beat planet REAL, rank/daily/achievement/trail-picker/combo surfaces clean, CC walls +
hit-flash read great, KBB battle screen solid.

**No negative control:** this unit adds no gate assertions (Playwright is a standalone tool,
not in `npm run check`); the deliverable is reviewed evidence. Gate re-run green 407/407
(no game-code changes). Version bumped for the tooling + report.

**Punted:** committing the PNGs (43 MB — local only); a force-spawn obstacle capture pass
(sweeper/arch/gate close-ups never landed in frame — Phase-2 companion if wanted).

Commit: `v0.60.0 — Playwright visual playtest + PLAYTEST.md`.

---

---

## Phase 2 · iteration 1 — MINI-SPEC (written before build, per protocol)

**What:** PLAYTEST A1 + A3 (+C3): make the menu survive its new progression head at laptop
heights, and fix the doubled daily header on Progress.
**Why (rubric):** mission value 5/5 — the NIT exam tile is mouse-UNREACHABLE at 1280×800,
and the exam is the learning core; verifiability 4/5 (source-level CSS pin + DOM-shape pins;
fold geometry itself is jsdom-invisible, evidenced by a Playwright re-shot); blast radius
5/5 (starnix-shell.js only); size 5/5. Top scorer of every A-finding.
**How:**
1. `.sx-menu` gains `overflow-y:auto` + `justify-content:flex-start` (the actual fix).
2. `_renderDaily(host, opts)` — menu hosts a COMPACT strip (no goal-desc line, undated
   short head); the Progress screen keeps the full rows but drops the strip's inner head
   (its `.sx-dom-head` already titles the section — A3's double header gone).
**Planned pins (+4 net):** CSS source contains the menu overflow rule; menu strip has 3 rows
but NO `.sx-daily-desc`; stats strip HAS descs; exactly ONE "Daily missions" heading on
Progress. K6's existing "dated head on menu" pin updates to the undated wording — an honest
re-pin for a deliberate redesign, not a loosening (claim-flow pins unchanged).
**Negative control:** strip the `overflow-y` rule → the CSS source pin must fail alone.

**RESULT (v0.61.0):** shipped exactly as spec'd. Gate 407 → **409/409** (+3 net: A1 CSS
regression pin, Progress full-rows, single-heading; K6's menu pin re-pinned to the compact
redesign — claim-flow pins untouched). Negctrl: overflow stripped → exactly the A1 pin
failed (408/409), restored. Playwright evidence: menu scrollable, NIT tile in-viewport after
scroll (`57/58-menu-fixed-*.png`). PLAYTEST A1 + A3 annotated FIXED.
Commit: `v0.61.0 — Menu fold fix + daily strip layout (PLAYTEST A1/A3)`.

---

## Phase 2 · iteration 2 — MINI-SPEC (before build)

**What:** PLAYTEST A2 — CC peaks read as smooth grey-pink traffic-cones (QA-C1's literal
WRONG). Make the ridge rows read as CRAGGY MOUNTAINS with depth haze.
**Why (rubric):** mission value 4/5 (CC's establishing shot is the game's face; QA-C1 is an
open contract item); verifiability 4/5 — for the FIRST time a visual fix can be iterated
against real screenshots (Playwright loop: edit → build → shoot → look), plus structural
pins (far-row haze material distinct, crag amplitude source pin); blast radius 5/5 (cc.js
`_buildPeaks` + materials only — collision/fairness untouched, peaks are scenery); size 4/5.
**How:** (1) crank per-vertex crag displacement so facets break the cone silhouette;
(2) haze the far row (material color lerped toward the sky/fog tint, flat no-shading look);
(3) keep near-row rock in-palette (cooler grey, less pink) — conservative on C1 (Jason's
taste call stays open). Iterate the look via Playwright until the shot reads as a range.
**Planned pins:** view-smoke: near/far peak materials exist and differ (far = haze tint);
source pin on the crag amplitude; existing fairness/view suites untouched.
**Negative control:** zero the crag amplitude → the source pin fails.

**RESULT (v0.62.0):** ROOT CAUSE was better than the spec guessed: the cones had ONE height
segment, so `crag()` had no movable vertices (apex at x=z=0, base planted) — the v0.47 crag
pass never did anything. Fixed with height-segmented cones + rewritten crag (radial jitter +
height wobble + apex kink) + near-row `fog:false` (the fog had washed both rows to one pale
tint — the near/far layer contrast QA-C1 wants comes from exempting the near row). Iterated
against real screenshots twice (`59`, `60`) — silhouettes break, layers separate. View-smoke
+3 pins incl. the height-segment SOURCE pin (the exact regression class); negctrl (segments
stripped) failed exactly that pin. Full gate 409/409. Jason's QA-C1 eyes-on remains final.
Commit: `v0.62.0 — CC craggy peaks (PLAYTEST A2 root-cause fix)`.

---

## Phase 2 · iteration 3 — MINI-SPEC (before build)

**What:** the PLAYTEST small-defect sweep — A4 (CC km/speed readout collides with the
↻ intro chip), A5 (ARM ⚙ Menu overlaps world marker rings top-right), A6 (KBB cinematic
plays above a huge blank battle panel), A7 (CC end-cap grey column at the vanishing point).
**Why (rubric):** mission value 3/5 (polish, but all four are objective PLAYTEST defects);
verifiability 4/5 (DOM/CSS pins + Playwright re-shots); blast radius 4/5 (one contained
touch per module, no logic); size 5/5 (each is lines, not systems). Batched as one coherent
"PLAYTEST cleanup" slice — smaller than any alternative unit.
**How:** A4 right-inset the CC readout clear of the chip (CSS). A5 inset the ARM compass
markers away from the top HUD band (canvas-side padding). A6 hide the empty KBB content
panel while the cinematic runs (class toggle). A7 close the corridor with a fog-colored
end-cap (or fog-range tune) — timeboxed to one screenshot iteration; logged if unresolved.
**Planned pins:** source/DOM pins per fix (CC CSS offset, ARM pad constant, KBB
cinematic-hides-panel class in view-smoke/kbb-run where reachable); Playwright evidence.
**Negative control:** revert the KBB panel-hide class toggle → its pin fails.

**RESULT (v0.63.0):** all four shipped; two root causes were subtler than spec'd:
- A6 wasn't a missing hide — the full-bleed CSS EXISTED but `inset:0` on an abs-positioned
  GRID ITEM resolves against its grid AREA, not the root (the gotcha). Grid-span fixes it:
  probe 624×336 → 1256×728. Full-bleed cinematic also delivers taste-call C4 for free.
- A5 re-scoped: the "collision" is world objects scrolling under a translucent HUD button —
  fixed by making the gear read as UI (near-opaque backdrop + shadow), not by moving markers.
- A4 chip → own row (probe: zero overlap). A7 fog-colored end-cap plane (fog:false — it IS
  the fog) seals the corridor; evidence `61–63-*.png`.
Gate 409 → **412/412** (+3 A4/A5/A6 source pins, +1 end-cap pin in view-smoke); negctrl
(A6 span reverted) failed exactly its pin. PLAYTEST A4–A7 annotated FIXED — **every
objective PLAYTEST defect (A1–A7) is now closed**; C1/C2/C4 taste calls stay with Jason.
Commit: `v0.63.0 — PLAYTEST cleanup sweep (A4–A7)`.

---

## Phase 2 · iteration 4 — MINI-SPEC (before build)

**What:** debt-list item — `cc-run.cjs` engine-harness parity (the ARM/KBB pattern's missing
third leg). CCSim is renderer-free, so this drives the REAL sim class headlessly: full-run
integration (spawn cadence honoring gate-clear zones, live collisions per obstacle type
including the sweeper's phase-honest lane, gate question flow → shields ±, boost every 5
gates, buffs, crash → game over, distance scoring), seeded + deterministic.
**Why (rubric):** mission value 4/5 — CC took tonight's biggest mechanical changes (sweeper,
peaks, end-cap) with only invariant-level fairness coverage; this is the safety net for every
later CC touch, same argument that put the ARM harness FIRST in Phase 1. Verifiability 5/5;
blast radius 5/5 (new .cjs + one package.json line); size 3/5.
**Planned assertions (≥14):** reset state; spawn cadence + row gaps ≥ MIN_GAP; gate spawn on
scored distance + obstacle clearing near gates; per-type live collision truths (wall hits
grounded/every lane, arch hits standing, narrow hits sealed lane only, sweeper hits ONLY its
live lane and never a jumper); question right → +1 shield (cap), wrong → −2 → 0 → game over;
boost triggers on the 5th gate + grants invulnerability + covers scored km; crash costs a
shield + i-frames block chained hits; score = floored scored metres; same-seed determinism.
**Negative control:** flip the sweeper's live-phase collision to ignore phase (hit any lane)
→ exactly the sweeper live-lane pin fails.

**RESULT (v0.64.0):** shipped, 26/26, wired into the gate after arm-run. One honest harness
lesson: the probe player never dodges, so chip damage killed it before the first 10 km gate —
travel legs now pin shields and graded deltas measure off the pin. Negctrl (phase-blind
sweeper) failed exactly the live-lane pin. Full gate 412/412 + CC RUN 26/26.
ALL THREE GAMES now have engine run-through harnesses.
Commit: `v0.64.0 — cc-run.cjs engine harness parity`.

---

## Phase 2 · iteration 5 — MINI-SPEC (before build)

**What:** the standing repeatable unit — kbb-balance + CC spawn-mix in REPORT mode, with a
one-off instrumented analysis (per-artifact purchase counts + clear-depth correlation across
the fuzz cohorts; CC row-type distribution incl. the new 10% sweeper share), then AT MOST one
tuning fix that keeps every locked target green — or a justified no-tune conclusion.
**Why (rubric):** mission 3/5 (tonight added 6 artifacts + a hazard; the distributions have
never been LOOKED at, only gated); verifiability 5/5 (locked targets must stay green
untouched); blast radius 5/5 (a data-driven one-knob tune at most); size 4/5.
**Planned output:** analysis appended to `PLAYTEST.md` (per NIGHT_RUN §Phase-2); a tune ONLY
if the data shows a clear dead/outlier knob; negctrl per the usual rule if code changes.

**RESULT (no version bump — analysis only, zero code changed):** 600 instrumented fuzz runs
+ CC row-mix counts appended to PLAYTEST §E. **Justified NO-TUNE:** tonight's six artifacts
sit within noise of the 4.76 cohort mean; the strong signals — all four legendaries never
bought (price vs random-cohort coins) and the domain-artifact depth split (fuzz bank is
all-storage) — are fuzz-model properties; tuning game constants against the test's blind
spots would be tuning the wrong thing. One real design question surfaced for Jason:
legendary reachability (price curve / pity offer). Locked targets untouched, gate untouched.
Commit: `P2·5 — balance/pacing analysis (no-tune conclusion) → PLAYTEST §E`.

---

## ▶️ RUN RESUMED (morning, Jason present) — four design rulings received

Jason answered the parked design calls: **(1) ARM question timeouts now COST SHIELDS** (the
documented QA-A5 trace becomes real code — implement + pin); **(2) Blitz bests stay** (no
reset — combo-era scores will simply overtake them); **(3) trail cosmetics are EARNED
FOREVER** (decay no longer re-locks — latch unlocks on the profile); **(4) legendaries stay
as-is** (aspirational; revisit after real play). (2)/(4) are logged decisions, zero code.

---

## Phase 2 · iteration 6 — MINI-SPEC (before build)

**What:** Jason's ruling #1 — a timed-out FIELD core scan damages shields
(`QUESTION_TIMEOUT_DMG = 14`, same magnitude as a puzzle breach; depot installs stay
forgiving/no-damage), making the long-documented `timeUp → wrong → damage → gameOver`
trace true at last. At 0 shields the GAME OVER panel lands; a lethal timeout must clear the
pending question so the stale Continue can't resurrect the run.
**Pins:** arm-run — non-lethal timeout shield delta exactly −14 then the normal core-lost
resolve; lethal timeout (drain via breaches to ≤14, then forceTimeout) → GAMEOVER →
"Ship destroyed" + `hasQuestion() === false`; the unit-1 "timeout never damages" label
honestly re-pinned to the new canon. QA-A5 rewritten (the original wording is NOW correct).
**Negative control:** remove the damage branch → the new delta + lethal pins fail.

**RESULT (v0.65.0):** shipped exactly as ruled. `QUESTION_TIMEOUT_DMG = 14`, field scans
only (depot stays forgiving; plain wrong answers unchanged — Jason chose the middle option).
Lethal-timeout guard: pending question nulled + Continue hidden so a stale proceed can't
resurrect a dead run. ARM RUN 46 → **52/52** (exact −14 delta; breach-drain → timer expiry →
GAMEOVER → panel → recovery). Negctrl (damage disabled) failed exactly the 4 new-canon pins.
QA-A5 rewritten: the ORIGINAL v0.50.0 wording is now true; the v0.52.0 correction superseded.
Spec 02_v1_4 re-sync queued as the doc unit. Gate 412/412.
Commit: `v0.65.0 — ARM question timeouts cost shields (QA-A5 ruling)`.

---

## Phase 2 · iteration 7 — MINI-SPEC (before build)

**What:** Jason's ruling #3 — trail cosmetics are EARNED FOREVER. New `profile.trailsUnlocked`
(id → ts) latches any domain variant the moment its 50% threshold is seen; `cosmeticUnlocked`/
`resolve` gain an optional `profile` arg honoring the latch, so later mastery decay never
re-locks or force-reverts an equipped trail. Latching happens in the Settings picker render
(the one place stats + profile meet); pure helpers stay pure.
**Pins:** K7 — latch() records + returns newly-earned ids; `resolve` keeps a pick with the
latch present even when stats fall BELOW threshold (the ruling's exact scenario); end-to-end:
unlock via seeded mastery → DE-seed → picker still offers the variant. Existing no-latch
fallback pins unchanged (a never-earned locked pick still falls back to standard).
**Negative control:** ignore the latch in `cosmeticUnlocked` → the earned-forever pins fail.

**RESULT (v0.66.0):** shipped as spec'd — `profile.trailsUnlocked` latch (picker-render
latching, persisted), optional `profile` arg through `unlocked`/`resolve`, never-earned
fallback intact. K7 +3 (415/415 total); negctrl failed exactly the 2 earned-forever pins.
Rulings #2 (keep Blitz bests) and #4 (legendaries as-is) need no code — logged as decided.
Commit: `v0.66.0 — Trail cosmetics earned forever (ruling #3)`.

---

## Phase 2 · iteration 8 — MINI-SPEC (before build)

**What:** the owed spec re-syncs, per doc discipline (never overwrite; write the successor
`_vX_Y` with a Change history entry): **02_ARM v1_4** — the §Death-by-timeout section now
describes real canon (field scans damage `QUESTION_TIMEOUT_DMG = 14`; depot forgiving;
lethal-timeout stale-Continue guard; Jason's ruling); **01_SHARED_CORE v1_5** — document the
v0.52–v0.66 core surface: completed `persistence.submitScore`, the seven new profile fields
(xp, rankSeen, streaks, streaksBest, achievements, daily, trailsUnlocked), and the four new
`StarNix.*` namespaces (xp, achievements, daily, cosmetics) with their pure/deterministic
guarantees and gate coverage pointers.
**Why (rubric):** mission 3/5 — the ask-don't-assume culture runs on specs matching code;
six shipped systems are currently spec-invisible. Verifiability 3/5 (docs; the gate proves
nothing changed in code — full check must stay 415/415 untouched). Blast radius 5/5 (two new
.md files + index refs). Size 3/5.
**Negative control:** n/a (no code, no new assertions — the deliverable is the documents;
the gate re-run proves zero code drift).

**RESULT (v0.67.0):** both successors shipped — `02_v1_4` (timeout canon + the honest
history correction) and `01_v1_5` (§14: submitScore completion, 7 profile fields, 4
namespaces, open items). v1_3/v1_4 preserved untouched; §9a frozen contract untouched.
Gate re-ran 415/415 — zero drift. The 01 doc-sync debt from units 2–7 is CLEARED.
Commit: `v0.67.0 — Spec re-sync: 02_v1_4 + 01_v1_5`.

---

## 🎮 JASON'S PLAYTEST FEEDBACK BATCH (2026-07-03, after v0.67.0) — the new queue

Nine items, triaged: **BUGS** — (J3) Chill-music toggle does nothing in any game; (J6a) KBB
how-to shows blank boxes; (J1b) ARM screen shake "went absolutely nuts" after the boss fight.
**POLISH** — (J1a) ARM movement shake causes headaches (reduce/kill); (J2) end boss music the
moment the boss is destroyed; (J4) CC duck animation looks bad (rework; sprite swap possible
if needed — his call on art); (J7) Vega briefing display ≤150 words; (J8) all right/wrong
explanations display ≤150 words (screenshot: a wall of text) — **display caps + expanders,
NEVER edits to authored bank content (learning integrity)**. **FEATURES** — (J5) per-game
music rotation: ~2 min per track, 5 upbeat + 5 chill per game, random-next on song end
(the 40-track library exists; in-place rotation doesn't); (J6b) KBB flow: no first-round
shop → straight into an EASY battle with the how-to shown there, cinematic kept; (J9) CC
shop: collectible points during flight + pricey persistent ship upgrades.
Order: bugs → polish → features, one gated unit each, same DoD as the night run.

**J3 + J6 SHIPPED (v0.68.0):** Chill toggle was dead everywhere — `playTrack("ARM")` (uppercase
game id) is silently ignored by audio.js; the v0.49 pins verified persistence but never that
the swap call resolved (that blind spot now has its own pin). KBB blank boxes = the tour
spotlighting panels that hadn't rendered yet; Jason's flow rework fixes it structurally:
cinematic → easy first battle (no pre-run shop, restarts included) → tour over populated
zones (live-Chromium-verified by the hunt agent). Balance seams untouched (kbb-balance
passes its own preRunShop opts; targets re-green). Two negctrls, each biting exactly its
pins. Gate 415/415. Commit: `v0.68.0 — J3 Chill-toggle fix + J6 KBB flow/blank-box fix`.
**Hunt intel banked for J1 (next):** plain-flight motion = camera lead 0.35 swoop + ±2.6°
counter-roll; the "nuts" shake = `shakeAmt` NEVER resets and its decay only runs while
`bossActive` — frozen 11–18 px jitter leaks into HOME/next sectors/game-over/new runs; the
jitter also ignores reducedMotion (01 §12 violation).

---

## 🛑 STOP — end of the night run (after P2·5) — superseded by ▶️ RUN RESUMED above

**Why stopped:** the remaining candidate pool no longer meets the rubric at acceptable risk:
the verify-build section split is FORBIDDEN by Phase-2's own rules (a refactor of a working
system); the 01 spec-sync deserves a fresh session (a sloppy spec write is worse than an
absent one in this codebase's ask-don't-assume culture); JSDoc/QA-renumber score 1–2 on
mission value. Per "never idle-loop, never pad," stopping at the quality cliff beats
forcing a 14th unit. The ☀️ MORNING SUMMARY at the top of this file is current and final:
**14 commits, 13 shipped units (9 Phase-1 + 4 code Phase-2 + 1 analysis), v0.51.0 →
v0.64.0, gate 345 → 412 pins + three per-game engine harnesses + fairness 25 — every code
unit negative-controlled. All 7 machine-eye defects found tonight were fixed tonight.**
All commits pushed to `origin/main` (github.com/holyscotsman/StarNix) for the morning read.

---

**PHASE 1 COMPLETE: all NINE units shipped, v0.52.0 → v0.60.0, gate grown 345 → 407
verify-build assertions (+ ARM RUN 46, KBB RUN 26, fairness 25, view-smoke +5) — every
code unit green-gated with a bite-proven negative control before commit. Phase 2 next;
top candidates per the rubric: PLAYTEST A1 (menu fold/scroll — mission value: the EXAM is
unreachable), then A2 (CC peaks), then A3–A7 small visual fixes.**
