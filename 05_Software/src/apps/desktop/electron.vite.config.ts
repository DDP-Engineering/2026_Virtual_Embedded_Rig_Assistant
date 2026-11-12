import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import type { Plugin } from "vite";
// @ts-expect-error build helper is a Node ESM module.
import { pluginCatalogFeed, updateFeed } from "../../../scripts/update-config.mjs";
import { productionCsp } from "./src/main/content-policy.js";

const root = dirname(fileURLToPath(import.meta.url));
// Build-time isolation for verification; ordinary development and release output is unchanged.
const buildRoot = process.env.VERA_BUILD_ROOT ? resolve(process.env.VERA_BUILD_ROOT) : resolve(root, "out");
const shared = resolve(root, "../../libraries/shared/src/index.ts");
const testBuild = process.env.VERA_TEST === "1";
const sessionPerformance = testBuild && process.env.VERA_SESSION_PERF === "1";
const updateUrl = updateFeed(process.env.VERA_UPDATE_URL, testBuild);
const pluginCatalogUrl = pluginCatalogFeed(process.env.VERA_PLUGIN_CATALOG_URL, testBuild);

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
          .replace("connect-src 'self'", "connect-src 'self' ws://127.0.0.1:5173");
        return html.replace(productionCsp, policy);
      },
    },
  };
}

/** Pinned offline pdf.js resources: identical asset names in dev and production. */
function pdfResources(): Plugin {
  const base = resolve(root, "../../../node_modules/pdfjs-dist");
  const assets = ["cmaps", "standard_fonts", "wasm"].flatMap((directory) =>
    readdirSync(resolve(base, directory))
      .filter((file) => !file.startsWith("LICENSE"))
      .map((file) => ({
        name: `pdfjs/${directory}/${file}`,
        source: readFileSync(resolve(base, directory, file)),
      })),
  );
  return {
    name: "vera-pdf-resources",
    generateBundle() {
      for (const asset of assets)
        this.emitFile({ type: "asset", fileName: asset.name, source: asset.source });
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = request.url?.split("?")[0]?.slice(1);
        const asset = assets.find((a) => a.name === path);
        if (!asset) return next();
        response.setHeader(
          "Content-Type",
          asset.name.endsWith(".wasm") ? "application/wasm" : "application/octet-stream",
        );
        response.end(asset.source);
      });
    },
  };
}

export default defineConfig(({ command }) => ({
  main: {
    resolve: {
      alias: {
        "@vera/shared": shared,
        "@vera/core/grep-worker": resolve(root, "../../libraries/core/src/tools/grep-worker.ts"),
        "@vera/core/pdf-worker": resolve(root, "../../libraries/core/src/knowledge/pdf-worker.ts"),
        "@vera/core/embedding-worker": resolve(
          root,
          "../../libraries/core/src/knowledge/embedding-worker.ts",
        ),
        "@vera/core/replay": resolve(root, "../../libraries/core/src/llm/replay.ts"),
        "@vera/core": resolve(root, "../../libraries/core/src/index.ts"),
      },
    },
    define: {
      __VERA_TEST__: JSON.stringify(testBuild),
      __VERA_SESSION_PERF__: JSON.stringify(sessionPerformance),
      __VERA_DEV__: JSON.stringify(command === "serve"),
      __VERA_SIGNED__: JSON.stringify(process.env.VERA_SIGNED_BUILD === "1"),
      __VERA_UPDATE_URL__: JSON.stringify(updateUrl),
      __VERA_PLUGIN_CATALOG_URL__: JSON.stringify(pluginCatalogUrl),
    },
    build: {
      outDir: resolve(buildRoot, "main"),
      rollupOptions: {
        external: [
          "better-sqlite3",
          "@huggingface/transformers",
          "onnxruntime-node",
          "pdfjs-dist/legacy/build/pdf.mjs",
          "electron-updater",
        ],
        input: {
          index: resolve(root, "src/main/index.ts"),
          "build-mode": resolve(root, "src/main/build-mode.ts"),
          "grep-worker": resolve(root, "src/main/grep-worker.ts"),
          "plugin-list-worker": resolve(root, "src/main/plugin-list-worker.ts"),
          "pdf-worker": resolve(root, "src/main/pdf-worker.ts"),
          "document-embedding-worker": resolve(root, "src/main/document-embedding-worker.ts"),
          "indexer-process": resolve(root, "src/main/indexer-process.ts"),
          ...(testBuild
            ? { "embedding-worker": resolve(root, "src/main/packaging/embedding-worker.ts") }
            : {}),
        },
        output: { format: "es", entryFileNames: "[name].js", chunkFileNames: "[name].js" },
      },
    },
  },
  preload: {
    resolve: { alias: { "@vera/shared": shared } },
    build: {
      outDir: resolve(buildRoot, "preload"),
      rollupOptions: {
        input: resolve(root, "src/preload/index.ts"),
        output: { format: "cjs", entryFileNames: "index.cjs" },
      },
    },
  },
  renderer: {
    define: {
      __VERA_SESSION_PERF__: JSON.stringify(sessionPerformance),
      __VERA_VERSION__: JSON.stringify(
        JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).version,
      ),
    },
    root: resolve(root, "src/renderer"),
    resolve: { alias: { "@": resolve(root, "src/renderer"), "@vera/shared": shared } },
    server: { host: "127.0.0.1", port: 5173, strictPort: true },
    plugins: [react(), tailwindcss(), developmentCsp(), pdfResources()],
    build: {
      outDir: resolve(buildRoot, "renderer"),
      rollupOptions: { input: resolve(root, "src/renderer/index.html") },
    },
  },
}));
