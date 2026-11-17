import type { BrowserWindow } from "electron";

const RELOAD_LOOP_MS = 10_000;

/**
 * Reloads the window when its renderer process dies, so a crash does not leave a blank window while
 * the agent runs on. A renderer that dies again right after a reload is only reported, never
 * reloaded in a loop.
 */
export function recoverRenderer(
  window: BrowserWindow,
  gone: (reason: string, reloading: boolean) => void,
  now: () => number = Date.now,
): void {
  let last = Number.NEGATIVE_INFINITY;
  window.webContents.on("render-process-gone", (_event, details) => {
    if (details.reason === "clean-exit" || window.isDestroyed()) return;
    const at = now();
    const reloading = at - last > RELOAD_LOOP_MS;
    last = at;
    gone(details.reason, reloading);
    if (reloading) window.webContents.reload();
  });
}
