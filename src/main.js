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
import { shop, COIN_REWARDS } from "./shop.js";
import { auth } from "./auth.js";
import { userKey } from "./storage.js";
import { isFirebaseConfigured } from "./firebase.js";
import { pullCloudSave, pushCloudSave } from "./cloud.js";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const screens = {
  auth: document.getElementById("screen-auth"),
  home: document.getElementById("screen-home"),
  modes: document.getElementById("screen-modes"),
  map: document.getElementById("screen-map"),
  shop: document.getElementById("screen-shop"),
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
let gameState = "auth";
let authTab = "login";
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
let arenaProps = [];
let shopTab = "ship";
let floaters = [];
let combo = 0;
let bestCombo = 0;
let comboTimer = 0;
let killCount = 0;
let runCoinsEarned = 0;
let waveToastTimer = 0;
const UPGRADE_HITS = 6;
const COMBO_WINDOW = 2.2;

const touch = {
  active: false,
  moveX: 0,
  moveY: 0,
  firing: false,
  joyId: null,
  fireId: null,
};

const joyPad = document.getElementById("joyPad");
const joyKnob = document.getElementById("joyKnob");
const touchControls = document.getElementById("touchControls");
const btnTouchFire = document.getElementById("btnTouchFire");
const btnTouchDash = document.getElementById("btnTouchDash");

function prefersTouchUi() {
  return (
    matchMedia("(pointer: coarse)").matches ||
    matchMedia("(hover: none)").matches ||
    (navigator.maxTouchPoints > 0 && Math.min(screen.width, screen.height) <= 1024)
  );
}

function syncTouchUi(force) {
  const on = force === true || (force !== false && prefersTouchUi());
  touch.active = on;
  document.body.classList.toggle("touch-ui", on);
  if (!isActiveGameplay() && gameState !== "paused") {
    touchControls.classList.add("screen-hidden");
    touchControls.setAttribute("aria-hidden", "true");
    return;
  }
  touchControls.classList.toggle("screen-hidden", !on);
  touchControls.setAttribute("aria-hidden", on ? "false" : "true");
}

function resetTouchMove() {
  touch.moveX = 0;
  touch.moveY = 0;
  touch.joyId = null;
  if (joyKnob) joyKnob.style.transform = "translate(0px, 0px)";
}

function setJoyFromPoint(clientX, clientY) {
  const rect = joyPad.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const max = rect.width * 0.34;
  let dx = clientX - cx;
  let dy = clientY - cy;
  const len = Math.hypot(dx, dy) || 1;
  if (len > max) {
    dx = (dx / len) * max;
    dy = (dy / len) * max;
  }
  touch.moveX = dx / max;
  touch.moveY = dy / max;
  joyKnob.style.transform = `translate(${dx}px, ${dy}px)`;
}

function aimAtNearestThreat() {
  if (!player) return;
  let best = null;
  let bestDist = Infinity;
  const pool =
    gameState === "upgradeSelect" && upgradeTargets.length
      ? upgradeTargets
      : enemies;
  for (const t of pool) {
    const d = Math.hypot(t.x - player.x, t.y - player.y);
    if (d < bestDist) {
      bestDist = d;
      best = t;
    }
  }
  if (best) {
    mouse.x = best.x;
    mouse.y = best.y;
  } else if (Math.hypot(touch.moveX, touch.moveY) > 0.15) {
    mouse.x = player.x + touch.moveX * 200;
    mouse.y = player.y + touch.moveY * 200;
  }
}

function isActiveGameplay() {
  return gameState === "playing" || gameState === "upgradeSelect";
}

settings.syncToggles();
currentMode = getMode(settings.selectedMode || "classic");
currentTheme = getTheme(currentMode.id);
applyThemeToDom(currentTheme);

function loadUserData() {
  settings.load();
  progress.load();
  shop.load();
  settings.syncToggles();
  currentMode = getMode(settings.selectedMode || "classic");
  currentTheme = getTheme(currentMode.id);
  applyThemeToDom(currentTheme);
  setMusicProfile(currentMode.id);
  setMusicEnabled(settings.music);
  rebuildStars();
  refreshCareerStats();
  renderModeCards();
  setStartModeLabel();
}

function refreshProfileIdentity() {
  const nameEl = document.getElementById("profileName");
  const roleEl = document.getElementById("profileRole");
  if (nameEl) nameEl.textContent = auth.displayName();
  if (roleEl) roleEl.textContent = auth.isGuest ? "GUEST" : "PILOT";
}

function refreshCoinUI() {
  const c = String(shop.coins);
  const shopEl = document.getElementById("shopCoins");
  const hudCoins = document.getElementById("hudCoins");
  const profileCoins = document.getElementById("profileCoins");
  if (shopEl) shopEl.textContent = c;
  if (profileCoins) profileCoins.textContent = c;
  if (hudCoins) {
    if (hudCoins.textContent !== c) {
      hudCoins.parentElement?.classList.add("coin-flash");
      setTimeout(() => hudCoins.parentElement?.classList.remove("coin-flash"), 280);
    }
    hudCoins.textContent = c;
  }
}

function refreshCareerStats() {
  const best = Math.max(
    progress.classic?.bestScore || 0,
    progress.boss?.bestScore || 0,
    progress.endless?.bestScore || 0,
  );
  const sectors = Math.max(
    progress.classic?.unlocked || 1,
    progress.boss?.unlocked || 1,
  );
  let lastScore = 0;
  try {
    lastScore = Number(localStorage.getItem(userKey("last-score")) || 0);
  } catch {
    lastScore = 0;
  }
  const bestEl = document.getElementById("profileBest");
  const scoreEl = document.getElementById("profileScore");
  const progEl = document.getElementById("profileProgress");
  if (bestEl) bestEl.textContent = String(best);
  if (scoreEl) scoreEl.textContent = String(lastScore);
  if (progEl) progEl.textContent = `${sectors}/${MAP_LEVEL_COUNT}`;
  refreshProfileIdentity();
  refreshCoinUI();
}

function spawnFloater(x, y, text, color = "#ffd56b") {
  floaters.push({
    x,
    y,
    vy: -48 - Math.random() * 30,
    life: 0.9,
    text,
    color,
  });
}

function updateFloaters(dt) {
  for (const f of floaters) {
    f.y += f.vy * dt;
    f.vy *= 0.98;
    f.life -= dt;
  }
  floaters = floaters.filter((f) => f.life > 0);
}

function drawFloaters() {
  for (const f of floaters) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, f.life * 1.4));
    ctx.fillStyle = f.color;
    ctx.font = "bold 16px Orbitron, sans-serif";
    ctx.textAlign = "center";
    ctx.shadowBlur = 12;
    ctx.shadowColor = f.color;
    ctx.fillText(f.text, f.x, f.y);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

function updateCombo(dt) {
  if (combo <= 0) return;
  comboTimer -= dt;
  if (comboTimer <= 0) {
    combo = 0;
    comboTimer = 0;
    syncComboHud();
  }
}

function registerKill(e, baseCoins, baseScore) {
  combo += 1;
  bestCombo = Math.max(bestCombo, combo);
  comboTimer = COMBO_WINDOW;
  killCount += 1;
  const comboBonus = Math.min(8, Math.floor((combo - 1) / 2));
  const coins = baseCoins + comboBonus;
  const scoreGain = baseScore + comboBonus * 2;
  shop.addCoins(coins);
  runCoinsEarned += coins;
  score += scoreGain;
  spawnFloater(e.x, e.y - 10, `+${coins} ◎`, "#ffd56b");
  spawnFloater(e.x + 12, e.y + 14, `+${scoreGain}`, "#7bc8ff");
  if (combo >= 2) {
    spawnFloater(e.x - 16, e.y - 28, `COMBO x${combo}`, "#7dffb2");
  }
  syncComboHud();
  refreshCoinUI();
  return { coins, scoreGain };
}

function syncComboHud() {
  const panel = document.getElementById("comboPanel");
  const val = document.getElementById("comboValue");
  if (!panel || !val) return;
  if (combo >= 2 && isActiveGameplay()) {
    panel.classList.remove("screen-hidden");
    val.textContent = `x${combo}`;
    panel.classList.add("combo-hot");
  } else {
    panel.classList.add("screen-hidden");
    panel.classList.remove("combo-hot");
    val.textContent = "x1";
  }
}

function showWaveToast(title, kicker = "INCOMING") {
  const el = document.getElementById("waveToast");
  const text = document.getElementById("waveToastText");
  const kick = el?.querySelector(".wave-toast-kicker");
  if (!el || !text) return;
  if (kick) kick.textContent = kicker;
  text.textContent = title;
  el.classList.remove("screen-hidden");
  el.classList.remove("wave-toast-out");
  el.classList.add("wave-toast-in");
  waveToastTimer = 1.6;
}

function updateWaveToast(dt) {
  if (waveToastTimer <= 0) return;
  waveToastTimer -= dt;
  if (waveToastTimer <= 0) {
    const el = document.getElementById("waveToast");
    el?.classList.add("wave-toast-out");
    setTimeout(() => el?.classList.add("screen-hidden"), 280);
  }
}

function rebuildArenaProps() {
  const item = shop.getEquipped("prop");
  const prop = item?.prop || { kind: "none" };
  arenaProps = [];
  if (!prop.kind || prop.kind === "none") return;
  const n = prop.count || 5;
  for (let i = 0; i < n; i++) {
    arenaProps.push({
      kind: prop.kind,
      x: 60 + Math.random() * Math.max(40, W - 120),
      y: 60 + Math.random() * Math.max(40, H - 120),
      r: prop.kind === "asteroids" ? 10 + Math.random() * 16 : prop.kind === "rings" ? 28 + Math.random() * 24 : 6 + Math.random() * 8,
      rot: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 0.8,
      pulse: Math.random() * Math.PI * 2,
      color: prop.color || "#888",
    });
  }
}

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
  if (visible) syncTouchUi();
  else {
    touchControls.classList.add("screen-hidden");
    touch.firing = false;
    mouse.down = false;
    resetTouchMove();
    btnTouchFire?.classList.remove("active");
    document.getElementById("comboPanel")?.classList.add("screen-hidden");
    document.getElementById("waveToast")?.classList.add("screen-hidden");
  }
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
    const diffBars = Array.from({ length: 5 }, (_, i) =>
      `<i class="${i < mode.difficulty ? "on" : ""}"></i>`,
    ).join("");
    btn.innerHTML = `
      <span class="mode-name">${mode.name}</span>
      <span class="mode-diff" aria-label="Difficulty ${mode.difficulty} of 5">${diffBars}</span>
      <span class="mode-stars">${starsHtml(mode.difficulty)}</span>
      <span class="mode-tag">${mode.tagline}</span>
      <span class="mode-desc">${mode.description}</span>
    `;
    btn.onclick = () => selectMode(id);
    modeGrid.appendChild(btn);
  });
}

function setStartModeLabel() {
  const btn = document.getElementById("btnStartMode");
  const label = currentMode.hasLevelMap ? "SELECT LEVEL" : "START MISSION";
  const main = btn.querySelector(".btn-main");
  if (main) main.textContent = label;
  else btn.textContent = label;
}

function selectMode(id) {
  setActiveMode(id);
  renderModeCards();
  setStartModeLabel();
}

function openModeSelect() {
  gameState = "modes";
  currentTheme = getTheme(settings.selectedMode || "classic");
  applyThemeToDom(currentTheme);
  renderModeCards();
  setStartModeLabel();
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
      <span class="ln-num">SECTOR ${i}</span>
      <span class="ln-stars">${locked ? "LOCKED" : levelStarsHtml(earned)}</span>
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
  gameState = "map";
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
  const vv = window.visualViewport;
  W = Math.max(1, Math.floor(vv?.width || innerWidth));
  H = Math.max(1, Math.floor(vv?.height || innerHeight));
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (!player) player = { x: W / 2, y: H / 2 };
  else {
    player.x = Math.min(W - player.r, Math.max(player.r, player.x));
    player.y = Math.min(H - player.r, Math.max(player.r, player.y));
  }
  rebuildStars();
  syncTouchUi();
}

addEventListener("resize", resize);
window.visualViewport?.addEventListener("resize", resize);
window.visualViewport?.addEventListener("scroll", resize);
matchMedia("(pointer: coarse)").addEventListener?.("change", () => syncTouchUi());
matchMedia("(orientation: portrait)").addEventListener?.("change", () => {
  resize();
  syncTouchUi();
});
resize();
syncTouchUi();

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
  if (touch.active && touch.firing) return;
  mouse.x = e.clientX;
  mouse.y = e.clientY;
});
canvas.addEventListener("mousedown", () => {
  if (isActiveGameplay()) mouse.down = true;
});
addEventListener("mouseup", () => {
  if (!touch.firing) mouse.down = false;
});

// First touch on a touch device enables touch UI even on hybrid laptops
addEventListener(
  "touchstart",
  () => {
    if (!touch.active) syncTouchUi(true);
  },
  { passive: true },
);

function bindPressButton(el, onDown, onUp) {
  const down = (e) => {
    e.preventDefault();
    e.stopPropagation();
    onDown(e);
  };
  const up = (e) => {
    e.preventDefault();
    e.stopPropagation();
    onUp(e);
  };
  el.addEventListener("pointerdown", down);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
  el.addEventListener("pointerleave", (e) => {
    if (e.buttons === 0) onUp(e);
  });
}

joyPad.addEventListener(
  "pointerdown",
  (e) => {
    if (!isActiveGameplay()) return;
    e.preventDefault();
    joyPad.setPointerCapture(e.pointerId);
    touch.joyId = e.pointerId;
    setJoyFromPoint(e.clientX, e.clientY);
  },
  { passive: false },
);

joyPad.addEventListener(
  "pointermove",
  (e) => {
    if (touch.joyId !== e.pointerId) return;
    e.preventDefault();
    setJoyFromPoint(e.clientX, e.clientY);
  },
  { passive: false },
);

function endJoy(e) {
  if (touch.joyId != null && e.pointerId !== touch.joyId) return;
  resetTouchMove();
}

joyPad.addEventListener("pointerup", endJoy);
joyPad.addEventListener("pointercancel", endJoy);

bindPressButton(
  btnTouchFire,
  () => {
    if (!isActiveGameplay()) return;
    touch.firing = true;
    mouse.down = true;
    btnTouchFire.classList.add("active");
    aimAtNearestThreat();
  },
  () => {
    touch.firing = false;
    mouse.down = false;
    btnTouchFire.classList.remove("active");
  },
);

btnTouchDash.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  e.stopPropagation();
  dash();
});

// Tap canvas to aim / fire briefly (boost targets + desktop-like tap)
canvas.addEventListener(
  "pointerdown",
  (e) => {
    if (!isActiveGameplay()) return;
    if (e.target !== canvas) return;
    if (touch.active && e.pointerType === "touch") {
      // On touch UI, canvas taps aim at that point (upgrade pick / manual aim)
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      if (gameState === "upgradeSelect") {
        mouse.down = true;
        touch.firing = true;
      }
    }
  },
  { passive: true },
);

canvas.addEventListener("pointerup", (e) => {
  if (e.pointerType === "touch" && gameState === "upgradeSelect") {
    mouse.down = false;
    touch.firing = false;
  }
});

// Prevent page gestures while playing
document.addEventListener(
  "gesturestart",
  (e) => {
    e.preventDefault();
  },
  { passive: false },
);

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
  floaters = [];
  combo = 0;
  bestCombo = 0;
  comboTimer = 0;
  killCount = 0;
  runCoinsEarned = 0;
  waveToastTimer = 0;
  syncComboHud();
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
  rebuildArenaProps();
  refreshCoinUI();
  syncTouchUi();
  showWaveToast(`WAVE ${waveInLevel(wave)}`, `LEVEL ${getLevel(wave)}`);
  last = performance.now();
}

function pauseGame() {
  if (!isActiveGameplay()) return;
  gameState = "paused";
  mouse.down = false;
  touch.firing = false;
  resetTouchMove();
  btnTouchFire?.classList.remove("active");
  touchControls.classList.add("screen-hidden");
  document.getElementById("pauseModeBadge").textContent =
    `${currentMode.hudLabel} · PAUSED`;
  showScreen("pause");
}

function resumeGame() {
  if (gameState !== "paused") return;
  gameState = upgradeTargets.length > 0 ? "upgradeSelect" : "playing";
  showScreen(null);
  syncTouchUi();
  last = performance.now();
}

function openShop() {
  gameState = "shop";
  shopTab = "ship";
  document.querySelectorAll(".shop-tab").forEach((t) => {
    t.classList.toggle("active", t.dataset.tab === shopTab);
  });
  showHud(false);
  renderShop();
  showScreen("shop");
}

function shopRarity(item) {
  if (item.price === 0) return { cls: "free", label: "STARTER" };
  if (item.price <= 40) return { cls: "common", label: "COMMON" };
  if (item.price <= 55) return { cls: "rare", label: "RARE" };
  if (item.price <= 70) return { cls: "epic", label: "EPIC" };
  return { cls: "legend", label: "LEGEND" };
}

function shopPreviewHtml(item) {
  const icon = item.icon || item.type;
  let art = `<span class="shop-icon shop-icon-${icon}" aria-hidden="true"></span>`;
  if (item.type === "ship" && item.ship) {
    art += `<div class="shop-preview" style="--ship-body:${item.ship.body};--ship-glow:${item.ship.glow}">
      <span class="shop-ship-preview" aria-hidden="true"></span>
      <span class="shop-swatch" style="--swatch:${item.ship.core}"></span>
      <span class="shop-swatch" style="--swatch:${item.ship.glow}"></span>
    </div>`;
  } else if (item.type === "enemy" && item.enemy) {
    const cols = [item.enemy.basic, item.enemy.fast, item.enemy.tank, item.enemy.boss];
    art += `<div class="shop-preview">${cols
      .map((c) => `<span class="shop-swatch" style="--swatch:${c}"></span>`)
      .join("")}</div>`;
  } else if (item.type === "prop" && item.prop) {
    const c = item.prop.color || "#64748b";
    art += `<div class="shop-preview"><span class="shop-swatch" style="--swatch:${c}"></span></div>`;
  }
  return `<div class="shop-art">${art}</div>`;
}

function renderShop() {
  refreshCoinUI();
  document.querySelectorAll(".shop-tab").forEach((t) => {
    t.classList.toggle("active", t.dataset.tab === shopTab);
  });
  const grid = document.getElementById("shopGrid");
  const msg = document.getElementById("shopMsg");
  msg.textContent = "";
  grid.innerHTML = "";
  shop.itemsByType(shopTab).forEach((item) => {
    const owned = shop.owns(item.id);
    const equipped = shop.equipped[item.type] === item.id;
    const rarity = shopRarity(item);
    const card = document.createElement("div");
    card.className =
      "shop-item" +
      (equipped ? " equipped" : "") +
      ` rarity-${rarity.cls}`;
    const priceLabel = item.price === 0 ? "FREE" : `◎ ${item.price}`;
    let action = "";
    if (equipped) {
      action = `<button type="button" disabled>EQUIPPED</button>`;
    } else if (owned) {
      action = `<button type="button" class="secondary" data-equip="${item.id}">EQUIP</button>`;
    } else {
      action = `<button type="button" data-buy="${item.id}">BUY</button>`;
    }
    card.innerHTML = `
      ${shopPreviewHtml(item)}
      <div class="shop-meta">
        <div class="shop-rarity ${rarity.cls}">${rarity.label}</div>
        <h3>${item.name}</h3>
        <p>${item.desc}</p>
        <div class="shop-price">${owned ? (equipped ? "OWNED · ACTIVE" : "OWNED") : priceLabel}</div>
        ${action}
      </div>
    `;
    grid.appendChild(card);
  });

  grid.querySelectorAll("[data-buy]").forEach((btn) => {
    btn.onclick = () => {
      const res = shop.buy(btn.getAttribute("data-buy"));
      if (!res.ok) {
        msg.textContent =
          res.reason === "funds" ? "Not enough coins." : "Cannot buy that.";
        return;
      }
      msg.textContent = "Purchased and equipped!";
      if (shopTab === "prop") rebuildArenaProps();
      refreshCareerStats();
      renderShop();
    };
  });
  grid.querySelectorAll("[data-equip]").forEach((btn) => {
    btn.onclick = () => {
      shop.equip(btn.getAttribute("data-equip"));
      msg.textContent = "Loadout updated.";
      if (shopTab === "prop") rebuildArenaProps();
      renderShop();
    };
  });
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
  refreshCoinUI();
  refreshCareerStats();
  showScreen("home");
}

function openAuth(message = "") {
  gameState = "auth";
  authTab = "login";
  showHud(false);
  document.querySelectorAll(".auth-tab").forEach((t) => {
    t.classList.toggle("active", t.dataset.authTab === authTab);
  });
  const submit = document.querySelector("#btnAuthSubmit .btn-main");
  if (submit) submit.textContent = "LOGIN";
  const phoneField = document.getElementById("authPhoneField");
  if (phoneField) phoneField.hidden = true;
  const form = document.getElementById("authForm");
  if (form) form.hidden = false;
  const forgotOpen = document.getElementById("btnForgotOpen");
  if (forgotOpen) forgotOpen.hidden = false;
  const forgotPanel = document.getElementById("authForgotPanel");
  if (forgotPanel) forgotPanel.hidden = true;
  const linkPanel = document.getElementById("authPhoneOtpPanel");
  if (linkPanel) linkPanel.hidden = true;
  const tabs = document.querySelector(".auth-tabs");
  if (tabs) tabs.hidden = false;
  const msg = document.getElementById("authMsg");
  if (msg) msg.textContent = message;
  const userInput = document.getElementById("authUsername");
  const passInput = document.getElementById("authPassword");
  const phoneInput = document.getElementById("authPhone");
  if (userInput) userInput.value = "";
  if (passInput) passInput.value = "";
  if (phoneInput) phoneInput.value = "";
  showScreen("auth");
}

async function enterAppAfterAuth() {
  await pullCloudSave();
  loadUserData();
  await pushCloudSave(true);
  goHome();
}

async function logoutToAuth() {
  await auth.logout();
  loadUserData();
  openAuth("Signed out. Login, create an account, or continue as guest.");
}

function openSettings(from) {
  settings.settingsReturn = from;
  settings.syncToggles();
  gameState = "settings";
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
    (keys.d || keys.arrowright ? 1 : 0) -
    (keys.a || keys.arrowleft ? 1 : 0) +
    touch.moveX;
  const dy =
    (keys.s || keys.arrowdown ? 1 : 0) -
    (keys.w || keys.arrowup ? 1 : 0) +
    touch.moveY;
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
  showWaveToast(`WAVE ${waveInLevel(wave)}`, `LEVEL ${getLevel(wave)}`);
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
  refreshCareerStats();
  document.getElementById("waveToast")?.classList.add("screen-hidden");
  showScreen("level");
}

function continueAfterLevel() {
  pendingLevelAdvance = false;
  betweenWaves = false;
  gameState = "playing";
  showScreen(null);
  syncTouchUi();
  showWaveToast(`WAVE ${waveInLevel(wave)}`, `LEVEL ${getLevel(wave)}`);
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
  refreshCoinUI();
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
  updateArenaProps(dt);

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
        const baseScore =
          e.kind === "boss" ? 80 : e.kind === "tank" ? 30 : e.kind === "fast" ? 15 : 10;
        xp += e.kind === "boss" ? 10 : e.kind === "tank" ? 4 : 1;
        const baseCoins = COIN_REWARDS[e.kind] || 2;
        registerKill(e, baseCoins, baseScore);
        addXP(e.x, e.y);
        burst(
          e.x,
          e.y,
          e.kind === "boss" ? 22 : 14,
          (shop.getEquipped("enemy")?.enemy?.[e.kind]) ||
            currentTheme.enemy[e.kind] ||
            "#8bdcff",
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
      spawnFloater(p.x, p.y, "+XP", "#9d7bff");
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
  if (touch.active && (touch.firing || mouse.down)) {
    aimAtNearestThreat();
  }

  const ax =
    (keys.d || keys.arrowright ? 1 : 0) -
    (keys.a || keys.arrowleft ? 1 : 0) +
    touch.moveX;
  const ay =
    (keys.s || keys.arrowdown ? 1 : 0) -
    (keys.w || keys.arrowup ? 1 : 0) +
    touch.moveY;
  const moveLen = Math.hypot(ax, ay) || 1;
  const moving = Math.hypot(ax, ay) > 0.08;

  if (moving) {
    player.x = Math.max(
      player.r,
      Math.min(W - player.r, player.x + (ax / moveLen) * player.speed * dt),
    );
    player.y = Math.max(
      player.r,
      Math.min(H - player.r, player.y + (ay / moveLen) * player.speed * dt),
    );
  }

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

  updateFloaters(dt);
  updateCombo(dt);
  updateWaveToast(dt);

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

function updateArenaProps(dt) {
  for (const p of arenaProps) {
    p.rot += p.spin * dt;
    p.pulse += dt * 1.6;
  }
}

function drawArenaProps() {
  for (const p of arenaProps) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot || 0);
    ctx.globalAlpha = 0.55;
    if (p.kind === "beacons") {
      const pulse = 0.65 + Math.sin(p.pulse) * 0.25;
      ctx.globalAlpha = pulse;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, p.r * 1.4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = p.color;
      ctx.globalAlpha = pulse * 0.45;
      ctx.beginPath();
      ctx.arc(0, 0, p.r * 0.45, 0, Math.PI * 2);
      ctx.fill();
    } else if (p.kind === "rings") {
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(0, 0, p.r * 1.35, p.r * 0.45, 0.35, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "#94a3b8";
      ctx.globalAlpha = 0.3;
      ctx.beginPath();
      ctx.arc(0, 0, p.r * 0.28, 0, Math.PI * 2);
      ctx.fill();
    } else if (p.kind === "debris") {
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.r, -p.r * 0.4, p.r * 2, p.r * 0.8);
      ctx.fillRect(-p.r * 0.3, -p.r, p.r * 0.6, p.r * 2);
    } else {
      // asteroids
      ctx.fillStyle = p.color;
      ctx.beginPath();
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        const rr = p.r * (0.75 + ((i * 37) % 5) * 0.06);
        ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#5c4a3a";
      ctx.beginPath();
      ctx.arc(-p.r * 0.25, -p.r * 0.15, p.r * 0.28, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  ctx.globalAlpha = 1;
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

  if (
    gameState === "auth" ||
    gameState === "home" ||
    gameState === "modes" ||
    gameState === "map" ||
    gameState === "shop" ||
    gameState === "settings"
  ) {
    return;
  }

  const theme = currentTheme;
  const shipSkin = shop.getEquipped("ship")?.ship;
  const enemySkin = shop.getEquipped("enemy")?.enemy;

  drawArenaProps();

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
    const col =
      (enemySkin && enemySkin[e.kind]) ||
      theme.enemy[e.kind] ||
      theme.enemy.basic;
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
  ctx.shadowColor = shipSkin?.glow || theme.playerGlow;
  ctx.fillStyle = shipSkin?.body || theme.player;
  ctx.beginPath();
  ctx.moveTo(27, 0);
  ctx.lineTo(-15, -13);
  ctx.lineTo(-8, 0);
  ctx.lineTo(-15, 13);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = shipSkin?.core || theme.playerCore;
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
  drawFloaters();
}

function loop(t) {
  const dt = Math.min((t - (last || t)) / 1000, 0.033);
  if (isActiveGameplay()) {
    last = t;
    update(dt);
  } else {
    last = t;
    // Soft ambience on menus
    if (
      gameState === "auth" ||
      gameState === "home" ||
      gameState === "modes" ||
      gameState === "map" ||
      gameState === "shop" ||
      gameState === "settings"
    ) {
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
  document.getElementById("waveToast")?.classList.add("screen-hidden");
  mouse.down = false;
  touch.firing = false;
  syncComboHud();
  if (currentMode.id === "endless") {
    progress.recordEndlessRun(wave, score);
  }
  document.getElementById("goLevel").textContent = String(getLevel(wave));
  document.getElementById("goWave").textContent = String(wave);
  document.getElementById("goScore").textContent = String(score);
  document.getElementById("goCoins").textContent = String(runCoinsEarned);
  document.getElementById("goCombo").textContent = `x${Math.max(1, bestCombo)}`;
  document.getElementById("goKills").textContent = String(killCount);
  document.getElementById("goModeBadge").textContent = `${currentMode.hudLabel} · FAILED`;
  document.getElementById("goModeLine").textContent = `Mode: ${currentMode.name}`;
  document.getElementById("goMessage").textContent =
    `Destroyed on level ${getLevel(wave)}, wave ${wave}. Final score: ${score}.`;
  try {
    localStorage.setItem(userKey("last-score"), String(score));
  } catch {
    /* ignore */
  }
  pushCloudSave(true);
  refreshCareerStats();
  showScreen("gameover");
}

document.getElementById("btnPlay").onclick = () => {
  resumeAudio();
  openModeSelect();
};

document.getElementById("btnHomeShop").onclick = () => {
  resumeAudio();
  openShop();
};

document.getElementById("btnShopBack").onclick = () => {
  goHome();
};

document.querySelectorAll(".shop-tab").forEach((btn) => {
  btn.onclick = () => {
    shopTab = btn.dataset.tab;
    renderShop();
  };
});

document.getElementById("btnStartMode").onclick = () => {
  resumeAudio();
  beginMissionFromMenu();
};

document.getElementById("btnModesBack").onclick = () => {
  goHome();
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
  if (back === "pause") {
    gameState = "paused";
    showScreen("pause");
  } else if (back === "modes") {
    openModeSelect();
  } else if (back === "map") {
    openLevelMap();
  } else if (back === "shop") {
    openShop();
  } else {
    goHome();
  }
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

const AUTH_REASONS = {
  username: "Username must be at least 3 letters/numbers.",
  password: "Password must be at least 6 characters.",
  credentials: "Wrong username or password. Use the same name you registered with.",
  exists: "That username is already taken.",
  missing: "Account not found. Create an account first, or check the username.",
  phone: "Enter a valid mobile number with country code (e.g. +1...).",
  otp: "Invalid or expired SMS code. Request a new one.",
  "phone-in-use": "That mobile number is already linked to another account.",
  "phone-not-linked":
    "This number is not linked to a password account. Create an account and verify mobile first.",
  "firebase-not-started":
    "Open Firebase Console → Authentication → Get started, then enable Email/Password.",
  "firebase-disabled":
    "Enable Email/Password, Phone, and Anonymous in Firebase → Authentication → Sign-in method.",
  network: "Network error talking to Firebase.",
  domain:
    "Add this site’s domain in Firebase → Authentication → Authorized domains.",
  rate: "Too many tries. Wait a minute and retry.",
  "popup-closed": "Google sign-in was cancelled.",
  "popup-blocked": "Allow popups for this site to use Google sign-in.",
  "account-exists":
    "That Google email already has an account with a different sign-in method.",
  firebase: "Firebase auth failed. Check sign-in providers are enabled.",
};

function authFailureMessage(res, fallback) {
  const base = AUTH_REASONS[res.reason] || fallback;
  if (res.detail && !AUTH_REASONS[res.reason]) return `${base} (${res.detail})`;
  return base;
}

function setAuthMode(mode) {
  authTab = mode;
  document.querySelectorAll(".auth-tab").forEach((t) => {
    t.classList.toggle("active", t.dataset.authTab === authTab);
  });
  const submit = document.querySelector("#btnAuthSubmit .btn-main");
  if (submit) submit.textContent = authTab === "register" ? "CREATE ACCOUNT" : "LOGIN";
  const phoneField = document.getElementById("authPhoneField");
  if (phoneField) phoneField.hidden = authTab !== "register";
  document.getElementById("authMsg").textContent = "";
}

function showAuthMain() {
  document.getElementById("authForm").hidden = false;
  document.getElementById("btnForgotOpen").hidden = false;
  document.getElementById("authForgotPanel").hidden = true;
  document.getElementById("authPhoneOtpPanel").hidden = true;
  document.querySelector(".auth-tabs").hidden = false;
}

function showForgotPanel() {
  document.getElementById("authForm").hidden = true;
  document.getElementById("btnForgotOpen").hidden = true;
  document.getElementById("authForgotPanel").hidden = false;
  document.getElementById("authPhoneOtpPanel").hidden = true;
  document.querySelector(".auth-tabs").hidden = true;
  document.getElementById("forgotOtpField").hidden = true;
  document.getElementById("forgotPassField").hidden = true;
  document.getElementById("btnForgotReset").hidden = true;
  document.getElementById("btnForgotSend").hidden = false;
  document.getElementById("forgotMsg").textContent = "";
  document.getElementById("forgotOtp").value = "";
  document.getElementById("forgotPassword").value = "";
}

function showPhoneLinkPanel() {
  document.getElementById("authForm").hidden = true;
  document.getElementById("btnForgotOpen").hidden = true;
  document.getElementById("authForgotPanel").hidden = true;
  document.getElementById("authPhoneOtpPanel").hidden = false;
  document.querySelector(".auth-tabs").hidden = true;
  document.getElementById("linkPhoneMsg").textContent =
    "Enter the SMS code sent to your mobile.";
  document.getElementById("linkPhoneOtp").value = "";
}

document.querySelectorAll(".auth-tab").forEach((btn) => {
  btn.onclick = () => setAuthMode(btn.dataset.authTab);
});

document.getElementById("authForm").onsubmit = async (e) => {
  e.preventDefault();
  const username = document.getElementById("authUsername").value;
  const password = document.getElementById("authPassword").value;
  const phone = document.getElementById("authPhone")?.value || "";
  const msg = document.getElementById("authMsg");
  msg.textContent = "";
  try {
    const res =
      authTab === "register"
        ? await auth.register(username, password, phone)
        : await auth.login(username, password);
    if (!res.ok) {
      msg.textContent = authFailureMessage(res, "Could not continue.");
      return;
    }
    if (res.needsPhoneOtp) {
      showPhoneLinkPanel();
      return;
    }
    resumeAudio();
    await enterAppAfterAuth();
  } catch {
    msg.textContent = "Auth failed on this device.";
  }
};

document.getElementById("btnForgotOpen").onclick = () => showForgotPanel();
document.getElementById("btnForgotBack").onclick = () => {
  showAuthMain();
  setAuthMode("login");
};

document.getElementById("btnForgotSend").onclick = async () => {
  const msg = document.getElementById("forgotMsg");
  msg.textContent = "";
  const phone = document.getElementById("forgotPhone").value;
  const res = await auth.sendPasswordResetOtp(phone);
  if (!res.ok) {
    msg.textContent = authFailureMessage(res, "Could not send SMS code.");
    return;
  }
  document.getElementById("forgotOtpField").hidden = false;
  document.getElementById("forgotPassField").hidden = false;
  document.getElementById("btnForgotReset").hidden = false;
  document.getElementById("btnForgotSend").hidden = true;
  msg.textContent = res.localDemoOtp
    ? `Local mode: use code ${res.localDemoOtp}`
    : "Code sent. Enter SMS code and a new password.";
  msg.classList.add("auth-msg-ok");
};

document.getElementById("btnForgotReset").onclick = async () => {
  const msg = document.getElementById("forgotMsg");
  msg.classList.remove("auth-msg-ok");
  const code = document.getElementById("forgotOtp").value;
  const password = document.getElementById("forgotPassword").value;
  const res = await auth.confirmPasswordReset(code, password);
  if (!res.ok) {
    msg.textContent = authFailureMessage(res, "Could not reset password.");
    return;
  }
  resumeAudio();
  await enterAppAfterAuth();
};

document.getElementById("btnLinkPhoneConfirm").onclick = async () => {
  const msg = document.getElementById("linkPhoneMsg");
  msg.classList.remove("auth-msg-ok");
  const res = await auth.confirmPhoneLink(document.getElementById("linkPhoneOtp").value);
  if (!res.ok) {
    msg.textContent = authFailureMessage(res, "Could not verify mobile.");
    return;
  }
  resumeAudio();
  await enterAppAfterAuth();
};

document.getElementById("btnLinkPhoneSkip").onclick = async () => {
  auth.skipPhoneLink();
  resumeAudio();
  await enterAppAfterAuth();
};

document.getElementById("btnAuthGoogle").onclick = async () => {
  const msg = document.getElementById("authMsg");
  msg.textContent = "";
  const res = await auth.loginWithGoogle();
  if (!res.ok) {
    msg.textContent = authFailureMessage(res, "Google sign-in failed.");
    return;
  }
  resumeAudio();
  await enterAppAfterAuth();
};

document.getElementById("btnAuthGuest").onclick = async () => {
  const msg = document.getElementById("authMsg");
  const res = await auth.continueAsGuest();
  if (!res.ok) {
    msg.textContent = authFailureMessage(res, "Could not start guest session.");
    return;
  }
  resumeAudio();
  await enterAppAfterAuth();
};

document.getElementById("btnProfileLogout").onclick = logoutToAuth;
document.getElementById("btnSettingsLogout").onclick = logoutToAuth;

initAudio();
showHud(false);
applyThemeToDom(currentTheme);

(async () => {
  const modeEl = document.getElementById("authBackend");
  if (modeEl) {
    modeEl.textContent = isFirebaseConfigured()
      ? "FIREBASE CLOUD SAVE"
      : "LOCAL SAVE (add Firebase env to enable cloud)";
  }
  const hasSession = await auth.init();
  if (hasSession) {
    await pullCloudSave();
    loadUserData();
    goHome();
  } else {
    openAuth();
  }
})();

last = performance.now();
animId = requestAnimationFrame(loop);

export {};
