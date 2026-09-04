import { settings, vibrateHit, vibrateBossKill } from "./settings.js";
import {
  initAudio,
  resumeAudio,
  setMusicEnabled,
  setMusicProfile,
  playShoot,
  playExplosion,
} from "./audio.js";
import {
  MODES,
  MODE_IDS,
  WAVES_PER_LEVEL,
  RAM_DAMAGE,
  getMode,
  getLevel,
  waveInLevel,
  isLevelClearWave,
  firstWaveOfLevel,
  shouldOfferUpgrade,
  waveEnemyCount,
  pickEnemyKind,
  enemyStats,
  pickUpgradesForMode,
  starsHtml,
  levelStarsHtml,
} from "./modes.js";
import { getTheme, applyThemeToDom, drawSpaceBackground } from "./themes.js";
import {
  progress,
  MAP_LEVEL_COUNT,
  computeLevelStars,
} from "./progress.js";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const screens = {
  home: document.getElementById("screen-home"),
  modes: document.getElementById("screen-modes"),
  map: document.getElementById("screen-map"),
  settings: document.getElementById("screen-settings"),
  pause: document.getElementById("screen-pause"),
  level: document.getElementById("screen-level"),
  gameover: document.getElementById("screen-gameover"),
};

const hud = document.getElementById("hud");
const healthWrap = document.getElementById("healthWrap");
const help = document.getElementById("help");
const upgradeBanner = document.getElementById("upgradeBanner");
const modeGrid = document.getElementById("modeGrid");
const levelMapEl = document.getElementById("levelMap");

let W;
let H;
let dpr;
const keys = {};
const mouse = { x: 0, y: 0, down: false };

let player;
let bullets;
let enemies;
let particles;
let powerups;
let stars;
let score;
let xp;
let wave;
let enemiesToSpawn;
let spawned;
let spawnTimer;
let betweenWaves;
let gameState = "home";
let last;
let shootCD;
let dashCD;
let animId;
let bossSpawned;
let upgradeTargets;
let currentMode = getMode(settings.selectedMode || "classic");
let currentTheme = getTheme(currentMode.id);
let pendingLevelAdvance = false;
let selectedMapLevel = 1;
let startLevel = 1;
let ramsThisLevel = 0;
let ambience = [];
let ambienceTimer = 0;
const UPGRADE_HITS = 6;

function isActiveGameplay() {
  return gameState === "playing" || gameState === "upgradeSelect";
}

settings.load();
progress.load();
settings.syncToggles();
currentMode = getMode(settings.selectedMode || "classic");
currentTheme = getTheme(currentMode.id);
applyThemeToDom(currentTheme);

function setActiveMode(id) {
  settings.selectedMode = id;
  settings.save();
  currentMode = getMode(id);
  currentTheme = getTheme(id);
  applyThemeToDom(currentTheme);
  setMusicProfile(id);
  rebuildStars();
  ambience = [];
}

function showScreen(name) {
  Object.entries(screens).forEach(([key, el]) => {
    el.classList.toggle("active", key === name);
  });
  document.body.classList.toggle("menu-open", Boolean(name));
}

function showHud(visible) {
  hud.classList.toggle("screen-hidden", !visible);
  healthWrap.classList.toggle("screen-hidden", !visible);
  help.classList.toggle("screen-hidden", !visible);
}

function renderModeCards() {
  modeGrid.innerHTML = "";
  MODE_IDS.forEach((id) => {
    const mode = MODES[id];
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mode-card" + (settings.selectedMode === id ? " selected" : "");
    btn.style.setProperty("--mode-accent", mode.accent);
    btn.dataset.mode = id;
    btn.innerHTML = `
      <span class="mode-name">${mode.name}</span>
      <span class="mode-stars" aria-label="Difficulty ${mode.difficulty} of 5">${starsHtml(mode.difficulty)}</span>
      <span class="mode-tag">${mode.tagline}</span>
      <span class="mode-desc">${mode.description}</span>
    `;
    btn.onclick = () => selectMode(id);
    modeGrid.appendChild(btn);
  });
}

function selectMode(id) {
  setActiveMode(id);
  renderModeCards();
  const btn = document.getElementById("btnStartMode");
  btn.textContent = currentMode.hasLevelMap ? "SELECT LEVEL" : "START MISSION";
}

function openModeSelect() {
  currentTheme = getTheme(settings.selectedMode || "classic");
  applyThemeToDom(currentTheme);
  renderModeCards();
  document.getElementById("btnStartMode").textContent = currentMode.hasLevelMap
    ? "SELECT LEVEL"
    : "START MISSION";
  showScreen("modes");
}

function renderLevelMap() {
  const unlocked = progress.getUnlocked(currentMode.id);
  selectedMapLevel = Math.min(selectedMapLevel, unlocked);
  document.getElementById("mapModeBadge").textContent = currentMode.hudLabel;
  levelMapEl.innerHTML = "";
  for (let i = 1; i <= MAP_LEVEL_COUNT; i++) {
    const locked = i > unlocked;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className =
      "level-node" +
      (locked ? " locked" : "") +
      (!locked && selectedMapLevel === i ? " selected" : "");
    const earned = progress.getStars(currentMode.id, i);
    btn.innerHTML = `
      <span class="ln-num">${i}</span>
      <span class="ln-stars">${locked ? "🔒" : levelStarsHtml(earned)}</span>
    `;
    if (!locked) {
      btn.onclick = () => {
        selectedMapLevel = i;
        renderLevelMap();
      };
    }
    levelMapEl.appendChild(btn);
  }
}

function openLevelMap() {
  selectedMapLevel = progress.getUnlocked(currentMode.id);
  renderLevelMap();
  showScreen("map");
}

function beginMissionFromMenu() {
  if (currentMode.hasLevelMap) {
    openLevelMap();
    return;
  }
  startGame(1);
}

function rebuildStars() {
  const density = currentTheme.starDensity || 1;
  const count = Math.max(40, Math.floor((W * H) / 6000 * density));
  const tintPool =
    currentTheme.id === "endless"
      ? [currentTheme.star, "#e9d5ff", "#c084fc"]
      : currentTheme.id === "boss"
        ? [currentTheme.star, "#ffd6a5", "#ffb4a2"]
        : [currentTheme.star, "#ffffff", "#cfe8ff"];
  stars = Array.from({ length: count }, () => ({
    x: Math.random() * W,
    y: Math.random() * H,
    r: Math.random() * (currentTheme.id === "endless" ? 2.1 : 1.5) + 0.2,
    t: Math.random() * 6,
    twinkle: 700 + Math.random() * 900,
    col: tintPool[Math.floor(Math.random() * tintPool.length)],
  }));
}

function resize() {
  dpr = Math.min(devicePixelRatio || 1, 2);
  W = innerWidth;
  H = innerHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (!player) player = { x: W / 2, y: H / 2 };
  rebuildStars();
}

addEventListener("resize", resize);
resize();

addEventListener("keydown", (e) => {
  if (e.code === "Escape") {
    e.preventDefault();
    if (gameState === "playing" || gameState === "upgradeSelect") pauseGame();
    else if (gameState === "paused") resumeGame();
    return;
  }
  if (!isActiveGameplay()) return;
  keys[e.key.toLowerCase()] = true;
  if (e.code === "Space") {
    e.preventDefault();
    mouse.down = true;
  }
  if (e.key === "Shift") dash();
});

addEventListener("keyup", (e) => {
  keys[e.key.toLowerCase()] = false;
  if (e.code === "Space") mouse.down = false;
});

canvas.addEventListener("mousemove", (e) => {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
});
canvas.addEventListener("mousedown", () => {
  if (isActiveGameplay()) mouse.down = true;
});
addEventListener("mouseup", () => {
  mouse.down = false;
});

function reset(fromLevel = 1) {
  currentMode = getMode(settings.selectedMode || "classic");
  startLevel = Math.max(1, fromLevel);
  player = {
    x: W / 2,
    y: H / 2,
    r: 17,
    speed: 330,
    hp: 100,
    maxHp: 100,
    damage: 1,
    fireRate: 0.17,
    dashPower: 260,
    strength: 100,
    maxStrength: 100,
    inv: 0,
  };
  bullets = [];
  enemies = [];
  particles = [];
  powerups = [];
  score = 0;
  xp = 0;
  wave = firstWaveOfLevel(startLevel);
  enemiesToSpawn = waveEnemyCount(currentMode, wave);
  spawned = 0;
  spawnTimer = currentMode.spawnInterval;
  betweenWaves = false;
  shootCD = 0;
  dashCD = 0;
  bossSpawned = false;
  upgradeTargets = [];
  ramsThisLevel = 0;
  ambience = [];
  ambienceTimer = 0;
}

function startGame(fromLevel = 1) {
  reset(fromLevel);
  currentTheme = getTheme(currentMode.id);
  applyThemeToDom(currentTheme);
  setMusicProfile(currentMode.id);
  pendingLevelAdvance = false;
  gameState = "playing";
  showScreen(null);
  showHud(true);
  document.getElementById("modeLabel").textContent = currentMode.hudLabel;
  document.getElementById("modeLabel").style.color = currentTheme.accent;
  resumeAudio();
  setMusicEnabled(settings.music);
  last = performance.now();
}

function pauseGame() {
  if (!isActiveGameplay()) return;
  gameState = "paused";
  mouse.down = false;
  document.getElementById("pauseModeBadge").textContent =
    `${currentMode.hudLabel} · PAUSED`;
  showScreen("pause");
}

function resumeGame() {
  if (gameState !== "paused") return;
  gameState = upgradeTargets.length > 0 ? "upgradeSelect" : "playing";
  showScreen(null);
  last = performance.now();
}

function goHome() {
  gameState = "home";
  betweenWaves = false;
  pendingLevelAdvance = false;
  upgradeTargets = [];
  mouse.down = false;
  showHud(false);
  upgradeBanner.classList.add("screen-hidden");
  currentTheme = getTheme(settings.selectedMode || "classic");
  applyThemeToDom(currentTheme);
  showScreen("home");
}

function openSettings(from) {
  settings.settingsReturn = from;
  settings.syncToggles();
  showScreen("settings");
}

function spawnEnemy(forcedKind) {
  const kind = forcedKind || pickEnemyKind(currentMode);
  const stats = enemyStats(kind, wave, currentMode);

  const side = Math.floor(Math.random() * 4);
  let ex;
  let ey;
  if (side === 0) {
    ex = -50;
    ey = Math.random() * H;
  } else if (side === 1) {
    ex = W + 50;
    ey = Math.random() * H;
  } else if (side === 2) {
    ex = Math.random() * W;
    ey = -50;
  } else {
    ex = Math.random() * W;
    ey = H + 50;
  }

  enemies.push({
    x: ex,
    y: ey,
    r: stats.r,
    hp: stats.hp,
    maxHp: stats.hp,
    speed: stats.speed,
    kind,
    damage: stats.damage,
    pattern: stats.pattern || "chase",
    angle: Math.random() * Math.PI * 2,
    orbitDir: Math.random() < 0.5 ? 1 : -1,
  });
}

function shoot() {
  const dx = mouse.x - player.x;
  const dy = mouse.y - player.y;
  const len = Math.hypot(dx, dy) || 1;
  bullets.push({
    x: player.x + (dx / len) * 24,
    y: player.y + (dy / len) * 24,
    vx: (dx / len) * 720,
    vy: (dy / len) * 720,
    r: 4,
    life: 1.2,
    damage: player.damage,
  });
  playShoot();
}

function burst(px, py, n = 8, col = "#89d9ff") {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = 40 + Math.random() * 210;
    particles.push({
      x: px,
      y: py,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s,
      life: 0.35 + Math.random() * 0.55,
      r: 1 + Math.random() * 3,
      col,
    });
  }
}

function addXP(px, py) {
  powerups.push({ x: px, y: py, r: 7, life: 12 });
}

function settleWavePickups() {
  for (const p of powerups) {
    xp += 1;
    score += 2;
  }
  powerups = [];
  bullets = [];
  particles = [];
}

function dash() {
  if (dashCD > 0 || !isActiveGameplay()) return;
  const dx =
    (keys.d || keys.arrowright ? 1 : 0) - (keys.a || keys.arrowleft ? 1 : 0);
  const dy =
    (keys.s || keys.arrowdown ? 1 : 0) - (keys.w || keys.arrowup ? 1 : 0);
  const len = Math.hypot(dx, dy);
  if (!len) return;
  player.x = Math.max(
    player.r,
    Math.min(W - player.r, player.x + (dx / len) * player.dashPower),
  );
  player.y = Math.max(
    player.r,
    Math.min(H - player.r, player.y + (dy / len) * player.dashPower),
  );
  player.inv = 0.25;
  dashCD = 1.4;
  burst(player.x, player.y, 16, "#ffffff");
}

const RAM_BASE = RAM_DAMAGE;

/** Enemy rams player once — small damage by type, then the enemy is destroyed. */
function handleEnemyRams() {
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    const dx = player.x - e.x;
    const dy = player.y - e.y;
    const dist = Math.hypot(dx, dy) || 1;
    if (dist >= player.r + e.r - 1) continue;

    const nx = dx / dist;
    const ny = dy / dist;

    if (player.inv <= 0) {
      let mult = currentMode.ramMult || 1;
      if (e.kind === "boss") mult *= currentMode.bossRamMult || 1;
      let dmg = Math.round((RAM_BASE[e.kind] || 10) * mult);
      if (player.strength > 0) {
        const absorbed = Math.min(player.strength, dmg);
        player.strength -= absorbed;
        dmg -= absorbed;
      }
      if (dmg > 0) player.hp -= dmg;
      ramsThisLevel += 1;

      player.x = Math.max(
        player.r,
        Math.min(W - player.r, player.x + nx * 16),
      );
      player.y = Math.max(
        player.r,
        Math.min(H - player.r, player.y + ny * 16),
      );
      player.inv = 0.28;
      burst(player.x, player.y, 6, player.strength > 0 ? "#9b7bff" : "#ff5478");
      if (isBoss(e.kind)) vibrateHit();
    }

    burst(
      e.x,
      e.y,
      e.kind === "boss" ? 18 : 12,
      currentTheme.enemy[e.kind] || "#ff5577",
    );
    enemies.splice(i, 1);
  }
}

function isBoss(kind) {
  return kind === "boss" || kind === "tank";
}

function spawnAmbient(dt) {
  ambienceTimer -= dt;
  if (ambienceTimer > 0) return;
  ambienceTimer = currentMode.id === "endless" ? 0.08 : currentMode.id === "boss" ? 0.1 : 0.14;
  const cols = currentTheme.ambience || [currentTheme.accent];
  const col = cols[Math.floor(Math.random() * cols.length)];
  if (currentMode.id === "boss") {
    ambience.push({
      x: Math.random() * W,
      y: -8,
      vx: (Math.random() - 0.5) * 40,
      vy: 60 + Math.random() * 90,
      life: 1.2 + Math.random(),
      r: 1 + Math.random() * 2.5,
      col,
    });
  } else if (currentMode.id === "endless") {
    ambience.push({
      x: Math.random() * W,
      y: Math.random() * H,
      vx: (Math.random() - 0.5) * 30,
      vy: (Math.random() - 0.5) * 30,
      life: 0.8 + Math.random() * 0.8,
      r: 1 + Math.random() * 2,
      col,
    });
  } else {
    ambience.push({
      x: Math.random() * W,
      y: Math.random() * H,
      vx: (Math.random() - 0.5) * 12,
      vy: (Math.random() - 0.5) * 12,
      life: 1.4 + Math.random(),
      r: 0.8 + Math.random() * 1.6,
      col,
    });
  }
}

function updateAmbience(dt) {
  spawnAmbient(dt);
  for (const p of ambience) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life -= dt;
  }
  ambience = ambience.filter((p) => p.life > 0);
}
function spawnUpgradeTarget(upgrade) {
  const side = Math.floor(Math.random() * 4);
  const speed = 50 + Math.random() * 40;
  let x;
  let y;
  let vx;
  let vy;

  if (side === 0) {
    x = -36;
    y = 80 + Math.random() * (H - 160);
    vx = speed;
    vy = (Math.random() - 0.5) * speed * 0.7;
  } else if (side === 1) {
    x = W + 36;
    y = 80 + Math.random() * (H - 160);
    vx = -speed;
    vy = (Math.random() - 0.5) * speed * 0.7;
  } else if (side === 2) {
    x = 80 + Math.random() * (W - 160);
    y = -36;
    vx = (Math.random() - 0.5) * speed * 0.7;
    vy = speed;
  } else {
    x = 80 + Math.random() * (W - 160);
    y = H + 36;
    vx = (Math.random() - 0.5) * speed * 0.7;
    vy = -speed;
  }

  upgradeTargets.push({
    x,
    y,
    vx,
    vy,
    r: 24,
    hp: UPGRADE_HITS,
    maxHp: UPGRADE_HITS,
    upgrade,
    pulse: Math.random() * Math.PI * 2,
  });
}

function showUpgradeFlash() {
  const el = document.createElement("div");
  el.className = "upgrade-flash";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 650);
}

function advanceAfterWaveClear(clearedWave) {
  wave = clearedWave + 1;
  enemiesToSpawn = waveEnemyCount(currentMode, wave);
  spawned = 0;
  spawnTimer = currentMode.spawnInterval;
  bossSpawned = false;
  bullets = [];

  if (isLevelClearWave(clearedWave)) {
    showLevelComplete(getLevel(clearedWave));
    return;
  }

  betweenWaves = false;
  gameState = "playing";
}

function collectUpgrade(target) {
  target.upgrade.apply(player);
  burst(target.x, target.y, 24, target.upgrade.color);
  playExplosion();
  showUpgradeFlash();
  upgradeTargets = [];
  upgradeBanner.classList.add("screen-hidden");
  document.getElementById("upgradeBannerText").textContent =
    "Shoot a glowing target — 6 hits to unlock the boost!";

  advanceAfterWaveClear(wave);
}

function showLevelComplete(clearedLevel) {
  pendingLevelAdvance = true;
  betweenWaves = true;
  gameState = "levelComplete";
  mouse.down = false;

  const hullRatio = Math.max(0, player.hp / player.maxHp);
  const earnedStars = computeLevelStars({
    hullRatio,
    ramHits: ramsThisLevel,
  });

  if (currentMode.hasLevelMap) {
    progress.recordLevelClear(currentMode.id, clearedLevel, earnedStars, score);
  } else {
    progress.recordEndlessRun(wave - 1, score);
  }

  const repair = currentMode.levelRepair || 0;
  if (repair > 0) {
    player.hp = Math.min(
      player.maxHp,
      player.hp + (player.maxHp - player.hp) * repair,
    );
    player.strength = Math.min(
      player.maxStrength,
      player.strength + (player.maxStrength - player.strength) * repair,
    );
  }

  document.getElementById("levelClearTitle").textContent =
    `LEVEL ${clearedLevel} COMPLETE`;
  document.getElementById("lvlStatLevel").textContent = String(clearedLevel);
  document.getElementById("lvlStatStars").textContent = levelStarsHtml(earnedStars);
  document.getElementById("lvlStatHull").textContent =
    `${Math.max(0, Math.round(hullRatio * 100))}%`;
  document.getElementById("levelClearMsg").textContent =
    repair > 0
      ? `${levelStarsHtml(earnedStars)}  Systems repaired. Next: Level ${clearedLevel + 1}.`
      : `${levelStarsHtml(earnedStars)}  Next sector: Level ${clearedLevel + 1}.`;

  ramsThisLevel = 0;
  showScreen("level");
}

function continueAfterLevel() {
  pendingLevelAdvance = false;
  betweenWaves = false;
  gameState = "playing";
  showScreen(null);
  last = performance.now();
}

function onWaveCleared() {
  settleWavePickups();
  if (shouldOfferUpgrade(wave, currentMode)) {
    startUpgradePhase();
    return;
  }
  advanceAfterWaveClear(wave);
}

function startUpgradePhase() {
  betweenWaves = true;
  gameState = "upgradeSelect";

  upgradeTargets = [];
  const picks = pickUpgradesForMode(currentMode, 3);
  picks.forEach((u) => spawnUpgradeTarget(u));

  document.getElementById("upgradeBannerText").textContent =
    `Wave ${wave} cleared! Shoot a target (${UPGRADE_HITS} hits) to pick your boost.`;
  upgradeBanner.classList.remove("screen-hidden");
  document.getElementById("enemyCount").textContent = " · pick a boost";
}

function updateUpgradeTargets(dt) {
  for (const t of upgradeTargets) {
    t.x += t.vx * dt;
    t.y += t.vy * dt;
    t.pulse += dt * 4;

    if (t.x < t.r + 20) {
      t.x = t.r + 20;
      t.vx = Math.abs(t.vx);
    } else if (t.x > W - t.r - 20) {
      t.x = W - t.r - 20;
      t.vx = -Math.abs(t.vx);
    }
    if (t.y < t.r + 20) {
      t.y = t.r + 20;
      t.vy = Math.abs(t.vy);
    } else if (t.y > H - t.r - 20) {
      t.y = H - t.r - 20;
      t.vy = -Math.abs(t.vy);
    }
  }

  for (let i = upgradeTargets.length - 1; i >= 0; i--) {
    const t = upgradeTargets[i];
    for (let j = bullets.length - 1; j >= 0; j--) {
      const b = bullets[j];
      if (Math.hypot(t.x - b.x, t.y - b.y) >= t.r + b.r) continue;
      t.hp -= 1;
      bullets.splice(j, 1);
      burst(b.x, b.y, 5, t.upgrade.color);
      if (t.hp <= 0) {
        collectUpgrade(t);
        return;
      }
      break;
    }
  }
}

function drawUpgradeTargets() {
  for (const t of upgradeTargets) {
    const scale = 1 + Math.sin(t.pulse) * 0.06;
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.scale(scale, scale);
    ctx.shadowBlur = 28;
    ctx.shadowColor = t.upgrade.color;
    ctx.strokeStyle = t.upgrade.color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(0, 0, t.r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = `${t.upgrade.color}33`;
    ctx.fill();

    ctx.fillStyle = t.upgrade.color;
    ctx.font = "bold 11px Orbitron, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(t.upgrade.icon, 0, -4);
    ctx.font = "600 9px Exo 2, sans-serif";
    ctx.fillStyle = "#eef7ff";
    ctx.fillText(t.upgrade.name, 0, 10);

    ctx.fillStyle = "#172035";
    ctx.fillRect(-t.r, t.r + 6, t.r * 2, 5);
    ctx.fillStyle = t.upgrade.color;
    ctx.fillRect(-t.r, t.r + 6, t.r * 2 * (t.hp / t.maxHp), 5);
    ctx.restore();
  }
}

function updateHud() {
  document.getElementById("level").textContent = String(getLevel(wave));
  document.getElementById("wave").textContent = String(wave);
  document.getElementById("waveOf").textContent =
    `(${waveInLevel(wave)}/${WAVES_PER_LEVEL})`;
  document.getElementById("enemyCount").textContent =
    gameState === "upgradeSelect"
      ? " · pick a boost"
      : ` · ${Math.max(0, enemiesToSpawn - spawned) + enemies.length} left`;
  document.getElementById("score").textContent = String(score);
  document.getElementById("xp").textContent = String(xp);
  document.getElementById("hpText").textContent =
    `${Math.max(0, Math.ceil(player.hp))} / ${player.maxHp}`;
  document.getElementById("hpFill").style.width =
    `${Math.max(0, (player.hp / player.maxHp) * 100)}%`;
  document.getElementById("strengthText").textContent =
    `${Math.max(0, Math.ceil(player.strength))} / ${player.maxStrength}`;
  document.getElementById("strengthFill").style.width =
    `${Math.max(0, (player.strength / player.maxStrength) * 100)}%`;
}

function updatePlaying(dt) {
  spawnTimer -= dt;
  if (spawned < enemiesToSpawn && spawnTimer <= 0) {
    if (currentMode.alwaysBossEachWave && spawned === 0) {
      spawnEnemy("boss");
    } else {
      spawnEnemy();
    }
    spawned++;
    spawnTimer = Math.max(
      currentMode.minSpawnInterval,
      currentMode.spawnInterval - wave * currentMode.waveSpawnFactor,
    );
  }

  if (
    !currentMode.alwaysBossEachWave &&
    wave >= currentMode.midBossFromWave &&
    !bossSpawned &&
    spawned >= Math.floor(enemiesToSpawn * currentMode.midBossAtProgress)
  ) {
    spawnEnemy("boss");
    bossSpawned = true;
  }

  for (const e of enemies) {
    const dx = player.x - e.x;
    const dy = player.y - e.y;
    const dist = Math.hypot(dx, dy) || 1;

    if (e.kind === "boss" && e.pattern === "orbit" && dist > 90) {
      e.angle += e.orbitDir * 1.1 * dt;
      const prefer = Math.min(180, Math.max(110, dist));
      const tx = player.x + Math.cos(e.angle) * prefer;
      const ty = player.y + Math.sin(e.angle) * prefer;
      const ox = tx - e.x;
      const oy = ty - e.y;
      const ol = Math.hypot(ox, oy) || 1;
      e.x += (ox / ol) * e.speed * 1.15 * dt;
      e.y += (oy / ol) * e.speed * 1.15 * dt;
      // leave purple/orange trail
      if (Math.random() < 0.35) {
        particles.push({
          x: e.x,
          y: e.y,
          vx: (Math.random() - 0.5) * 20,
          vy: (Math.random() - 0.5) * 20,
          life: 0.25,
          r: 2,
          col: currentTheme.trail,
        });
      }
    } else {
      e.x += (dx / dist) * e.speed * dt;
      e.y += (dy / dist) * e.speed * dt;
    }
  }

  handleEnemyRams();
  updateAmbience(dt);

  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    for (let j = bullets.length - 1; j >= 0; j--) {
      const b = bullets[j];
      if (Math.hypot(e.x - b.x, e.y - b.y) >= e.r + b.r) continue;
      e.hp -= b.damage;
      bullets.splice(j, 1);
      burst(b.x, b.y, 3);
      if (isBoss(e.kind)) vibrateHit();
      if (e.hp <= 0) {
        score += e.kind === "boss" ? 80 : e.kind === "tank" ? 30 : e.kind === "fast" ? 15 : 10;
        xp += e.kind === "boss" ? 10 : e.kind === "tank" ? 4 : 1;
        addXP(e.x, e.y);
        burst(
          e.x,
          e.y,
          e.kind === "boss" ? 22 : 14,
          e.kind === "boss" || e.kind === "tank" ? "#ffbd70" : "#8bdcff",
        );
        if (isBoss(e.kind)) {
          vibrateBossKill();
          playExplosion();
        }
        enemies.splice(i, 1);
      }
      break;
    }
  }

  for (let i = powerups.length - 1; i >= 0; i--) {
    const p = powerups[i];
    const dx = player.x - p.x;
    const dy = player.y - p.y;
    const dist = Math.hypot(dx, dy) || 1;
    if (dist < 180) {
      p.x += (dx / dist) * 220 * dt;
      p.y += (dy / dist) * 220 * dt;
    }
    p.life -= dt;
    if (dist < player.r + p.r + 4) {
      xp++;
      score += 2;
      powerups.splice(i, 1);
    } else if (p.life <= 0) {
      powerups.splice(i, 1);
    }
  }

  if (spawned >= enemiesToSpawn && enemies.length === 0 && !betweenWaves) {
    onWaveCleared();
  }
}

function update(dt) {
  const ax =
    (keys.d || keys.arrowright ? 1 : 0) - (keys.a || keys.arrowleft ? 1 : 0);
  const ay =
    (keys.s || keys.arrowdown ? 1 : 0) - (keys.w || keys.arrowup ? 1 : 0);
  const moveLen = Math.hypot(ax, ay) || 1;

  player.x = Math.max(
    player.r,
    Math.min(W - player.r, player.x + (ax / moveLen) * player.speed * dt),
  );
  player.y = Math.max(
    player.r,
    Math.min(H - player.r, player.y + (ay / moveLen) * player.speed * dt),
  );

  shootCD -= dt;
  dashCD -= dt;
  player.inv -= dt;

  if (mouse.down && shootCD <= 0) {
    shoot();
    shootCD = player.fireRate;
  }

  bullets.forEach((b) => {
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.life -= dt;
  });
  bullets = bullets.filter(
    (b) => b.life > 0 && b.x > -50 && b.x < W + 50 && b.y > -50 && b.y < H + 50,
  );

  if (gameState === "upgradeSelect") {
    updateUpgradeTargets(dt);
  } else {
    updatePlaying(dt);
  }

  particles.forEach((p) => {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 0.96;
    p.vy *= 0.96;
    p.life -= dt;
  });
  particles = particles.filter((p) => p.life > 0);

  if (player.hp <= 0) {
    gameOver();
    return;
  }

  updateHud();
}

function draw() {
  drawSpaceBackground(ctx, W, H, currentTheme, stars, performance.now());

  for (const p of ambience) {
    ctx.globalAlpha = Math.max(0, p.life * 0.55);
    ctx.fillStyle = p.col;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, 7);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  if (gameState === "home" || gameState === "modes" || gameState === "map") return;

  const theme = currentTheme;

  for (const p of powerups) {
    ctx.save();
    ctx.shadowBlur = 20;
    ctx.shadowColor = theme.xpGlow;
    ctx.fillStyle = theme.xp;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, 7);
    ctx.fill();
    ctx.restore();
  }

  ctx.fillStyle = theme.bullet;
  ctx.shadowBlur = 14;
  ctx.shadowColor = theme.bulletGlow;
  for (const b of bullets) {
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, 7);
    ctx.fill();
  }
  ctx.shadowBlur = 0;

  for (const e of enemies) {
    ctx.save();
    ctx.translate(e.x, e.y);
    const col = theme.enemy[e.kind] || theme.enemy.basic;
    ctx.fillStyle = col;
    ctx.shadowBlur = e.kind === "boss" ? 32 : 20;
    ctx.shadowColor = col;
    ctx.beginPath();
    const sides = e.kind === "boss" ? 12 : 8;
    for (let i = 0; i < sides; i++) {
      const a = (i * Math.PI * 2) / sides;
      const r = i % 2 ? e.r * 0.72 : e.r;
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();

    if (e.kind === "boss" || e.kind === "tank") {
      ctx.fillStyle = "#2a0d15";
      ctx.fillRect(-e.r, -e.r - 10, e.r * 2, 5);
      ctx.fillStyle = "#fff";
      ctx.fillRect(-e.r, -e.r - 10, e.r * 2 * (e.hp / e.maxHp), 5);
    }
    if (e.kind === "boss") {
      ctx.fillStyle = "#fff";
      ctx.font = "bold 10px Orbitron, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("BOSS", 0, 4);
    }
    ctx.restore();
  }

  if (!player) return;

  if (upgradeTargets.length > 0) drawUpgradeTargets();

  const a = Math.atan2(mouse.y - player.y, mouse.x - player.x);
  ctx.save();
  ctx.translate(player.x, player.y);
  ctx.rotate(a);
  ctx.globalAlpha = player.inv > 0 ? 0.5 : 1;
  ctx.shadowBlur = 30;
  ctx.shadowColor = theme.playerGlow;
  ctx.fillStyle = theme.player;
  ctx.beginPath();
  ctx.moveTo(27, 0);
  ctx.lineTo(-15, -13);
  ctx.lineTo(-8, 0);
  ctx.lineTo(-15, 13);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = theme.playerCore;
  ctx.beginPath();
  ctx.arc(-3, 0, 6, 0, 7);
  ctx.fill();
  ctx.restore();
  ctx.globalAlpha = 1;

  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, p.life * 1.4);
    ctx.fillStyle = p.col;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, 7);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function loop(t) {
  const dt = Math.min((t - (last || t)) / 1000, 0.033);
  if (isActiveGameplay()) {
    last = t;
    update(dt);
  } else {
    last = t;
    // Soft ambience on menus
    if (gameState === "home" || gameState === "modes" || gameState === "map") {
      updateAmbience(dt);
    }
  }
  draw();
  animId = requestAnimationFrame(loop);
}

function gameOver() {
  gameState = "gameover";
  upgradeTargets = [];
  pendingLevelAdvance = false;
  upgradeBanner.classList.add("screen-hidden");
  mouse.down = false;
  if (currentMode.id === "endless") {
    progress.recordEndlessRun(wave, score);
  }
  document.getElementById("goLevel").textContent = String(getLevel(wave));
  document.getElementById("goWave").textContent = String(wave);
  document.getElementById("goScore").textContent = String(score);
  document.getElementById("goModeBadge").textContent = `${currentMode.hudLabel} · FAILED`;
  document.getElementById("goModeLine").textContent = `Mode: ${currentMode.name}`;
  document.getElementById("goMessage").textContent =
    `Destroyed on level ${getLevel(wave)}, wave ${wave}. Final score: ${score}.`;
  showScreen("gameover");
}

document.getElementById("btnPlay").onclick = () => {
  resumeAudio();
  openModeSelect();
};

document.getElementById("btnStartMode").onclick = () => {
  resumeAudio();
  beginMissionFromMenu();
};

document.getElementById("btnModesBack").onclick = () => {
  showScreen("home");
};

document.getElementById("btnMapStart").onclick = () => {
  resumeAudio();
  startGame(selectedMapLevel);
};

document.getElementById("btnMapBack").onclick = () => {
  openModeSelect();
};

document.getElementById("btnPlayAgain").onclick = () => {
  resumeAudio();
  if (currentMode.hasLevelMap) startGame(startLevel);
  else startGame(1);
};

document.getElementById("btnHomeSettings").onclick = () => openSettings("home");
document.getElementById("btnPauseSettings").onclick = () => openSettings("pause");

document.getElementById("btnSettingsBack").onclick = () => {
  const back = settings.settingsReturn;
  if (back === "pause") showScreen("pause");
  else if (back === "modes") showScreen("modes");
  else if (back === "map") showScreen("map");
  else showScreen("home");
};

document.getElementById("toggleMusic").onchange = (e) => {
  settings.music = e.target.checked;
  settings.save();
  setMusicEnabled(settings.music);
};

document.getElementById("toggleVibration").onchange = (e) => {
  settings.vibration = e.target.checked;
  settings.save();
  if (settings.vibration && navigator.vibrate) navigator.vibrate(20);
};

document.getElementById("pauseBtn").onclick = pauseGame;
document.getElementById("btnResume").onclick = resumeGame;

document.getElementById("btnRestart").onclick = () => {
  resumeAudio();
  startGame(startLevel);
};

document.getElementById("btnMenu").onclick = goHome;
document.getElementById("btnGoMenu").onclick = goHome;
document.getElementById("btnLevelContinue").onclick = continueAfterLevel;
document.getElementById("btnLevelMenu").onclick = goHome;

initAudio();
showHud(false);
applyThemeToDom(currentTheme);
renderModeCards();
document.getElementById("btnStartMode").textContent = currentMode.hasLevelMap
  ? "SELECT LEVEL"
  : "START MISSION";
showScreen("home");
last = performance.now();
animId = requestAnimationFrame(loop);

export {};
