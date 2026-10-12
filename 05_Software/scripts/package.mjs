import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareBundledModel } from "./prepare-model.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
export const probeMarkers = ["packaging-probe", "I2C1_CR1"];
export const documentWorkerMarkers = ["allowRemoteModels", "document-embedding-worker"];

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

export function enforceBudget(platform, bytes, contributors) {
  if (platform === "win32" && bytes > 250_000_000) {
    throw new Error(
      `Windows package exceeds 250 MB: ${bytes} bytes; largest contributors: ${JSON.stringify(contributors.slice(0, 10))}`,
    );
  }
}

export function verifyAppCode(code, testBuild) {
  for (const marker of probeMarkers) {
    if (testBuild !== code.includes(marker)) throw new Error(`Build boundary failed for ${marker}`);
  }
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

async function stageRuntime(mode) {
  const stage = resolve(root, "release", `staging-${process.platform}-${mode}`);
  // Removal is confined to this build's generated staging directory.
  if (!stage.startsWith(`${resolve(root, "release")}${sep}`)) throw new Error("Unsafe staging path");
  await rm(stage, { recursive: true, force: true });
  await mkdir(stage, { recursive: true });
  await cp(join(root, "apps/desktop/out"), join(stage, "out"), { recursive: true });
  await cp(join(root, "resources"), join(stage, "resources"), { recursive: true });
  const desktop = JSON.parse(await readFile(join(root, "apps/desktop/package.json"), "utf8"));
  const runtimeNames = ["better-sqlite3", "@huggingface/transformers", "onnxruntime-node", "pdfjs-dist"];
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
    await cp(directory, join(stage, "node_modules", path), { recursive: true });
    packages.push({ name, version: manifest.version, path });
    for (const dependency of Object.keys(manifest.dependencies ?? {})) {
      await copyDependency(dependency, directory, dependency in (manifest.optionalDependencies ?? {}));
    }
    for (const dependency of Object.keys(manifest.optionalDependencies ?? {})) {
      await copyDependency(dependency, directory, true);
    }
  }
  for (const name of runtimeNames) await copyDependency(name, join(root, "apps/desktop"));
  await writeFile(
    join(stage, "package.json"),
    `${JSON.stringify(
      {
        name: "vera-desktop",
        version: desktop.version,
        type: "module",
        main: desktop.main,
        productName: "VERA",
        dependencies: Object.fromEntries(runtimeNames.map((name) => [name, desktop.dependencies[name]])),
      },
      null,
      2,
    )}\n`,
  );
  return { stage, packages };
}

async function packageApp() {
  if (!["win32", "linux"].includes(process.platform) || process.arch !== "x64") {
    throw new Error("This spike packages only native Windows/Linux x64 hosts");
  }
  const testBuild = process.argv.includes("--test");
  const env = { ...process.env, VERA_TEST: testBuild ? "1" : "0" };
  await prepareBundledModel();
  run(
    join(dirname(require.resolve("electron-vite/package.json")), "bin/electron-vite.js"),
    ["build", "apps/desktop"],
    env,
  );
  const emitted = await measureDirectory(join(root, "apps/desktop/out"));
  const code = (
    await Promise.all(
      emitted.files
        .filter((file) => /\.(?:js|cjs|html)$/.test(file.path))
        .map((file) => readFile(join(root, "apps/desktop/out", file.path), "utf8")),
    )
  ).join("\n");
  verifyAppCode(code, testBuild);
  // Exclude foreign N-API binaries without altering the installed dependencies.
  const builderModule = await import("electron-builder");
  const mode = testBuild ? "test" : "release";
  const output = join(root, "release", mode);
  const staged = await stageRuntime(mode);
  // Fast deterministic deflate; the same 250 MB limit is enforced on the artifact.
  process.env.ELECTRON_BUILDER_COMPRESSION_LEVEL = "1";
  await builderModule.build({
    projectDir: staged.stage,
    config: {
      extends: join(root, "apps/desktop/electron-builder.yml"),
      directories: { app: staged.stage, output },
      electronVersion: JSON.parse(await readFile(join(root, "package.json"), "utf8")).devDependencies
        .electron,
      artifactName: `VERA${testBuild ? "-test" : ""}-\${version}-\${os}-\${arch}.\${ext}`,
      extraMetadata: { description: "Virtual Embedded Rig Assistant", author: "DDP Engineering" },
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
  });
  const unpacked = join(output, process.platform === "win32" ? "win-unpacked" : "linux-unpacked");
  const measured = await measureDirectory(unpacked);
  const archive = join(unpacked, "resources/app.asar");
  const { entries, onnxruntimeBytes } = await inspectAppArchive(archive, testBuild);
  const native = [...entries, ...measured.files.map((file) => file.path)];
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
    if (!/\.(zip|AppImage)$/.test(file)) continue;
    const bytes = await readFile(join(output, file));
    enforceBudget(process.platform, bytes.length, measured.files);
    artifacts.push({
      path: file,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  if (artifacts.length !== 1) throw new Error("Expected one current native artifact");
  const sum = (needle) =>
    measured.files
      .filter((file) => file.path.includes(needle))
      .reduce((total, file) => total + file.bytes, 0);
  const report = {
    schema: 1,
    timestamp: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    testBuild,
    artifacts,
    unpackedBytes: measured.bytes,
    onnxruntimeBytes,
    modelBytes: sum("resources/models/"),
    largestContributors: measured.files.slice(0, 15),
    appCodeBoundary: "passed",
    nativeArchitecture: "passed",
    runtimePackages: staged.packages,
  };
  await writeFile(join(output, "package-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await packageApp();
