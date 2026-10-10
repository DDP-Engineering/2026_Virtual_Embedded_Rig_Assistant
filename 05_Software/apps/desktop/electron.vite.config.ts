import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import type { Plugin } from "vite";
import { productionCsp } from "./src/main/content-policy.js";

const root = dirname(fileURLToPath(import.meta.url));
const testBuild = process.env.VERA_TEST === "1";

function developmentCsp(): Plugin {
  return {
    name: "vera-development-csp",
    apply: "serve",
    transformIndexHtml: {
      order: "post",
      handler(html) {
        const hashes = Array.from(
          html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g),
          (match) =>
            `'sha256-${createHash("sha256")
              .update(match[1] ?? "")
              .digest("base64")}'`,
        );
        const policy = productionCsp
          .replace("script-src 'self'", `script-src 'self' ${hashes.join(" ")}`)
          .replace("style-src 'self'", "style-src 'self' 'unsafe-inline'")
          .replace("connect-src 'none'", "connect-src 'self' ws://127.0.0.1:5173");
        return html.replace(productionCsp, policy);
      },
    },
  };
}

export default defineConfig(({ command }) => ({
  main: {
    define: { __VERA_TEST__: JSON.stringify(testBuild), __VERA_DEV__: JSON.stringify(command === "serve") },
    build: {
      rollupOptions: {
        input: {
          index: resolve(root, "src/main/index.ts"),
          "build-mode": resolve(root, "src/main/build-mode.ts"),
        },
        output: { format: "es", entryFileNames: "[name].js" },
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: resolve(root, "src/preload/index.ts"),
        output: { format: "cjs", entryFileNames: "index.cjs" },
      },
    },
  },
  renderer: {
    root: resolve(root, "src/renderer"),
    resolve: { alias: { "@": resolve(root, "src/renderer") } },
    server: { host: "127.0.0.1", port: 5173, strictPort: true },
    plugins: [react(), tailwindcss(), developmentCsp()],
    build: { rollupOptions: { input: resolve(root, "src/renderer/index.html") } },
  },
}));
