// REQ-SEC-1ffb429b, REQ-SEC-2fda27e4
import { expect, it, vi } from "vitest";
import { CredentialFile } from "./credentials.js";
import { PluginCredentialService, programCredentials } from "./plugin-credentials.js";

const PASSWORD = "broker-password-4711";
function harness(secure = true) {
  const disk = new Map<string, string>();
  const files = {
    read: vi.fn(async (p: string) => disk.get(p)),
    writeAtomic: vi.fn(async (p: string, value: string) => {
      disk.set(p, value);
    }),
  };
  const credentials = new CredentialFile({
    file: "/data/credentials.json",
    files,
    platform: "linux",
    crypto: {
      isEncryptionAvailable: () => secure,
      getSelectedStorageBackend: () => (secure ? "gnome_libsecret" : "basic_text"),
      encryptString: (value) => Buffer.from(Buffer.from(value).map((b) => b ^ 90)),
      decryptString: (value) => Buffer.from(value.map((b) => b ^ 90)).toString(),
    },
    logger: { log: vi.fn(), registerSecret: vi.fn(() => () => {}), flush: vi.fn(async () => {}) },
  });
  const changed = vi.fn();
  return {
    service: new PluginCredentialService("mqtt", { credentials, changed }),
    wokwi: new PluginCredentialService("wokwi", { credentials, changed }),
    credentials,
    disk,
    changed,
  };
}

it("stores, lists without secrets and removes an MQTT credential", async () => {
  const h = harness();
  expect(await h.service.list()).toEqual({ credentials: [], secureStorage: true });
  expect(await h.service.save({ ref: "bench", username: "bench-user", password: PASSWORD })).toEqual({
    status: "saved",
  });
  expect(await h.credentials.read("mqtt:bench")).toEqual({
    type: "api_key",
    key: PASSWORD,
    env: { username: "bench-user" },
  });
  const list = await h.service.list();
  expect(list).toEqual({ credentials: [{ ref: "bench", storage: "encrypted" }], secureStorage: true });
  expect(JSON.stringify(list)).not.toContain(PASSWORD);
  expect(JSON.stringify(list)).not.toContain("bench-user");
  expect([...h.disk.values()].join("")).not.toContain(PASSWORD);
  const port = programCredentials(h.credentials);
  expect(await port.has("mqtt", "bench")).toBe(true);
  expect(await port.read("mqtt", "bench")).toEqual({ username: "bench-user", password: PASSWORD });
  expect(await port.has("mqtt", "other")).toBe(false);
  expect(await h.service.remove({ ref: "bench" })).toEqual({});
  expect(await port.read("mqtt", "bench")).toBeUndefined();
  expect(h.changed).toHaveBeenCalledTimes(2);
});

it("asks for consent before weak storage and stores nothing until then", async () => {
  const h = harness(false);
  expect(await h.service.save({ ref: "bench", password: PASSWORD })).toEqual({ status: "consent-required" });
  expect(await h.credentials.read("mqtt:bench")).toBeUndefined();
  expect(await h.service.save({ ref: "bench", password: PASSWORD, storageConsent: true })).toEqual({
    status: "saved",
  });
  expect((await h.service.list()).credentials).toEqual([{ ref: "bench", storage: "unprotected" }]);
});

it("refuses invalid references and passwords with control characters", async () => {
  const h = harness();
  await expect(h.service.save({ ref: "Bad_Ref", password: PASSWORD })).rejects.toMatchObject({
    code: "INVALID",
  });
  await expect(h.service.save({ ref: "bench", password: "a\nb" })).rejects.toMatchObject({ code: "INVALID" });
  await expect(h.service.save({ ref: "bench", password: "" })).rejects.toMatchObject({ code: "INVALID" });
  await expect(h.service.remove({ ref: "../x" })).rejects.toMatchObject({ code: "INVALID" });
  expect(await h.service.list()).toEqual({ credentials: [], secureStorage: true });
});

it("stores a Wokwi token without a username and keeps the scopes apart", async () => {
  const h = harness();
  const TOKEN = "wokwi-ci-token-0815";
  await h.service.save({ ref: "bench", password: PASSWORD });
  expect(await h.wokwi.save({ ref: "bench", token: TOKEN })).toEqual({ status: "saved" });
  expect(await h.credentials.read("wokwi:bench")).toEqual({ type: "api_key", key: TOKEN });
  expect(await h.wokwi.list()).toEqual({
    credentials: [{ ref: "bench", storage: "encrypted" }],
    secureStorage: true,
  });
  expect(JSON.stringify(await h.wokwi.list())).not.toContain(TOKEN);
  const port = programCredentials(h.credentials);
  expect(await port.read("wokwi", "bench")).toEqual({ password: TOKEN });
  expect(await port.read("mqtt", "bench")).toEqual({ password: PASSWORD });
  await expect(h.wokwi.save({ ref: "bench", token: TOKEN, username: "x" })).rejects.toMatchObject({
    code: "INVALID",
  });
  await expect(h.wokwi.save({ ref: "bench", password: TOKEN })).rejects.toMatchObject({ code: "INVALID" });
  expect(await h.wokwi.remove({ ref: "bench" })).toEqual({});
  expect(await h.credentials.read("wokwi:bench")).toBeUndefined();
  expect(await h.credentials.read("mqtt:bench")).toBeDefined();
});

it("asks for consent before storing a Wokwi token weakly", async () => {
  const h = harness(false);
  expect(await h.wokwi.save({ ref: "ci", token: "t-1" })).toEqual({ status: "consent-required" });
  expect(await h.credentials.read("wokwi:ci")).toBeUndefined();
});
