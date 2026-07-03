# NIGHT_LOG — autonomous session, started 2026-07-03

Morning report per `NIGHT_RUN.md` v2. One entry per unit (version, unit, what shipped,
assertion delta, negative-control result, punts). Blockers logged here, not asked.

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

**PHASE 1 COMPLETE: all NINE units shipped, v0.52.0 → v0.60.0, gate grown 345 → 407
verify-build assertions (+ ARM RUN 46, KBB RUN 26, fairness 25, view-smoke +5) — every
code unit green-gated with a bite-proven negative control before commit. Phase 2 next;
top candidates per the rubric: PLAYTEST A1 (menu fold/scroll — mission value: the EXAM is
unreachable), then A2 (CC peaks), then A3–A7 small visual fixes.**
