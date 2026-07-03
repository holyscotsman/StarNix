/* shuffle-test.mjs — unit-tests answer-order shuffling. Learning integrity: repeat runs must
 * not be solvable by memorising answer POSITION, so options are reordered while option TEXT and
 * grading correctness are preserved. Exercises shuffleQuestionOptions + provider.next({shuffle:true})
 * directly under a seeded RNG. No DOM. Run: node shuffle-test.mjs
 */
import fs from "fs";
globalThis.window = globalThis;
(0, eval)(fs.readFileSync(new URL("./starnix-core.js", import.meta.url), "utf8"));
const I = globalThis.StarNix._internal;
const { shuffleQuestionOptions, makeRng, makeQuestionProvider, makeMasteryStore, DOMAINS } = I;

let fails = 0;
function ok(name, cond) { console.log((cond ? "  \u2713 " : "  \u2717 ") + name); if (!cond) fails++; }
function setOf(arr) { return JSON.stringify(arr.slice().sort()); }

const single = { id: "q1", cert: "NCP-MCI", domain: "storage", difficulty: 1,
  stem: "s", options: ["A", "B", "C", "D"], correctIndex: 2, explanation: "x" };   // correct = "C"
const multi = { id: "q2", cert: "NCP-MCI", domain: "vms", difficulty: 2,
  stem: "m", options: ["W", "X", "Y", "Z"], correctIndices: [0, 3], explanation: "x" }; // correct = {W,Z}

console.log("Answer-order shuffle:");

{ // single-answer: permutation + correct text preserved + no mutation
  const s = shuffleQuestionOptions(single, makeRng(123));
  ok("single: options are a permutation (same texts)", setOf(s.options) === setOf(single.options));
  ok("single: correctIndex still points to the original correct text ('C')", s.options[s.correctIndex] === "C");
  ok("single: original bank object not mutated", single.options[single.correctIndex] === "C" && single.correctIndex === 2);
}

{ // multi-answer: set preserved + sorted + no mutation
  const s = shuffleQuestionOptions(multi, makeRng(7));
  ok("multi: options are a permutation", setOf(s.options) === setOf(multi.options));
  ok("multi: correctIndices length preserved (2)", Array.isArray(s.correctIndices) && s.correctIndices.length === 2);
  ok("multi: correct SET preserved ({W,Z})", setOf(s.correctIndices.map(i => s.options[i])) === setOf(["W", "Z"]));
  ok("multi: correctIndices sorted ascending", s.correctIndices[0] < s.correctIndices[1]);
  ok("multi: original not mutated", setOf(multi.correctIndices.map(i => multi.options[i])) === setOf(["W", "Z"]));
}

{ // deterministic given (question, seed)
  const a = shuffleQuestionOptions(single, makeRng(42));
  const b = shuffleQuestionOptions(single, makeRng(42));
  ok("deterministic: same seed -> identical order", JSON.stringify(a.options) === JSON.stringify(b.options) && a.correctIndex === b.correctIndex);
}

{ // different seeds vary the order
  const orders = new Set();
  for (let seed = 0; seed < 12; seed++) orders.add(shuffleQuestionOptions(single, makeRng(seed)).options.join(""));
  ok("variability: multiple seeds produce >1 distinct order", orders.size > 1);
}

{ // edge: <2 options passes through unchanged (same reference)
  const one = { id: "q3", options: ["only"], correctIndex: 0 };
  ok("edge: single-option question passes through unchanged", shuffleQuestionOptions(one, makeRng(1)) === one);
}

{ // via provider.next: opt-in only; correctness preserved; off by default
  const pack = { id: "NCP-MCI", domains: DOMAINS, questions: [single] };
  const m = makeMasteryStore({ mastery: {}, totals: { questionsSeen: 0, correct: 0, incorrect: 0 } }, {});
  const p = makeQuestionProvider(pack, m);
  const shuf = p.next({ rng: makeRng(5), shuffle: true });
  ok("next({shuffle:true}): correctIndex still points to 'C'", shuf.question.options[shuf.question.correctIndex] === "C");
  const plain = p.next({ rng: makeRng(5) });
  ok("next() without shuffle: original order preserved", JSON.stringify(plain.question.options) === JSON.stringify(single.options) && plain.question.correctIndex === 2);
}

{ // (v0.88.0, L3) optionNotes ride the SAME permutation as options (they shipped misaligned)
  const noted = { id: "qn", options: ["A", "B", "C", "D"], correctIndex: 2,
    optionNotes: ["note-A", "note-B", "note-C", "note-D"] };
  let aligned = true, moved = false;
  for (let seed = 0; seed < 10; seed++) {
    const out = shuffleQuestionOptions(noted, makeRng(seed));
    for (let i = 0; i < out.options.length; i++) {
      if (out.optionNotes[i] !== "note-" + out.options[i]) aligned = false;
      if (out.options[i] !== noted.options[i]) moved = true;
    }
  }
  ok("optionNotes stay aligned to their options across 10 shuffles", aligned && moved);
}

{ // (v0.90.0, review) length-mismatched notes are DROPPED, never shipped misaligned
  const sparse = { id: "qs", options: ["A", "B", "C", "D"], correctIndex: 0, optionNotes: ["only", "three", "notes"] };
  const out = shuffleQuestionOptions(sparse, makeRng(3));
  ok("mismatched-length optionNotes dropped from the shuffled copy", out.optionNotes === undefined);
}

console.log(fails === 0 ? "\nSHUFFLE TEST: ALL GREEN" : "\nSHUFFLE TEST: " + fails + " FAILED");
process.exit(fails === 0 ? 0 : 1);
