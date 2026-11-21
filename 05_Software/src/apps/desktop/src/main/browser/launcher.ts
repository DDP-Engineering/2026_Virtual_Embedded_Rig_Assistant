import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type BrowserContext, chromium, type LaunchOptions } from "playwright-core";
import { BrowserError } from "./failure.js";
import { checkBrowserProfile, prepareBrowserProfile } from "./restrictions.js";

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
  certificatePin?: string,
  configuration?: string,
): LaunchOptions {
  return {
    executablePath,
    headless: false,
    chromiumSandbox: true,
    timeout: Math.max(1, Math.min(remainingMs, chromiumStartupMs)),
    ignoreDefaultArgs: [
      "--disable-ipc-flooding-protection",
      "--enable-unsafe-swiftshader",
      "--unsafely-disable-devtools-self-xss-warnings",
    ],
    env: Object.fromEntries(Object.entries(process.env).filter(([name]) => browserEnv.test(name))),
    proxy: { server: proxyServer, bypass: "<-loopback>" },
    args: [
      "--disable-component-update",
      "--disable-quic",
      "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
      "--deny-permission-prompts",
      "--disable-blink-features=WebTransport,DirectSockets,FileSystemAccessLocal,WebBluetooth,WebUSB,Serial,Hid,PaymentRequest,WebShare",
      ...(certificatePin ? [`--ignore-certificate-errors-spki-list=${certificatePin}`] : []),
      ...(configuration ? [`--chrome-for-testing-config=${configuration}`] : []),
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
  certificatePin?: string,
): Promise<BrowserProcess> {
  signal.throwIfAborted();
  if (process.env.SELENIUM_REMOTE_URL) throw new BrowserError("remote-launch-configured");
  const deadline = performance.now() + remainingMs;
  const remaining = () => Math.max(1, Math.ceil(deadline - performance.now()));
  const profile = await mkdtemp(join(tmpdir(), "vera-browser-"));
  let profileContext: BrowserContext | undefined;
  let closing: Promise<void> | undefined;
  const close = () =>
    (closing ??= (async () => {
      try {
        await profileContext?.close();
      } finally {
        await rm(profile, { recursive: true, force: true, maxRetries: 3 });
      }
    })());
  const cancel = () => void close().catch(() => {});
  try {
    const configuration = await prepareBrowserProfile(profile, proxyServer);
    signal.throwIfAborted();
    // Playwright uses the local debugging pipe. Only a fresh non-persistent context is exposed.
    profileContext = await chromium.launchPersistentContext(profile, {
      ...browserLaunchOptions(executable, proxyServer, remaining(), certificatePin, configuration),
      acceptDownloads: false,
      serviceWorkers: "block",
      viewport: null,
    });
    signal.addEventListener("abort", cancel, { once: true });
    signal.throwIfAborted();
    const browser = profileContext.browser();
    const initialPage = profileContext.pages()[0];
    if (!browser || !initialPage) throw new BrowserError("policy-unavailable");
    const policyPage = await profileContext.newPage();
    try {
      await checkBrowserProfile(policyPage, profile, remaining());
    } finally {
      await policyPage.close();
    }
    await profileContext.route("**/*", (route) => route.abort());
    profileContext.on("page", (page) => void page.close().catch(cancel));
    signal.throwIfAborted();
    const context = await browser.newContext({
      acceptDownloads: false,
      serviceWorkers: "block",
      viewport: null,
    });
    // Linux Chromium can stop creating tabs when the only visible window closes.
    context.once("page", () => void initialPage.close().catch(cancel));
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
    signal.throwIfAborted();
    throw error instanceof BrowserError ? error : classifyLaunchFailure(error);
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}
