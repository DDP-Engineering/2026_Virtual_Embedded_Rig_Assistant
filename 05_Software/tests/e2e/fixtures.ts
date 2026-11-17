import { join } from "node:path";
import { test as base } from "@playwright/test";

export { expect } from "@playwright/test";

/** One mock renderer per worker; Playwright still creates a fresh browser context per test. */
export const test = base.extend<Record<never, never>, { rendererUrl: string }>({
  rendererUrl: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright extracts fixture dependencies from this parameter.
    async ({}, use, worker) => {
      const { resolveConfig } = await import("electron-vite");
      const { createServer } = await import("vite");
      const renderer = (await resolveConfig({ root: "src/apps/desktop" }, "serve", "development")).config
        ?.renderer;
      if (!renderer) throw Error("Missing renderer config");
      const server = await createServer({
        ...renderer,
        cacheDir: join(process.cwd(), "node_modules/.cache/vite-e2e", String(worker.parallelIndex)),
        define: { ...renderer.define, "import.meta.env.VITE_API": JSON.stringify("mock") },
        server: { ...renderer.server, host: "127.0.0.1", port: 0, strictPort: false, hmr: false },
      });
      try {
        await server.listen();
        const address = server.httpServer?.address();
        if (!address || typeof address === "string") throw Error("Missing renderer address");
        await use(`http://127.0.0.1:${address.port}`);
      } finally {
        await server.close();
      }
    },
    { scope: "worker" },
  ],
});
