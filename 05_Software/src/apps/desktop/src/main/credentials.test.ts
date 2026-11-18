import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createFileAccess } from "./file-access.js";
import { systemClock } from "./host-ports.js";
import { createLogger } from "./logger.js";

let CredentialFile: typeof import("./credentials.js").CredentialFile;
beforeAll(async () => {
  expect(existsSync(new URL("./credentials.ts", import.meta.url)), "encrypted credential store exists").toBe(
    true,
  );
  ({ CredentialFile } = await import("./credentials.js"));
}, 30000);
const secret = "fake-WP08-only-middle-private-9Zx4";
function harness(secure = true, backend = "gnome_libsecret", platform = "linux") {
  const disk = new Map<string, string>();
  const logger = { log: vi.fn(), registerSecret: vi.fn(() => () => {}), flush: vi.fn(async () => {}) };
  const files = {
    read: vi.fn(async (p: string) => disk.get(p)),
    writeAtomic: vi.fn(async (p: string, text: string) => {
      disk.set(p, text);
    }),
  };
  const crypto = {
    isEncryptionAvailable: () => secure,
    getSelectedStorageBackend: () => backend,
    encryptString: vi.fn((text: string) => Buffer.from(Buffer.from(text).map((x) => x ^ 0x5a))),
    decryptString: vi.fn((value: Buffer) => Buffer.from(value.map((x) => x ^ 0x5a)).toString()),
  };
  const store = new CredentialFile({ file: "/data/credentials.json", files, crypto, logger, platform });
  return {
    store,
    disk,
    files,
    logger,
    crypto,
    reload: () => new CredentialFile({ file: "/data/credentials.json", files, crypto, logger, platform }),
  };
}
describe("main encrypted credential store", () => {
  it("opens the current schema1 synthetic encrypted fixture without rewriting it and scrubs its credentials", async () => {
    const raw = readFileSync(
      new URL("../../../../../tests/fixtures/app-data/credentials.json", import.meta.url),
      "utf8",
    );
    const h = harness();
    h.disk.set("/data/credentials.json", raw);
    expect(await h.store.list()).toEqual([
      { providerId: "openai", type: "api_key" },
      { providerId: "chatgpt", type: "oauth" },
    ]);
    expect(await h.store.read("openai")).toEqual({ type: "api_key", key: "synthetic-WP32-key-only" });
    expect(await h.store.read("chatgpt")).toMatchObject({ type: "oauth", expires: 1900000000000 });
    expect(
      h.store.sanitize({ error: "synthetic-WP32-key-only synthetic-WP32-access synthetic-WP32-refresh" }),
    ).toEqual({ error: "[REDACTED] [REDACTED] [REDACTED]" });
    expect(h.disk.get("/data/credentials.json")).toBe(raw);
    expect(h.files.writeAtomic).not.toHaveBeenCalled();
    await h.store.modify("openai", async () => ({ type: "api_key", key: "synthetic-WP32-replacement" }));
    expect(Object.keys(JSON.parse(h.disk.get("/data/credentials.json")!))).toEqual([
      "schemaVersion",
      "entries",
    ]);
    expect(await h.reload().read("chatgpt")).toMatchObject({
      type: "oauth",
      access: "synthetic-WP32-access",
    });
    expect(h.logger.log).not.toHaveBeenCalled();
  });
  it("persists ciphertext only and roundtrips detached API and OAuth credentials", async () => {
    const h = harness();
    await h.store.modify("openai", async () => ({ type: "api_key", key: secret }));
    await h.store.modify("chatgpt", async () => ({
      type: "oauth",
      access: "fake-access-private",
      refresh: "fake-refresh-private",
      expires: 42,
      extra: { token: "fake-extension-private" },
    }));
    const raw = h.disk.get("/data/credentials.json") ?? "";
    for (const key of [secret, "fake-access-private", "fake-refresh-private", "fake-extension-private"])
      expect(raw).not.toContain(key);
    expect(JSON.parse(raw).schemaVersion).toBe(1);
    expect(h.crypto.encryptString).toHaveBeenCalledTimes(2);
    const reload = h.reload();
    expect(await reload.read("openai")).toEqual({ type: "api_key", key: secret });
    const read = await reload.read("openai");
    if (read?.type === "api_key") read.key = "mutated";
    expect(await reload.read("openai")).toEqual({ type: "api_key", key: secret });
    expect(await reload.list()).toEqual([
      { providerId: "openai", type: "api_key" },
      { providerId: "chatgpt", type: "oauth" },
    ]);
    for (const key of [secret, "fake-access-private", "fake-refresh-private", "fake-extension-private"])
      expect(h.logger.registerSecret).toHaveBeenCalledWith(key);
  });
  it("keeps public OAuth scope words usable as tool keys while redacting tokens and unknown metadata", async () => {
    const h = harness();
    await h.store.modify("chatgpt", async () => ({
      type: "oauth",
      access: "private-access-CAP03",
      refresh: "private-refresh-CAP03",
      expires: 42,
      scopes: [
        "openid",
        "profile",
        "email",
        "offline_access",
        "resource.invoke",
        "chatgpt.tokens.use.direct",
        "private-custom-scope-CAP03",
      ],
      extra: { token: "private-extension-CAP03" },
    }));
    const input = '{"profile":"iso","email":"not a credential"}';
    for (const store of [h.store, h.reload()]) {
      await store.load();
      expect(store.scrub(input)).toBe(input);
      expect(store.knownSecrets()).not.toContain("profile");
      for (const secret of [
        "private-access-CAP03",
        "private-refresh-CAP03",
        "private-custom-scope-CAP03",
        "private-extension-CAP03",
      ])
        expect(store.scrub(secret)).toBe("[REDACTED]");
    }
  });
  it("serializes async modify and delete, undefined leaves unchanged, failures recover", async () => {
    const h = harness();
    await h.store.modify("openai", async () => ({ type: "api_key", key: "0" }));
    await Promise.all(
      Array.from({ length: 20 }, () =>
        h.store.modify("openai", async (current) => {
          await Promise.resolve();
          return { type: "api_key", key: String(Number(current?.type === "api_key" ? current.key : 0) + 1) };
        }),
      ),
    );
    expect(await h.store.read("openai")).toEqual({ type: "api_key", key: "20" });
    const raw = h.disk.get("/data/credentials.json");
    expect(await h.store.modify("openai", async () => undefined)).toEqual({ type: "api_key", key: "20" });
    expect(h.disk.get("/data/credentials.json")).toBe(raw);
    const callbackError = new Error(secret);
    await expect(
      h.store.modify("openai", async () => {
        throw callbackError;
      }),
    ).rejects.toBe(callbackError);
    const cancellation = new DOMException("refresh cancelled", "AbortError");
    await expect(
      h.store.modify("openai", async () => {
        throw cancellation;
      }),
    ).rejects.toBe(cancellation);
    expect(h.disk.get("/data/credentials.json")).toBe(raw);
    await Promise.all([
      h.store.modify("openai", async () => ({ type: "api_key", key: secret })),
      h.store.delete("openai"),
    ]);
    expect(await h.store.read("openai")).toBeUndefined();
    expect(await h.reload().list()).toEqual([]);
  });
  it.each([
    [false, "unknown"],
    [true, "basic_text"],
  ])("requires explicit weak-storage choice available=%s backend=%s", async (available, backend) => {
    const h = harness(available, backend);
    await expect(
      h.store.modify("openai", async () => ({ type: "api_key", key: secret })),
    ).rejects.toMatchObject({ code: "DENIED" });
    expect(h.disk.size).toBe(0);
    await h.store.modify("openai", async () => ({ type: "api_key", key: secret }), { storageConsent: false });
    expect(await h.store.read("openai")).toEqual({ type: "api_key", key: secret });
    expect(h.disk.size).toBe(0);
    expect(await h.reload().read("openai")).toBeUndefined();
    expect(h.store.storage("openai")).toBe("memory");
    await h.store.modify("openai", async () => ({ type: "api_key", key: secret }), { storageConsent: true });
    expect(await h.reload().read("openai")).toEqual({ type: "api_key", key: secret });
    expect(h.crypto.encryptString).toHaveBeenCalledTimes(available ? 1 : 0);
    expect(h.store.storage("openai")).toBe("unprotected");
  });
  it("refusal replaces a disk key with memory only, while preserving other slots", async () => {
    const h = harness(true, "basic_text");
    await h.store.modify("other", async () => ({ type: "api_key", key: "fake-other-private" }), {
      storageConsent: true,
    });
    await h.store.modify("openai", async () => ({ type: "api_key", key: "fake-old-private" }), {
      storageConsent: true,
    });
    const reload = h.reload();
    await reload.modify("openai", async () => ({ type: "api_key", key: secret }), { storageConsent: false });
    expect(await h.reload().read("openai")).toBeUndefined();
    expect(await h.reload().read("other")).toEqual({ type: "api_key", key: "fake-other-private" });
  });
  it.each([
    // Version 1 is the only credentials format during development (AGENTS.md).
    '{"schemaVersion":2,"entries":{}}',
    "broken",
  ])("starts empty on a damaged file %s and keeps a copy of it", async (raw) => {
    const h = harness();
    h.disk.set("/data/credentials.json", raw);
    expect(await h.store.list()).toEqual([]);
    expect(h.disk.get("/data/credentials.json")).toBe(raw);
    expect(h.disk.get("/data/credentials.json.damaged")).toBe(raw);
    expect(h.logger.log).toHaveBeenCalledWith("warn", "credentials.file.damaged");
    await h.store.modify("openai", async () => ({ type: "api_key", key: secret }));
    expect(await h.reload().read("openai")).toEqual({ type: "api_key", key: secret });
    expect(h.disk.get("/data/credentials.json.damaged")).toBe(raw);
  });
  it("loads the readable entries, skips and keeps the unreadable ones, and lets them be entered again", async () => {
    const h = harness();
    await h.store.modify("openai", async () => ({ type: "api_key", key: secret }));
    await h.store.modify("mqtt:bench", async () => ({ type: "api_key", key: "fake-broker-private" }));
    const document = JSON.parse(h.disk.get("/data/credentials.json") ?? "");
    const undecryptable = document.entries["mqtt:bench"];
    document.entries.malformed = { encoding: "safeStorage", value: "invalid%" };
    h.disk.set("/data/credentials.json", JSON.stringify(document));
    h.crypto.decryptString.mockImplementation((value: Buffer) => {
      const text = Buffer.from(value.map((x) => x ^ 0x5a)).toString();
      if (text.includes("fake-broker-private")) throw new Error("keyring cannot decrypt");
      return text;
    });
    const store = h.reload();
    expect(await store.list()).toEqual([{ providerId: "openai", type: "api_key" }]);
    expect(await store.read("mqtt:bench")).toBeUndefined();
    expect(h.logger.log.mock.calls).toEqual([
      ["warn", "credentials.entries.skipped", { ids: ["mqtt:bench", "malformed"] }],
    ]);
    expect(h.files.writeAtomic).toHaveBeenCalledTimes(2);
    await store.modify("malformed", async () => ({ type: "api_key", key: "fake-entered-again" }));
    const saved = JSON.parse(h.disk.get("/data/credentials.json") ?? "");
    expect(saved.entries["mqtt:bench"]).toEqual(undecryptable);
    expect(await h.reload().list()).toEqual([
      { providerId: "openai", type: "api_key" },
      { providerId: "malformed", type: "api_key" },
    ]);
  });
  it("masks keys and passwords but not short values or user names and public ids", async () => {
    const h = harness();
    await h.store.modify("mqtt:bench", async () => ({
      type: "api_key",
      key: "fake-broker-private",
      env: { username: "bench-operator" },
    }));
    await h.store.modify("parts:digikey", async () => ({
      type: "api_key",
      key: "fake-client-secret",
      env: { id: "fake-client-id", token: "admin" },
    }));
    h.store.registerSecret("admin");
    expect(h.logger.registerSecret.mock.calls).toEqual([["fake-broker-private"], ["fake-client-secret"]]);
    for (const store of [h.store, h.reload()]) {
      await store.load();
      const text = "admin bench-operator fake-client-id";
      expect(store.scrub(text)).toBe(text);
      expect(store.containsSecret("admin")).toBe(false);
      expect(store.scrub("fake-broker-private fake-client-secret")).toBe("[REDACTED] [REDACTED]");
    }
  });
  it("failed atomic save and cancellation preserve both memory and disk and close drains mutations", async () => {
    const h = harness();
    await h.store.modify("openai", async () => ({ type: "api_key", key: secret }));
    const raw = h.disk.get("/data/credentials.json");
    h.files.writeAtomic.mockRejectedValueOnce(new Error(secret));
    await expect(
      h.store.modify("openai", async () => ({ type: "api_key", key: "fake-next-private" })),
    ).rejects.toMatchObject({ code: "INTERNAL" });
    expect(await h.store.read("openai")).toEqual({ type: "api_key", key: secret });
    expect(h.disk.get("/data/credentials.json")).toBe(raw);
    const abort = new AbortController();
    abort.abort();
    await expect(h.store.delete("openai", { signal: abort.signal })).rejects.toBeDefined();
    const pending = h.store.modify("openai", async () => ({ type: "api_key", key: "fake-final-private" }));
    await h.store.close();
    await pending;
    await expect(h.store.delete("openai")).rejects.toMatchObject({ code: "DENIED" });
    expect(await h.reload().read("openai")).toEqual({ type: "api_key", key: "fake-final-private" });
  });
  it("registers replaced/deleted/submitted secrets with scrub and real logger", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vera-credentials-"));
    try {
      const logger = createLogger(join(directory, "logs"), systemClock);
      const h = harness();
      const store = new CredentialFile({
        file: join(directory, "credentials.json"),
        files: createFileAccess(systemClock),
        crypto: h.crypto,
        logger,
        platform: "win32",
      });
      await store.modify("openai", async () => ({ type: "api_key", key: secret }));
      await store.modify("openai", async () => ({ type: "api_key", key: "fake-replaced-private" }));
      await store.delete("openai");
      logger.log("error", `provider failed ${secret}`, { detail: "fake-replaced-private" });
      await logger.flush();
      const output = await readFile(
        join(directory, "logs", `vera-${systemClock.now().toISOString().slice(0, 10)}.log`),
        "utf8",
      );
      expect(output).not.toContain(secret);
      expect(output).not.toContain("fake-replaced-private");
      expect(store.scrub(`error ${secret} fake-replaced-private`)).toBe("error [REDACTED] [REDACTED]");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
