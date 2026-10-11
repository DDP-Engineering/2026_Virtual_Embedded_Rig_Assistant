import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createPackage } from "@electron/asar";
import { expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

it("verifies immutable model assets and refuses altered cache/downloads or escaping paths", async () => {
  const script = join(root, "scripts/prepare-model.mjs");
  expect(existsSync(script), "verified model materializer is implemented").toBe(true);
  const { prepareModel } = await import(pathToFileURL(script).href);
  const dir = await mkdtemp(join(tmpdir(), "vera-model-test-"));
  const bytes = Buffer.from("model-fixture");
  const file = {
    path: "config.json",
    url: `https://huggingface.co/test/resolve/${"a".repeat(40)}/config.json`,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.length,
  };
  const manifest = { revision: "a".repeat(40), modelId: "fixture", files: [file] };
  let requests = 0;
  const fetchImpl = async () => {
    requests += 1;
    return new Response(bytes);
  };
  try {
    await prepareModel(manifest, dir, { fetchImpl });
    expect(await readFile(join(dir, "fixture/config.json"))).toEqual(bytes);
    await prepareModel(manifest, dir, { fetchImpl, offline: true });
    expect(requests).toBe(1);
    await writeFile(join(dir, "fixture/config.json"), "tampered");
    await expect(prepareModel(manifest, dir, { fetchImpl })).rejects.toThrow(/integrity/);
    expect(requests).toBe(1);
    await rm(join(dir, "fixture/config.json"));
    await expect(
      prepareModel(manifest, dir, { fetchImpl: async () => new Response("wrong") }),
    ).rejects.toThrow(/integrity/);
    expect(existsSync(join(dir, "fixture/config.json"))).toBe(false);
    await expect(prepareModel(manifest, dir, { offline: true })).rejects.toThrow(/missing/);
    await expect(
      prepareModel({ ...manifest, files: [{ ...file, path: "../../escape" }] }, dir, { fetchImpl }),
    ).rejects.toThrow(/path/);
    await expect(
      prepareModel(
        { ...manifest, files: [{ ...file, url: "https://huggingface.co/test/resolve/main/config.json" }] },
        dir,
        { fetchImpl },
      ),
    ).rejects.toThrow(/immutable/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("measures package contributions and rejects Windows artifacts over the size budget", async () => {
  const script = join(root, "scripts/package.mjs");
  expect(existsSync(script), "packaging measurements are implemented").toBe(true);
  const { enforceBudget, measureDirectory } = await import(pathToFileURL(script).href);
  const dir = await mkdtemp(join(tmpdir(), "vera-package-test-"));
  try {
    await writeFile(join(dir, "large.bin"), Buffer.alloc(12));
    expect((await measureDirectory(dir)).bytes).toBe(12);
    expect(() => enforceBudget("win32", 250_000_001, [{ path: "large.bin", bytes: 12 }])).toThrow(
      /large.bin/,
    );
    expect(() => enforceBudget("win32", 250_000_000, [])).not.toThrow();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("inspects real ASAR app code through native file separators in both build modes", async () => {
  const { inspectAppArchive, probeMarkers } = await import(
    pathToFileURL(join(root, "scripts/package.mjs")).href
  );
  const dir = await mkdtemp(join(tmpdir(), "vera-asar-test-"));
  const source = join(dir, "source");
  const archive = join(dir, "app.asar");
  try {
    await mkdir(join(source, "out/main"), { recursive: true });
    await writeFile(join(source, "out/main/index.js"), probeMarkers.join(";"));
    await createPackage(source, archive);
    expect((await inspectAppArchive(archive, true)).entries).toContain("/out/main/index.js");
    await expect(inspectAppArchive(archive, false)).rejects.toThrow(/Build boundary/);
    await writeFile(join(source, "out/main/index.js"), "export const testBuild = false;");
    await createPackage(source, archive);
    await expect(inspectAppArchive(archive, false)).resolves.toBeDefined();
    await expect(inspectAppArchive(archive, true)).rejects.toThrow(/Build boundary/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
