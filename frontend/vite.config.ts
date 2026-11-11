import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

/**
 * Two pages:
 *   /        -> index.html  (static marketing page, built with the taste kit in public/assets)
 *   /app/*   -> app.html    (React app: auth, onboarding, workspace)
 * In dev, rewrite /app and /app/... to app.html so client-side routes survive a reload.
 */
function appFallback(): Plugin {
  return {
    name: "app-fallback",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const url = req.url ?? "";
        if (url === "/app" || (url.startsWith("/app/") && !url.includes("."))) {
          req.url = "/app.html";
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), appFallback()],
  build: {
    // the taste kit lives in public/assets, so keep bundles out of that folder
    assetsDir: "static",
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        app: resolve(__dirname, "app.html"),
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
});
