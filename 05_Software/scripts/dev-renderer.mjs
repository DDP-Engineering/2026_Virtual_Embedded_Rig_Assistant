import { resolveConfig } from "electron-vite";
import { createServer } from "vite";

// Reuse the desktop renderer config; start only Vite, without main/preload or Electron.
const resolved = await resolveConfig({ root: "apps/desktop" }, "serve", "development");
if (!resolved.config?.renderer) throw new Error("Missing renderer config");
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
