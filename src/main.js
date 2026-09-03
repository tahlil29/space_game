import { settings, vibrateHit, vibrateBossKill } from "./settings.js";
import {
  initAudio,
  resumeAudio,
  setMusicEnabled,
  playShoot,
  playExplosion,
} from "./audio.js";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const screens = {
  home: document.getElementById("screen-home"),
  settings: document.getElementById("screen-settings"),
  pause: document.getElementById("screen-pause"),
  wave: document.getElementById("screen-wave"),
  gameover: document.getElementById("screen-gameover"),
};

const hud = document.getElementById("hud");
const healthWrap = document.getElementById("healthWrap");
const help = document.getElementById("help");

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

settings.load();
settings.syncToggles();

function showScreen(name) {
  Object.entries(screens).forEach(([key, el]) => {
    el.classList.toggle("active", key === name);
  });
  const menuOpen = name !== "playing";
  document.body.classList.toggle("menu-open", menuOpen);
}

function showHud(visible) {
  hud.classList.toggle("screen-hidden", !visible);
  healthWrap.classList.toggle("screen-hidden", !visible);
  help.classList.toggle("screen-hidden", !visible);
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
    if (gameState === "playing") pauseGame();
    else if (gameState === "paused") resumeGame();
    return;
  }
  if (gameState !== "playing") return;
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
  if (gameState === "playing") mouse.down = true;
});
addEventListener("mouseup", () => {
  mouse.down = false;
});

function reset() {
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
  enemiesToSpawn = 5;
  spawned = 0;
  spawnTimer = 1.4;
  betweenWaves = false;
  shootCD = 0;
  dashCD = 0;
  bossSpawned = false;
}

function startGame() {
  reset();
  gameState = "playing";
  showScreen(null);
  showHud(true);
  resumeAudio();
  setMusicEnabled(settings.music);
  last = performance.now();
}

function pauseGame() {
  if (gameState !== "playing") return;
  gameState = "paused";
  mouse.down = false;
  showScreen("pause");
}

function resumeGame() {
  if (gameState !== "paused") return;
  gameState = "playing";
  showScreen(null);
  last = performance.now();
}

function goHome() {
  gameState = "home";
  betweenWaves = false;
  mouse.down = false;
  showHud(false);
  showScreen("home");
}

function openSettings(from) {
  settings.settingsReturn = from;
  settings.syncToggles();
  showScreen("settings");
}

function spawnEnemy(forcedKind) {
  const type = Math.random();
  const kind =
    forcedKind ||
    (type < 0.55 ? "basic" : type < 0.78 ? "fast" : type < 0.92 ? "tank" : "boss");

  const stats = {
    basic: { r: 16, hp: 2, speed: 78 + wave * 5, damage: 16 },
    fast: { r: 11, hp: 1, speed: 135 + wave * 6, damage: 11 },
    tank: { r: 26, hp: 5, speed: 45 + wave * 3, damage: 22 },
    boss: {
      r: 34,
      hp: 12 + wave * 2,
      speed: 38 + wave * 2,
      damage: 30,
    },
  }[kind];

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
  if (dashCD > 0 || gameState !== "playing") return;
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

function separateEnemiesFromPlayer() {
  for (const e of enemies) {
    const dx = e.x - player.x;
    const dy = e.y - player.y;
    const dist = Math.hypot(dx, dy) || 0.001;
    const minDist = player.r + e.r + 6;
    if (dist >= minDist) continue;
    const overlap = minDist - dist;
    const nx = dx / dist;
    const ny = dy / dist;
    e.x += nx * overlap * 0.9;
    e.y += ny * overlap * 0.9;
    player.x = Math.max(
      player.r,
      Math.min(W - player.r, player.x - nx * overlap * 0.1),
    );
    player.y = Math.max(
      player.r,
      Math.min(H - player.r, player.y - ny * overlap * 0.1),
    );
  }
}

function applyContactDamage(dt) {
  if (player.inv > 0) return;
  let rawDamage = 0;
  let hits = 0;

  for (const e of enemies) {
    const dx = player.x - e.x;
    const dy = player.y - e.y;
    const dist = Math.hypot(dx, dy) || 1;
    if (dist > player.r + e.r + 10) continue;
    rawDamage += e.damage;
    hits++;
  }
  if (!hits) return;

  const strengthRate = 0.48;
  const hullRate = 1.08;
  let damage = rawDamage * strengthRate * dt;
  damage = Math.min(damage, (24 + 14 * Math.min(hits, 5)) * dt);

  if (player.strength > 0) {
    const absorbed = Math.min(player.strength, damage);
    player.strength -= absorbed;
    damage -= absorbed;
  }
  if (damage > 0) player.hp -= damage * (hullRate / strengthRate);
  if (hits > 0) burst(player.x, player.y, 3, player.strength > 0 ? "#9b7bff" : "#ff5478");
}

function isBoss(kind) {
  return kind === "boss" || kind === "tank";
}

const UPGRADES = [
  { icon: "DMG", name: "OVERCHARGE", desc: "+1 weapon damage", apply: (p) => { p.damage++; } },
  { icon: "SPD", name: "RAPID FIRE", desc: "18% faster firing", apply: (p) => { p.fireRate = Math.max(0.07, p.fireRate * 0.82); } },
  { icon: "FIX", name: "REPAIR", desc: "Restore 45 hull + 20 strength", apply: (p) => {
    p.hp = Math.min(p.maxHp, p.hp + 45);
    p.strength = Math.min(p.maxStrength, p.strength + 20);
  }},
  { icon: "HULL", name: "REINFORCE", desc: "+25 max hull + 15 max strength", apply: (p) => {
    p.maxHp += 25; p.hp += 25; p.maxStrength += 15; p.strength += 15;
  }},
  { icon: "ARM", name: "ARMOR CORE", desc: "+30 maximum strength", apply: (p) => {
    p.maxStrength += 30; p.strength += 30;
  }},
  { icon: "BOOST", name: "THRUST", desc: "+15% movement speed", apply: (p) => { p.speed *= 1.15; } },
];

function showWaveComplete() {
  betweenWaves = true;
  gameState = "waveComplete";
  settleWavePickups();

  document.getElementById("waveClearTitle").textContent = `WAVE ${wave} COMPLETE`;
  document.getElementById("waveScore").textContent = String(score);
  document.getElementById("waveXp").textContent = String(xp);
  document.getElementById("waveHull").textContent =
    `${Math.max(0, Math.round((player.hp / player.maxHp) * 100))}%`;

  const picks = [...UPGRADES].sort(() => Math.random() - 0.5).slice(0, 3);
  const choices = document.getElementById("choices");
  choices.innerHTML = "";
  picks.forEach((u) => {
    const d = document.createElement("div");
    d.className = "choice";
    d.innerHTML = `<div class="icon">${u.icon}</div><h3>${u.name}</h3><p>${u.desc}</p>`;
    d.onclick = () => {
      u.apply(player);
      wave++;
      enemiesToSpawn = 5 + wave * 3;
      spawned = 0;
      spawnTimer = 1.8;
      bossSpawned = false;
      betweenWaves = false;
      gameState = "playing";
      showScreen(null);
      last = performance.now();
    };
    choices.appendChild(d);
  });

  showScreen("wave");
}

function updateHud() {
  document.getElementById("wave").textContent = String(wave);
  document.getElementById("enemyCount").textContent =
    `(${Math.max(0, enemiesToSpawn - spawned) + enemies.length} left)`;
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

  spawnTimer -= dt;
  if (spawned < enemiesToSpawn && spawnTimer <= 0) {
    spawnEnemy();
    spawned++;
    spawnTimer = Math.max(0.65, 1.45 - wave * 0.035);
  }

  if (wave >= 2 && !bossSpawned && spawned >= Math.floor(enemiesToSpawn * 0.6)) {
    spawnEnemy("boss");
    bossSpawned = true;
  }

  bullets.forEach((b) => {
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.life -= dt;
  });
  bullets = bullets.filter(
    (b) => b.life > 0 && b.x > -50 && b.x < W + 50 && b.y > -50 && b.y < H + 50,
  );

  for (const e of enemies) {
    const dx = player.x - e.x;
    const dy = player.y - e.y;
    const dist = Math.hypot(dx, dy) || 1;
    const minDist = player.r + e.r + 6;
    if (dist > minDist + 8) {
      e.x += (dx / dist) * e.speed * dt;
      e.y += (dy / dist) * e.speed * dt;
    } else if (dist > minDist) {
      e.x += (dx / dist) * e.speed * 0.45 * dt;
      e.y += (dy / dist) * e.speed * 0.45 * dt;
    } else {
      const tx = -dy / dist;
      const ty = dx / dist;
      e.x += tx * e.speed * 0.55 * dt;
      e.y += ty * e.speed * 0.55 * dt;
    }
  }

  separateEnemiesFromPlayer();
  applyContactDamage(dt);

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

  if (spawned >= enemiesToSpawn && enemies.length === 0 && !betweenWaves) {
    showWaveComplete();
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
  if (gameState === "playing") {
    last = t;
    update(dt);
  }
  draw();
  animId = requestAnimationFrame(loop);
}

function gameOver() {
  gameState = "gameover";
  mouse.down = false;
  document.getElementById("goWave").textContent = String(wave);
  document.getElementById("goScore").textContent = String(score);
  document.getElementById("goXp").textContent = String(xp);
  document.getElementById("goMessage").textContent =
    `Destroyed on wave ${wave}. Final score: ${score}.`;
  showScreen("gameover");
}

document.getElementById("btnPlay").onclick = () => {
  resumeAudio();
  startGame();
};

document.getElementById("btnPlayAgain").onclick = () => {
  resumeAudio();
  startGame();
};

document.getElementById("btnHomeSettings").onclick = () => openSettings("home");
document.getElementById("btnPauseSettings").onclick = () => openSettings("pause");

document.getElementById("btnSettingsBack").onclick = () => {
  showScreen(settings.settingsReturn === "pause" ? "pause" : "home");
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
showScreen("home");
last = performance.now();
animId = requestAnimationFrame(loop);

export {};
