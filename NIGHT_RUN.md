# NIGHT_RUN — autonomous session contract (v2)

You are running unattended. Work Phase 1 in order, then Phase 2's loop, until usage runs out.
Jason reviews commits in the morning. `NIGHT_LOG.md` is the morning report — keep it current.

## Operating rules (non-negotiable)

1. **Definition of done, per unit:** code → `npm run check` ALL GREEN → a **negative control**
   (break the new behavior, confirm exactly the new assertions fail, restore, re-run green) →
   bump `BUILD_VERSION` in `starnix-core.js` → CHANGELOG entry (single long-line bullets,
   prepended above the previous `## [x.y.z]` anchor) → append any new visual/audio surface to
   `BROWSER_QA.md` (you cannot hear, and can only partially see; it stays human-gated) →
   update the `STATE.md` headline (demote the old one) → `git commit` (message:
   `vX.Y.Z — <unit>`, **no co-author tag**). One commit per unit; never leave the tree dirty.
2. **Never weaken the gate.** Do not delete, loosen, skip, or rewrite existing assertions,
   fairness rules, or balance targets to get green. If a unit resists after honest attempts:
   `git checkout .` to the last commit, log the blocker in `NIGHT_LOG.md`, move on.
3. **Learning integrity:** never author, edit, or invent question content, answer keys,
   explanations, or exhibits. Nothing below requires new bank content. `AIAdapter` stays no-op.
4. All gameplay randomness via `ctx.rng` (seeded/forkable). No `Math.random` in gameplay paths.
5. The module contract (01) is frozen: additive changes only; full cleanup in `unmount()`;
   no allocation in update/draw loops; reduced-motion + keyboard/touch on every new surface.
6. Keep units bounded — ship the smallest coherent green slice, log the remainder.
7. Per unit, append to `NIGHT_LOG.md`: version, unit, what shipped, assertion delta,
   negative-control result, anything punted.
8. **No new dependencies** except where a unit explicitly grants one (unit 9 does).

## Phase 1 — the queue (in order)

### 1. ARM engine harness (`arm-headless.cjs` + `arm-run.cjs`)
Mirror the KBB pair (see `kbb-headless.cjs`/`kbb-run.cjs` for the mock-ctx contract, incl. the
`{question, reason}` provider shape and Promise persistence). Cover: mount → briefing → live
sector; grading right/wrong; damage → `gameOver` (use `_test.forceTimeout` to pin
death-by-timeout landing on the GAME OVER panel — closes QA-A5's structural half);
pause/`gnow()` freeze; unmount cleanliness. ≥15 assertions, wired into `npm run check`, negctrl.
This is the safety net for every later ARM touch — it goes first.

### 2. Commander rank — cross-game XP meta-progression
One XP pool fed by existing events (game scores, exam completions, mastery gains — read the
seams, don't invent new ones). ~10 NX-SRC-themed ranks, pinned thresholds. Persist
`profile.xp`; rank + progress on the menu; a rank-up moment (shell toast; reduced-motion
static). Deterministic XP math unit-tested; menu DOM pin; rank-up pin.

### 3. Achievements (~12, cross-game)
Flawless KBB battle, CC gate-chain streak, ARM full-collection escape, exam sim ≥80%,
all-domain coverage, etc. Unlock predicates as pure functions (unit-tested); toast on unlock;
achievements panel on the Progress screen; persisted; awards XP into unit 2's pool.

### 4. KBB artifact batch (+6)
New artifacts on the existing `fireSide`/hook seams (study `kbb.js` artifact defs + shop).
Constraint: `KBB_ASSERT=1 kbb-balance` targets stay green **unchanged** — tune the artifacts,
never the targets. Each artifact gets a targeted engine test in `kbb-run.cjs`.

### 5. CC: one new telegraphed hazard
A sweeping/alternating obstacle distinct from wall/arch/narrowing. Hard requirement: extend
`cc-fairness-check.mjs` with solvability rules for it and keep fairness ALL GREEN;
chevron-grade telegraphing; reduced-motion variant; cc-view-smoke pins.

### 6. Daily missions (3/day, date-seeded)
Deterministic via `ctx.rng.fork(dateString)`. Progress from existing telemetry; claiming
grants XP (unit 2). Menu card + Progress-screen row. Determinism pin (same date → same
missions), progress + claim DOM pins.

### 7. Mastery-gated cosmetics
Ship trail/tint variants (pure vector color — **no new assets**) unlocked per domain via
`questions.stats()` thresholds. Settings selection, persisted, applied in ARM/CC/KBB render
paths (jsdom-guarded). Unlock predicate + persistence pins.

### 8. Blitz combo multiplier
Streak multiplier + combo meter, **Blitz only** (Study/Sim untouched). Scoring math pins;
stored bests stay valid.

### 9. Playwright visual playtest (dependency exception granted)
`npm i -D playwright` + Chromium download is allowed for this unit only. Build
`visual-playtest.mjs`: launch headless Chromium on the built `index.html`, script to key
beats — menu, shell cinematic planet beat, ARM intro dive + flight, KBB cinematic beats +
battle + boss flag, CC establishing shot + wall/arch/gate approaches + Progress screen —
and save PNG screenshots to `playtest-shots/`. Then **review the screenshots yourself**
against 07 (palette, composition, readability, clipping, contrast) and the relevant
BROWSER_QA items; write ranked findings to `PLAYTEST.md` (objective defects vs taste calls,
clearly separated). Do not implement fixes inside this unit — findings feed Phase 2.
This does NOT replace Jason's pass: motion feel and all audio remain human-only.

## Phase 2 — self-directed loop (only after Phase 1)

Repeat until usage ends. Each iteration = one unit under the full definition of done.

**Candidate sources, in priority order:**
a. `PLAYTEST.md` findings that are objective and bounded (visual defects, tuning anomalies)
b. `BACKLOG.md`, `REVIEW_v0.41.0_opportunities.md`, and every spec's "Open decisions" /
   deferred items (00–08) — documented-but-deferred work beats invented work
c. The debt list below
d. Free brainstorm for "more of a game" — only after a–c are exhausted

**Rubric — score each candidate 1–5 on all four; build the top scorer:**
mission value (learning tool first, game second) → headless verifiability → blast radius
(prefer additive, few files) → size (prefer small).

**Forbidden regardless of score:** new question content or key edits; LLM/AI features;
hosting/GAS/infra changes; new runtime dependencies or assets; refactors of working systems;
anything whose verification would need ears or feel.

**Protocol per iteration:** write a mini-spec to `NIGHT_LOG.md` FIRST (what, why per rubric,
files touched, planned assertions + negative control) → build the smallest slice → full
definition of done → commit → next iteration.

**Standing repeatable unit (allowed any iteration):** re-run kbb-balance / cc-fairness in
report mode, analyze distributions (difficulty curve, dead artifacts, run-length medians,
pacing), and implement one tuning fix that keeps every locked target green; append the
analysis to `PLAYTEST.md`.

## Debt list
- `cc-run.cjs` engine harness parity
- Split `verify-build.mjs` into individually runnable sections (no assertion changes)
- JSDoc pass on `starnix-core.js` public seams
- `BROWSER_QA.md`: fold v0.50–0.51 additions into the numbered sections

## Stop conditions
Usage exhausted, or Phase 2 yields no candidate meeting the rubric. On stop: final
`NIGHT_LOG.md` entry summarizing the night (units shipped, versions, blockers, the top 3
things Jason should look at first). Never idle-loop, never pad.
