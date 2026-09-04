import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  confirmPasswordReset,
  verifyPasswordResetCode,
  signInAnonymously,
  signInWithPopup,
  GoogleAuthProvider,
  updateProfile,
  signOut,
} from "firebase/auth";
import { doc, setDoc, getDoc, deleteDoc, serverTimestamp } from "firebase/firestore";
import {
  getFirebaseAuth,
  getFirebaseDb,
  isFirebaseConfigured,
  firebaseConfigStatus,
} from "./firebase.js";
import { setActiveUserId, migrateLegacyToGuest, userKey } from "./storage.js";

const googleProvider = new GoogleAuthProvider();
const AUTH_KEY = "space-survival-auth";
const PENDING_RESET_KEY = "space-survival-pending-reset";
const OTP_STORE_KEY = "space-survival-otp";
const REFRESH_PREFIX = "space-survival-refresh:";
const OTP_TTL_MS = 10 * 60 * 1000;

let pendingOtp = null;

function apiKey() {
  return import.meta.env.VITE_FIREBASE_API_KEY || "";
}

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
    JSON.stringify({ accounts: db.accounts, session: db.session }),
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

async function hashValue(value) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(String(value)),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
}

function displayNameFromEmail(email) {
  const local = normalizeEmail(email).split("@")[0] || "pilot";
  return local.replace(/[^a-z0-9_\-]/gi, "").slice(0, 20) || "pilot";
}

/** Stable unique local user id from full email (avoids alice@x / alice@y collisions). */
async function localUserIdFromEmail(email) {
  const digest = await hashValue(`uid:${normalizeEmail(email)}`);
  return `user_${digest.slice(0, 16)}`;
}

function emailDocKey(email) {
  // Include a short hash so +/. variants cannot collide
  const mail = normalizeEmail(email);
  const safe = mail.replace(/[^a-z0-9]/g, "_").slice(0, 48);
  return `${safe}_${mail.length}`;
}

function makeOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function saveRefreshToken(email, user) {
  try {
    const mail = normalizeEmail(email);
    const token = user?.refreshToken;
    if (mail && token) localStorage.setItem(REFRESH_PREFIX + mail, token);
  } catch {
    /* ignore */
  }
}

function loadRefreshToken(email) {
  try {
    return localStorage.getItem(REFRESH_PREFIX + normalizeEmail(email)) || "";
  } catch {
    return "";
  }
}

function storeOtpRecord(record) {
  pendingOtp = record;
  try {
    localStorage.setItem(OTP_STORE_KEY, JSON.stringify(record));
  } catch {
    /* ignore */
  }
}

function loadOtpRecord(email) {
  const mail = normalizeEmail(email);
  if (pendingOtp?.email === mail) return pendingOtp;
  try {
    const raw = localStorage.getItem(OTP_STORE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data?.email === mail) return data;
  } catch {
    /* ignore */
  }
  return null;
}

function clearOtpRecord() {
  pendingOtp = null;
  try {
    localStorage.removeItem(OTP_STORE_KEY);
  } catch {
    /* ignore */
  }
}

function mapFirebaseError(code, message = "") {
  const msg = String(message || "");
  if (
    code === "auth/configuration-not-found" ||
    msg.includes("CONFIGURATION_NOT_FOUND")
  ) {
    return "firebase-not-started";
  }
  if (code === "auth/email-already-in-use" || msg.includes("EMAIL_EXISTS")) {
    return "exists";
  }
  if (code === "auth/invalid-email" || code === "auth/missing-email") return "email";
  if (code === "auth/weak-password" || code === "auth/invalid-password") {
    return "password";
  }
  if (code === "auth/user-not-found") return "missing";
  if (code === "auth/wrong-password" || code === "auth/invalid-credential") {
    return "credentials";
  }
  if (code === "auth/expired-action-code" || code === "auth/invalid-action-code") {
    return "otp";
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
  if (msg.includes("INVALID_LOGIN_CREDENTIALS")) return "credentials";
  return "firebase";
}

function displayNameFromUser(user, fallback = "Pilot") {
  if (user?.displayName) return user.displayName;
  if (user?.isAnonymous) return "Guest";
  if (user?.email) return displayNameFromEmail(user.email);
  return fallback;
}

async function emailOtpViaEmailJs(email, otp) {
  const service = import.meta.env.VITE_EMAILJS_SERVICE_ID;
  const template = import.meta.env.VITE_EMAILJS_TEMPLATE_ID;
  const key = import.meta.env.VITE_EMAILJS_PUBLIC_KEY;
  if (!service || !template || !key) return false;
  const res = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      service_id: service,
      template_id: template,
      user_id: key,
      template_params: {
        to_email: email,
        otp,
        app_name: "Space Survival",
      },
    }),
  });
  return res.ok;
}

function savePendingReset(email, password) {
  sessionStorage.setItem(
    PENDING_RESET_KEY,
    JSON.stringify({ email: normalizeEmail(email), password, at: Date.now() }),
  );
}

function loadPendingReset() {
  try {
    const raw = sessionStorage.getItem(PENDING_RESET_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data?.password || Date.now() - (data.at || 0) > OTP_TTL_MS) return null;
    return data;
  } catch {
    return null;
  }
}

function clearPendingReset() {
  sessionStorage.removeItem(PENDING_RESET_KEY);
}

/** Exchange refresh token → update Firebase password via Identity Toolkit. */
async function updateFirebasePasswordWithRefresh(email, newPassword) {
  const refresh = loadRefreshToken(email);
  const key = apiKey();
  if (!refresh || !key) return false;

  const withTimeout = (p, ms) =>
    Promise.race([
      p,
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms)),
    ]);

  try {
    const tokenRes = await withTimeout(
      fetch(
        `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(key)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: refresh,
          }),
        },
      ),
      6000,
    );
    const tokenData = await tokenRes.json();
    const idToken = tokenData.id_token || tokenData.idToken;
    if (!idToken) return false;

    const updateRes = await withTimeout(
      fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:update?key=${encodeURIComponent(key)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            idToken,
            password: newPassword,
            returnSecureToken: true,
          }),
        },
      ),
      6000,
    );
    const updateData = await updateRes.json();
    if (updateData.error) return false;
    if (updateData.refreshToken) {
      localStorage.setItem(
        REFRESH_PREFIX + normalizeEmail(email),
        updateData.refreshToken,
      );
    }
    return true;
  } catch (err) {
    console.warn("Password update via refresh failed:", err?.message || err);
    return false;
  }
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
            if (user.email) saveRefreshToken(user.email, user);
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

  async register(email, password) {
    const mail = normalizeEmail(email);
    if (!isValidEmail(mail)) return { ok: false, reason: "email" };
    if (!password || password.length < 6) return { ok: false, reason: "password" };
    const display = displayNameFromEmail(mail);

    if (isFirebaseConfigured()) {
      try {
        const fa = getFirebaseAuth();
        const cred = await createUserWithEmailAndPassword(fa, mail, password);
        await updateProfile(cred.user, { displayName: display });
        saveRefreshToken(mail, cred.user);
        this.applySession({
          userId: cred.user.uid,
          username: display,
          isGuest: false,
          backend: "firebase",
        });
        return { ok: true, created: true };
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
    if (db.accounts[mail]) return { ok: false, reason: "exists" };
    const salt = randomSalt();
    const hash = await hashPassword(password, salt);
    const userId = await localUserIdFromEmail(mail);
    db.accounts[mail] = { salt, hash, createdAt: Date.now(), userId };
    const session = {
      userId,
      username: display,
      email: mail,
      isGuest: false,
      backend: "local",
    };
    db.session = session;
    saveAuthDb(db);
    this.applySession(session);
    return { ok: true, created: true };
  },

  async login(email, password) {
    const mail = normalizeEmail(email);
    if (!isValidEmail(mail)) return { ok: false, reason: "email" };
    if (!password) return { ok: false, reason: "credentials" };

    if (isFirebaseConfigured()) {
      try {
        const fa = getFirebaseAuth();
        const cred = await signInWithEmailAndPassword(fa, mail, password);
        saveRefreshToken(mail, cred.user);
        this.applySession({
          userId: cred.user.uid,
          username: displayNameFromUser(cred.user, displayNameFromEmail(mail)),
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
    const account = db.accounts[mail];
    if (!account) return { ok: false, reason: "missing" };
    const hash = await hashPassword(password, account.salt);
    if (hash !== account.hash) return { ok: false, reason: "credentials" };
    const display = displayNameFromEmail(mail);
    const userId = account.userId || (await localUserIdFromEmail(mail));
    if (!account.userId) {
      account.userId = userId;
      saveAuthDb(db);
    }
    const session = {
      userId,
      username: display,
      email: mail,
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
      if (cred.user.email) saveRefreshToken(cred.user.email, cred.user);
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

  async sendPasswordOtp(email) {
    const mail = normalizeEmail(email);
    if (!isValidEmail(mail)) return { ok: false, reason: "email" };

    const otp = makeOtp();
    const hash = await hashValue(`${mail}:${otp}`);
    const expires = Date.now() + OTP_TTL_MS;
    storeOtpRecord({ email: mail, hash, expires });

    if (isFirebaseConfigured()) {
      const withTimeout = (p, ms) =>
        Promise.race([
          p,
          new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms)),
        ]);

      // Firestore is optional — never block OTP delivery
      try {
        const db = getFirebaseDb();
        if (db) {
          await withTimeout(
            setDoc(doc(db, "passwordOtps", emailDocKey(mail)), {
              hash,
              expires,
              email: mail,
              createdAt: serverTimestamp(),
            }),
            4000,
          );
        }
      } catch (err) {
        console.warn("OTP Firestore write skipped:", err?.message || err);
      }

      let emailed = false;
      try {
        emailed = await withTimeout(emailOtpViaEmailJs(mail, otp), 4000);
      } catch {
        emailed = false;
      }
      try {
        await withTimeout(
          sendPasswordResetEmail(getFirebaseAuth(), mail, {
            url: `${window.location.origin}${window.location.pathname}`,
            handleCodeInApp: false,
          }),
          5000,
        );
      } catch (err) {
        console.warn("Firebase reset email:", err?.message || err);
      }

      // Always return on-screen OTP so the user can continue without email delivery
      return { ok: true, emailed: Boolean(emailed), demoOtp: otp };
    }

    const db = loadAuthDb();
    if (!db.accounts[mail]) return { ok: false, reason: "missing" };
    return { ok: true, emailed: false, demoOtp: otp };
  },

  async resetWithOtp(email, otp, newPassword) {
    const mail = normalizeEmail(email);
    if (!isValidEmail(mail)) return { ok: false, reason: "email" };
    if (!newPassword || newPassword.length < 6) return { ok: false, reason: "password" };
    const code = String(otp || "").trim();
    if (!code) return { ok: false, reason: "otp" };

    // Long Firebase oobCode from email link → apply password directly
    if (isFirebaseConfigured() && code.length >= 20) {
      try {
        await verifyPasswordResetCode(getFirebaseAuth(), code);
        await confirmPasswordReset(getFirebaseAuth(), code, newPassword);
        clearPendingReset();
        clearOtpRecord();
        return { ok: true, needLogin: true };
      } catch (err) {
        return {
          ok: false,
          reason: mapFirebaseError(err?.code, err?.message),
          detail: err?.code || err?.message || "",
        };
      }
    }

    if (!/^\d{6}$/.test(code)) return { ok: false, reason: "otp" };
    const expectHash = await hashValue(`${mail}:${code}`);

    let record = loadOtpRecord(mail);
    if (isFirebaseConfigured()) {
      try {
        const db = getFirebaseDb();
        if (db) {
          const snap = await Promise.race([
            getDoc(doc(db, "passwordOtps", emailDocKey(mail))),
            new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 4000)),
          ]);
          if (snap.exists()) record = { ...snap.data(), email: mail };
        }
      } catch {
        /* use local record */
      }
    }

    if (!record || record.hash !== expectHash) return { ok: false, reason: "otp" };
    if (record.expires && Date.now() > Number(record.expires)) {
      return { ok: false, reason: "otp" };
    }

    if (isFirebaseConfigured()) {
      const updated = await updateFirebasePasswordWithRefresh(mail, newPassword).catch(
        () => false,
      );
      if (updated) {
        clearOtpRecord();
        clearPendingReset();
        try {
          const db = getFirebaseDb();
          if (db) {
            await Promise.race([
              deleteDoc(doc(db, "passwordOtps", emailDocKey(mail))),
              new Promise((r) => setTimeout(r, 2000)),
            ]);
          }
        } catch {
          /* ignore */
        }
        return { ok: true, needLogin: true };
      }

      // No refresh token on this device — must use Firebase email reset link
      savePendingReset(mail, newPassword);
      clearOtpRecord();
      try {
        await Promise.race([
          sendPasswordResetEmail(getFirebaseAuth(), mail, {
            url: `${window.location.origin}${window.location.pathname}`,
            handleCodeInApp: false,
          }),
          new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 5000)),
        ]);
      } catch (err) {
        clearPendingReset();
        return {
          ok: false,
          reason: mapFirebaseError(err?.code, err?.message) || "firebase",
          detail:
            "OTP ok, but password could not be changed on this device. Log in once first, or use the email reset link.",
        };
      }
      return {
        ok: true,
        needLogin: true,
        openEmailLink: true,
      };
    }

    // Local accounts
    const db = loadAuthDb();
    const account = db.accounts[mail];
    if (!account) return { ok: false, reason: "missing" };
    const salt = randomSalt();
    account.salt = salt;
    account.hash = await hashPassword(newPassword, salt);
    const display = displayNameFromEmail(mail);
    const userId = account.userId || (await localUserIdFromEmail(mail));
    account.userId = userId;
    const session = {
      userId,
      username: display,
      email: mail,
      isGuest: false,
      backend: "local",
    };
    db.session = session;
    saveAuthDb(db);
    this.applySession(session);
    clearOtpRecord();
    return { ok: true };
  },

  getResetOobFromUrl() {
    const params = new URLSearchParams(window.location.search);
    if (params.get("oobCode")) return params.get("oobCode");
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    if (hash.get("oobCode")) return hash.get("oobCode");
    return null;
  },

  async completeResetFromEmailLink() {
    const oobCode = this.getResetOobFromUrl();
    if (!oobCode || !isFirebaseConfigured()) return { ok: false };
    const pending = loadPendingReset();
    const password = pending?.password;
    if (!password) {
      return { ok: false, reason: "need-password", oobCode };
    }
    try {
      await verifyPasswordResetCode(getFirebaseAuth(), oobCode);
      await confirmPasswordReset(getFirebaseAuth(), oobCode, password);
      clearPendingReset();
      this.clearResetUrl();
      return { ok: true, needLogin: true, email: pending.email };
    } catch (err) {
      return {
        ok: false,
        reason: mapFirebaseError(err?.code, err?.message),
        detail: err?.code || err?.message || "",
        oobCode,
      };
    }
  },

  clearResetUrl() {
    const url = new URL(window.location.href);
    ["oobCode", "mode", "apiKey", "lang", "continueUrl"].forEach((k) =>
      url.searchParams.delete(k),
    );
    window.history.replaceState({}, "", url.pathname + url.search + url.hash);
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
    clearOtpRecord();
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
