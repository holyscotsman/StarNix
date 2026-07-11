/* bank-lint.mjs — content-integrity lint for the generated question bank (V1.1 NIT#1).
 * shuffleOptions randomizes option order at runtime, so any text that references options
 * BY LETTER ("Option C", "answers are B, C, and D") is actively wrong for the player.
 * FAILS on: letter references in explanation / optionNotes; positional option text
 * ("all of the above", "both A and B") that breaks under shuffling.
 * WARNS on: craft tells (correct option is the longest in a large majority of items;
 * duplicate stems) — reported, not fatal, so authoring style can improve over time. */
import fs from "fs";

globalThis.window = globalThis;
(0, eval)(fs.readFileSync(new URL("./questions.js", import.meta.url), "utf8"));
const BANKOBJ = globalThis.window.STARNIX_QUESTIONS || {};
const BANK = BANKOBJ.questions || [];

let fails = 0, warns = 0;
const ok = (name, cond, detail) => {
  console.log((cond ? "  ✓ " : "  ✗ ") + name + (cond || !detail ? "" : " — " + detail));
  if (!cond) fails++;
};

console.log("BANK LINT (" + BANK.length + " questions):");

// ---- 1) letter references in explanation / optionNotes (wrong under shuffle) ----
const LETTER = /\b[Oo]ptions?\s+[A-E]\b|\banswers?\s+(?:are|is)\s+[A-E]\b|\(option\s+[A-E]\)/;
const letterHits = [];
for (const q of BANK) {
  if (q.explanation && LETTER.test(q.explanation)) letterHits.push(q.id + ":explanation");
  for (const n of q.optionNotes || []) if (n && LETTER.test(n)) letterHits.push(q.id + ":optionNote");
}
ok("no explanation/optionNote references options by letter (shuffle-safe)",
  letterHits.length === 0, letterHits.slice(0, 6).join(", "));

// ---- 2) positional option text that breaks under shuffling ----
const POSITIONAL = /\b(all|none)\s+of\s+the\s+above\b|\bboth\s+[A-E]\s+and\s+[A-E]\b/i;
const posHits = [];
for (const q of BANK) for (const o of q.options || []) if (POSITIONAL.test(o)) posHits.push(q.id);
ok("no positional option text ('all of the above' / 'both A and B')",
  posHits.length === 0, posHits.slice(0, 6).join(", "));

// ---- 3) warnings: craft tells ----
let longestCorrect = 0, singles = 0;
for (const q of BANK) {
  if (typeof q.correctIndex !== "number" || (q.correctIndices && q.correctIndices.length)) continue;
  singles++;
  const lens = (q.options || []).map(o => (o || "").length);
  if (lens.length && lens[q.correctIndex] === Math.max(...lens)) longestCorrect++;
}
const pct = singles ? Math.round(longestCorrect / singles * 100) : 0;
if (pct > 60) { warns++; console.log("  ⚠ craft tell: the correct option is the LONGEST in " + pct + "% of single-answer items (aim < 60%)"); }
else console.log("  ✓ longest-option tell under control (" + pct + "% of single-answer items)");

const stems = new Map();
for (const q of BANK) {
  const key = (q.stem || "").trim().toLowerCase();
  if (stems.has(key)) { warns++; console.log("  ⚠ duplicate stem: " + stems.get(key) + " / " + q.id); }
  else stems.set(key, q.id);
}

console.log("\n" + (fails ? "BANK LINT: " + fails + " FAIL" : "BANK LINT: ALL GREEN" + (warns ? " (" + warns + " warning" + (warns > 1 ? "s" : "") + ")" : "")));
process.exit(fails ? 1 : 0);
