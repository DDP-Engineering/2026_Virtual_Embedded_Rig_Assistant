import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SettingsService } from "@vera/core";
import type { DictationModelId } from "@vera/shared";
import { afterEach, expect, it, vi } from "vitest";
import { createFileAccess } from "../file-access.js";
import { systemClock } from "../host-ports.js";
import { type DictationModelSpec, dictationCatalog } from "./catalog.js";
import { DictationModels } from "./models.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return { ...fs, rm: vi.fn(fs.rm) };
});

const payload = "test";
const files = ["config.json", "onnx/model.onnx"].map((path) => ({
  path,
  bytes: payload.length,
  sha256: createHash("sha256").update(payload).digest("hex"),
}));
const specs: DictationModelSpec[] = (["whisper-base", "whisper-small"] as const).map((id) => ({
  id,
  repository: `Xenova/${id}`,
  revision: "8".repeat(40),
  license: "Apache-2.0",
  dtype: "q8",
  files,
}));
const base = specs[0]!.id;
const small = specs[1]!.id;
const scratch: string[] = [];
afterEach(async () => {
  await Promise.all(scratch.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function harness() {
  const dir = await mkdtemp(join(tmpdir(), "vera-dictation-"));
  scratch.push(dir);
  const root = join(dir, "dictation-models");

  const makeSettings = () =>
    new SettingsService({
      paths: { userData: dir, settings: join(dir, "settings.json"), logs: join(dir, "logs") },
      uuid: randomUUID,
      changed: vi.fn(),
      files: createFileAccess(systemClock),
    });
  const transfer = vi.fn<typeof fetch>(async () => new Response(payload));
  const availableBytes = vi.fn(async () => 1024);
  const makeModels = (settings: SettingsService) =>
    new DictationModels(dir, settings, { catalog: specs, transfer, availableBytes });
  const settings = makeSettings();
  const models = makeModels(settings);
  const ready = async (id: DictationModelId) => {
    await models.change({ action: "download", id });
    await vi.waitFor(async () =>
      expect((await models.get()).models.find((model) => model.id === id)?.status).toBe("installed"),
    );
  };
  return { dir, root, settings, models, transfer, availableBytes, ready, makeSettings, makeModels };
}

it("pins both multilingual q8 pipelines to immutable versions and a complete file inventory", () => {
  expect(dictationCatalog.map(({ id }) => id)).toEqual([base, small]);
  for (const model of dictationCatalog) {
    expect(model).toMatchObject({ repository: `Xenova/${model.id}`, license: "Apache-2.0", dtype: "q8" });
    expect(model.revision).toMatch(/^[a-f0-9]{40}$/);
    expect(model.files.map(({ path }) => path).sort()).toEqual([
      "config.json",
      "generation_config.json",
      "onnx/decoder_model_merged_quantized.onnx",
      "onnx/encoder_model_quantized.onnx",
      "preprocessor_config.json",
      "tokenizer.json",
      "tokenizer_config.json",
    ]);
    expect(model.files.every((file) => file.bytes > 0 && /^[a-f0-9]{64}$/.test(file.sha256))).toBe(true);
  }
  expect(dictationCatalog.map((model) => model.files.reduce((sum, file) => sum + file.bytes, 0))).toEqual([
    79_677_901, 251_875_316,
  ]);
});

it("reports staged bytes, never publishes partial files, and can cancel then retry", async () => {
  const h = await harness();
  const encoder = new TextEncoder();
  h.transfer.mockImplementationOnce(
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode("te"));
          },
        }),
      ),
  );
  await h.models.change({ action: "download", id: base });
  await vi.waitFor(async () =>
    expect((await h.models.get()).models[0]).toMatchObject({
      status: "downloading",
      receivedBytes: 2,
      bytes: 8,
    }),
  );
  expect(existsSync(join(h.root, base))).toBe(false);
  await expect(h.models.change({ action: "select", id: base })).rejects.toMatchObject({ code: "BUSY" });
  expect((await h.models.change({ action: "cancel", id: base })).models[0]?.status).toBe("missing");
  expect(existsSync(join(h.root, `.${base}.stage`))).toBe(false);
  await h.ready(base);
  expect(await readFile(join(h.root, base, "onnx", "model.onnx"), "utf8")).toBe(payload);
});

it("cleans interrupted staging before reporting model availability", async () => {
  const h = await harness();
  const stage = join(h.root, `.${base}.stage`);
  await mkdir(stage, { recursive: true });
  await writeFile(join(stage, "config.json"), payload);
  await h.models.recover();
  expect(existsSync(stage)).toBe(false);
  expect((await h.models.get()).models[0]?.status).toBe("missing");
});

it.each([
  ["integrity", () => new Response("abcd")],
  ["integrity", () => new Response("oversized")],
  ["integrity", () => new Response("bad")],
  ["network", () => new Response(null, { status: 503 })],
  [
    "space",
    () => {
      throw Object.assign(new Error("full"), { code: "ENOSPC" });
    },
  ],
] as const)("reports %s transfer failures and retries", async (failure, response) => {
  const h = await harness();
  h.transfer.mockImplementationOnce(async () => response());
  await h.models.change({ action: "download", id: base });
  await vi.waitFor(async () =>
    expect((await h.models.get()).models[0]).toMatchObject({ status: "failed", failure }),
  );
  expect(existsSync(join(h.root, base))).toBe(false);
  expect(existsSync(join(h.root, `.${base}.stage`))).toBe(false);
  await h.ready(base);
});

it("reports insufficient space before fetching", async () => {
  const h = await harness();
  h.availableBytes.mockResolvedValueOnce(7);
  await h.models.change({ action: "download", id: base });
  await vi.waitFor(async () =>
    expect((await h.models.get()).models[0]).toMatchObject({
      status: "failed",
      failure: "space",
    }),
  );
  expect(h.transfer).not.toHaveBeenCalled();
});

it("persists only installed selections and spoken languages, resolves offline and clears on removal", async () => {
  const h = await harness();
  await expect(h.models.change({ action: "select", id: small })).rejects.toMatchObject({ code: "NOT_FOUND" });
  await h.ready(base);
  await h.ready(small);
  await h.models.change({ action: "select", id: base });
  expect(h.settings.get().settings.dictation?.selectedModel).toBe(base);
  await h.models.change({ action: "select", id: small });
  await h.models.change({ action: "language", language: "ro" });
  await h.models.close();
  await h.settings.close();
  h.transfer.mockRejectedValue(new Error("offline"));
  const settings = h.makeSettings();
  const models = h.makeModels(settings);
  expect(await models.resolveSelected()).toEqual({
    id: small,
    directory: join(h.root, small),
    dtype: "q8",
    language: "ro",
  });
  expect(settings.get().settings.language).toBe("system");
  await models.change({ action: "language", language: "auto" });
  await models.change({ action: "remove", id: small });
  expect((await models.get()).models.map(({ status }) => status)).toEqual(["installed", "missing"]);
  expect(await models.resolveSelected()).toBeNull();
  expect(existsSync(join(h.root, small))).toBe(false);
  const reopened = h.makeSettings();
  await reopened.load();
  expect(reopened.get().settings.dictation).toEqual({ selectedModel: null, language: "auto" });
});

it("withholds a model with modified or extra local files", async () => {
  const h = await harness();
  await h.ready(base);
  await h.models.change({ action: "select", id: base });
  await writeFile(join(h.root, base, "config.json"), "oops");
  expect(await h.models.resolveSelected()).toBeNull();
  const rejected = await h.models.get();
  expect(rejected).toMatchObject({
    selectedModel: null,
    models: [{ status: "corrupt" }, { status: "missing" }],
  });
  await h.ready(base);
  await writeFile(join(h.root, base, "processor_config.json"), "{}");
  expect((await h.models.get()).models[0]?.status).toBe("corrupt");
});

it("refuses unapproved redirects before connecting and accepts the pinned download CDN", async () => {
  const h = await harness();
  h.transfer.mockResolvedValueOnce(
    new Response(null, { status: 302, headers: { location: "https://huggingface.co.invalid/file" } }),
  );
  await h.models.change({ action: "download", id: base });
  await vi.waitFor(async () =>
    expect((await h.models.get()).models[0]).toMatchObject({ status: "failed", failure: "network" }),
  );
  expect(h.transfer).toHaveBeenCalledTimes(1);
  expect(String(h.transfer.mock.calls[0]?.[0])).toContain(`/resolve/${specs[0]?.revision}/`);
  h.transfer.mockResolvedValueOnce(
    new Response(null, { status: 302, headers: { location: "https://us.aws.cdn.hf.co/model" } }),
  );
  await h.ready(base);
  expect(h.transfer).toHaveBeenCalledWith(
    new URL("https://us.aws.cdn.hf.co/model"),
    expect.objectContaining({
      credentials: "omit",
      redirect: "manual",
    }),
  );
});

it("withholds model trees linked outside the application directory", async () => {
  const h = await harness();
  await h.ready(base);
  await h.models.change({ action: "select", id: base });
  const directory = join(h.root, base);
  const outside = join(h.dir, "other-data");
  await rename(directory, outside);
  await symlink(outside, directory, "junction");
  expect(await h.models.resolveSelected()).toBeNull();
  expect((await h.models.get()).models[0]?.status).toBe("corrupt");
  await h.models.change({ action: "remove", id: base });
  expect(await readFile(join(outside, "config.json"), "utf8")).toBe(payload);
});

it("recovers removal interrupted before clearing preferences", async () => {
  const h = await harness();
  await h.ready(base);
  await h.models.change({ action: "select", id: base });
  await h.models.close();
  const removed = join(h.root, `.${base}.removed`);
  await rename(join(h.root, base), removed);
  const reopened = h.makeSettings();
  expect((await h.makeModels(reopened).get()).selectedModel).toBeNull();
  expect(reopened.get().settings.dictation?.selectedModel).toBeNull();
  expect(existsSync(removed)).toBe(false);
});

it("restores the model when clearing the selected preference fails", async () => {
  const h = await harness();
  await h.ready(base);
  await h.models.change({ action: "select", id: base });
  const save = vi.spyOn(h.settings, "update").mockRejectedValueOnce(new Error("settings write failed"));
  await expect(h.models.change({ action: "remove", id: base })).rejects.toThrow("settings write failed");
  expect((await h.models.get()).selectedModel).toBe(base);
  save.mockRestore();
  expect((await h.models.change({ action: "remove", id: base })).selectedModel).toBeNull();
});

it("keeps a locked removal retryable without restoring the selected model", async () => {
  const h = await harness();
  await h.ready(base);
  await h.models.change({ action: "select", id: base });
  const removed = join(h.root, `.${base}.removed`);
  const fs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  const busy = Object.assign(new Error("file is locked"), { code: "EPERM" });
  await vi.mocked(rm).withImplementation(
    async (path, options) => {
      if (path === removed && existsSync(removed)) throw busy;
      await fs.rm(path, options);
    },
    async () => {
      const result = await h.models.change({ action: "remove", id: base });
      expect(result.selectedModel).toBeNull();
      expect(result.models[0]?.status).toBe("removal-failed");
      expect(existsSync(removed)).toBe(true);
      expect(await h.models.resolveSelected()).toBeNull();
      await expect(h.models.change({ action: "download", id: base })).rejects.toMatchObject({ code: "BUSY" });
    },
  );
  const cleaned = await h.models.change({ action: "remove", id: base });
  expect(cleaned.selectedModel).toBeNull();
  expect(cleaned.models[0]?.status).toBe("missing");
  expect(existsSync(removed)).toBe(false);
  const reopened = h.makeSettings();
  await reopened.load();
  expect(reopened.get().settings.dictation?.selectedModel).toBeNull();
});
