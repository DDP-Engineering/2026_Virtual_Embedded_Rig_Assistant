import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkPdfResources,
  checkStagedPayload,
  foreignNative,
  inspectPayloadFiles,
  releaseHookMarkers,
  validateNativeFiles,
} from "./package-checks.mjs";
import { prepareBundledModel } from "./prepare-model.mjs";
import { prepareBundledWindowsRuntime } from "./prepare-windows-runtime.mjs";
import { updatePublish } from "./update-config.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
export const probeMarkers = ["packaging-probe", "I2C1_CR1"];
export const documentWorkerMarkers = ["allowRemoteModels", "document-embedding-worker"];

export function distributionConfig(platform, testBuild, env) {
  const signed =
    platform === "win32" &&
    Boolean(env.WIN_CSC_LINK || env.CSC_LINK || env.VERA_CERTIFICATE_SHA1 || env.VERA_CERTIFICATE_SUBJECT);
  return {
    appId: `engineering.ddp.vera${testBuild ? ".test" : ""}`,
    productName: testBuild ? "VERA Test" : "VERA",
    executableName: testBuild ? "vera-test" : "vera",
    artifactName: `VERA${testBuild ? "-test" : ""}-\${version}-\${os}-\${arch}.\${ext}`,
    forceCodeSigning: signed,
    publish: updatePublish(env.VERA_UPDATE_URL, testBuild),
    generateUpdatesFilesForAllChannels: true,
    win: {
      target: [
        { target: "nsis", arch: ["x64"] },
        { target: "zip", arch: ["x64"] },
      ],
      signAndEditExecutable: signed,
      ...(env.VERA_CERTIFICATE_SHA1 || env.VERA_CERTIFICATE_SUBJECT
        ? {
            signtoolOptions: {
              ...(env.VERA_CERTIFICATE_SHA1 ? { certificateSha1: env.VERA_CERTIFICATE_SHA1 } : {}),
              ...(env.VERA_CERTIFICATE_SUBJECT
                ? { certificateSubjectName: env.VERA_CERTIFICATE_SUBJECT }
                : {}),
            },
          }
        : {}),
    },
    nsis: { perMachine: false, oneClick: true, allowElevation: false, deleteAppDataOnUninstall: false },
    linux: {
      target: [
        { target: "AppImage", arch: ["x64"] },
        { target: "deb", arch: ["x64"] },
      ],
      category: "Development",
      maintainer: "DDP Engineering",
    },
  };
}

export async function measureDirectory(directory) {
  const files = [];
  async function walk(path, prefix = "") {
    for (const item of await readdir(path, { withFileTypes: true })) {
      const name = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.isDirectory()) await walk(join(path, item.name), name);
      else if (item.isFile()) files.push({ path: name, bytes: (await stat(join(path, item.name))).size });
    }
  }
  await walk(directory);
  files.sort((a, b) => b.bytes - a.bytes);
  return { bytes: files.reduce((sum, file) => sum + file.bytes, 0), files };
}

export function verifyAppCode(code, testBuild) {
  for (const marker of probeMarkers) {
    if (testBuild !== code.includes(marker)) throw new Error(`Build boundary failed for ${marker}`);
  }
  if (!testBuild)
    for (const marker of releaseHookMarkers)
      if (code.includes(marker)) throw new Error(`Build boundary failed for ${marker}`);
  for (const marker of documentWorkerMarkers)
    if (!code.includes(marker)) throw new Error(`Document worker missing: ${marker}`);
}

export async function inspectAppArchive(archive, testBuild) {
  const { listPackage, extractFile, statFile, uncache } = await import("@electron/asar");
  uncache(archive);
  const entries = listPackage(archive).map((path) => path.replaceAll("\\", "/"));
  const code = entries
    .filter((entry) => /^\/out\/.*\.(?:js|cjs|html)$/.test(entry))
    .map((entry) => extractFile(archive, entry.slice(1).replaceAll("/", sep)).toString("utf8"))
    .join("\n");
  verifyAppCode(code, testBuild);
  await checkPdfResources((path) => extractFile(archive, path.replaceAll("/", sep)));
  const problems = inspectPayloadFiles(
    entries.map((entry) => ({
      path: entry.slice(1),
      bytes: /\.(?:js|cjs|mjs|json|jsonl|html|css|txt|md|pem|env)$/.test(entry)
        ? extractFile(archive, entry.slice(1).replaceAll("/", sep))
        : undefined,
    })),
  );
  if (problems.length) throw new Error(`ASAR checks failed: ${problems.join("; ")}`);
  const onnxruntimeBytes = entries
    .filter((entry) => entry.startsWith("/node_modules/onnxruntime-node/"))
    .reduce((total, entry) => total + (statFile(archive, entry.slice(1).replaceAll("/", sep)).size ?? 0), 0);
  return { entries, onnxruntimeBytes };
}

function run(binary, args, env) {
  const result = spawnSync(process.execPath, [binary, ...args], {
    cwd: root,
    env,
    stdio: "inherit",
  });
  if (result.status !== 0) throw new Error(`Build failed: ${binary} (${result.status})`);
}

function signatureStatus(file) {
  const env = { ...process.env, VERA_SIGNATURE_FILE: file };
  // Windows PowerShell5 needs its own modules when invoked from a PowerShell7 session.
  for (const key of Object.keys(env)) if (key.toLowerCase() === "psmodulepath") delete env[key];
  const result = spawnSync(
    join(process.env.SystemRoot ?? "C:\\Windows", "System32/WindowsPowerShell/v1.0/powershell.exe"),
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "(Get-AuthenticodeSignature -LiteralPath $env:VERA_SIGNATURE_FILE).Status.ToString()",
    ],
    { env, encoding: "utf8" },
  );
  return result.status === 0 ? result.stdout.trim() : "unavailable";
}

export async function stageRuntime(mode, outputRoot = resolve(root, "release_tmp")) {
  const stage = resolve(outputRoot, `staging-${process.platform}-${mode}`);
  // Removal is confined to this build's generated staging directory.
  if (!stage.startsWith(`${resolve(outputRoot)}${sep}`)) throw new Error("Unsafe staging path");
  await rm(stage, { recursive: true, force: true });
  await mkdir(stage, { recursive: true });
  await cp(join(root, "src/apps/desktop/out"), join(stage, "out"), { recursive: true });
  await mkdir(join(stage, "resources"), { recursive: true });
  await cp(join(root, "src/models"), join(stage, "resources/models"), {
    recursive: true,
    filter: (source) => source !== join(root, "src/models/model-manifest.json"),
  });
  await cp(join(root, "src/models/model-manifest.json"), join(stage, "resources/model-manifest.json"));
  await cp(
    join(root, "src/windows_runtime/windows-runtime-manifest.json"),
    join(stage, "resources/windows-runtime-manifest.json"),
  );
  if (process.platform === "win32") {
    await cp(join(root, "src/windows_runtime"), join(stage, "resources/windows-runtime"), {
      recursive: true,
      filter: (source) => source !== join(root, "src/windows_runtime/windows-runtime-manifest.json"),
    });
  }
  const desktop = JSON.parse(await readFile(join(root, "src/apps/desktop/package.json"), "utf8"));
  const runtimeNames = [
    "better-sqlite3",
    "@huggingface/transformers",
    "onnxruntime-node",
    "pdfjs-dist",
    "electron-updater",
  ];
  const seen = new Set();
  const packages = [];
  async function copyDependency(name, parent, optional = false) {
    const resolver = createRequire(join(parent, "package.json"));
    let directory;
    let manifest;
    // Some native packages export only their .node subpath, not package.json or a main entry.
    for (const search of resolver.resolve.paths(name) ?? []) {
      directory = join(search, name);
      try {
        manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
      } catch {
        manifest = undefined;
      }
      if (manifest?.name === name) break;
    }
    if (optional && !manifest) return;
    if (manifest?.name !== name) throw new Error(`Cannot locate runtime package ${name}`);
    if (seen.has(directory)) return;
    seen.add(directory);
    const path = relative(join(root, "node_modules"), directory);
    if (path.startsWith("..")) throw new Error(`Runtime dependency outside node_modules: ${name}`);
    await cp(directory, join(stage, "node_modules", path), {
      recursive: true,
      dereference: true,
      filter: (source) => {
        const runtimePath = relative(root, source).replaceAll(sep, "/");
        return (
          !foreignNative(`${runtimePath}/`, process.platform) &&
          !foreignNative(runtimePath, process.platform) &&
          !runtimePath.startsWith("node_modules/onnxruntime-web/")
        );
      },
    });
    packages.push({ name, version: manifest.version, path });
    for (const dependency of Object.keys(manifest.dependencies ?? {})) {
      await copyDependency(dependency, directory, dependency in (manifest.optionalDependencies ?? {}));
    }
    for (const dependency of Object.keys(manifest.optionalDependencies ?? {})) {
      await copyDependency(dependency, directory, true);
    }
  }
  for (const name of runtimeNames) await copyDependency(name, join(root, "src/apps/desktop"));
  if (process.platform === "win32") {
    // Node's native addon loader searches the addon's directory, so VC++ must be beside ORT.
    await cp(
      join(root, "src/windows_runtime"),
      join(stage, "node_modules/onnxruntime-node/bin/napi-v6/win32/x64"),
      {
        recursive: true,
        filter: (source) => source !== join(root, "src/windows_runtime/windows-runtime-manifest.json"),
      },
    );
  }
  await writeFile(
    join(stage, "package.json"),
    `${JSON.stringify(
      {
        name: mode === "test" ? "vera-test" : "vera",
        version: desktop.version,
        type: "module",
        main: desktop.main,
        productName: mode === "test" ? "VERA Test" : "VERA",
        dependencies: Object.fromEntries(runtimeNames.map((name) => [name, desktop.dependencies[name]])),
      },
      null,
      2,
    )}\n`,
  );
  const stagedFiles = await measureDirectory(stage);
  for (const file of stagedFiles.files)
    if (foreignNative(file.path, process.platform) || /node_modules\/onnxruntime-web\//.test(file.path))
      await rm(join(stage, file.path));
  return { stage, packages };
}

async function packageApp() {
  const inputPaths = [
    "scripts/package.mjs",
    "scripts/package-checks.mjs",
    "scripts/prepare-windows-runtime.mjs",
    "scripts/update-config.mjs",
    "src/apps/desktop/electron-builder.yml",
    "src/apps/desktop/electron.vite.config.ts",
    "package-lock.json",
    "src/models/model-manifest.json",
    "src/windows_runtime/windows-runtime-manifest.json",
  ];
  const fingerprintInputs = () =>
    Promise.all(
      inputPaths.map(async (path) => ({
        path,
        sha256: createHash("sha256")
          .update(await readFile(join(root, path)))
          .digest("hex"),
      })),
    );
  const inputs = await fingerprintInputs();
  if (!["win32", "linux"].includes(process.platform) || process.arch !== "x64") {
    throw new Error("Packaging requires native Windows/Linux x64 hosts");
  }
  const testBuild = process.argv.includes("--test");
  const distribution = distributionConfig(process.platform, testBuild, process.env);
  const env = {
    ...process.env,
    VERA_TEST: testBuild ? "1" : "0",
    VERA_SIGNED_BUILD: distribution.forceCodeSigning ? "1" : "0",
  };
  await prepareBundledModel();
  const windowsRuntime = process.platform === "win32" ? await prepareBundledWindowsRuntime() : undefined;
  run(
    join(dirname(require.resolve("electron-vite/package.json")), "bin/electron-vite.js"),
    ["build", "src/apps/desktop"],
    env,
  );
  const emitted = await measureDirectory(join(root, "src/apps/desktop/out"));
  const code = (
    await Promise.all(
      emitted.files
        .filter((file) => /\.(?:js|cjs|html)$/.test(file.path))
        .map((file) => readFile(join(root, "src/apps/desktop/out", file.path), "utf8")),
    )
  ).join("\n");
  verifyAppCode(code, testBuild);
  // Exclude foreign N-API binaries without altering the installed dependencies.
  const builderModule = await import("electron-builder");
  const mode = testBuild ? "test" : "release";
  const output = join(root, "release_tmp", mode);
  const staged = await stageRuntime(mode);
  const manifest = JSON.parse(await readFile(join(root, "src/models/model-manifest.json"), "utf8"));
  const prepack = await checkStagedPayload(staged.stage, process.platform, manifest);
  // This mode's generated output is rebuilt from scratch, so stale artifacts cannot pass.
  if (!output.startsWith(`${resolve(root, "release_tmp")}${sep}`)) throw new Error("Unsafe output path");
  await rm(output, { recursive: true, force: true });
  // Fast deterministic deflate.
  process.env.ELECTRON_BUILDER_COMPRESSION_LEVEL = "1";
  const builderOptions = {
    projectDir: staged.stage,
    config: {
      extends: join(root, "src/apps/desktop/electron-builder.yml"),
      directories: { app: staged.stage, output },
      electronVersion: JSON.parse(await readFile(join(root, "package.json"), "utf8")).devDependencies
        .electron,
      ...distribution,
      extraMetadata: {
        description: "Virtual Embedded Rig Assistant",
        author: "DDP Engineering",
        homepage: "http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant",
      },
      files: [
        "out/**",
        "package.json",
        `!node_modules/better-sqlite3/prebuilds/!(${process.platform}-${process.arch}).node`,
        `!node_modules/onnxruntime-node/bin/napi-v6/!(${process.platform})/**/*`,
        `!node_modules/onnxruntime-node/bin/napi-v6/${process.platform}/!(${process.arch})/**/*`,
        "!node_modules/onnxruntime-node/bin/napi-v6/linux/x64/*cuda*",
        "!node_modules/onnxruntime-node/bin/napi-v6/linux/x64/*tensorrt*",
        "!node_modules/onnxruntime-web/**",
        "!node_modules/@huggingface/transformers/src/**",
        "!node_modules/@huggingface/transformers/types/**",
        "!node_modules/@huggingface/transformers/dist/transformers.web*",
        "!node_modules/@huggingface/transformers/dist/transformers.min*",
      ],
    },
    publish: "never",
  };
  const targetPayloads = [];
  async function recordPayload(target) {
    const unpacked = join(output, process.platform === "win32" ? "win-unpacked" : "linux-unpacked");
    const archive = join(unpacked, "resources/app.asar");
    await inspectAppArchive(archive, testBuild);
    for (const file of manifest.files) {
      const bytes = await readFile(join(unpacked, "resources/models", manifest.modelId, file.path));
      if (bytes.length !== file.bytes || createHash("sha256").update(bytes).digest("hex") !== file.sha256)
        throw new Error(`packaged model integrity: ${file.path}`);
    }
    for (const file of windowsRuntime?.files ?? []) {
      const bytes = await readFile(
        join(
          unpacked,
          "resources/app.asar.unpacked/node_modules/onnxruntime-node/bin/napi-v6/win32/x64",
          file.path,
        ),
      );
      if (bytes.length !== file.bytes || createHash("sha256").update(bytes).digest("hex") !== file.sha256)
        throw new Error(`packaged Windows runtime integrity: ${file.path}`);
    }
    const executable = join(
      unpacked,
      `${distribution.executableName}${process.platform === "win32" ? ".exe" : ""}`,
    );
    let signature = "not-applicable";
    if (process.platform === "win32") {
      signature = signatureStatus(executable);
      if (distribution.forceCodeSigning && signature !== "Valid")
        throw new Error("Executable signature verification failed");
    }
    targetPayloads.push({
      target,
      appAsarSha256: createHash("sha256")
        .update(await readFile(archive))
        .digest("hex"),
      executableSha256: createHash("sha256")
        .update(await readFile(executable))
        .digest("hex"),
      signature,
    });
  }
  if (process.platform === "win32") {
    // Each pass has its own immutable layout: installed payload never receives the ZIP marker.
    for (const target of ["nsis", "zip"]) {
      await builderModule.build({
        ...builderOptions,
        targets: builderModule.Platform.WINDOWS.createTarget(target, builderModule.Arch.x64),
        config: {
          ...builderOptions.config,
          win: { ...distribution.win, target: [{ target, arch: ["x64"] }] },
          afterPack: async ({ appOutDir }) => {
            if (target === "zip") await writeFile(join(appOutDir, "vera.portable"), "");
          },
        },
      });
      await recordPayload(target);
    }
  } else {
    await builderModule.build(builderOptions);
    await recordPayload("AppImage/deb");
  }
  const unpacked = join(output, process.platform === "win32" ? "win-unpacked" : "linux-unpacked");
  const measured = await measureDirectory(unpacked);
  const archive = join(unpacked, "resources/app.asar");
  const { entries, onnxruntimeBytes } = await inspectAppArchive(archive, testBuild);
  validateNativeFiles(
    entries.map((path) => path.slice(1)).filter((path) => /\.(?:node|dll|so(?:\.1)?)$/.test(path)),
    process.platform,
  );
  const native = [...entries, ...measured.files.map((file) => file.path)];
  const finalProblems = inspectPayloadFiles(measured.files.map((file) => ({ path: file.path })));
  if (finalProblems.length) throw new Error(`postpack checks failed: ${finalProblems.join("; ")}`);
  for (const path of native) {
    const sqlite = /better-sqlite3\/prebuilds\/([^/]+)\.node$/.exec(path);
    const onnx = /onnxruntime-node\/bin\/napi-v6\/([^/]+)\/([^/]+)\//.exec(path);
    if (
      (sqlite && sqlite[1] !== `${process.platform}-x64`) ||
      (onnx && (onnx[1] !== process.platform || onnx[2] !== "x64"))
    ) {
      throw new Error(`Foreign native binary packaged: ${path}`);
    }
  }
  const artifacts = [];
  for (const file of await readdir(output)) {
    if (!/\.(zip|exe|AppImage|deb)$/.test(file)) continue;
    const bytes = await readFile(join(output, file));
    artifacts.push({
      path: file,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      target: file.endsWith(".exe") ? "nsis" : file.split(".").at(-1),
    });
    if (file.endsWith(".exe") && distribution.forceCodeSigning) {
      if (signatureStatus(join(output, file)) !== "Valid")
        throw new Error("Installer signature verification failed");
    }
  }
  const expectedTargets = process.platform === "win32" ? ["nsis", "zip"] : ["AppImage", "deb"];
  if (
    artifacts.length !== 2 ||
    expectedTargets.some((target) => !artifacts.some((artifact) => artifact.target === target))
  )
    throw new Error("Expected both current native targets");
  const sum = (needle) =>
    measured.files
      .filter((file) => file.path.includes(needle))
      .reduce((total, file) => total + file.bytes, 0);
  const report = {
    schema: 2,
    timestamp: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    testBuild,
    signing:
      process.platform === "win32"
        ? distribution.forceCodeSigning
          ? "requested"
          : "unsigned"
        : "not-applicable",
    prepack,
    artifacts,
    unpackedBytes: measured.bytes,
    onnxruntimeBytes,
    modelBytes: sum("resources/models/"),
    largestContributors: measured.files.slice(0, 15),
    appCodeBoundary: "passed",
    nativeArchitecture: "passed",
    runtimePackages: staged.packages,
    windowsRuntime,
    targetPayloads,
    appAsarSha256: createHash("sha256")
      .update(await readFile(archive))
      .digest("hex"),
    inputs,
  };
  if (JSON.stringify(await fingerprintInputs()) !== JSON.stringify(inputs))
    throw new Error("Packaging inputs changed during build; rebuild before acceptance");
  await writeFile(join(output, "package-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await packageApp();
