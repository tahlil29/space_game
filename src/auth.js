import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  confirmPasswordReset,
  verifyPasswordResetCode,
  sendPasswordResetEmail,
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
const LOCAL_PW_PREFIX = "space-survival-pw:";
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

function saveLocalAuthPassword(email, password) {
  try {
    const mail = normalizeEmail(email);
    if (mail && password) localStorage.setItem(LOCAL_PW_PREFIX + mail, password);
  } catch {
    /* ignore */
  }
}

function loadLocalAuthPassword(email) {
  try {
    return localStorage.getItem(LOCAL_PW_PREFIX + normalizeEmail(email)) || "";
  } catch {
    return "";
  }
}

function clearLocalAuthPassword(email) {
  try {
    localStorage.removeItem(LOCAL_PW_PREFIX + normalizeEmail(email));
  } catch {
    /* ignore */
  }
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms)),
  ]);
}

function randomFirebasePassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function bytesToHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex) {
  const clean = String(hex || "");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

async function deriveAesKey(password, saltHex) {
  const base = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: hexToBytes(saltHex),
      iterations: 100000,
      hash: "SHA-256",
    },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Wrap the real Firebase Auth password with the player's chosen password. */
async function wrapFirebasePassword(firebasePassword, userPassword) {
  const wrapSalt = randomSalt();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(userPassword, wrapSalt);
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(firebasePassword),
  );
  return {
    wrapSalt,
    wrapIv: bytesToHex(iv),
    wrapped: bytesToHex(new Uint8Array(cipher)),
  };
}

async function unwrapFirebasePassword(cred, userPassword) {
  if (!cred?.wrapped || !cred?.wrapSalt || !cred?.wrapIv) return "";
  try {
    const key = await deriveAesKey(userPassword, cred.wrapSalt);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: hexToBytes(cred.wrapIv) },
      key,
      hexToBytes(cred.wrapped),
    );
    return new TextDecoder().decode(plain);
  } catch {
    return "";
  }
}

/** Persist recovery material. Local always; Firestore when reachable. */
async function rememberAuthSecret(email, password) {
  const mail = normalizeEmail(email);
  if (!mail || !password || password.length < 6) return;
  saveLocalAuthPassword(mail, password);
  if (!isFirebaseConfigured()) return;
  try {
    const db = getFirebaseDb();
    const fa = getFirebaseAuth();
    if (!db || !fa?.currentUser) return;
    await withTimeout(
      setDoc(doc(db, "authSecrets", emailDocKey(mail)), {
        email: mail,
        authPassword: password,
        updatedAt: Date.now(),
      }),
      4000,
    );
  } catch (err) {
    console.warn("authSecrets save skipped:", err?.message || err);
  }
}

/**
 * Write public credentials (login) + OTP-gated vault (reset).
 * Firebase Auth keeps `firebasePassword`; the player only ever types `userPassword`.
 */
async function writeVaultCredentials(email, firebasePassword, userPassword) {
  const mail = normalizeEmail(email);
  const db = getFirebaseDb();
  if (!db) throw new Error("no-db");
  const docKey = emailDocKey(mail);
  const passSalt = randomSalt();
  const passHash = await hashPassword(userPassword, passSalt);
  const wrapped = await wrapFirebasePassword(firebasePassword, userPassword);
  await withTimeout(
    Promise.all([
      setDoc(doc(db, "credentials", docKey), {
        email: mail,
        version: 2,
        passSalt,
        passHash,
        ...wrapped,
        updatedAt: Date.now(),
      }),
      setDoc(doc(db, "authVault", docKey), {
        email: mail,
        firebasePassword,
        updatedAt: Date.now(),
      }),
    ]),
    8000,
  );
  saveLocalAuthPassword(mail, userPassword);
}

async function readCredentials(email) {
  const db = getFirebaseDb();
  if (!db) return null;
  try {
    const snap = await withTimeout(
      getDoc(doc(db, "credentials", emailDocKey(email))),
      5000,
    );
    return snap.exists() ? snap.data() : null;
  } catch (err) {
    console.warn("credentials read skipped:", err?.message || err);
    return null;
  }
}

async function ensureOtpUnlock(email, otpHash) {
  const db = getFirebaseDb();
  if (!db) return;
  const mail = normalizeEmail(email);
  await withTimeout(
    setDoc(doc(db, "otpUnlocks", emailDocKey(mail)), {
      hash: otpHash,
      email: mail,
      expires: Date.now() + OTP_TTL_MS,
    }),
    4000,
  );
}

async function readAuthVault(email) {
  const db = getFirebaseDb();
  if (!db) return null;
  try {
    const snap = await withTimeout(
      getDoc(doc(db, "authVault", emailDocKey(email))),
      5000,
    );
    return snap.exists() ? snap.data() : null;
  } catch (err) {
    console.warn("authVault read skipped:", err?.message || err);
    return null;
  }
}

/**
 * OTP reset when a vault exists: re-wrap the same Firebase password with the new
 * player password. No Admin SDK and no old password required.
 */
async function resetPasswordViaVault(email, otpHash, newPassword) {
  const mail = normalizeEmail(email);
  const db = getFirebaseDb();
  if (!db) return { ok: false, reason: "missing-vault" };

  try {
    await ensureOtpUnlock(mail, otpHash);
  } catch (err) {
    console.warn("otp unlock skipped:", err?.message || err);
  }

  const vault = await readAuthVault(mail);
  const firebasePassword = String(vault?.firebasePassword || "");
  if (firebasePassword.length < 6) {
    return { ok: false, reason: "missing-vault" };
  }

  try {
    const passSalt = randomSalt();
    const passHash = await hashPassword(newPassword, passSalt);
    const wrapped = await wrapFirebasePassword(firebasePassword, newPassword);
    const docKey = emailDocKey(mail);
    await withTimeout(
      setDoc(doc(db, "credentials", docKey), {
        email: mail,
        version: 2,
        passSalt,
        passHash,
        ...wrapped,
        updatedAt: Date.now(),
      }),
      8000,
    );
    saveLocalAuthPassword(mail, newPassword);
    Promise.all([
      deleteDoc(doc(db, "passwordOtps", docKey)).catch(() => {}),
      deleteDoc(doc(db, "otpUnlocks", docKey)).catch(() => {}),
    ]).catch(() => {});
    return { ok: true };
  } catch (err) {
    console.warn("Vault password reset failed:", err?.message || err);
    return { ok: false, reason: "network", detail: err?.message || "" };
  }
}

/**
 * Legacy path: device/local secret or OTP-gated authSecrets → REST password update.
 */
async function updatePasswordViaStoredSecret(email, otpHash, newPassword) {
  const mail = normalizeEmail(email);
  const db = getFirebaseDb();
  const key = apiKey();
  if (!key) return { ok: false, reason: "missing-secret" };

  const docKey = emailDocKey(mail);

  let oldPassword = loadLocalAuthPassword(mail);

  if (!oldPassword && db) {
    try {
      await ensureOtpUnlock(mail, otpHash);
      const snap = await withTimeout(getDoc(doc(db, "authSecrets", docKey)), 4000);
      if (snap.exists()) {
        oldPassword = String(snap.data()?.authPassword || "");
      }
    } catch (err) {
      console.warn("authSecrets read skipped:", err?.message || err);
    }
  }

  if (!oldPassword || oldPassword.length < 6) {
    return { ok: false, reason: "missing-secret" };
  }

  try {
    const signInRes = await withTimeout(
      fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(key)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: mail,
            password: oldPassword,
            returnSecureToken: true,
          }),
        },
      ),
      10000,
    );
    const signInData = await signInRes.json();
    if (signInData.error || !signInData.idToken) {
      return {
        ok: false,
        reason: "missing-secret",
        detail: signInData.error?.message || "Stored password no longer valid",
      };
    }

    const updateRes = await withTimeout(
      fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:update?key=${encodeURIComponent(key)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            idToken: signInData.idToken,
            password: newPassword,
            returnSecureToken: true,
          }),
        },
      ),
      10000,
    );
    const updateData = await updateRes.json();
    if (updateData.error) {
      return {
        ok: false,
        reason: "firebase",
        detail: updateData.error?.message || "Could not update password",
      };
    }

    const newRefresh = updateData.refreshToken || signInData.refreshToken;
    if (newRefresh) {
      try {
        localStorage.setItem(REFRESH_PREFIX + mail, newRefresh);
      } catch {
        /* ignore */
      }
    }
    saveLocalAuthPassword(mail, newPassword);
    if (db) {
      Promise.all([
        deleteDoc(doc(db, "passwordOtps", docKey)).catch(() => {}),
        deleteDoc(doc(db, "otpUnlocks", docKey)).catch(() => {}),
        writeVaultCredentials(mail, newPassword, newPassword).catch(() =>
          rememberAuthSecret(mail, newPassword),
        ),
      ]).catch(() => {});
    }
    return { ok: true };
  } catch (err) {
    console.warn("Stored-secret password update failed:", err?.message || err);
    return {
      ok: false,
      reason: "network",
      detail: err?.message || "Could not update password",
    };
  }
}

/** Pull oobCode out of a pasted Firebase reset URL / query string. */
function extractOobCode(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  if (/^\d{6}$/.test(raw)) return raw;
  try {
    if (/oobCode=/i.test(raw)) {
      const asUrl = raw.includes("://")
        ? raw
        : `https://local.invalid/?${raw.replace(/^[?#]/, "")}`;
      const code = new URL(asUrl).searchParams.get("oobCode");
      if (code) return code;
    }
  } catch {
    /* ignore */
  }
  return raw;
}

async function sendFirebaseBackupReset(email) {
  const mail = normalizeEmail(email);
  const fa = getFirebaseAuth();
  if (!fa) return { ok: false };
  try {
    await withTimeout(sendPasswordResetEmail(fa, mail), 12000);
    return { ok: true };
  } catch (err) {
    console.warn("Backup reset email failed:", err?.code || err?.message || err);
    return { ok: false, detail: err?.message || "" };
  }
}

/** After a legacy password login/register, store vault so future OTP resets work. */
async function migrateLegacyToVault(user, email, userPassword) {
  const mail = normalizeEmail(email);
  if (!user || !mail || !userPassword) return;
  try {
    const existing = await readCredentials(mail);
    if (existing?.version === 2 && existing?.wrapped) return;
    // Legacy accounts use the player password as the Firebase password.
    // Do NOT rotate it here — only publish vault/credentials for OTP re-wrap.
    await writeVaultCredentials(mail, userPassword, userPassword);
  } catch (err) {
    console.warn("Vault migrate skipped:", err?.message || err);
    rememberAuthSecret(mail, userPassword).catch(() => {});
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
        // Create with the player password first so signup never depends on Firestore.
        // Vault migration runs in the background (enables cross-device OTP reset).
        const cred = await createUserWithEmailAndPassword(fa, mail, password);
        await updateProfile(cred.user, { displayName: display });
        saveRefreshToken(mail, cred.user);
        saveLocalAuthPassword(mail, password);
        rememberAuthSecret(mail, password).catch(() => {});
        migrateLegacyToVault(cred.user, mail, password).catch(() => {});
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
        let cred = null;

        // Vault accounts: unwrap real Firebase password from public credentials
        const credentials = await readCredentials(mail);
        if (credentials?.version === 2 && credentials?.wrapped) {
          const passHash = await hashPassword(password, credentials.passSalt || "");
          if (passHash !== credentials.passHash) {
            return { ok: false, reason: "credentials" };
          }
          const firebasePassword = await unwrapFirebasePassword(credentials, password);
          if (!firebasePassword) return { ok: false, reason: "credentials" };
          cred = await signInWithEmailAndPassword(fa, mail, firebasePassword);
        } else {
          // Legacy accounts (Firebase password === player password)
          cred = await signInWithEmailAndPassword(fa, mail, password);
          migrateLegacyToVault(cred.user, mail, password).catch(() => {});
        }

        saveRefreshToken(mail, cred.user);
        saveLocalAuthPassword(mail, password);
        rememberAuthSecret(mail, password).catch(() => {});
        let appliedPending = false;
        if (!(credentials?.version === 2 && credentials?.wrapped)) {
          appliedPending = await applyPendingPasswordIfNeeded(mail, cred.user);
        } else {
          clearPendingReset();
        }
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
              "That new password is not active yet. Use Forgot password → OTP to set it, then log in.",
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
    const code = extractOobCode(otp);
    if (!code) return { ok: false, reason: "otp" };

    // Long Firebase oobCode from email link (or pasted reset URL) → apply password directly
    if (isFirebaseConfigured() && code.length >= 20) {
      try {
        await verifyPasswordResetCode(getFirebaseAuth(), code);
        await confirmPasswordReset(getFirebaseAuth(), code, newPassword);
        clearPendingReset();
        clearOtpRecord();
        saveLocalAuthPassword(mail, newPassword);
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
          const snap = await withTimeout(
            getDoc(doc(db, "passwordOtps", emailDocKey(mail))),
            4000,
          );
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
      // 1) Vault accounts — re-wrap Firebase password (no Admin, no old password)
      const viaVault = await resetPasswordViaVault(mail, expectHash, newPassword);
      if (viaVault.ok) {
        clearOtpRecord();
        clearPendingReset();
        return { ok: true, needLogin: true };
      }

      // 2) Legacy device/local secret → REST password update
      const viaSecret = await updatePasswordViaStoredSecret(mail, expectHash, newPassword);
      if (viaSecret.ok) {
        clearOtpRecord();
        clearPendingReset();
        return { ok: true, needLogin: true };
      }

      // 3) Same-device refresh token
      const updated = await updateFirebasePasswordWithRefresh(mail, newPassword).catch(
        () => false,
      );
      if (updated) {
        clearOtpRecord();
        clearPendingReset();
        saveLocalAuthPassword(mail, newPassword);
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

      // 4) Server Admin API
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
          saveLocalAuthPassword(mail, newPassword);
          return { ok: true, needLogin: true };
        }
        if (data?.reason === "otp") return { ok: false, reason: "otp", detail: data.detail };
        if (data?.reason === "missing") return { ok: false, reason: "missing" };
      } catch (err) {
        console.warn("Password reset API failed:", err?.message || err);
      }

      // 5) Emergency: email a Firebase reset link; user pastes oobCode into the OTP field
      const backup = await sendFirebaseBackupReset(mail);
      return {
        ok: false,
        reason: "need-backup",
        emailedBackup: Boolean(backup.ok),
        detail: backup.ok
          ? "This account needs a backup reset email. Check your inbox for the Firebase link, paste the full link (or oobCode) into Email code, then set your new password."
          : "Could not update password for this older account. Add FIREBASE_SERVICE_ACCOUNT_JSON (README), or open Forgot password again after logging in once.",
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

  async sendBackupResetEmail(email) {
    const mail = normalizeEmail(email);
    if (!isValidEmail(mail)) return { ok: false, reason: "email" };
    return sendFirebaseBackupReset(mail);
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
