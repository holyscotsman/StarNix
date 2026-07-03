/* scheduler-test.mjs — unit-tests the shared spaced-retrieval scheduler + mastery
 * (01 §3/§4). Exercises makeQuestionProvider + makeMasteryStore directly under a
 * mocked clock and seeded RNG. No DOM. Proves: Leitner bucket advance/decay,
 * review-due timing by interval, reason classification, determinism, exclusions,
 * difficulty band, and due-weighting. Run: node scheduler-test.mjs
 */
import fs from "fs";
globalThis.window = globalThis;
(0, eval)(fs.readFileSync(new URL("./starnix-core.js", import.meta.url), "utf8"));
const I = globalThis.StarNix._internal;
const { makeQuestionProvider, makeMasteryStore, makeRng, clock, constants, DOMAINS } = I;

let T = 1000000;
clock.now = () => T;            // shared clock object -> deterministic "time"

let fails = 0;
function ok(name, cond) { console.log((cond ? "  \u2713 " : "  \u2717 ") + name); if (!cond) fails++; }

function Q(id, domain, difficulty) { return { id: id, cert: "NCP-MCI", domain: domain, difficulty: difficulty, stem: id + " stem", options: ["a", "b", "c"], correctIndex: 0, explanation: "x" }; }
const pack = { id: "NCP-MCI", domains: DOMAINS, questions: [
  Q("s1", "storage", 1), Q("s2", "storage", 2), Q("s3", "storage", 3),
  Q("n1", "networking", 2), Q("n2", "networking", 2), Q("v1", "vms", 1)
] };
function fresh() {
  const profile = { mastery: {}, totals: { questionsSeen: 0, correct: 0, incorrect: 0 } };
  const m = makeMasteryStore(profile, {});
  return { m: m, p: makeQuestionProvider(pack, m) };
}

console.log("Scheduler / mastery:");

// 1. fresh question classifies as "new"
{ const f = fresh(); ok("fresh question -> reason 'new'", f.p.next({ game: "KBB", rng: makeRng(1) }).reason === "new"); }

// (v0.89.0, L4) answer a card only when it is DUE — the honest spaced-retrieval path
function recordDue(f, id, correct) {
  const m = f.m.get(id);
  if (m && m.seen) T += (constants.INTERVALS[Math.min(m.bucket, constants.INTERVALS.length - 1)] || 0) + 1000;
  f.m.record(id, correct, { game: "KBB" });
}

// 2. Leitner bucket advance on DUE correct, anti-cram gate, gentle decay on wrong
{ const f = fresh();
  recordDue(f, "s1", true); ok("correct -> bucket 1", f.m.get("s1").bucket === 1);
  recordDue(f, "s1", true); ok("DUE correct -> bucket 2 + streak 2", f.m.get("s1").bucket === 2 && f.m.get("s1").streak === 2);
  f.m.record("s1", true, { game: "KBB" });
  ok("L4 anti-cram: immediate re-answer does NOT promote (bucket stays 2, streak still counts)",
    f.m.get("s1").bucket === 2 && f.m.get("s1").streak === 3);
  f.m.record("s1", false, { game: "KBB" }); ok("wrong -> bucket 1 (decay) + streak reset, gate never blocks demotion", f.m.get("s1").bucket === 1 && f.m.get("s1").streak === 0);
}

// (v0.90.0, review) a non-due CORRECT answer must not restart the review interval —
// otherwise early re-answers defer promotion forever
{ const f = fresh();
  recordDue(f, "s1", true);                                   // bucket 1, lastSeen = T
  const t0 = T;
  T = t0 + 5000;                                              // 5s later — still inside the 30s interval
  f.m.record("s1", true, { game: "KBB" });                    // early re-answer (not due)
  ok("non-due correct keeps lastSeen (interval clock not reset)", f.m.get("s1").lastSeen === t0);
  T = t0 + constants.INTERVALS[1] + 1000;
  ok("card still comes due on the ORIGINAL schedule", f.m.dueList(T).indexOf("s1") >= 0);
  recordDue(f, "s1", true);
  ok("and then promotes normally when answered due", f.m.get("s1").bucket === 2);
}

// (v0.90.0, review) dueList serves earliest-due-first (true overdue order)
{ const f = fresh();
  f.m.record("s1", true, { game: "KBB" }); f.m.record("s2", true, { game: "KBB" });
  f.m.get("s1").lastSeen = T - 35000;                         // due 5s ago (30s interval)
  f.m.get("s2").lastSeen = T - 90000;                         // due 60s ago — more overdue
  const dl = f.m.dueList(T);
  ok("dueList orders by due-time ascending (most overdue first)", dl[0] === "s2" && dl[1] === "s1");
}

// (v0.89.0, L5) the extended ladder: 9 rungs, monotonic, 3d/7d on top; the cap holds
{ const f = fresh();
  ok("L5: ladder is 9 rungs (buckets 0-8), MAX_BUCKET 8",
    constants.INTERVALS.length === 9 && constants.MAX_BUCKET === 8);
  ok("L5: intervals strictly increase and top out at 3d / 7d",
    constants.INTERVALS.every((v, i) => i === 0 || v > constants.INTERVALS[i - 1])
    && constants.INTERVALS[7] === 3 * 24 * 60 * 60e3 && constants.INTERVALS[8] === 7 * 24 * 60 * 60e3);
  for (let k = 0; k <= constants.MAX_BUCKET + 2; k++) recordDue(f, "v1", true);
  ok("L5: due-answered card climbs to bucket 8 and holds at the cap", f.m.get("v1").bucket === constants.MAX_BUCKET);
}

// 3. review-due timing follows the per-bucket interval
{ const f = fresh(); const excl = ["s2", "s3", "n1", "n2", "v1"];
  f.m.record("s1", true, { game: "KBB" });                 // bucket 1, lastSeen=T, interval[1]
  ok("seen but interval not elapsed -> 'reinforce'", f.p.next({ game: "KBB", excludeIds: excl, rng: makeRng(2) }).reason === "reinforce");
  T += constants.INTERVALS[1] + 1000;                       // advance past interval
  ok("interval elapsed -> 'review-due'", f.p.next({ game: "KBB", excludeIds: excl, rng: makeRng(2) }).reason === "review-due");
  T -= constants.INTERVALS[1] + 1000;
}

// 4. deterministic under the same seed + same state
{ const a = fresh(), b = fresh(), sa = [], sb = [];
  for (let i = 0; i < 12; i++) sa.push(a.p.next({ game: "KBB", rng: makeRng(7) }).question.id);
  for (let i = 0; i < 12; i++) sb.push(b.p.next({ game: "KBB", rng: makeRng(7) }).question.id);
  ok("same seed -> identical draw sequence", JSON.stringify(sa) === JSON.stringify(sb));
}

// 5. exclusions respected (leave only n2)
{ const f = fresh(); const excl = ["s1", "s2", "s3", "n1", "v1"]; let allN2 = true;
  for (let i = 0; i < 25; i++) if (f.p.next({ game: "KBB", excludeIds: excl, rng: makeRng(i) }).question.id !== "n2") allN2 = false;
  ok("excludeIds respected", allN2);
}

// 6. difficulty band respected
{ const f = fresh(); let inBand = true;
  for (let i = 0; i < 30; i++) if (f.p.next({ game: "KBB", difficultyBand: [1, 1], rng: makeRng(i) }).question.difficulty !== 1) inBand = false;
  ok("difficultyBand [1,1] -> only difficulty-1 questions", inBand);
}

// 7. due is weighted well above uniform
{ const f = fresh();
  for (const id of ["s1", "s2", "s3", "n1", "n2", "v1"]) f.m.record(id, true, { game: "KBB" });
  for (let k = 0; k < 5; k++) for (const id of ["s2", "s3", "n1", "n2", "v1"]) recordDue(f, id, true); // bucket 6, recently reviewed
  f.m.record("s1", false, { game: "KBB" });                  // bucket 0
  f.m.get("s1").lastSeen = T - 10 * 60 * 60 * 1000;          // stale -> due
  let dueHits = 0; const N = 400;
  for (let i = 0; i < N; i++) if (f.p.next({ game: "KBB", rng: makeRng(i) }).question.id === "s1") dueHits++;
  ok("due item selected far above uniform share (" + dueHits + "/" + N + " vs ~67)", dueHits > N / 3);
}

// 8. summary() aggregates mastered count
{ const f = fresh();
  for (let k = 0; k < constants.MASTERED_BUCKET; k++) recordDue(f, "s1", true);
  ok("summary().masteredCount counts bucket>=threshold", f.m.summary().masteredCount === 1);
}

console.log("\n" + (fails ? ("SCHEDULER TEST: " + fails + " FAIL") : "SCHEDULER TEST: ALL GREEN"));
process.exit(fails ? 1 : 0);
