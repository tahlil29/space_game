/** User-scoped localStorage keys for auth sessions. */
let activeUserId = "guest";

export function setActiveUserId(userId) {
  activeUserId = userId || "guest";
}

export function getActiveUserId() {
  return activeUserId;
}

export function userKey(base) {
  return `space-survival:${activeUserId}:${base}`;
}

/** One-time copy of legacy unscoped keys into the guest profile. */
export function migrateLegacyToGuest() {
  const map = [
    ["space-survival-shop", "shop"],
    ["space-survival-progress", "progress"],
    ["space-survival-settings", "settings"],
    ["space-survival-last-score", "last-score"],
  ];
  for (const [legacy, base] of map) {
    const dest = `space-survival:guest:${base}`;
    if (localStorage.getItem(dest)) continue;
    const raw = localStorage.getItem(legacy);
    if (raw == null) continue;
    localStorage.setItem(dest, raw);
  }
}
