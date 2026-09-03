const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

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
let running;
let last;
let shootCD;
let dashCD;

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
  keys[e.key.toLowerCase()] = true;
  if (e.code === "Space") {
    e.preventDefault();
    mouse.down = true;
  }
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
  mouse.down = true;
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
    hitCD: 0,
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
}

function start() {
  reset();
  running = true;
  document.getElementById("overlay").classList.add("hidden");
  document.getElementById("hud").classList.remove("hidden");
  document.getElementById("healthWrap").classList.remove("hidden");
  document.getElementById("help").classList.remove("hidden");
  last = performance.now();
  requestAnimationFrame(loop);
}

document.getElementById("startBtn").onclick = start;

function spawnEnemy() {
  const type = Math.random();
  const kind = type < 0.62 ? "basic" : type < 0.85 ? "fast" : "tank";
  const r = kind === "basic" ? 16 : kind === "fast" ? 11 : 26;
  const hp = kind === "tank" ? 5 : kind === "fast" ? 1 : 2;
  const speed =
    kind === "basic"
      ? 78 + wave * 5
      : kind === "fast"
        ? 135 + wave * 6
        : 45 + wave * 3;
  const side = Math.floor(Math.random() * 4);
  let ex;
  let ey;
  if (side === 0) {
    ex = -40;
    ey = Math.random() * H;
  } else if (side === 1) {
    ex = W + 40;
    ey = Math.random() * H;
  } else if (side === 2) {
    ex = Math.random() * W;
    ey = -40;
  } else {
    ex = Math.random() * W;
    ey = H + 40;
  }
  enemies.push({
    x: ex,
    y: ey,
    r,
    hp,
    maxHp: hp,
    speed,
    kind,
    damage: kind === "tank" ? 22 : kind === "fast" ? 11 : 16,
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

function dash() {
  if (dashCD > 0) return;
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

addEventListener("keydown", (e) => {
  if (e.key === "Shift") dash();
});

/**
 * Apply contact damage correctly:
 * 1) Strength absorbs damage first (no simultaneous hull drain).
 * 2) Only overflow / empty strength damages hull.
 * 3) Cap total contact damage per frame so enemy piles don't melt both bars.
 * 4) Brief hit cooldown + knockback prevent continuous overlap spikes.
 */
function applyContactDamage(dt) {
  if (player.inv > 0 || player.hitCD > 0) return;

  let totalDamage = 0;
  const push = { x: 0, y: 0 };
  let hits = 0;

  for (const e of enemies) {
    const dx = player.x - e.x;
    const dy = player.y - e.y;
    const dist = Math.hypot(dx, dy) || 1;
    if (dist >= e.r + player.r) continue;

    // Contact DPS scaled by dt, then capped across all enemies
    totalDamage += e.damage * dt;
    push.x += dx / dist;
    push.y += dy / dist;
    hits++;
  }

  if (hits === 0) return;

  // Soft cap: even with a swarm, damage stays readable instead of a sudden cliff
  const capped = Math.min(totalDamage, 55 * dt + 8 * dt * Math.min(hits, 4));

  let remaining = capped;
  if (player.strength > 0) {
    const absorbed = Math.min(player.strength, remaining);
    player.strength -= absorbed;
    remaining -= absorbed;
  }

  if (remaining > 0) {
    // Hull takes remaining damage only after strength is gone
    player.hp -= remaining;
  }

  // Separate the ship from the pile so damage doesn't re-apply every frame
  const plen = Math.hypot(push.x, push.y) || 1;
  player.x = Math.max(
    player.r,
    Math.min(W - player.r, player.x + (push.x / plen) * 28),
  );
  player.y = Math.max(
    player.r,
    Math.min(H - player.r, player.y + (push.y / plen) * 28),
  );
  player.hitCD = 0.22;
  player.inv = 0.12;
  burst(player.x, player.y, 6, player.strength > 0 ? "#9b7bff" : "#ff5478");
}

function nextWave() {
  betweenWaves = true;
  running = false;
  const pool = [
    {
      icon: "DMG",
      name: "OVERCHARGE",
      desc: "+1 weapon damage",
      apply: () => {
        player.damage++;
      },
    },
    {
      icon: "SPD",
      name: "RAPID FIRE",
      desc: "18% faster firing",
      apply: () => {
        player.fireRate = Math.max(0.07, player.fireRate * 0.82);
      },
    },
    {
      icon: "FIX",
      name: "REPAIR",
      desc: "Restore 45 hull + 20 strength",
      apply: () => {
        player.hp = Math.min(player.maxHp, player.hp + 45);
        player.strength = Math.min(player.maxStrength, player.strength + 20);
      },
    },
    {
      icon: "HULL",
      name: "REINFORCE",
      desc: "+25 max hull + 15 max strength",
      apply: () => {
        player.maxHp += 25;
        player.hp += 25;
        player.maxStrength += 15;
        player.strength += 15;
      },
    },
    {
      icon: "ARM",
      name: "ARMOR CORE",
      desc: "+30 maximum strength",
      apply: () => {
        player.maxStrength += 30;
        player.strength += 30;
      },
    },
    {
      icon: "BOOST",
      name: "THRUST",
      desc: "+15% movement speed",
      apply: () => {
        player.speed *= 1.15;
      },
    },
  ];

  const picks = pool.sort(() => Math.random() - 0.5).slice(0, 3);
  const choices = document.getElementById("choices");
  choices.innerHTML = "";
  picks.forEach((u) => {
    const d = document.createElement("div");
    d.className = "choice";
    d.innerHTML = `<div class="icon">${u.icon}</div><h3>${u.name}</h3><p>${u.desc}</p>`;
    d.onclick = () => {
      u.apply();
      document.getElementById("upgrade").style.display = "none";
      wave++;
      enemiesToSpawn = 5 + wave * 3;
      spawned = 0;
      spawnTimer = 1.8;
      betweenWaves = false;
      running = true;
      last = performance.now();
      requestAnimationFrame(loop);
    };
    choices.appendChild(d);
  });
  document.getElementById("upgrade").style.display = "flex";
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
  player.hitCD -= dt;

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
    e.x += (dx / dist) * e.speed * dt;
    e.y += (dy / dist) * e.speed * dt;
  }

  applyContactDamage(dt);

  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    for (let j = bullets.length - 1; j >= 0; j--) {
      const b = bullets[j];
      if (Math.hypot(e.x - b.x, e.y - b.y) < e.r + b.r) {
        e.hp -= b.damage;
        bullets.splice(j, 1);
        burst(b.x, b.y, 3);
        if (e.hp <= 0) {
          score += e.kind === "tank" ? 30 : e.kind === "fast" ? 15 : 10;
          xp += e.kind === "tank" ? 4 : 1;
          addXP(e.x, e.y);
          burst(e.x, e.y, 14, e.kind === "tank" ? "#ffbd70" : "#8bdcff");
          enemies.splice(i, 1);
        }
        break;
      }
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
    nextWave();
  }

  document.getElementById("wave").textContent = String(wave);
  document.getElementById("enemyCount").textContent =
    `(${Math.max(0, enemiesToSpawn - spawned) + enemies.length} remaining)`;
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
      e.kind === "tank" ? "#ffb36b" : e.kind === "fast" ? "#ffdf6b" : "#ff5577";
    ctx.fillStyle = col;
    ctx.shadowBlur = 20;
    ctx.shadowColor = col;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      const r = i % 2 ? e.r * 0.7 : e.r;
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
    if (e.kind === "tank") {
      ctx.fillStyle = "#2a0d15";
      ctx.fillRect(-e.r, -e.r - 9, e.r * 2, 4);
      ctx.fillStyle = "#fff";
      ctx.fillRect(-e.r, -e.r - 9, e.r * 2 * (e.hp / e.maxHp), 4);
    }
    ctx.restore();
  }

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
  if (!running) return;
  const dt = Math.min((t - last) / 1000, 0.033);
  last = t;
  update(dt);
  draw();
  if (running) requestAnimationFrame(loop);
}

function gameOver() {
  running = false;
  document.getElementById("title").textContent = "MISSION FAILED";
  document.getElementById("subtitle").textContent =
    `You reached Wave ${wave} with a score of ${score}. Upgrade your ship and try again.`;
  document.getElementById("startBtn").textContent = "PLAY AGAIN";
  document.getElementById("overlay").classList.remove("hidden");
}
