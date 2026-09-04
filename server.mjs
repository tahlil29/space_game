import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleApplyOtpPasswordRequest, isPasswordResetAdminReady } from "./passwordReset.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");
const port = Number(process.env.PORT || 43127);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".json": "application/json",
  ".ico": "image/x-icon",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
};

function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  res.statusCode = 200;
  res.setHeader("Content-Type", MIME[ext] || "application/octet-stream");
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (url.pathname === "/api/apply-otp-password") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    await handleApplyOtpPasswordRequest(req, res);
    return;
  }

  if (url.pathname === "/api/health") {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        ok: true,
        passwordResetAdmin: isPasswordResetAdminReady(),
      }),
    );
    return;
  }

  let rel = decodeURIComponent(url.pathname);
  if (rel === "/") rel = "/index.html";
  const filePath = path.join(dist, rel);
  const safePath = path.normalize(filePath);
  if (!safePath.startsWith(dist)) {
    res.statusCode = 403;
    res.end("Forbidden");
    return;
  }

  if (fs.existsSync(safePath) && fs.statSync(safePath).isFile()) {
    sendFile(res, safePath);
    return;
  }

  // SPA fallback
  const index = path.join(dist, "index.html");
  if (fs.existsSync(index)) {
    sendFile(res, index);
    return;
  }

  res.statusCode = 404;
  res.end("Not found. Run npm run build first.");
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Space Survival listening on http://0.0.0.0:${port}`);
  console.log(
    `Password reset admin: ${isPasswordResetAdminReady() ? "ready" : "missing FIREBASE_SERVICE_ACCOUNT_JSON"}`,
  );
});
