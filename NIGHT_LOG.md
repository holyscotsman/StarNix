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
