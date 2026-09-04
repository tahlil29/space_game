import { defineConfig, loadEnv } from "vite";
import { handleApplyOtpPasswordRequest } from "./server/passwordReset.js";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // Expose service account to Vite middleware (dev API) without bundling into client
  if (env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = env.FIREBASE_SERVICE_ACCOUNT_JSON;
  }

  return {
    base: "/",
    server: {
      host: "localhost",
      port: 43127,
    },
    preview: {
      host: "localhost",
      port: 43127,
    },
    build: {
      outDir: "dist",
      assetsDir: "assets",
      sourcemap: false,
    },
    plugins: [
      {
        name: "otp-password-api",
        configureServer(server) {
          server.middlewares.use(async (req, res, next) => {
            const pathOnly = (req.url || "").split("?")[0];
            if (pathOnly === "/api/health") {
              res.statusCode = 200;
              res.setHeader("Content-Type", "application/json");
              const { isPasswordResetAdminReady } = await import("./server/passwordReset.js");
              res.end(
                JSON.stringify({
                  ok: true,
                  passwordResetAdmin: isPasswordResetAdminReady(),
                }),
              );
              return;
            }
            if (pathOnly !== "/api/apply-otp-password") return next();
            res.setHeader("Access-Control-Allow-Origin", "*");
            res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
            res.setHeader("Access-Control-Allow-Headers", "Content-Type");
            await handleApplyOtpPasswordRequest(req, res);
          });
        },
      },
    ],
  };
});
