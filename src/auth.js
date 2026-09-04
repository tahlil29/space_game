import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInAnonymously,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  updateProfile,
} from "firebase/auth";
import { getFirebaseAuth, isFirebaseConfigured, firebaseConfigStatus } from "./firebase.js";
import { setActiveUserId, migrateLegacyToGuest, userKey } from "./storage.js";

const googleProvider = new GoogleAuthProvider();

const AUTH_KEY = "space-survival-auth";

function loadAuthDb() {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return { accounts: {}, session: null };
    const data = JSON.parse(raw);
    return {
      accounts: data.accounts && typeof data.accounts === "object" ? data.accounts : {},
      session: data.session || null,
    };
  } catch {
    return { accounts: {}, session: null };
  }
}

function saveAuthDb(db) {
  localStorage.setItem(
    AUTH_KEY,
    JSON.stringify({
      accounts: db.accounts,
      session: db.session,
    }),
  );
}

function randomSalt() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hashPassword(password, salt) {
  const data = new TextEncoder().encode(`${salt}:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function normalizeUsername(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_\-]/g, "")
    .slice(0, 20);
}

function usernameToEmail(username) {
  const user = normalizeUsername(username);
  const projectId =
    import.meta.env.VITE_FIREBASE_PROJECT_ID || "space-game-fc099";
  // Firebase rejects .local — use the project auth domain style address
  return `${user}@${projectId}.firebaseapp.com`;
}

function mapFirebaseError(code, message = "") {
  const msg = String(message || "");
  if (
    code === "auth/configuration-not-found" ||
    msg.includes("CONFIGURATION_NOT_FOUND")
  ) {
    return "firebase-not-started";
  }
  if (code === "auth/email-already-in-use") return "exists";
  if (code === "auth/invalid-email") return "username";
  if (code === "auth/weak-password" || code === "auth/invalid-password") {
    return "password";
  }
  if (code === "auth/user-not-found") return "missing";
  if (code === "auth/wrong-password" || code === "auth/invalid-credential") {
    return "password";
  }
  if (code === "auth/operation-not-allowed") return "firebase-disabled";
  if (code === "auth/network-request-failed") return "network";
  if (code === "auth/unauthorized-domain") return "domain";
  if (code === "auth/too-many-requests") return "rate";
  if (code === "auth/admin-restricted-operation") return "firebase-disabled";
  if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
    return "popup-closed";
  }
  if (code === "auth/popup-blocked") return "popup-blocked";
  if (code === "auth/account-exists-with-different-credential") {
    return "account-exists";
  }
  return "firebase";
}

function displayNameFromUser(user, fallback = "Pilot") {
  if (user?.displayName) return user.displayName;
  if (user?.isAnonymous) return "Guest";
  const email = user?.email || "";
  const fromEmail = email.split("@")[0];
  return fromEmail || fallback;
}

export const auth = {
  userId: null,
  username: null,
  isGuest: true,
  backend: "local",

  mode() {
    return firebaseConfigStatus();
  },

  applySession(session) {
    this.userId = session.userId;
    this.username = session.username;
    this.isGuest = Boolean(session.isGuest);
    this.backend = session.backend || "local";
    setActiveUserId(this.userId);
  },

  clearSessionLocal() {
    this.userId = null;
    this.username = null;
    this.isGuest = true;
    this.backend = isFirebaseConfigured() ? "firebase" : "local";
    setActiveUserId("guest");
  },

  persistLocalSession(session) {
    const db = loadAuthDb();
    db.session = session;
    saveAuthDb(db);
    this.applySession(session);
  },

  async init() {
    migrateLegacyToGuest();
    if (isFirebaseConfigured()) {
      this.backend = "firebase";
      const fa = getFirebaseAuth();
      return await new Promise((resolve) => {
        const unsub = onAuthStateChanged(fa, (user) => {
          unsub();
          if (user) {
            this.applySession({
              userId: user.uid,
              username: displayNameFromUser(user),
              isGuest: Boolean(user.isAnonymous),
              backend: "firebase",
            });
            resolve(true);
          } else {
            this.clearSessionLocal();
            resolve(false);
          }
        });
      });
    }

    this.backend = "local";
    const db = loadAuthDb();
    if (db.session?.userId) {
      this.applySession({ ...db.session, backend: "local" });
      return true;
    }
    this.clearSessionLocal();
    return false;
  },

  async register(username, password) {
    const user = normalizeUsername(username);
    if (user.length < 3) return { ok: false, reason: "username" };
    if (!password || password.length < 6) return { ok: false, reason: "password" };

    if (isFirebaseConfigured()) {
      try {
        const fa = getFirebaseAuth();
        const cred = await createUserWithEmailAndPassword(
          fa,
          usernameToEmail(user),
          password,
        );
        await updateProfile(cred.user, { displayName: user });
        this.applySession({
          userId: cred.user.uid,
          username: user,
          isGuest: false,
          backend: "firebase",
        });
        return { ok: true };
      } catch (err) {
        console.warn("Firebase register failed:", err?.code, err?.message);
        return {
          ok: false,
          reason: mapFirebaseError(err?.code, err?.message),
          detail: err?.code || err?.message || "",
        };
      }
    }

    const db = loadAuthDb();
    if (db.accounts[user]) return { ok: false, reason: "exists" };
    const salt = randomSalt();
    const hash = await hashPassword(password, salt);
    db.accounts[user] = { salt, hash, createdAt: Date.now() };
    const session = {
      userId: `user_${user}`,
      username: user,
      isGuest: false,
      backend: "local",
    };
    db.session = session;
    saveAuthDb(db);
    this.applySession(session);
    return { ok: true };
  },

  async login(username, password) {
    const user = normalizeUsername(username);
    if (isFirebaseConfigured()) {
      try {
        const fa = getFirebaseAuth();
        const cred = await signInWithEmailAndPassword(
          fa,
          usernameToEmail(user),
          password,
        );
        this.applySession({
          userId: cred.user.uid,
          username: cred.user.displayName || user,
          isGuest: false,
          backend: "firebase",
        });
        return { ok: true };
      } catch (err) {
        console.warn("Firebase login failed:", err?.code, err?.message);
        return {
          ok: false,
          reason: mapFirebaseError(err?.code, err?.message),
          detail: err?.code || err?.message || "",
        };
      }
    }

    const db = loadAuthDb();
    const account = db.accounts[user];
    if (!account) return { ok: false, reason: "missing" };
    const hash = await hashPassword(password, account.salt);
    if (hash !== account.hash) return { ok: false, reason: "password" };
    const session = {
      userId: `user_${user}`,
      username: user,
      isGuest: false,
      backend: "local",
    };
    db.session = session;
    saveAuthDb(db);
    this.applySession(session);
    return { ok: true };
  },

  async loginWithGoogle() {
    if (!isFirebaseConfigured()) {
      return { ok: false, reason: "firebase-disabled" };
    }
    try {
      const fa = getFirebaseAuth();
      const cred = await signInWithPopup(fa, googleProvider);
      this.applySession({
        userId: cred.user.uid,
        username: displayNameFromUser(cred.user),
        isGuest: false,
        backend: "firebase",
      });
      return { ok: true };
    } catch (err) {
      console.warn("Firebase Google sign-in failed:", err?.code, err?.message);
      return {
        ok: false,
        reason: mapFirebaseError(err?.code, err?.message),
        detail: err?.code || err?.message || "",
      };
    }
  },

  async continueAsGuest() {
    if (isFirebaseConfigured()) {
      try {
        const fa = getFirebaseAuth();
        const cred = await signInAnonymously(fa);
        this.applySession({
          userId: cred.user.uid,
          username: "Guest",
          isGuest: true,
          backend: "firebase",
        });
        return { ok: true };
      } catch (err) {
        console.warn("Firebase guest failed:", err?.code, err?.message);
        return {
          ok: false,
          reason: mapFirebaseError(err?.code, err?.message),
          detail: err?.code || err?.message || "",
        };
      }
    }

    const session = {
      userId: "guest",
      username: "Guest",
      isGuest: true,
      backend: "local",
    };
    this.persistLocalSession(session);
    return { ok: true };
  },

  async logout() {
    if (isFirebaseConfigured()) {
      try {
        await signOut(getFirebaseAuth());
      } catch {
        /* ignore */
      }
    }
    const db = loadAuthDb();
    db.session = null;
    saveAuthDb(db);
    this.clearSessionLocal();
  },

  displayName() {
    if (!this.username) return "Pilot";
    if (this.isGuest) return "Guest";
    return this.username;
  },
};

export { userKey };
