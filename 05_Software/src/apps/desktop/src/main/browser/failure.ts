const recovery = {
  "unsupported-platform": "Use VERA on Windows x64 or Ubuntu x64.",
  "runtime-missing": "Install the browser runtime in VERA before opening a browser session.",
  integrity: "Reinstall the browser runtime in VERA to restore the verified files.",
  download: "Check access to the Chromium release host, then retry the browser download.",
  cleanup: "Close any program using VERA's browser runtime folder, then retry provisioning.",
  storage: "Check available disk space and write access to VERA's application data, then retry.",
  prerequisite:
    "Start VERA in a graphical desktop session and install the required Chromium system libraries.",
  "sandbox-unavailable":
    "Use a non-root graphical session with Chromium sandbox support. On Ubuntu, check the user namespace and AppArmor policies.",
  "remote-launch-configured": "Remove SELENIUM_REMOTE_URL from VERA's launch environment and restart VERA.",
  launch: "Close the browser session and try again. Reinstall the runtime if startup still fails.",
  "startup-timeout": "Retry after the system has finished other work.",
  "policy-denied": "Enable interactive browsing in VERA and authorize an origin for this session.",
  "policy-unavailable": "The browser could not enforce the required local restrictions.",
  "destination-denied": "Authorize a public HTTP or HTTPS origin for this session.",
  "resource-limit": "The browser session reached its resource limit.",
  "session-limit": "Close another VERA browser session before opening a new one.",
  "tab-limit": "Close a browser tab before opening another.",
  cancelled: "Open a new browser session to continue browsing.",
} as const;

export type BrowserFailureCode = keyof typeof recovery;
export type BrowserFailure = { code: BrowserFailureCode; recovery: string };

export class BrowserError extends Error implements BrowserFailure {
  override name = "BrowserError";
  readonly recovery: string;

  constructor(
    readonly code: BrowserFailureCode,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.recovery = recovery[code];
  }

  failure(): BrowserFailure {
    return { code: this.code, recovery: this.recovery };
  }
}
