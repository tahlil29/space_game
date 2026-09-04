import { defineConfig } from "vite";

export default defineConfig({
  base: "/",
  server: {
    host: "127.0.0.1",
    port: 43127,
  },
  preview: {
    host: "127.0.0.1",
    port: 43127,
  },
  build: {
    outDir: "dist",
    assetsDir: "assets",
    sourcemap: false,
  },
});
