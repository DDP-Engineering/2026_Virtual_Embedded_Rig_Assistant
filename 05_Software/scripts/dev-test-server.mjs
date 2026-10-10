import { resolveConfig } from "electron-vite";
import { build, createServer } from "vite";

// Test harness: builds dev entrypoints and starts Vite without launching an extra Electron.
process.env.NODE_ENV_ELECTRON_VITE = "development";
const resolved = await resolveConfig({ root: "apps/desktop" }, "serve", "development");
if (!resolved.config?.main || !resolved.config.preload || !resolved.config.renderer) {
  throw new Error("Incomplete desktop development config");
}
await build(resolved.config.main);
await build(resolved.config.preload);
const server = await createServer(resolved.config.renderer);
await server.listen();
server.printUrls();
console.log("VERA_DEV_READY");
process.on("SIGTERM", () => {
  server
    .close()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
});
process.on("SIGINT", () => {
  server
    .close()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
});
