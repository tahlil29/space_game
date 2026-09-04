export const MODE_IDS = ["classic", "endless", "boss"];

/** Waves per level. */
export const WAVES_PER_LEVEL = 3;

export const MODES = {
  classic: {
    id: "classic",
    name: "Classic Survival",
    tagline: "Waves, upgrades, and steady pressure.",
    description:
      "Balanced survival. Boost every wave. Level map with stars.",
    difficulty: 2,
    accent: "#7bc8ff",
    baseEnemies: 5,
    enemiesPerWave: 3,
    spawnInterval: 1.45,
    minSpawnInterval: 0.7,
    waveSpawnFactor: 0.03,
    midBossFromWave: 2,
    midBossAtProgress: 0.6,
    alwaysBossEachWave: false,
    speedMult: 1,
    bossHpMult: 1,
    ramMult: 1,
    bossRamMult: 1,
    upgradeEveryWaves: 1,
    hasLevelMap: true,
    hudLabel: "CLASSIC",
    levelRepair: 0.5,
    upgrades: ["DMG", "SPD", "FIX", "HULL", "ARM", "BOOST"],
  },
  endless: {
    id: "endless",
    name: "Endless Void",
    tagline: "No finish line. Survive as long as you can.",
    description:
      "Faster void. Boosts every 2 waves. Speed rises each level.",
    difficulty: 3,
    accent: "#c77dff",
    baseEnemies: 6,
    enemiesPerWave: 3,
    spawnInterval: 1.3,
    minSpawnInterval: 0.5,
    waveSpawnFactor: 0.045,
    midBossFromWave: 1,
    midBossAtProgress: 0.55,
    alwaysBossEachWave: false,
    speedMult: 1.1,
    bossHpMult: 1.15,
    ramMult: 1.08,
    bossRamMult: 1.15,
    upgradeEveryWaves: 2,
    hasLevelMap: false,
    hudLabel: "ENDLESS",
    levelRepair: 0.25,
    upgrades: ["DMG", "SPD", "FIX", "BOOST", "ARM"],
  },
  boss: {
    id: "boss",
    name: "Boss Assault",
    tagline: "Fewer fodder. One boss every wave.",
    description:
      "Boss + escort each wave. Boss rams hit hard. Map progression.",
    difficulty: 4,
    accent: "#ff8a5c",
    baseEnemies: 4,
    enemiesPerWave: 1,
    spawnInterval: 1.55,
    minSpawnInterval: 0.85,
    waveSpawnFactor: 0.02,
    midBossFromWave: 1,
    midBossAtProgress: 0,
    alwaysBossEachWave: true,
    speedMult: 0.92,
    bossHpMult: 1.4,
    ramMult: 1.2,
    bossRamMult: 2,
    upgradeEveryWaves: 1,
    hasLevelMap: true,
    hudLabel: "BOSS",
    levelRepair: 0.4,
    upgrades: ["DMG", "FIX", "HULL", "ARM", "SPD"],
  },
};

export const UPGRADE_DEFS = {
  DMG: {
    icon: "DMG",
    name: "OVERCHARGE",
    desc: "+1 damage",
    color: "#ff6b8a",
    apply: (p) => {
      p.damage++;
    },
  },
  SPD: {
    icon: "SPD",
    name: "RAPID FIRE",
    desc: "Faster firing",
    color: "#66e0ff",
    apply: (p) => {
      p.fireRate = Math.max(0.07, p.fireRate * 0.82);
    },
  },
  FIX: {
    icon: "FIX",
    name: "REPAIR",
    desc: "+45 hull, +20 strength",
    color: "#7dffb8",
    apply: (p) => {
      p.hp = Math.min(p.maxHp, p.hp + 45);
      p.strength = Math.min(p.maxStrength, p.strength + 20);
    },
  },
  HULL: {
    icon: "HULL",
    name: "REINFORCE",
    desc: "+25 hull, +15 strength",
    color: "#ffb05a",
    apply: (p) => {
      p.maxHp += 25;
      p.hp += 25;
      p.maxStrength += 15;
      p.strength += 15;
    },
  },
  ARM: {
    icon: "ARM",
    name: "ARMOR CORE",
    desc: "+30 max strength",
    color: "#9b7bff",
    apply: (p) => {
      p.maxStrength += 30;
      p.strength += 30;
    },
  },
  BOOST: {
    icon: "BOOST",
    name: "THRUST",
    desc: "+15% speed",
    color: "#7bc8ff",
    apply: (p) => {
      p.speed *= 1.15;
    },
  },
};

export function getMode(id) {
  return MODES[id] || MODES.classic;
}

export function getLevel(wave) {
  return Math.max(1, Math.ceil(wave / WAVES_PER_LEVEL));
}

export function waveInLevel(wave) {
  return ((wave - 1) % WAVES_PER_LEVEL) + 1;
}

export function isLevelClearWave(wave) {
  return wave % WAVES_PER_LEVEL === 0;
}

export function firstWaveOfLevel(level) {
  return (Math.max(1, level) - 1) * WAVES_PER_LEVEL + 1;
}

export function shouldOfferUpgrade(clearedWave, mode) {
  const every = mode.upgradeEveryWaves || 1;
  return clearedWave % every === 0;
}

export function waveEnemyCount(mode, wave) {
  return mode.baseEnemies + Math.max(0, wave - 1) * mode.enemiesPerWave;
}

export function pickUpgradesForMode(mode, count = 3) {
  const ids = [...(mode.upgrades || Object.keys(UPGRADE_DEFS))];
  ids.sort(() => Math.random() - 0.5);
  return ids.slice(0, count).map((id) => UPGRADE_DEFS[id]).filter(Boolean);
}

export function pickEnemyKind(mode) {
  const roll = Math.random();
  if (mode.id === "boss") {
    if (roll < 0.45) return "basic";
    if (roll < 0.75) return "fast";
    return "tank";
  }
  if (mode.id === "endless") {
    if (roll < 0.42) return "basic";
    if (roll < 0.74) return "fast";
    if (roll < 0.92) return "tank";
    return "boss";
  }
  if (roll < 0.58) return "basic";
  if (roll < 0.82) return "fast";
  if (roll < 0.94) return "tank";
  return "boss";
}

export function enemyStats(kind, wave, mode) {
  const level = getLevel(wave);
  let speedMult = mode.speedMult || 1;
  if (mode.id === "endless") {
    speedMult *= 1 + (level - 1) * 0.1;
  }
  // Higher tiers harden bosses
  const tier = Math.floor((level - 1) / 3);
  const bossHpMult = (mode.bossHpMult || 1) * (1 + tier * 0.12);

  const table = {
    basic: {
      r: 16,
      hp: 2 + (mode.id === "endless" ? Math.floor(tier / 2) : 0),
      speed: (78 + wave * 4.5) * speedMult,
      damage: 16,
    },
    fast: {
      r: 11,
      hp: 1,
      speed: (130 + wave * 5.5) * speedMult,
      damage: 11,
    },
    tank: {
      r: 26,
      hp: 5 + (mode.id === "boss" ? Math.min(level, 6) : tier),
      speed: (44 + wave * 2.8) * speedMult,
      damage: 22,
    },
    boss: {
      r: 34 + Math.min(tier * 2, 6),
      hp: Math.round((14 + wave * 2.2 + tier * 3) * bossHpMult),
      speed: (36 + wave * 1.8 + tier) * speedMult,
      damage: 30 + tier * 2,
      pattern: mode.id === "boss" || level >= 3 ? "orbit" : "chase",
    },
  };
  return table[kind];
}

/** Base ram damage before mode multipliers (Stage 7 tuned). */
export const RAM_DAMAGE = { fast: 6, basic: 10, tank: 17, boss: 28 };

export function starsHtml(n) {
  return "★".repeat(n) + "☆".repeat(Math.max(0, 5 - n));
}

export function levelStarsHtml(n) {
  return "★".repeat(n) + "☆".repeat(Math.max(0, 3 - n));
}
