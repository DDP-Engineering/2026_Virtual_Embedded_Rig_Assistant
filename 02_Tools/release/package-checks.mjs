import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, posix } from "node:path";
import { software } from "../environment/software.mjs";

const pdfSource = join(software, "node_modules/pdfjs-dist");

/** The complete resource set emitted by Vite comes from the exact-pinned PDF.js package. */
export async function checkPdfResources(readResource, source = pdfSource) {
  let count = 0;
  for (const directory of ["cmaps", "standard_fonts", "wasm"]) {
    let names;
    try {
      names = (await readdir(join(source, directory))).filter((name) => !name.startsWith("LICENSE"));
    } catch {
      throw new Error(`missing PDF source: ${directory}`);
    }
    if (!names.length) throw new Error(`missing PDF source: ${directory}`);
    for (const name of names) {
      const path = `out/renderer/pdfjs/${directory}/${name}`;
      let expected;
      try {
        expected = await readFile(join(source, directory, name));
      } catch {
        throw new Error(`missing PDF source: ${directory}/${name}`);
      }
      let actual;
      try {
        actual = await readResource(path);
      } catch {
        throw new Error(`missing PDF resource: ${path}`);
      }
      if (!expected.length || !expected.equals(actual)) throw new Error(`PDF resource integrity: ${path}`);
      count += 1;
    }
  }
  return count;
}

const releaseHookMarkers = [
  "packaging-probe",
  "I2C1_CR1",
  "VERA_REPLAY_DIR",
  "VERA_REPLAY_DELAY_MS",
  "VERA_NETWORK_AUDIT",
  "fictional-native-access-WP21",
  "registerReplay",
  "veraTestFileTools",
  "veraTestDictation",
];

/** The test hooks left in bundle code: the listed markers and every `VERA_TEST_` environment name. */
export function releaseHooks(code) {
  // The main bundle is not minified and keeps source comments; a hook named in a comment is not a hook.
  const live = code.replace(/^\s*(?:\/\/|\/\*|\*).*$/gm, "");
  return [
    ...releaseHookMarkers.filter((marker) => code.includes(marker)),
    ...new Set(live.match(/VERA_TEST_[A-Z_]+/g) ?? []),
  ];
}

/** Diagnostics intentionally carry paths/categories, never matched bytes. */
export function inspectPayloadFiles(files) {
  const problems = [];
  for (const { path, bytes } of files) {
    if (path.length > 160) problems.push(`path-length: ${path}`);
    if (/(?:^|\/)(?:\.env(?:\..*)?|credentials(?:\..*)?\.json|.*\.(?:pfx|p12|key))$/i.test(path))
      problems.push(`secret-file: ${path}`);
    if (bytes && /\.(?:js|cjs|mjs|json|jsonl|html|css|txt|md|pem|env)$/i.test(path)) {
      const text = bytes.toString("utf8");
      if (
        /(?:sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{24,}|gh[pousr]_[A-Za-z0-9]{30,}|AKIA[A-Z0-9]{16}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/.test(
          text,
        )
      )
        problems.push(`secret-material: ${path}`);
    }
  }
  return problems;
}

export function foreignNative(path, platform) {
  const pty = /node-pty\/prebuilds\/([^/]+)\//.exec(path);
  const sqlite = /better-sqlite3\/prebuilds\/([^/]+)\.node$/.exec(path);
  const onnx = /onnxruntime-node\/bin\/napi-v6\/([^/]+)\/([^/]+)\//.exec(path);
  const sharp = /@img\/sharp(?:-libvips)?-([^/]+)\//.exec(path);
  const canvas = /@napi-rs\/canvas-([^/]+)\//.exec(path);
  return Boolean(
    (pty && pty[1] !== `${platform}-x64`) ||
      (sqlite && sqlite[1] !== `${platform}-x64`) ||
      (onnx && (onnx[1] !== platform || onnx[2] !== "x64")) ||
      (sharp && sharp[1] !== `${platform}-x64`) ||
      (canvas && !canvas[1].startsWith(`${platform}-x64-`)) ||
      /onnxruntime-node\/bin\/.*(?:cuda|tensorrt)/i.test(path),
  );
}

export function validateNativeFiles(paths, platform) {
  const ort = `node_modules/onnxruntime-node/bin/napi-v6/${platform}/x64/`;
  const required = [
    ...ptyNativeFiles(platform),
    `node_modules/better-sqlite3/prebuilds/${platform}-x64.node`,
    `${ort}onnxruntime_binding.node`,
    ...(platform === "win32"
      ? ["onnxruntime.dll", "DirectML.dll", "dxcompiler.dll", "dxil.dll"]
      : ["libonnxruntime.so.1"]
    ).map((name) => `${ort}${name}`),
  ];
  for (const requiredPath of required)
    if (!paths.includes(requiredPath)) throw new Error(`missing native: ${requiredPath}`);
  for (const path of paths) if (foreignNative(path, platform)) throw new Error(`foreign native: ${path}`);
}

/** Files node-pty loads or executes outside ASAR, including the selected Windows ConPTY DLL host. */
export function ptyNativeFiles(platform) {
  const names =
    platform === "win32"
      ? ["pty.node", "conpty.node", "conpty_console_list.node", "conpty/conpty.dll", "conpty/OpenConsole.exe"]
      : ["pty.node"];
  return names.map((name) => `node_modules/node-pty/prebuilds/${platform}-x64/${name}`);
}

/** Validate native machine headers rather than trusting a platform-labelled directory. */
export async function checkPtyNative(readResource, platform) {
  const files = [];
  for (const path of ptyNativeFiles(platform)) {
    const bytes = await readResource(path);
    let valid = false;
    if (platform === "win32" && bytes.length >= 64 && bytes.toString("ascii", 0, 2) === "MZ") {
      const offset = bytes.readUInt32LE(60);
      valid =
        offset <= bytes.length - 6 &&
        bytes.readUInt32LE(offset) === 0x4550 &&
        bytes.readUInt16LE(offset + 4) === 0x8664;
    } else if (platform === "linux" && bytes.length >= 20) {
      valid =
        bytes.subarray(0, 4).equals(Buffer.from([127, 69, 76, 70])) &&
        bytes[4] === 2 &&
        bytes[5] === 1 &&
        bytes.readUInt16LE(18) === 62;
    }
    if (!valid) throw new Error(`node-pty native architecture: ${path}`);
    files.push({ path, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
  }
  return files;
}

/** node-pty's source, tests, debug symbols and foreign builds are not runtime dependencies. */
export function ptyRuntimeFile(path, platform) {
  if (!path.startsWith("node_modules/node-pty/")) return true;
  const local = path.slice("node_modules/node-pty/".length);
  if (
    !local ||
    ["lib", "prebuilds", `prebuilds/${platform}-x64`, `prebuilds/${platform}-x64/conpty`].includes(local)
  )
    return true;
  return (
    /^(?:package\.json|LICENSE)$/.test(local) ||
    (local.startsWith("lib/") &&
      (!/\.[^/]+$/.test(local) || (local.endsWith(".js") && !local.endsWith(".test.js")))) ||
    (local.startsWith(`prebuilds/${platform}-x64/`) && /\.(?:node|dll|exe)$/.test(local))
  );
}

/** Inspect pinned node-pty's relative CommonJS graph, including its separately launched worker. */
export async function checkPtyJavaScript(readResource) {
  const root = "node_modules/node-pty/lib/";
  const pending = [
    `${root}index.js`,
    `${root}worker/conoutSocketWorker.js`,
    `${root}conpty_console_list_agent.js`,
  ];
  const seen = new Set();
  while (pending.length) {
    const path = pending.pop();
    if (seen.has(path)) continue;
    if (!path.startsWith(root)) throw new Error(`node-pty JavaScript closure: ${path}`);
    seen.add(path);
    const code = (await readResource(path)).toString("utf8");
    for (const match of code.matchAll(/require\(['"](\.[^'"]+)['"]\)/g)) {
      const dependency = posix.normalize(posix.join(posix.dirname(path), match[1]));
      pending.push(dependency.endsWith(".js") ? dependency : `${dependency}.js`);
    }
  }
  return seen.size;
}

export async function payloadFiles(directory) {
  const files = [];
  async function walk(folder, prefix = "") {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = join(folder, entry.name);
      if (entry.isDirectory()) await walk(absolute, path);
      else if (entry.isFile()) files.push({ path, size: (await stat(absolute)).size });
      else throw new Error(`unsupported payload link: ${path}`);
    }
  }
  await walk(directory);
  return files;
}

export async function checkStagedPayload(directory, platform, options = {}) {
  const files = await payloadFiles(directory);
  const problems = inspectPayloadFiles(
    await Promise.all(
      files.map(async (file) => ({
        path: file.path,
        bytes: /\.(?:js|cjs|mjs|json|jsonl|html|css|txt|md|pem|env)$/i.test(file.path)
          ? await readFile(join(directory, file.path))
          : undefined,
      })),
    ),
  );
  if (problems.length) throw new Error(`prepack checks failed: ${problems.join("; ")}`);
  const paths = files.filter((file) => file.size > 0).map((file) => file.path);
  validateNativeFiles(paths, platform);
  const pdfResources = await checkPdfResources((path) => readFile(join(directory, path)), options.pdfSource);
  return {
    pdfResources,
    files: files.length,
    longestPath: Math.max(...paths.map((path) => path.length)),
    status: "passed",
  };
}
