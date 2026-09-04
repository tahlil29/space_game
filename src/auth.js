import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  confirmPasswordReset,
  verifyPasswordResetCode,
  signInAnonymously,
  signInWithPopup,
  GoogleAuthProvider,
  updateProfile,
  updatePassword,
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
const PENDING_RESET_TTL_MS = 60 * 60 * 1000;

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

function currentSiteHost() {
  try {
    return window.location.hostname || "localhost";
  } catch {
    return "localhost";
  }
}

/** Shown when Google sign-in fails with unauthorized-domain. */
export function unauthorizedDomainHint() {
  const host = currentSiteHost();
  return `This site (${host}) needs to be allowed for Google sign-in. Try again shortly or use email.`;
}

export function isEmailOtpConfigured() {
  return Boolean(
    import.meta.env.VITE_EMAILJS_SERVICE_ID &&
      import.meta.env.VITE_EMAILJS_TEMPLATE_ID &&
      import.meta.env.VITE_EMAILJS_PUBLIC_KEY,
  );
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
  if (!service || !template || !key) {
    return { ok: false, reason: "not-configured" };
  }
  try {
    const res = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service_id: service,
        template_id: template,
        user_id: key,
        template_params: {
          // EmailJS built-in OTP template uses passcode + time
          passcode: String(otp),
          otp: String(otp),
          code: String(otp),
          time: "15 minutes",
          email,
          to_email: email,
          user_email: email,
          app_name: "Space Survival",
          company_name: "Space Survival",
          message: `Your Space Survival code is ${otp}`,
        },
      }),
    });
    const text = (await res.text()).trim();
    if (!res.ok) {
      console.warn("EmailJS send failed:", res.status, text);
      return { ok: false, reason: "send-failed", detail: text || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    console.warn("EmailJS network error:", err);
    return { ok: false, reason: "network", detail: String(err?.message || err) };
  }
}

function savePendingReset(email, password) {
  const payload = JSON.stringify({
    email: normalizeEmail(email),
    password,
    at: Date.now(),
  });
  try {
    localStorage.setItem(PENDING_RESET_KEY, payload);
  } catch {
    /* ignore */
  }
  try {
    sessionStorage.setItem(PENDING_RESET_KEY, payload);
  } catch {
    /* ignore */
  }
}

function loadPendingReset() {
  try {
    const raw =
      localStorage.getItem(PENDING_RESET_KEY) ||
      sessionStorage.getItem(PENDING_RESET_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data?.password || Date.now() - (data.at || 0) > PENDING_RESET_TTL_MS) return null;
    return data;
  } catch {
    return null;
  }
}

function clearPendingReset() {
  try {
    localStorage.removeItem(PENDING_RESET_KEY);
  } catch {
    /* ignore */
  }
  try {
    sessionStorage.removeItem(PENDING_RESET_KEY);
  } catch {
    /* ignore */
  }
}

/** After a successful login, apply a pending OTP new-password if one exists. */
async function applyPendingPasswordIfNeeded(email, user) {
  const pending = loadPendingReset();
  const mail = normalizeEmail(email);
  if (!pending || pending.email !== mail || !pending.password || !user) return false;
  try {
    await updatePassword(user, pending.password);
    clearPendingReset();
    saveRefreshToken(mail, user);
    return true;
  } catch (err) {
    console.warn("Could not apply pending password:", err?.code || err?.message || err);
    return false;
  }
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
      8000,
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
      8000,
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
        const appliedPending = await applyPendingPasswordIfNeeded(mail, cred.user);
        this.applySession({
          userId: cred.user.uid,
          username: displayNameFromUser(cred.user, displayNameFromEmail(mail)),
          isGuest: false,
          backend: "firebase",
        });
        return { ok: true, passwordUpdated: appliedPending };
      } catch (err) {
        console.warn("Firebase login failed:", err?.code, err?.message);
        const pending = loadPendingReset();
        const typedNew =
          pending &&
          pending.email === mail &&
          pending.password === password;
        if (typedNew) {
          return {
            ok: false,
            reason: "pending-reset",
            detail:
              "That new password is not active yet. Open the reset link in your email, or log in once with your old password to activate it.",
          };
        }
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

      // OTP email only (EmailJS). No Firebase reset-link emails.
      let emailed = false;
      let emailDetail = "";
      try {
        const mailRes = await withTimeout(emailOtpViaEmailJs(mail, otp), 12000);
        emailed = Boolean(mailRes?.ok);
        if (!emailed) emailDetail = mailRes?.detail || mailRes?.reason || "";
      } catch {
        emailed = false;
        emailDetail = "timeout";
      }

      if (emailed) {
        return { ok: true, emailed: true };
      }
      return {
        ok: true,
        emailed: false,
        demoOtp: otp,
        emailConfigured: isEmailOtpConfigured(),
        emailDetail,
      };
    }

    const db = loadAuthDb();
    if (!db.accounts[mail]) return { ok: false, reason: "missing" };
    return { ok: true, emailed: false, demoOtp: otp, emailConfigured: false };
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
      // 1) Same-device refresh token (instant, no server)
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

      // 2) Server Admin API — sets Firebase password from OTP (no email link)
      try {
        const apiRes = await Promise.race([
          fetch("/api/apply-otp-password", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: mail, otp: code, newPassword }),
          }),
          new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 15000)),
        ]);
        const data = await apiRes.json().catch(() => ({}));
        if (apiRes.ok && data?.ok) {
          clearOtpRecord();
          clearPendingReset();
          return { ok: true, needLogin: true };
        }
        if (data?.reason === "otp") return { ok: false, reason: "otp", detail: data.detail };
        if (data?.reason === "missing") return { ok: false, reason: "missing" };
        if (data?.reason === "admin-missing" || apiRes.status === 404 || apiRes.status === 502) {
          return {
            ok: false,
            reason: "firebase",
            detail:
              "Password reset server is not set up yet. Add FIREBASE_SERVICE_ACCOUNT_JSON on the host (see README), then try again.",
          };
        }
        return {
          ok: false,
          reason: "firebase",
          detail: data?.detail || "Could not update password. Try again.",
        };
      } catch (err) {
        console.warn("Password reset API failed:", err?.message || err);
        return {
          ok: false,
          reason: "network",
          detail: "Could not reach password reset server. Try again.",
        };
      }
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
