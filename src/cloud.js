import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { getFirebaseDb, isFirebaseConfigured } from "./firebase.js";
import { auth } from "./auth.js";
import { userKey } from "./storage.js";

let pushTimer = null;
let pendingUid = null;

function userDocRef(uid = auth.userId) {
  const db = getFirebaseDb();
  if (!db || !uid) return null;
  if (auth.backend !== "firebase") return null;
  return doc(db, "users", uid);
}

export async function pullCloudSave() {
  if (!isFirebaseConfigured() || auth.backend !== "firebase" || !auth.userId) {
    return false;
  }
  const ref = userDocRef();
  if (!ref) return false;
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await pushCloudSave(true);
      return false;
    }
    const data = snap.data() || {};
    if (data.shop) localStorage.setItem(userKey("shop"), JSON.stringify(data.shop));
    if (data.progress) {
      localStorage.setItem(userKey("progress"), JSON.stringify(data.progress));
    }
    if (data.settings) {
      localStorage.setItem(userKey("settings"), JSON.stringify(data.settings));
    }
    if (typeof data.lastScore === "number") {
      localStorage.setItem(userKey("last-score"), String(data.lastScore));
    }
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
