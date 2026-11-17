import type { BrowserWindow } from "electron";
import { expect, it, vi } from "vitest";
import { recoverRenderer } from "./renderer-recovery.js";

function harness() {
  let listener: (event: unknown, details: { reason: string }) => void = () => {};
  let now = 0;
  const reload = vi.fn();
  const gone = vi.fn();
  const state = { destroyed: false };
  const window = {
    isDestroyed: () => state.destroyed,
    webContents: {
      on: (event: string, on: typeof listener) => {
        expect(event).toBe("render-process-gone");
        listener = on;
      },
      reload,
    },
  } as unknown as BrowserWindow;
  recoverRenderer(window, gone, () => now);
  return {
    reload,
    gone,
    state,
    crash: (reason: string, at: number) => {
      now = at;
      listener({}, { reason });
    },
  };
}

it("reloads the window after a renderer crash, but not when it crashes again right after", () => {
  const h = harness();
  h.crash("crashed", 1000);
  expect(h.gone).toHaveBeenLastCalledWith("crashed", true);
  expect(h.reload).toHaveBeenCalledTimes(1);
  h.crash("oom", 3000);
  expect(h.gone).toHaveBeenLastCalledWith("oom", false);
  expect(h.reload).toHaveBeenCalledTimes(1);
  // A crash long after the last one is recovered again.
  h.crash("crashed", 60_000);
  expect(h.gone).toHaveBeenLastCalledWith("crashed", true);
  expect(h.reload).toHaveBeenCalledTimes(2);
});

it("leaves a clean renderer exit and a destroyed window alone", () => {
  const h = harness();
  h.crash("clean-exit", 1000);
  h.state.destroyed = true;
  h.crash("killed", 2000);
  expect(h.gone).not.toHaveBeenCalled();
  expect(h.reload).not.toHaveBeenCalled();
});
