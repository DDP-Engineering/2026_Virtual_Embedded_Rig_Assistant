import { PartsHttpError, SettingsService, type SupplierAdapter } from "@vera/core";
import { type PartsCredential, partsSearchDefaults } from "@vera/shared";
import { expect, it, vi } from "vitest";
import { CredentialFile } from "./credentials.js";
import { PartsAccessService } from "./parts-access.js";

const KEY = "mouser-private-key-12345";
const DK = { id: "digikey-client-id-777", secret: "digikey-client-secret-888" };
const testId = "6f1c1f9e-6b4c-4b8e-9a59-0d1c2b3a4f5e";
const preferences = (enabled: string[] = ["mouser"]) => {
  const value = structuredClone(partsSearchDefaults);
  for (const id of enabled) value.suppliers[id as keyof typeof value.suppliers].enabled = true;
  return value;
};
const item = {
  manufacturer: "Infineon",
  mpn: "BSS806NE",
  package: null,
  description: null,
  lifecycle: null,
  datasheetUrl: null,
  parameters: [],
  offer: {
    sku: "726-X",
    packaging: null,
    stock: 5,
    moq: 1,
    multiple: 1,
    leadTime: null,
    currency: "EUR",
    region: null,
    productUrl: null,
    priceBreaks: [],
  },
};
async function harness(secure = true) {
  const disk = new Map<string, string>();
  const files = {
    read: vi.fn(async (p: string) => disk.get(p)),
    writeAtomic: vi.fn(async (p: string, value: string) => {
      disk.set(p, value);
    }),
  };
  const settings = new SettingsService({
    files,
    paths: { userData: "/data", settings: "/data/settings.json", logs: "/data/logs" },
    uuid: () => "1b9dc50c-d87d-484b-88e6-04cb5f7c5a19",
    changed: vi.fn(),
  });
  await settings.load();
  const logged: string[] = [];
  const credentials = new CredentialFile({
    file: "/data/credentials.json",
    files,
    platform: "win32",
    crypto: {
      isEncryptionAvailable: () => secure,
      getSelectedStorageBackend: () => "unknown",
      encryptString: (value) => Buffer.from(Buffer.from(value).map((b) => b ^ 90)),
      decryptString: (value) => Buffer.from(value.map((b) => b ^ 90)).toString(),
    },
    logger: {
      log: vi.fn((line: unknown) => void logged.push(JSON.stringify(line))),
      registerSecret: vi.fn(() => () => {}),
      flush: vi.fn(async () => {}),
    },
  });
  const seen: PartsCredential[] = [];
  let next: (signal: AbortSignal) => Promise<void> = async () => {};
  const adapter: SupplierAdapter = {
    async search(_request, { credential }, signal) {
      seen.push(credential);
      await next(signal);
      return { items: [item], partial: false, errors: [] };
    },
  };
  const digikey: SupplierAdapter = {
    token: async () => ({ value: "dk-token", expiresIn: 600 }),
    async search(_request, { credential }) {
      seen.push(credential);
      return { items: [], partial: false, errors: [] };
    },
  };
  const changed = vi.fn();
  const service = new PartsAccessService({
    settings,
    credentials,
    changed,
    adapters: { mouser: adapter, digikey },
    now: () => new Date("2026-11-13T10:00:00Z"),
  });
  return {
    service,
    settings,
    credentials,
    disk,
    seen,
    changed,
    logged,
    setNext: (fn: typeof next) => (next = fn),
  };
}

it("stores supplier credentials apart from the settings and never shows them in the snapshot", async () => {
  const h = await harness();
  expect(await h.service.get()).toMatchObject({
    preferences: partsSearchDefaults,
    keys: { mouser: { keyConfigured: false } },
  });
  expect(
    await h.service.save({
      preferences: preferences(["mouser", "digikey"]),
      supplier: "mouser",
      credential: { secret: KEY },
    }),
  ).toEqual({ status: "saved" });
  await h.service.save({
    preferences: preferences(["mouser", "digikey"]),
    supplier: "digikey",
    credential: DK,
  });
  const snapshot = await h.service.get();
  expect(snapshot.keys).toMatchObject({
    mouser: { keyConfigured: true, storage: "encrypted" },
    digikey: { keyConfigured: true },
    tme: { keyConfigured: false },
  });
  expect(snapshot.preferences.suppliers.digikey.enabled).toBe(true);
  for (const secret of [KEY, DK.id, DK.secret]) {
    expect(JSON.stringify(snapshot)).not.toContain(secret);
    expect(JSON.stringify(h.settings.get())).not.toContain(secret);
    expect(h.disk.get("/data/settings.json")).not.toContain(secret);
    expect(h.disk.get("/data/credentials.json")).not.toContain(secret);
    expect(h.logged.join("\n")).not.toContain(secret);
  }
  const result = await h.service.provider.search({ query: "mosfet" }, new AbortController().signal);
  expect(h.seen).toEqual([{ secret: KEY }, { secret: DK.secret, id: DK.id }]);
  for (const secret of [KEY, DK.id, DK.secret, "dk-token"])
    expect(JSON.stringify(result)).not.toContain(secret);
  expect(h.changed).toHaveBeenCalledTimes(2);
  await expect(
    h.service.save({
      preferences: preferences(),
      supplier: "digikey",
      credential: { secret: "only-secret" },
    }),
  ).rejects.toMatchObject({ code: "INVALID" });
});
it("asks for consent before unprotected storage and stores nothing until then", async () => {
  const h = await harness(false);
  expect(
    await h.service.save({ preferences: preferences(), supplier: "mouser", credential: { secret: KEY } }),
  ).toEqual({ status: "consent-required" });
  expect((await h.service.get()).keys.mouser.keyConfigured).toBe(false);
  expect(h.settings.get().settings.partsSearch).toBeUndefined();
  await h.service.save({
    preferences: preferences(),
    supplier: "mouser",
    credential: { secret: KEY },
    storageConsent: true,
  });
  expect((await h.service.get()).keys.mouser).toEqual({ keyConfigured: true, storage: "unprotected" });
  await h.service.removeKey({ supplier: "mouser" });
  expect((await h.service.get()).keys.mouser.keyConfigured).toBe(false);
  const after = await h.service.provider.search({ query: "mosfet" }, new AbortController().signal);
  expect(after.suppliers[0]).toMatchObject({ supplier: "mouser", status: "key-required" });
});
it("ends a search in flight when the settings are saved or a key is removed", async () => {
  const h = await harness();
  await h.service.save({ preferences: preferences(), supplier: "mouser", credential: { secret: KEY } });
  h.setNext(
    (signal) =>
      new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason))),
  );
  for (const change of [
    () => h.service.save({ preferences: preferences() }),
    () => h.service.removeKey({ supplier: "mouser" }),
  ]) {
    const pending = h.service.provider.search({ query: "mosfet" }, new AbortController().signal);
    await vi.waitFor(() => expect(h.seen.length).toBeGreaterThan(0));
    h.seen.length = 0;
    await change();
    await expect(pending).rejects.toMatchObject({ reason: "cancelled" });
    await h.service.save({ preferences: preferences(), supplier: "mouser", credential: { secret: KEY } });
  }
});
it("tests a supplier and reports each outcome", async () => {
  const h = await harness();
  const run = () => h.service.test({ testId, supplier: "mouser" });
  expect(await run()).toMatchObject({
    status: "key-required",
    supplier: "mouser",
    checkedAt: "2026-11-13T10:00:00.000Z",
  });
  await h.service.save({ preferences: preferences([]), supplier: "mouser", credential: { secret: KEY } });
  expect(await run()).toMatchObject({ status: "ok" });
  for (const kind of ["auth", "rate-limited", "timeout"] as const) {
    h.setNext(async () => {
      throw new PartsHttpError(kind);
    });
    expect(await run()).toMatchObject({ status: kind });
  }
  h.setNext(
    (signal) =>
      new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason))),
  );
  const held = run();
  await expect(run()).rejects.toMatchObject({ code: "BUSY" });
  await vi.waitFor(() => expect(h.seen.length).toBeGreaterThan(3));
  h.service.cancelTest({ testId });
  expect(await held).toMatchObject({ status: "cancelled" });
  h.setNext(async () => {});
  await h.settings.update({ webAccess: { ...h.settings.get().settings.webAccess, enabled: false } });
  expect(await run()).toMatchObject({ status: "disabled" });
  await h.service.close();
  await expect(run()).rejects.toMatchObject({ code: "DENIED" });
});
