# 01 — Shared Core

> **Doc version:** v1.7 · **Owner:** single session (was CORE & INTEGRATION chat) · **Last updated:** 2026-07-03 · **Contract status: FROZEN** (see §9a)
>
> **Change history**
> | Version | Date | Change |
> |---|---|---|
> | v1.7 | 2026-07-03 | **§5 PersistenceProvider gains additive `update(mutator)`** — installed in `initCore` beside `submitScore`, it applies the mutator to the LIVE `core.profile` and persists it. Motivation (G4 scan, HIGH): `load()` returns storage clones while the mastery store saves the live profile on every answer, so any game-side clone-write (v0.106 checkpoints, the Belt-sweeper flag, in-game settings) was clobbered last-writer-wins — Save/Resume and achievement #13 were dead in real play despite green pins. All game write-paths now use `persistence.update` (guarded fallback to load/save for bare harness mocks). Gate: a live-mutation pin plus behavioral resume/write drives in verify-build. |
> | v1.6 | 2026-07-03 | **§9a.2 `ctx.rng` re-specified as a per-MOUNT fork** — `core.rng.fork("game:"+id+":"+mountSeq)` (a module-scoped counter). Motivation (user-reported): `fork()` derives from the parent's ORIGINAL seed, not consumed state, so the old static salt handed every remount of a game an identical stream — same questions, same order, same shuffled answer positions within one loaded page. The change keeps every guarantee that mattered: still a per-game fork, still no globals/`Math.random`, still fully deterministic from the boot seed (the counter sequence is deterministic). Games' own INTERNAL re-forks must likewise vary replays (ARM's per-run fork now salts a `runSeq`). Contract surface unchanged: same 7 frozen keys, same Rng interface — this corrects the SALT prescription only. Gate: remount-variance pins in verify-build + arm-run. |
> | v1.5 | 2026-07-03 | Added **§14 Meta-progression surfaces (v0.52–v0.66)** — the NIGHT_RUN systems: completed `persistence.submitScore` (the §5-optional seam ARM called into the void since v0.27; now implemented in `initCore`, bound to the live profile), seven new profile fields (`xp`, `rankSeen`, `streaks`, `streaksBest`, `achievements`, `daily`, `trailsUnlocked` — all defaultProfile + migrate-repaired), and four new `StarNix.*` namespaces (`xp`, `achievements`, `daily`, `cosmetics`) with their determinism guarantees and gate pointers. All ADDITIVE: the 7 frozen ctx keys and §9a are untouched; games still consume ctx only (cosmetics reach render paths as a shell-resolved `settings.shipTrailColor` hex). |
> | v1.4 | 2026-06-28 | Documented **`ctx.assets`** (§9a.2) — the inlined sprite/texture map (`window.STARNIX_ASSETS`; asset key → base64 data-URI, `{}` when `assets.js` is absent). It is a 4th **additive** ctx key (games read e.g. `ctx.assets.armStation`); the 7 frozen keys are unchanged. (Module-side syncs from the same session — ARM intro/Disruptor cinematic + sprite roster, CC arch/rock/gate/lane passes — are tracked in 02/04.) |
> | v1.3 | 2026-06-26 | Added **optional `pause()` / `resume()`** hooks to the `GameModule` interface (§9 + §9a.3) — additive and backward-compatible (modules without them still register and run). The shell’s new pause overlay (⏸ button + Esc) calls them, and independently **stops the music on open and restarts it on resume** (fresh scheduler — so an audio glitch self-heals via pause → resume). All three games implement them (ARM v1.2, KBB v0.2.0, CC v1.1). Verified by a pause-overlay section in `verify-build.mjs` with a negative control (integration 207→223). No change to existing frozen keys. |
> | v1.2 | 2026-06-24 | Documented the **shell-injected `ctx.exit()`** return-to-menu method in §9a.2 (it is added by `shell.enterGame`, not by `makeContext`, so it was previously undocumented) and §9a.3. Stated it is the **one canonical** menu-return hook — there is no `onExit`. Motivated by a latent CC bug: CC called a never-defined `ctx.onExit`, leaving its Menu button a silent no-op that the structural harness missed (the bad call sat behind an `if`). Fixed CC to call `ctx.exit`; added a harness assertion that clicks the real in-game Menu button and asserts return-to-menu (integration 185→186). No code-contract change — `exit` already shipped; this closes a doc + verification gap. |
> | v1.1 | 2026-06-23 | Contract **frozen** and realized as plain JS (`starnix-core.js`, `starnix-shell.js`, `mock-core.js`). Added **§9a Frozen Runtime Contract** (exact `window.StarNix` surface + exact `CoreContext` shape, with guaranteed vs additive keys). Documented the **audio seam** (`NoopAudio` default + `registerAudio()`; engine ships separately as `audio.js`). Verified by headless `jsdom` harness (76/76). |
> | v1.0 | 2026-06-23 | Initial interface spec: schema, provider/scheduler, mastery, persistence, RNG, audio, theme, shell, telemetry, AIAdapter, a11y, perf. |

The shared core is the foundation all three games depend on. **Freezing these interfaces is Phase 0's exit criterion** — once frozen, ARM / KBB / CC can be built in parallel against them. Ships as `starnix-core.js` (plain JS on `window.StarNix`, no build step).

> Interfaces below are written TypeScript-ish for precision. The build is **pure-vanilla plain JS** (see `00 §4`); treat the types as the documented shape of plain objects. **§9a is the authoritative, frozen contract** — where prose elsewhere disagrees with §9a, §9a wins.

---

## 1. Module map

```
src/core/
  questions/      QuestionProvider, schema (Zod), validator, scheduler
  mastery/        MasteryStore
  persistence/    PersistenceProvider interface + LocalStorageProvider
  rng/            seeded RNG
  audio/          chiptune engine + SFX (extracted from ARM)
  theme/          design tokens (palette, fonts, glow), shared CSS
  telemetry/      event schema + sink
  ai/             AIAdapter interface + StaticAI
  shell/          boot, router, menu, cinematic
```

---

## 2. Question bank — schema

One bank, shared by all three games. Stored as data (canonical JSON, authored via a forgiving Markdown format). Validated by Zod at load and by a CI script. **How to turn pasted exam dumps into this format is documented in `06_QUESTION_INGESTION.md`** — that doc owns the authoring/import workflow; this section owns the runtime shape.

```ts
type Domain =
  | "architecture" | "storage" | "networking" | "security"
  | "vms" | "data-protection" | "lifecycle" | "monitoring" | "performance";

interface Question {
  id: string;            // stable, unique, e.g. "mci-storage-0007"
  cert: "NCP-MCI";       // certification pack id (future: EUC, NAI, NCM)
  domain: Domain;        // maps to ARM "sector"
  difficulty: 1 | 2 | 3; // 1 easy → 3 hard; gates scaling in all games
  stem: string;          // the question text
  options: string[];     // 3–5 options
  correctIndex: number;  // 0-based index into options (authored truth)
  explanation: string;   // why the answer is correct (shown post-answer)
  briefing?: string;     // the knowledge ARM's commander teaches for this concept
  tags?: string[];       // free-form (e.g. "RF", "erasure-coding")
  source?: string;       // provenance note (optional)
}

interface CertPack {
  id: string;            // "NCP-MCI"
  name: string;          // "Nutanix Certified Professional — Multicloud Infrastructure"
  domains: Domain[];
  questions: Question[];
}
```

**Validator rules (fail the build on any):**
- `id` unique across the pack; matches a slug pattern.
- `options.length` in [3,5]; `correctIndex` in `[0, options.length)`.
- `explanation` non-empty; `stem` non-empty.
- `domain` ∈ pack `domains`; `difficulty` ∈ {1,2,3}.
- No two questions share an identical normalized `stem` (dup detection).
- Round-trip parse with Zod; emit a machine-readable report.

> ⚑ The original third-party practice exams contained **answer-key errors**. Authored `correctIndex` is the corrected truth; the validator + human review own correctness. The AI layer must never override it.

**Checklist**
- [ ] Zod schema + `CertPack` loader
- [ ] `scripts/validate-questions.mjs` (used by `npm run check`)
- [ ] NCP-MCI fixture wired (real bank arrives from you)
- [ ] Importer if source is CSV/MD → normalized JSON

---

## 3. QuestionProvider + scheduler (spaced retrieval)

The provider is the **only** way games get questions. It owns selection so spaced-retrieval logic is shared.

```ts
interface QuestionDraw {
  question: Question;
  reason: "new" | "review-due" | "reinforce" | "random";
}

interface QuestionProvider {
  // Pick the next question for a context. Honors mastery + difficulty band.
  next(opts: {
    game: "ARM" | "KBB" | "CC";
    domain?: Domain;            // ARM uses sector→domain; others may pass undefined
    difficultyBand?: [number, number]; // KBB/CC pass a band that widens as you progress
    excludeIds?: string[];      // avoid repeats within a battle/sector/run
    rng: Rng;
  }): QuestionDraw;

  byId(id: string): Question | undefined;
  pool(filter?: Partial<Pick<Question,"domain"|"difficulty"|"cert">>): Question[];
}
```

**Scheduler policy (shared, tunable):** weight selection by a Leitner-style bucket per question (see Mastery). Prefer *review-due* > *new* > *reinforce*, with a small random tail so runs vary. Respect the requested difficulty band and exclusions. Deterministic given the same `rng` seed (for tests).

**Checklist**
- [ ] Difficulty-band selection
- [ ] Leitner/SRS weighting hook into MasteryStore
- [ ] Exclusion + no-repeat-within-context
- [ ] Deterministic under seeded RNG (unit tested)

---

## 4. MasteryStore

Per-question learning state, shared across all three games, persisted.

```ts
interface QuestionMastery {
  id: string;
  seen: number;
  correct: number;
  incorrect: number;
  streak: number;        // current consecutive correct
  bucket: number;        // Leitner box 0..N (higher = better known)
  lastSeen: number;      // epoch ms
  firstCorrectAt?: number;
}

interface MasteryStore {
  record(id: string, correct: boolean, ctx: { game: string }): void; // updates bucket/streak
  get(id: string): QuestionMastery | undefined;
  summary(): {
    totalSeen: number; uniqueCorrect: number; uniqueIncorrect: number;
    masteredCount: number; // bucket >= threshold
  };
}
```

`record()` is called by **all** games on every answer; it advances/decays the Leitner bucket and feeds both the scheduler and the Stats screen. Persisted via `PersistenceProvider`.

**Checklist**
- [ ] Leitner bucket update rules (advance on correct, drop on wrong)
- [ ] Cross-game aggregation for Stats/Codex
- [ ] Persistence read/write

---

## 5. PersistenceProvider (swappable storage)

Single interface; games and core never know which tier is behind it. See Master Plan §7 for the tier roadmap.

```ts
interface PlayerProfile {
  userId: string;                // anon device id now; OAuth subject later
  bests: Record<string, number>; // e.g. {"KBB":"3-5"→encoded, "CC":24120, ...}
  totals: { questionsSeen: number; correct: number; incorrect: number; points: number; runs: number };
  mastery: Record<string, QuestionMastery>;
  settings: Settings;
  updatedAt: number;
}

interface PersistenceProvider {
  load(): Promise<PlayerProfile>;
  save(p: PlayerProfile): Promise<void>;
  // optional, for later tiers:
  submitScore?(game: string, score: number | string, meta?: object): Promise<void>;
  leaderboard?(game: string): Promise<Array<{ name: string; score: number | string }>>;
}
```

**Phase 0 impl:** `LocalStorageProvider` (JSON in one key, debounced writes, schema-versioned with migration hook).

**Checklist**
- [ ] Interface + `LocalStorageProvider`
- [ ] Schema version + migration function
- [ ] Debounced autosave; explicit `save()` on run end
- [ ] (Later) `ApiPersistenceProvider` against the backend

---

## 6. Seeded RNG

Deterministic PRNG (e.g., mulberry32/xorshift) injected everywhere randomness matters — **mandatory** for KBB fairness and for reproducible tests.

```ts
interface Rng { next(): number; int(maxExclusive: number): number; pick<T>(arr: T[]): T; shuffle<T>(arr: T[]): T[]; fork(salt: string): Rng; }
function makeRng(seed: number | string): Rng;
```

Rule: **no game logic calls `Math.random()` directly.** Lint rule enforces it.

**Checklist**
- [ ] `makeRng` + `fork` (sub-streams for independent systems)
- [ ] Lint ban on raw `Math.random()` in game/core logic

---

## 7. Audio engine (extract from ARM) — 5 tracks

ARM already has a working Web Audio chiptune engine (SID-style sequencer: detuned electric **pulse bass** through a soft-clip waveshaper + arp + kick/hat) and an SFX set (fire/hit/explode/collect/correct/wrong/hyperdrive). **Lift it into `core/audio` unchanged**, expose a small API, and have all three games use it. All music is **generated in-browser (no audio files)** — important for the single-file Apps Script build.

```ts
type TrackId = "cinematic" | "menu" | "arm" | "kbb" | "cc";
interface Audio {
  ensure(): void;                 // unlock on first gesture
  setMusic(on: boolean): void;
  setSfx(on: boolean): void;
  sfx(name: SfxName): void;
  playTrack(id: TrackId): void;   // crossfade-swap loops
}
```

**Five tracks — all the Lazy-Jones electric 8-bit timbre family, distinguished by tempo / key / mood:**

| Track | Used by | Direction |
|-------|---------|-----------|
| `cinematic` | Intro cold open | tense, slower build, minor key, sparse → swell as the station shatters; dramatic |
| `menu` | Main menu **and** pause menu (same track) | calm, mid-tempo, hopeful, clean loop |
| `arm` | Acropolis Rescue Mission | exploratory, steady adventurous groove (the existing ARM loop fits) |
| `kbb` | Kuiper Belt Battle | driving, aggressive, higher tempo, combat tension |
| `cc` | Chasm Chase | fast, propulsive, high-energy runner pulse |

Shared timbre = the electric pulse-bass voice + arp lead + kick/hat already built; each track varies BPM, scale/chord loop, and arp pattern so they're cohesive but distinct. Boss variants (N5): reuse the game track with an added intensity layer unless decided otherwise.

**Checklist**
- [ ] Extract engine + SFX into module; ARM consumes it
- [ ] Author the 5 track definitions (chord loop + tempo + arp per track)
- [ ] `playTrack` crossfade on menu/game/pause transitions
- [ ] Music/SFX toggles persisted in Settings

---

## 8. Theme / brand tokens

Single source for palette, fonts, glow. Enforces brand rules (see ARM file for the wordmark constraint).

- Palette: Iris `#7855FA`, Charcoal `#131313`, White, Aqua `#1FDDE9`, Mantis `#92DD23`, Peach `#FF6B5B`, Gold `#FFC857`, iris300 `#AC9BFD`, iris600 `#6D40E6`. Montserrat, sentence case.
- Exported as CSS custom properties **and** TS constants so Canvas/Three read the same values.
- **Accessibility:** never encode meaning in color alone (see §12).

**Checklist**
- [ ] `tokens.css` + `tokens.ts` (single definition, generated or shared)
- [ ] Official Nutanix wordmark asset, used unaltered, title screen only

---

## 9. Shell (boot · router · menu · cinematic)

- **Boot:** init core (load profile, audio on first gesture, RNG seed), then route to title.
- **Router:** `title → cinematic → menu → {ARM|KBB|CC} → menu`. Mount one game at a time; **clean unmount** (cancel RAF, remove listeners, free pools) — a mounted game must leave zero residue when you return to menu.
- **Menu:** three game cards + Continue + Stats/Codex + Settings + (future) cert selector.
- **Cinematic:** the shared cold open (Master Plan §2); skippable; plays once per session unless replayed from menu.

```ts
interface GameModule {
  id: "ARM" | "KBB" | "CC";
  mount(root: HTMLElement, ctx: CoreContext): void; // ctx carries all providers
  unmount(): void;                                   // MUST fully clean up
  pause?(): void;                                    // OPTIONAL: hard-freeze sim/RAF/timers for the shell pause overlay
  resume?(): void;                                   // OPTIONAL: resume with NO time jump
}
```

**Checklist**
- [ ] Router with strict mount/unmount lifecycle
- [ ] Menu UI (cards, Continue, Stats, Settings)
- [ ] Shared cinematic (port ARM's, extend to the full cold-open beat list)
- [ ] CoreContext injected into every game (providers + theme + audio + rng)
- [ ] Leak check: unmount removes all listeners/timers/RAF (asserted in tests)

---

## 9a. FROZEN RUNTIME CONTRACT (v1.1) — authoritative

This is the **frozen** surface the game/audio chats build against. Realized in `starnix-core.js` + `starnix-shell.js`. Verified by `harness.mjs` (76/76 green). Anything here is stable; additions are allowed only if they don't change existing shapes.

### 9a.1 Global surface — `window.StarNix`

```js
window.StarNix = {
  core,                       // the live core object (see 9a.2). Null until initCore() resolves.
  shell,                      // the Shell instance (from starnix-shell.js)
  registerGame(module),       // register a GameModule (9a.3). Validates id/mount/unmount.
  getGame(id),                // -> the registered module for "ARM" | "KBB" | "CC" (or undefined)
  registerAudio(impl),        // install the real audio engine (9a.4). Default is NoopAudio.
  boot(root, opts),           // shell entry: title -> cinematic -> menu. Returns Promise<shell>.
  initCore(opts),             // build the live core. Returns Promise<core>. Called by boot().
  makeContext(gameId)         // build the CoreContext handed to a game's mount() (9a.2)
  // _internal, _games, _audio are private test/wiring hooks — DO NOT depend on them in game code.
};
```

- `boot(root, opts)` accepts an element or an element id. `opts` is forwarded to `initCore`.
- `initCore(opts)` is idempotent-friendly: it loads the persisted profile, builds providers, and assigns `StarNix.core`. If `registerAudio()` ran first, the core adopts that engine; otherwise `NoopAudio`.

### 9a.2 `CoreContext` (a.k.a. `ctx`) — exact shape handed to `mount(root, ctx)`

`ctx = StarNix.makeContext(gameId)`. **Seven keys are GUARANTEED and frozen** — every game may rely on them:

```js
ctx = {
  questions,   // QuestionProvider  (§3): next({rng,domain,difficultyBand,excludeIds}) -> {question, reason},
               //                         byId(id), pool(filter?), count()
  mastery,     // MasteryStore      (§4): record(id,correct,meta?), get(id), all(), summary()
  persistence, // PersistenceProvider(§5): load()->Promise<profile>, save(profile), flush()
  rng,         // Rng               (§6): PER-MOUNT fork — core.rng.fork("game:"+id+":"+mountSeq) (v1.6;
               //                         static salts replayed identical streams every remount). next/int/range/pick/shuffle/fork
  audio,       // Audio             (§7): ensure/setMusic/setSfx/sfx/playTrack  (NoopAudio until audio.js loads)
  theme,       // THEME tokens      (§8): { colors, font, meaning }
  telemetry    // Telemetry         (§10): emit(event), events(), clear()
};
```

**Four keys are ADDITIVE** (present, but newer than the original 7-key list; rely on them only if you check for them):

```js
ctx.ai        // AIAdapter no-op seam (§11): available()->false, rephraseBriefing, explainAnswer, flavor. Never throws.
ctx.settings  // read-only snapshot of profile.settings for a11y: {music,sfx,reducedMotion,extraTime,colorblind}
ctx.sanitize  // DOM-safety helper (escapeHTML) so games never build dynamic innerHTML (05 lint rule)
ctx.assets    // window.STARNIX_ASSETS — inlined sprite/texture map, asset key -> base64 data-URI (e.g. ctx.assets.armStation). {} when assets.js absent (standalone harness); always guard before use.
```

**One key is SHELL-INJECTED** — added by `shell.enterGame` *after* `makeContext`, so it is present in the `ctx` a game receives in `mount` but is **not** part of `makeContext`'s return value:

```js
ctx.exit      // () -> void. The ONE canonical "return to the menu" hook. Calls shell.exitGame()
              // (which unmounts the game and routes to the menu). There is NO `onExit`, `quit`,
              // or `back` — a game that wants to leave (e.g. a "Menu" button on its game-over
              // screen) calls ctx.exit(). Always present in a mounted game's ctx; still guard it
              // (`if (ctx.exit) ctx.exit()`) so a game also runs under a standalone test harness
              // that mounts it without the shell.
```

> **Freeze guarantee:** the 7 guaranteed keys' names and method signatures will not change. The 4 additive keys may grow but won't shrink. `ctx.exit` is the single menu-return method — do not invent alternatives. `ctx.rng` is **already forked per mount** (v1.6 — per game AND varying each mount), so games must NOT re-seed from globals (and must never call `Math.random`); a game's own internal re-forks (per-run/per-sector) must include a varying component so replays draw fresh streams.

### 9a.3 `GameModule` — what each game chat exports

```js
StarNix.registerGame({
  id: "ARM" | "KBB" | "CC",            // unknown ids warn but still register
  mount(root, ctx) { /* build into root using ctx; start your own RAF/listeners */ },
  unmount() { /* MUST cancel RAF, remove listeners, free pools — leave ZERO residue */ },
  pause() { /* OPTIONAL: hard-freeze — stop RAF + freeze sim/question/puzzle clocks, hold one frame */ },
  resume() { /* OPTIONAL: un-freeze with NO time jump (reset accumulators/frame clock) */ }
});
```

**Lifecycle contract (enforced by the shell + asserted in the harness):**
1. The shell creates a fresh `root` element, calls `mount(root, ctx)`, and plays the game's track.
2. On exit the shell calls `unmount()`, then removes `root` from the DOM. Exit can be shell-driven (`shell.exitGame()`) or **game-initiated** — a game requests its own return-to-menu by calling **`ctx.exit()`** (§9a.2), which routes through `shell.exitGame()`. The harness verifies the game-initiated path by clicking the in-game exit control, not just by calling `shell.exitGame()` directly.
3. The shell cleans up **its own** listeners/RAF; the **game** is responsible for cleaning up everything it created in `mount`. After return-to-menu, firing a window event must not reach a game listener, and no game RAF may still be running.
4. If `mount` throws, the shell calls `unmount()` and returns to menu (games should make `unmount` safe to call after a partial mount).
5. **Pause (optional, v1.3).** While in a game the shell shows a ⏸ Pause control (and binds **Esc**) that opens a menu-styled pause overlay (Resume + ← Menu). If the module exposes `pause()`/`resume()`, the shell calls `pause()` when the overlay opens and `resume()` on Resume. Independently, the shell **stops the music on open and restarts it on resume** (a fresh scheduler, so a stuck/garbled audio voice self-heals by pausing then resuming). Modules without the hooks still register and run — the overlay appears and the music stops, but the sim keeps running underneath, so every real game SHOULD implement both. The overlay’s ← Menu routes through `shell.exitGame()` (which also re-enables music).

### 9a.4 Audio seam — engine ships separately

The core ships **`NoopAudio`** (all methods no-op) as `core.audio` and as `ctx.audio`. The real engine is authored by the **Audio chat** as **`audio.js`**, which lifts the SID-style engine + SFX out of the ARM build (§7) and installs itself:

```js
// at the end of audio.js:
StarNix.registerAudio(StarNixAudioEngine);   // replaces NoopAudio everywhere (core.audio + future contexts)
```

`registerAudio(impl)` may run **before or after** `initCore()`; the core remembers the last-registered engine (`StarNix._audio`) and adopts it. The `Audio` interface is exactly §7: `ensure()`, `setMusic(on)`, `setSfx(on)`, `sfx(name)`, `playTrack(trackId)` where `trackId ∈ {cinematic, menu, arm, kbb, cc}`. Games call only this interface; they never instantiate audio directly.

> **Why a seam, not the engine, in core:** file ownership. `audio.js` is owned by the Audio chat and concatenated separately at integration (JOB B). Core depending on a NoopAudio default keeps the shell and games runnable today, with the engine dropping in later with no game-code change.

### 9a.5 Versions / keys (frozen constants)

`core.version = "1.1.0"` · `SCHEMA_VERSION = 1` · persistence key `"starnix:profile"` · Leitner: `MAX_BUCKET=6`, `MASTERED_BUCKET=4`.

---

## 10. Telemetry

Lightweight event stream for tuning (local sink now; backend later). Not analytics-creepy — just enough to balance difficulty and economy.

```ts
type TelemetryEvent =
  | { t: "question_answered"; game: string; id: string; correct: boolean; ms: number; difficulty: number }
  | { t: "run_ended"; game: string; result: "win" | "loss"; depth?: string; score?: number }
  | { t: "shop_purchase"; game: "KBB"; itemId: string; cost: number }
  | { t: "powerup"; game: "CC"; kind: string };

interface Telemetry { emit(e: TelemetryEvent): void; }
```

**Checklist**
- [ ] Event types + console/local sink
- [ ] Hooks in all three games on answer/run-end
- [ ] (Later) ship to backend

---

## 11. AIAdapter (deferred — no-op seam only)

🚫 No AI is built now (Master Plan §8). We add only the interface + a `StaticAI` default that returns the authored content, so a future GPT-in-a-Box integration needs no refactor. See Master Plan §8 for the hard rules that will apply when it is eventually built.

```ts
interface AIAdapter {
  available(): boolean;
  rephraseBriefing(text: string, ctx: object): Promise<string>;   // fallback: returns input
  explainAnswer(q: Question, chosen: number): Promise<string>;    // fallback: q.explanation
  flavor(kind: string, ctx: object): Promise<string>;             // fallback: canned line
  // All implementations: time-boxed, cached, sanitized output, never throw to caller.
}
```

**Checklist**
- [ ] Interface + `StaticAI` (canned/fallback) default
- [ ] Output-sanitization helper (escape before DOM)
- [ ] Feature flags per use
- [ ] (Phase 5) `ClusterAI` via backend proxy + cache + timeout

---

## 12. Accessibility & input standards (apply to all games)

- **Input:** keyboard **and** touch for every action. ARM/CC define on-screen controls; all map to the same action enum.
- **Colorblind-safe:** pair color with shape/icon/label (e.g., correct = green **+ check**, wrong = red **+ x**; enemy intent shown as number, not just hue).
- **Reduced motion:** a setting that dampens parallax/shake/flash.
- **Readable timing:** any timed question respects a "more time" setting; nothing critical is conveyed by flashing alone.
- **Captions:** cinematic and barks have text.

**Checklist**
- [ ] Unified input action enum (keyboard + touch)
- [ ] Colorblind-safe encoding pass
- [ ] Reduced-motion + extra-time settings honored everywhere

---

## 13. Performance rules (enforced by lint + review agent)

These are **hard rules**, checked every run (see `05_CODE_REVIEW_AGENT.md`):
- **No allocations inside update/draw loops.** Reuse vectors/objects; pre-allocate.
- **Object pooling** for anything spawned repeatedly (bullets, asteroids, CC obstacles/coins, particles).
- **One RAF loop per active game**; fixed-timestep update where physics-ish.
- **No synchronous layout reads** (`offsetWidth`, `getComputedStyle`) inside loops; batch DOM writes.
- **Cap `devicePixelRatio`** for Canvas/Three; debounce resize.
- **Bundle budgets** per chunk (see agent file).

**Checklist**
- [ ] ESLint rules / custom checks for the above
- [ ] Pools implemented in each game
- [ ] DPR cap + resize debounce shared helper

---

## 14. Meta-progression surfaces (v0.52–v0.66) — ADDITIVE, outside the frozen contract

Everything here rides EXISTING seams; §9a is untouched. Games never call these namespaces —
progression feeds off the choke points the games already use (`mastery.record`, `_recordExam`,
`persistence.submitScore`), and the shell renders the results.

**Profile additions** (all in `defaultProfile()`, all `migrate()`-repaired for old saves):
- `xp: number` — the one Commander-rank pool. `rankSeen: number` — last rank index
  acknowledged on the menu (drives the one-shot promotion toast).
- `streaks / streaksBest: { [surface]: n }` — per-surface consecutive-correct counters
  (ARM/KBB/CC/EXAM via `meta.game`), maintained inside `mastery.record`.
- `achievements: { [id]: ts }` — one-shot unlocks. `daily: {...}` — the current day's
  missions + per-day counters (regenerated on calendar-day change; unclaimed progress
  expires). `trailsUnlocked: { [id]: ts }` — cosmetic latches (earned forever, Jason's
  2026-07-03 ruling; mastery decay never re-locks).

**`persistence.submitScore(game, score, meta)`** — the §5-optional seam is now REAL:
`initCore` installs it on the provider, bound to the live profile (bests high-water into
`profile.bests[game]` + flat run XP + save). ARM's campaign-win call (guarded since v0.27)
now does what it always claimed. CC/KBB still write their bests in-module (unchanged).

**`StarNix.xp`** — `{ AWARDS, RANKS(10, pinned thresholds), rankFor(xp), forAnswer, forExam,
forScore, add }`. Pure + deterministic; every award flows through existing seams: answers
(+10/+2, promotion +15, mastered-cross +40) at the `mastery.record` choke point, exam
completion (+25/+75≥80%) in the shell's `_recordExam`, run scores (+150) via `submitScore`,
achievement/mission bonuses on unlock/claim. Gate: verify-build K4.

**`StarNix.achievements`** — `{ LIST(12), evaluate(profile), onUnlock(fn) }`. Pure predicates
over `{profile, stats}`; list-order evaluation (same-pass XP cascade into the Commander
unlock is pinned); one-shot via `profile.achievements`; the shell's boot-registered
`onUnlock` toasts mid-game. Gate: K5.

**`StarNix.daily`** — `{ TEMPLATES(6), dayKey, gen(date), ensure(profile), state, claim }`.
`gen` is a PURE function of the calendar date (`makeRng("daily:"+date)` — deliberately NOT
`ctx.rng.fork`, which is boot-seeded and cannot reproduce across boots). Claims pay pinned
XP once. Gate: K6.

**`StarNix.cosmetics`** — `{ LIST(6), THRESHOLD(0.5), unlocked(def, stats, profile?),
resolve(settings, stats, profile?), latch(profile, stats) }`. Domain trail tints; unlock =
live threshold OR profile latch (earned forever); the SHELL resolves and stores BOTH
`settings.shipTrail` (id) and `settings.shipTrailColor` (hex) — render paths read the hex
with their stock color as fallback (ARM thruster flame, KBB hero engine dots, CC boost
plume). A never-earned locked pick resolves to standard. Gate: K7 + cc-view-smoke.

**Open per this section:** CC/KBB run-score XP (their bests bypass `submitScore` — would
need in-module touches); KBB-win/ARM-sector-clear telemetry (unlocks the literal
'flawless battle' / 'full-collection' achievements); legendary artifact reachability
(Jason: as-is for now); the performance-domain artifact slot.
