import { type BrowserContext, chromium, type LaunchOptions } from "playwright-core";
import { BrowserError } from "./failure.js";

export const chromiumStartupMs = 15_000;

export interface BrowserProcess {
  readonly context: BrowserContext;
  onExit(listener: () => void): void;
  close(): Promise<void>;
}

const browserEnv =
  /^(?:APPDATA|DBUS_SESSION_BUS_ADDRESS|DISPLAY|HOME|LANG|LC_[A-Z_]+|LOCALAPPDATA|LOGNAME|PATH|SYSTEMDRIVE|SYSTEMROOT|TEMP|TMP|TMPDIR|USER|USERPROFILE|WAYLAND_DISPLAY|WINDIR|XAUTHORITY|XDG_RUNTIME_DIR)$/i;

export function browserLaunchOptions(
  executablePath: string,
  proxyServer: string,
  remainingMs = chromiumStartupMs,
): LaunchOptions {
  return {
    executablePath,
    headless: false,
    chromiumSandbox: true,
    timeout: Math.max(1, Math.min(remainingMs, chromiumStartupMs)),
    env: Object.fromEntries(Object.entries(process.env).filter(([name]) => browserEnv.test(name))),
    proxy: { server: proxyServer, bypass: "<-loopback>" },
    args: [
      "--disable-component-update",
      "--disable-quic",
      "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
    ],
  };
}

export function classifyLaunchFailure(error: unknown): BrowserError {
  const message = error instanceof Error ? error.message : "";
  if (
    /no usable sandbox|sandboxing failed|running as root without|failed to move to new namespace|suid sandbox helper|zygote.*operation not permitted/i.test(
      message,
    )
  )
    return new BrowserError("sandbox-unavailable", { cause: error });
  if (
    /missing x server|\$DISPLAY|host system is missing dependencies|while loading shared libraries|error loading shared library|wayland display/i.test(
      message,
    )
  )
    return new BrowserError("prerequisite", { cause: error });
  return new BrowserError(/timeout|timed out/i.test(message) ? "startup-timeout" : "launch", {
    cause: error,
  });
}

export async function launchBrowser(
  executable: string,
  signal: AbortSignal,
  proxyServer: string,
  remainingMs: number,
): Promise<BrowserProcess> {
  signal.throwIfAborted();
  if (process.env.SELENIUM_REMOTE_URL) throw new BrowserError("remote-launch-configured");
  try {
    // The local Playwright pipe avoids a listening automation port. Playwright owns and deletes
    // its scratch user-data and artifact directories on process close.
    const browser = await chromium.launch(browserLaunchOptions(executable, proxyServer, remainingMs));
    let closing: Promise<void> | undefined;
    const close = () => (closing ??= browser.close());
    const cancel = () => void close().catch(() => {});
    signal.addEventListener("abort", cancel, { once: true });
    try {
      signal.throwIfAborted();
      const context = await browser.newContext({
        acceptDownloads: false,
        serviceWorkers: "block",
        viewport: null,
      });
      signal.throwIfAborted();
      return {
        context,
        onExit(listener) {
          if (browser.isConnected()) browser.once("disconnected", listener);
          else listener();
        },
        close,
      };
    } catch (error) {
      await close();
      throw error;
    } finally {
      signal.removeEventListener("abort", cancel);
    }
  } catch (error) {
    signal.throwIfAborted();
    throw classifyLaunchFailure(error);
  }
}
