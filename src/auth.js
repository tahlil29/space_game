import { setActiveUserId, migrateLegacyToGuest, userKey } from "./storage.js";

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

export const auth = {
  userId: null,
  username: null,
  isGuest: true,

  init() {
    migrateLegacyToGuest();
    const db = loadAuthDb();
    if (db.session?.userId) {
      this.applySession(db.session);
      return true;
    }
    this.clearSessionLocal();
    return false;
  },

  applySession(session) {
    this.userId = session.userId;
    this.username = session.username;
    this.isGuest = Boolean(session.isGuest);
    setActiveUserId(this.userId);
  },

  clearSessionLocal() {
    this.userId = null;
    this.username = null;
    this.isGuest = true;
    setActiveUserId("guest");
  },

  persistSession(session) {
    const db = loadAuthDb();
    db.session = session;
    saveAuthDb(db);
    this.applySession(session);
  },

  async register(username, password) {
    const user = normalizeUsername(username);
    if (user.length < 3) return { ok: false, reason: "username" };
    if (!password || password.length < 4) return { ok: false, reason: "password" };
    const db = loadAuthDb();
    if (db.accounts[user]) return { ok: false, reason: "exists" };
    const salt = randomSalt();
    const hash = await hashPassword(password, salt);
    db.accounts[user] = {
      salt,
      hash,
      createdAt: Date.now(),
    };
    const session = {
      userId: `user_${user}`,
      username: user,
      isGuest: false,
    };
    db.session = session;
    saveAuthDb(db);
    this.applySession(session);
    return { ok: true };
  },

  async login(username, password) {
    const user = normalizeUsername(username);
    const db = loadAuthDb();
    const account = db.accounts[user];
    if (!account) return { ok: false, reason: "missing" };
    const hash = await hashPassword(password, account.salt);
    if (hash !== account.hash) return { ok: false, reason: "password" };
    const session = {
      userId: `user_${user}`,
      username: user,
      isGuest: false,
    };
    db.session = session;
    saveAuthDb(db);
    this.applySession(session);
    return { ok: true };
  },

  continueAsGuest() {
    const session = {
      userId: "guest",
      username: "Guest",
      isGuest: true,
    };
    this.persistSession(session);
    return { ok: true };
  },

  logout() {
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
