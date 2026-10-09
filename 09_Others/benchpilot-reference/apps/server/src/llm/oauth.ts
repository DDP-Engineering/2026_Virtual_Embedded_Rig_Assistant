// ChatGPT subscription sign-in (04 §7), run inside the server process: pi-ai's flow starts its own callback server
// on 127.0.0.1:1455, so the browser on the demo laptop completes it without our routes. We only capture the URL.
import type { ChatgptAuthStatus } from "@benchpilot/shared";
import type { CredentialsFile, SettingsFile } from "./credentials.ts";
import type { PiAiCollections } from "./providers.ts";

const LOGIN_TIMEOUT_MS = 10 * 60_000;

export class ChatgptAuth {
  private pending: AbortController | null = null;
  /** Last failure, server-side only (never contains tokens: pi-ai errors carry status text). */
  lastError: string | null = null;

  constructor(
    private readonly cols: PiAiCollections,
    private readonly settings: SettingsFile,
    private readonly credentials: CredentialsFile,
  ) {}

  /** Starts a login and resolves with the authorization URL as soon as pi-ai announces it. */
  start(): Promise<{ url: string }> {
    this.pending?.abort(); // a second click restarts the flow (frees port 1455)
    const ctrl = new AbortController();
    this.pending = ctrl;
    const timer = setTimeout(() => ctrl.abort(), LOGIN_TIMEOUT_MS);
    this.lastError = null;

    return new Promise((resolveUrl, rejectUrl) => {
      let announced = false;
      const login = this.cols.subscription.login(
        "openai",
        "oauth",
        {
          signal: ctrl.signal,
          notify: (event) => {
            if (event.type === "auth_url" && !announced) {
              announced = true;
              resolveUrl({ url: event.url });
            }
          },
          // The UI has no paste box: the manual-code fallback just waits until the callback wins or we abort.
          prompt: (p) =>
            new Promise<string>((_resolve, reject) => {
              const signals = [ctrl.signal, p.signal].filter((s): s is AbortSignal => Boolean(s));
              const any = AbortSignal.any(signals);
              if (any.aborted) return reject(new Error("cancelled"));
              any.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
            }),
        },
        { getDeviceId: () => this.settings.read().installationId, agentName: "BenchPilot" },
      );
      login
        .then(() => {
          // Signing in makes the provider usable; select it unless another provider is already active.
          this.settings.update((s) => (s.active ? s : { ...s, active: "chatgpt" }));
        })
        .catch((err: Error) => {
          this.lastError = ctrl.signal.aborted ? null : err.message;
          if (!announced) rejectUrl(err);
        })
        .finally(() => {
          clearTimeout(timer);
          if (this.pending === ctrl) this.pending = null;
        });
    });
  }

  status(): ChatgptAuthStatus {
    const c = this.credentials.get("chatgpt");
    if (c?.type !== "oauth") return { connected: false };
    return { connected: true, expiresAt: new Date(c.expires).toISOString() };
  }

  async logout(): Promise<void> {
    this.pending?.abort();
    await this.credentials.remove("chatgpt");
    this.settings.update((s) => (s.active === "chatgpt" ? { ...s, active: null } : s));
  }
}
