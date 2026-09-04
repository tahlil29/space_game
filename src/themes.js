/** Visual themes per game mode — Stage 3 */

export const THEMES = {
  classic: {
    id: "classic",
    bg: "#02030a",
    bgMid: "#0a1835",
    star: "#e8f4ff",
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
    menuGlow: "rgba(26, 53, 111, 0.67)",
    dangerGlow: "rgba(74, 16, 40, 0.67)",
    trail: "#5eb8ff",
    ambience: ["#7bc8ff", "#9b7bff", "#66e0ff"],
  },
  endless: {
    id: "endless",
    bg: "#08010f",
    bgMid: "#1a0830",
    star: "#f0d9ff",
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
    bg: "#0a0402",
    bgMid: "#2a1008",
    star: "#ffe8d6",
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

/** Apply CSS custom properties for menus / HUD chrome. */
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
