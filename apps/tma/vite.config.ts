import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";

function collectConfiguredConnectOrigins(env: Record<string, string | undefined>): string[] {
  const origins = new Set<string>();
  const urlKeys = [
    "VITE_API_BASE_URL",
    "VITE_STELLAR_RPC_URLS",
    "VITE_HORIZON_URLS",
    "VITE_FRIENDBOT_URL",
    "VITE_SEP42_ASSET_LIST_URLS",
    "VITE_ASTROWALLET_API_BASE_URL",
    "VITE_ASTROGATE_API_BASE_URL",
  ];
  for (const key of urlKeys) {
    const raw = env[key];
    if (!raw) continue;
    for (const part of raw.split(",")) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      try {
        origins.add(new URL(trimmed).origin);
      } catch {
        // Ignore invalid URL
      }
    }
  }
  return Array.from(origins).sort();
}

function cspConnectSrcPlugin(env: Record<string, string | undefined>): Plugin {
  return {
    name: "astrodex-csp-connect-src",
    closeBundle() {
      const origins = collectConfiguredConnectOrigins(env);
      if (origins.length === 0) return;
      const distHeaders = path.resolve(process.cwd(), "dist/_headers");
      if (!existsSync(distHeaders)) return;
      const raw = readFileSync(distHeaders, "utf8");
      const updated = raw.replace(
        "connect-src 'self' https:;",
        `connect-src 'self' ${origins.join(" ")};`,
      );
      writeFileSync(distHeaders, updated, "utf8");
    },
  };
}

export default defineConfig(({ mode }) => {
  const fileEnv = loadEnv(mode, process.cwd(), "VITE_");
  const combinedEnv = { ...fileEnv, ...process.env };
  return {
    plugins: [react(), cspConnectSrcPlugin(combinedEnv)],
    worker: {
      format: "es",
    },
    build: {
      target: "es2022",
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes("/node_modules/react/") || id.includes("/node_modules/react-dom/")) {
              return "vendor-react";
            }
            if (id.includes("@stellar/") || id.includes("stellar-base") || id.includes("js-xdr")) {
              return "vendor-stellar";
            }
            return undefined;
          },
        },
      },
    },
  };
});
