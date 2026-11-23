import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import { createPackage } from "@electron/asar";
import { zipSync } from "fflate";
import { expect, it } from "vitest";
import { parse } from "yaml";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

it("materializes pinned app-local VC++ DLLs and refuses altered cache or untrusted sources", async () => {
  const { prepareWindowsRuntime } = await import(
    pathToFileURL(join(root, "../02_Tools/environment/prepare-windows-runtime.mjs")).href
  );
  const dir = await mkdtemp(join(tmpdir(), "vera-crt-test-"));
  const source = join(dir, "source"),
    target = join(dir, "target");
  const bytes = Buffer.from("pinned-runtime-fixture");
  const manifest = {
    version: "14.0.0.0",
    redistribution: "https://example.invalid/redistribution",
    license: "https://example.invalid/license",
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
    expect(await readFile(join(target, "NOTICE.txt"), "utf8")).toBe(
      "Microsoft Visual C++ Runtime x64 14.0.0.0.\nUnmodified runtime files, copyright Microsoft Corporation.\n" +
        "Redistribution: https://example.invalid/redistribution\nLicense terms: https://example.invalid/license\n",
    );
    await writeFile(join(target, "vcruntime140.dll"), "altered");
    await expect(
      prepareWindowsRuntime(manifest, target, { sourceDir: source, verifySource: async () => true }),
    ).rejects.toThrow(/integrity/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("configures native target pairs, distinct test identity and conditional mandatory signing", async () => {
  const { distributionConfig } = await import(
    pathToFileURL(join(root, "../02_Tools/release/package.mjs")).href
  );
  const win = distributionConfig("win32", false, {});
  expect(win.win.target.map((t: { target: string }) => t.target)).toEqual(["nsis", "zip"]);
  expect(win.nsis).toMatchObject({ perMachine: false, oneClick: true, allowElevation: false });
  expect(win.win.signAndEditExecutable).toBe(true);
  expect(win.win.signExecutable).toBe(false);
  const signed = distributionConfig("win32", false, { WIN_CSC_LINK: "fixture-certificate" });
  expect(signed.forceCodeSigning).toBe(true);
  expect(signed.win.signAndEditExecutable).toBe(true);
  expect(signed.win.signExecutable).toBe(true);
  for (const selectors of [
    { VERA_CERTIFICATE_SHA1: "fixture-thumbprint" },
    { VERA_CERTIFICATE_SUBJECT: "fixture-subject" },
    { VERA_CERTIFICATE_SHA1: "fixture-thumbprint", VERA_CERTIFICATE_SUBJECT: "fixture-subject" },
  ]) {
    const selected = distributionConfig("win32", false, selectors);
    expect(selected.forceCodeSigning).toBe(true);
    expect(selected.win.signExecutable).toBe(true);
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
  expect(test.win.signAndEditExecutable).toBe(true);
  expect(test.win.signExecutable).toBe(false);
  expect(test.appId).not.toBe(win.appId);
  expect(test.artifactName).toContain("-test-");
});

it("rejects secrets and excessive paths without leaking secret values", async () => {
  const { inspectPayloadFiles } = await import(
    pathToFileURL(join(root, "../02_Tools/release/package-checks.mjs")).href
  );
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
  const { validateNativeFiles } = await import(
    pathToFileURL(join(root, "../02_Tools/release/package-checks.mjs")).href
  );
  expect(() => validateNativeFiles([], "win32")).toThrow(/missing native/);
  const paths = [
    ...[
      "pty.node",
      "conpty.node",
      "conpty_console_list.node",
      "conpty/conpty.dll",
      "conpty/OpenConsole.exe",
    ].map((name) => `node_modules/node-pty/prebuilds/win32-x64/${name}`),
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
  const { checkStagedPayload } = await import(
    pathToFileURL(join(root, "../02_Tools/release/package-checks.mjs")).href
  );
  const dir = await mkdtemp(join(tmpdir(), "vera-pdf-payload-"));
  const stage = join(dir, "stage"),
    source = join(dir, "pdfjs");
  const native = "node_modules/onnxruntime-node/bin/napi-v6/linux/x64/";
  try {
    for (const path of [
      "node_modules/node-pty/prebuilds/linux-x64/pty.node",
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
    const check = () => checkStagedPayload(stage, "linux", { pdfSource: source });
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
    pathToFileURL(join(root, "../02_Tools/release/package.mjs")).href
  );
  // Any VERA_TEST_ name is refused, also one no list ever named.
  for (const marker of [
    "VERA_REPLAY_DIR",
    "VERA_NETWORK_AUDIT",
    "process.env.VERA_TEST_CATALOG_KEY",
    "process.env.VERA_TEST_NEVER_LISTED",
  ])
    expect(() => verifyAppCode([...documentWorkerMarkers, marker].join(";"), false)).toThrow(
      /Build boundary/,
    );
  const commented = [...documentWorkerMarkers, "  // fixture plugins come from VERA_TEST_PROGRAMS"];
  expect(() => verifyAppCode(commented.join("\n"), false)).not.toThrow();
});

it("loads the pinned q8 manifest for each registered model", async () => {
  const script = join(root, "../02_Tools/environment/prepare-model.mjs");
  const { readBundledModel } = await import(pathToFileURL(script).href);
  const models = [
    [
      "Xenova/bge-small-en-v1.5",
      "ea104dacec62c0de699686887e3f920caeb4f3e3",
      "cls",
      "Represent this sentence for searching relevant passages: ",
      "",
    ],
    [
      "Xenova/multilingual-e5-small",
      "761b726dd34fb83930e26aab4e9ac3899aa1fa78",
      "mean",
      "query: ",
      "passage: ",
    ],
  ] as const;
  for (const [modelId, revision, pooling, queryPrefix, passagePrefix] of models) {
    const manifest = await readBundledModel(modelId);
    expect(manifest).toMatchObject({
      schema: 1,
      modelId,
      revision,
      dtype: "q8",
      license: "MIT",
      embedding: { pooling, queryPrefix, passagePrefix, dimensions: 384, maxTokens: 512, normalize: true },
    });
    const paths = manifest.files.map((file: { path: string }) => file.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        "config.json",
        "tokenizer.json",
        "tokenizer_config.json",
        "onnx/model_quantized.onnx",
        "README.md",
      ]),
    );
    expect(
      manifest.files.every(
        (file: { url: string; path: string }) =>
          file.url === `https://huggingface.co/${modelId}/resolve/${revision}/${file.path}`,
      ),
    ).toBe(true);
  }
});

it("verifies immutable model assets and refuses altered cache/downloads or escaping paths", async () => {
  const script = join(root, "../02_Tools/environment/prepare-model.mjs");
  expect(existsSync(script), "verified model materializer is implemented").toBe(true);
  const { prepareModel } = await import(pathToFileURL(script).href);
  const dir = await mkdtemp(join(tmpdir(), "vera-model-test-"));
  const bytes = Buffer.from("model-fixture");
  const file = {
    path: "config.json",
    url: `https://huggingface.co/fixture/resolve/${"a".repeat(40)}/config.json`,
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
        { ...manifest, files: [{ ...file, url: "https://huggingface.co/fixture/resolve/main/config.json" }] },
        dir,
        { fetchImpl },
      ),
    ).rejects.toThrow(/immutable/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("measures package contributions without a size budget", async () => {
  const script = join(root, "../02_Tools/release/package.mjs");
  expect(existsSync(script), "packaging measurements are implemented").toBe(true);
  const packaging = await import(pathToFileURL(script).href);
  expect(packaging.enforceBudget).toBeUndefined();
  const dir = await mkdtemp(join(tmpdir(), "vera-package-test-"));
  try {
    await writeFile(join(dir, "large.bin"), Buffer.alloc(12));
    const measured = await packaging.measureDirectory(dir);
    expect(measured.bytes).toBe(12);
    expect(measured.files).toEqual([{ path: "large.bin", bytes: 12 }]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it.each(["instrumented", "release", "missing-pdf-resource", "missing-whisper-worker"] as const)(
  "inspects real ASAR app code through native file separators (%s)",
  async (scenario) => {
    const { inspectAppArchive, probeMarkers, documentWorkerMarkers } = await import(
      pathToFileURL(join(root, "../02_Tools/release/package.mjs")).href
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
      const markers =
        scenario === "instrumented" ? [...probeMarkers, ...documentWorkerMarkers] : documentWorkerMarkers;
      await writeFile(join(source, "out/main/index.js"), markers.join(";"));
      if (scenario !== "missing-whisper-worker")
        await writeFile(join(source, "out/main/whisper-worker.js"), "export {};");
      if (scenario === "missing-pdf-resource")
        await rm(join(source, "out/renderer/pdfjs/standard_fonts/FoxitSerif.pfb"));
      await createPackage(source, archive);
      if (scenario === "instrumented") {
        expect((await inspectAppArchive(archive, true)).entries).toContain("/out/main/index.js");
        await expect(inspectAppArchive(archive, false)).rejects.toThrow(/Build boundary/);
      } else if (scenario === "release") {
        await expect(inspectAppArchive(archive, false)).resolves.toBeDefined();
        await expect(inspectAppArchive(archive, true)).rejects.toThrow(/Build boundary/);
      } else {
        const message =
          scenario === "missing-whisper-worker" ? /Whisper worker missing/ : /missing PDF resource/;
        await expect(inspectAppArchive(archive, false)).rejects.toThrow(message);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);

it("names the files of a bundled catalog release that no index lists", async () => {
  const { unlistedBundledFiles } = await import(
    pathToFileURL(join(root, "../02_Tools/environment/prepare-plugins.mjs")).href
  );
  const dir = await mkdtemp(join(tmpdir(), "vera-bundled-extra-"));
  try {
    await writeFile(join(dir, "index.json"), JSON.stringify({ plugins: [{ url: "a-1.0.0.zip" }] }));
    await writeFile(join(dir, "index-stable.json"), JSON.stringify({ plugins: [{ url: "a-0.9.0.zip" }] }));
    for (const name of ["a-1.0.0.zip", "a-0.9.0.zip", "index-stable.json.sig"])
      await writeFile(join(dir, name), "x");
    expect(await unlistedBundledFiles(dir)).toEqual([]);
    await mkdir(join(dir, "nested"));
    await writeFile(join(dir, "nested/tool.bin"), "x");
    await writeFile(join(dir, "stray.txt"), "x");
    expect(await unlistedBundledFiles(dir)).toEqual(["nested/tool.bin", "stray.txt"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("names the files of a model or Windows runtime folder that its manifest does not name", async () => {
  const { unexpectedFiles } = await import(pathToFileURL(join(root, "../02_Tools/release/package.mjs")).href);
  const manifest = JSON.parse(
    await readFile(join(root, "src/models/Xenova/bge-small-en-v1.5/model-manifest.json"), "utf8"),
  );
  const expected = manifest.files.map((file: { path: string }) => `${manifest.modelId}/${file.path}`);
  const dir = await mkdtemp(join(tmpdir(), "vera-model-extra-"));
  try {
    for (const path of expected) {
      await mkdir(dirname(join(dir, path)), { recursive: true });
      await writeFile(join(dir, path), "x");
    }
    expect(await unexpectedFiles(dir, expected)).toEqual([]);
    await writeFile(join(dir, manifest.modelId, "onnx/model.onnx"), "x");
    await writeFile(join(dir, "stray.txt"), "x");
    expect(await unexpectedFiles(dir, expected)).toEqual([
      `${manifest.modelId}/onnx/model.onnx`,
      "stray.txt",
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("stages both pinned models with their licence notices in the installed layout", async () => {
  const { stageEmbeddingModels, unexpectedFiles } = await import(
    pathToFileURL(join(root, "../02_Tools/release/package.mjs")).href
  );
  const stage = await mkdtemp(join(tmpdir(), "vera-staged-model-"));
  try {
    await stageEmbeddingModels(stage);
    const models = join(stage, "resources/models");
    const carried = [];
    for (const model of ["Xenova/bge-small-en-v1.5", "Xenova/multilingual-e5-small"]) {
      const manifestPath = join(model, "model-manifest.json");
      const manifestBytes = await readFile(join(models, manifestPath));
      expect(manifestBytes).toEqual(await readFile(join(root, "src/models", manifestPath)));
      const manifest = JSON.parse(manifestBytes.toString("utf8"));
      expect(manifest.modelId).toBe(model);
      const noticePath = join(model, "LICENSE.txt");
      const licence = await readFile(join(models, noticePath), "utf8");
      expect(licence).toContain(model);
      expect(licence).toContain("MIT License");
      carried.push(`${model}/model-manifest.json`, `${model}/LICENSE.txt`);
      for (const file of manifest.files) {
        const bytes = await readFile(join(models, model, file.path));
        expect(bytes.length).toBe(file.bytes);
        expect(createHash("sha256").update(bytes).digest("hex")).toBe(file.sha256);
        carried.push(`${model}/${file.path}`);
      }
    }
    expect(await unexpectedFiles(models, carried)).toEqual([]);
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
});

it("ships runtime resources without fictional workbench fixtures", async () => {
  const config = parse(await readFile(join(root, "src/apps/desktop/electron-builder.yml"), "utf8"));
  const shipped = config.extraResources.map((resource: { from: string }) => resource.from);
  expect(shipped).toContain("resources/models");
  expect(shipped.some((path: string) => /demo-board|fixtures/.test(path))).toBe(false);
});

/** A one-file ustar archive, gzip-compressed, like uv's Linux release. */
function tarGz(name: string, data: Buffer): Buffer {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100);
  header.write("0000755\0", 100);
  header.write("0000000\0", 108);
  header.write("0000000\0", 116);
  header.write(`${data.length.toString(8).padStart(11, "0")}\0`, 124);
  header.write("00000000000\0", 136);
  header.write("        ", 148);
  header.write("0", 156);
  header.write("ustar\0", 257);
  header.write("00", 263);
  header.write(
    `${header
      .reduce((sum, byte) => sum + byte, 0)
      .toString(8)
      .padStart(6, "0")}\0 `,
    148,
  );
  const padding = Buffer.alloc((512 - (data.length % 512)) % 512);
  return gzipSync(Buffer.concat([header, data, padding, Buffer.alloc(1024)]));
}

// REQ-PLAT-c99d7918, REQ-SEC-1a151052
it("prepares the pinned uv for the build platform and refuses altered archives or binaries", async () => {
  const { prepareUv } = await import(
    pathToFileURL(join(root, "../02_Tools/environment/prepare-uv.mjs")).href
  );
  const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
  const binary = Buffer.from("uv-binary");
  const zip = Buffer.from(zipSync({ "uv.exe": binary, "uvx.exe": Buffer.from("uvx") }));
  const tgz = tarGz("uv-x86_64-unknown-linux-gnu/uv", binary);
  const release = "https://github.com/astral-sh/uv/releases/download/0.13.1/";
  const manifest = {
    version: "0.13.1",
    platforms: {
      "windows-x64": {
        url: `${release}uv-x86_64-pc-windows-msvc.zip`,
        sha256: sha(zip),
        member: "uv.exe",
        binary: "uv.exe",
        binarySha256: sha(binary),
      },
      "linux-x64": {
        url: `${release}uv-x86_64-unknown-linux-gnu.tar.gz`,
        sha256: sha(tgz),
        member: "uv-x86_64-unknown-linux-gnu/uv",
        binary: "uv",
        binarySha256: sha(binary),
      },
    },
  };
  const served = new Map([
    [manifest.platforms["windows-x64"].url, zip],
    [manifest.platforms["linux-x64"].url, tgz],
  ]);
  let requests = 0;
  const fetchImpl = async (url: string) => {
    requests += 1;
    return new Response(new Uint8Array(served.get(url) ?? Buffer.from("missing")));
  };
  const dir = await mkdtemp(join(tmpdir(), "vera-uv-test-"));
  try {
    for (const [platform, file] of [
      ["windows-x64", "uv.exe"],
      ["linux-x64", "uv"],
    ] as const) {
      await prepareUv(manifest, dir, { fetchImpl, platform });
      expect(await readFile(join(dir, platform, file))).toEqual(binary);
    }
    expect(requests).toBe(2);
    await rm(join(dir, "windows-x64", "uv.exe"));
    await prepareUv(manifest, dir, { fetchImpl, platform: "windows-x64", offline: true });
    expect(requests).toBe(2);
    // REQ-REL-21eeae69: pin changes reuse neither an older filename cache nor its binary.
    const newer = structuredClone(manifest);
    newer.version = "0.13.7";
    const newBinary = Buffer.from("new-uv-binary");
    const newZip = Buffer.from(zipSync({ "uv.exe": newBinary }));
    newer.platforms["windows-x64"].url = newer.platforms["windows-x64"].url.replace("0.13.1", "0.13.7");
    newer.platforms["windows-x64"].sha256 = sha(newZip);
    newer.platforms["windows-x64"].binarySha256 = sha(newBinary);
    served.set(newer.platforms["windows-x64"].url, newZip);
    await prepareUv(newer, dir, { fetchImpl, platform: "windows-x64" });
    expect(await readFile(join(dir, "windows-x64", "uv.exe"))).toEqual(newBinary);
    expect(requests).toBe(3);
    const fresh = await mkdtemp(join(tmpdir(), "vera-uv-bad-"));
    try {
      const wrongArchive = structuredClone(manifest);
      wrongArchive.platforms["windows-x64"].sha256 = "f".repeat(64);
      await expect(prepareUv(wrongArchive, fresh, { fetchImpl, platform: "windows-x64" })).rejects.toThrow(
        /uv archive integrity mismatch: uv-x86_64-pc-windows-msvc\.zip/,
      );
      const wrongBinary = structuredClone(manifest);
      wrongBinary.platforms["linux-x64"].binarySha256 = "e".repeat(64);
      await expect(prepareUv(wrongBinary, fresh, { fetchImpl, platform: "linux-x64" })).rejects.toThrow(
        /uv binary integrity mismatch: uv$/,
      );
      expect(existsSync(join(fresh, "windows-x64", "uv.exe"))).toBe(false);
      expect(existsSync(join(fresh, "linux-x64", "uv"))).toBe(false);
      const foreign = structuredClone(manifest);
      foreign.platforms["linux-x64"].url = "https://example.com/uv.tar.gz";
      await expect(prepareUv(foreign, fresh, { fetchImpl, platform: "linux-x64" })).rejects.toThrow(
        /Invalid pinned uv/,
      );
    } finally {
      await rm(fresh, { recursive: true, force: true });
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// REQ-PLAT-1ecf3d4f
it("stages the uv binary as a package resource and verifies the packaged bytes", async () => {
  const config = parse(await readFile(join(root, "src/apps/desktop/electron-builder.yml"), "utf8"));
  expect(config.extraResources).toContainEqual({ from: "resources/uv", to: "uv", filter: ["**/*"] });
  const { stageUv } = await import(pathToFileURL(join(root, "../02_Tools/release/package.mjs")).href);
  const { checkUvBinary } = await import(
    pathToFileURL(join(root, "../02_Tools/environment/prepare-uv.mjs")).href
  );
  const dir = await mkdtemp(join(tmpdir(), "vera-uv-stage-"));
  try {
    const binary = Buffer.from("uv-binary");
    const entry = { binary: "uv", binarySha256: createHash("sha256").update(binary).digest("hex") };
    await mkdir(join(dir, "source", "linux-x64"), { recursive: true });
    await writeFile(join(dir, "source", "linux-x64", "uv"), binary);
    const staged = await stageUv(join(dir, "stage"), entry, "linux-x64", join(dir, "source"));
    expect(staged).toBe(join(dir, "stage", "resources", "uv", "uv"));
    await expect(checkUvBinary(staged, entry)).resolves.toBeUndefined();
    await writeFile(staged, "tampered");
    await expect(checkUvBinary(staged, entry)).rejects.toThrow(/Packaged uv integrity mismatch: uv/);
    await expect(stageUv(join(dir, "other"), entry, "windows-x64", join(dir, "source"))).rejects.toThrow(
      /prepare:uv/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// REQ-PLAT-73bc566c
it("stages the app help as <resources>/help and refuses a help folder without the English index", async () => {
  const config = parse(await readFile(join(root, "src/apps/desktop/electron-builder.yml"), "utf8"));
  expect(config.extraResources).toContainEqual({ from: "resources/help", to: "help", filter: ["**/*.md"] });
  const { stageHelp } = await import(pathToFileURL(join(root, "../02_Tools/release/package.mjs")).href);
  const dir = await mkdtemp(join(tmpdir(), "vera-help-stage-"));
  try {
    await mkdir(join(dir, "help", "en"), { recursive: true });
    await writeFile(join(dir, "help", "en", "index.md"), "# VERA help\n");
    await stageHelp(join(dir, "stage"), join(dir, "help"));
    expect(await readFile(join(dir, "stage", "resources", "help", "en", "index.md"), "utf8")).toBe(
      "# VERA help\n",
    );
    await expect(stageHelp(join(dir, "other"), join(dir, "missing"))).rejects.toThrow(/help.*en.*index\.md/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
