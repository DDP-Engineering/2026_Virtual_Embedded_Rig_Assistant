import { resolveConfig } from "electron-vite";
import { build, createServer } from "vite";

// Keep the development probe's builds separate from the native acceptance app.
// Preparation finishes before the renderer readiness deadline starts.
const mode = process.argv[2];
if (!["--prepare", "--serve"].includes(mode) || !process.env.VERA_BUILD_ROOT) {
  throw new Error("Use --prepare or --serve with an isolated VERA_BUILD_ROOT");
}
process.env.NODE_ENV_ELECTRON_VITE = "development";
const resolved = await resolveConfig({ root: "src/apps/desktop" }, "serve", "development");
if (!resolved.config?.main || !resolved.config.preload || !resolved.config.renderer) {
  throw new Error("Incomplete desktop development config");
}
if (mode === "--prepare") {
  await build(resolved.config.main);
  await build(resolved.config.preload);
  console.log("VERA_DEV_BUILT");
  process.exit(0);
}
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
