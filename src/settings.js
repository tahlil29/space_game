const STORAGE_KEY = "space-survival-settings";

export const settings = {
  music: true,
  vibration: true,
  settingsReturn: "home",

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (typeof saved.music === "boolean") this.music = saved.music;
      if (typeof saved.vibration === "boolean") this.vibration = saved.vibration;
    } catch {
      /* ignore corrupt storage */
    }
  },

  save() {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ music: this.music, vibration: this.vibration }),
    );
  },

  syncToggles() {
    const musicEl = document.getElementById("toggleMusic");
    const vibEl = document.getElementById("toggleVibration");
    if (musicEl) musicEl.checked = this.music;
    if (vibEl) vibEl.checked = this.vibration;
  },
};

export function vibrateHit() {
  if (!settings.vibration || !navigator.vibrate) return;
  navigator.vibrate(28);
}

export function vibrateBossKill() {
  if (!settings.vibration || !navigator.vibrate) return;
  navigator.vibrate([40, 25, 70]);
}
