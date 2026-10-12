import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, rmdir } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuthInteraction, Credential, LoginOptions } from "@earendil-works/pi-ai";
import { createModels, createProvider } from "@earendil-works/pi-ai/models";
import { createCollections, SettingsService } from "@vera/core";
import { channels } from "@vera/shared";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CredentialFile } from "./credentials.js";
import { createEventEmitter } from "./events.js";
import { type ChannelHandlers, createInvokeRouter } from "./ipc-router.js";
import { createLogger } from "./logger.js";
import { subscriptionStore } from "./subscription-store.js";

let ChatgptAuth: typeof import("./chatgpt-auth.js").ChatgptAuth;
beforeAll(async () => {
  expect(existsSync(new URL("./chatgpt-auth.ts", import.meta.url)), "ChatGPT auth host exists").toBe(true);
  ({ ChatgptAuth } = await import("./chatgpt-auth.js"));
});
afterEach(() => vi.useRealTimers());
const token = {
  type: "oauth" as const,
  access: "fake-access-WP21-private",
  refresh: "fake-refresh-WP21-private",
  expires: 2000000000000,
};
const model = {
  id: "fake-subscription",
  name: "Fake subscription",
  api: "fake",
  provider: "openai",
  baseUrl: "http://127.0.0.1",
  reasoning: false,
  input: ["text" as const],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 32768,
  maxTokens: 4096,
};
async function harness(
  login: (i: AuthInteraction, o?: LoginOptions) => Promise<Credential> = async () => token,
  secure = true,
) {
  const disk = new Map<string, string>();
  const changed = vi.fn();
  const files = {
    read: async (p: string) => disk.get(p),
    writeAtomic: async (p: string, v: string) => {
      disk.set(p, v);
    },
    backup: async () => true,
  };
  const logger = { log: vi.fn(), registerSecret: vi.fn(() => () => {}), flush: async () => {} };
  const settings = new SettingsService({
    files,
    paths: { userData: "/data", settings: "/data/settings.json", logs: "/data/logs" },
    uuid: () => "1b9dc50c-d87d-484b-88e6-04cb5f7c5a19",
    changed,
  });
  await settings.load();
  const credentials = new CredentialFile({
    files,
    file: "/data/credentials.json",
    logger,
    platform: "win32",
    crypto: {
      isEncryptionAvailable: () => secure,
      getSelectedStorageBackend: () => "unknown",
      encryptString: (t) => Buffer.from(Buffer.from(t).map((b) => b ^ 0x5a)),
      decryptString: (b) => Buffer.from(b.map((x) => x ^ 0x5a)).toString(),
    },
  });
  const openExternal = vi.fn(async () => {});
  const auth = new ChatgptAuth({
    settings,
    credentials,
    openExternal,
    createCollection: (store) => {
      const models = createModels({ credentials: store });
      models.setProvider(
        createProvider({
          id: "openai",
          models: [model],
          auth: {
            oauth: {
              name: "Fake OAuth",
              login: async (i, o) => login(i, o) as Promise<Extract<Credential, { type: "oauth" }>>,
              refresh: async (c) => c,
              toAuth: async (c) => ({ apiKey: c.access }),
            },
          },
          api: {
            stream: () => {
              throw new Error("unused");
            },
            streamSimple: () => {
              throw new Error("unused");
            },
          },
        }),
      );
      return models;
    },
  });
  return { auth, settings, credentials, changed, logger, disk, files, openExternal };
}
const waiting = (i: AuthInteraction) =>
  new Promise<Credential>((_, reject) => {
    i.signal?.addEventListener("abort", () => reject(i.signal?.reason), { once: true });
  });
describe("ChatGPT login lifecycle", () => {
  it("drains delayed OAuth startup on cancellation and rejects stale prompts before a new login", async () => {
    let release: (() => void) | undefined;
    let count = 0;
    const h = await harness(async (i) => {
      if (++count !== 1) return token;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      await i.prompt({ type: "manual_code", message: "late prompt" });
      return token;
    });
    await h.auth.login({});
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    let cancelled = false;
    const cancellation = h.auth.cancel().then(() => {
      cancelled = true;
    });
    await Promise.resolve();
    expect(cancelled).toBe(false);
    await expect(h.auth.login({})).rejects.toMatchObject({ code: "BUSY" });
    if (!release) throw Error("Delayed startup not captured");
    release();
    await cancellation;
    expect(await h.auth.status()).toMatchObject({ connected: false, state: "idle" });
    await h.auth.login({});
    await h.auth.settled();
    expect(await h.auth.status()).toMatchObject({ connected: true, state: "idle" });
  });
  it("immediate cancellation drains the actual pinned callback startup and frees port1455", async () => {
    const h = await harness();
    const real = new ChatgptAuth({
      settings: h.settings,
      credentials: h.credentials,
      openExternal: h.openExternal,
    });
    try {
      await real.login({});
      await real.cancel();
      expect(await real.status()).toMatchObject({ connected: false, state: "idle" });
      const server = createServer();
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(1455, "127.0.0.1", resolve);
      });
      await new Promise<void>((resolve) => server.close(() => resolve()));
    } finally {
      await real.close();
    }
  });
  it("ignores a browser rejection from a cancelled login after a later successful login", async () => {
    let count = 0;
    const h = await harness(async (i) => {
      if (++count === 1) {
        i.notify({ type: "auth_url", url: "https://auth.openai.com/api/accounts/authorize" });
        return waiting(i);
      }
      return token;
    });
    let fail: ((reason: Error) => void) | undefined;
    h.openExternal.mockImplementationOnce(
      () =>
        new Promise<void>((_, reject) => {
          fail = reject;
        }),
    );
    await h.auth.login({});
    await vi.waitFor(() => expect(h.openExternal).toHaveBeenCalledOnce());
    await h.auth.cancel();
    await h.auth.login({});
    await h.auth.settled();
    if (!fail) throw Error("Browser rejection not captured");
    fail(Error("late browser failure"));
    await Promise.resolve();
    expect(await h.auth.status()).toMatchObject({ connected: true, state: "idle" });
    expect((await h.auth.status()).error).toBeUndefined();
  });
  it("projects auth status and token-bearing errors/events through the real IPC redaction boundary", async () => {
    const h = await harness();
    await h.auth.login({});
    await h.auth.settled();
    const frame = { url: "vera://app/index.html" };
    const sent: unknown[] = [];
    const contents = {
      mainFrame: frame,
      isDestroyed: () => false,
      send: (_name: string, value: unknown) => {
        sent.push(value);
      },
    };
    const handlers = Object.fromEntries(
      Object.keys(channels).map((name) => [
        name,
        () => {
          throw {
            code: "PROVIDER",
            messageKey: "provider.failure",
            params: { message: token.access + token.refresh },
          };
        },
      ]),
    ) as unknown as ChannelHandlers;
    handlers["providers.chatgpt.status"] = () => h.auth.status();
    const route = createInvokeRouter({
      target: () => ({ webContents: contents, url: frame.url }),
      handlers,
      log: () => {},
      sanitize: (v) => h.credentials.sanitize(v),
    });
    const sender = { sender: contents, senderFrame: frame };
    const status = await route(sender, "providers.chatgpt.status", {});
    const failure = await route(sender, "providers.chatgpt.logout", {});
    const emit = createEventEmitter(
      () => contents,
      (text) => h.credentials.scrub(text),
    );
    emit({
      topic: "session",
      id: "ses_01JB8Z6Q4M7N2K5R9T3V8X1Y0C",
      seq: 1,
      event: { type: "message.delta", messageId: "m", text: token.access + token.refresh },
    });
    expect(status).toMatchObject({ ok: true, value: { connected: true } });
    expect(failure).toMatchObject({ ok: false, error: { code: "PROVIDER" } });
    expect(sent).toHaveLength(1);
    for (const secret of [token.access, token.refresh])
      expect(JSON.stringify([status, failure, sent])).not.toContain(secret);
  });
  it("cancels the actual pinned callback server and frees port1455 without contacting a model", async () => {
    const h = await harness();
    const real = new ChatgptAuth({
      settings: h.settings,
      credentials: h.credentials,
      openExternal: h.openExternal,
    });
    try {
      await real.login({});
      await vi.waitFor(async () => expect((await real.status()).state).toBe("manual"));
      await real.cancel();
      const server = createServer();
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(1455, "127.0.0.1", resolve);
      });
      await new Promise<void>((resolve) => server.close(() => resolve()));
      expect(h.openExternal).toHaveBeenCalledWith(
        expect.stringContaining("https://auth.openai.com/api/accounts/authorize?"),
      );
    } finally {
      await real.close();
    }
  });
  it("maps actual pinned occupied1455 error to the Codex hint", async () => {
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(1455, "127.0.0.1", resolve);
    });
    const h = await harness();
    const real = new ChatgptAuth({
      settings: h.settings,
      credentials: h.credentials,
      openExternal: h.openExternal,
    });
    try {
      await real.login({});
      await real.settled();
      expect(await real.status()).toMatchObject({
        state: "error",
        error: { messageKey: "chatgpt.portBusy" },
      });
      expect(h.openExternal).not.toHaveBeenCalled();
    } finally {
      await real.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it("refresh retains explicit memory consent through the mapped store and registers rotated tokens", async () => {
    const h = await harness(undefined, false);
    await h.auth.login({ storageConsent: false });
    await h.auth.settled();
    const view = subscriptionStore(h.credentials);
    const c = createCollections(h.credentials, view);
    const provider = c.subscription.getProvider("openai");
    if (!provider?.auth.oauth) throw Error("OAuth missing");
    const refresh = vi.fn(async () => ({
      ...token,
      access: "fake-rotated-access-WP21",
      refresh: "fake-rotated-refresh-WP21",
      expires: Date.now() + 600000,
    }));
    c.subscription.setProvider({ ...provider, auth: { oauth: { ...provider.auth.oauth, refresh } } });
    await view.modify("chatgpt", async () => ({ ...token, expires: 0 }));
    await Promise.all([c.subscription.getAuth("openai"), c.subscription.getAuth("openai")]);
    expect(refresh).toHaveBeenCalledOnce();
    expect(h.credentials.storage("chatgpt")).toBe("memory");
    expect(h.disk.has("/data/credentials.json")).toBe(false);
    expect(h.logger.registerSecret).toHaveBeenCalledWith("fake-rotated-access-WP21");
  });
  it("redacts access/refresh in real logs and actual IPC/events even after sign-out", async () => {
    const scratch = join(tmpdir(), "vera-wp21-TASK-5423a330");
    await mkdir(scratch, { recursive: true });
    const folder = await mkdtemp(join(scratch, "logger-"));
    const clock = { now: () => new Date("2026-10-12T12:00:00Z"), sleep: async () => {} };
    const logger = createLogger(folder, clock);
    const h = await harness();
    const file = new CredentialFile({
      file: "/credential",
      files: h.files,
      crypto: {
        isEncryptionAvailable: () => true,
        getSelectedStorageBackend: () => "unknown",
        encryptString: (t) => Buffer.from(t),
        decryptString: (b) => b.toString(),
      },
      logger,
      platform: "win32",
    });
    try {
      await file.modify("chatgpt", async () => token);
      logger.log("error", token.access, { message: token.refresh });
      await file.delete("chatgpt");
      logger.log("warn", token.refresh, { retained: token.access });
      await logger.flush();
      const text = await readFile(join(folder, "vera-2026-10-12.log"), "utf8");
      expect(text).not.toContain(token.access);
      expect(text).not.toContain(token.refresh);
      expect(text).toContain("[REDACTED]");
    } finally {
      await file.close();
      await logger.flush();
      await rm(folder, { recursive: true, force: true });
      await rmdir(scratch).catch(() => {});
    }
  });
  it("stores OAuth in chatgpt, registers both tokens, selects subscription only without another active provider", async () => {
    const login = vi.fn(async (i: AuthInteraction) => {
      i.notify({ type: "auth_url", url: "https://auth.openai.com/api/accounts/authorize?state=fake" });
      return token;
    });
    const h = await harness(login);
    await h.auth.login({});
    await h.auth.settled();
    expect(await h.credentials.read("chatgpt")).toEqual(token);
    expect(await h.credentials.read("openai")).toBeUndefined();
    expect(h.settings.get().settings.defaultModel).toBe("chatgpt/fake-subscription");
    expect(login.mock.calls[0]?.[0].signal).toBeDefined();
    expect(h.openExternal).toHaveBeenCalledOnce();
    expect(h.logger.registerSecret).toHaveBeenCalledWith(token.access);
    expect(h.logger.registerSecret).toHaveBeenCalledWith(token.refresh);
    expect(await h.auth.status()).toMatchObject({
      connected: true,
      expiresAt: new Date(token.expires).toISOString(),
      state: "idle",
    });
    const other = await harness();
    await other.settings.update({ defaultModel: "openai/kept" });
    await other.auth.login({});
    await other.auth.settled();
    expect(other.settings.get().settings.defaultModel).toBe("openai/kept");
  });
  it("passes VERA and installation id and cancels/drains the flow", async () => {
    let options: LoginOptions | undefined;
    let signal: AbortSignal | undefined;
    const h = await harness((i, o) => {
      options = o;
      signal = i.signal;
      return waiting(i);
    });
    await h.auth.login({});
    await vi.waitFor(() => expect(options?.agentName).toBe("VERA"));
    expect(options?.getDeviceId?.()).toBe(h.settings.get().settings.installationId);
    await expect(h.auth.login({})).rejects.toMatchObject({ code: "BUSY" });
    await h.auth.cancel();
    expect(signal?.aborted).toBe(true);
    expect(await h.auth.status()).toEqual({ connected: false, state: "idle" });
    expect(await h.credentials.read("chatgpt")).toBeUndefined();
  });
  it("times out after ten minutes with a safe error", async () => {
    vi.useFakeTimers();
    const h = await harness(waiting);
    await h.auth.login({});
    await vi.advanceTimersByTimeAsync(600000);
    await h.auth.settled();
    expect(await h.auth.status()).toMatchObject({ state: "error", error: { messageKey: "chatgpt.timeout" } });
  });
  it("reports occupied callback port with Codex hint and no raw error", async () => {
    const h = await harness(async () => {
      throw new Error(`Port 1455 is in use by Codex CLI ${token.access}`);
    });
    await h.auth.login({});
    await h.auth.settled();
    expect(await h.auth.status()).toMatchObject({
      state: "error",
      error: { messageKey: "chatgpt.portBusy" },
    });
    expect(JSON.stringify(await h.auth.status())).not.toContain(token.access);
  });
  it("completes manual_code and refuses stale or duplicate input", async () => {
    const h = await harness(async (i) => {
      expect(await i.prompt({ type: "manual_code", message: "untrusted upstream text" })).toBe(
        "http://localhost:1455/auth/callback?code=fake",
      );
      return token;
    });
    await h.auth.login({});
    await vi.waitFor(async () => expect((await h.auth.status()).state).toBe("manual"));
    const promptId = (await h.auth.status()).promptId;
    if (!promptId) throw Error("Missing prompt");
    await expect(h.auth.login({ promptId: "stale", manualCode: "fake" })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await h.auth.login({ promptId, manualCode: "http://localhost:1455/auth/callback?code=fake" });
    await h.auth.settled();
    expect((await h.auth.status()).connected).toBe(true);
    await expect(h.auth.login({ promptId, manualCode: "again" })).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("logout deletes credential and clears only subscription default", async () => {
    const h = await harness();
    await h.auth.login({});
    await h.auth.settled();
    await h.auth.logout();
    expect(await h.credentials.read("chatgpt")).toBeUndefined();
    expect(h.settings.get().settings.defaultModel).toBeNull();
    await h.settings.update({ defaultModel: "openai/kept" });
    await h.auth.login({});
    await h.auth.settled();
    await h.auth.logout();
    expect(h.settings.get().settings.defaultModel).toBe("openai/kept");
  });
  it("weak storage waits for explicit choice and memory login stays off disk", async () => {
    const h = await harness(undefined, false);
    expect(await h.auth.login({})).toMatchObject({ state: "consent-required" });
    expect(await h.credentials.read("chatgpt")).toBeUndefined();
    await h.auth.login({ storageConsent: false });
    await h.auth.settled();
    expect(h.credentials.storage("chatgpt")).toBe("memory");
    expect(h.disk.has("/data/credentials.json")).toBe(false);
  });
  it("keeps tokens out of public status and events on success/error/logout", async () => {
    const h = await harness();
    await h.auth.login({});
    await h.auth.settled();
    const responses = [await h.auth.status()];
    await h.auth.logout();
    responses.push(await h.auth.status());
    for (const secret of [token.access, token.refresh]) {
      expect(JSON.stringify([responses, h.changed.mock.calls, h.logger.log.mock.calls])).not.toContain(
        secret,
      );
      expect(h.credentials.scrub(secret)).not.toContain(secret);
    }
  });
});
