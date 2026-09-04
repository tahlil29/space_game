import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { getFirebaseDb, isFirebaseConfigured } from "./firebase.js";
import { auth } from "./auth.js";
import { userKey } from "./storage.js";

let pushTimer = null;
let pendingUid = null;
let pullGeneration = 0;

function userDocRef(uid = auth.userId) {
  const db = getFirebaseDb();
  if (!db || !uid) return null;
  if (auth.backend !== "firebase") return null;
  return doc(db, "users", uid);
}

function readJson(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Prefer the richer local+cloud shop so a slow pull cannot wipe fresh purchases. */
export function mergeShopData(local, cloud) {
  if (!cloud && !local) return null;
  if (!cloud) return local;
  if (!local) return cloud;
  const owned = [...new Set([...(local.owned || []), ...(cloud.owned || [])])];
  const equipped = { ...(cloud.equipped || {}), ...(local.equipped || {}) };
  for (const key of ["ship", "enemy", "prop"]) {
    if (equipped[key] && !owned.includes(equipped[key])) {
      equipped[key] = cloud.equipped?.[key] || local.equipped?.[key];
    }
  }
  return {
    coins: Math.max(Number(local.coins) || 0, Number(cloud.coins) || 0),
    owned,
    equipped,
  };
}

export function mergeProgressData(local, cloud) {
  if (!cloud && !local) return null;
  if (!cloud) return local;
  if (!local) return cloud;
  const out = {
    classic: { unlocked: 1, stars: {}, bestScore: 0 },
    boss: { unlocked: 1, stars: {}, bestScore: 0 },
    endless: { bestScore: 0, bestWave: 0 },
  };
  for (const id of ["classic", "boss"]) {
    const a = local[id] || {};
    const b = cloud[id] || {};
    const stars = { ...(b.stars || {}) };
    for (const [k, v] of Object.entries(a.stars || {})) {
      stars[k] = Math.max(Number(stars[k]) || 0, Number(v) || 0);
    }
    out[id] = {
      unlocked: Math.max(Number(a.unlocked) || 1, Number(b.unlocked) || 1),
      stars,
      bestScore: Math.max(Number(a.bestScore) || 0, Number(b.bestScore) || 0),
    };
  }
  out.endless = {
    bestScore: Math.max(
      Number(local.endless?.bestScore) || 0,
      Number(cloud.endless?.bestScore) || 0,
    ),
    bestWave: Math.max(
      Number(local.endless?.bestWave) || 0,
      Number(cloud.endless?.bestWave) || 0,
    ),
  };
  return out;
}

/** Device settings win when both exist (music/vibration are local preferences). */
export function mergeSettingsData(local, cloud) {
  if (!cloud && !local) return null;
  if (!cloud) return local;
  if (!local) return cloud;
  return {
    music: typeof local.music === "boolean" ? local.music : cloud.music,
    vibration:
      typeof local.vibration === "boolean" ? local.vibration : cloud.vibration,
    selectedMode: local.selectedMode || cloud.selectedMode || "classic",
  };
}

export async function pullCloudSave() {
  if (!isFirebaseConfigured() || auth.backend !== "firebase" || !auth.userId) {
    return false;
  }
  const ref = userDocRef();
  if (!ref) return false;
  const gen = ++pullGeneration;
  const uid = auth.userId;
  try {
    const snap = await getDoc(ref);
    if (gen !== pullGeneration || auth.userId !== uid) return false;
    if (!snap.exists()) {
      await pushCloudSave(true);
      return false;
    }
    const data = snap.data() || {};
    const shopKey = userKey("shop");
    const progressKey = userKey("progress");
    const settingsKey = userKey("settings");
    const scoreKey = userKey("last-score");

    const mergedShop = mergeShopData(readJson(shopKey), data.shop || null);
    if (mergedShop) localStorage.setItem(shopKey, JSON.stringify(mergedShop));

    const mergedProgress = mergeProgressData(
      readJson(progressKey),
      data.progress || null,
    );
    if (mergedProgress) {
      localStorage.setItem(progressKey, JSON.stringify(mergedProgress));
    }

    const mergedSettings = mergeSettingsData(
      readJson(settingsKey),
      data.settings || null,
    );
    if (mergedSettings) {
      localStorage.setItem(settingsKey, JSON.stringify(mergedSettings));
    }

    const localScore = Number(localStorage.getItem(scoreKey) || 0);
    const cloudScore = typeof data.lastScore === "number" ? data.lastScore : 0;
    localStorage.setItem(scoreKey, String(Math.max(localScore, cloudScore)));
    return true;
  } catch (err) {
    console.warn("Firebase pull failed", err);
    return false;
  }
}

export async function pushCloudSave(immediate = false) {
  if (!isFirebaseConfigured() || auth.backend !== "firebase" || !auth.userId) {
    return;
  }
  const uidAtSchedule = auth.userId;
  pendingUid = uidAtSchedule;

  const run = async () => {
    const uid = pendingUid || auth.userId;
    if (!uid || auth.backend !== "firebase") return;
    const ref = userDocRef(uid);
    if (!ref) return;
    // Prefer keys for the uid we're writing (may differ if user switched mid-debounce)
    const keyFor = (base) => `space-survival:${uid}:${base}`;
    const shopRaw = localStorage.getItem(keyFor("shop"));
    const progressRaw = localStorage.getItem(keyFor("progress"));
    const settingsRaw = localStorage.getItem(keyFor("settings"));
    const lastScore = Number(localStorage.getItem(keyFor("last-score")) || 0);
    try {
      await setDoc(
        ref,
        {
          username: auth.username,
          isGuest: auth.isGuest,
          shop: shopRaw ? JSON.parse(shopRaw) : null,
          progress: progressRaw ? JSON.parse(progressRaw) : null,
          settings: settingsRaw ? JSON.parse(settingsRaw) : null,
          lastScore,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    } catch (err) {
      console.warn("Firebase push failed", err);
    }
  };

  if (immediate) {
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = null;
    await run();
    return;
  }
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    run();
  }, 450);
}

export function scheduleCloudPush() {
  pushCloudSave(false);
}
