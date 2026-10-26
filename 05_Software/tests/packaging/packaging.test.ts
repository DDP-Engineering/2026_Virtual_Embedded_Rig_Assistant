import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createPackage } from "@electron/asar";
import { expect, it } from "vitest";
import { parse } from "yaml";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

it("materializes pinned app-local VC++ DLLs and refuses altered cache or untrusted sources", async () => {
  const { prepareWindowsRuntime } = await import(
    pathToFileURL(join(root, "scripts/prepare-windows-runtime.mjs")).href
  );
  const dir = await mkdtemp(join(tmpdir(), "vera-crt-test-"));
  const source = join(dir, "source"),
    target = join(dir, "target");
  const bytes = Buffer.from("pinned-runtime-fixture");
  const manifest = {
    files: [
      {
        path: "vcruntime140.dll",
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      },
    ],
  };
  try {
    await mkdir(source);
    await writeFile(join(source, "vcruntime140.dll"), bytes);
    await expect(
      prepareWindowsRuntime(manifest, target, { sourceDir: source, verifySource: async () => false }),
    ).rejects.toThrow(/signature/);
    await prepareWindowsRuntime(manifest, target, { sourceDir: source, verifySource: async () => true });
    expect(await readFile(join(target, "vcruntime140.dll"))).toEqual(bytes);
    await writeFile(join(target, "vcruntime140.dll"), "altered");
    await expect(
      prepareWindowsRuntime(manifest, target, { sourceDir: source, verifySource: async () => true }),
    ).rejects.toThrow(/integrity/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("configures native target pairs, distinct test identity and conditional mandatory signing", async () => {
  const { distributionConfig } = await import(pathToFileURL(join(root, "scripts/package.mjs")).href);
  const win = distributionConfig("win32", false, {});
  expect(win.win.target.map((t: { target: string }) => t.target)).toEqual(["nsis", "zip"]);
  expect(win.nsis).toMatchObject({ perMachine: false, oneClick: true, allowElevation: false });
  expect(win.win.signAndEditExecutable).toBe(false);
  const signed = distributionConfig("win32", false, { WIN_CSC_LINK: "fixture-certificate" });
  expect(signed.forceCodeSigning).toBe(true);
  expect(signed.win.signAndEditExecutable).toBe(true);
  for (const selectors of [
    { VERA_CERTIFICATE_SHA1: "fixture-thumbprint" },
    { VERA_CERTIFICATE_SUBJECT: "fixture-subject" },
    { VERA_CERTIFICATE_SHA1: "fixture-thumbprint", VERA_CERTIFICATE_SUBJECT: "fixture-subject" },
  ]) {
    const selected = distributionConfig("win32", false, selectors);
    expect(selected.forceCodeSigning).toBe(true);
    expect(selected.win.signtoolOptions).toEqual({
      ...(selectors.VERA_CERTIFICATE_SHA1 ? { certificateSha1: selectors.VERA_CERTIFICATE_SHA1 } : {}),
      ...(selectors.VERA_CERTIFICATE_SUBJECT
        ? { certificateSubjectName: selectors.VERA_CERTIFICATE_SUBJECT }
        : {}),
    });
  }
  expect(
    distributionConfig("linux", false, {}).linux.target.map((t: { target: string }) => t.target),
  ).toEqual(["AppImage", "deb"]);
  const test = distributionConfig("win32", true, {});
  expect(test.productName).toBe("VERA Test");
  expect(test.appId).not.toBe(win.appId);
  expect(test.artifactName).toContain("-test-");
});

it("rejects secrets and excessive paths without leaking secret values", async () => {
  const { inspectPayloadFiles } = await import(pathToFileURL(join(root, "scripts/package-checks.mjs")).href);
  const secret = `sk-proj-${"A".repeat(40)}`;
  const problems = inspectPayloadFiles([
    { path: "credentials.json", bytes: Buffer.from(`{"apiKey":"${secret}"}`) },
    { path: "out/main/index.js", bytes: Buffer.from(`const key = '${secret}';`) },
    { path: `${"x".repeat(161)}.txt`, bytes: Buffer.from("safe") },
  ]);
  expect(problems.join("\n")).toMatch(/secret.*credentials/);
  expect(problems.join("\n")).toMatch(/secret.*index/);
  expect(problems.join("\n")).toMatch(/path-length/);
  expect(problems.join("\n")).not.toContain(secret);
  expect(inspectPayloadFiles([{ path: "out/main/index.js", bytes: Buffer.from("safe") }])).toEqual([]);
});

it("requires native CPU files and rejects foreign native platform payloads", async () => {
  const { validateNativeFiles } = await import(pathToFileURL(join(root, "scripts/package-checks.mjs")).href);
  expect(() => validateNativeFiles([], "win32")).toThrow(/missing native/);
  const paths = [
    "node_modules/better-sqlite3/prebuilds/win32-x64.node",
    "node_modules/onnxruntime-node/bin/napi-v6/win32/x64/onnxruntime_binding.node",
    "node_modules/onnxruntime-node/bin/napi-v6/win32/x64/onnxruntime.dll",
    "node_modules/onnxruntime-node/bin/napi-v6/win32/x64/DirectML.dll",
    "node_modules/onnxruntime-node/bin/napi-v6/win32/x64/dxcompiler.dll",
    "node_modules/onnxruntime-node/bin/napi-v6/win32/x64/dxil.dll",
  ];
  expect(() => validateNativeFiles(paths, "win32")).not.toThrow();
  expect(() =>
    validateNativeFiles([...paths, "node_modules/better-sqlite3/prebuilds/linux-x64.node"], "win32"),
  ).toThrow(/foreign native/);
});

it("rejects missing, empty or altered individual PDF resources despite intact sibling assets", async () => {
  const { checkStagedPayload } = await import(pathToFileURL(join(root, "scripts/package-checks.mjs")).href);
  const dir = await mkdtemp(join(tmpdir(), "vera-pdf-payload-"));
  const stage = join(dir, "stage"),
    source = join(dir, "pdfjs");
  const native = "node_modules/onnxruntime-node/bin/napi-v6/linux/x64/";
  try {
    for (const path of [
      "node_modules/better-sqlite3/prebuilds/linux-x64.node",
      `${native}onnxruntime_binding.node`,
      `${native}libonnxruntime.so.1`,
    ]) {
      await mkdir(dirname(join(stage, path)), { recursive: true });
      await writeFile(join(stage, path), "native-fixture");
    }
    for (const directory of ["cmaps", "standard_fonts", "wasm"]) {
      for (const name of ["required.bin", "sibling.bin"]) {
        await mkdir(join(source, directory), { recursive: true });
        await mkdir(join(stage, "out/renderer/pdfjs", directory), { recursive: true });
        await writeFile(join(source, directory, name), "asset-fixture");
        await writeFile(join(stage, "out/renderer/pdfjs", directory, name), "asset-fixture");
      }
    }
    const check = () => checkStagedPayload(stage, "linux", { files: [] }, { pdfSource: source });
    await expect(check()).resolves.toMatchObject({ status: "passed" });
    for (const directory of ["cmaps", "standard_fonts", "wasm"]) {
      const path = join(stage, "out/renderer/pdfjs", directory, "required.bin");
      await rm(path);
      await expect(check()).rejects.toThrow(/missing PDF resource/);
      await writeFile(path, "");
      await expect(check()).rejects.toThrow(/PDF resource integrity/);
      await writeFile(path, "altered-private-content");
      await expect(check()).rejects.toThrow(/PDF resource integrity/);
      await writeFile(path, "asset-fixture");
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("rejects every release test hook including the audit environment name", async () => {
  const { verifyAppCode, documentWorkerMarkers } = await import(
    pathToFileURL(join(root, "scripts/package.mjs")).href
  );
  for (const marker of [
    "VERA_REPLAY_DIR",
    "VERA_TEST_DIALOG_PATH",
    "VERA_NETWORK_AUDIT",
    "VERA_TEST_CHATGPT",
  ])
    expect(() => verifyAppCode([...documentWorkerMarkers, marker].join(";"), false)).toThrow(
      /Build boundary/,
    );
});

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
  const { inspectAppArchive, probeMarkers, documentWorkerMarkers } = await import(
    pathToFileURL(join(root, "scripts/package.mjs")).href
  );
  const dir = await mkdtemp(join(tmpdir(), "vera-asar-test-"));
  const source = join(dir, "source");
  const archive = join(dir, "app.asar");
  try {
    await mkdir(join(source, "out/main"), { recursive: true });
    for (const directory of ["cmaps", "standard_fonts", "wasm"])
      await cp(
        join(root, "node_modules/pdfjs-dist", directory),
        join(source, "out/renderer/pdfjs", directory),
        {
          recursive: true,
          filter: (path) => !path.split(/[\\/]/).at(-1)?.startsWith("LICENSE"),
        },
      );
    await writeFile(join(source, "out/main/index.js"), [...probeMarkers, ...documentWorkerMarkers].join(";"));
    await createPackage(source, archive);
    expect((await inspectAppArchive(archive, true)).entries).toContain("/out/main/index.js");
    await expect(inspectAppArchive(archive, false)).rejects.toThrow(/Build boundary/);
    await writeFile(join(source, "out/main/index.js"), documentWorkerMarkers.join(";"));
    await createPackage(source, archive);
    await expect(inspectAppArchive(archive, false)).resolves.toBeDefined();
    await expect(inspectAppArchive(archive, true)).rejects.toThrow(/Build boundary/);
    await rm(join(source, "out/renderer/pdfjs/standard_fonts/FoxitSerif.pfb"));
    await createPackage(source, archive);
    await expect(inspectAppArchive(archive, false)).rejects.toThrow(/missing PDF resource/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("ships runtime resources without fictional workbench fixtures", async () => {
  const config = parse(await readFile(join(root, "src/apps/desktop/electron-builder.yml"), "utf8"));
  const shipped = config.extraResources.map((resource: { from: string }) => resource.from);
  expect(shipped).toContain("resources/models");
  expect(shipped).toContain("resources/model-manifest.json");
  expect(shipped.some((path: string) => /demo-board|fixtures/.test(path))).toBe(false);
});
