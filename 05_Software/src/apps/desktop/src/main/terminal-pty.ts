import { createRequire } from "node:module";
import type { ProcessHost } from "@vera/core";
import type * as NodePty from "node-pty";
import { systemClock } from "./host-ports.js";
import { stopTerminalProcesses } from "./terminal-processes.js";
import type { PtyFactory, UserPty } from "./terminals.js";

/** Native loading stays at the desktop edge; node-pty uses the platform N-API binding. */
export function createPtyFactory(processHost: ProcessHost, modulePath = "node-pty"): PtyFactory {
  const native = createRequire(import.meta.url)(modulePath) as typeof NodePty;
  const states = new WeakMap<UserPty, { running: boolean; stopped?: Promise<void> }>();
  async function stop(pty: UserPty): Promise<void> {
    const state = states.get(pty);
    if (!state) throw Error("Unknown terminal process.");
    if (!state.stopped) {
      const running = state.running;
      state.stopped = (async () => {
        await stopTerminalProcesses(processHost, pty.pid, systemClock, running);
        if (processHost.platform === "linux" || !running) return;
        try {
          (pty as NodePty.IPty).kill();
        } catch {
          /* Already exited. */
        }
      })();
    }
    return state.stopped;
  }
  return {
    spawn: (executable, args, options) => {
      const pty = native.spawn(executable, args, {
        ...options,
        name: "xterm-256color",
        ...(process.platform === "win32" ? { useConptyDll: true } : {}),
      });
      const state = { running: true };
      states.set(pty, state);
      pty.onExit(() => {
        state.running = false;
        // Retire numeric Linux session authority promptly, not when a finished tab is later closed.
        if (processHost.platform === "linux")
          void stop(pty).catch(() => {
            /* The original rejected cleanup promise is observed again by user close/shutdown. */
          });
      });
      return pty;
    },
    stop,
  };
}
