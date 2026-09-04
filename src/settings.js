import { userKey } from "./storage.js";

export const settings = {
  music: true,
  vibration: true,
  selectedMode: "classic",
  settingsReturn: "home",

  resetMemory() {
    this.music = true;
    this.vibration = true;
    this.selectedMode = "classic";
  },

  load() {
    this.resetMemory();
    try {
      const raw = localStorage.getItem(userKey("settings"));
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (typeof saved.music === "boolean") this.music = saved.music;
      if (typeof saved.vibration === "boolean") this.vibration = saved.vibration;
      if (typeof saved.selectedMode === "string") this.selectedMode = saved.selectedMode;
    } catch {
      /* ignore corrupt storage */
    }
  },

  save() {
    localStorage.setItem(
      userKey("settings"),
      JSON.stringify({
        music: this.music,
        vibration: this.vibration,
        selectedMode: this.selectedMode,
      }),
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
