import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterEach, expect, it, vi } from "vitest";
import { BrowserRuntime } from "./runtime.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return { ...fs, rm: vi.fn(fs.rm) };
});

const files = { "chrome/browser": strToU8("executable"), "chrome/resources.pak": strToU8("resources") };
const archive = zipSync(files);
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const spec = {
  version: "1.2.3.4",
  url: "https://storage.googleapis.com/chrome-for-testing-public/fixture.zip",
  executable: "chrome/browser",
  archiveBytes: archive.length,
  archiveSha256: sha256(archive),
  treeSha256: sha256(
    strToU8(
      Object.entries(files)
        .map(([name, bytes]) => `${name}\0${bytes.length}\0${sha256(bytes)}\n`)
        .join(""),
    ),
  ),
  executables: [],
};
const scratch: string[] = [];
afterEach(async () => {
  await Promise.all(scratch.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function setup(transfer = vi.fn<typeof fetch>(async () => new Response(archive.slice()))) {
  const root = await mkdtemp(join(tmpdir(), "vera-browser-runtime-test-"));
  scratch.push(root);
  return { root, transfer, runtime: new BrowserRuntime(root, { release: spec, transfer }) };
}

it("provisions only on demand and reuses a freshly verified tree", async () => {
  const { runtime, root, transfer } = await setup();
  expect(await runtime.inspect()).toEqual({ phase: "missing" });
  expect(transfer).not.toHaveBeenCalled();
  await expect(runtime.provision()).resolves.toEqual({ phase: "ready", version: spec.version });
  const path = await runtime.executable();
  expect(await readFile(path, "utf8")).toBe("executable");
  expect(await readdir(root)).toEqual([spec.version]);
  await runtime.provision();
  expect(transfer).toHaveBeenCalledExactlyOnceWith(spec.url, expect.objectContaining({ redirect: "error" }));
});

it("rejects corrupt downloads and modifications to the installed files", async () => {
  const { runtime, root, transfer } = await setup();
  transfer.mockResolvedValueOnce(new Response(new Uint8Array(archive.length)));
  await expect(runtime.provision()).resolves.toMatchObject({
    phase: "failed",
    failure: { code: "integrity" },
  });
  expect(await readdir(root)).toEqual([]);
  await runtime.provision();
  const path = await runtime.executable();
  await writeFile(path, "modified");
  await expect(runtime.executable()).rejects.toMatchObject({ code: "integrity" });
  expect(runtime.view()).toEqual({ phase: "failed", failure: "integrity" });
  await expect(runtime.provision()).resolves.toMatchObject({ phase: "ready" });
  expect(await readFile(path, "utf8")).toBe("executable");
});

it("reports download progress and drains a shared cancelled transfer before retry", async () => {
  const transfer = vi.fn<typeof fetch>((_url, options) => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(archive.slice(0, 2));
        options?.signal?.addEventListener("abort", () => controller.error(options.signal?.reason), {
          once: true,
        });
      },
    });
    return Promise.resolve(new Response(body));
  });
  const { runtime, root } = await setup(transfer);
  const installation = runtime.provision();
  expect(runtime.provision()).toBe(installation);
  await vi.waitFor(() =>
    expect(runtime.status()).toEqual({ phase: "downloading", received: 2, total: archive.length }),
  );
  await runtime.cancel();
  await expect(installation).resolves.toEqual({ phase: "cancelled" });
  expect(await readdir(root)).toEqual([]);
  transfer.mockResolvedValueOnce(new Response(archive.slice()));
  await expect(runtime.provision()).resolves.toMatchObject({ phase: "ready" });
});

it("drains browser resources before removal and blocks overlapping installation", async () => {
  const { runtime, root, transfer } = await setup();
  await runtime.provision();
  let finishDrain = () => {};
  const drain = new Promise<void>((resolve) => {
    finishDrain = resolve;
  });
  const removal = runtime.remove(() => drain);
  expect(runtime.remove(async () => {})).toBe(removal);
  expect(runtime.view()).toEqual({ phase: "removing" });
  await expect(runtime.provision()).resolves.toEqual({ phase: "removing" });
  await expect(runtime.executable()).rejects.toMatchObject({ code: "cancelled" });
  expect(await readdir(root)).toEqual([spec.version]);
  finishDrain();
  await expect(removal).resolves.toEqual({ phase: "missing" });
  expect(await readdir(root)).toEqual([]);
  expect(transfer).toHaveBeenCalledTimes(1);
});

it("keeps the runtime when owned browser cleanup fails and allows removal to be retried", async () => {
  const { runtime, root } = await setup();
  await runtime.provision();
  await runtime.remove(async () => {
    throw new Error("Owned browser cleanup failed");
  });
  expect(runtime.view()).toEqual({ phase: "failed", failure: "cleanup" });
  expect(await readdir(root)).toEqual([spec.version]);
  await expect(runtime.remove(async () => {})).resolves.toEqual({ phase: "missing" });
});

it("reports an interrupted transfer with recovery instructions and no published files", async () => {
  const { runtime, root } = await setup(
    vi.fn<typeof fetch>().mockRejectedValue(new TypeError("transfer interrupted")),
  );
  await expect(runtime.provision()).resolves.toMatchObject({
    phase: "failed",
    failure: { code: "download", recovery: expect.any(String) },
  });
  expect(await readdir(root)).toEqual([]);
});

it("surfaces failed staging cleanup during shutdown even if download was cancelled", async () => {
  const transfer = vi.fn<typeof fetch>((_url, options) => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(archive.slice(0, 2));
        options?.signal?.addEventListener("abort", () => controller.error(options.signal?.reason), {
          once: true,
        });
      },
    });
    return Promise.resolve(new Response(body));
  });
  const { runtime } = await setup(transfer);
  const installation = runtime.provision();
  await vi.waitFor(() => expect(runtime.status()).toMatchObject({ phase: "downloading", received: 2 }));
  vi.mocked(rm).mockRejectedValueOnce(Object.assign(new Error("Access refused"), { code: "EPERM" }));
  await expect(runtime.cancel()).rejects.toMatchObject({ code: "cleanup" });
  const failed = await installation;
  expect(failed).toMatchObject({ phase: "failed", failure: { code: "cleanup" } });
  await expect(runtime.inspect()).resolves.toEqual(failed);
  vi.mocked(rm).mockRejectedValueOnce(Object.assign(new Error("Access refused"), { code: "EPERM" }));
  await expect(runtime.shutdown()).rejects.toMatchObject({ code: "cleanup" });
});
