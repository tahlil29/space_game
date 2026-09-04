export const MODE_IDS = ["classic", "endless", "boss"];

/** Waves per level (Stage 2). */
export const WAVES_PER_LEVEL = 3;

export const MODES = {
  classic: {
    id: "classic",
    name: "Classic Survival",
    tagline: "Waves, upgrades, and steady pressure.",
    description:
      "Standard wave survival. Clear enemies, shoot boost targets, and climb the waves.",
    difficulty: 2,
    accent: "#7bc8ff",
    baseEnemies: 5,
    enemiesPerWave: 3,
    spawnInterval: 1.45,
    minSpawnInterval: 0.65,
    waveSpawnFactor: 0.035,
    midBossFromWave: 2,
    midBossAtProgress: 0.6,
    alwaysBossEachWave: false,
    minionsPerBossWave: 0,
    speedMult: 1,
    bossHpMult: 1,
    ramMult: 1,
    bossRamMult: 1,
    /** Offer shootable upgrade every N cleared waves */
    upgradeEveryWaves: 1,
    hasLevelMap: true,
    hudLabel: "CLASSIC",
    levelRepair: 0.45,
  },
  endless: {
    id: "endless",
    name: "Endless Void",
    tagline: "No finish line. Survive as long as you can.",
    description:
      "Endless waves with rising speed. Boosts every 2 waves — no level map.",
    difficulty: 3,
    accent: "#c77dff",
    baseEnemies: 6,
    enemiesPerWave: 4,
    spawnInterval: 1.25,
    minSpawnInterval: 0.45,
    waveSpawnFactor: 0.05,
    midBossFromWave: 1,
    midBossAtProgress: 0.5,
    alwaysBossEachWave: false,
    minionsPerBossWave: 0,
    speedMult: 1.12,
    bossHpMult: 1.1,
    ramMult: 1.05,
    bossRamMult: 1,
    upgradeEveryWaves: 2,
    hasLevelMap: false,
    hudLabel: "ENDLESS",
    levelRepair: 0.2,
  },
  boss: {
    id: "boss",
    name: "Boss Assault",
    tagline: "Fewer fodder. One boss every wave.",
    description:
      "Boss + escort each wave. Boss rams hit twice as hard.",
    difficulty: 4,
    accent: "#ff8a5c",
    baseEnemies: 4,
    enemiesPerWave: 1,
    spawnInterval: 1.6,
    minSpawnInterval: 0.8,
    waveSpawnFactor: 0.02,
    midBossFromWave: 1,
    midBossAtProgress: 0,
    alwaysBossEachWave: true,
    minionsPerBossWave: 3,
    speedMult: 0.95,
    bossHpMult: 1.35,
    ramMult: 1.25,
    bossRamMult: 2,
    upgradeEveryWaves: 1,
    hasLevelMap: true,
    hudLabel: "BOSS",
    levelRepair: 0.35,
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

export function pickEnemyKind(mode) {
  const roll = Math.random();
  if (mode.id === "boss") {
    if (roll < 0.45) return "basic";
    if (roll < 0.75) return "fast";
    return "tank";
  }
  if (mode.id === "endless") {
    if (roll < 0.4) return "basic";
    if (roll < 0.72) return "fast";
    if (roll < 0.9) return "tank";
    return "boss";
  }
  if (roll < 0.55) return "basic";
  if (roll < 0.78) return "fast";
  if (roll < 0.92) return "tank";
  return "boss";
}

export function enemyStats(kind, wave, mode) {
  const level = getLevel(wave);
  let speedMult = mode.speedMult || 1;
  if (mode.id === "endless") {
    speedMult *= 1 + (level - 1) * 0.1;
  }
  const bossHpMult = mode.bossHpMult || 1;
  const table = {
    basic: {
      r: 16,
      hp: 2 + (mode.id === "classic" ? 0 : Math.floor((level - 1) / 3)),
      speed: (78 + wave * 5) * speedMult,
      damage: 16,
    },
    fast: {
      r: 11,
      hp: 1,
      speed: (135 + wave * 6) * speedMult,
      damage: 11,
    },
    tank: {
      r: 26,
      hp: 5 + (mode.id === "boss" ? level : 0),
      speed: (45 + wave * 3) * speedMult,
      damage: 22,
    },
    boss: {
      r: 34,
      hp: Math.round((12 + wave * 2) * bossHpMult),
      speed: (38 + wave * 2) * speedMult,
      damage: 30,
    },
  };
  return table[kind];
}

export function starsHtml(n) {
  return "★".repeat(n) + "☆".repeat(Math.max(0, 5 - n));
}

export function levelStarsHtml(n) {
  return "★".repeat(n) + "☆".repeat(Math.max(0, 3 - n));
}
