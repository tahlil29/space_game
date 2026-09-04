/** Distinct space skies per mode */

export const THEMES = {
  classic: {
    id: "classic",
    /** Plain deep space — dark navy, sparse cool stars */
    bg: "#010208",
    bgMid: "#07122a",
    bgFar: "#000105",
    star: "#e8f4ff",
    starDensity: 1,
    nebula: null,
    planet: null,
    accent: "#7bc8ff",
    accentSoft: "#47aaff",
    player: "#d6f6ff",
    playerCore: "#47aaff",
    playerGlow: "#4bc8ff",
    bullet: "#86dcff",
    bulletGlow: "#3bbdff",
    xp: "#d0baff",
    xpGlow: "#9b7bff",
    enemy: {
      basic: "#ff5577",
      fast: "#ffdf6b",
      tank: "#ffb36b",
      boss: "#ff6b4a",
    },
    menuGlow: "rgba(20, 48, 100, 0.45)",
    dangerGlow: "rgba(74, 16, 40, 0.67)",
    trail: "#5eb8ff",
    ambience: ["#7bc8ff", "#9b7bff", "#66e0ff"],
  },
  endless: {
    id: "endless",
    /** Dense purple nebula void */
    bg: "#060010",
    bgMid: "#1c0638",
    bgFar: "#12041f",
    star: "#f5d9ff",
    starDensity: 1.6,
    nebula: [
      { x: 0.25, y: 0.3, r: 0.45, color: "rgba(140, 40, 200, 0.28)" },
      { x: 0.7, y: 0.55, r: 0.4, color: "rgba(90, 20, 160, 0.32)" },
      { x: 0.5, y: 0.15, r: 0.35, color: "rgba(200, 80, 220, 0.18)" },
    ],
    planet: null,
    accent: "#c77dff",
    accentSoft: "#a855f7",
    player: "#f3e8ff",
    playerCore: "#c084fc",
    playerGlow: "#d946ef",
    bullet: "#e9d5ff",
    bulletGlow: "#c084fc",
    xp: "#f0abfc",
    xpGlow: "#e879f9",
    enemy: {
      basic: "#e879f9",
      fast: "#f9a8d4",
      tank: "#c084fc",
      boss: "#f472b6",
    },
    menuGlow: "rgba(88, 28, 135, 0.55)",
    dangerGlow: "rgba(112, 26, 74, 0.7)",
    trail: "#e879f9",
    ambience: ["#c77dff", "#f0abfc", "#a855f7"],
  },
  boss: {
    id: "boss",
    /** War-zone space — ember sky + distant burning planet */
    bg: "#080201",
    bgMid: "#2a0c04",
    bgFar: "#140301",
    star: "#ffe6c8",
    starDensity: 0.85,
    nebula: [
      { x: 0.8, y: 0.2, r: 0.5, color: "rgba(220, 60, 20, 0.22)" },
      { x: 0.35, y: 0.7, r: 0.38, color: "rgba(160, 40, 10, 0.2)" },
    ],
    planet: {
      x: 0.82,
      y: 0.18,
      r: 0.14,
      fill: "#3a1208",
      rim: "#ff6a2a",
      glow: "rgba(255, 100, 30, 0.35)",
    },
    accent: "#ff8a5c",
    accentSoft: "#f97316",
    player: "#fff1e6",
    playerCore: "#fb923c",
    playerGlow: "#fdba74",
    bullet: "#fdba74",
    bulletGlow: "#f97316",
    xp: "#fde68a",
    xpGlow: "#fbbf24",
    enemy: {
      basic: "#f87171",
      fast: "#fbbf24",
      tank: "#fb923c",
      boss: "#ef4444",
    },
    menuGlow: "rgba(124, 45, 18, 0.55)",
    dangerGlow: "rgba(127, 29, 29, 0.75)",
    trail: "#fb923c",
    ambience: ["#ff8a5c", "#fbbf24", "#ef4444"],
  },
};

export function getTheme(modeId) {
  return THEMES[modeId] || THEMES.classic;
}

export function applyThemeToDom(theme) {
  const root = document.documentElement;
  root.style.setProperty("--theme-bg", theme.bg);
  root.style.setProperty("--theme-bg-mid", theme.bgMid);
  root.style.setProperty("--theme-accent", theme.accent);
  root.style.setProperty("--theme-accent-soft", theme.accentSoft);
  root.style.setProperty("--theme-menu-glow", theme.menuGlow);
  root.style.setProperty("--theme-danger-glow", theme.dangerGlow);
  document.body.style.background = theme.bg;
}

/** Draw mode-specific space backdrop onto a 2D canvas context. */
export function drawSpaceBackground(ctx, W, H, theme, stars, now) {
  const base = ctx.createRadialGradient(
    W * 0.5,
    H * 0.4,
    20,
    W * 0.5,
    H * 0.55,
    Math.max(W, H) * 0.85,
  );
  base.addColorStop(0, theme.bgMid);
  base.addColorStop(0.55, theme.bg);
  base.addColorStop(1, theme.bgFar || theme.bg);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);

  if (theme.nebula) {
    for (const cloud of theme.nebula) {
      const cx = cloud.x * W;
      const cy = cloud.y * H;
      const rr = cloud.r * Math.max(W, H);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr);
      g.addColorStop(0, cloud.color);
      g.addColorStop(1, "transparent");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
  }

  if (theme.planet) {
    const p = theme.planet;
    const px = p.x * W;
    const py = p.y * H;
    const pr = p.r * Math.min(W, H);
    const glow = ctx.createRadialGradient(px, py, pr * 0.4, px, py, pr * 2.2);
    glow.addColorStop(0, p.glow);
    glow.addColorStop(1, "transparent");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(px, py, pr * 2.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = p.fill;
    ctx.beginPath();
    ctx.arc(px, py, pr, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = p.rim;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(px, py, pr, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  for (const s of stars) {
    ctx.globalAlpha = 0.2 + 0.4 * Math.sin(s.t + now / (s.twinkle || 900));
    ctx.fillStyle = s.col || theme.star;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, 7);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}
