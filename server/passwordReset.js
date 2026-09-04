import crypto from "node:crypto";
import admin from "firebase-admin";

let initAttempted = false;

function initAdmin() {
  if (admin.apps.length) return true;
  if (initAttempted) return admin.apps.length > 0;
  initAttempted = true;

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "";
  if (raw.trim()) {
    const cred = JSON.parse(raw);
    admin.initializeApp({
      credential: admin.credential.cert(cred),
      projectId: cred.project_id,
    });
    return true;
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    admin.initializeApp();
    return true;
  }

  return false;
}

export function isPasswordResetAdminReady() {
  try {
    return initAdmin();
  } catch (err) {
    console.warn("firebase-admin init failed:", err?.message || err);
    return false;
  }
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function emailDocKey(email) {
  const mail = normalizeEmail(email);
  const safe = mail.replace(/[^a-z0-9]/g, "_").slice(0, 48);
  return `${safe}_${mail.length}`;
}

function hashValue(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}

/**
 * Verify EmailJS/app OTP against Firestore, then set Firebase Auth password.
 * This is what makes "OTP → new password → login" work without a reset link.
 */
export async function applyOtpPasswordReset({ email, otp, newPassword }) {
  if (!isPasswordResetAdminReady()) {
    return {
      ok: false,
      reason: "admin-missing",
      detail: "Password reset server is not configured.",
    };
  }

  const mail = normalizeEmail(email);
  const code = String(otp || "").trim();
  const password = String(newPassword || "");

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) {
    return { ok: false, reason: "email" };
  }
  if (!/^\d{6}$/.test(code)) {
    return { ok: false, reason: "otp" };
  }
  if (password.length < 6) {
    return { ok: false, reason: "password" };
  }

  const db = admin.firestore();
  const ref = db.collection("passwordOtps").doc(emailDocKey(mail));
  const snap = await ref.get();
  if (!snap.exists) {
    return { ok: false, reason: "otp", detail: "Code expired. Request a new one." };
  }

  const data = snap.data() || {};
  const expect = hashValue(`${mail}:${code}`);
  if (data.hash !== expect) {
    return { ok: false, reason: "otp" };
  }
  if (data.expires && Date.now() > Number(data.expires)) {
    await ref.delete().catch(() => {});
    return { ok: false, reason: "otp", detail: "Code expired. Request a new one." };
  }

  let user;
  try {
    user = await admin.auth().getUserByEmail(mail);
  } catch {
    return { ok: false, reason: "missing", detail: "No account found for that email." };
  }

  await admin.auth().updateUser(user.uid, { password });
  await ref.delete().catch(() => {});

  return { ok: true, uid: user.uid };
}

export async function handleApplyOtpPasswordRequest(req, res) {
  res.setHeader("Content-Type", "application/json");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== "POST") {
    res.statusCode = 405;
    res.end(JSON.stringify({ ok: false, reason: "method" }));
    return;
  }

  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf8");
    const body = raw ? JSON.parse(raw) : {};
    const result = await applyOtpPasswordReset(body);
    res.statusCode = result.ok ? 200 : 400;
    res.end(JSON.stringify(result));
  } catch (err) {
    console.warn("apply-otp-password failed:", err);
    res.statusCode = 500;
    res.end(
      JSON.stringify({
        ok: false,
        reason: "server",
        detail: err?.message || "Server error",
      }),
    );
  }
}
