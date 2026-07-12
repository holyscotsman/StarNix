/* import-questions.mjs — 06 ingestion importer (v2: consolidated 235-question bank).
 * starnix_questions.md -> questions.js (window.STARNIX_QUESTIONS), with integrity HOLDS.
 *
 * New-format constructs: <!-- aXqY [corrected] --> id-comments (join key), multi-line
 * stems, indented per-option explanation lines (-> optionNotes), @image exhibit keys,
 * @multi, @explain (overall). Per the integrity rule a question is HELD (not shipped)
 * when: its key is unverified (review_notes.md), an exhibit image is not yet present,
 * or the block fails schema validation. The live set is always strictly valid — the
 * core falls back to its built-in fixture if the pack is invalid.
 *
 *   node import-questions.mjs
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";

const DOMAINS = ["architecture","storage","networking","security","vms","data-protection","lifecycle","monitoring","performance"];
const CERT = "NCP-MCI";
const SRC = "starnix_questions.md";

// review_notes.md: kept with the SOURCE key but UNVERIFIED — hold until Jason confirms/drops.
const REVIEW_HOLD = {
  a1q13: "key-unverified: Metro+Witness, medium confidence, portal table gated (review_notes.md)",
  a1q27: "key-unverified: App-Discovery prereqs not verifiable from open sources (review_notes.md)",
  a3q7:  "key-unverified: CAC failure reads as two valid answers, CRL vs OCSP (review_notes.md)",
  // (v0.143.0, NIT#2) the old hold reason ("empty explanation") was a parser artifact — the real
  // problem is CONTENT: the option-2 note praises the wrong option with the stem's exact success
  // criteria ("provides the highest resiliency and lowest RPO" ... marked Incorrect). Jason's call.
  // (v0.174.0) Jason's ruling 2026-07-12: "stick with what the question and answer state" —
  // authored keys are final; internal-tension findings are notes for him, not grounds to hold.
  // e1-q14 / e1-q25 / e1-q52 released accordingly. a1q52 stays held ONLY as the superseded twin.
  a1q52: "superseded by ncp-mci-e1-q52 (Jason's ruling 2026-07-12: content stands as stated; the canonical e1 version is live)",
};

function normStem(s){ return String(s||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim(); }

// (v0.173.0, Jason) the CANONICAL INTERCHANGE format (banks/*.md, e.g. ncp-mci-e1.md):
// "### <id>" block headers, "  > " per-option explanations, @overall as the explanation,
// @image with a file extension, @image-alt, @tags/@briefing, and @priority where
// "omit = 0 (normal), higher = served sooner" (N >= 1 maps to draw weight N+1).
function parseInterchange(md){
  const out = [];
  const parts = md.split(/^### ([a-z0-9][a-z0-9-]*)$/m);   // [pre, id, body, ...]
  for (let i = 1; i < parts.length; i += 2) {
    const srcId = parts[i].trim();
    const body = (parts[i+1] || "").split(/^---$/m)[0];    // a block ends at its --- separator
    const stemLines=[], opts=[], optNotes=[], meta={}; let correct=[], curOpt=-1;
    for (const raw of body.split("\n")) {
      const line = raw.replace(/\s+$/, "");
      const opt = line.match(/^\s*-\s*\(([ xX])\)\s*(.+)$/);
      const kv = line.match(/^@([a-zA-Z0-9-]+):\s*(.*)$/);
      const note = line.match(/^\s{2,}>\s?(.*)$/);
      if (opt) { if (opt[1].toLowerCase() === "x") correct.push(opts.length); opts.push(opt[2].trim()); optNotes.push(""); curOpt = opts.length - 1; }
      else if (kv) { meta[kv[1].toLowerCase()] = kv[2].trim(); curOpt = -1; }
      else if (note && curOpt >= 0) { optNotes[curOpt] = (optNotes[curOpt] ? optNotes[curOpt] + " " : "") + note[1].trim(); }
      else if (line.trim() && opts.length === 0) { stemLines.push(line.trim()); }
    }
    if (!opts.length) continue;                            // prose sections carry no options
    if (meta.overall && !meta.explain) meta.explain = meta.overall;
    if (meta.image) meta.image = meta.image.replace(/\.(png|jpe?g|gif|webp|svg)$/i, "");
    if (meta["image-alt"]) meta.imagealt = meta["image-alt"];
    if (meta.priority && /^\d+$/.test(meta.priority)) { const pN = parseInt(meta.priority, 10); meta.priority = pN >= 1 ? String(pN + 1) : ""; }
    out.push({ srcId, corrected: false, stem: stemLines.join(" ").trim(), opts, optNotes, correct, meta });
  }
  return out;
}
function hash4(s){ let h=5381; const n=normStem(s); for(let i=0;i<n.length;i++) h=((h<<5)+h+n.charCodeAt(i))>>>0; return h.toString(36).padStart(4,"0").slice(-4); }

// ---- parse: split on the id-comment, then read each block ----------------------
function parse(md){
  const parts = md.split(/^<!--\s*(a\d+q\d+)(\s+corrected)?\s*-->\s*$/m); // [pre, id, corr, body, ...]
  const out = [];
  for (let i=1; i<parts.length; i+=3){
    const srcId = parts[i].trim();
    const corrected = !!parts[i+1];
    const body = parts[i+2] || "";
    const stemLines=[], opts=[], optNotes=[], meta={}; let correct=[], curOpt=-1;
    for (const raw of body.split("\n")){
      const line = raw.replace(/<!--.*?-->/g,"").replace(/\s+$/,"");
      if (/^###\s+Q\s*$/.test(line)) continue;
      const opt = line.match(/^\s*-\s*\(([ xX])\)\s*(.+)$/);
      const kv  = line.match(/^\s*@([a-zA-Z0-9]+):\s*(.*)$/);
      const indented = /^\s{2,}\S/.test(raw);
      if (opt){
        if (opt[1].toLowerCase()==="x") correct.push(opts.length);
        opts.push(opt[2].trim()); optNotes.push(""); curOpt = opts.length-1;
      } else if (kv){
        meta[kv[1].toLowerCase()] = kv[2].trim(); curOpt = -1;
      } else if (indented && curOpt>=0){
        optNotes[curOpt] = (optNotes[curOpt] ? optNotes[curOpt]+" " : "") + line.trim();
      } else if (line.trim() && opts.length===0){
        stemLines.push(line.trim());
      }
    }
    out.push({ srcId, corrected, stem: stemLines.join(" ").trim(), opts, optNotes, correct, meta });
  }
  return out;
}

function toQuestion(p){
  const m = p.meta, domain = m.domain;
  const q = {
    id: "mci-"+(domain||"x")+"-"+hash4(p.stem),
    cert: CERT, domain,
    difficulty: m.difficulty ? (parseInt(m.difficulty,10)||2) : 2,
    stem: p.stem, options: p.opts,
    explanation: m.explain || "",
  };
  if (p.correct.length > 1) q.correctIndices = p.correct.slice();
  else q.correctIndex = (p.correct.length===1 ? p.correct[0] : -1);
  if (p.optNotes.some(n=>n && n.trim())) q.optionNotes = p.optNotes.map(n=>n.trim());
  if (m.image) q.image = m.image.trim();
  if (m.imagealt) q.imageAlt = m.imagealt;   // (v0.173.0, Jason) exhibit alt text (SR + FE#5)
  if (m.priority) { var pv = m.priority.trim() === "high" ? 2 : (parseInt(m.priority, 10) || 0); if (pv > 1) q.priority = pv; }   // (v0.172.0, Jason) draw-weight boost
  if (m.tags) q.tags = m.tags.split(",").map(t=>t.trim()).filter(Boolean);
  if (m.briefing) q.briefing = m.briefing;
  if (m.eli5) q.deepExplain = m.eli5;
  if (p.corrected) q.corrected = true;
  q._src = p.srcId; q._image = !!m.image;
  return q;
}

// ---- pure per-question schema check (no relational) ---------------------------
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
function schemaErrs(q){
  const e = [];
  if (!q.id || !SLUG.test(q.id)) e.push("id !slug");
  if (DOMAINS.indexOf(q.domain) < 0) e.push("domain invalid("+q.domain+")");
  if ([1,2,3].indexOf(q.difficulty) < 0) e.push("difficulty !1-3");
  if (!q.stem) e.push("empty stem");
  if (!Array.isArray(q.options) || q.options.length<3 || q.options.length>5) e.push("options !3-5("+(q.options?q.options.length:0)+")");
  if (Array.isArray(q.correctIndices)){
    if (q.correctIndices.length<2) e.push("correctIndices<2");
    for (const ci of q.correctIndices) if (typeof ci!=="number"||ci<0||ci>=q.options.length) e.push("ci oob");
    if (new Set(q.correctIndices).size !== q.correctIndices.length) e.push("ci dupes");
  } else if (typeof q.correctIndex!=="number"||q.correctIndex<0||q.correctIndex>=q.options.length){
    e.push("correctIndex bad/none");
  }
  if (!q.explanation || !q.explanation.trim()) e.push("empty explanation");
  return e;
}

// ---- run ----------------------------------------------------------------------
// (v0.143.0, V1.1 NIT#2) normalize invisible Unicode line/paragraph separators to spaces.
// Four authored @explain blocks carried U+2028 from a paste; the line-based parser read them
// as "empty explanation" and silently killed the questions. Never again.
const INTERCHANGE_BANKS = ["banks/ncp-mci-e1.md"];   // (v0.173.0, Jason) *-review.md files are QUARANTINE — never listed here   // (v0.173.0, Jason) *-review.md files are QUARANTINE — never listed here
// Interchange banks parse FIRST: on a stem collision the richer canonical version (notes,
// briefing, tags, image-alt) supersedes the classic pack's copy, which then holds as the dup.
const parsed = [
  ...INTERCHANGE_BANKS.flatMap((b) => parseInterchange(readFileSync(new URL("./"+b, import.meta.url), "utf8").replace(/[\u2028\u2029]+/g, " "))),
  ...parse(readFileSync(new URL("./"+SRC, import.meta.url), "utf8").replace(/[\u2028\u2029]+/g, " ")),
];
const all = parsed.map(toQuestion);

// exhibit images actually present on disk (keyed by filename stem, any extension).
// A question with @image ships ONLY when its file is present; otherwise it is held.
const EXHIBIT_PRESENT = {};
try {
  for (const f of readdirSync(new URL("./exhibit-images/", import.meta.url))) {
    EXHIBIT_PRESENT[f.replace(/\.[^.]+$/, "")] = f;
  }
} catch (e) { /* dir absent -> all @image questions held */ }

const held = [];                 // {src, stem, reason}
const live = [];
const seenId = {}, seenStem = {};

for (const q of all){
  if (REVIEW_HOLD[q._src]) { held.push({src:q._src, stem:q.stem.slice(0,64), reason: REVIEW_HOLD[q._src]}); continue; }
  if (q._image && !EXHIBIT_PRESENT[q.image]) { held.push({src:q._src, stem:q.stem.slice(0,64), reason: "exhibit-image-pending: exhibit-images/"+q.image+".* not provided"}); continue; }
  const se = schemaErrs(q);
  if (se.length)           { held.push({src:q._src, stem:q.stem.slice(0,64), reason: "schema: "+se.join("; ")}); continue; }
  // relational: unique id (suffix on hash collision), unique normalized stem
  let id = q.id, n = 1; while (seenId[id]) { n++; id = q.id+"-"+n; }
  const ns = normStem(q.stem);
  if (ns && seenStem[ns]) { held.push({src:q._src, stem:q.stem.slice(0,64), reason: "dup-stem (also "+seenStem[ns]+")"}); continue; }
  q.id = id; seenId[id] = 1; if (ns) seenStem[ns] = q._src;
  live.push(q);
}

const liveOut = live.map(q => { const {_src,_image,...rest} = q; return rest; });

const byDomain = {}, byDiff = {1:0,2:0,3:0};
liveOut.forEach(q => { byDomain[q.domain]=(byDomain[q.domain]||0)+1; byDiff[q.difficulty]=(byDiff[q.difficulty]||0)+1; });

const pack = { id: CERT, name: "Nutanix Certified Professional — Multicloud Infrastructure", domains: DOMAINS, questions: liveOut };
const banner = "/* questions.js — GENERATED by import-questions.mjs from "+SRC+". Do not edit by hand.\n"+
  " * Canonical NCP-MCI bank (window.STARNIX_QUESTIONS). The core merges these with\n"+
  " * its verified built-in fixture and re-validates at load. */\n";
// (v0.137.0, V1.1 Backend#2) --check mode: regenerate in memory and compare against the
// shipped questions.js — editing starnix_questions.md without `npm run bank` fails the gate.
const OUT_TEXT = banner + "window.STARNIX_QUESTIONS = " + JSON.stringify(pack) + ";\n";   // (v0.166.0, V1.1 Backend#6) compact: the pretty-print cost ~40% (the side-report stays readable)
const CHECK = process.argv.includes("--check");
if (CHECK) {
  let onDisk = "";
  try { onDisk = readFileSync(new URL("./questions.js", import.meta.url), "utf8"); } catch (e) {}
  if (onDisk === OUT_TEXT) { console.log("BANK FRESHNESS: questions.js matches the source (ALL GREEN)"); }
  else { console.log("BANK FRESHNESS: STALE — starnix_questions.md changed but questions.js was not regenerated. Run: npm run bank"); process.exit(1); }
} else {
  writeFileSync(new URL("./questions.js", import.meta.url), OUT_TEXT);
}

const heldByReason = {};
held.forEach(h => { const k = h.reason.split(":")[0]; (heldByReason[k]=heldByReason[k]||[]).push(h.src); });
const report = {
  parsed: all.length, live: liveOut.length, held: held.length,
  multiLive: liveOut.filter(q=>Array.isArray(q.correctIndices)).length,
  withOptionNotes: liveOut.filter(q=>q.optionNotes).length,
  byDomain, byDifficulty: byDiff,
  heldSummary: Object.fromEntries(Object.entries(heldByReason).map(([k,v])=>[k, v.length])),
  heldItems: held,
};
if (!CHECK) writeFileSync(new URL("./questions.side-report.json", import.meta.url), JSON.stringify(report, null, 2));

const liveErrs = [];
{ const sid={}, sst={}; for (const q of liveOut){ const w=q.id;
  if (sid[q.id]) liveErrs.push(w+": dup id"); sid[q.id]=1;
  const ns=normStem(q.stem); if (ns&&sst[ns]) liveErrs.push(w+": dup stem"); else if(ns) sst[ns]=q.id;
  for (const x of schemaErrs(q)) liveErrs.push(w+": "+x);
} }

console.log("parsed "+all.length+" | live "+liveOut.length+" | held "+held.length);
console.log("by domain:", JSON.stringify(byDomain));
console.log("by difficulty:", JSON.stringify(byDiff), "| multi(live):", report.multiLive, "| optionNotes:", report.withOptionNotes);
console.log("held:", JSON.stringify(report.heldSummary));
console.log(liveErrs.length ? ("VALIDATION: "+liveErrs.length+" ERROR(S)\n"+liveErrs.slice(0,20).join("\n")) : "VALIDATION: ALL GREEN");
process.exit(liveErrs.length ? 1 : 0);
