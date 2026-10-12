import {
  type AuthInteraction,
  type CredentialStore,
  createCollections,
  type MutableModels,
  type SettingsService,
} from "@vera/core";
import {
  type ChatgptLogin,
  type ChatgptStatus,
  chatgptLoginSchema,
  chatgptStatusSchema,
  type VeraError,
  veraError,
} from "@vera/shared";
import type { CredentialFile } from "./credentials.js";
import { subscriptionStore } from "./subscription-store.js";

const LOGIN_TIMEOUT_MS = 600000;
type Prompt = { id: string; resolve: (value: string) => void; reject: (reason: unknown) => void };
type Attempt = {
  ctrl: AbortController;
  consent?: boolean;
  prompt?: Prompt | undefined;
  task: Promise<void>;
  timedOut: boolean;
};
export class ChatgptAuth {
  private pending: Attempt | undefined;
  private error: VeraError | undefined;
  private consentRequired = false;
  private promptSequence = 0;
  private closed = false;
  private loggingOut = false;
  constructor(
    private readonly host: {
      settings: SettingsService;
      credentials: CredentialFile;
      openExternal: (url: string) => Promise<void>;
      createCollection?: (store: CredentialStore) => MutableModels;
    },
  ) {}
  async status(): Promise<ChatgptStatus> {
    const c = await this.host.credentials.read("chatgpt");
    return chatgptStatusSchema.parse({
      connected: c?.type === "oauth",
      ...(c?.type === "oauth" && Number.isFinite(new Date(c.expires).getTime())
        ? { expiresAt: new Date(c.expires).toISOString() }
        : {}),
      state: this.pending?.prompt
        ? "manual"
        : this.pending
          ? "pending"
          : this.error
            ? "error"
            : this.consentRequired
              ? "consent-required"
              : "idle",
      ...(this.pending?.prompt ? { promptId: this.pending.prompt.id } : {}),
      ...(this.error ? { error: this.error } : {}),
    });
  }
  async login(input: ChatgptLogin): Promise<ChatgptStatus> {
    if (this.closed || this.host.settings.get().readOnly) throw veraError("DENIED");
    if (this.loggingOut) throw veraError("BUSY");
    const parsed = chatgptLoginSchema.safeParse(input);
    if (!parsed.success) throw veraError("INVALID");
    const request = parsed.data;
    if ("manualCode" in request) {
      const p = this.pending?.prompt;
      if (!p || p.id !== request.promptId || this.pending?.ctrl.signal.aborted) throw veraError("CONFLICT");
      this.host.credentials.registerSecret(request.manualCode);
      if (this.pending) this.pending.prompt = undefined;
      p.resolve(request.manualCode);
      return this.status();
    }
    if (this.pending) throw veraError("BUSY");
    if (!this.host.credentials.secureStorage && request.storageConsent === undefined) {
      this.error = undefined;
      this.consentRequired = true;
      return this.status();
    }
    this.consentRequired = false;
    this.error = undefined;
    const attempt: Attempt = {
      ctrl: new AbortController(),
      task: Promise.resolve(),
      timedOut: false,
      ...(request.storageConsent !== undefined ? { consent: request.storageConsent } : {}),
    };
    this.pending = attempt;
    const timer = setTimeout(() => {
      attempt.timedOut = true;
      attempt.ctrl.abort();
    }, LOGIN_TIMEOUT_MS);
    const credentials = this.host.credentials;
    const store = subscriptionStore(credentials, () => attempt.consent);
    const interaction: AuthInteraction = {
      signal: attempt.ctrl.signal,
      notify: (event) => {
        if (event.type !== "auth_url" || this.pending !== attempt || attempt.ctrl.signal.aborted) return;
        // Promise rejection is consumed and aborts login; no raw URL is projected to renderer.
        void this.host.openExternal(event.url).catch(() => {
          if (this.pending !== attempt || attempt.ctrl.signal.aborted) return;
          this.error = { code: "PROVIDER", messageKey: "chatgpt.browserFailed" };
          attempt.ctrl.abort();
        });
      },
      prompt: (p) => {
        if (this.pending !== attempt || attempt.ctrl.signal.aborted)
          return Promise.reject(veraError("DENIED"));
        if (p.type !== "manual_code") return Promise.reject(veraError("INVALID"));
        const signal = p.signal ? AbortSignal.any([attempt.ctrl.signal, p.signal]) : attempt.ctrl.signal;
        return new Promise<string>((resolve, reject) => {
          const id = String(++this.promptSequence);
          const cleanup = () => {
            signal.removeEventListener("abort", abort);
            if (attempt.prompt?.id === id) attempt.prompt = undefined;
          };
          const abort = () => {
            cleanup();
            reject(veraError("DENIED"));
          };
          if (signal.aborted) return abort();
          attempt.prompt = {
            id,
            resolve: (value) => {
              cleanup();
              resolve(value);
            },
            reject: (reason) => {
              cleanup();
              reject(reason);
            },
          };
          signal.addEventListener("abort", abort, { once: true });
        });
      },
    };
    attempt.task = Promise.resolve()
      .then(async () => {
        const collection =
          this.host.createCollection?.(this.mapped(store)) ??
          createCollections(credentials, store).subscription;
        const provider = collection.getProvider("openai");
        const oauth = provider?.auth.oauth;
        if (!provider || !oauth) throw veraError("INTERNAL");
        let providerTask: Promise<unknown> | undefined;
        collection.setProvider({
          ...provider,
          auth: {
            oauth: {
              ...oauth,
              login: (i, options) => {
                const task = oauth.login(i, options);
                providerTask = task;
                return task;
              },
            },
          },
        });
        try {
          await collection.login("openai", "oauth", interaction, {
            agentName: "VERA",
            getDeviceId: () => this.host.settings.get().settings.installationId,
          });
        } finally {
          // Models.login races cancellation; drain the provider so its callback port is released.
          await providerTask?.catch(() => {});
        }
        attempt.ctrl.signal.throwIfAborted();
        if (this.host.settings.get().settings.defaultModel === null) {
          const model = collection.getModels("openai")[0];
          if (!model) throw veraError("NOT_FOUND");
          await this.host.settings.update(
            { defaultModel: `chatgpt/${model.id}` },
            (current) => current.settings.defaultModel === null && !attempt.ctrl.signal.aborted,
          );
        }
      })
      .catch((error) => {
        if (attempt.timedOut) this.error = { code: "PROVIDER", messageKey: "chatgpt.timeout" };
        else if (!attempt.ctrl.signal.aborted) {
          const text = error instanceof Error ? error.message : "";
          this.error = {
            code: "PROVIDER",
            messageKey: /EADDRINUSE|(?:port\s*)?1455.*(?:use|busy)/i.test(text)
              ? "chatgpt.portBusy"
              : "chatgpt.loginFailed",
          };
        }
      })
      .finally(() => {
        clearTimeout(timer);
        attempt.prompt?.reject(veraError("DENIED"));
        if (this.pending === attempt) this.pending = undefined;
      });
    return this.status();
  }
  private mapped(store: CredentialStore): CredentialStore {
    return {
      read: (_id, o) => store.read("chatgpt", o),
      list: async (o) =>
        (await store.list(o))
          .filter((c) => c.providerId === "chatgpt")
          .map((c) => ({ ...c, providerId: "openai" })),
      modify: (_id, fn, o) => store.modify("chatgpt", fn, o),
      delete: (_id, o) => store.delete("chatgpt", o),
    };
  }
  async settled(): Promise<void> {
    await this.pending?.task;
  }
  async cancel(): Promise<Record<string, never>> {
    const attempt = this.pending;
    attempt?.ctrl.abort();
    await attempt?.task;
    this.consentRequired = false;
    if (!attempt?.timedOut) this.error = undefined;
    return {};
  }
  async logout(): Promise<Record<string, never>> {
    if (this.closed || this.host.settings.get().readOnly) throw veraError("DENIED");
    if (this.loggingOut) throw veraError("BUSY");
    this.loggingOut = true;
    try {
      await this.cancel();
      await this.host.credentials.delete("chatgpt");
      await this.host.settings.update(
        { defaultModel: null },
        (current) => !!current.settings.defaultModel?.startsWith("chatgpt/"),
      );
      return {};
    } finally {
      this.loggingOut = false;
    }
  }
  async close(): Promise<void> {
    this.closed = true;
    await this.cancel();
  }
}
