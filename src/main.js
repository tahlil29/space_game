import { settings, vibrateHit, vibrateBossKill } from "./settings.js";
import {
  initAudio,
  resumeAudio,
  setMusicEnabled,
  playShoot,
  playExplosion,
} from "./audio.js";
import {
  MODES,
  MODE_IDS,
  getMode,
  waveEnemyCount,
  pickEnemyKind,
  enemyStats,
  starsHtml,
} from "./modes.js";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const screens = {
  home: document.getElementById("screen-home"),
  modes: document.getElementById("screen-modes"),
  settings: document.getElementById("screen-settings"),
  pause: document.getElementById("screen-pause"),
  gameover: document.getElementById("screen-gameover"),
};

const hud = document.getElementById("hud");
const healthWrap = document.getElementById("healthWrap");
const help = document.getElementById("help");
const upgradeBanner = document.getElementById("upgradeBanner");
const modeGrid = document.getElementById("modeGrid");

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
const UPGRADE_HITS = 6;

function isActiveGameplay() {
  return gameState === "playing" || gameState === "upgradeSelect";
}

settings.load();
settings.syncToggles();
currentMode = getMode(settings.selectedMode || "classic");

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
  settings.selectedMode = id;
  settings.save();
  currentMode = getMode(id);
  renderModeCards();
}

function openModeSelect() {
  renderModeCards();
  showScreen("modes");
}

function resize() {
  dpr = Math.min(devicePixelRatio || 1, 2);
  W = innerWidth;
  H = innerHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (!player) player = { x: W / 2, y: H / 2 };
  stars = Array.from({ length: Math.floor((W * H) / 6000) }, () => ({
    x: Math.random() * W,
    y: Math.random() * H,
    r: Math.random() * 1.5 + 0.25,
    t: Math.random() * 6,
  }));
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

function reset() {
  currentMode = getMode(settings.selectedMode || "classic");
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
  wave = 1;
  enemiesToSpawn = waveEnemyCount(currentMode, wave);
  spawned = 0;
  spawnTimer = currentMode.spawnInterval;
  betweenWaves = false;
  shootCD = 0;
  dashCD = 0;
  bossSpawned = false;
  upgradeTargets = [];
}

function startGame() {
  reset();
  gameState = "playing";
  showScreen(null);
  showHud(true);
  document.getElementById("modeLabel").textContent = currentMode.hudLabel;
  document.getElementById("modeLabel").style.color = currentMode.accent;
  resumeAudio();
  setMusicEnabled(settings.music);
  last = performance.now();
}

function pauseGame() {
  if (!isActiveGameplay()) return;
  gameState = "paused";
  mouse.down = false;
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
  upgradeTargets = [];
  mouse.down = false;
  showHud(false);
  upgradeBanner.classList.add("screen-hidden");
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

const RAM_DAMAGE = { fast: 7, basic: 11, tank: 19, boss: 34 };

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
      let dmg = Math.round((RAM_DAMAGE[e.kind] || 10) * (currentMode.ramMult || 1));
      if (player.strength > 0) {
        const absorbed = Math.min(player.strength, dmg);
        player.strength -= absorbed;
        dmg -= absorbed;
      }
      if (dmg > 0) player.hp -= dmg;

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
      e.kind === "boss" || e.kind === "tank" ? "#ffbd70" : "#ff5577",
    );
    enemies.splice(i, 1);
  }
}

function isBoss(kind) {
  return kind === "boss" || kind === "tank";
}

const UPGRADES = [
  { icon: "DMG", name: "OVERCHARGE", desc: "+1 damage", color: "#ff6b8a", apply: (p) => { p.damage++; } },
  { icon: "SPD", name: "RAPID FIRE", desc: "Faster firing", color: "#66e0ff", apply: (p) => { p.fireRate = Math.max(0.07, p.fireRate * 0.82); } },
  { icon: "FIX", name: "REPAIR", desc: "+45 hull, +20 strength", color: "#7dffb8", apply: (p) => {
    p.hp = Math.min(p.maxHp, p.hp + 45);
    p.strength = Math.min(p.maxStrength, p.strength + 20);
  }},
  { icon: "HULL", name: "REINFORCE", desc: "+25 hull, +15 strength", color: "#ffb05a", apply: (p) => {
    p.maxHp += 25; p.hp += 25; p.maxStrength += 15; p.strength += 15;
  }},
  { icon: "ARM", name: "ARMOR CORE", desc: "+30 max strength", color: "#9b7bff", apply: (p) => {
    p.maxStrength += 30; p.strength += 30;
  }},
  { icon: "BOOST", name: "THRUST", desc: "+15% speed", color: "#7bc8ff", apply: (p) => { p.speed *= 1.15; } },
];

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

function collectUpgrade(target) {
  target.upgrade.apply(player);
  burst(target.x, target.y, 24, target.upgrade.color);
  playExplosion();
  showUpgradeFlash();
  upgradeTargets = [];
  betweenWaves = false;
  gameState = "playing";
  upgradeBanner.classList.add("screen-hidden");
  document.getElementById("upgradeBannerText").textContent =
    "Shoot a glowing target — 6 hits to unlock the boost!";
  wave++;
  enemiesToSpawn = waveEnemyCount(currentMode, wave);
  spawned = 0;
  spawnTimer = currentMode.spawnInterval;
  bossSpawned = false;
  bullets = [];
}

function startUpgradePhase() {
  betweenWaves = true;
  gameState = "upgradeSelect";
  settleWavePickups();

  upgradeTargets = [];
  const picks = [...UPGRADES].sort(() => Math.random() - 0.5).slice(0, 3);
  picks.forEach((u) => spawnUpgradeTarget(u));

  document.getElementById("upgradeBannerText").textContent =
    `Wave ${wave} cleared! Shoot a target (${UPGRADE_HITS} hits) to pick your boost.`;
  upgradeBanner.classList.remove("screen-hidden");
  document.getElementById("enemyCount").textContent = "(pick a boost)";
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
  document.getElementById("wave").textContent = String(wave);
  document.getElementById("enemyCount").textContent =
    gameState === "upgradeSelect"
      ? "(pick a boost)"
      : `(${Math.max(0, enemiesToSpawn - spawned) + enemies.length} left)`;
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
    e.x += (dx / dist) * e.speed * dt;
    e.y += (dy / dist) * e.speed * dt;
  }

  handleEnemyRams();

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
    startUpgradePhase();
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
  ctx.fillStyle = "#02030a";
  ctx.fillRect(0, 0, W, H);

  for (const s of stars) {
    ctx.globalAlpha = 0.25 + 0.35 * Math.sin(s.t + performance.now() / 900);
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, 7);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  if (gameState === "home") return;

  for (const p of powerups) {
    ctx.save();
    ctx.shadowBlur = 20;
    ctx.shadowColor = "#9b7bff";
    ctx.fillStyle = "#d0baff";
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, 7);
    ctx.fill();
    ctx.restore();
  }

  ctx.fillStyle = "#86dcff";
  ctx.shadowBlur = 14;
  ctx.shadowColor = "#3bbdff";
  for (const b of bullets) {
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, 7);
    ctx.fill();
  }
  ctx.shadowBlur = 0;

  for (const e of enemies) {
    ctx.save();
    ctx.translate(e.x, e.y);
    const col =
      e.kind === "boss"
        ? "#ff6b4a"
        : e.kind === "tank"
          ? "#ffb36b"
          : e.kind === "fast"
            ? "#ffdf6b"
            : "#ff5577";
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
  ctx.shadowColor = "#4bc8ff";
  ctx.fillStyle = "#d6f6ff";
  ctx.beginPath();
  ctx.moveTo(27, 0);
  ctx.lineTo(-15, -13);
  ctx.lineTo(-8, 0);
  ctx.lineTo(-15, 13);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#47aaff";
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
  }
  draw();
  animId = requestAnimationFrame(loop);
}

function gameOver() {
  gameState = "gameover";
  upgradeTargets = [];
  upgradeBanner.classList.add("screen-hidden");
  mouse.down = false;
  document.getElementById("goWave").textContent = String(wave);
  document.getElementById("goScore").textContent = String(score);
  document.getElementById("goXp").textContent = String(xp);
  document.getElementById("goModeLine").textContent = `Mode: ${currentMode.name}`;
  document.getElementById("goMessage").textContent =
    `Destroyed on wave ${wave}. Final score: ${score}.`;
  showScreen("gameover");
}

document.getElementById("btnPlay").onclick = () => {
  resumeAudio();
  openModeSelect();
};

document.getElementById("btnStartMode").onclick = () => {
  resumeAudio();
  startGame();
};

document.getElementById("btnModesBack").onclick = () => {
  showScreen("home");
};

document.getElementById("btnPlayAgain").onclick = () => {
  resumeAudio();
  startGame();
};

document.getElementById("btnHomeSettings").onclick = () => openSettings("home");
document.getElementById("btnPauseSettings").onclick = () => openSettings("pause");

document.getElementById("btnSettingsBack").onclick = () => {
  const back = settings.settingsReturn;
  if (back === "pause") showScreen("pause");
  else if (back === "modes") showScreen("modes");
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
  startGame();
};

document.getElementById("btnMenu").onclick = goHome;
document.getElementById("btnGoMenu").onclick = goHome;

initAudio();
showHud(false);
renderModeCards();
showScreen("home");
last = performance.now();
animId = requestAnimationFrame(loop);

export {};
