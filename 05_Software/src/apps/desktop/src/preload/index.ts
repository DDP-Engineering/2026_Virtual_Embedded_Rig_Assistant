import { contextBridge, ipcRenderer } from "electron";
import { createBridge } from "./bridge.js";

if (!contextBridge || !process.sandboxed || !process.contextIsolated) {
  throw new Error("VERA requires an isolated sandboxed preload");
}

contextBridge.exposeInMainWorld("vera", createBridge(ipcRenderer));
