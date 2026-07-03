/* visual-playtest.mjs — headless-Chromium screenshot sweep of the built index.html
 * (NIGHT_RUN unit 9; Playwright is this unit's granted dependency exception).
 * Launches real Chromium (real canvas, real WebGL-capable renderer, real CDN Three.js),
 * scripts the key beats via the shipped test seams, and saves PNGs to playtest-shots/.
 * The screenshots are then REVIEWED (by whoever runs the night) against 07 — palette,
 * composition, readability, clipping, contrast — into PLAYTEST.md. This does NOT replace
 * Jason's pass: motion feel and all audio remain human-only.
 * Run: node visual-playtest.mjs   (build first: node build.mjs)
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve("./playtest-shots");
mkdirSync(OUT, { recursive: true });
const url = "file://" + resolve("./index.html");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 140)));

let n = 0;
async function shot(name) {
  n++;
  const file = `${OUT}/${String(n).padStart(2, "0")}-${name}.png`;
  await page.screenshot({ path: file });
  console.log("  📸 " + file.split("/").pop());
}
const sleep = (ms) => page.waitForTimeout(ms);

console.log("Loading " + url);
await page.goto(url, { waitUntil: "load" });
await sleep(2500);                                          // boot + fonts + assets decode

/* ---- 1. Title / cold-open cinematic ---- */
await shot("title-or-cineopen");
// jump into the cinematic deliberately and catch two beats
await page.evaluate(() => { const S = window.StarNix; if (S.shell.screen !== "cinematic") S.shell.showCinematic(); });
await sleep(4000); await shot("cinematic-early");
await sleep(5500); await shot("cinematic-planet-beat");     // the planet rise window (~9.5s in)
await sleep(4000);

/* ---- 2. Menu (rank strip + daily missions + cards) ---- */
await page.evaluate(() => window.StarNix.shell.showMenu());
await sleep(600);
await shot("menu-stock");
// menu with progression surface lit up: some xp + one claimable mission
await page.evaluate(() => {
  const S = window.StarNix, p = S.core.profile;
  p.xp = 950; p.rankSeen = 3;                              // Pilot, acknowledged (no toast in the shot)
  S.daily.ensure(p);
  p.daily.correct = 99; p.daily.bestStreak = 99;           // completes whatever rolled today
  S.shell.showMenu();
});
await sleep(400);
await shot("menu-progression-lit");

/* ---- 3. Progress screen (readiness / heatmap / daily / achievements) ---- */
await page.evaluate(() => {
  const S = window.StarNix, p = S.core.profile;
  p.achievements = { "first-contact": 1, "hot-streak": 1, "sim-certified": 1 };
  S.shell.showStats();
});
await sleep(600);
await shot("progress-top");
await page.evaluate(() => { const el = document.querySelector(".sx-ach"); if (el) el.scrollIntoView(); });
await sleep(300);
await shot("progress-achievements");

/* ---- 4. Settings (trail picker) ---- */
await page.evaluate(() => window.StarNix.shell.showSettings());
await sleep(400);
await page.evaluate(() => { const el = document.querySelector(".sx-trails"); if (el) el.scrollIntoView(); });
await sleep(200);
await shot("settings-trails");

/* ---- 5. ARM: intro dive, briefing, flight, question ---- */
await page.evaluate(() => { window.StarNix.shell.showMenu(); });
await sleep(300);
await page.evaluate(() => window.StarNix.shell.enterGame("ARM"));
await sleep(1200); await shot("arm-intro-early");
await sleep(4200); await shot("arm-intro-dive-beat");       // dive-to-planet window (~5.4s in)
await page.evaluate(() => {
  const T = window.StarNix.shell.currentGameRoot.__armTest;
  T.endBriefingIntro();
});
await sleep(500); await shot("arm-briefing");
await page.evaluate(() => {
  const T = window.StarNix.shell.currentGameRoot.__armTest;
  T.skipBriefing(); T.flushWarp();
});
await sleep(400);
// hold thrust so the (possibly tinted) flame is visible
await page.keyboard.down("ArrowUp"); await sleep(900);
await shot("arm-flight-thrust");
await page.keyboard.up("ArrowUp");
await page.evaluate(() => {
  const T = window.StarNix.shell.currentGameRoot.__armTest;
  T.prepCore(1); T.arrive(1);
});
await sleep(500); await shot("arm-question-panel");
await page.evaluate(() => {
  const T = window.StarNix.shell.currentGameRoot.__armTest;
  T.answer(true);
  window.StarNix.shell.exitGame();
});
await sleep(400);

/* ---- 6. KBB: how-to, cinematic beats, battle, boss ---- */
await page.evaluate(() => window.StarNix.shell.enterGame("KBB"));
await sleep(900); await shot("kbb-howto");
await page.evaluate(() => { const b = [...document.querySelectorAll(".kbb-ht-skip,.kbb-btn")].find(x => /skip|next/i.test(x.textContent)); if (b) b.click(); });
await sleep(1100); await shot("kbb-cine-warpin");
await sleep(3000); await shot("kbb-cine-decloak");
await sleep(2600); await shot("kbb-cine-burnaway");
await page.evaluate(() => { const b = [...document.querySelectorAll(".kbb-skip")].find(x => /skip/i.test(x.textContent)); if (b) b.click(); });
await sleep(500); await shot("kbb-prerun-shop");
await page.evaluate(() => { const b = [...document.querySelectorAll(".kbb-btn")].find(x => /start run/i.test(x.textContent)); if (b) b.click(); });
await sleep(800); await shot("kbb-battle");
await page.evaluate(() => {
  const st = window.KBB._test.state();
  if (st && st.run && st.run.battle) { st.run.battle.enemy.boss = true; st.run.battle.enemy.hp = st.run.battle.enemy.maxHp = 500; }
  const opt = document.querySelector(".kbb-opt:not(:disabled)"); if (opt) opt.click();
  const sub = document.querySelector(".kbb-submit"); if (sub && !sub.disabled) sub.click();
});
await sleep(900); await shot("kbb-boss-flagged");
await page.evaluate(() => window.StarNix.shell.exitGame());
await sleep(400);

/* ---- 7. CC: establishing shot, live run approaches (real Three.js via CDN) ---- */
await page.evaluate(() => window.StarNix.shell.enterGame("CC"));
await sleep(1500); await shot("cc-establishing");
// skip any how-to / descent gate if present
await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find(x => /skip|continue|start|go/i.test(x.textContent || "")); if (b) b.click(); });
await sleep(1200); await shot("cc-run-early");
// periodic approach shots while nudging inputs to stay alive a while
for (let i = 0; i < 5; i++) {
  await page.keyboard.press(i % 2 ? "ArrowLeft" : "ArrowRight");
  await sleep(1700);
  await shot("cc-run-t" + (i + 1));
}
await shot("cc-run-final");
await page.evaluate(() => window.StarNix.shell.exitGame());
await sleep(300);

/* ---- 8. Exam: blitz question + combo chip ---- */
await page.evaluate(() => { const S = window.StarNix.shell; S._examMode = "blitz"; S.showExam(10); });
await sleep(1200); await shot("exam-blitz-question");
await page.evaluate(() => {
  // answer the current question correctly to light the combo chip
  const st = window.StarNix.shell._exam && window.StarNix.shell._exam._state;
  if (st) { const q = st.order[st.i]; const btns = document.querySelectorAll(".sx-exam-opt"); if (btns[q.correctIndex]) btns[q.correctIndex].click(); }
});
await sleep(400); await shot("exam-blitz-combo-lit");

await browser.close();
console.log("\nDone — " + n + " screenshots in playtest-shots/");
