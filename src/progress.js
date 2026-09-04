const PROGRESS_KEY = "space-survival-progress";
export const MAP_LEVEL_COUNT = 10;

function emptyModeProgress() {
  return {
    unlocked: 1,
    stars: {},
    bestScore: 0,
  };
}

export const progress = {
  classic: emptyModeProgress(),
  boss: emptyModeProgress(),
  endless: { bestScore: 0, bestWave: 0 },

  load() {
    try {
      const raw = localStorage.getItem(PROGRESS_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      for (const id of ["classic", "boss"]) {
        if (!saved[id]) continue;
        this[id].unlocked = Math.max(1, Math.min(MAP_LEVEL_COUNT, saved[id].unlocked || 1));
        this[id].stars = saved[id].stars || {};
        this[id].bestScore = saved[id].bestScore || 0;
      }
      if (saved.endless) {
        this.endless.bestScore = saved.endless.bestScore || 0;
        this.endless.bestWave = saved.endless.bestWave || 0;
      }
    } catch {
      /* ignore */
    }
  },

  save() {
    localStorage.setItem(
      PROGRESS_KEY,
      JSON.stringify({
        classic: this.classic,
        boss: this.boss,
        endless: this.endless,
      }),
    );
  },

  getUnlocked(modeId) {
    if (modeId === "endless") return MAP_LEVEL_COUNT;
    return this[modeId]?.unlocked || 1;
  },

  getStars(modeId, level) {
    return this[modeId]?.stars?.[String(level)] || 0;
  },

  /** Record a cleared campaign level and unlock the next. */
  recordLevelClear(modeId, level, starCount, score) {
    if (modeId === "endless") {
      this.endless.bestScore = Math.max(this.endless.bestScore, score);
      this.save();
      return;
    }
    const slot = this[modeId] || emptyModeProgress();
    const key = String(level);
    slot.stars[key] = Math.max(slot.stars[key] || 0, starCount);
    slot.unlocked = Math.max(slot.unlocked, Math.min(MAP_LEVEL_COUNT, level + 1));
    slot.bestScore = Math.max(slot.bestScore || 0, score);
    this[modeId] = slot;
    this.save();
  },

  recordEndlessRun(wave, score) {
    this.endless.bestWave = Math.max(this.endless.bestWave || 0, wave);
    this.endless.bestScore = Math.max(this.endless.bestScore || 0, score);
    this.save();
  },
};

/** Star rating for a cleared level. */
export function computeLevelStars({ hullRatio, ramHits }) {
  let stars = 1;
  if (hullRatio >= 0.5) stars = 2;
  if (hullRatio >= 0.5 && ramHits === 0) stars = 3;
  return stars;
}
