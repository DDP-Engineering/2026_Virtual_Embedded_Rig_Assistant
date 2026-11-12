import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
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

export const releaseHookMarkers = [
  "packaging-probe",
  "I2C1_CR1",
  "VERA_REPLAY_DIR",
  "VERA_REPLAY_DELAY_MS",
  "VERA_TEST_DIALOG_PATH",
  "VERA_TEST_ALLOW_WRITES",
  "VERA_TEST_CHATGPT",
  "VERA_NETWORK_AUDIT",
  "fictional-native-access-WP21",
  "registerReplay",
  "veraTestFileTools",
];

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
  const sqlite = /better-sqlite3\/prebuilds\/([^/]+)\.node$/.exec(path);
  const onnx = /onnxruntime-node\/bin\/napi-v6\/([^/]+)\/([^/]+)\//.exec(path);
  const sharp = /@img\/sharp(?:-libvips)?-([^/]+)\//.exec(path);
  const canvas = /@napi-rs\/canvas-([^/]+)\//.exec(path);
  return Boolean(
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

export async function checkStagedPayload(directory, platform, manifest, options = {}) {
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
  for (const asset of manifest.files)
    if (!paths.includes(`resources/models/${manifest.modelId}/${asset.path}`))
      throw new Error(`missing model: ${asset.path}`);
  const pdfResources = await checkPdfResources((path) => readFile(join(directory, path)), options.pdfSource);
  return {
    pdfResources,
    files: files.length,
    longestPath: Math.max(...paths.map((path) => path.length)),
    status: "passed",
  };
}
