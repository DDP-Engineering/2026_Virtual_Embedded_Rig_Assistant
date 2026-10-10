import { contextBridge } from "electron";

// WP-02 introduces the typed bridge. This boundary exposes no page-world API.
if (!contextBridge || !process.sandboxed || !process.contextIsolated) {
  throw new Error("VERA requires an isolated sandboxed preload");
}
