import { createServer as createNetServer } from "node:net";
import { importSoftware } from "./software.mjs";

const { resolveConfig } = await importSoftware("electron-vite");
const { createServer } = await importSoftware("vite");

// Reuse the desktop renderer config; start only Vite, without main/preload or Electron.
const resolved = await resolveConfig({ root: "src/apps/desktop" }, "serve", "development");
if (!resolved.config?.renderer) throw new Error("Missing renderer config");
/** A loopback port that is free now. */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createNetServer().once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}
if (process.env.VERA_TEST === "1" && process.env.VITE_API === "mock") {
  // Browser probes must not take 5173 from the development application. Vite reads port 0 as unset and
  // starts on 5173, so the operating system names the port; strictPort off covers a port lost meanwhile.
  resolved.config.renderer.server = {
    ...resolved.config.renderer.server,
    port: await freePort(),
    strictPort: false,
    hmr: false,
  };
}
const server = await createServer(resolved.config.renderer);
await server.listen();
server.printUrls();
console.log("VERA_RENDERER_READY");
function close() {
  server
    .close()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
process.on("SIGTERM", close);
process.on("SIGINT", close);
