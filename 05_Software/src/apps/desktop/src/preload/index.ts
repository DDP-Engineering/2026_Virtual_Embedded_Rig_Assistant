import { contextBridge, ipcRenderer } from "electron";
import { createBridge } from "./bridge.js";

if (!contextBridge || !process.sandboxed || !process.contextIsolated) {
  throw new Error("VERA requires an isolated sandboxed preload");
}

let trustedInput: Event | undefined;
for (const type of ["click", "keydown", "pointerdown", "pointerup"]) {
  window.addEventListener(
    type,
    (event) => {
      if (event.isTrusted) trustedInput = event;
    },
    { capture: true, passive: true },
  );
}

contextBridge.exposeInMainWorld(
  "vera",
  createBridge(ipcRenderer, () => {
    // Transient activation alone can outlive the input handler by several seconds.
    if (!trustedInput || trustedInput.eventPhase === Event.NONE || !navigator.userActivation.isActive) {
      return false;
    }
    trustedInput = undefined;
    return true;
  }),
);
