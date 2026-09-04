import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInAnonymously,
  signInWithPopup,
  signInWithPhoneNumber,
  linkWithPhoneNumber,
  GoogleAuthProvider,
  RecaptchaVerifier,
  updatePassword,
  updateProfile,
  signOut,
} from "firebase/auth";
import { getFirebaseAuth, isFirebaseConfigured, firebaseConfigStatus } from "./firebase.js";
import { setActiveUserId, migrateLegacyToGuest, userKey } from "./storage.js";

const googleProvider = new GoogleAuthProvider();
const AUTH_KEY = "space-survival-auth";

let recaptchaVerifier = null;
let phoneConfirmation = null;
let phoneLinkConfirmation = null;

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

function looksLikeEmail(value) {
  const v = String(value || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function authEmailFromIdentifier(identifier) {
  const raw = String(identifier || "").trim();
  if (looksLikeEmail(raw)) return raw.toLowerCase();
  const user = normalizeUsername(raw);
  const projectId =
    import.meta.env.VITE_FIREBASE_PROJECT_ID || "space-game-fc099";
  return `${user}@${projectId}.firebaseapp.com`;
}

function usernameFromIdentifier(identifier) {
  const raw = String(identifier || "").trim();
  if (looksLikeEmail(raw)) {
    return normalizeUsername(raw.split("@")[0]) || "pilot";
  }
  return normalizeUsername(raw);
}

/** Normalize to E.164-ish: digits with leading + */
function normalizePhone(phone) {
  const raw = String(phone || "").trim().replace(/[\s\-()]/g, "");
  if (!raw) return "";
  if (raw.startsWith("+")) {
    const digits = raw.slice(1).replace(/\D/g, "");
    return digits.length >= 10 ? `+${digits}` : "";
  }
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length > 10) return `+${digits}`;
  return "";
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
    return "credentials";
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
  if (code === "auth/invalid-phone-number") return "phone";
  if (code === "auth/missing-phone-number") return "phone";
  if (code === "auth/invalid-verification-code" || code === "auth/code-expired") {
    return "otp";
  }
  if (code === "auth/credential-already-in-use") return "phone-in-use";
  if (msg.includes("INVALID_LOGIN_CREDENTIALS")) return "credentials";
  return "firebase";
}

function displayNameFromUser(user, fallback = "Pilot") {
  if (user?.displayName) return user.displayName;
  if (user?.isAnonymous) return "Guest";
  const email = user?.email || "";
  const fromEmail = email.split("@")[0];
  return fromEmail || fallback;
}

function clearPhoneFlow() {
  phoneConfirmation = null;
  phoneLinkConfirmation = null;
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

  ensureRecaptcha(containerId = "recaptcha-container") {
    if (!isFirebaseConfigured()) return null;
    const fa = getFirebaseAuth();
    if (recaptchaVerifier) return recaptchaVerifier;
    recaptchaVerifier = new RecaptchaVerifier(fa, containerId, {
      size: "invisible",
    });
    return recaptchaVerifier;
  },

  resetRecaptcha() {
    try {
      recaptchaVerifier?.clear();
    } catch {
      /* ignore */
    }
    recaptchaVerifier = null;
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

  async register(username, password, phone = "") {
    const display = usernameFromIdentifier(username);
    if (display.length < 3) return { ok: false, reason: "username" };
    if (!password || password.length < 6) return { ok: false, reason: "password" };
    const phoneE164 = normalizePhone(phone);

    if (isFirebaseConfigured()) {
      try {
        const fa = getFirebaseAuth();
        const email = authEmailFromIdentifier(username);
        const cred = await createUserWithEmailAndPassword(fa, email, password);
        await updateProfile(cred.user, { displayName: display });
        this.applySession({
          userId: cred.user.uid,
          username: display,
          isGuest: false,
          backend: "firebase",
        });

        if (phoneE164) {
          const verifier = this.ensureRecaptcha();
          phoneLinkConfirmation = await linkWithPhoneNumber(
            cred.user,
            phoneE164,
            verifier,
          );
          return { ok: true, needsPhoneOtp: true, phone: phoneE164 };
        }

        return { ok: true };
      } catch (err) {
        console.warn("Firebase register failed:", err?.code, err?.message);
        this.resetRecaptcha();
        return {
          ok: false,
          reason: mapFirebaseError(err?.code, err?.message),
          detail: err?.code || err?.message || "",
        };
      }
    }

    const db = loadAuthDb();
    const key = display;
    if (db.accounts[key]) return { ok: false, reason: "exists" };
    if (phoneE164 && Object.values(db.accounts).some((a) => a.phone === phoneE164)) {
      return { ok: false, reason: "phone-in-use" };
    }
    const salt = randomSalt();
    const hash = await hashPassword(password, salt);
    db.accounts[key] = {
      salt,
      hash,
      phone: phoneE164 || null,
      createdAt: Date.now(),
    };
    const session = {
      userId: `user_${key}`,
      username: key,
      isGuest: false,
      backend: "local",
    };
    db.session = session;
    saveAuthDb(db);
    this.applySession(session);
    return { ok: true };
  },

  async confirmPhoneLink(code) {
    if (!phoneLinkConfirmation) return { ok: false, reason: "otp" };
    try {
      await phoneLinkConfirmation.confirm(String(code || "").trim());
      clearPhoneFlow();
      return { ok: true };
    } catch (err) {
      console.warn("Phone link confirm failed:", err?.code, err?.message);
      return {
        ok: false,
        reason: mapFirebaseError(err?.code, err?.message),
        detail: err?.code || err?.message || "",
      };
    }
  },

  skipPhoneLink() {
    clearPhoneFlow();
    this.resetRecaptcha();
    return { ok: true };
  },

  async login(username, password) {
    const display = usernameFromIdentifier(username);
    if (!display || display.length < 2) return { ok: false, reason: "username" };
    if (!password) return { ok: false, reason: "credentials" };

    if (isFirebaseConfigured()) {
      try {
        const fa = getFirebaseAuth();
        const email = authEmailFromIdentifier(username);
        const cred = await signInWithEmailAndPassword(fa, email, password);
        this.applySession({
          userId: cred.user.uid,
          username: cred.user.displayName || display,
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
    const account = db.accounts[display];
    if (!account) return { ok: false, reason: "missing" };
    const hash = await hashPassword(password, account.salt);
    if (hash !== account.hash) return { ok: false, reason: "credentials" };
    const session = {
      userId: `user_${display}`,
      username: display,
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

  async sendPasswordResetOtp(phone) {
    const phoneE164 = normalizePhone(phone);
    if (!phoneE164) return { ok: false, reason: "phone" };

    if (isFirebaseConfigured()) {
      try {
        this.resetRecaptcha();
        const fa = getFirebaseAuth();
        const verifier = this.ensureRecaptcha();
        phoneConfirmation = await signInWithPhoneNumber(fa, phoneE164, verifier);
        return { ok: true, phone: phoneE164 };
      } catch (err) {
        console.warn("Password reset OTP failed:", err?.code, err?.message);
        this.resetRecaptcha();
        return {
          ok: false,
          reason: mapFirebaseError(err?.code, err?.message),
          detail: err?.code || err?.message || "",
        };
      }
    }

    const db = loadAuthDb();
    const match = Object.entries(db.accounts).find(
      ([, a]) => a.phone && a.phone === phoneE164,
    );
    if (!match) return { ok: false, reason: "missing" };
    phoneConfirmation = { localUser: match[0], phone: phoneE164 };
    return { ok: true, phone: phoneE164, localDemoOtp: "123456" };
  },

  async confirmPasswordReset(code, newPassword) {
    if (!newPassword || newPassword.length < 6) {
      return { ok: false, reason: "password" };
    }
    if (!phoneConfirmation) return { ok: false, reason: "otp" };

    if (isFirebaseConfigured() && phoneConfirmation.confirm) {
      try {
        const result = await phoneConfirmation.confirm(String(code || "").trim());
        const user = result.user;
        const providers = user.providerData.map((p) => p.providerId);
        if (!providers.includes("password") && !user.email) {
          clearPhoneFlow();
          await signOut(getFirebaseAuth());
          this.clearSessionLocal();
          return { ok: false, reason: "phone-not-linked" };
        }
        await updatePassword(user, newPassword);
        this.applySession({
          userId: user.uid,
          username: displayNameFromUser(user),
          isGuest: false,
          backend: "firebase",
        });
        clearPhoneFlow();
        this.resetRecaptcha();
        return { ok: true };
      } catch (err) {
        console.warn("Password reset confirm failed:", err?.code, err?.message);
        return {
          ok: false,
          reason: mapFirebaseError(err?.code, err?.message),
          detail: err?.code || err?.message || "",
        };
      }
    }

    // Local fallback: demo OTP 123456
    if (phoneConfirmation.localUser) {
      if (String(code || "").trim() !== "123456") {
        return { ok: false, reason: "otp" };
      }
      const db = loadAuthDb();
      const key = phoneConfirmation.localUser;
      const account = db.accounts[key];
      if (!account) return { ok: false, reason: "missing" };
      const salt = randomSalt();
      account.salt = salt;
      account.hash = await hashPassword(newPassword, salt);
      const session = {
        userId: `user_${key}`,
        username: key,
        isGuest: false,
        backend: "local",
      };
      db.session = session;
      saveAuthDb(db);
      this.applySession(session);
      clearPhoneFlow();
      return { ok: true };
    }

    return { ok: false, reason: "otp" };
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
    clearPhoneFlow();
    this.resetRecaptcha();
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

export { userKey, normalizePhone };
