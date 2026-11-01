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
});
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
    '{"schemaVersion":1,"entries":{"openai":{"encoding":"safeStorage","value":"invalid%"}}}',
  ])("preserves invalid bytes %s", async (raw) => {
    const h = harness();
    h.disk.set("/data/credentials.json", raw);
    await expect(h.store.read("openai")).rejects.toMatchObject({ code: "INVALID" });
    await expect(
      h.store.modify("openai", async () => ({ type: "api_key", key: secret })),
    ).rejects.toBeDefined();
    expect(h.disk.get("/data/credentials.json")).toBe(raw);
    expect(h.files.writeAtomic).not.toHaveBeenCalled();
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
