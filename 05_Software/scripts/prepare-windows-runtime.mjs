import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
function trustedMicrosoft(file) {
  const env = { ...process.env, VERA_SIGNATURE_FILE: file };
  for (const key of Object.keys(env)) if (key.toLowerCase() === "psmodulepath") delete env[key];
  return (
    spawnSync(
      join(process.env.SystemRoot ?? "C:\\Windows", "System32/WindowsPowerShell/v1.0/powershell.exe"),
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "$s=Get-AuthenticodeSignature -LiteralPath $env:VERA_SIGNATURE_FILE; if ($s.Status -eq 'Valid' -and $s.SignerCertificate.Subject -match 'O=Microsoft Corporation') { exit 0 } else { exit 1 }",
      ],
      { env, stdio: "ignore" },
    ).status === 0
  );
}

/** Source material is accepted only by the committed pins AND Microsoft signature. */
export async function prepareWindowsRuntime(manifest, target, options = {}) {
  const sourceDir =
    options.sourceDir ??
    process.env.VERA_VC_REDIST_DIR ??
    join(process.env.SystemRoot ?? "C:\\Windows", "System32");
  const verifySource = options.verifySource ?? trustedMicrosoft;
  const checked = [];
  for (const file of manifest.files) {
    if (!/^[a-z0-9_]+\.dll$/i.test(file.path)) throw new Error("Unsafe Windows runtime path");
    const destination = join(target, file.path);
    let bytes;
    let cached = true;
    try {
      bytes = await readFile(destination);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      cached = false;
      try {
        bytes = await readFile(join(sourceDir, file.path));
      } catch {
        throw new Error(
          `Missing pinned Windows runtime source: ${file.path}; set VERA_VC_REDIST_DIR to the approved redistributable folder`,
        );
      }
    }
    if (bytes.length !== file.bytes || createHash("sha256").update(bytes).digest("hex") !== file.sha256)
      throw new Error(`Windows runtime integrity: ${file.path}`);
    if (!cached && !(await verifySource(join(sourceDir, file.path))))
      throw new Error(`Windows runtime Microsoft signature: ${file.path}`);
    checked.push({ file, bytes, cached });
  }
  await mkdir(target, { recursive: true });
  for (const { file, bytes, cached } of checked) if (!cached) await writeFile(join(target, file.path), bytes);
  await writeFile(
    join(target, "NOTICE.txt"),
    `Microsoft Visual C++ Runtime x64 ${manifest.version ?? "fixture"}.\nUnmodified runtime files, copyright Microsoft Corporation.\nRedistribution: ${manifest.redistribution ?? "fixture"}\nLicense terms: ${manifest.license ?? "fixture"}\n`,
  );
  return { version: manifest.version, files: manifest.files };
}

export async function prepareBundledWindowsRuntime() {
  const manifest = JSON.parse(
    await readFile(join(root, "src/windows_runtime/windows-runtime-manifest.json"), "utf8"),
  );
  return prepareWindowsRuntime(manifest, join(root, "src/windows_runtime"));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.platform !== "win32")
    throw new Error("Windows runtime preparation requires a native Windows host");
  console.log(JSON.stringify(await prepareBundledWindowsRuntime(), null, 2));
}
