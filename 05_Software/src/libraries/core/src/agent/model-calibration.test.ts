// REQ-NFR-4721c12f
import { join } from "node:path";
import { expect, it } from "vitest";
import type { FileAccess } from "../ports.js";
import { ModelCalibrationStore } from "./model-calibration.js";

it("reuses the latest valid sample only for the same provider, model and data folder", async () => {
  const records = new Map<string, string>();
  const files: FileAccess = {
    read: async (path) => records.get(path),
    writeAtomic: async (path, value) => {
      records.set(path, value);
    },
  };
  const root = join("data", "one");
  const provider = { slug: "cli", baseUrl: "http://localhost:1234/v1", protocol: "openai" };
  const open = () => new ModelCalibrationStore(root, files, () => [provider]);
  const first = open().forModel("custom:cli/org/model");
  await first.save(0.25);
  await first.save(0.31);
  await first.save(0.05);
  await first.save(Number.NaN);
  expect(await open().forModel("custom:cli/org/model").read()).toBe(0.31);
  expect(await open().forModel("custom:cli/org/another").read()).toBeUndefined();
  expect(await open().forModel("openai/org/model").read()).toBeUndefined();
  expect(
    await new ModelCalibrationStore(join("data", "two"), files, () => [provider])
      .forModel("custom:cli/org/model")
      .read(),
  ).toBeUndefined();
  expect(records.size).toBe(1);
  expect([...records.values()].map((value) => JSON.parse(value))).toEqual([{ format: 1, ratio: 0.31 }]);
  provider.baseUrl = "http://localhost:1235/v1";
  expect(await open().forModel("custom:cli/org/model").read()).toBeUndefined();
  expect(await first.read()).toBeUndefined();
  await first.save(0.42);
  provider.baseUrl = "http://localhost:1234/v1";
  expect(await open().forModel("custom:cli/org/model").read()).toBe(0.31);
});

it("treats an invalid or inaccessible cache as optional", async () => {
  let value = "";
  const files: FileAccess = {
    read: async () => value,
    writeAtomic: async () => {
      throw Error("disk unavailable");
    },
  };
  const record = new ModelCalibrationStore("data", files, () => []).forModel("openai/gpt");
  for (const invalid of ["{", '{"format":2,"ratio":0.2}', '{"format":1,"ratio":0.01}']) {
    value = invalid;
    expect(await record.read()).toBeUndefined();
  }
  await expect(record.save(0.25)).resolves.toBeUndefined();
  files.read = async () => {
    throw Error("disk unavailable");
  };
  await expect(record.read()).resolves.toBeUndefined();
});
