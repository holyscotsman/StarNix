/* Assemble the single-file StarNix build (index.html) for Google Apps Script.
 * Order matters:
 *   1. core   — defines StarNix, registerGame/registerAudio, initCore, makeContext, NoopAudio
 *   2. shell  — boot/title/cinematic/menu, strict mount/unmount
 *   3. audio  — installs StarNix.core.audio (real Web-Audio engine, 5 tracks)
 *   4. arm    — registers ARM
 *   5. cc     — registers CC (reads window.THREE; graceful fallback if absent)
 *   6. kbb    — registers KBB (Kuiper Belt Battle)
 *   7. boot   — StarNix.boot(#app)
 * Three.js (UMD global) is VENDORED (vendor/three-r128.min.js) and inlined — zero runtime
 * CDN dependencies (v0.158.0, V1.1 Backend#5). Montserrat ships as an inlined variable-font
 * subset (vendor/montserrat.css). Both are sha256-pinned: a drifted vendor file FAILS the build.
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";

const THREE_SHA = "9274bbcec8d96168626c732b5d31c775aa8cfb7eaa0599bec0c175908a2c1ce2";   // three.js r128 (cdnjs copy, vendored 2026-07-11)
const FONT_SHA = "ec10c02708feb2fb7f960556652b732d529e30bf14c5dd59e790aacd65f5d5c7";    // Montserrat latin variable subset (OFL)
function vendored(rel, sha, label) {
  const buf = readFileSync(new URL(rel, import.meta.url));
  const got = createHash("sha256").update(buf).digest("hex");
  if (got !== sha) { console.error("BUILD FAIL: " + label + " drifted (sha256 " + got + " != pinned " + sha + ")"); process.exit(1); }
  return buf.toString("utf8");
}
const threeSrc = vendored("./vendor/three-r128.min.js", THREE_SHA, "vendor/three-r128.min.js");
const fontCss = vendored("./vendor/montserrat.css", FONT_SHA, "vendor/montserrat.css");

const modules = [
  ["starnix-core.js", "core"],
  ["questions.js", "questions"],
  ["assets.js", "assets"],
  ["starnix-shell.js", "shell"],
  ["audio.js", "audio"],
  ["arm.js", "arm"],
  ["cc.js", "cc"],
  ["kbb.js", "kbb"],
  ["exam.js", "exam"]
];

function read(p) { return readFileSync(new URL("./" + p, import.meta.url), "utf8"); }
// Defuse any literal </script> so an inline block can't be closed early.
function safe(s) { return s.replace(/<\/script>/gi, "<\\/script>"); }

const sizeLedger = {};   // (v0.166.0, V1.1 Backend#6) per-module bytes — printed + budget-gated
// (v0.198.0, V1.1 FE#9) ship power-on: each module block is preceded by a one-line status
// script, so the splash shows REAL inter-module parse progress — zero framework.
const BOOT_MSGS = {
  core: "Initializing core systems\u2026",
  questions: "Loading the question bank\u2026",
  assets: "Decoding ship art\u2026",
  shell: "Powering up the bridge\u2026",
  audio: "Warming the synth racks\u2026",
  arm: "Fueling the rescue wing\u2026",
  cc: "Spinning up the chasm\u2026",
  kbb: "Charting the Kuiper Belt\u2026",
  exam: "Arming the Testing station\u2026"
};
const blocks = modules.map(([file, name]) => {
  const src = safe(read(file));
  sizeLedger[name] = Buffer.byteLength(src, "utf8");
  const msg = BOOT_MSGS[name] || ("Loading " + name + "\u2026");
  return `<script>window.__sxBoot && __sxBoot(${JSON.stringify(msg)});</script>\n<!-- ===== ${name} (${file}) ===== -->\n<script>\n${src}\n</script>`;
}).join("\n\n");

// ---- exhibits: inline present exhibit-images/* as data URIs (window.STARNIX_EXHIBITS).
// Exam questions render their exhibit from this map; absent keys fall back to a pending note.
const EXHIBIT_MIME = { png:"image/png", jpg:"image/jpeg", jpeg:"image/jpeg", gif:"image/gif", webp:"image/webp", svg:"image/svg+xml" };
function exhibitBlock() {
  const map = {};
  // (v0.143.0, V1.1 NIT#2) reference-driven: inline ONLY images a live question cites. Orphan
  // files (a4q50.png shipped ~50 KB of dead base64 while its question block sat commented out)
  // stay on disk for later revival but never enter the deploy. Fails open if the bank is absent.
  let refs = null;
  try {
    const qsrc = readFileSync(new URL("./questions.js", import.meta.url), "utf8");
    refs = new Set([...qsrc.matchAll(/"image":\s*"([^"]+)"/g)].map((m) => m[1]));
  } catch (e) { refs = null; }
  try {
    for (const f of readdirSync(new URL("./exhibit-images/", import.meta.url))) {
      const ext = (f.split(".").pop() || "").toLowerCase();
      const mime = EXHIBIT_MIME[ext];
      if (!mime) continue;
      const key = f.replace(/\.[^.]+$/, "");
      if (refs && !refs.has(key)) continue;
      const b64 = readFileSync(new URL("./exhibit-images/" + f, import.meta.url)).toString("base64");
      map[key] = "data:" + mime + ";base64," + b64;
    }
  } catch (e) { /* no dir -> empty map */ }
  const n = Object.keys(map).length;
  return { n, html: `<!-- ===== exhibits (${n} inlined) ===== -->\n<script>\nwindow.STARNIX_EXHIBITS = ${JSON.stringify(map)};\n</script>` };
}
const exhibits = exhibitBlock();

const boot = `<!-- ===== boot ===== -->
<script>
(function () {
  "use strict";
  function fail(msg) {
    var bsF = document.getElementById("sx-boot");
    if (bsF && bsF.parentNode) bsF.parentNode.removeChild(bsF);   // (v0.198.0, FE#9) never hang on the splash
    var app = document.getElementById("app");
    if (app) {
      app.textContent = "";
      var d = document.createElement("div");
      d.style.cssText = "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;color:#FF6B5B;font:600 15px Montserrat,Arial,sans-serif;text-align:center";
      d.textContent = "StarNix failed to start — " + msg;
      app.appendChild(d);
    }
    if (window.console) console.error("StarNix boot error:", msg);
  }
  function start() {
    try {
      if (!window.StarNix || typeof window.StarNix.boot !== "function") return fail("core/shell not loaded");
      Promise.resolve(window.StarNix.boot(document.getElementById("app"), {})).then(function () {
        var bs2 = document.getElementById("sx-boot");                 // (v0.198.0, FE#9) the shell has the bridge
        if (bs2 && bs2.parentNode) bs2.parentNode.removeChild(bs2);
      }).catch(function (e) {
        fail((e && e.message) || String(e));
      });
    } catch (e) { fail((e && e.message) || String(e)); }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
</script>`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="color-scheme" content="dark" />
<title>StarNix — Starlight Rescue Crew</title>
<style>/* ===== Montserrat, vendored (no fonts CDN) ===== */
${fontCss}</style>
<!-- Three.js r128 (UMD global window.THREE), VENDORED — no runtime CDN -->
<script>${threeSrc}</script>
<style>
  html, body { margin: 0; height: 100%; background: #07070e; color: #F2F2F7;
    font-family: 'Montserrat', Arial, sans-serif; overflow: hidden; }
  #app { position: fixed; inset: 0; }
  /* (v0.198.0, V1.1 FE#9) ship power-on splash — real inter-module progress, removed by boot */
  #sx-boot { position: fixed; inset: 0; z-index: 999; background: #07070e; display: flex;
    flex-direction: column; align-items: center; justify-content: center; gap: 14px; }
  #sx-boot .sxb-crest svg { width: 54px; height: 60px; animation: sxbSpin 2.6s linear infinite; }
  #sx-boot .sxb-title { font-size: 12px; font-weight: 800; letter-spacing: .3em; color: #AC9BFD; }
  #sx-boot .sxb-status { font-size: 13px; color: #6d6d80; letter-spacing: .04em; min-height: 18px; }
  #sx-boot .sxb-bar { width: min(300px, 60vw); height: 3px; border-radius: 3px; background: #1c1c2c; overflow: hidden; }
  #sx-boot .sxb-bar i { display: block; height: 100%; width: 0%; background: linear-gradient(90deg, #7855FA, #1FDDE9); transition: width .18s ease; }
  @keyframes sxbSpin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { #sx-boot .sxb-crest svg { animation: none; } }
</style>
</head>
<body>
<div id="app"></div>
<div id="sx-boot" aria-hidden="true">
  <div class="sxb-crest"><svg viewBox="0 0 60 66"><polygon points="30,2 57,17 57,49 30,64 3,49 3,17" fill="none" stroke="#1FDDE9" stroke-width="2.5"/></svg></div>
  <div class="sxb-title">NX-SRC \u00b7 STARNIX</div>
  <div class="sxb-status" id="sx-boot-status">Ship power-on\u2026</div>
  <div class="sxb-bar"><i id="sx-boot-bar"></i></div>
</div>
<script>
/* (v0.198.0, FE#9) the splash stepper + a pre-shell parse-fault trap (the shell's own error
   ring takes over the moment it exists). */
window.__sxBoot = (function () {
  var n = 0, total = ${modules.length + 1};
  return function (msg) {
    try {
      var elS = document.getElementById("sx-boot-status"), barS = document.getElementById("sx-boot-bar");
      n++;
      if (elS) elS.textContent = msg;
      if (barS) barS.style.width = Math.min(100, Math.round(n / total * 100)) + "%";
    } catch (eS) {}
  };
})();
window.addEventListener("error", function (ev) {
  try {
    if (window.StarNix && window.StarNix.shell) return;
    var elE = document.getElementById("sx-boot-status");
    if (elE) { elE.textContent = "Boot fault: " + ((ev && ev.message) || "script error"); elE.style.color = "#FF6B5B"; }
  } catch (eE) {}
});
</script>

<script>window.__sxBoot && __sxBoot("Inlining exhibits\u2026");</script>
${exhibits.html}

${blocks}

${boot}
</body>
</html>
`;

writeFileSync(new URL("./index.html", import.meta.url), html, "utf8");
const bytes = Buffer.byteLength(html, "utf8");
// (v0.166.0, V1.1 Backend#6) the size report: per-module bytes + gzip total, persisted for
// the gate. The bundle 5x'd from ~1.3MB with nobody watching — now a bloated drop goes red.
sizeLedger.exhibits = Buffer.byteLength(exhibits.html, "utf8");
sizeLedger.three = Buffer.byteLength(threeSrc, "utf8");
sizeLedger.font = Buffer.byteLength(fontCss, "utf8");
sizeLedger.total = bytes;
{
  const gz = (await import("node:zlib")).gzipSync(html).length;
  sizeLedger.gzip = gz;
  const rows = Object.keys(sizeLedger).filter((k) => k !== "total" && k !== "gzip")
    .sort((a, b) => sizeLedger[b] - sizeLedger[a]);
  console.log("---- size report (KB) ----");
  for (const k of rows) console.log("  " + k.padEnd(10) + (sizeLedger[k] / 1024).toFixed(1).padStart(9));
  console.log("  " + "TOTAL".padEnd(10) + (bytes / 1024).toFixed(1).padStart(9) + "   gzip " + (gz / 1024).toFixed(1));
  writeFileSync(new URL("./build-size.json", import.meta.url), JSON.stringify(sizeLedger, null, 2));
}
console.log("Wrote index.html (" + (bytes / 1024).toFixed(1) + " KB, " + modules.length + " modules + boot + " + exhibits.n + " exhibits)");
