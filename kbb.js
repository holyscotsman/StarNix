/* ============================================================================
 * kbb.js - Kuiper Belt Battle (StarNix GameModule)
 * Spec: 03_KBB_kuiper_belt_battle. Contract: 01 sec 9. Art: 07.
 * Engine is DOM-free + deterministic; view (mount/unmount) built only with DOM.
 * Attached to (window||globalThis).KBB so harnesses can drive it headlessly.
 * ==========================================================================*/
(function () {
  'use strict';
  var ROOT = (typeof window !== 'undefined') ? window : globalThis;

  // ---- 1. Seeded RNG (mulberry32). The ENGINE is fully deterministic; only the view's cosmetic parallax backdrop uses Math.random. ----
  function hashStr(s) {
    s = String(s); var h = 2166136261 >>> 0;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function makeRng(seed) {
    var a = (typeof seed === 'number') ? (seed >>> 0) : hashStr(seed);
    function next() {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    return {
      next: next,
      int: function (m) { return Math.floor(next() * m); },
      pick: function (arr) { return arr[Math.floor(next() * arr.length)]; },
      shuffle: function (arr) {
        var b = arr.slice();
        for (var i = b.length - 1; i > 0; i--) { var j = Math.floor(next() * (i + 1)); var t = b[i]; b[i] = b[j]; b[j] = t; }
        return b;
      },
      fork: function (salt) { return makeRng((a >>> 0) ^ hashStr(salt)); }
    };
  }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  // ---- 2. CONFIG (all tunables). Fuzz checks invariants, not balance. ----
  var CONFIG = {
    // (v0.99.0, K10/K11, Jason) longer rounds: rounder enemies (>=2 questions round 1),
    // leaner squad; repair/brace values shrink to match. Fuzz targets re-verified below.
    squad: { hp: 40, maxHp: 40, basePower: 12, block: 6, healPower: 6, coins: 6, startShield: 0 },
    maxAttacks: 7, maxArtifacts: 5, consumableCap: 4, roundsPerSection: 5,   // (v0.99.0, K10) window widened with the rounder enemies
    enemyBaseHp: 14, hpPerRound: 2.4, hpPerSection: 0.10, bossHpMult: 1.3,
    intentBase: 2.2, intentPerRound: 0.30, intentPerSection: 0.08,   // v0.46.0 K4: softer chip; deaths should come from the ladder, not attrition
    coinBase: 3, bossCoinMult: 2.5,
    artifactPrice: { common: 6, uncommon: 10, rare: 16, legendary: 24 },
    pricePerSection: 0.15, minPriceFactor: 0.4, rerollBase: 4, rerollPerSection: 1,
    shopArtifactCount: 3, shopConsumableCount: 2,
    rarityWeights: { common: 0.55, uncommon: 0.28, rare: 0.13, legendary: 0.04 },   // fallback only — live rolls use rarityWeightsFor(run) (K4)
    repairHeal: 12, rechargeShield: 10,
    boostPriceBase: 8, boostPricePerSection: 2,
    gateDifficulty: 3, speedThresholdMs: 6000, damageCap: 1e9, fuzzSectionCap: 12
  };
  function sectionBand(section) {
    var lo = clamp(1 + Math.floor((section - 1) / 3), 1, 3);
    var hi = clamp(2 + Math.floor((section - 1) / 2), 1, 3);
    if (hi < lo) hi = lo; return [lo, hi];
  }
  var BOSS_MECHANICS = ['shielded', 'enrage', 'gated'];
  var ENEMY_PATTERNS = ['flat', 'ramp', 'alternating'];

  // ---- 3. Artifact catalog (data + hooks). modifyDamage channels:
  // d.flat (additive base), d.mult (additive to 1-based mult), d.post (xfinal).
  // final = round(flat*mult*post) clamped finite>=0. Q5-gated tagged q5:true. ----
  function healAmt(run, base) { return Math.max(0, Math.round(base + (run.squad.healPower - CONFIG.squad.healPower))); }

  var ARTIFACTS = [
    /* DAMAGE */
    { id: 'overclocked-core', name: 'Overclocked Core', rarity: 'common', category: 'damage',
      description: '+4 flat damage.',
      hooks: { modifyDamage: function (c, d) { d.flat += 4; } } },
    { id: 'chevron-array', name: 'Chevron Array', rarity: 'common', category: 'damage',
      description: '+2 flat damage per correct answer already landed this battle.',
      hooks: { modifyDamage: function (c, d) { d.flat += 2 * c.battle.correctCount; } } },
    { id: 'replication-factor', name: 'Replication Factor', rarity: 'uncommon', category: 'damage',
      description: '+0.5 mult while squad HP is full.',
      hooks: { modifyDamage: function (c, d) { if (c.squad.hp >= c.squad.maxHp) d.mult += 0.5; } } },
    { id: 'finisher', name: 'Finisher', rarity: 'uncommon', category: 'damage',
      description: '+8 flat damage when the enemy is at 30% HP or below.',
      hooks: { modifyDamage: function (c, d) { if (c.enemy && c.enemy.hp <= 0.3 * c.enemy.maxHp) d.flat += 8; } } },
    { id: 'shard-burst', name: 'Shard Burst', rarity: 'uncommon', category: 'damage', q5: true,
      description: '+0.4 mult while on a streak of 2+ correct answers.',
      hooks: { modifyDamage: function (c, d) { if (c.streak >= 2) d.mult += 0.4; } } },
    { id: 'quickdraw-cache', name: 'Overwatch Cache', rarity: 'uncommon', category: 'damage', q5: true,
      description: '+0.5 mult while your hull is at full HP.',   // (v0.98.0, K9) no timers in KBB — was fast-answer
      hooks: { modifyDamage: function (c, d) {
        if (c.run.squad.hp >= c.run.squad.maxHp) d.mult += 0.5; } } },
    { id: 'erasure-mult', name: 'Erasure Multiplier', rarity: 'rare', category: 'damage',
      description: '+0.5 mult per correct answer this battle (resets each battle).',
      hooks: {
        onBattleStart: function (c) { c.inst.state.m = 0; },
        onCorrect: function (c) { c.inst.state.m = (c.inst.state.m || 0) + 0.5; },
        modifyDamage: function (c, d) { d.mult += (c.inst.state.m || 0); } } },
    { id: 'cascade-amplifier', name: 'Cascade Amplifier', rarity: 'rare', category: 'damage',
      description: '+0.04 mult for every point of flat damage ahead of it (order matters).',
      hooks: { modifyDamage: function (c, d) { d.mult += 0.04 * d.flat; } } },
    { id: 'risky-recompile', name: 'Risky Recompile', rarity: 'rare', category: 'damage',
      description: '-1 max attack, but x2 all damage.',
      hooks: {
        onBattleStart: function (c) { c.api.addMaxAttacks(-1); },
        modifyDamage: function (c, d) { d.post *= 2; } } },
    { id: 'metadata-ring', name: 'Metadata Ring', rarity: 'legendary', category: 'damage',
      description: '+0.2 mult per artifact owned.',
      hooks: { modifyDamage: function (c, d) { d.mult += 0.2 * c.squad.artifacts.length; } } },
    { id: 'prism-focus', name: 'Prism Focus', rarity: 'rare', category: 'damage',
      description: '+12 flat damage on your first attack of each battle.',
      hooks: { modifyDamage: function (c, d) { if (c.battle && c.battle.attackIndex === 0) d.flat += 12; } } },
    /* SUSTAIN */
    { id: 'nanobot-swarm', name: 'Nanobot Swarm', rarity: 'common', category: 'sustain',
      description: 'Heal 6 on each correct answer (scales with heal power).',
      hooks: { onCorrect: function (c) { c.api.heal(healAmt(c.run, 6)); } } },
    { id: 'triage-protocol', name: 'Triage Protocol', rarity: 'common', category: 'sustain',
      description: 'Heal 8 after winning a battle (scales with heal power).',
      hooks: { onBattleWon: function (c) { c.api.heal(healAmt(c.run, 8)); } } },
    { id: 'regen-lattice', name: 'Regen Lattice', rarity: 'uncommon', category: 'sustain',
      description: 'Heal 2 after each of your attacks resolves.',
      hooks: { onAttackResolved: function (c) { c.api.heal(2); } } },
    { id: 'bio-reactor', name: 'Bio Reactor', rarity: 'uncommon', category: 'sustain',
      description: '+4 heal power (boosts every heal).',
      hooks: { onAcquire: function (c) { c.squad.healPower += 4; } } },
    { id: 'mender-overdrive', name: 'Mender Overdrive', rarity: 'rare', category: 'sustain',
      description: 'Adds your heal power as flat damage.',
      hooks: { modifyDamage: function (c, d) { d.flat += c.squad.healPower; } } },
    { id: 'vital-cache', name: 'Vital Cache', rarity: 'uncommon', category: 'sustain',
      description: 'Heal 15 at the start of each section.',
      hooks: { onSectionStart: function (c) { c.api.heal(15); } } },
    { id: 'lazarus-protocol', name: 'Lazarus Protocol', rarity: 'rare', category: 'sustain',
      description: 'Once per run, survive a lethal hit at 1 HP.',
      noSell: true, hooks: {} },
    { id: 'one-click-repair', name: 'One-Click Repair', rarity: 'uncommon', category: 'sustain',
      description: 'Using any consumable also grants +6 shield.',
      hooks: { onConsumableUsed: function (c) { c.api.addShield(6); } } },
    /* DEFENSE */
    { id: 'adaptive-shielding', name: 'Adaptive Shielding', rarity: 'common', category: 'defense',
      description: '+8 shield at battle start and before each enemy attack.',
      hooks: {
        onBattleStart: function (c) { c.api.addShield(8); },
        onEnemyAttack: function (c, incoming) { c.api.addShield(8); return incoming; } } },
    { id: 'bulwark-plating', name: 'Bulwark Plating', rarity: 'common', category: 'defense',
      description: '+(block + 6) shield at battle start.',
      hooks: { onBattleStart: function (c) { c.api.addShield(c.squad.block + 6); } } },
    { id: 'reactive-ward', name: 'Reactive Ward', rarity: 'uncommon', category: 'defense',
      description: 'Reduce each incoming attack by 3.',
      hooks: { onEnemyAttack: function (c, incoming) { return Math.max(0, incoming - 3); } } },
    { id: 'shield-overflow', name: 'Shield Overflow', rarity: 'uncommon', category: 'defense',
      description: 'If your shield fully absorbs an attack, heal 3.',
      hooks: { onEnemyAttack: function (c, incoming) { if (incoming <= c.squad.shield) c.api.heal(3); return incoming; } } },
    { id: 'damage-reflection', name: 'Damage Reflection', rarity: 'rare', category: 'defense',
      description: 'Reflect 50% of each incoming attack at the enemy.',
      hooks: { onEnemyAttack: function (c, incoming) { c.api.damageEnemy(Math.floor(incoming * 0.5)); return incoming; } } },
    { id: 'fortress-doctrine', name: 'Fortress Doctrine', rarity: 'rare', category: 'defense',
      description: '+block shield at battle start; adds half your block as flat damage.',
      hooks: {
        onBattleStart: function (c) { c.api.addShield(c.squad.block); },
        modifyDamage: function (c, d) { d.flat += Math.floor(c.squad.block * 0.5); } } },
    { id: 'reinforced-hull', name: 'Reinforced Hull', rarity: 'uncommon', category: 'defense',
      description: '+3 block (more starting shield every battle).',
      hooks: { onAcquire: function (c) { c.squad.block += 3; } } },
    { id: 'aegis-capacitor', name: 'Aegis Capacitor', rarity: 'legendary', category: 'defense',
      description: '+20 shield at battle start; all incoming attacks reduced by 30%.',
      hooks: {
        onBattleStart: function (c) { c.api.addShield(20); },
        onEnemyAttack: function (c, incoming) { return Math.round(incoming * 0.7); } } },
    { id: 'erasure-coding', name: 'Erasure Coding', rarity: 'uncommon', category: 'defense',
      description: 'Every third enemy attack is halved.',
      hooks: { onEnemyAttack: function (c, incoming) {
        var n = (c.inst.state.n || 0) + 1; c.inst.state.n = n;
        return (n % 3 === 0) ? Math.round(incoming * 0.5) : incoming; } } },
    /* ECONOMY */
    { id: 'curator', name: 'Curator', rarity: 'common', category: 'economy',
      description: '+3 coins per battle won.',
      hooks: { modifyCoinGain: function (c, coins) { return coins + 3; } } },
    { id: 'hex-mint', name: 'Hex Mint', rarity: 'common', category: 'economy',
      description: '+1 coin per section reached, per battle won.',
      hooks: { modifyCoinGain: function (c, coins) { return coins + c.section; } } },
    { id: 'salvage-array', name: 'Salvage Array', rarity: 'uncommon', category: 'economy',
      description: 'Win a battle: gain coins equal to 5% of enemy max HP.',
      hooks: { onBattleWon: function (c) { c.api.addCoins(Math.round(c.enemy.maxHp * 0.05)); } } },
    { id: 'interest-ledger', name: 'Interest Ledger', rarity: 'uncommon', category: 'economy',
      description: 'On entering a shop, gain 10% of saved coins (max 5).',
      hooks: { onShopEnter: function (c) { c.api.addCoins(Math.min(5, Math.floor(c.squad.coins / 10))); } } },
    { id: 'compression', name: 'Compression', rarity: 'uncommon', category: 'economy',
      description: 'Shop prices -20%.', hooks: {} },
    { id: 'arbitrage', name: 'Arbitrage', rarity: 'rare', category: 'economy',
      description: 'Coins from battles increased by 50%.',
      hooks: { modifyCoinGain: function (c, coins) { return coins * 1.5; } } },
    { id: 'golden-cache', name: 'Golden Cache', rarity: 'legendary', category: 'economy',
      description: '+10 coins per battle and an extra 10% off shop prices.',
      hooks: { modifyCoinGain: function (c, coins) { return coins + 10; } } },
    { id: 'snapshot-ledger', name: 'Snapshot Ledger', rarity: 'common', category: 'economy',
      description: '+1 coin on every correct answer.',
      hooks: { onCorrect: function (c) { c.api.addCoins(1); } } },
    /* UTILITY */
    { id: 'witness-daemon', name: 'Witness Daemon', rarity: 'uncommon', category: 'utility',
      description: 'Reveal one wrong option on every question.',
      hooks: { onQuestionShown: function (c) { c.api.revealWrong(); } } },
    { id: 'fifty-fifty', name: 'Fifty-Fifty', rarity: 'uncommon', category: 'utility',
      description: 'Reveal two wrong options on every question.',
      hooks: { onQuestionShown: function (c) { c.api.revealWrong(); c.api.revealWrong(); } } },
    { id: 'ntp-sync', name: 'NTP Sync', rarity: 'common', category: 'utility',
      description: '+3 shield at every battle start.',   // (v0.108.0, G4) was a no-op timer artifact (K9 removed all timer reads)
      hooks: { onBattleStart: function (c) { c.api.addShield(3); } } },
    { id: 'prism-beam', name: 'Prism Beam', rarity: 'rare', category: 'utility',
      description: '+1 max attack every battle.',
      hooks: { onBattleStart: function (c) { c.api.addMaxAttacks(1); } } },
    { id: 'retry-buffer', name: 'Retry Buffer', rarity: 'rare', category: 'utility',
      description: 'First wrong answer each battle is refunded (re-answer, no counter).',
      hooks: { onWrong: function (c) { if (!c.battle.retryUsed) { c.battle.retryUsed = true; c.battle.refundAttack = true; } } } },
    { id: 'cold-tier', name: 'Cold Tier', rarity: 'uncommon', category: 'utility',
      description: 'First wrong answer each battle: enemy does not counter-attack.',
      hooks: { onWrong: function (c) { if (!c.battle.coldTierUsed) { c.battle.coldTierUsed = true; c.battle.skipEnemyCounter = true; } } } },
    { id: 'intel-cache', name: 'Intel Cache', rarity: 'common', category: 'utility',
      description: 'Always shows the enemy\u2019s full incoming attack ahead of time.',
      hooks: { onBattleStart: function (c) { c.run.flags.showAllIntent = true; } } },
    /* RISK */
    { id: 'glass-cannon', name: 'Glass Cannon', rarity: 'rare', category: 'risk',
      description: '+10 flat damage, but -12 max HP.',
      hooks: {
        onAcquire: function (c) { c.api.addMaxHp(-12); },
        modifyDamage: function (c, d) { d.flat += 10; } } },
    { id: 'overclock-gambit', name: 'Overclock Gambit', rarity: 'uncommon', category: 'risk',
      description: '+0.6 mult, but each correct answer costs 2 HP (never lethal).',
      hooks: {
        modifyDamage: function (c, d) { d.mult += 0.6; },
        onCorrect: function (c) { c.api.hurt(2); } } },
    { id: 'blood-pact', name: 'Blood Pact', rarity: 'rare', category: 'risk',
      description: 'Adds half of your missing HP as flat damage.',
      hooks: { modifyDamage: function (c, d) { d.flat += Math.floor((c.squad.maxHp - c.squad.hp) * 0.5); } } },
    { id: 'all-in', name: 'All In', rarity: 'uncommon', category: 'risk',
      description: '+1.0 mult on your final attack of a battle.',
      hooks: { modifyDamage: function (c, d) { if (c.battle.attackIndex >= c.battle.maxAttacks - 1) d.mult += 1.0; } } },
    { id: 'double-or-nothing', name: 'Double or Nothing', rarity: 'rare', category: 'risk',
      description: '+0.5 mult, but a wrong answer heals the enemy 10% of max HP.',
      hooks: {
        modifyDamage: function (c, d) { d.mult += 0.5; },
        onWrong: function (c) { c.api.healEnemy(Math.round(c.enemy.maxHp * 0.1)); } } },
    { id: 'recompile-core', name: 'Recompile Core', rarity: 'uncommon', category: 'risk',
      description: '+0.15 mult, -1 max HP.',
      hooks: {
        onAcquire: function (c) { c.api.addMaxHp(-1); },
        modifyDamage: function (c, d) { d.mult += 0.15; } } },
    /* SCALING */
    { id: 'foundation', name: 'Foundation', rarity: 'uncommon', category: 'scaling',
      description: '+2 max HP after each battle won (permanent).',
      hooks: { onBattleWon: function (c) { c.api.addMaxHp(2); } } },
    { id: 'genesis-block', name: 'Genesis Block', rarity: 'rare', category: 'scaling',
      description: '+1 base power at the start of each section (permanent).',
      hooks: { onSectionStart: function (c) { c.api.addBasePower(1); } } },
    { id: 'compounding-core', name: 'Compounding Core', rarity: 'uncommon', category: 'scaling',
      description: '+0.5 flat damage per correct answer, permanent for the run.',
      hooks: {
        onCorrect: function (c) { c.inst.state.f = (c.inst.state.f || 0) + 0.5; },
        modifyDamage: function (c, d) { d.flat += (c.inst.state.f || 0); } } },
    { id: 'momentum-engine', name: 'Momentum Engine', rarity: 'rare', category: 'scaling',
      description: '+0.1 mult per battle won, permanent for the run.',
      hooks: {
        onBattleWon: function (c) { c.inst.state.m = (c.inst.state.m || 0) + 0.1; },
        modifyDamage: function (c, d) { d.mult += (c.inst.state.m || 0); } } },
    { id: 'archive-expansion', name: 'Archive Expansion', rarity: 'uncommon', category: 'scaling',
      description: '+5 max HP and heal 5 at the start of each section.',
      hooks: { onSectionStart: function (c) { c.api.addMaxHp(5); c.api.heal(5); } } },
    { id: 'singularity-seed', name: 'Singularity Seed', rarity: 'legendary', category: 'scaling',
      description: '+1 base power and +1 max HP after each battle won (permanent).',
      hooks: { onBattleWon: function (c) { c.api.addBasePower(1); c.api.addMaxHp(1); } } },
    { id: 'cluster-expand', name: 'Cluster Expand', rarity: 'uncommon', category: 'scaling',
      description: '+1 block after each battle won (permanent).',
      hooks: { onBattleWon: function (c) { c.squad.block += 1; } } },
    /* DOMAIN */
    { id: 'data-locality', name: 'Data Locality', rarity: 'uncommon', category: 'domain', domain: 'storage',
      description: 'Correct storage-domain answers deal x2 damage.',
      hooks: { modifyDamage: function (c, d) { if (c.question && c.question.domain === 'storage') d.post *= 2; } } },
    { id: 'fabric-weave', name: 'Fabric Weave', rarity: 'uncommon', category: 'domain', domain: 'networking',
      description: '+6 flat damage on networking-domain questions.',
      hooks: { modifyDamage: function (c, d) { if (c.question && c.question.domain === 'networking') d.flat += 6; } } },
    { id: 'flow-firewall', name: 'Flow Firewall', rarity: 'uncommon', category: 'domain', domain: 'security',
      description: '+0.8 mult on security-domain questions.',
      hooks: { modifyDamage: function (c, d) { if (c.question && c.question.domain === 'security') d.mult += 0.8; } } },
    { id: 'lcm-pipeline', name: 'LCM Pipeline', rarity: 'uncommon', category: 'domain', domain: 'lifecycle',
      description: '+0.8 mult on lifecycle-domain questions.',
      hooks: { modifyDamage: function (c, d) { if (c.question && c.question.domain === 'lifecycle') d.mult += 0.8; } } },
    { id: 'hypervisor-core', name: 'Hypervisor Core', rarity: 'uncommon', category: 'domain', domain: 'vms',
      description: '+0.6 mult on VM-domain questions.',
      hooks: { modifyDamage: function (c, d) { if (c.question && c.question.domain === 'vms') d.mult += 0.6; } } },
    { id: 'continuity-vault', name: 'Continuity Vault', rarity: 'uncommon', category: 'domain', domain: 'data-protection',
      description: 'Correct data-protection answers heal 10.',
      hooks: { onCorrect: function (c) { if (c.question && c.question.domain === 'data-protection') c.api.heal(10); } } },
    { id: 'blueprint-matrix', name: 'Blueprint Matrix', rarity: 'rare', category: 'domain', domain: 'architecture',
      description: '+5 flat damage and +2 coins on architecture questions.',
      hooks: {
        modifyDamage: function (c, d) { if (c.question && c.question.domain === 'architecture') d.flat += 5; },
        onCorrect: function (c) { if (c.question && c.question.domain === 'architecture') c.api.addCoins(2); } } },
    { id: 'telemetry-lens', name: 'Telemetry Lens', rarity: 'uncommon', category: 'domain', domain: 'monitoring',
      description: '+0.5 mult on monitoring questions and reveals a wrong option there.',
      hooks: {
        onQuestionShown: function (c) { if (c.question && c.question.domain === 'monitoring') c.api.revealWrong(); },
        modifyDamage: function (c, d) { if (c.question && c.question.domain === 'monitoring') d.mult += 0.5; } } }
  ];
  var ARTIFACTS_BY_ID = {};
  for (var ai = 0; ai < ARTIFACTS.length; ai++) ARTIFACTS_BY_ID[ARTIFACTS[ai].id] = ARTIFACTS[ai];
  var Q5_GATED = ARTIFACTS.filter(function (a) { return a.q5; }).map(function (a) { return a.id; });

  var CONSUMABLES = {
    repair: { id: 'repair', name: 'Repair Kit', description: 'Heal HP.' },
    recharge: { id: 'recharge', name: 'Recharge', description: 'Restore shield.' },
    intel: { id: 'intel', name: 'Intel', description: 'Reveal the enemy\u2019s full incoming attack for this battle.' }
  };
  var CONSUMABLE_IDS = ['repair', 'recharge', 'intel'];   // (v0.98.0, K3) Purge cut (Jason)

  // ---- 4. Enemy / boss ----
  function enemyName(section, boss, mechanic) {
    if (boss) {
      var label = mechanic === 'shielded' ? 'Bulwark' : (mechanic === 'enrage' ? 'Ravager' : 'Sentinel');
      return 'BCM ' + label + ' Mk ' + section;
    }
    var names = ['Skirmisher', 'Interceptor', 'Marauder', 'Lancer', 'Reaver', 'Stalker'];
    return 'BCM ' + names[(section + 1) % names.length];
  }
  function bossOrNormalCoins(section, round, boss) {
    var c = CONFIG.coinBase + section + round;
    return boss ? Math.round(c * CONFIG.bossCoinMult) : c;
  }
  function makeEnemy(run) {
    var s = run.section, r = run.round, boss = (r === CONFIG.roundsPerSection);
    var hp = Math.round((CONFIG.enemyBaseHp + (r - 1) * CONFIG.hpPerRound) * (1 + (s - 1) * CONFIG.hpPerSection));
    var intent = Math.round((CONFIG.intentBase + (r - 1) * CONFIG.intentPerRound) * (1 + (s - 1) * CONFIG.intentPerSection));
    var mechanic = null, pattern = 'flat';
    if (boss) {
      hp = Math.round(hp * CONFIG.bossHpMult);
      mechanic = BOSS_MECHANICS[(s - 1) % BOSS_MECHANICS.length];
      pattern = (mechanic === 'enrage') ? 'ramp' : 'flat';
    } else { pattern = ENEMY_PATTERNS[(r - 1) % ENEMY_PATTERNS.length]; }
    var step = Math.max(1, Math.round(intent * 0.4));
    if (mechanic === 'enrage') step = Math.max(2, Math.round(intent * 0.6));
    return {
      id: 'e-s' + s + '-r' + r, name: enemyName(s, boss, mechanic),
      boss: boss, mechanic: mechanic, hp: hp, maxHp: hp,
      intent: intent, baseIntent: intent, intentStep: step, pattern: pattern,
      intentToggle: false, shieldUp: false, locked: !!(boss && mechanic === 'gated'),
      rewardCoins: bossOrNormalCoins(s, r, boss)
    };
  }
  function currentIntent(run) {
    var e = run.battle.enemy;
    if (e.pattern === 'alternating') return e.intentToggle ? e.intent * 2 : 0;
    return e.intent;
  }
  function advanceIntent(run) {
    var e = run.battle.enemy;
    if (e.pattern === 'ramp') e.intent += e.intentStep;
    else if (e.pattern === 'alternating') e.intentToggle = !e.intentToggle;
  }

  // ---- 5. Engine ----
  function makeApi(run) {
    var s = run.squad;
    return {
      heal: function (n) { s.hp = clamp(s.hp + Math.round(n), 0, s.maxHp); },
      hurt: function (n) { s.hp = Math.max(1, s.hp - Math.round(n)); },
      addShield: function (n) { s.shield = Math.max(0, s.shield + Math.round(n)); },
      addCoins: function (n) { s.coins = Math.max(0, s.coins + Math.round(n)); },
      addMaxHp: function (n) { n = Math.round(n); s.maxHp = Math.max(1, s.maxHp + n); if (n > 0) s.hp += n; s.hp = clamp(s.hp, 0, s.maxHp); },
      addBasePower: function (n) { s.basePower = Math.max(0, s.basePower + n); },
      addMaxAttacks: function (n) { if (run.battle) run.battle.maxAttacks = Math.max(1, run.battle.maxAttacks + n); },
      damageEnemy: function (n) { if (run.battle && run.battle.enemy) run.battle.enemy.hp -= Math.max(0, Math.round(n)); },
      healEnemy: function (n) { if (run.battle && run.battle.enemy) { var e = run.battle.enemy; e.hp = Math.min(e.maxHp, e.hp + Math.round(n)); } },
      grantConsumable: function (id) { if (run.consumables.length < CONFIG.consumableCap) run.consumables.push(id); },
      revealWrong: function () { revealOneWrong(run); }
    };
  }
  function makeArtCtx(run, inst, extra) {
    var b = run.battle;
    return {
      run: run, section: run.section, round: run.round,
      squad: run.squad, enemy: b ? b.enemy : null, question: b ? b.question : null,
      battle: b, inst: inst, rng: run.rng,
      log: function (msg) { run.log.push(msg); }, api: run._api,
      answerMs: (extra && extra.answerMs != null) ? extra.answerMs : null,
      streak: b ? b.correctStreak : 0,
      consumable: (extra && extra.consumable) || null
    };
  }
  function fireSide(run, hookName, extra) {
    var arts = run.squad.artifacts;
    for (var i = 0; i < arts.length; i++) {
      var h = arts[i].def.hooks[hookName];
      if (h) h(makeArtCtx(run, arts[i], extra));
    }
  }
  function hasArtifact(run, id) {
    var arts = run.squad.artifacts;
    for (var i = 0; i < arts.length; i++) if (arts[i].def.id === id) return true;
    return false;
  }
  function revealOneWrong(run) {
    var b = run.battle; if (!b || !b.question) return;
    var q = b.question, n = q.options.length;
    // (v0.90.0, review) multi-answer questions carry correctIndices with correctIndex
    // undefined — the old check could reveal a CORRECT option as "wrong" (a false key).
    var cs = Array.isArray(q.correctIndices) && q.correctIndices.length ? q.correctIndices : [q.correctIndex];
    for (var i = 0; i < n; i++) {
      if (cs.indexOf(i) >= 0) continue;
      if (b.revealed.indexOf(i) >= 0) continue;
      b.revealed.push(i); return;
    }
  }
  function equipArtifact(run, id, fireAcquire) {
    var def = ARTIFACTS_BY_ID[id];
    if (!def) throw new Error('Unknown artifact: ' + id);
    if (run.squad.artifacts.length >= CONFIG.maxArtifacts) return { ok: false, reason: 'cap' };
    var inst = { def: def, state: {} };
    run.squad.artifacts.push(inst);
    if (fireAcquire !== false && def.hooks.onAcquire) def.hooks.onAcquire(makeArtCtx(run, inst));
    return { ok: true, inst: inst };
  }
  function replaceArtifact(run, slotIndex, id) {
    var def = ARTIFACTS_BY_ID[id];
    if (!def) throw new Error('Unknown artifact: ' + id);
    if (slotIndex < 0 || slotIndex >= run.squad.artifacts.length) return { ok: false, reason: 'slot' };
    var inst = { def: def, state: {} };
    run.squad.artifacts[slotIndex] = inst;
    if (def.hooks.onAcquire) def.hooks.onAcquire(makeArtCtx(run, inst));
    return { ok: true, inst: inst };
  }
  function computeDamage(run, answerMs) {
    var d = { flat: run.squad.basePower, mult: 1, post: 1 };
    var arts = run.squad.artifacts;
    for (var i = 0; i < arts.length; i++) {
      var h = arts[i].def.hooks.modifyDamage;
      if (h) h(makeArtCtx(run, arts[i], { answerMs: answerMs }), d);
    }
    var v = d.flat * d.mult * d.post;
    if (!isFinite(v) || isNaN(v) || v < 0) v = 0;
    v = Math.round(v);
    if (v > CONFIG.damageCap) v = CONFIG.damageCap;
    return v;
  }
  function applyIncoming(run, incomingRaw) {
    var incoming = incomingRaw, arts = run.squad.artifacts;
    for (var i = 0; i < arts.length; i++) {
      var h = arts[i].def.hooks.onEnemyAttack;
      if (h) { var r = h(makeArtCtx(run, arts[i]), incoming); if (typeof r === 'number' && isFinite(r)) incoming = Math.max(0, r); }
    }
    incoming = Math.max(0, Math.round(incoming));
    var s = run.squad;
    var fromShield = Math.min(s.shield, incoming);
    s.shield -= fromShield;
    var toHp = incoming - fromShield;
    run.battle.lastIncoming = incoming; run.battle.lastToHp = toHp;
    if (toHp > 0) {
      if (s.hp - toHp <= 0) {
        if (hasArtifact(run, 'lazarus-protocol') && !run.flags.lazarusUsed) {
          run.flags.lazarusUsed = true; s.hp = 1; run.log.push('Lazarus Protocol: survived at 1 HP');
        } else { s.hp = 0; }
      } else { s.hp -= toHp; }
    }
  }
  function startBattle(run) {
    var enemy = makeEnemy(run);
    run.battle = {
      enemy: enemy, attackIndex: 0, maxAttacks: CONFIG.maxAttacks, over: false,
      correctCount: 0, wrongCount: 0, correctStreak: 0,
      seenIds: [], question: null, reason: null, revealed: [],
      oneShot: false, retryUsed: false, coldTierUsed: false,
      refundAttack: false, skipEnemyCounter: false,
      lastDamage: 0, lastIncoming: 0, lastToHp: 0
    };
    run.phase = 'battle';
    run.squad.shield = run.squad.startShield || 0;   // (v0.99.0, K10) fittings can raise the floor; no carry-over otherwise
    fireSide(run, 'onBattleStart', {});
    run._api.addShield(run.squad.block);
  }
  function drawQuestion(run) {
    var b = run.battle; if (!b || b.over) return null;
    var band = sectionBand(run.section);
    if (b.enemy.boss && b.enemy.mechanic === 'gated' && b.enemy.locked) band = [CONFIG.gateDifficulty, 3];
    var draw = run.ctx.questions.next({ game: 'KBB', difficultyBand: band, excludeIds: b.seenIds.slice(), rng: run.rng, shuffle: true });
    var q = draw ? draw.question : null;
    b.question = q; b.reason = draw ? draw.reason : null; b.revealed = [];
    if (q) b.seenIds.push(q.id);
    b.enemy.shieldUp = b.enemy.boss && b.enemy.mechanic === 'shielded' && (b.attackIndex % 2 === 1);
    fireSide(run, 'onQuestionShown', {});
    return { question: q, reason: b.reason, revealed: b.revealed.slice(), intent: currentIntent(run), shieldUp: b.enemy.shieldUp, locked: b.enemy.locked };
  }
  function scoreOf(run) { return run.depthClearedSection * 100 + run.depthClearedRound; }
  function depthLabel(run) { return run.depthClearedSection + '-' + run.depthClearedRound; }
  function finalizeLoss(run) {
    if (run.ctx.telemetry) run.ctx.telemetry.emit({ t: 'run_ended', game: 'KBB', result: 'loss', depth: depthLabel(run), score: scoreOf(run) });
  }
  function winBattle(run, res) {
    var b = run.battle; b.over = true; res.win = true;
    var coins = b.enemy.rewardCoins, arts = run.squad.artifacts;
    for (var i = 0; i < arts.length; i++) {
      var h = arts[i].def.hooks.modifyCoinGain;
      if (h) { var r = h(makeArtCtx(run, arts[i]), coins); if (typeof r === 'number' && isFinite(r)) coins = Math.max(0, r); }
    }
    coins = Math.max(0, Math.round(coins));
    run.squad.coins = Math.max(0, run.squad.coins + coins);
    res.coinsGained = coins;
    fireSide(run, 'onBattleWon', {});
    run.depthClearedSection = run.section; run.depthClearedRound = run.round;
    run.bestScore = Math.max(run.bestScore, scoreOf(run));
    run.phase = 'shop'; buildShop(run);
    return res;
  }
  function isMultiQ(q) { return !!(q && Array.isArray(q.correctIndices) && q.correctIndices.length); }
  function gradeAnswer(q, chosen) {
    if (isMultiQ(q)) {
      if (!Array.isArray(chosen) || chosen.length !== q.correctIndices.length) return false;
      for (var i = 0; i < q.correctIndices.length; i++) if (chosen.indexOf(q.correctIndices[i]) < 0) return false;
      return true;
    }
    return chosen === (q ? q.correctIndex : -1);
  }
  // (v0.46.0 K5 agency) `action`: 'attack' (default — unchanged pipeline), 'brace' (a correct
  // answer raises shield by squad.block), or 'repair' (a correct answer heals squad.healPower).
  // Answers stay the engine: a WRONG answer does nothing regardless of the chosen action, the
  // enemy still counterattacks after every turn, and the turn still counts toward maxAttacks.
  function submitAnswer(run, chosen, answerMs, action) {
    var b = run.battle;
    if (!b || b.over) return { error: 'no-active-battle' };
    var q = b.question;
    if (!q) return { error: 'no-question' };
    var act = (action === 'brace' || action === 'repair') ? action : 'attack';
    var correct = gradeAnswer(q, chosen);
    if (run.ctx.mastery) run.ctx.mastery.record(q.id, correct, { game: 'KBB' });
    if (run.ctx.telemetry) run.ctx.telemetry.emit({ t: 'question_answered', game: 'KBB', id: q.id, correct: correct, ms: (answerMs == null ? 0 : answerMs), difficulty: q.difficulty });
    var res = { correct: correct, action: act, damage: 0, blocked: false, shieldGained: 0, healed: 0, enemyHpBefore: b.enemy.hp, win: false, loss: false, lossReason: null, refunded: false, enemyAttacked: false, incoming: 0, coinsGained: 0 };
    if (correct) {
      b.correctCount++; b.correctStreak++;
      if (b.enemy.boss && b.enemy.mechanic === 'gated' && b.enemy.locked && q.difficulty >= CONFIG.gateDifficulty) {
        b.enemy.locked = false; run.log.push(b.enemy.name + ': core exposed');   // knowledge unlocks the core, whatever the action
      }
      if (act === 'attack') {
        var blockedThisTurn = (b.enemy.boss && b.enemy.mechanic === 'shielded' && b.enemy.shieldUp) || b.enemy.locked;
        var dmg = blockedThisTurn ? 0 : computeDamage(run, answerMs);
        if (blockedThisTurn) res.blocked = true;
        res.damage = dmg; b.enemy.hp -= dmg; b.lastDamage = dmg;
        if (b.attackIndex === 0 && b.enemy.hp <= 0) b.oneShot = true;
      } else if (act === 'brace') {
        res.shieldGained = run.squad.block; b.lastDamage = 0;
        run._api.addShield(res.shieldGained);
        run.log.push('Brace: +' + res.shieldGained + ' shield');
      } else {                                                    // repair
        var hpBefore = run.squad.hp; b.lastDamage = 0;
        run._api.heal(run.squad.healPower);
        res.healed = run.squad.hp - hpBefore;
        run.log.push('Repair: +' + res.healed + ' HP');
      }
      fireSide(run, 'onCorrect', { answerMs: answerMs });
      fireSide(run, 'onAttackResolved', { answerMs: answerMs });
    } else {
      b.wrongCount++; b.correctStreak = 0;
      fireSide(run, 'onWrong', { answerMs: answerMs });
      fireSide(run, 'onAttackResolved', { answerMs: answerMs });
    }
    if (b.refundAttack) {
      b.refundAttack = false; res.refunded = true;
      if (b.enemy.hp <= 0) return winBattle(run, res);
      b.question = null; return res;
    }
    if (b.enemy.hp <= 0) return winBattle(run, res);
    b.attackIndex++;
    if (b.attackIndex >= b.maxAttacks) {
      res.loss = true; res.lossReason = 'finishing-blow';
      b.over = true; run.phase = 'lost'; finalizeLoss(run); return res;
    }
    if (b.skipEnemyCounter) { b.skipEnemyCounter = false; }
    else {
      res.enemyAttacked = true;
      applyIncoming(run, currentIntent(run));
      res.incoming = b.lastIncoming; res.toHp = b.lastToHp; advanceIntent(run);
      if (run.squad.hp <= 0) { res.loss = true; res.lossReason = 'enemy-kill'; b.over = true; run.phase = 'lost'; finalizeLoss(run); return res; }
    }
    b.question = null; return res;
  }

  // ---- Shop ----
  function priceDiscount(run) {
    var f = 1;
    if (hasArtifact(run, 'compression')) f -= 0.2;
    if (hasArtifact(run, 'golden-cache')) f -= 0.1;
    return Math.max(CONFIG.minPriceFactor, f);
  }
  function artifactPrice(run, rarity) {
    var base = CONFIG.artifactPrice[rarity] || 10;
    return Math.max(1, Math.round(base * (1 + (run.section - 1) * CONFIG.pricePerSection) * priceDiscount(run)));
  }
  function consumablePrice(run) {
    return Math.max(1, Math.round(6 * (1 + (run.section - 1) * CONFIG.pricePerSection) * priceDiscount(run)));
  }
  function rerollCost(run) { return CONFIG.rerollBase + (run.section - 1) * CONFIG.rerollPerSection; }
  // (v0.99.0, K4, Jason) round 1 rolls 64/30/5/1 C/U/R/L; rarer creeps in as the run deepens
  // (commons floor 30%, legendaries cap 8%) — no OP artifact can headline the first shop.
  function rarityWeightsFor(run) {
    var d = (run.section - 1) + (run.round - 1) / CONFIG.roundsPerSection;
    var c = Math.max(0.30, 0.64 - 0.06 * d);
    var l = Math.min(0.08, 0.01 + 0.012 * d);
    var r = Math.min(0.20, 0.05 + 0.025 * d);
    var u = Math.max(0.15, 1 - c - l - r);
    return { common: c, uncommon: u, rare: r, legendary: l };
  }
  function weightedPick(pool, rng, weights) {
    if (!pool.length) return null;
    var W2 = weights || CONFIG.rarityWeights;
    var total = 0, i;
    for (i = 0; i < pool.length; i++) total += (W2[pool[i].rarity] || 0.1);
    var t = rng.next() * total, acc = 0;
    for (i = 0; i < pool.length; i++) { acc += (W2[pool[i].rarity] || 0.1); if (t <= acc) return pool[i]; }
    return pool[pool.length - 1];
  }
  function rollArtifactOffers(run) {
    var owned = {}, i;
    for (i = 0; i < run.squad.artifacts.length; i++) owned[run.squad.artifacts[i].def.id] = true;
    var avail = ARTIFACTS.filter(function (a) { return !owned[a.id]; });
    var offers = [], n = Math.min(CONFIG.shopArtifactCount, avail.length);
    for (var k = 0; k < n; k++) {
      var pick = weightedPick(avail, run.rng, rarityWeightsFor(run)); if (!pick) break;
      offers.push({ id: pick.id, price: artifactPrice(run, pick.rarity) });
      avail.splice(avail.indexOf(pick), 1);
    }
    run.shop.artifacts = offers;
  }
  function rollConsumableOffers(run) {
    var offers = [];
    for (var k = 0; k < CONFIG.shopConsumableCount; k++) offers.push({ id: run.rng.pick(CONSUMABLE_IDS), price: consumablePrice(run) });
    run.shop.consumables = offers;
  }
  var BOOSTS = [   // (v0.99.0, K10, Jason) permanent +1 fittings; ONE purchase per shop visit
    { id: 'fit-hp',     name: '+1 Hull plating',  stat: 'hp' },
    { id: 'fit-shield', name: '+1 Shield floor',  stat: 'shield' },
    { id: 'fit-block',  name: '+1 Block',         stat: 'block' },
    { id: 'fit-power',  name: '+1 Attack power',  stat: 'power' }
  ];
  function boostPrice(run) { return CONFIG.boostPriceBase + (run.section - 1) * CONFIG.boostPricePerSection; }
  function shopBuyBoost(run, idx) {
    if (run.phase !== 'shop' || !run.shop) return { ok: false, reason: 'not-shop' };
    if (run.shop.boostBought) return { ok: false, reason: 'one-per-shop' };
    var bDef = BOOSTS[idx]; if (!bDef) return { ok: false, reason: 'no-offer' };
    var price = boostPrice(run);
    if (run.squad.coins < price) return { ok: false, reason: 'coins' };
    run.squad.coins -= price; run.shop.boostBought = true;
    var s = run.squad;
    if (bDef.stat === 'hp') { s.maxHp += 1; s.hp += 1; }
    else if (bDef.stat === 'shield') { s.startShield = (s.startShield || 0) + 1; }
    else if (bDef.stat === 'block') { s.block += 1; }
    else { s.basePower += 1; }
    if (run.ctx.telemetry) run.ctx.telemetry.emit({ t: 'shop_purchase', game: 'KBB', itemId: bDef.id, cost: price });
    return { ok: true, stat: bDef.stat };
  }
  function buildShop(run) {
    fireSide(run, 'onShopEnter', {});
    run.shop = { artifacts: [], consumables: [], rerollCost: rerollCost(run), boostBought: false };
    rollArtifactOffers(run); rollConsumableOffers(run);
  }
  function shopBuyArtifact(run, offerIndex) {
    if (run.phase !== 'shop' || !run.shop) return { ok: false, reason: 'not-shop' };
    var offer = run.shop.artifacts[offerIndex];
    if (!offer) return { ok: false, reason: 'no-offer' };
    if (run.squad.coins < offer.price) return { ok: false, reason: 'coins' };
    if (run.squad.artifacts.length >= CONFIG.maxArtifacts) return { ok: false, reason: 'cap' };
    run.squad.coins -= offer.price;
    var r = equipArtifact(run, offer.id, true);
    if (run.ctx.telemetry) run.ctx.telemetry.emit({ t: 'shop_purchase', game: 'KBB', itemId: offer.id, cost: offer.price });
    run.shop.artifacts.splice(offerIndex, 1);
    return { ok: true, inst: r.inst };
  }
  function shopReplaceArtifact(run, offerIndex, slotIndex) {
    if (run.phase !== 'shop' || !run.shop) return { ok: false, reason: 'not-shop' };
    var offer = run.shop.artifacts[offerIndex];
    if (!offer) return { ok: false, reason: 'no-offer' };
    if (run.squad.coins < offer.price) return { ok: false, reason: 'coins' };
    run.squad.coins -= offer.price;
    var r = replaceArtifact(run, slotIndex, offer.id);
    if (run.ctx.telemetry) run.ctx.telemetry.emit({ t: 'shop_purchase', game: 'KBB', itemId: offer.id, cost: offer.price });
    run.shop.artifacts.splice(offerIndex, 1);
    return r;
  }
  function shopBuyConsumable(run, offerIndex) {
    if (run.phase !== 'shop' || !run.shop) return { ok: false, reason: 'not-shop' };
    var offer = run.shop.consumables[offerIndex];
    if (!offer) return { ok: false, reason: 'no-offer' };
    if (run.squad.coins < offer.price) return { ok: false, reason: 'coins' };
    if (run.consumables.length >= CONFIG.consumableCap) return { ok: false, reason: 'inv-full' };
    run.squad.coins -= offer.price;
    run.consumables.push(offer.id);
    if (run.ctx.telemetry) run.ctx.telemetry.emit({ t: 'shop_purchase', game: 'KBB', itemId: offer.id, cost: offer.price });
    run.shop.consumables.splice(offerIndex, 1);
    return { ok: true };
  }
  function shopReroll(run) {
    if (run.phase !== 'shop' || !run.shop) return { ok: false, reason: 'not-shop' };
    var cost = run.shop.rerollCost;
    if (run.squad.coins < cost) return { ok: false, reason: 'coins' };
    run.squad.coins -= cost;
    rollArtifactOffers(run); rollConsumableOffers(run);
    run.shop.rerollCost = cost + 2;
    return { ok: true };
  }
  // ---- Sell (P4 rule; P5 builds the drag-to-sell UI on top of this) ----
  // Unsellable: legendaries, once-per-run items (noSell), and anything whose
  // onAcquire applied a permanent effect we can't cleanly reverse ("cursed").
  function isSellable(def) {
    return !!def && def.rarity !== 'legendary' && !def.noSell && !(def.hooks && def.hooks.onAcquire);
  }
  function sellRefund(def) {
    return Math.max(1, Math.round(0.5 * (CONFIG.artifactPrice[def.rarity] || 6))); // 50% of base price
  }
  function sellArtifact(run, slotIndex) {
    var arts = run.squad.artifacts;
    if (slotIndex < 0 || slotIndex >= arts.length) return { ok: false, reason: 'slot' };
    var def = arts[slotIndex].def;
    if (!isSellable(def)) return { ok: false, reason: 'unsellable' };
    var refund = sellRefund(def);
    arts.splice(slotIndex, 1);
    run.squad.coins = Math.max(0, run.squad.coins + refund);
    if (def.hooks && def.hooks.onRemove) def.hooks.onRemove(makeArtCtx(run, { def: def, state: {} }));
    if (run.ctx.telemetry) run.ctx.telemetry.emit({ t: 'artifact_sold', game: 'KBB', itemId: def.id, refund: refund });
    run.log.push('Sold ' + def.name + ' (+' + refund + ')');
    return { ok: true, refund: refund };
  }
  function useConsumable(run, id) {
    var idx = run.consumables.indexOf(id);
    if (idx < 0) return { ok: false, reason: 'not-owned' };
    if (id === 'repair') { run._consumableAmt = CONFIG.repairHeal; fireSide(run, 'onConsumableUsed', { consumable: id }); run._api.heal(run._consumableAmt); }
    else if (id === 'recharge') { run._consumableAmt = CONFIG.rechargeShield; fireSide(run, 'onConsumableUsed', { consumable: id }); run._api.addShield(run._consumableAmt); }
else if (id === 'intel') { run.flags.showAllIntent = true; fireSide(run, 'onConsumableUsed', { consumable: id }); }
    else return { ok: false, reason: 'unknown' };
    run.consumables.splice(idx, 1);
    return { ok: true };
  }
  function leaveShop(run) {
    if (run.phase !== 'shop') return { ok: false, reason: 'not-shop' };
    if (run.round < CONFIG.roundsPerSection) { run.round++; }
    else { run.section++; run.round = 1; fireSide(run, 'onSectionStart', {}); }
    run.shop = null;
    startBattle(run);
    return { ok: true };
  }

  // ---- Run creation ----
  function createRun(ctx, opts) {
    opts = opts || {};
    if (!ctx || !ctx.questions) throw new Error('createRun: ctx.questions required');
    var seed = (opts.seed != null) ? opts.seed : (ctx.rng ? ctx.rng.int(2147483647) : 12345);
    var rng = ctx.rng ? ctx.rng.fork('kbb-run:' + seed) : makeRng(seed);
    var squad = {
      hp: CONFIG.squad.hp, maxHp: CONFIG.squad.maxHp, shield: 0, startShield: CONFIG.squad.startShield || 0,
      basePower: CONFIG.squad.basePower, block: CONFIG.squad.block,
      healPower: CONFIG.squad.healPower, coins: CONFIG.squad.coins, artifacts: []
    };
    var run = {
      ctx: ctx, seed: seed, rng: rng, section: 1, round: 1, squad: squad,
      consumables: [], phase: 'battle', shop: null, battle: null, flags: {}, log: [],
      depthClearedSection: 0, depthClearedRound: 0, bestScore: 0
    };
    run._api = makeApi(run);
    fireSide(run, 'onRunStart', {});
    fireSide(run, 'onSectionStart', {});
    if (opts.preRunShop) { run._preRun = true; run.phase = 'shop'; buildShop(run); }  // loadout shop before the first battle (round stays 1)
    else { startBattle(run); }
    return run;
  }
  // Leave the pre-run loadout shop into the very first battle WITHOUT advancing the round
  // (leaveShop() increments the round — wrong for the opening shop).
  function startDungeon(run) {
    if (!run._preRun || run.phase !== 'shop') return { ok: false, reason: 'not-prerun' };
    run._preRun = false; run.shop = null;
    startBattle(run);
    return { ok: true };
  }

  // ---- Public engine API ----
  var KBB = {
    version: '0.2.0',
    CONFIG: CONFIG, ARTIFACTS: ARTIFACTS, ARTIFACTS_BY_ID: ARTIFACTS_BY_ID,
    Q5_GATED: Q5_GATED, CONSUMABLES: CONSUMABLES, CONSUMABLE_IDS: CONSUMABLE_IDS,
    BOSS_MECHANICS: BOSS_MECHANICS, ENEMY_PATTERNS: ENEMY_PATTERNS,
    makeRng: makeRng, sectionBand: sectionBand,
    createRun: createRun, startBattle: startBattle, startDungeon: startDungeon, drawQuestion: drawQuestion,
    submitAnswer: submitAnswer, computeDamage: computeDamage,
    shopBuyArtifact: shopBuyArtifact, shopReplaceArtifact: shopReplaceArtifact,
    shopBuyConsumable: shopBuyConsumable, shopReroll: shopReroll,
    shopBuyBoost: shopBuyBoost, BOOSTS: BOOSTS, rarityWeightsFor: rarityWeightsFor,
    sellArtifact: sellArtifact, isSellable: isSellable, sellRefund: sellRefund,
    useConsumable: useConsumable, leaveShop: leaveShop,
    equipArtifact: equipArtifact, hasArtifact: hasArtifact,
    currentIntent: currentIntent, makeEnemy: makeEnemy,
    scoreOf: scoreOf, depthLabel: depthLabel,
    // Test seam (harmless in prod): lets harnesses fire individual hooks and
    // inspect pure helpers without a DOM. Not used by gameplay.
    _test: {
      state: function () { return liveState; },
      artRequested: function () { return liveState ? liveState.artRequested : null; },
      fire: function (run, hook, extra) { fireSide(run, hook, extra || {}); },
      ctx: function (run, inst, extra) { return makeArtCtx(run, inst, extra); },
      applyIncoming: function (run, n) { applyIncoming(run, n); },
      artifactPrice: function (run, rarity) { return artifactPrice(run, rarity); },
      priceDiscount: function (run) { return priceDiscount(run); },
      buildShop: function (run) { buildShop(run); }
    }
  };
  ROOT.KBB = KBB;

  // ==========================================================================
  // 6. View (mount/unmount). SESSION 2 rebuild: four strictly non-overlapping
  //    CSS-grid zones. GREEN squad | RED combat(canvas only) | BLUE enemy |
  //    YELLOW questions/shop. Non-overlap is guaranteed by the grid; the canvas
  //    is confined to the RED cell. Lost = full-cover modal.
  // ==========================================================================
  var PALETTE = {
    iris: '#7855FA', iris300: '#AC9BFD', iris600: '#6D40E6', aqua: '#1FDDE9',
    mantis: '#92DD23', peach: '#FF6B5B', gold: '#FFC857', space: '#07070e',
    panel: '#14141d', panel2: '#1d1d29', border: '#34344a', text: '#F2F2F7', dim: '#9a9aad'
  };
  var CAT_COLOR = { damage: PALETTE.peach, sustain: PALETTE.mantis, defense: PALETTE.iris,
    economy: PALETTE.gold, utility: PALETTE.aqua, risk: PALETTE.peach, scaling: PALETTE.iris300, domain: PALETTE.aqua };
  var liveState = null;

  // Asset keys read from window.STARNIX_ASSETS (Core inlines these). All have
  // procedural fallbacks so KBB runs before the PNGs land.
  var ASSET_HERO = ['kbbHero1', 'kbbHero2', 'kbbHero3'];
  var ASSET_ENEMY = 'kbbEnemy', ASSET_BOSS = 'kbbBoss';
  var ASSET_ASTEROIDS = ['kbbAsteroid1', 'kbbAsteroid2', 'kbbAsteroid3', 'kbbAsteroid4', 'kbbAsteroid5'];
  var ASSET_NEBULA = 'nebulaBg', ASSET_LEGACY_SHIP = 'bcmShip';
  var ALL_ASSET_KEYS = ASSET_HERO.concat(ASSET_ASTEROIDS, [ASSET_ENEMY, ASSET_BOSS, ASSET_NEBULA, ASSET_LEGACY_SHIP]);

  function injectStyles(doc) {
    if (doc.getElementById('kbb-styles')) return;
    var st = doc.createElement('style'); st.id = 'kbb-styles';
    var P = PALETTE, css = [];
    css.push('.kbb-root{position:relative;width:100%;height:100%;overflow:hidden;color:' + P.text + ';font-family:Montserrat,Arial,sans-serif;background:radial-gradient(130% 110% at 50% -10%,#15152a 0%,#0a0a16 55%,#050509 100%);box-sizing:border-box;padding:12px;display:grid;gap:12px;--kbb-green:320px;--kbb-enemy:288px;grid-template-columns:[green] var(--kbb-green) [center] minmax(0,1fr) [enemy] var(--kbb-enemy);grid-template-rows:[head] auto [top] minmax(190px,4fr) [quest] minmax(190px,4fr);grid-template-areas:"head head head" "green combat enemy" "green quest quest";}');
    css.push('.kbb-root *{box-sizing:border-box;}');
    css.push('.kbb-top{grid-area:head;justify-self:center;align-self:center;z-index:6;display:flex;gap:14px;justify-content:center;align-items:center;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:' + P.dim + ';background:rgba(13,13,24,.6);border:1px solid ' + P.border + ';border-radius:999px;padding:5px 15px;max-width:100%;white-space:nowrap;overflow:hidden;}');
    css.push('.kbb-top b{color:' + P.text + ';}');
    css.push('.kbb-leftcol{grid-area:green;min-height:0;min-width:0;z-index:6;display:flex;flex-direction:column;gap:10px;}');
    css.push('.kbb-panel{background:rgba(20,20,29,.72);border:1px solid ' + P.border + ';border-radius:12px;padding:11px 13px;}');
    css.push('.kbb-eyebrow{font-size:11px;letter-spacing:.13em;text-transform:uppercase;color:' + P.dim + ';}');
    css.push('.kbb-crew{font-weight:800;font-size:18px;color:' + P.iris300 + ';margin:1px 0 9px;}');
    css.push('.kbb-plwrap{display:flex;align-items:center;gap:13px;}');
    css.push('.kbb-pltext .lg{font-size:13px;line-height:1.65;}');
    css.push('.kbb-pltext .lg .dt{display:inline-block;width:9px;height:9px;border-radius:3px;margin-right:7px;vertical-align:middle;}');
    css.push('.kbb-pltext .lg b{color:#fff;}');
    css.push('.kbb-pltext .st{font-size:12px;color:' + P.dim + ';margin-top:3px;}.kbb-pltext .st b{color:#fff;}');
    css.push('.kbb-arts-card{flex:1 1 auto;min-height:0;overflow:auto;}');
    css.push('.kbb-coins{flex:none;margin-top:auto;background:rgba(13,13,24,.62);border:1px solid ' + P.border + ';border-radius:12px;padding:11px 14px;display:flex;justify-content:space-between;align-items:center;}');
    css.push('.kbb-coins .v{color:' + P.gold + ';font-size:20px;font-weight:800;}');
    css.push('.kbb-ring{flex:none;}.kbb-ring-pl{width:104px;height:104px;}.kbb-ring-en{width:84px;height:84px;}');
    css.push('.kbb-ring .trk{fill:none;stroke:rgba(255,255,255,.07);stroke-width:7;}');
    css.push('.kbb-ring .arc{fill:none;stroke-width:7;stroke-linecap:round;transition:stroke-dashoffset .25s ease;}');
    css.push('.kbb-ring .arc.shield{stroke:' + P.aqua + ';}.kbb-ring .arc.hp{stroke:' + P.mantis + ';}.kbb-ring .arc.ehp{stroke:' + P.peach + ';}');
    css.push('.kbb-ring .rt{fill:' + P.text + ';font-size:22px;font-weight:800;text-anchor:middle;font-family:Montserrat,Arial,sans-serif;}');
    css.push('.kbb-ring .rt.sm{font-size:18px;}.kbb-ring .rt.tiny{font-size:10px;font-weight:600;fill:' + P.dim + ';}');
    css.push('.kbb-actions{display:flex;gap:8px;margin:0 0 10px;}');
    css.push('.kbb-action{flex:1;background:rgba(255,255,255,.05);border:1.5px solid ' + P.border + ';border-radius:10px;padding:9px 6px;color:' + P.dim + ';font:700 12.5px Montserrat,Arial,sans-serif;cursor:pointer;transition:border-color .12s,color .12s;}');
    css.push('.kbb-action.on{border-color:' + P.aqua + ';color:' + P.text + ';background:rgba(31,221,233,.10);}');
    css.push('.kbb-action[data-act=brace].on{border-color:' + P.iris300 + ';background:rgba(120,85,250,.14);}');
    css.push('.kbb-action[data-act=repair].on{border-color:' + P.mantis + ';background:rgba(146,221,35,.10);}');
    css.push('.kbb-combat{grid-area:combat;position:relative;min-width:0;min-height:0;border:1px solid ' + P.border + ';border-radius:12px;overflow:hidden;background:#06060c;}');
    css.push('.kbb-combat.is-cine{position:absolute;inset:0;z-index:40;border-radius:0;border:none;width:auto;height:auto;grid-column:1 / -1;grid-row:1 / -1;}');   // (P2·3, PLAYTEST A6) abs-pos GRID items resolve inset against their grid AREA — span the whole grid so the cinematic truly goes full-bleed instead of floating over a blank battle panel
    css.push('.kbb-canvas{position:absolute;inset:0;width:100%;height:100%;display:block;background:transparent;}');
    css.push('.kbb-3d{position:absolute;inset:0;width:100%;height:100%;display:block;}');
    css.push('.kbb-fx{position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;z-index:3;}');
    css.push('.kbb-cine-cap{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);width:88%;max-width:520px;text-align:center;font-size:14px;font-weight:600;color:#eef;text-shadow:0 0 10px #000;pointer-events:none;z-index:31;}');
    css.push('.kbb-skip{position:absolute;top:10px;right:10px;z-index:32;background:rgba(16,16,24,.7);border:1px solid ' + P.border + ';color:' + P.dim + ';border-radius:9px;padding:6px 12px;font-family:inherit;font-weight:700;font-size:12px;cursor:pointer;}');
    css.push('.kbb-skip:hover{border-color:' + P.aqua + ';color:' + P.text + ';}');
    css.push('.kbb-act-hint{margin-top:6px;font-size:11px;color:' + P.dim + ';letter-spacing:.2px;}');
    css.push('.kbb-statline .final{color:' + P.peach + ';font-weight:800;letter-spacing:.4px;animation:kbbFinalPulse 1.1s ease-in-out infinite;}');
    css.push('@keyframes kbbFinalPulse{0%,100%{opacity:.75}50%{opacity:1}}');
    css.push('.kbb-en-strike{animation:kbbStrike .55s ease-out;}');
    css.push('@keyframes kbbStrike{0%{box-shadow:0 0 0 0 rgba(255,107,91,.0);}18%{box-shadow:0 0 0 3px rgba(255,107,91,.85),0 0 22px rgba(255,107,91,.5);}100%{box-shadow:0 0 0 0 rgba(255,107,91,0);}}');
    css.push('@media (prefers-reduced-motion: reduce){.kbb-en-strike,.kbb-statline .final{animation:none;}}');
    css.push('.kbb-enemy{grid-area:enemy;align-self:start;min-width:0;z-index:6;background:rgba(20,20,29,.72);border:1px solid ' + P.border + ';border-radius:12px;padding:11px 13px;display:flex;align-items:center;gap:12px;justify-content:space-between;}');
    css.push('.kbb-enemy .entext{text-align:left;min-width:0;flex:1;}');
    css.push('.kbb-enemy .ennm{font-weight:800;font-size:17px;color:' + P.gold + ';margin:1px 0 7px;overflow:hidden;text-overflow:ellipsis;}');
    css.push('.kbb-statline{display:flex;gap:12px;font-size:11px;color:' + P.dim + ';margin-top:7px;}');
    css.push('.kbb-statline b{color:' + P.text + ';font-weight:700;}');
    css.push('.kbb-intent{display:inline-block;font-size:13.5px;font-weight:800;padding:3px 9px;border-radius:8px;border:1px solid ' + P.peach + ';color:' + P.peach + ';white-space:nowrap;}');
    css.push('.kbb-intent.charge{border-color:' + P.gold + ';color:' + P.gold + ';}');
    css.push('.kbb-intent.shield{border-color:' + P.aqua + ';color:' + P.aqua + ';}');
    css.push('@keyframes kbbAlert{0%{box-shadow:0 0 6px 0 rgba(255,107,91,.4);border-color:' + P.peach + ';}50%{box-shadow:0 0 17px 4px rgba(255,107,91,.92);border-color:#ff9c90;}100%{box-shadow:0 0 6px 0 rgba(255,107,91,.4);border-color:' + P.peach + ';}}');
    css.push('.kbb-intent.alert{animation:kbbAlert 1.2s ease-in-out infinite;}');
    css.push('.kbb-reduced .kbb-intent.alert{animation:none;box-shadow:0 0 12px 2px rgba(255,107,91,.6);}');
    css.push('@media (prefers-reduced-motion: reduce){.kbb-intent.alert{animation:none;box-shadow:0 0 12px 2px rgba(255,107,91,.6);}}');
    css.push('.kbb-main{grid-area:quest;min-width:0;min-height:0;overflow:auto;z-index:6;background:rgba(20,20,29,.72);border:1px solid ' + P.border + ';border-radius:12px;padding:13px 15px;}');
    css.push('.kbb-stem{font-size:15px;line-height:1.45;margin:2px 0 12px;font-weight:600;}');
    css.push('.kbb-exhibit-warn{margin:0 0 10px;padding:6px 9px;border-left:2px solid ' + P.gold + ';background:rgba(255,200,87,.1);font-size:12px;color:' + P.gold + ';}');
    css.push('.kbb-opts{display:flex;flex-direction:column;gap:8px;}');
    css.push('.kbb-opt{display:flex;align-items:center;gap:10px;text-align:left;padding:11px 13px;border-radius:10px;border:1.5px solid ' + P.iris + ';background:rgba(28,28,40,.5);color:' + P.text + ';font-family:inherit;font-size:14px;cursor:pointer;width:100%;transition:background .1s,transform .05s;}');
    css.push('.kbb-opt:hover:not(:disabled){background:rgba(120,85,250,.22);}');
    css.push('.kbb-opt:active:not(:disabled){transform:scale(.99);}');
    css.push('.kbb-opt:disabled{cursor:default;opacity:.55;}');
    css.push('.kbb-opt .k{font-weight:800;color:' + P.iris300 + ';min-width:18px;}');
    css.push('.kbb-opt.ruled{border-color:#444;text-decoration:line-through;opacity:.4;}');
    css.push('.kbb-opt.correct{border-color:' + P.mantis + ';background:rgba(146,221,35,.18);}');
    css.push('.kbb-opt.wrong{border-color:' + P.peach + ';background:rgba(255,107,91,.16);}');
    css.push('.kbb-opt.sel{border-color:' + P.aqua + ';background:rgba(31,221,233,.16);}');
    css.push('.kbb-multi-hint{font-size:12px;color:' + P.aqua + ';margin:7px 1px 1px;}');
    css.push('.kbb-submit{width:100%;}.kbb-submit:disabled{opacity:.4;cursor:not-allowed;}');
    css.push('.kbb-fb{margin-top:12px;font-size:13px;font-weight:700;min-height:20px;}');
    css.push('.kbb-fb.ok{color:' + P.mantis + ';}.kbb-fb.no{color:' + P.peach + ';}');
    css.push('.kbb-fb-exp{margin-top:7px;font-size:12.5px;font-weight:500;line-height:1.5;color:#cdd0e8;}');
    css.push('.kbb-fb-note{margin-top:7px;padding:6px 9px;border-left:2px solid ' + PALETTE.peach + ';background:rgba(255,107,91,.08);font-size:12px;font-weight:500;color:#cdd0e8;border-radius:0 8px 8px 0;}');
    css.push('.kbb-cont{margin-top:11px;padding:9px 18px;border-radius:10px;border:1.5px solid ' + P.aqua + ';background:rgba(31,221,233,.14);color:' + P.aqua + ';font-weight:800;font-size:13px;cursor:pointer;font-family:inherit;}');
    css.push('.kbb-cont:hover{background:rgba(31,221,233,.24);}.kbb-cont:active{transform:scale(.99);}');
    css.push('.kbb-btn{padding:10px 16px;border-radius:10px;border:1.5px solid ' + P.aqua + ';background:rgba(18,36,40,.55);color:' + P.aqua + ';font-family:inherit;font-weight:700;font-size:13px;cursor:pointer;}');
    css.push('.kbb-btn:hover{background:rgba(31,221,233,.18);}');
    css.push('.kbb-btn.alt{border-color:' + P.iris + ';color:' + P.iris300 + ';background:rgba(120,85,250,.12);}');
    css.push('.kbb-btn:disabled{opacity:.4;cursor:default;}');
    css.push('.kbb-shoprow{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;}');
    css.push('.kbb-big{font-size:22px;font-weight:800;text-align:center;margin:6px 0 14px;}');
    css.push('.kbb-row{display:flex;justify-content:space-between;align-items:center;gap:12px;font-size:12px;}');
    css.push('.kbb-sec{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:' + P.dim + ';margin:12px 0 7px;}');
    css.push('.kbb-card{display:flex;gap:11px;align-items:stretch;padding:11px;border-radius:12px;border:1px solid ' + P.border + ';background:rgba(24,24,35,.7);margin-bottom:8px;border-left-width:4px;}');
    css.push('.kbb-card .body{flex:1;min-width:0;}');
    css.push('.kbb-card .nm{font-weight:800;font-size:14px;}');
    css.push('.kbb-card .rar{font-size:10px;letter-spacing:.08em;text-transform:uppercase;font-weight:700;padding:1px 7px;border-radius:6px;margin-left:7px;vertical-align:middle;}');
    css.push('.kbb-card .desc{font-size:12px;color:' + P.dim + ';margin-top:4px;line-height:1.4;}');
    css.push('.kbb-card .side{display:flex;flex-direction:column;justify-content:center;gap:6px;align-items:flex-end;}');
    css.push('.kbb-cons{display:flex;gap:8px;flex-wrap:wrap;}');
    css.push('.kbb-cons .c{flex:1;min-width:130px;display:flex;flex-direction:column;gap:5px;padding:9px 10px;border-radius:10px;border:1px dashed ' + P.aqua + ';background:rgba(31,221,233,.06);}');
    css.push('.kbb-cons .c.full{opacity:.4;border-color:' + P.border + ';filter:grayscale(.6);}');
    css.push('.kbb-cons .c .cn{font-weight:700;font-size:13px;color:' + P.aqua + ';}');
    css.push('.kbb-cons .c .cd{font-size:11px;color:' + P.dim + ';line-height:1.35;}');
    css.push('.kbb-sell{margin-top:6px;border:1.5px dashed ' + P.peach + ';border-radius:12px;padding:12px;text-align:center;color:' + P.dim + ';font-size:12px;background:rgba(255,107,91,.05);transition:background .12s,border-color .12s;}');
    css.push('.kbb-sell.hot{background:rgba(255,107,91,.16);border-color:' + P.gold + ';color:' + P.text + ';}');
    css.push('.kbb-sell b{color:' + P.peach + ';}');
    css.push('.kbb-shop-h{display:flex;justify-content:space-between;align-items:baseline;margin:2px 0 4px;}');
    css.push('.kbb-name{font-weight:700;font-size:15px;}');
    css.push('.kbb-coin{color:' + P.gold + ';font-weight:700;}');
    css.push('.kbb-rar-common{color:' + P.dim + ';background:rgba(154,154,173,.16);}');
    css.push('.kbb-rar-uncommon{color:' + P.mantis + ';background:rgba(146,221,35,.14);}');
    css.push('.kbb-rar-rare{color:' + P.aqua + ';background:rgba(31,221,233,.14);}');
    css.push('.kbb-rar-legendary{color:' + P.gold + ';background:rgba(255,200,87,.16);}');
    css.push('.kbb-arts{display:flex;flex-wrap:wrap;gap:6px;margin-top:9px;}');
    // (v0.78.0, JB2) the left panel is 5 always-visible artifact SLOTS — empty ones invite,
    // filled ones show the full card; the shop pins Reroll/Next-battle outside its scroll.
    css.push('.kbb-slots{display:flex;flex-direction:column;flex-wrap:nowrap;gap:8px;}');
    css.push('.kbb-slot{border:1px solid ' + P.border + ';border-left:3px solid ' + P.iris300 + ';border-radius:10px;background:rgba(28,28,40,.65);padding:8px 10px;min-height:44px;}');
    css.push('.kbb-slot.empty{border-style:dashed;border-left-width:1px;background:rgba(28,28,40,.28);display:flex;align-items:center;justify-content:center;color:' + P.dim + ';font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;}');
    css.push('.kbb-slot .nm{font-size:12px;font-weight:700;display:flex;align-items:center;gap:7px;}');
    css.push('.kbb-slot .nm .rar{font-size:9px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;margin-left:auto;}');
    css.push('.kbb-slot .desc{font-size:10.5px;line-height:1.45;color:' + P.dim + ';margin-top:3px;}');
    css.push('.kbb-main.is-shop{display:flex;flex-direction:column;overflow:hidden;}');
    css.push('.kbb-shop-scroll{flex:1 1 auto;min-height:0;overflow:auto;padding-right:4px;}');
    css.push('.kbb-shop-actions{flex:none;margin-top:10px;padding-top:10px;border-top:1px solid ' + P.border + ';}');
    css.push('.kbb-tile{position:relative;display:flex;align-items:center;gap:7px;font-size:11px;font-weight:600;padding:6px 9px 6px 7px;border-radius:9px;border:1px solid ' + P.border + ';background:rgba(28,28,40,.65);outline:none;}');
    css.push('.kbb-tile .sw{width:8px;height:18px;border-radius:3px;flex:none;}');
    css.push('.kbb-tile.empty{opacity:.32;font-weight:500;}');
    css.push('.kbb-tile.draggable{cursor:grab;touch-action:none;}');
    css.push('.kbb-tile.draggable:hover{border-color:' + P.iris300 + ';}');
    css.push('.kbb-tile.nosell{opacity:.78;}');
    css.push('.kbb-tile .lock{font-size:10px;color:' + P.dim + ';}');
    css.push('.kbb-tile.picking{border-color:' + P.gold + ';box-shadow:0 0 12px rgba(255,200,87,.4);cursor:pointer;}');
    css.push('.kbb-tile.tipped{cursor:help;}');
    css.push('.kbb-tile:focus-visible{border-color:' + P.aqua + ';box-shadow:0 0 0 2px rgba(31,221,233,.4);}');
    css.push('.kbb-ghost{position:fixed;z-index:9999;pointer-events:none;opacity:.92;transform:translate(-50%,-50%) scale(1.05);box-shadow:0 6px 20px rgba(0,0,0,.5);}');
    css.push('.kbb-tip{position:absolute;z-index:60;max-width:240px;pointer-events:none;background:rgba(10,10,18,.97);border:1px solid ' + P.border + ';border-radius:10px;padding:9px 11px;box-shadow:0 8px 24px rgba(0,0,0,.55);display:none;}');
    css.push('.kbb-tip.show{display:block;}');
    css.push('.kbb-tip .tn{display:flex;align-items:center;gap:7px;font-weight:800;font-size:12.5px;color:' + P.text + ';margin-bottom:4px;}');
    css.push('.kbb-tip .tn i{width:8px;height:14px;border-radius:3px;flex:none;}');
    css.push('.kbb-tip .tn .tr{font-size:9.5px;text-transform:uppercase;letter-spacing:.08em;color:' + P.dim + ';margin-left:auto;font-weight:700;}');
    css.push('.kbb-tip .td{font-size:12px;line-height:1.45;color:#cdd0e8;}');
    css.push('.kbb-fb-more{margin-top:7px;}.kbb-fb-more summary{cursor:pointer;color:#1FDDE9;font-size:12.5px;font-weight:600;}.kbb-fb-more div{margin-top:5px;}');
    css.push('.kbb-toast{position:absolute;left:50%;top:10px;transform:translateX(-50%);background:rgba(13,13,24,.92);border:1px solid ' + P.border + ';border-radius:10px;padding:8px 14px;font-size:12px;font-weight:700;color:' + P.text + ';z-index:50;pointer-events:none;}');
    css.push('.kbb-lost{position:absolute;inset:0;z-index:45;display:flex;align-items:center;justify-content:center;padding:18px;background:rgba(5,5,11,.86);backdrop-filter:blur(4px);}');
    css.push('.kbb-lost-card{width:min(440px,94%);background:rgba(20,20,29,.97);border:1px solid ' + P.border + ';border-radius:16px;padding:24px;text-align:center;box-shadow:0 0 40px rgba(255,107,91,.22);}');
    css.push('.kbb-howto{position:absolute;inset:0;z-index:30;display:flex;align-items:center;justify-content:center;padding:18px;background:rgba(5,5,11,.82);backdrop-filter:blur(4px);}');
    css.push('.kbb-howto-panel{width:min(440px,94%);background:rgba(20,20,29,.97);border:1px solid #34344a;border-radius:16px;padding:20px;box-shadow:0 0 40px rgba(120,85,250,.28);}');
    css.push('.kbb-howto-eyebrow{font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:#1FDDE9;margin-bottom:6px;}');
    css.push('.kbb-howto-h{font-size:21px;font-weight:800;color:#F2F2F7;margin-bottom:14px;}');
    css.push('.kbb-howto-list{display:flex;flex-direction:column;gap:11px;margin-bottom:18px;}');
    css.push('.kbb-howto-li{display:flex;gap:11px;align-items:flex-start;font-size:13.5px;line-height:1.45;color:#c9c9d6;}');
    css.push('.kbb-howto-ic{flex:none;width:24px;height:24px;border-radius:7px;display:flex;align-items:center;justify-content:center;background:rgba(120,85,250,.16);border:1px solid #7855FA;color:#AC9BFD;font-size:13px;}');
    css.push('.kbb-ht-demo{display:flex;align-items:center;justify-content:center;height:100px;margin-bottom:16px;}');
    css.push('@keyframes kbbHtIn{from{opacity:0;transform:translateY(14px) scale(.97);}to{opacity:1;transform:none;}}');
    css.push('@keyframes kbbHtLi{from{opacity:0;transform:translateX(-10px);}to{opacity:1;transform:none;}}');
    css.push('@keyframes kbbRingDraw{from{stroke-dashoffset:var(--dash);}to{stroke-dashoffset:var(--off);}}');
    css.push('@keyframes kbbSword{0%,100%{transform:rotate(-20deg);}50%{transform:rotate(16deg);}}');
    css.push('.kbb-ht-anim .kbb-howto-panel{animation:kbbHtIn .5s cubic-bezier(.2,.8,.2,1) both;}');
    css.push('.kbb-ht-anim .kbb-howto-li{opacity:0;animation:kbbHtLi .5s ease both;}');
    css.push('.kbb-ht-anim .kbb-ht-ring{animation:kbbRingDraw 1s ease both;}');
    css.push('.kbb-ht-sword{transform-box:fill-box;transform-origin:center;}');
    css.push('.kbb-ht-anim .kbb-ht-sword{animation:kbbSword 1.6s ease-in-out .6s infinite;}');
    css.push('.kbb-ht-spot{position:relative;z-index:36;border-radius:12px;outline:2px solid ' + P.aqua + ';outline-offset:2px;box-shadow:0 0 0 4px rgba(31,221,233,.16),0 0 26px rgba(31,221,233,.5);}');
    css.push('.kbb-ht-spot{pointer-events:none;}');   // (v0.98.0, K2, Jason) look, don't answer — Next drives the tour
    css.push('.kbb-ht-anim .kbb-ht-spot{animation:kbbHtSpot 1.5s ease-in-out infinite;}');
    css.push('@keyframes kbbHtSpot{0%,100%{box-shadow:0 0 0 4px rgba(31,221,233,.14),0 0 22px rgba(31,221,233,.42);}50%{box-shadow:0 0 0 5px rgba(31,221,233,.26),0 0 34px rgba(31,221,233,.66);}}');
    css.push('.kbb-ht-tour{display:block;background:rgba(5,5,11,.62);}');
    css.push('.kbb-ht-call{position:absolute;left:50%;transform:translateX(-50%);width:min(540px,94%);background:rgba(20,20,29,.97);border:1px solid #34344a;border-radius:14px;padding:19px 21px;box-shadow:0 14px 44px rgba(0,0,0,.55),0 0 30px rgba(120,85,250,.22);}');   // (v0.98.0, K1) bigger
    css.push('.kbb-ht-call.pos-bottom{bottom:16px;}');
    css.push('.kbb-ht-call.pos-top{top:16px;}');
    css.push('.kbb-ht-anim .kbb-ht-call{animation:kbbHtIn .3s cubic-bezier(.2,.8,.2,1) both;}');
    css.push('.kbb-ht-call-h{font-size:18px;font-weight:800;color:#F2F2F7;margin-bottom:7px;}');
    css.push('.kbb-ht-call-x{font-size:15px;line-height:1.5;color:#c9c9d6;}');
    css.push('.kbb-intent.dead{background:rgba(255,200,87,.14);color:' + P.gold + ';border-color:' + P.gold + ';}');
    css.push('.kbb-ht-row{display:flex;align-items:center;gap:10px;margin-top:14px;}');
    css.push('.kbb-ht-dots{display:flex;gap:6px;flex:1;}');
    css.push('.kbb-ht-dot{width:7px;height:7px;border-radius:50%;background:rgba(255,255,255,.22);}');
    css.push('.kbb-ht-dot.on{background:' + P.aqua + ';box-shadow:0 0 8px ' + P.aqua + ';}');
    css.push('.kbb-ht-skip{background:transparent;border:none;color:' + P.dim + ';font-weight:700;font-size:12px;cursor:pointer;padding:6px 8px;font-family:inherit;}');
    css.push('.kbb-ht-skip:hover{color:' + P.text + ';}');
    // narrow fallback: laptop/landscape is the target; below this we stack to one column so nothing breaks
    // (v0.85.0, B4) phone stack: the QUESTION panel sits directly under the combat view (no
    // per-turn scrolling past artifacts/enemy), and shop actions stay sticky at the viewport
    // bottom. CSS order diverges from DOM order here by design — flagged in BROWSER_QA.
    css.push('@media (max-width:820px){.kbb-root{display:flex;flex-direction:column;height:auto;min-height:100%;overflow:auto;}.kbb-top{align-self:center;order:0;}.kbb-combat{height:250px;flex:none;order:1;}.kbb-combat.is-cine{height:auto;}.kbb-main{overflow:visible;order:2;}.kbb-enemy{align-self:stretch;order:3;}.kbb-leftcol{min-height:0;order:4;}.kbb-arts-card{flex:none;overflow:visible;}.kbb-main.is-shop{display:block;overflow:visible;}.kbb-shop-scroll{overflow:visible;}.kbb-shop-actions{position:sticky;bottom:0;background:rgba(20,20,29,.96);z-index:4;padding-bottom:8px;}}');
    st.textContent = css.join('');
    (doc.head || doc.documentElement).appendChild(st);
  }

  function makeGame() {
    var state = null;

    function el(doc, tag, cls, txt) {
      var n = doc.createElement(tag);
      if (cls) n.className = cls;
      if (txt != null) n.textContent = txt;
      return n;
    }

    // Load any available STARNIX_ASSETS images; each is optional (procedural fallback).
    function loadAssets(s) {
      s.assets = { img: {}, src: {} };
      var view = s.doc.defaultView, A = (view && view.STARNIX_ASSETS) || null, ImgC = view && view.Image;
      if (!A || !ImgC) return;
      s.assets.src = A;
      for (var i = 0; i < ALL_ASSET_KEYS.length; i++) {
        (function (key) {
          var src = A[key]; if (!src) return;
          var im = new ImgC();
          im.onload = function () { s.assets.img[key] = im; s._artDirty = true; };
          im.src = src;
        })(ALL_ASSET_KEYS[i]);
      }
    }
    function assetImg(s, key) { var im = s.assets && s.assets.img[key]; return (im && im.naturalWidth) ? im : null; }

    function mount(root, ctx) {
      var doc = root.ownerDocument || document;
      injectStyles(doc);
      var reduced = false;
      try { reduced = (ctx && ctx.settings && ctx.settings.reducedMotion) || (doc.defaultView.matchMedia && doc.defaultView.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) {}

      var run = createRun(ctx, {});   // (v0.68.0, J6) straight into an EASY first battle — no pre-run shop; the first shop comes after battle 1
      // (v0.106.0, G2) Resume: rebuild the checkpointed run — section/round/squad/artifacts.
      if (ctx.resumeData && ctx.resumeData.section) {
        var rz = ctx.resumeData;
        run.section = rz.section; run.round = rz.round;
        if (rz.squad) for (var rk3 in rz.squad) { if (Object.prototype.hasOwnProperty.call(rz.squad, rk3)) run.squad[rk3] = rz.squad[rk3]; }
        if (rz.artifacts) for (var ra3 = 0; ra3 < rz.artifacts.length; ra3++) {
          try {
            var rec3 = rz.artifacts[ra3], rid3 = rec3 && rec3.id ? rec3.id : rec3;   // (v0.108.0) new {id,state} or legacy bare id
            var eq3 = equipArtifact(run, rid3, false);
            if (eq3 && eq3.inst && rec3 && rec3.state) { for (var sk3 in rec3.state) { if (Object.prototype.hasOwnProperty.call(rec3.state, sk3)) eq3.inst.state[sk3] = rec3.state[sk3]; } }
          } catch (eEq) {}
        }
        if (rz.flags) run.flags = rz.flags;                                          // (G4) Lazarus stays burned
        if (rz.depthClearedSection) { run.depthClearedSection = rz.depthClearedSection; run.depthClearedRound = rz.depthClearedRound || 0; }
        if (rz.consumables) run.consumables = rz.consumables.slice(0, CONFIG.consumableCap);
        run.battle = null; startBattle(run);   // open ON the checkpointed round's battle
      }
      var container = el(doc, 'div', 'kbb-root' + (reduced ? ' kbb-reduced' : ''));
      root.appendChild(container);

      var trailColor = null;   // (v0.57.0 unit 7) mastery cosmetic — shell-resolved hex or null (stock colors)
      try { trailColor = (ctx && ctx.settings && ctx.settings.shipTrailColor) || null; } catch (eT) {}
      var s = {
        ctx: ctx, doc: doc, root: root, container: container, run: run,
        reduced: reduced, raf: 0, timers: [], qShownAt: 0, locked: false, paused: false,
        battleStartAt: 0, heroExitAt: 0, _battleKey: '',   // (v0.100.0, K5) fly-in/fly-off choreography clocks
        canvas: null, c2d: null, onKey: null, best: 0, trailColor: trailColor,
        use3D: false, three: null, _lastCW: 0, _lastCH: 0, _artDirty: false
      };
      state = s; liveState = s;
      loadAssets(s);

      if (ctx.persistence && ctx.persistence.load) {
        ctx.persistence.load().then(function (p) {
          if (p && p.bests && typeof p.bests.KBB === 'number') { s.best = p.bests.KBB; renderTop(s); }
        }).catch(function () {});
      }

      // ---- build the four-zone grid ----
      s.topBar = el(doc, 'div', 'kbb-top'); container.appendChild(s.topBar);                 // head

      s.combat = el(doc, 'div', 'kbb-combat'); container.appendChild(s.combat);              // RED
      s.stage = s.combat;
      var cv = el(doc, 'canvas', 'kbb-canvas'); s.canvas = cv; s.combat.appendChild(cv);

      s.leftCol = el(doc, 'div', 'kbb-leftcol'); container.appendChild(s.leftCol);           // GREEN
      s.squadPanel = el(doc, 'div', 'kbb-panel kbb-squad');
      s.squadPanel.innerHTML =
        '<div class="kbb-eyebrow">NX-SRC squad</div><div class="kbb-crew">Starlight crew</div>' +
        '<div class="kbb-plwrap"><svg class="kbb-ring kbb-ring-pl" viewBox="0 0 100 100">' +
        '<circle cx="50" cy="50" r="46" class="trk"/><circle cx="50" cy="50" r="46" class="arc shield" transform="rotate(-90 50 50)"/>' +
        '<circle cx="50" cy="50" r="34" class="trk"/><circle cx="50" cy="50" r="34" class="arc hp" transform="rotate(-90 50 50)"/>' +
        '<text x="50" y="57" class="rt">--</text></svg><div class="kbb-pltext"></div></div>';
      s.artPanel = el(doc, 'div', 'kbb-panel kbb-arts-card');
      s.coinPanel = el(doc, 'div', 'kbb-coins');
      s.leftCol.appendChild(s.squadPanel); s.leftCol.appendChild(s.artPanel); s.leftCol.appendChild(s.coinPanel);

      s.enemyPanel = el(doc, 'div', 'kbb-enemy'); container.appendChild(s.enemyPanel);       // BLUE
      s.enemyPanel.innerHTML =
        '<div class="entext"></div><svg class="kbb-ring kbb-ring-en" viewBox="0 0 100 100">' +
        '<circle cx="50" cy="50" r="42" class="trk"/><circle cx="50" cy="50" r="42" class="arc ehp" transform="rotate(-90 50 50)"/>' +
        '<text x="50" y="49" class="rt sm">--</text><text x="50" y="64" class="rt tiny"></text></svg>';

      s.mainPanel = el(doc, 'div', 'kbb-main'); container.appendChild(s.mainPanel);           // YELLOW

      s.tipEl = el(doc, 'div', 'kbb-tip'); container.appendChild(s.tipEl);                    // shared tooltip

      // ring geometry + refs
      s.ringC = { hp: 2 * Math.PI * 34, sh: 2 * Math.PI * 46, en: 2 * Math.PI * 42 };
      s.plHpArc = s.squadPanel.querySelector('.arc.hp'); s.plShArc = s.squadPanel.querySelector('.arc.shield');
      s.plRingTxt = s.squadPanel.querySelector('.kbb-ring-pl .rt'); s.squadText = s.squadPanel.querySelector('.kbb-pltext');
      s.enArc = s.enemyPanel.querySelector('.arc.ehp'); s.enRingTxt = s.enemyPanel.querySelector('.rt.sm');
      s.enRingSub = s.enemyPanel.querySelector('.rt.tiny'); s.enemyText = s.enemyPanel.querySelector('.entext');
      if (s.plHpArc) { s.plHpArc.style.strokeDasharray = s.ringC.hp; s.plHpArc.style.strokeDashoffset = s.ringC.hp; }
      if (s.plShArc) { s.plShArc.style.strokeDasharray = s.ringC.sh; s.plShArc.style.strokeDashoffset = s.ringC.sh; }
      if (s.enArc) { s.enArc.style.strokeDasharray = s.ringC.en; s.enArc.style.strokeDashoffset = s.ringC.en; }

      s.c2d = cv.getContext('2d');
      sizeCanvas(s);

      s.ui = { hpShown: 1, shieldShown: 0, ehpShown: 1, drag: null, replaceOffer: -1 };
      s.fx = []; s.lastTs = 0;

      s.onKey = function (e) { handleKey(s, e); };
      doc.addEventListener('keydown', s.onKey);

      loop(s);
      renderTop(s);
      // flow: How to Play -> cinematic -> pre-run shop (Start begins the dungeon run). 3D inits after the intro.
      // (v0.68.0, J6) cinematic FIRST, then the live battle renders, THEN the how-to tour —
      // its zone spotlights used to land on EMPTY panels (Jason's "blank boxes") because the
      // tour ran before anything existed. Now every spotlighted zone is populated.
      playIntro(s, function () {
        renderAll(s); maybeInit3D(s);
        showHowTo(s, function () {});
      });

      if (ctx.audio && ctx.audio.playTrack) { try { ctx.audio.playTrack('kbb'); } catch (e) {} }
      s._musicCtx = 'kbb';   // (v0.50.0) seed the boss-music transition guard to the bed just started
    }

    function sizeCanvas(s) {
      var view = s.root.ownerDocument.defaultView;
      var dpr = Math.min(2, (view.devicePixelRatio || 1));
      // (v0.98.0, K7, Jason: "battle area is very blurry") measure the CONTAINER — the 2D
      // canvas reports clientWidth 0 while hidden in 3D mode, so everything rendered at the
      // 320px fallback and got stretched to ~620px. The fx overlay resizes with it.
      var w = (s.combat && s.combat.clientWidth) || s.canvas.clientWidth || 320;
      var h = (s.combat && s.combat.clientHeight) || s.canvas.clientHeight || 188;
      s.canvas.width = Math.round(w * dpr); s.canvas.height = Math.round(h * dpr);
      if (s.c2d) s.c2d.setTransform(dpr, 0, 0, dpr, 0, 0);
      s._lastCW = w; s._lastCH = h;
      if (s.three && s.three.renderer) { try { s.three.renderer.setSize(w, h, false); s.three.camera.aspect = w / Math.max(1, h); s.three.camera.updateProjectionMatrix(); s.three.W = w; s.three.H = h; } catch (e) {} }
      if (s.fxCanvas) { s.fxCanvas.width = Math.max(1, Math.round(w * dpr)); s.fxCanvas.height = Math.max(1, Math.round(h * dpr)); s.fxPr = dpr; }
    }
    function resizeIfNeeded(s) {
      // (v0.98.0, K7) container-based — the hidden 2D canvas reads 0 in 3D mode
      var w = (s.combat && s.combat.clientWidth) || s.canvas.clientWidth || 320;
      var h = (s.combat && s.combat.clientHeight) || s.canvas.clientHeight || 188;
      if (w !== s._lastCW || h !== s._lastCH) sizeCanvas(s);
    }

    function loop(s) {
      var view = s.root.ownerDocument.defaultView;
      function frame(ts) {
        if (!state || state !== s || s.paused) return;
        frameTick(s, ts || 0);
        s.raf = view.requestAnimationFrame(frame);
      }
      s.raf = view.requestAnimationFrame(frame);
    }
    function frameTick(s, ts) {
      s.lastTs = ts;
      resizeIfNeeded(s);
      updateRings(s);
      // (v0.48.0) impact shake — a decaying CSS-transform jitter on the visible canvas (2D or 3D).
      if (s.shakeT > 0) {
        s.shakeT = Math.max(0, s.shakeT - 1 / 60);
        var sc = s.shakeT * 9, sxx = Math.sin(ts * 0.09) * sc, syy = Math.cos(ts * 0.113) * sc;
        var cvEl = (s.use3D && s.threeCanvas) ? s.threeCanvas : s.canvas;
        if (cvEl && cvEl.style) cvEl.style.transform = s.shakeT > 0.01 ? ('translate(' + sxx.toFixed(1) + 'px,' + syy.toFixed(1) + 'px)') : '';
      }
      if (s.intro && s.intro.active) { drawIntro(s, ts); return; }
      if (s.use3D && s.three) { if (render3D(s, ts) === false) drawArena(s, ts); }
      else drawArena(s, ts);
    }
    // DOM health rings (HP/shield/enemy) — updated every frame in BOTH 2D and 3D modes.
    function updateRings(s) {
      var run = s.run, sq = run.squad, b = run.battle;
      var hpF = sq.maxHp > 0 ? sq.hp / sq.maxHp : 0;
      var shF = Math.min(1, sq.shield / 20);   // fixed shield cap so a normal shield reads as a clear arc as maxHp grows
      var ehpF = (b && b.enemy && b.enemy.maxHp > 0) ? Math.max(0, b.enemy.hp) / b.enemy.maxHp : 0;
      var k = s.reduced ? 1 : 0.18;
      s.ui.hpShown += (hpF - s.ui.hpShown) * k;
      s.ui.shieldShown += (shF - s.ui.shieldShown) * k;
      s.ui.ehpShown += (ehpF - s.ui.ehpShown) * k;
      if (s.plHpArc) {
        s.plHpArc.style.strokeDashoffset = s.ringC.hp * (1 - s.ui.hpShown);
        s.plShArc.style.strokeDashoffset = s.ringC.sh * (1 - Math.min(1, s.ui.shieldShown));
        if (s.plRingTxt) s.plRingTxt.textContent = Math.max(0, sq.hp);
      }
      if (s.enArc && b && b.enemy) {
        s.enArc.style.strokeDashoffset = s.ringC.en * (1 - s.ui.ehpShown);
        if (s.enRingTxt) s.enRingTxt.textContent = Math.max(0, b.enemy.hp);
        if (s.enRingSub) s.enRingSub.textContent = '/ ' + b.enemy.maxHp;
      }
    }

    // ---- 2D scene (allocation-free hot path; sprites with procedural fallbacks) ----
    var _cseed = 0x1234567;
    function crand() { _cseed = (_cseed * 1664525 + 1013904223) >>> 0; return _cseed / 4294967296; }
    var STARS = null, STARS2 = null, ROCKS = null;
    function initBelt() {
      var i;
      ROCKS = new Array(16);
      for (i = 0; i < 16; i++) ROCKS[i] = { x: crand(), y: 0.08 + crand() * 0.84, z: 0.35 + crand() * 1.25, r: 8 + crand() * 18,
        rot: crand() * 6.28, spin: (crand() - 0.5) * 1.6, sides: 5 + ((crand() * 3) | 0), sprite: (crand() * 5) | 0 };
      STARS = new Array(46);   // near layer (faster parallax)
      for (i = 0; i < 46; i++) STARS[i] = { x: crand(), y: crand(), s: 0.6 + crand() * 1.5, a: 0.18 + crand() * 0.5, z: 0.6 + crand() * 0.8 };
      STARS2 = new Array(34);  // far layer (slow)
      for (i = 0; i < 34; i++) STARS2[i] = { x: crand(), y: crand(), s: 0.5 + crand() * 0.9, a: 0.1 + crand() * 0.3, z: 0.15 + crand() * 0.3 };
    }
    function regPolyG(g, r, sides, rot) { g.beginPath(); for (var p = 0; p < sides; p++) { var a = rot + (p / sides) * 6.283; var px = Math.cos(a) * r, py = Math.sin(a) * r; if (p === 0) g.moveTo(px, py); else g.lineTo(px, py); } g.closePath(); }
    function rrectG(g, x, y, w, h, r) {
      r = Math.min(r, h / 2, w / 2);
      g.beginPath();
      g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
      g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
    }
    // Procedural nebula -> offscreen canvas, built once per size, blitted each frame (no per-frame alloc).
    function buildNebula(s, W, H) {
      var doc = s.doc, oc = doc.createElement('canvas');
      oc.width = Math.max(2, W | 0); oc.height = Math.max(2, H | 0);
      var g = oc.getContext && oc.getContext('2d');
      if (!g) { s.nebula = null; return; }
      g.fillStyle = '#06060c'; g.fillRect(0, 0, W, H);
      var blobs = [[0.26, 0.34, PALETTE.iris600, 0.16], [0.72, 0.3, PALETTE.aqua, 0.1], [0.5, 0.74, PALETTE.iris, 0.12], [0.86, 0.66, PALETTE.peach, 0.06]];
      for (var i = 0; i < blobs.length; i++) {
        var bx = blobs[i][0] * W, by = blobs[i][1] * H, rad = Math.max(W, H) * (0.34 + (i % 2) * 0.12);
        var gr = g.createRadialGradient(bx, by, 0, bx, by, rad);
        gr.addColorStop(0, hexA(blobs[i][2], blobs[i][3])); gr.addColorStop(1, hexA(blobs[i][2], 0));
        g.fillStyle = gr; g.fillRect(0, 0, W, H);
      }
      s.nebula = { canvas: oc, w: W, h: H };
    }
    function hexA(hex, a) {
      var r = parseInt(hex.slice(1, 3), 16), gg = parseInt(hex.slice(3, 5), 16), bb = parseInt(hex.slice(5, 7), 16);
      return 'rgba(' + r + ',' + gg + ',' + bb + ',' + a + ')';
    }
    function drawBackdrop(g, s, W, H) {
      var neb = assetImg(s, ASSET_NEBULA);
      if (neb) {
        var iw = neb.naturalWidth, ih = neb.naturalHeight, sc = Math.max(W / iw, H / ih), dw = iw * sc, dh = ih * sc;
        g.drawImage(neb, (W - dw) / 2, (H - dh) / 2, dw, dh);
        g.save(); g.fillStyle = 'rgba(7,7,14,.42)'; g.fillRect(0, 0, W, H); g.restore();
        return;
      }
      if (!s.nebula || s.nebula.w !== (W | 0) || s.nebula.h !== (H | 0)) buildNebula(s, W, H);
      if (s.nebula) {
        var t = s.reduced ? 0 : (s.lastTs * 0.000012) % 1, ox = -t * W * 0.25;   // slow parallax drift, seamless wrap
        g.drawImage(s.nebula.canvas, ox, 0, W, H); g.drawImage(s.nebula.canvas, ox + W, 0, W, H);
      } else { g.clearRect(0, 0, W, H); }
    }
    function drawStars(g, layer, W, H, ts, reduced, baseSpeed) {
      for (var i = 0; i < layer.length; i++) {
        var st = layer[i];
        var x = reduced ? st.x * W : ((((st.x - ts * baseSpeed * st.z) % 1) + 1) % 1) * W;
        g.globalAlpha = st.a; g.fillStyle = '#cfd2ff'; g.fillRect(x, st.y * H, st.s, st.s);
      }
      g.globalAlpha = 1;
    }
    function drawBelt(g, s, W, H, ts, reduced) {
      if (!ROCKS) initBelt();
      drawStars(g, STARS2, W, H, ts, reduced, 0.00002);
      drawStars(g, STARS, W, H, ts, reduced, 0.00006);
      var t = reduced ? 0 : ts * 0.00006;
      for (var r = 0; r < ROCKS.length; r++) {
        var o = ROCKS[r];
        var x = ((((o.x - t * o.z) % 1) + 1) % 1) * W, y = o.y * H, sz = o.r * o.z, depthA = clamp(0.35 + o.z * 0.45, 0.3, 0.95);
        var rot = o.rot + (reduced ? 0 : ts * 0.0002 * o.spin);
        var img = assetImg(s, ASSET_ASTEROIDS[o.sprite]);
        g.save(); g.translate(x, y); g.rotate(rot); g.globalAlpha = depthA;
        if (img) {
          g.drawImage(img, -sz, -sz, sz * 2, sz * 2);
        } else {
          g.fillStyle = 'rgba(46,46,64,.6)'; g.strokeStyle = 'rgba(96,96,128,.55)'; g.lineWidth = 1;
          regPolyG(g, sz, o.sides, 0); g.fill(); g.stroke();
        }
        g.restore(); g.globalAlpha = 1;
      }
    }
    function hpCol(f) { return f > 0.5 ? PALETTE.mantis : (f > 0.22 ? PALETTE.gold : PALETTE.peach); }
    function blastRing(g, cx, cy, r, col, alpha, lw) {
      g.save(); g.globalAlpha = alpha; g.strokeStyle = col; g.lineWidth = lw;
      g.shadowColor = col; g.shadowBlur = 8; g.beginPath(); g.arc(cx, cy, r, 0, 6.283); g.stroke();
      g.restore(); g.globalAlpha = 1;
    }
    // ---- battle FX queue (lunges, hit flash, floating numbers, shield pop, death) ----
    function pushFx(s, o) { if (!s.fx) s.fx = []; o.start = (s.lastTs || 0) + (o.delay || 0); s.fx.push(o); }
    function fxActive(s, ts, type, side) {
      if (!s.fx) return null;
      for (var i = 0; i < s.fx.length; i++) { var f = s.fx[i]; if (f.type === type && f.side === side && ts >= f.start && ts < f.start + f.dur) return f; }
      return null;
    }
    function lungeDx(s, ts, side, dir) {
      var f = fxActive(s, ts, 'lunge', side); if (!f) return 0;
      var p = (ts - f.start) / f.dur; return Math.sin(p * Math.PI) * 42 * dir;
    }
    function drawShip(g, x, y, scale, col, glow) {
      g.save(); g.translate(x, y); g.scale(scale, scale);
      g.shadowBlur = glow; g.shadowColor = col;
      g.strokeStyle = col; g.lineWidth = 1.6; g.fillStyle = 'rgba(20,20,30,.7)';
      g.beginPath(); g.moveTo(14, 0); g.lineTo(-10, -8); g.lineTo(-5, 0); g.lineTo(-10, 8); g.closePath();
      g.fill(); g.stroke();
      g.shadowBlur = glow * 0.6; g.fillStyle = col;
      g.beginPath(); g.arc(2, 0, 2.4, 0, 6.283); g.fill();
      g.restore(); g.shadowBlur = 0;
    }
    function drawNeonFighter(g, x, y, sc, col, reduced, lead, trailCol) {
      g.save(); g.translate(x, y); g.scale(sc, sc); g.lineJoin = 'round';
      if (!reduced) { g.shadowColor = col; g.shadowBlur = lead ? 13 : 8; }
      g.beginPath(); g.moveTo(-13, 0); g.lineTo(15, -4.5); g.lineTo(23, 0); g.lineTo(15, 4.5); g.closePath();
      g.fillStyle = lead ? 'rgba(120,85,250,.22)' : 'rgba(255,255,255,.05)';
      g.strokeStyle = col; g.lineWidth = lead ? 1.4 : 1.1; g.fill(); g.stroke();
      g.beginPath(); g.moveTo(1, 0); g.lineTo(-11, -6.5); g.lineTo(-3, 0); g.moveTo(1, 0); g.lineTo(-11, 6.5); g.lineTo(-3, 0);
      g.strokeStyle = lead ? PALETTE.iris300 : col; g.lineWidth = lead ? 1.2 : 1.0; g.stroke();
      g.beginPath(); g.arc(4, 0, lead ? 2.1 : 1.5, 0, 6.283); g.fillStyle = PALETTE.aqua; if (!reduced) g.shadowBlur = 7; g.fill();
      if (!reduced) { g.beginPath(); g.arc(-13, 0, lead ? 2.6 : 1.8, 0, 6.283); g.fillStyle = trailCol || (lead ? PALETTE.peach : col); g.shadowColor = trailCol || (lead ? PALETTE.gold : col); g.shadowBlur = 11; g.fill(); }   // (v0.57.0) engine flame wears the mastery trail tint when set
      g.restore();
    }
    function drawBillboard(g, img, x, y, size, col, glow, faceLeft) {
      g.save(); g.translate(x, y);
      if (glow > 0) { g.shadowColor = col; g.shadowBlur = glow; }
      if (faceLeft) g.scale(-1, 1);
      g.drawImage(img, -size / 2, -size / 2, size, size);
      g.restore();
    }
    // three hero ships move independently (idle bob phases differ; lunge is shared but staggered)
    var HERO_SLOTS = [
      { dx: 0, dy: 0, scl: 1.0, col: PALETTE.iris, lead: true, ph: 0.0, key: 'kbbHero1', lf: 1.0 },
      { dx: -16, dy: -16, scl: 0.74, col: PALETTE.aqua, lead: false, ph: 1.7, key: 'kbbHero2', lf: 0.72 },
      { dx: -18, dy: 18, scl: 0.70, col: PALETTE.mantis, lead: false, ph: 3.1, key: 'kbbHero3', lf: 0.66 }
    ];
    function battleEase(s, ts) {   // (K5) 0..1 fly-in progress; 1 instantly under reduced motion
      if (s.reduced) return 1;
      var fin = Math.min(1, Math.max(0, (ts - s.battleStartAt) / 900));
      return 1 - Math.pow(1 - fin, 3);
    }
    function heroExitDx(s, ts) {   // (K5) accelerating fly-off to the RIGHT after victory
      if (s.reduced || !s.heroExitAt || ts < s.heroExitAt) return 0;
      var t2 = (ts - s.heroExitAt) / 1000;
      return t2 * t2 * 900;
    }
    function drawHeroes(g, s, cx, y, sc, ts, reduced) {
      var lx = lungeDx(s, ts, 'player', 1);
      var kIn = battleEase(s, ts);
      cx = cx - (1 - kIn) * (cx + 90) + heroExitDx(s, ts);   // in from the LEFT, off to the RIGHT
      for (var i = 0; i < HERO_SLOTS.length; i++) {
        var sp = HERO_SLOTS[i];
        var hx = cx + sp.dx * sc + lx * sp.lf;
        var hy = y + sp.dy * sc + (reduced ? 0 : Math.sin(ts / 680 + sp.ph) * 3);
        var img = assetImg(s, sp.key);
        if (img) drawBillboard(g, img, hx, hy, 46 * sc * sp.scl, sp.col, reduced ? 0 : (sp.lead ? 14 : 9), false);
        else drawNeonFighter(g, hx, hy, sc * 0.92 * sp.scl, sp.col, reduced, sp.lead, s.trailColor);
      }
    }
    function drawEnemy(g, s, e, cx, y, sc, ts) {
      var ecol = e.boss ? PALETTE.gold : PALETTE.peach;
      var W = s.canvas.clientWidth || 320, H = s.canvas.clientHeight || 188;
      var kInE = battleEase(s, ts);
      var x = cx + lungeDx(s, ts, 'enemy', -1) + (1 - kInE) * (W - cx + 90), yy = y + (s.reduced ? 0 : Math.sin(ts / 520) * 4);
      var img = assetImg(s, e.boss ? ASSET_BOSS : ASSET_ENEMY) || assetImg(s, ASSET_LEGACY_SHIP);
      if (img) {
        var px = clamp((e.boss ? 0.5 : 0.42) * H * 1.5, 80, W * 0.44);
        drawBillboard(g, img, x, yy, px, ecol, s.reduced ? 0 : (e.boss ? 28 : 18), true);
      } else {
        var pulse = s.reduced ? 5 : (7 + 3 * Math.sin(ts / 420));
        g.save(); g.translate(x, yy); g.scale(-1, 1); drawShip(g, 0, 0, e.boss ? 3.0 : 2.4, ecol, pulse + (e.boss ? 7 : 0)); g.restore();
      }
    }
    function fxRenderOverlays(s, ts, L, gOpt) {
      if (!s.fx || !s.fx.length) return;
      var g = gOpt || s.c2d, keep = [];   // (v0.80.0, JB3) 3D mode hands in its overlay ctx
      for (var i = 0; i < s.fx.length; i++) {
        var f = s.fx[i];
        if (ts < f.start) { keep.push(f); continue; }
        var p = (ts - f.start) / f.dur;
        if (p >= 1) continue;
        keep.push(f);
        var cx = (f.side === 'enemy' ? L.cxR : L.cxL) + lungeDx(s, ts, f.side, f.side === 'enemy' ? -1 : 1);
        // (v0.80.0, JB3) fx may carry dx/dy hull offsets (staged detonations hit different spots)
        cx += f.dx || 0;
        var cy = L.yShip + (f.dy || 0);
        if (f.type === 'flash') {
          var fa = 1 - p, fr = f.flashR || 46, fcol = f.col || '#FFFFFF';
          blastRing(g, cx, cy, fr * 0.4 + p * fr, fcol, fa * 0.9, 3.5);
          g.save(); g.globalAlpha = fa * 0.45; g.fillStyle = fcol; g.shadowColor = fcol; g.shadowBlur = 26;
          g.beginPath(); g.arc(cx, cy, fr * 0.5, 0, 6.283); g.fill(); g.restore(); g.globalAlpha = 1;
        } else if (f.type === 'sfx') {
          // (v0.100.0, K6) beat-synced sound: fires exactly when this fx's start time renders
          if (!f.done) { f.done = true; try { if (s.ctx.audio && s.ctx.audio.sfx) s.ctx.audio.sfx(f.name); } catch (eS) {} }
        } else if (f.type === 'charge') {
          // (JB3) attack telegraph: a glow builds on the attacker before the lunge
          g.save(); g.globalAlpha = p * 0.7; g.fillStyle = f.col || PALETTE.aqua; g.shadowColor = f.col || PALETTE.aqua;
          g.shadowBlur = 18; g.beginPath(); g.arc(cx, cy, 6 + p * 11, 0, 6.283); g.fill(); g.restore(); g.globalAlpha = 1;
        } else if (f.type === 'beam') {
          // (JB3) the shot itself: a glowing bolt travels attacker -> target with a hot trail
          var srcX = (f.side === 'enemy' ? L.cxL : L.cxR) + lungeDx(s, ts, f.side === 'enemy' ? 'player' : 'enemy', f.side === 'enemy' ? 1 : -1);
          var ep2 = 1 - (1 - p) * (1 - p);
          var hx = srcX + (cx - srcX) * ep2, tl = (cx - srcX) * 0.22;
          g.save(); g.strokeStyle = f.col || PALETTE.aqua; g.shadowColor = f.col || PALETTE.aqua; g.shadowBlur = f.thick ? 26 : 12;
          g.globalAlpha = 0.9 * (1 - p * 0.4); g.lineWidth = f.thick ? 9 : 3; g.beginPath(); g.moveTo(hx - tl, cy); g.lineTo(hx, cy); g.stroke();
          g.globalAlpha = 1; g.fillStyle = '#FFFFFF'; g.beginPath(); g.arc(hx, cy, 3.2, 0, 6.283); g.fill();
          g.restore(); g.globalAlpha = 1;
        } else if (f.type === 'sparks') {
          // (JB3) impact debris: deterministic per-index trajectories (pure math, zero allocation)
          var n = f.count || 12, sd = f.seed || 1, spread = f.spread || 1;
          g.save(); g.fillStyle = f.col || PALETTE.peach; g.shadowColor = f.col || PALETTE.peach; g.shadowBlur = 6;
          for (var k = 0; k < n; k++) {
            var h1 = Math.sin(k * 127.1 + sd * 311.7) * 43758.5453; h1 -= Math.floor(h1);
            var h2 = Math.sin(k * 269.5 + sd * 183.3) * 28001.8384; h2 -= Math.floor(h2);
            var ang = h1 * 6.283, spd = (18 + h2 * 34) * spread;
            var px2 = cx + Math.cos(ang) * spd * p, py2 = cy + Math.sin(ang) * spd * p + p * p * 16;
            g.globalAlpha = (1 - p) * (0.5 + h2 * 0.5);
            g.fillRect(px2 - 1.4, py2 - 1.4, 2.8, 2.8);
          }
          g.restore(); g.globalAlpha = 1;
        } else if (f.type === 'dome') {
          // (JB3) shield dome: layered hex-shimmer arcs facing the attacker + one ripple
          var face = (f.side === 'player') ? 0 : Math.PI, R0 = f.r || 28;
          var shimmer = (1 - p) * (0.55 + 0.45 * Math.sin(p * 18));
          g.save(); g.strokeStyle = PALETTE.aqua; g.shadowColor = PALETTE.aqua; g.shadowBlur = 10;
          for (var d2 = 0; d2 < 2; d2++) {
            g.globalAlpha = shimmer * (d2 ? 0.45 : 0.85); g.lineWidth = d2 ? 1.4 : 2.4;
            g.beginPath(); g.arc(cx, cy, R0 + d2 * 5 + p * 4, face - 1.22, face + 1.22); g.stroke();
          }
          g.globalAlpha = shimmer * 0.6; g.lineWidth = 1;
          for (var sp2 = -3; sp2 <= 3; sp2++) {
            var aa = face + sp2 * 0.35, r1 = R0 - 3, r2 = R0 + 8 + p * 4;
            g.beginPath(); g.moveTo(cx + Math.cos(aa) * r1, cy + Math.sin(aa) * r1);
            g.lineTo(cx + Math.cos(aa) * r2, cy + Math.sin(aa) * r2); g.stroke();
          }
          g.restore(); g.globalAlpha = 1;
          blastRing(g, cx, cy, 16 + p * 26, PALETTE.aqua, (1 - p) * 0.5, 2);
        } else if (f.type === 'motes') {
          // (JB3) repair: mantis motes spiral upward off the hull, alternating dots and + glyphs
          g.save(); g.fillStyle = PALETTE.mantis; g.shadowColor = PALETTE.mantis; g.shadowBlur = 8;
          g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '700 10px Montserrat,Arial,sans-serif';
          for (var mk = 0; mk < 8; mk++) {
            var mp = p - mk * 0.05; if (mp < 0 || mp > 1) continue;
            var mx = cx + Math.sin(mp * 5 + mk * 2.2) * (9 + mk), my = cy + 12 - mp * 40;
            g.globalAlpha = (1 - mp) * 0.9;
            if (mk % 2) { g.fillStyle = PALETTE.mantis; g.fillText('+', mx, my); }
            else { g.beginPath(); g.arc(mx, my, 1.8, 0, 6.283); g.fill(); }
          }
          g.restore(); g.globalAlpha = 1;
          g.save(); g.globalAlpha = (1 - p) * 0.18; g.fillStyle = PALETTE.mantis; g.shadowColor = PALETTE.mantis;
          g.shadowBlur = 24; g.beginPath(); g.arc(cx, cy, 24 + p * 8, 0, 6.283); g.fill(); g.restore(); g.globalAlpha = 1;
        } else if (f.type === 'shock') {
          // (JB3) detonation shockwave: hot white leading ring + colored chaser
          blastRing(g, cx, cy, 12 + p * 74, '#FFFFFF', (1 - p) * 0.85, 3);
          if (p > 0.12) blastRing(g, cx, cy, 8 + (p - 0.12) * 82, f.col || PALETTE.gold, (1 - p) * 0.7, 2);
        } else if (f.type === 'quake') {
          // (JB3) impact-synced shake: ramps the existing canvas jitter exactly when the hit lands
          s.shakeT = Math.max(s.shakeT || 0, (f.amt || 0.3) * (1 - p));
        } else if (f.type === 'banner') {
          // (JB3) kill banner: gold caps slide in with overshoot, hold, fade
          var W2 = (L && L.W) || s.canvas.clientWidth || 320;
          var bp = Math.min(1, p * 2.4), c1 = 1.70158, c3 = c1 + 1;
          var eb = 1 + c3 * Math.pow(bp - 1, 3) + c1 * Math.pow(bp - 1, 2);
          var bx = f.static ? W2 / 2 : W2 / 2 + (1 - eb) * W2 * 0.55;   // (B3) static banner: no slide
          var balpha = p < 0.8 ? 1 : (1 - p) / 0.2;
          g.save(); g.globalAlpha = balpha * 0.35; g.strokeStyle = f.col || PALETTE.gold; g.lineWidth = 1;
          g.beginPath(); g.moveTo(bx - 90, cy - 34); g.lineTo(bx + 90, cy - 34); g.stroke();
          g.beginPath(); g.moveTo(bx - 90, cy - 18); g.lineTo(bx + 90, cy - 18); g.stroke();
          g.globalAlpha = balpha; g.textAlign = 'center'; g.textBaseline = 'middle';
          g.fillStyle = f.col || PALETTE.gold; g.shadowColor = f.col || PALETTE.gold; g.shadowBlur = 14;
          g.font = '800 15px Montserrat,Arial,sans-serif';
          g.fillText(f.text || 'TARGET DESTROYED', bx, cy - 26);
          g.restore(); g.globalAlpha = 1;
        } else if (f.type === 'dmg' || f.type === 'heal') {
          var col = f.type === 'heal' ? PALETTE.mantis : (f.big ? PALETTE.gold : PALETTE.peach);
          g.save(); g.globalAlpha = f.static ? (p < 0.7 ? 1 : (1 - p) / 0.3) : 1 - p; g.textAlign = 'center'; g.textBaseline = 'middle';
          g.shadowColor = 'rgba(0,0,0,.9)'; g.shadowBlur = 4; g.fillStyle = col;
          g.font = '900 ' + (f.big ? 26 : 19) + 'px Montserrat,Arial,sans-serif';
          g.fillText((f.type === 'heal' ? '+' : '\u2212') + f.amount, cx, cy - 18 - (f.static ? 0 : p * 30));
          g.shadowBlur = 0; g.restore(); g.globalAlpha = 1;
        } else if (f.type === 'shield') {
          blastRing(g, cx, cy, 16 + p * 24, PALETTE.aqua, (1 - p) * 0.8, 3);
        } else if (f.type === 'death') {
          var dscale = (f.scale || 1.9) * (1 + p * 0.7);
          g.save(); g.globalAlpha = 1 - p; g.translate(cx, L.yShip); g.scale(-1, 1); g.scale(dscale, dscale);
          g.strokeStyle = f.col || PALETTE.peach; g.lineWidth = 1.6; g.fillStyle = 'rgba(20,20,30,.5)';
          g.shadowColor = f.col || PALETTE.peach; g.shadowBlur = 20;
          g.beginPath(); g.moveTo(14, 0); g.lineTo(-10, -8); g.lineTo(-5, 0); g.lineTo(-10, 8); g.closePath(); g.fill(); g.stroke();
          g.restore(); g.globalAlpha = 1;
          blastRing(g, cx, L.yShip, 18 + p * 46, f.col || PALETTE.gold, (1 - p) * 0.9, 3);
        }
      }
      s.fx = keep;
    }
    function drawArena(s, ts) {
      var g = s.c2d; if (!g) return;
      var W = s.canvas.clientWidth || 320, H = s.canvas.clientHeight || 188;
      drawBackdrop(g, s, W, H);
      drawBelt(g, s, W, H, ts, s.reduced);
      var b = s.run.battle;
      var yShip = Math.round(H * 0.54), cxL = Math.round(W * 0.24), cxR = Math.round(W * 0.78);
      var sc = clamp(H / 95, 1.6, 3.4), L = { cxL: cxL, cxR: cxR, yShip: yShip, W: W };
      drawHeroes(g, s, cxL, yShip, sc, ts, s.reduced);
      // (v0.80.0, JB3) keep the dying hull on screen through the staged kill — it breaks up
      // at the core detonation (s.deathAt), not the instant the winning answer lands
      if (b && b.enemy && (!b.over || (s.deathAt && ts < s.deathAt))) drawEnemy(g, s, b.enemy, cxR, yShip, sc, ts);
      fxRenderOverlays(s, ts, L);
    }
    // ---- intro cutscene (skippable, replayable). Lifts the combat cell to full-cover, then drops it back. ----
    var INTRO_CAPS = [[0, 'The BCM raids the Kuiper belt.'], [1, 'Contact \u2014 a BCM warship, hiding in the rocks.'], [2, 'It fires \u2014 and runs. Answer fast. Hit hard. Chase it down.']];
    function drawIntro(s, ts) {
      var io = s.intro; if (io.last == null) io.last = ts;
      var dt = (ts - io.last) / 1000; io.last = ts; if (dt > 0.05) dt = 0.05; io.t += dt;
      var g = s.c2d; if (!g) return;
      var W = s.canvas.clientWidth || 320, H = s.canvas.clientHeight || 188;
      drawBackdrop(g, s, W, H); drawBelt(g, s, W, H, ts, s.reduced);
      var T = io.t, B = io.B;
      // (Jason v0.48.0) cinematic rework: WARP-IN -> contact blip -> DECLOAK + a warning shot across
      // the squad's bow -> the warship burns away, with a slow dramatic zoom. Skippable, reduced-safe.
      var zoomK = s.reduced ? 0 : clamp((T - B[2]) / (B[3] - B[2]), 0, 1);
      g.save();
      if (zoomK > 0) { var zs = 1 + 0.06 * zoomK; g.translate(W / 2, H / 2); g.scale(zs, zs); g.translate(-W / 2, -H / 2); }
      var ex = W * 0.78, ey = H / 2, cxC = W * 0.26;
      var SQ = [[0, -12, 1.5, PALETTE.peach], [-10, 10, 1.5, PALETTE.iris], [4, 24, 1.4, PALETTE.mantis]];
      var shot = clamp((T - (B[1] + 1.0)) / 0.35, 0, 1);          // the warning bolt's flight window
      var jink = (shot >= 1 && T < B[2] + 0.6 && !s.reduced) ? Math.sin((T - B[1] - 1.35) * 22) * 5 * Math.max(0, 1 - (T - B[1] - 1.35)) : 0;
      for (var qi = 0; qi < SQ.length; qi++) {
        var qs = SQ[qi], warpAt = qi * 0.22, wk = clamp((T - warpAt) / 0.5, 0, 1);
        var sx = cxC + qs[0], sy = H / 2 + qs[1] + jink * (qi === 0 ? 1 : 0.6);
        if (wk <= 0) continue;
        if (wk < 1 && !s.reduced) {                                 // warp streak resolving into the ship
          g.save(); g.strokeStyle = 'rgba(31,221,233,' + (0.7 * (1 - wk)) + ')'; g.lineWidth = 3;
          g.beginPath(); g.moveTo(sx - 90 * (1 - wk), sy); g.lineTo(sx + 26, sy); g.stroke();
          g.fillStyle = 'rgba(255,255,255,' + (0.8 * (1 - wk)) + ')'; g.beginPath(); g.arc(sx, sy, 10 * (1 - wk) + 2, 0, 6.283); g.fill(); g.restore();
        }
        g.save(); g.globalAlpha = 0.25 + 0.75 * wk; drawShip(g, sx, sy, qs[2] * (0.7 + 0.3 * wk), qs[3], 10); g.restore(); g.globalAlpha = 1;
      }
      if (T >= B[1] * 0.5 && T < B[2] && !s.reduced) {              // radar sweep + a pulsing contact blip where it will decloak
        var sweep = ((T * 1.6) % 1) * 6.283; g.save(); g.strokeStyle = 'rgba(31,221,233,.45)'; g.lineWidth = 2;
        g.beginPath(); g.moveTo(cxC, H / 2); g.lineTo(cxC + Math.cos(sweep) * 70, H / 2 + Math.sin(sweep) * 70); g.stroke();
        var bp = 0.5 + 0.5 * Math.sin(T * 6);
        g.strokeStyle = 'rgba(255,107,91,' + (0.25 + 0.45 * bp) + ')'; g.beginPath(); g.arc(ex, ey, 16 + bp * 10, 0, 6.283); g.stroke(); g.restore();
      }
      if (T >= B[1]) {
        var app = clamp((T - B[1]) / 0.8, 0, 1), turn = clamp((T - B[2]) / 1.2, 0, 1);
        g.save(); g.translate(ex, ey); g.globalAlpha = app; g.scale((1 - 2 * turn) * (0.6 + 0.4 * app), 1);
        drawShip(g, 0, 0, 2.2, PALETTE.peach, 10 + app * 8); g.restore(); g.globalAlpha = 1;
        if (app < 1 && !s.reduced) {                                // decloak scanline shimmer
          g.save(); g.globalAlpha = 0.35 * (1 - app); g.fillStyle = PALETTE.peach;
          for (var ln = -3; ln <= 3; ln++) g.fillRect(ex - 46, ey + ln * 9 + Math.sin(T * 30 + ln) * 2, 92, 1.5);
          g.restore(); g.globalAlpha = 1;
        }
        if (shot > 0 && shot < 1) {                                 // the warning bolt streaks across the squad's bow
          var bx = ex - 40 - shot * (ex - cxC - 10), by = ey - 6 - shot * 14;
          g.save(); g.strokeStyle = PALETTE.peach; g.shadowColor = PALETTE.peach; g.shadowBlur = 12; g.lineWidth = 3.5;
          g.beginPath(); g.moveTo(bx + 26, by + 4); g.lineTo(bx, by); g.stroke(); g.restore(); g.shadowBlur = 0;
        } else if (shot >= 1 && T < B[1] + 1.75 && !s.reduced) {    // near-miss flash past the squad
          var fk = clamp((T - B[1] - 1.35) / 0.4, 0, 1);
          g.save(); g.globalAlpha = 0.5 * (1 - fk); g.fillStyle = PALETTE.peach;
          g.beginPath(); g.arc(cxC - 26, ey - 22, 8 + fk * 14, 0, 6.283); g.fill(); g.restore(); g.globalAlpha = 1;
        }
        if (turn > 0.4) {                                           // engine flare as it burns away
          g.save(); g.fillStyle = PALETTE.peach; g.shadowColor = PALETTE.peach; g.shadowBlur = 16;
          var fl = clamp((turn - 0.4) / 0.6, 0, 1), cr = 3 + (Math.sin(T * 12) * 0.5 + 0.5) * 6 + fl * 6;
          g.beginPath(); g.arc(ex - 28 - fl * 10, ey, cr, 0, 6.283); g.fill();
          g.globalAlpha = 0.4 * fl; g.beginPath(); g.moveTo(ex - 30, ey - 5); g.lineTo(ex - 30 - 60 * fl, ey); g.lineTo(ex - 30, ey + 5); g.closePath(); g.fill();
          g.restore(); g.globalAlpha = 1; g.shadowBlur = 0;
        }
      }
      g.restore();
      var cap = ''; for (var i = 0; i < INTRO_CAPS.length; i++) { if (T >= B[INTRO_CAPS[i][0]]) cap = INTRO_CAPS[i][1]; }
      if (s.introCap) s.introCap.textContent = cap;
      if (T >= B[3]) endIntro(s);
    }
    function playIntro(s, done) {
      endIntroOverlayOnly(s);
      s.intro = { active: true, t: 0, last: null, done: done || function () {}, B: s.reduced ? [0, 1, 2, 3.2] : [0, 2, 4.2, 7.2] };   // (v0.48.0) air for the warning-shot beat
      if (s.combat) s.combat.className = 'kbb-combat is-cine';   // lift to full-cover for the cinematic
      if (s.canvas && s.canvas.style) s.canvas.style.display = '';
      if (s.threeCanvas) s.threeCanvas.style.display = 'none';
      sizeCanvas(s);
      var cap = el(s.doc, 'div', 'kbb-cine-cap'); s.introCap = cap; s.combat.appendChild(cap);
      var skip = el(s.doc, 'button', 'kbb-skip', 'Skip \u25B6'); s.introSkip = skip;
      skip.onclick = function () { try { if (s.ctx.audio && s.ctx.audio.sfx) s.ctx.audio.sfx('click'); } catch (e) {} endIntro(s); };
      s.combat.appendChild(skip);
      if (s.leftCol) s.leftCol.style.visibility = 'hidden';
      if (s.enemyPanel) s.enemyPanel.style.visibility = 'hidden';
      if (s.mainPanel) s.mainPanel.textContent = '';
    }
    function endIntro(s) {
      if (!s.intro) return;
      var done = s.intro.done; s.intro.active = false; endIntroOverlayOnly(s); s.intro = null;
      if (s.combat) s.combat.className = 'kbb-combat';            // drop back into the grid cell
      sizeCanvas(s);
      if (s.use3D && s.threeCanvas) { s.threeCanvas.style.display = ''; s.canvas.style.display = 'none'; }
      if (done) done();
    }
    function endIntroOverlayOnly(s) {
      if (s.introCap && s.introCap.parentNode) s.introCap.parentNode.removeChild(s.introCap);
      if (s.introSkip && s.introSkip.parentNode) s.introSkip.parentNode.removeChild(s.introSkip);
      s.introCap = null; s.introSkip = null;
    }

    // ---- 3D combat attempt (Three.js billboards). Browser + WebGL only. ----
    // Guarded: only runs when window.THREE is present and not reduced-motion, and
    // FAILS SAFE to the verified 2D canvas on ANY error (at init OR per-frame).
    // Set window.KBB_FORCE_2D = true to disable. The 2D path is the default whenever
    // THREE is absent (this chat's harness, and any build that does not load THREE).
    var HERO_3D = [
      { x: -2.25, y: 0.0, z: 0.2, scl: 1.45, key: 'kbbHero1', col: 0x7855FA, ph: 0.0, lf: 0.9 },
      { x: -3.05, y: 0.95, z: -0.2, scl: 1.05, key: 'kbbHero2', col: 0x1FDDE9, ph: 1.7, lf: 0.65 },
      { x: -3.1, y: -0.95, z: -0.1, scl: 1.0, key: 'kbbHero3', col: 0x92DD23, ph: 3.1, lf: 0.6 }
    ];
    function makeSpriteTexture(s, THREE, kind, col, faceLeft) {
      var c = s.doc.createElement('canvas'); c.width = c.height = 256;
      var g = c.getContext && c.getContext('2d'); if (!g) return null;
      g.clearRect(0, 0, 256, 256); g.translate(128, 128);
      if (faceLeft) g.scale(-1, 1);
      var hex = '#' + ('000000' + (col >>> 0).toString(16)).slice(-6);
      if (kind === 'rock') {
        g.rotate(0.4); g.fillStyle = 'rgba(70,70,92,.95)'; g.strokeStyle = 'rgba(120,120,150,.9)'; g.lineWidth = 5;
        g.beginPath(); for (var p = 0; p < 7; p++) { var a = (p / 7) * 6.283, rr = 70 + ((p * 53) % 30); var px = Math.cos(a) * rr, py = Math.sin(a) * rr; if (p === 0) g.moveTo(px, py); else g.lineTo(px, py); } g.closePath(); g.fill(); g.stroke();
        g.fillStyle = 'rgba(40,40,56,.9)'; g.beginPath(); g.arc(-18, -10, 14, 0, 6.283); g.fill(); g.beginPath(); g.arc(22, 18, 10, 0, 6.283); g.fill();
      } else {
        g.shadowColor = hex; g.shadowBlur = 26; g.lineJoin = 'round';
        g.beginPath(); g.moveTo(-70, 0); g.lineTo(80, -32); g.lineTo(118, 0); g.lineTo(80, 32); g.closePath();
        g.fillStyle = 'rgba(30,30,46,.85)'; g.strokeStyle = hex; g.lineWidth = 8; g.fill(); g.stroke();
        g.beginPath(); g.arc(26, 0, 14, 0, 6.283); g.fillStyle = '#1FDDE9'; g.shadowColor = '#1FDDE9'; g.shadowBlur = 22; g.fill();
        g.beginPath(); g.arc(-70, 0, 16, 0, 6.283); g.fillStyle = (kind === 'enemy') ? '#FFC857' : hex; g.shadowColor = hex; g.shadowBlur = 26; g.fill();
      }
      var tex = new THREE.CanvasTexture(c); tex.needsUpdate = true; return tex;
    }
    function texFor(s, THREE, key, kind, col, faceLeft, created) {
      var img = assetImg(s, key), tex;
      if (img) { tex = new THREE.Texture(img); tex.needsUpdate = true; }
      else { tex = makeSpriteTexture(s, THREE, kind, col, faceLeft); }
      if (tex) created.push(tex);
      return tex;
    }
    function spriteOf(THREE, tex, col) {
      var m = new THREE.SpriteMaterial({ map: tex, transparent: true, color: col != null ? col : 0xffffff });
      return new THREE.Sprite(m);
    }
    function maybeInit3D(s) {
      try {
        var view = s.doc.defaultView, THREE = view && view.THREE;
        if (s.reduced || !THREE || (view && view.KBB_FORCE_2D) || s.use3D) return;
        if (init3D(s, THREE)) {
          s.use3D = true;
          if (s.canvas && s.canvas.style) s.canvas.style.display = 'none';
          if (s.threeCanvas) s.threeCanvas.style.display = '';
          if (s.fxCanvas) s.fxCanvas.style.display = '';
        }
      } catch (e) { teardown3D(s); s.use3D = false; }
    }
    function init3D(s, THREE) {
      var W = (s.combat && s.combat.clientWidth) || s.canvas.clientWidth || 320, H = (s.combat && s.combat.clientHeight) || s.canvas.clientHeight || 188, created = [];   // (K7) container-based
      var renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
      renderer.setPixelRatio(Math.min(2, s.doc.defaultView.devicePixelRatio || 1));
      renderer.setSize(W, H, false);
      var dom = renderer.domElement; dom.className = 'kbb-3d'; dom.style.display = 'none'; s.combat.appendChild(dom);
      // (v0.80.0, JB3) transparent FX overlay ABOVE the 3D view: the whole 2D cinematic fx
      // pipeline (numbers, beams, domes, banners) renders here, projected into 3D screen space
      var fx = s.doc.createElement('canvas'); fx.className = 'kbb-fx';
      var fpr = Math.min(2, s.doc.defaultView.devicePixelRatio || 1);
      fx.width = Math.max(1, Math.round(W * fpr)); fx.height = Math.max(1, Math.round(H * fpr));
      fx.style.display = 'none'; s.combat.appendChild(fx);
      s.fxCanvas = fx; s.fxCtx = fx.getContext ? fx.getContext('2d') : null; s.fxPr = fpr;
      var scene = new THREE.Scene(); scene.fog = new THREE.FogExp2(0x06060c, 0.06);
      var camera = new THREE.PerspectiveCamera(50, W / Math.max(1, H), 0.1, 100); camera.position.set(0, 0, 6);
      scene.add(new THREE.AmbientLight(0x8888bb, 0.9));
      var key = new THREE.PointLight(0x7855FA, 1.0, 60); key.position.set(-3, 3, 6); scene.add(key);
      // stars
      var geo = new THREE.BufferGeometry(), N = 220, pos = new Float32Array(N * 3);
      for (var i = 0; i < N; i++) { pos[i * 3] = (Math.random() - 0.5) * 18; pos[i * 3 + 1] = (Math.random() - 0.5) * 11; pos[i * 3 + 2] = -Math.random() * 14 - 1; }
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      var stars = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xcfd2ff, size: 0.06, transparent: true, opacity: 0.85 }));
      scene.add(stars);
      // asteroids
      var roids = [];
      for (i = 0; i < 9; i++) {
        var ak = ASSET_ASTEROIDS[i % ASSET_ASTEROIDS.length];
        var sp = spriteOf(THREE, texFor(s, THREE, ak, 'rock', 0x46465c, false, created), 0xffffff);
        var sc = 0.35 + Math.random() * 0.7; sp.scale.set(sc, sc, sc);
        sp.position.set((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 5.4, -Math.random() * 4 + 0.5);
        sp.userData = { vx: -(0.15 + Math.random() * 0.35) * (0.4 + sp.position.z * 0.1 + 1) };
        scene.add(sp); roids.push(sp);
      }
      // heroes
      var heroes = [];
      for (i = 0; i < HERO_3D.length; i++) {
        var h = HERO_3D[i];
        var hs = spriteOf(THREE, texFor(s, THREE, h.key, 'hero', h.col, false, created), 0xffffff);
        hs.scale.set(h.scl, h.scl, h.scl); hs.position.set(h.x, h.y, h.z);
        scene.add(hs); heroes.push(hs);
      }
      // enemy (two textures: normal + boss)
      var enemyTexN = texFor(s, THREE, ASSET_ENEMY, 'enemy', 0xFF6B5B, true, created);
      var enemyTexB = texFor(s, THREE, ASSET_BOSS, 'enemy', 0xFFC857, true, created);
      var enemy = spriteOf(THREE, enemyTexN, 0xffffff); enemy.scale.set(1.9, 1.9, 1.9); enemy.position.set(2.4, 0, 0);
      scene.add(enemy);
      s.threeCanvas = dom;
      s.three = { THREE: THREE, renderer: renderer, scene: scene, camera: camera, stars: stars, roids: roids, heroes: heroes, enemy: enemy, enemyTexN: enemyTexN, enemyTexB: enemyTexB, created: created, last: 0, enemyBoss: null, W: W, H: H, _pv: null };
      return true;
    }
    function render3D(s, ts) {
      var T = s.three; if (!T) return false;
      try {
        var dt = T.last ? Math.min(0.05, (ts - T.last) / 1000) : 0.016; T.last = ts;
        var i, sp;
        for (i = 0; i < T.roids.length; i++) {
          sp = T.roids[i]; sp.position.x += sp.userData.vx * dt; if (sp.position.x < -5.2) sp.position.x = 5.2;
          sp.material.rotation += dt * 0.4 * ((i % 2) ? 1 : -1);
        }
        T.stars.rotation.z += dt * 0.01;
        var plunge = fxActive(s, ts, 'lunge', 'player'), elunge = fxActive(s, ts, 'lunge', 'enemy');
        var poff = plunge ? Math.sin((ts - plunge.start) / plunge.dur * Math.PI) * 0.7 : 0;
        var eoff = elunge ? Math.sin((ts - elunge.start) / elunge.dur * Math.PI) * 0.7 : 0;
        var kIn3 = battleEase(s, ts), exit3 = heroExitDx(s, ts) / 60;   // world units
        for (i = 0; i < T.heroes.length; i++) {
          var h = HERO_3D[i];
          T.heroes[i].position.x = h.x + poff * h.lf - (1 - kIn3) * 9 + exit3;
          T.heroes[i].position.y = h.y + Math.sin(ts / 680 + h.ph) * 0.08;
        }
        var b = s.run.battle, hasEnemy = !!(b && b.enemy && (!b.over || (s.deathAt && ts < s.deathAt)));   // (JB3) hull persists through the staged kill
        T.enemy.visible = hasEnemy;
        if (hasEnemy) {
          var boss = !!b.enemy.boss;
          if (T.enemyBoss !== boss) { T.enemy.material.map = boss ? T.enemyTexB : T.enemyTexN; T.enemy.material.needsUpdate = true; T.enemy.scale.setScalar(boss ? 2.3 : 1.9); T.enemyBoss = boss; }
          T.enemy.position.x = 2.4 - eoff + (1 - kIn3) * 9; T.enemy.position.y = Math.sin(ts / 520) * 0.1;
          var flash = fxActive(s, ts, 'flash', 'enemy');
          T.enemy.material.color.setScalar(flash ? 1.0 + (1 - (ts - flash.start) / flash.dur) * 1.4 : 1.0);
        }
        T.camera.position.x = Math.sin(ts / 4000) * 0.15;
        T.camera.lookAt(0, 0, 0);
        T.renderer.render(T.scene, T.camera);
        // (v0.80.0, JB3) cinematic fx overlay: project squad/enemy anchors into screen space
        // and run the SAME 2D fx pipeline on the transparent canvas above the 3D view
        if (s.fxCtx && s.fxCanvas) {
          var fg = s.fxCtx;
          fg.setTransform(1, 0, 0, 1, 0, 0);
          fg.clearRect(0, 0, s.fxCanvas.width, s.fxCanvas.height);
          if (s.fx && s.fx.length) {
            var k3 = Math.max(1, T.W / 320);                      // author-space: fx are sized for the 320-wide 2D arena
            fg.setTransform(s.fxPr * k3, 0, 0, s.fxPr * k3, 0, 0);
            var pv = T._pv || (T._pv = new THREE.Vector3());      // cached scratch — no per-frame allocation
            pv.set(-3, 0, 0); pv.project(T.camera);
            var pxL = (pv.x * 0.5 + 0.5) * T.W / k3;
            pv.set(2.4, 0, 0); pv.project(T.camera);
            var pxR = (pv.x * 0.5 + 0.5) * T.W / k3, pyS = (-pv.y * 0.5 + 0.5) * T.H / k3;
            fxRenderOverlays(s, ts, { cxL: pxL, cxR: pxR, yShip: pyS, W: T.W / k3 }, fg);
          }
        }
        return true;
      } catch (e) { teardown3D(s); s.use3D = false; if (s.canvas && s.canvas.style) s.canvas.style.display = ''; return false; }
    }
    function teardown3D(s) {
      var T = s.three; s.three = null;
      if (s.threeCanvas && s.threeCanvas.parentNode) s.threeCanvas.parentNode.removeChild(s.threeCanvas);
      s.threeCanvas = null;
      if (s.fxCanvas && s.fxCanvas.parentNode) s.fxCanvas.parentNode.removeChild(s.fxCanvas);
      s.fxCanvas = null; s.fxCtx = null;
      if (!T) return;
      try {
        var i;
        for (i = 0; T.created && i < T.created.length; i++) { if (T.created[i] && T.created[i].dispose) T.created[i].dispose(); }
        function killSprite(sp) { if (sp && sp.material) { if (sp.material.map && T.created.indexOf(sp.material.map) < 0 && sp.material.map.dispose) sp.material.map.dispose(); sp.material.dispose(); } }
        for (i = 0; T.roids && i < T.roids.length; i++) killSprite(T.roids[i]);
        for (i = 0; T.heroes && i < T.heroes.length; i++) killSprite(T.heroes[i]);
        if (T.enemy) killSprite(T.enemy);
        if (T.stars) { if (T.stars.geometry) T.stars.geometry.dispose(); if (T.stars.material) T.stars.material.dispose(); }
        if (T.renderer) { T.renderer.dispose(); if (T.renderer.forceContextLoss) { try { T.renderer.forceContextLoss(); } catch (e) {} } }
      } catch (e) {}
    }

    // ---- artifact tooltips (hover + keyboard focus), clamped within container bounds ----
    function showTip(s, tile, def) {
      var d = s.doc, tip = s.tipEl; tip.textContent = '';
      var tn = el(d, 'div', 'tn');
      var sw = el(d, 'i'); sw.style.background = CAT_COLOR[def.category] || PALETTE.iris; tn.appendChild(sw);
      tn.appendChild(d.createTextNode(def.name));
      tn.appendChild(el(d, 'span', 'tr', def.rarity));
      tip.appendChild(tn);
      tip.appendChild(el(d, 'div', 'td', def.description));
      tip.classList.add('show');
      positionTip(s, tile);
    }
    function hideTip(s) { if (s.tipEl) s.tipEl.classList.remove('show'); }
    function positionTip(s, tile) {
      var tip = s.tipEl, cont = s.container;
      if (!tip || !cont || !cont.getBoundingClientRect) return;
      var cr = cont.getBoundingClientRect(), tr = tile.getBoundingClientRect(), pad = 8;
      var tw = tip.offsetWidth || 200, th = tip.offsetHeight || 60;
      var left = tr.left - cr.left, top = (tr.bottom - cr.top) + 6;
      if (left + tw > cr.width - pad) left = cr.width - pad - tw;
      if (left < pad) left = pad;
      if (top + th > cr.height - pad) top = (tr.top - cr.top) - th - 6;   // flip above the tile
      if (top < pad) top = pad;
      tip.style.left = left + 'px'; tip.style.top = top + 'px';
    }
    function attachTooltip(s, tile, def) {
      tile.classList.add('tipped');
      tile.tabIndex = 0;
      tile.setAttribute('role', 'button');
      tile.setAttribute('aria-label', def.name + ': ' + def.description);
      tile.addEventListener('pointerenter', function () { showTip(s, tile, def); });
      tile.addEventListener('pointerleave', function () { hideTip(s); });
      tile.addEventListener('focus', function () { showTip(s, tile, def); });
      tile.addEventListener('blur', function () { hideTip(s); });
    }

    // ---- toast + drag-to-sell + artifact tiles ----
    function toast(s, msg) {
      if (!s.container) return;
      if (s.toastEl && s.toastEl.parentNode) s.toastEl.parentNode.removeChild(s.toastEl);
      var t = el(s.doc, 'div', 'kbb-toast', msg); s.toastEl = t; s.container.appendChild(t);
      schedule(s, function () { if (t.parentNode) t.parentNode.removeChild(t); }, 1400);
    }
    function overEl(node, x, y) { var r = node.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; }
    function moveGhost(gh, x, y) { gh.style.left = x + 'px'; gh.style.top = y + 'px'; }
    function trySell(s, slot) {
      var r = sellArtifact(s.run, slot);
      toast(s, r.ok ? ('Sold for +' + r.refund + 'c') : (r.reason === 'unsellable' ? 'Can\u2019t sell that one' : 'Sell failed'));
      renderMain(s); renderSquad(s); renderArtifacts(s); renderCoins(s); renderLog(s);
    }
    function bindDragSell(s, tile, slotIndex, def) {
      tile.addEventListener('pointerdown', function (ev) {
        if (s.ui.replaceOffer >= 0) return;
        ev.preventDefault(); hideTip(s);
        var ghost = tile.cloneNode(true); ghost.className = 'kbb-tile draggable kbb-ghost';
        s.doc.body.appendChild(ghost); moveGhost(ghost, ev.clientX, ev.clientY);
        var move = function (e) { moveGhost(ghost, e.clientX, e.clientY); if (s.sellZone) s.sellZone.classList.toggle('hot', overEl(s.sellZone, e.clientX, e.clientY)); };
        var up = function (e) {
          s.doc.removeEventListener('pointermove', move); s.doc.removeEventListener('pointerup', up);
          s._dragCleanup = null;
          if (ghost.parentNode) ghost.parentNode.removeChild(ghost);
          var hit = s.sellZone && overEl(s.sellZone, e.clientX, e.clientY);
          if (s.sellZone) s.sellZone.classList.remove('hot');
          if (hit) trySell(s, slotIndex);
        };
        s._dragCleanup = function () { s.doc.removeEventListener('pointermove', move); s.doc.removeEventListener('pointerup', up); if (ghost.parentNode) ghost.parentNode.removeChild(ghost); };
        s.doc.addEventListener('pointermove', move); s.doc.addEventListener('pointerup', up);
      });
    }
    function artifactTile(s, def, slotIndex, shopCtx) {
      var tile = s.doc.createElement('div'); tile.className = 'kbb-tile';
      var sw = s.doc.createElement('span'); sw.className = 'sw'; sw.style.background = CAT_COLOR[def.category] || PALETTE.iris;
      tile.appendChild(sw); tile.appendChild(s.doc.createTextNode(def.name));
      attachTooltip(s, tile, def);   // hover + keyboard focus tooltip (task 3)
      if (shopCtx) {
        if (s.ui.replaceOffer >= 0) {
          tile.className += ' picking';
          tile.onclick = function () { doReplace(s, s.ui.replaceOffer, slotIndex); };
        } else if (isSellable(def)) {
          tile.className += ' draggable'; bindDragSell(s, tile, slotIndex, def);
        } else {
          tile.className += ' nosell'; tile.appendChild(el(s.doc, 'span', 'lock', '\uD83D\uDD12'));
        }
      }
      return tile;
    }
    function doReplace(s, offerIndex, slotIndex) {
      shopReplaceArtifact(s.run, offerIndex, slotIndex); s.ui.replaceOffer = -1;
      renderMain(s); renderSquad(s); renderArtifacts(s); renderCoins(s); renderLog(s);
    }

    // ---- renders ----
    function renderAll(s) {
      if (s.leftCol) s.leftCol.style.visibility = '';
      renderTop(s); renderEnemy(s); renderSquad(s); renderArtifacts(s); renderCoins(s); renderMain(s); renderLog(s);
    }
    function renderTop(s) {
      var t = s.topBar; t.textContent = '';
      var run = s.run;
      var left = s.doc.createElement('span');
      left.innerHTML = 'Kuiper Belt Battle &nbsp; depth <b>' + run.section + '-' + run.round + '</b>';
      var replay = s.doc.createElement('button'); replay.className = 'kbb-skip'; replay.style.position = 'static'; replay.style.padding = '2px 8px'; replay.textContent = '\u21BB intro';
      replay.onclick = function () { playIntro(s, function () { drawQuestion(s.run); renderAll(s); }); };
      left.appendChild(replay);
      var right = s.doc.createElement('span');
      var cleared = run.depthClearedSection + '-' + run.depthClearedRound;
      right.innerHTML = 'cleared <b>' + cleared + '</b> &nbsp; best <b>' + bestLabel(s.best) + '</b>';
      t.appendChild(left); t.appendChild(right);
    }
    function bestLabel(score) { if (!score) return '-'; return Math.floor(score / 100) + '-' + (score % 100); }

    // BLUE zone: enemy data only. "Incoming attack" (was "Intent") + red pulse alert (task 4).
    function renderEnemy(s) {
      var b = s.run.battle;
      // (v0.100.0, K5/K6) a NEW battle: reset the fly-in clock, clear any exit flight,
      // and sound the round-start sting.
      if (b && b.enemy && !b.over) {
        var bk = s.run.section + '-' + s.run.round + '-' + (b.enemy.name || '');
        if (bk !== s._battleKey) {
          s._battleKey = bk; s.battleStartAt = s.lastTs || 0; s.heroExitAt = 0;
          try { if (s.ctx.audio && s.ctx.audio.sfx) s.ctx.audio.sfx('collect'); } catch (eRS) {}
        }
      }
      // (v0.50.0) boss music: the fixed 'boss' bed (intensity layer) while a boss battle is live,
      // back to the kbb context bed when it isn't. Transition-guarded so playlist rotation only
      // advances on real switches, never per-render.
      try {
        var b0 = s.run && s.run.battle;
        var wantTrack = (b0 && b0.enemy && !b0.over && b0.enemy.boss) ? 'boss' : 'kbb';
        if (s._musicCtx !== wantTrack && s.ctx && s.ctx.audio && s.ctx.audio.playTrack) {
          s._musicCtx = wantTrack;
          s.ctx.audio.playTrack(wantTrack, wantTrack === 'boss' ? { intensity: true } : undefined);
        }
      } catch (e0) {}

      if (!b || !b.enemy) { if (s.enemyText) s.enemyText.innerHTML = ''; if (s.enemyPanel) s.enemyPanel.style.visibility = 'hidden'; return; }
      if (s.enemyPanel) s.enemyPanel.style.visibility = '';
      if (!s.enemyText) return;
      var e = b.enemy, ci = currentIntent(s.run);
      var icls = 'kbb-intent', itxt, alert = false;
      if (b.over || e.hp <= 0) { icls += ' dead'; itxt = '\u2620 DESTROYED'; }   // (v0.98.0, K8) say what happened
      else if (e.locked) { icls += ' shield'; itxt = 'Immune \u00B7 lvl 3 Q'; }
      else if (e.shieldUp) { icls += ' shield'; itxt = 'Shield up'; }
      else if (ci === 0) { icls += ' charge'; itxt = 'Charging'; }
      else { itxt = 'Incoming attack \u2694 ' + ci; alert = true; }
      if (alert) icls += ' alert';
      s.enemyText.innerHTML =
        '<div class="kbb-eyebrow">BCM warship' + (e.boss ? ' \u00B7 <span style="color:' + PALETTE.gold + '">BOSS</span>' : '') + '</div>' +
        '<div class="ennm">' + e.name + '</div>' +
        '<span class="' + icls + '">' + itxt + '</span>' +
        ((b.attackIndex + 1 >= b.maxAttacks)
          ? '<div class="kbb-statline"><span class="final">FINAL ATTACK \u00b7 ' + (b.attackIndex + 1) + '/' + b.maxAttacks + ' \u2014 finish it or it escapes</span></div>'
          : '<div class="kbb-statline"><span>attack <b>' + (b.attackIndex + 1) + '</b>/' + b.maxAttacks + '</span></div>');
    }

    function renderSquad(s) {
      if (!s.squadText) return;
      var sq = s.run.squad;
      s.squadText.innerHTML =
        '<div class="lg"><span class="dt" style="background:' + PALETTE.mantis + '"></span>HP <b>' + sq.hp + '</b> / ' + sq.maxHp + '</div>' +
        '<div class="lg"><span class="dt" style="background:' + PALETTE.aqua + '"></span>Shield <b>' + sq.shield + '</b></div>' +
        '<div class="st">power <b>' + sq.basePower + '</b> &nbsp; block <b>' + sq.block + '</b></div>';
    }

    function renderArtifacts(s) {
      var p = s.artPanel; p.textContent = '';
      var sq = s.run.squad;
      p.appendChild(el(s.doc, 'div', 'kbb-eyebrow', 'Artifacts \u00b7 ' + sq.artifacts.length + '/' + CONFIG.maxArtifacts));
      // (v0.78.0, JB2) always render maxArtifacts SLOTS: filled = full card, empty = invite
      var arts = s.doc.createElement('div'); arts.className = 'kbb-arts kbb-slots';
      for (var i = 0; i < CONFIG.maxArtifacts; i++) {
        var slot = s.doc.createElement('div');
        var a = sq.artifacts[i];
        if (a) {
          slot.className = 'kbb-slot';
          slot.style.borderLeftColor = CAT_COLOR[a.def.category] || PALETTE.iris;
          slot.innerHTML = '<div class="nm"><span class="sw" style="width:8px;height:14px;border-radius:3px;flex:none;background:' + (CAT_COLOR[a.def.category] || PALETTE.iris) + '"></span>' + a.def.name + '<span class="rar kbb-rar-' + a.def.rarity + '">' + a.def.rarity + '</span></div><div class="desc">' + a.def.description + '</div>';
        } else {
          slot.className = 'kbb-slot empty';
          slot.textContent = 'Slot ' + (i + 1) + ' \u2014 empty';
        }
        arts.appendChild(slot);
      }
      p.appendChild(arts);
      if (s.run.consumables.length) {
        var crow = s.doc.createElement('div'); crow.className = 'kbb-shoprow';
        for (var ci2 = 0; ci2 < s.run.consumables.length; ci2++) {
          (function (cid) {
            var btn = s.doc.createElement('button'); btn.className = 'kbb-btn alt';
            btn.textContent = 'Use ' + CONSUMABLES[cid].name;
            btn.disabled = s.run.phase !== 'battle';
            btn.onclick = function () { onUseConsumable(s, cid); };
            crow.appendChild(btn);
          })(s.run.consumables[ci2]);
        }
        p.appendChild(crow);
      }
    }

    function renderCoins(s) {
      s.coinPanel.innerHTML = '<span class="kbb-eyebrow">Coins</span><span class="v">\u25CE ' + s.run.squad.coins + '</span>';
    }

    function renderMain(s) {
      if (s.run.phase !== 'lost') clearLost(s);
      var p = s.mainPanel; p.className = 'kbb-main'; p.textContent = '';
      if (s.run.phase === 'lost') { renderLost(s); return; }
      if (s.run.phase === 'shop') return renderShop(s, p);
      return renderBattle(s, p);
    }

    function clearLost(s) { if (s.lostEl && s.lostEl.parentNode) s.lostEl.parentNode.removeChild(s.lostEl); s.lostEl = null; }
    // YELLOW stays clear; lost is a full-cover modal so no panel bleeds behind it.
    function renderLost(s) {
      saveBest(s); clearLost(s);
      try { var P3 = s.ctx.persistence; if (P3 && P3.update) P3.update(function (p) { if (p.saves) delete p.saves.KBB; }); else if (P3 && P3.load && P3.save) P3.load().then(function (p) { if (p.saves && p.saves.KBB) { delete p.saves.KBB; return P3.save(p); } }).catch(function () {}); } catch (eCl) {}   // (v0.108.0, G4) live profile
      var d = s.doc, ov = el(d, 'div', 'kbb-lost'); s.lostEl = ov;
      var card = el(d, 'div', 'kbb-lost-card');
      card.appendChild(el(d, 'div', 'kbb-big', 'Run over'));
      var sub = el(d, 'div', 'kbb-row'); sub.style.justifyContent = 'center';
      sub.innerHTML = '<span>Reached depth <b style="color:' + PALETTE.gold + '">' + s.run.depthClearedSection + '-' + s.run.depthClearedRound + '</b></span>';
      card.appendChild(sub);
      var row = el(d, 'div', 'kbb-shoprow'); row.style.justifyContent = 'center'; row.style.marginTop = '16px';
      var again = el(d, 'button', 'kbb-btn', 'New run'); again.onclick = function () { restart(s); };
      row.appendChild(again); card.appendChild(row);
      ov.appendChild(card); s.container.appendChild(ov);
    }
    function restart(s) {
      s.ui.replaceOffer = -1; clearLost(s); hideTip(s);
      s._battleKey = ''; s.battleStartAt = s.lastTs || 0; s.heroExitAt = 0;   // (v0.108.0, G4) fresh run = fresh fly-in + sting
      s.run = createRun(s.ctx, {});   // (v0.68.0, J6) restarts skip the loadout shop too — consistent straight-to-battle opening
      renderAll(s);
    }

    function renderBattle(s, p) {
      if (s.enemyPanel && s.enemyPanel.classList) s.enemyPanel.classList.remove('kbb-en-strike');   // (v0.48.0) telegraph resets with the fresh question
      var b = s.run.battle;
      var q = b ? b.question : null;
      if (!q) { var d = drawQuestion(s.run); q = d ? d.question : null; }
      if (!q) { p.appendChild(el(s.doc, 'div', 'kbb-stem', 'No question available.')); return; }
      s.qShownAt = nowMs(s);
      s.locked = false;
      var multi = isMultiQ(q); s.multiSel = []; s.submitEl = null;
      p.appendChild(el(s.doc, 'div', 'kbb-stem', q.stem));
      if (q.image) p.appendChild(el(s.doc, 'div', 'kbb-exhibit-warn', '\u26A0 Exhibit question served in error \u2014 its image only renders in Study/Exam.'));   // (v0.91.0) loud leak guard
      var opts = s.doc.createElement('div'); opts.className = 'kbb-opts';
      for (var i = 0; i < q.options.length; i++) {
        (function (idx) {
          var btn = s.doc.createElement('button'); btn.className = 'kbb-opt';
          var ruled = b.revealed.indexOf(idx) >= 0;
          if (ruled) { btn.className += ' ruled'; btn.disabled = true; }
          var kk = s.doc.createElement('span'); kk.className = 'k'; kk.textContent = (idx + 1) + '.';
          btn.appendChild(kk); btn.appendChild(s.doc.createTextNode(q.options[idx]));
          btn.setAttribute('data-idx', idx);
          if (multi) {
            btn.onclick = function () {
              if (s.locked) return;
              var at = s.multiSel.indexOf(idx);
              if (at >= 0) { s.multiSel.splice(at, 1); btn.classList.remove('sel'); }
              else { s.multiSel.push(idx); btn.classList.add('sel'); }
              if (s.submitEl) s.submitEl.disabled = s.multiSel.length === 0;
            };
          } else {
            btn.onclick = function () { onAnswer(s, idx); };
          }
          opts.appendChild(btn);
        })(i);
      }
      // (K5) pre-answer action choice: a correct answer executes the selected action.
      var actRow = el(s.doc, 'div', 'kbb-actions');
      var acts = [
        { id: 'attack', label: '\u2694 Attack' },
        { id: 'brace', label: '\uD83D\uDEE1 Brace +' + s.run.squad.block },
        { id: 'repair', label: '\u271A Repair +' + s.run.squad.healPower }
      ];
      s.pendingAction = 'attack';
      for (var ai = 0; ai < acts.length; ai++) {
        (function (a) {
          var ab = s.doc.createElement('button');
          ab.className = 'kbb-action' + (a.id === 'attack' ? ' on' : ''); ab.type = 'button'; ab.textContent = a.label;
          ab.setAttribute('data-act', a.id);
          ab.onclick = function () {
            if (s.locked) return;
            s.pendingAction = a.id;
            var all = actRow.querySelectorAll('.kbb-action');
            for (var bi = 0; bi < all.length; bi++) all[bi].classList.toggle('on', all[bi].getAttribute('data-act') === a.id);
          };
          actRow.appendChild(ab);
        })(acts[ai]);
      }
      p.appendChild(actRow);
      p.appendChild(el(s.doc, 'div', 'kbb-act-hint', 'Correct fires your action \u00b7 Wrong = the enemy strikes free'));   // (v0.48.0) the loop in one line
      p.appendChild(opts);
      if (multi) {
        p.appendChild(el(s.doc, 'div', 'kbb-multi-hint', 'Select all that apply (' + q.correctIndices.length + '), then submit.'));
        var sub = s.doc.createElement('button'); sub.className = 'kbb-cont kbb-submit'; sub.textContent = 'Submit answer'; sub.disabled = true;
        sub.onclick = function () { onAnswer(s, s.multiSel.slice()); };
        p.appendChild(sub); s.submitEl = sub;
      }
      var fb = el(s.doc, 'div', 'kbb-fb'); fb.id = 'kbb-fb'; p.appendChild(fb);
      s.optsEl = opts; s.fbEl = fb;
    }

    function onAnswer(s, answer) {
      if (s.intro && s.intro.active) return;
      if (s.paused) return;
      if (s.locked || s.run.phase !== 'battle') return;
      s.locked = true; hideTip(s);
      if (s.submitEl) s.submitEl.disabled = true;
      var q = s.run.battle.question;
      var multi = isMultiQ(q);
      var ms = nowMs(s) - s.qShownAt;
      var res = submitAnswer(s.run, answer, ms, s.pendingAction || 'attack');
      if (!s.reduced) {
        var en = s.run.battle && s.run.battle.enemy;
        var ecol = en && en.boss ? PALETTE.gold : PALETTE.peach, esc = en && en.boss ? 2.3 : 1.9;
        // (v0.80.0, JB3) cinematic choreography: telegraph -> lunge -> bolt -> impact, every
        // beat readable as cause and effect; shakes ride 'quake' fx so they land WITH the hit.
        if (res.correct && res.damage > 0) {
          // (v0.100.0, K6) hero volley ~1.1s: charge -> three-shot volley -> impact
          pushFx(s, { type: 'charge', side: 'player', dur: 260, col: PALETTE.aqua });
          pushFx(s, { type: 'lunge', side: 'player', dur: 420, delay: 120 });
          pushFx(s, { type: 'sfx', name: 'fire', side: 'player', dur: 60, delay: 320 });
          pushFx(s, { type: 'beam', side: 'enemy', dur: 200, delay: 320, col: PALETTE.aqua });
          pushFx(s, { type: 'sfx', name: 'fire', side: 'player', dur: 60, delay: 440 });
          pushFx(s, { type: 'beam', side: 'enemy', dur: 200, delay: 440, col: PALETTE.aqua });
          pushFx(s, { type: 'sfx', name: 'fire', side: 'player', dur: 60, delay: 560 });
          pushFx(s, { type: 'beam', side: 'enemy', dur: 200, delay: 560, col: PALETTE.aqua });
          pushFx(s, { type: 'flash', side: 'enemy', dur: 320, delay: 620, flashR: en && en.boss ? 82 : 66 });
          pushFx(s, { type: 'sparks', side: 'enemy', dur: 620, delay: 620, col: ecol, count: 12, seed: 3 });
          pushFx(s, { type: 'sfx', name: 'hit', side: 'enemy', dur: 60, delay: 640 });
          pushFx(s, { type: 'dmg', side: 'enemy', amount: res.damage, dur: 760, delay: 660, big: res.win });
          if (!res.win) pushFx(s, { type: 'quake', side: 'enemy', dur: 220, delay: 620, amt: 0.16 });
        } else if (res.correct && res.blocked) {
          pushFx(s, { type: 'charge', side: 'player', dur: 180, col: PALETTE.aqua });
          pushFx(s, { type: 'lunge', side: 'player', dur: 380, delay: 60 });
          pushFx(s, { type: 'beam', side: 'enemy', dur: 190, delay: 150, col: PALETTE.aqua });
          pushFx(s, { type: 'dome', side: 'enemy', dur: 520, delay: 320 });
        } else if (res.correct && res.action === 'brace') {
          pushFx(s, { type: 'dome', side: 'player', dur: 620 });
        } else if (res.correct && res.action === 'repair') {
          pushFx(s, { type: 'motes', side: 'player', dur: 900 });
          if (res.healed > 0) pushFx(s, { type: 'heal', side: 'player', amount: res.healed, dur: 760, delay: 180 });
        }
        if (res.win) {
          // staged kill: secondary explosions crawl the hull, then the core detonates
          s.deathAt = (s.lastTs || 0) + 1080;                    // hull persists until HERE
          pushFx(s, { type: 'flash', side: 'enemy', dur: 240, delay: 620, flashR: 30, dx: -18, dy: -10 });
          pushFx(s, { type: 'flash', side: 'enemy', dur: 240, delay: 770, flashR: 26, dx: 16, dy: 9 });
          pushFx(s, { type: 'flash', side: 'enemy', dur: 240, delay: 920, flashR: 34, dx: 5, dy: -14 });
          pushFx(s, { type: 'flash', side: 'enemy', dur: 460, delay: 1080, flashR: en && en.boss ? 110 : 88 });
          pushFx(s, { type: 'shock', side: 'enemy', dur: 700, delay: 1080, col: ecol });
          pushFx(s, { type: 'sparks', side: 'enemy', dur: 900, delay: 1080, col: ecol, count: 22, seed: 7, spread: 1.7 });
          pushFx(s, { type: 'quake', side: 'enemy', dur: 340, delay: 1080, amt: 0.5 });
          pushFx(s, { type: 'death', side: 'enemy', dur: 680, delay: 1100, col: ecol, scale: esc });
          pushFx(s, { type: 'sfx', name: 'explode', side: 'enemy', dur: 60, delay: 640 });
          pushFx(s, { type: 'sfx', name: 'explode', side: 'enemy', dur: 60, delay: 1090 });
          pushFx(s, { type: 'banner', side: 'enemy', dur: 1500, delay: 1300, text: en && en.boss ? 'BOSS DESTROYED' : 'TARGET DESTROYED', col: PALETTE.gold });
          s.heroExitAt = (s.lastTs || 0) + 2900;   // (v0.100.0, K5) after the banner, the squad flies off RIGHT
        }
        if (res.enemyAttacked) {
          // (v0.100.0, K6, Jason) the enemy attack is a GIANT charged laser, ~2.4s end to end:
          // long charge glow (with sound) -> thick beam -> impact particles and damage.
          var ed = res.correct ? 480 : 90;
          if (s.enemyPanel && s.enemyPanel.classList) { s.enemyPanel.classList.remove('kbb-en-strike'); s.enemyPanel.classList.add('kbb-en-strike'); }   // (v0.48.0) the intent panel STRIKES when its attack lands
          pushFx(s, { type: 'sfx', name: 'lasercharge', side: 'enemy', dur: 60, delay: ed });
          pushFx(s, { type: 'charge', side: 'enemy', dur: 1100, delay: ed, col: PALETTE.peach });
          pushFx(s, { type: 'lunge', side: 'enemy', dur: 420, delay: ed + 950 });
          pushFx(s, { type: 'sfx', name: 'laserfire', side: 'enemy', dur: 60, delay: ed + 1150 });
          pushFx(s, { type: 'beam', side: 'player', dur: 380, delay: ed + 1150, col: PALETTE.peach, thick: true });
          var toHp = (res.toHp == null ? res.incoming : res.toHp);
          if (toHp > 0) {
            pushFx(s, { type: 'flash', side: 'player', dur: 340, delay: ed + 1500, flashR: 54 });
            pushFx(s, { type: 'sparks', side: 'player', dur: 620, delay: ed + 1500, col: PALETTE.peach, count: 14, seed: 5 });
            pushFx(s, { type: 'sfx', name: 'laserhit', side: 'player', dur: 60, delay: ed + 1500 });
            pushFx(s, { type: 'dmg', side: 'player', amount: toHp, dur: 760, delay: ed + 1520 });
            pushFx(s, { type: 'quake', side: 'player', dur: 300, delay: ed + 1500, amt: 0.45 });   // shake WHEN the beam lands
          } else if (res.incoming > 0) {
            pushFx(s, { type: 'dome', side: 'player', dur: 520, delay: ed + 1500 });
            pushFx(s, { type: 'sfx', name: 'hit', side: 'player', dur: 60, delay: ed + 1500 });
            pushFx(s, { type: 'quake', side: 'player', dur: 200, delay: ed + 1500, amt: 0.2 });
          }
        }
      } else {
        // (v0.85.0, B3) reduced motion suppresses MOTION, not information: the numbers, the
        // kill banner, and the strike telegraph still tell the story — statically, no shake.
        var enR = s.run.battle && s.run.battle.enemy;
        if (res.correct && res.damage > 0) pushFx(s, { type: 'dmg', side: 'enemy', amount: res.damage, dur: 900, big: res.win, static: true });
        if (res.correct && res.action === 'repair' && res.healed > 0) pushFx(s, { type: 'heal', side: 'player', amount: res.healed, dur: 900, static: true });
        if (res.win) pushFx(s, { type: 'banner', side: 'enemy', dur: 1400, text: enR && enR.boss ? 'BOSS DESTROYED' : 'TARGET DESTROYED', col: PALETTE.gold, static: true });
        if (res.enemyAttacked) {
          if (s.enemyPanel && s.enemyPanel.classList) { s.enemyPanel.classList.remove('kbb-en-strike'); s.enemyPanel.classList.add('kbb-en-strike'); }
          var toHpR = (res.toHp == null ? res.incoming : res.toHp);
          if (toHpR > 0) pushFx(s, { type: 'dmg', side: 'player', amount: toHpR, dur: 900, static: true });
        }
      }
      var correctSet = multi ? q.correctIndices : [q.correctIndex];
      var chosenSet = multi ? answer : [answer];
      var btns = s.optsEl.querySelectorAll('.kbb-opt');
      for (var i = 0; i < btns.length; i++) {
        btns[i].disabled = true;
        var bi = parseInt(btns[i].getAttribute('data-idx'), 10);
        btns[i].classList.remove('sel');
        if (correctSet.indexOf(bi) >= 0) btns[i].className = 'kbb-opt correct';
        else if (chosenSet.indexOf(bi) >= 0) btns[i].className = 'kbb-opt wrong';
      }
      var fb = s.fbEl; fb.innerHTML = '';
      var ok, headTxt;
      if (res.refunded) { ok = false; headTxt = '\u2717 Wrong \u2014 Retry Buffer refunded the attack.'; }
      else if (res.correct) { ok = true; headTxt = '\u2713 Correct' + (res.blocked ? ' \u2014 attack blocked' : ' \u2014 ' + res.damage + ' damage'); }
      else { ok = false; headTxt = '\u2717 Wrong \u2014 no damage' + (res.enemyAttacked ? ' \u2014 enemy hit you for ' + res.incoming : ''); }
      fb.className = 'kbb-fb ' + (ok ? 'ok' : 'no');
      fb.appendChild(el(s.doc, 'div', null, headTxt));
      // (v0.88.0, L3) per-option rationale for the actual wrong pick
      if (!ok && !res.refunded && Array.isArray(q.optionNotes)) {
        var wrongPick5 = -1;
        for (var wp5 = 0; wp5 < chosenSet.length; wp5++) { if (correctSet.indexOf(chosenSet[wp5]) < 0) { wrongPick5 = chosenSet[wp5]; break; } }
        if (wrongPick5 >= 0 && q.optionNotes[wrongPick5]) fb.appendChild(el(s.doc, 'div', 'kbb-fb-note', 'Your pick \u2014 ' + q.optionNotes[wrongPick5]));
      }
      if (q.explanation) {                                       // (v0.71.0, J8) 150-word display cap
        var wx = String(q.explanation).trim().split(/\s+/);
        if (wx.length <= 120) fb.appendChild(el(s.doc, 'div', 'kbb-fb-exp', q.explanation));
        else {
          var exEl = el(s.doc, 'div', 'kbb-fb-exp', wx.slice(0, 120).join(' ') + '\u2026');
          var det = s.doc.createElement('details'); det.className = 'kbb-fb-more';
          var sm = s.doc.createElement('summary'); sm.textContent = 'Show the full explanation (' + (wx.length - 120) + ' more words)';
          var bd = s.doc.createElement('div'); bd.textContent = wx.slice(120).join(' ');
          det.appendChild(sm); det.appendChild(bd); exEl.appendChild(det);
          fb.appendChild(exEl);
        }
      }
      var contLabel = (res.win || res.loss) ? 'See results \u25b8' : 'Continue \u25b8';
      var cont = s.doc.createElement('button'); cont.className = 'kbb-cont'; cont.textContent = contLabel;
      cont.onclick = function () { afterAnswer(s, res); };
      fb.appendChild(cont);
      try { cont.focus(); } catch (e) {}
      renderTop(s); renderEnemy(s); renderSquad(s); renderLog(s);
    }
    function afterAnswer(s, res) {
      if (res.win) { s.ui.replaceOffer = -1; saveBest(s); renderAll(s); return; }
      if (res.loss) { saveBest(s); renderAll(s); return; }
      if (res.refunded) { drawQuestion(s.run); renderMain(s); renderEnemy(s); return; }
      drawQuestion(s.run);
      renderMain(s); renderEnemy(s); renderSquad(s);
    }
    function onUseConsumable(s, cid) {
      if (s.run.phase !== 'battle') return;
      var r = useConsumable(s.run, cid);
      renderEnemy(s); renderSquad(s); renderArtifacts(s); renderLog(s);
    }

    function renderShop(s, p) {
      var run = s.run;
      p.className = 'kbb-main is-shop';        // (v0.78.0, JB2) head + actions pinned, middle scrolls
      var outer = p;
      var head = s.doc.createElement('div'); head.className = 'kbb-shop-h';
      head.innerHTML = '<div class="kbb-name">Resupply</div><div class="kbb-statline"><span class="kbb-coin">' + run.squad.coins + 'c</span><span>artifacts <b>' + run.squad.artifacts.length + '</b>/' + CONFIG.maxArtifacts + '</span></div>';
      p.appendChild(head);
      var sc = el(s.doc, 'div', 'kbb-shop-scroll'); outer.appendChild(sc); p = sc;
      var full = run.squad.artifacts.length >= CONFIG.maxArtifacts, i;
      if (s.ui.replaceOffer >= 0) {
        var off0 = run.shop.artifacts[s.ui.replaceOffer];
        var banner = el(s.doc, 'div', 'kbb-sec'); banner.style.color = PALETTE.gold;
        banner.textContent = 'Pick one of your artifacts to replace with ' + (off0 ? ARTIFACTS_BY_ID[off0.id].name : '?') + ' \u2014 or cancel below';
        p.appendChild(banner);
      }
      p.appendChild(el(s.doc, 'div', 'kbb-sec', 'Artifacts'));
      for (i = 0; i < run.shop.artifacts.length; i++) {
        (function (oi) {
          var off = run.shop.artifacts[oi]; var def = ARTIFACTS_BY_ID[off.id];
          var card = s.doc.createElement('div'); card.className = 'kbb-card';
          card.style.borderLeftColor = CAT_COLOR[def.category] || PALETTE.iris;
          var body = s.doc.createElement('div'); body.className = 'body';
          body.innerHTML = '<div class="nm">' + def.name + '<span class="rar kbb-rar-' + def.rarity + '">' + def.rarity + '</span></div><div class="desc">' + def.description + '</div>';
          var side = s.doc.createElement('div'); side.className = 'side';
          var buy = s.doc.createElement('button'); buy.className = 'kbb-btn';
          buy.textContent = (full ? 'Replace' : 'Buy') + ' ' + off.price + 'c';
          buy.disabled = run.squad.coins < off.price;
          buy.onclick = function () { onBuyArtifact(s, oi, full); };
          side.appendChild(buy);
          card.appendChild(body); card.appendChild(side); p.appendChild(card);
        })(i);
      }
      p.appendChild(el(s.doc, 'div', 'kbb-sec', 'Ship fittings \u2014 one per visit, permanent +1'));
      var bwrap = s.doc.createElement('div'); bwrap.className = 'kbb-cons';
      for (var bfi = 0; bfi < KBB.BOOSTS.length; bfi++) {
        (function (bi) {
          var bdef = KBB.BOOSTS[bi], price = KBB._test ? (CONFIG.boostPriceBase + (run.section - 1) * CONFIG.boostPricePerSection) : 8;
          var bc = s.doc.createElement('div'); bc.className = 'c' + (run.shop.boostBought ? ' full' : '');
          bc.innerHTML = '<div class="cn">' + bdef.name + '</div><div class="cd">Permanent. One fitting per shop.</div>';
          var bb = s.doc.createElement('button'); bb.className = 'kbb-btn alt';
          bb.textContent = run.shop.boostBought ? 'Fitted' : ('Buy ' + price + 'c');
          bb.disabled = run.shop.boostBought || run.squad.coins < price;
          bb.onclick = function () { shopBuyBoost(s.run, bi); renderMain(s); renderSquad(s); renderCoins(s); };
          bc.appendChild(bb); bwrap.appendChild(bc);
        })(bfi);
      }
      p.appendChild(bwrap);
      p.appendChild(el(s.doc, 'div', 'kbb-sec', 'Consumables'));
      var cwrap = s.doc.createElement('div'); cwrap.className = 'kbb-cons';
      var cfull = run.consumables.length >= CONFIG.consumableCap;
      for (i = 0; i < run.shop.consumables.length; i++) {
        (function (oi) {
          var off = run.shop.consumables[oi]; var def = CONSUMABLES[off.id];
          var c = s.doc.createElement('div'); c.className = 'c' + (cfull ? ' full' : '');
          c.innerHTML = '<div class="cn">' + def.name + '</div><div class="cd">' + def.description + '</div>';
          var buy = s.doc.createElement('button'); buy.className = 'kbb-btn alt';
          buy.textContent = cfull ? 'Slots full' : ('Buy ' + off.price + 'c');
          buy.disabled = cfull || run.squad.coins < off.price;
          buy.onclick = function () { onBuyConsumable(s, oi); };
          c.appendChild(buy); cwrap.appendChild(c);
        })(i);
      }
      p.appendChild(cwrap);
      p.appendChild(el(s.doc, 'div', 'kbb-sec', 'Your artifacts \u2014 drag to sell (50%)'));
      var owned = s.doc.createElement('div'); owned.className = 'kbb-arts';
      if (run.squad.artifacts.length === 0) owned.appendChild(el(s.doc, 'div', 'kbb-tile empty', 'none yet'));
      for (i = 0; i < run.squad.artifacts.length; i++) owned.appendChild(artifactTile(s, run.squad.artifacts[i].def, i, true));
      p.appendChild(owned);
      var sell = el(s.doc, 'div', 'kbb-sell'); s.sellZone = sell;
      if (s.ui.replaceOffer >= 0) {
        sell.innerHTML = '<b>Cancel</b> replace'; sell.style.cursor = 'pointer';
        sell.onclick = function () { s.ui.replaceOffer = -1; renderMain(s); };
      } else {
        sell.innerHTML = 'Drag an artifact here to <b>sell</b> for 50% &nbsp;\u00B7&nbsp; legendary / cursed / once-per-run can\u2019t be sold';
      }
      p.appendChild(sell);
      var shoprow = s.doc.createElement('div'); shoprow.className = 'kbb-shoprow kbb-shop-actions';
      var rb = s.doc.createElement('button'); rb.className = 'kbb-btn alt';
      rb.textContent = 'Reroll ' + run.shop.rerollCost + 'c'; rb.disabled = run.squad.coins < run.shop.rerollCost;
      rb.onclick = function () { shopReroll(s.run); s.ui.replaceOffer = -1; renderMain(s); renderSquad(s); renderCoins(s); };
      var lv = s.doc.createElement('button'); lv.className = 'kbb-btn';
      lv.textContent = run._preRun ? 'Start run \u25B8' : (run.round < CONFIG.roundsPerSection ? 'Next battle \u2192' : 'Next section \u2192');
      lv.onclick = function () { onLeaveShop(s); };
      shoprow.appendChild(rb); shoprow.appendChild(lv); outer.appendChild(shoprow);   // pinned, never scrolls away
    }
    function onBuyArtifact(s, oi, full) {
      if (full) { s.ui.replaceOffer = oi; renderMain(s); return; }
      shopBuyArtifact(s.run, oi);
      renderMain(s); renderSquad(s); renderArtifacts(s); renderCoins(s); renderLog(s);
    }
    function onBuyConsumable(s, oi) { shopBuyConsumable(s.run, oi); renderMain(s); renderSquad(s); renderArtifacts(s); renderCoins(s); }
    function onLeaveShop(s) {
      s.ui.replaceOffer = -1;
      if (s.run._preRun) { startDungeon(s.run); } else { leaveShop(s.run); }
      // (v0.106.0, G2) the shop exit is the checkpoint: section/round/squad/artifacts
      try {
        var P2 = s.ctx.persistence;
        if (P2) {
          var rq = s.run.squad;
          // (v0.108.0, G4) full-fidelity snapshot: artifact per-instance STATE (compounding
          // stacks), once-per-run flags (Lazarus stays burned), and the depth score.
          var snap = { section: s.run.section, round: s.run.round,
            squad: { hp: rq.hp, maxHp: rq.maxHp, shield: rq.shield, startShield: rq.startShield || 0, basePower: rq.basePower, block: rq.block, healPower: rq.healPower, coins: rq.coins },
            artifacts: rq.artifacts.map(function (ai) { return { id: ai.def.id, state: ai.state || {} }; }),
            flags: s.run.flags || {},
            depthClearedSection: s.run.depthClearedSection || 0, depthClearedRound: s.run.depthClearedRound || 0,
            consumables: s.run.consumables.slice(),
            label: 'Depth ' + s.run.section + '-' + s.run.round + ' \u00b7 ' + rq.artifacts.length + ' artifacts \u00b7 ' + rq.coins + 'c' };
          if (P2.update) P2.update(function (p) { p.saves = p.saves || {}; p.saves.KBB = snap; });   // (G4 HIGH) live profile
          else if (P2.load && P2.save) P2.load().then(function (p) { p.saves = p.saves || {}; p.saves.KBB = snap; return P2.save(p); }).catch(function () {});
        }
      } catch (eSv) {}
      drawQuestion(s.run); renderAll(s);
    }

    function showHowTo(s, done) {
      var d = s.doc, anim = !s.reduced;
      var ov = el(d, 'div', 'kbb-howto'); if (anim) ov.className += ' kbb-ht-anim';
      s.container.appendChild(ov);

      // each step after the intro spotlights one real screen zone (by state ref) with a callout
      var ZONES = [
        { ref: 'leftCol',    t: 'Your squad',        pos: 'bottom', x: 'Your fleet. The ring shows hull HP (inner) and shield (outer) \u2014 if HP hits zero, the run ends.' },
        { ref: 'enemyPanel', t: 'The enemy',         pos: 'bottom', x: 'The BCM you\u2019re fighting. Its ring is its HP, and its incoming attack is flagged here so you can brace for it.' },
        { ref: 'combat',     t: 'Battle arena',      pos: 'bottom', x: 'The fight plays out here \u2014 your hits and the enemy\u2019s strikes animate in this view.' },
        { ref: 'mainPanel',  t: 'Questions & shop',  pos: 'top',    x: 'The panel that drives the game: answer the exam question to attack, and spend coins in the shop between battles.' },
        { ref: 'artPanel',   t: 'Artifacts & coins', pos: 'bottom', x: 'Artifacts are permanent perks you\u2019ve earned; your coins (just below) buy more in the shop.' },
        { ref: 'topBar',     t: 'Depth & best',      pos: 'bottom', x: 'How deep into the belt you are, and your best depth so far. Your score is the depth you reach.' }
      ];
      var steps = ZONES.length + 1, i = 0, spot = null;

      function clearSpot() { if (spot) { spot.classList.remove('kbb-ht-spot'); spot = null; } }
      function finish() { clearSpot(); if (ov.parentNode) ov.parentNode.removeChild(ov); done(); }

      function stepRow(last) {
        var row = el(d, 'div', 'kbb-ht-row');
        var dots = el(d, 'div', 'kbb-ht-dots');
        for (var k = 0; k < steps; k++) dots.appendChild(el(d, 'i', 'kbb-ht-dot' + (k === i ? ' on' : '')));
        var skip = el(d, 'button', 'kbb-ht-skip', 'Skip'); skip.onclick = finish;
        var next = el(d, 'button', 'kbb-btn kbb-ht-next', last ? 'Start \u25B8' : 'Next \u25B8');
        next.onclick = function () { if (last) finish(); else { i++; render(); } };
        row.appendChild(dots); row.appendChild(skip); row.appendChild(next);
        return row;
      }

      function introCard() {
        var panel = el(d, 'div', 'kbb-howto-panel');
        panel.appendChild(el(d, 'div', 'kbb-howto-eyebrow', 'Kuiper Belt Battle'));
        panel.appendChild(el(d, 'div', 'kbb-howto-h', 'How to play'));
        var demo = el(d, 'div', 'kbb-ht-demo');
        demo.innerHTML = '<svg width="92" height="92" viewBox="0 0 92 92" aria-hidden="true">' +
          '<circle cx="46" cy="46" r="38" fill="none" stroke="rgba(31,221,233,.20)" stroke-width="5"/>' +
          '<circle class="kbb-ht-ring" cx="46" cy="46" r="38" fill="none" stroke="#1FDDE9" stroke-width="5" stroke-linecap="round" transform="rotate(-90 46 46)" style="--dash:238.8;--off:131;stroke-dasharray:238.8;stroke-dashoffset:' + (anim ? '238.8' : '131') + ';"/>' +
          '<circle cx="46" cy="46" r="29" fill="none" stroke="rgba(122,225,160,.20)" stroke-width="5"/>' +
          '<circle class="kbb-ht-ring" cx="46" cy="46" r="29" fill="none" stroke="#7AE1A0" stroke-width="5" stroke-linecap="round" transform="rotate(-90 46 46)" style="--dash:182.2;--off:50;stroke-dasharray:182.2;stroke-dashoffset:' + (anim ? '182.2' : '50') + ';"/>' +
          '<text class="kbb-ht-sword" x="46" y="55" text-anchor="middle" font-size="26" fill="#F2F2F7">\u2694</text></svg>';
        panel.appendChild(demo);
        var list = el(d, 'div', 'kbb-howto-list');
        var rules = [
          ['\u2694', 'Answer exam questions to attack the BCM \u2014 a correct answer deals damage, a wrong one wastes the turn.'],
          ['\u2620', 'You get ' + CONFIG.maxAttacks + ' attacks per enemy and it strikes back after each. Reach 0 HP and the run ends.'],
          ['\u25C8', 'Win battles to earn coins, then spend them in the shop on artifacts (permanent perks) and consumables.'],
          ['\u221E', 'Each section is ' + (CONFIG.roundsPerSection - 1) + ' battles + a boss, escalating endlessly \u2014 your score is the depth you reach.']
        ];
        for (var r = 0; r < rules.length; r++) {
          var li = el(d, 'div', 'kbb-howto-li');
          if (anim) li.style.animationDelay = (0.4 + r * 0.4) + 's';
          li.appendChild(el(d, 'span', 'kbb-howto-ic', rules[r][0]));
          li.appendChild(el(d, 'span', null, rules[r][1]));
          list.appendChild(li);
        }
        panel.appendChild(list);
        return panel;
      }

      function render() {
        clearSpot();
        ov.textContent = '';
        var last = (i === steps - 1);
        if (i === 0) {
          ov.classList.remove('kbb-ht-tour');
          var panel = introCard();
          panel.appendChild(stepRow(last));
          ov.appendChild(panel);
        } else {
          ov.classList.add('kbb-ht-tour');
          var z = ZONES[i - 1];
          var tgt = s[z.ref];
          if (tgt) { tgt.classList.add('kbb-ht-spot'); spot = tgt; }
          var call = el(d, 'div', 'kbb-ht-call pos-' + z.pos);
          call.appendChild(el(d, 'div', 'kbb-ht-call-h', z.t));
          call.appendChild(el(d, 'div', 'kbb-ht-call-x', z.x));
          call.appendChild(stepRow(last));
          ov.appendChild(call);
          // (v0.90.0, review) phones scroll the stacked layout — bring the spotlighted zone
          // (and the callout with the only Next/Skip controls) into view or the tour soft-locks.
          try { if (tgt && tgt.scrollIntoView) tgt.scrollIntoView({ block: 'center' }); } catch (e2) {}
          try { if (call.scrollIntoView) call.scrollIntoView({ block: 'nearest' }); } catch (e3) {}
        }
      }
      render();
    }

    function renderLog(s) { var m = s.run.log; s.logEl ? (s.logEl.textContent = m.length ? m[m.length - 1] : '') : 0; }

    function handleKey(s, e) {
      if (s.paused) return;
      if (s.run.phase === 'battle' && !s.locked) {
        var n = parseInt(e.key, 10);
        if (n >= 1 && n <= 9 && s.run.battle && s.run.battle.question && n <= s.run.battle.question.options.length) {
          if (s.run.battle.revealed.indexOf(n - 1) >= 0) return;
          e.preventDefault(); onAnswer(s, n - 1);
        }
      }
    }
    function nowMs(s) {
      var view = s.root.ownerDocument.defaultView;
      return (view.performance && view.performance.now) ? view.performance.now() : Date.now();
    }
    function schedule(s, fn, ms) {
      var view = s.root.ownerDocument.defaultView;
      var id = view.setTimeout(function () { fn(); }, ms);
      s.timers.push(id); return id;
    }
    function saveBest(s) {
      var score = scoreOf(s.run);
      if (score > s.best) s.best = score;
      if (s.ctx.persistence && s.ctx.persistence.load && s.ctx.persistence.save) {
        s.ctx.persistence.load().then(function (p) {
          if (!p) return; p.bests = p.bests || {};
          if (!(typeof p.bests.KBB === 'number') || p.bests.KBB < score) { p.bests.KBB = score; return s.ctx.persistence.save(p); }
        }).catch(function () {});
      }
      renderTop(s);
    }

    // ---- pause / resume (Core's signature; Core wires the visual pause overlay) ----
    function pause() {
      var s = state; if (!s || s.paused) return;
      s.paused = true;
      var view = s.root.ownerDocument.defaultView;
      if (s.raf) { view.cancelAnimationFrame(s.raf); s.raf = 0; }
      s._pauseAt = nowMs(s);
    }
    function resume() {
      var s = state; if (!s || !s.paused) return;
      s.paused = false;
      if (s._pauseAt != null) { var delta = nowMs(s) - s._pauseAt; if (s.qShownAt) s.qShownAt += delta; s._pauseAt = null; }
      s.fx = [];                       // drop in-flight FX so the post-resume timestamp jump can't glitch
      if (s.three) s.three.last = 0;
      loop(s);
    }

    function unmount() {
      var s = state; if (!s) return;
      var view = s.root.ownerDocument.defaultView;
      if (s._dragCleanup) { try { s._dragCleanup(); } catch (e) {} s._dragCleanup = null; }
      teardown3D(s);
      if (s.raf) view.cancelAnimationFrame(s.raf);
      for (var i = 0; i < s.timers.length; i++) view.clearTimeout(s.timers[i]);
      if (s.onKey) s.doc.removeEventListener('keydown', s.onKey);
      if (s.container && s.container.parentNode) s.container.parentNode.removeChild(s.container);
      state = null; liveState = null;
    }

    return { id: 'KBB', mount: mount, unmount: unmount, pause: pause, resume: resume };
  }

  KBB.makeGame = makeGame;

  // 7. Register with StarNix when present (browser shell). Guarded for headless.
  if (typeof StarNix !== 'undefined' && StarNix && StarNix.registerGame) {
    StarNix.registerGame(makeGame());
  } else if (ROOT.StarNix && ROOT.StarNix.registerGame) {
    ROOT.StarNix.registerGame(makeGame());
  }
})();
