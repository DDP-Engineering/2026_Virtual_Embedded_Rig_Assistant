// `npm run package` (06 P6, spec 08): builds dist/BenchPilot-Demo-<version>-win-x64.zip, a Windows 10/11 x64 bundle
// that runs the demo with no admin rights, no Node/Python/Wireshark and no internet. Runs on the dev machine.
//  1. clean dist/package · version + git sha
//  2. fresh web build (Vite, collecting the npm packages it bundles) · server → one esbuild ESM file, better-sqlite3
//     external and copied into app/node_modules (runtime files only)
//  3. node.exe copied unmodified (process.execPath)
//  4. tshark: the PE import closure of tshark.exe + CLI plugins, the data folders 08 lists, COPYING; the VC++
//     runtime it imports app-local; every binary copied unmodified (sha256-checked)
//  5. data generated + seeded INTO the staging dir with the staged tshark (Python only here); settings = replay
//  6. content, replay fixtures, launcher, .bat, README-FIRST, notices, VERSION
//  7. pre-zip checks: path length, secrets, external web assets, ASCII names, DLL closure
//  8. zip with Windows' own bsdtar (System32\tar.exe -a)
// PACKAGE_KEEP_STAGING=1 keeps dist/package/ after zipping.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseEnv } from "node:util";
import { externalAssetUrls, findSecrets, nonAsciiNames, unresolvedImports, walk } from "./package/checks.mjs";
import { npmNotices, noticesText, packageDirOf } from "./package/notices.mjs";
import { isWindowsDll, peImports } from "./package/pe.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const PKG = path.join(ROOT, "scripts", "package");
const DIST = path.join(ROOT, "dist");
const STAGE = path.join(DIST, "package");
const BUNDLE_NAME = "BenchPilot-Demo";
const BUNDLE = path.join(STAGE, BUNDLE_NAME);
const APP = path.join(BUNDLE, "app");
const RUNTIME = path.join(BUNDLE, "runtime");
const WS_OUT = path.join(RUNTIME, "wireshark");
const SYSTEM32 = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32");
const MAX_REL_PATH = 160;
const MAX_ZIP_BYTES = 350 * 1024 * 1024;
/**
 * 08 step 4: dissector data the CLI reads. `manuf*`/`services` are compiled into libwireshark since 4.2 (absent in
 * 4.6). `wka` (well-known MAC addresses) is not in 08's list, but without it `-V` prints `ff:ff:ff:ff:ff:ff`
 * instead of `Broadcast` — package:smoke's byte-for-byte comparison with the installed tshark caught it (P6).
 */
const WS_DATA = ["COPYING.txt", "manuf", "manuf.tmpl", "services", "wka", "radius", "diameter", "dtds", "wimaxasncp"];
/** CLI-relevant plugin folders (codecs/ is RTP audio playback, GUI only). */
const WS_PLUGIN_KINDS = ["epan", "wiretap"];
/** VC++ runtime DLLs the Wireshark installer puts in System32 (vc_redist, admin); shipped app-local instead. */
const VC_RUNTIME = /^(vcruntime140(_1)?|msvcp140(_\d|_atomic_wait|_codecvt_ids)?|concrt140)\.dll$/;

const t0 = Date.now();
const step = (s) => console.log(`\n▸ package: ${s}`);
const info = (s) => console.log(`  ${s}`);
const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;
const copied = []; // [source, dest] of every binary: verified byte-identical before zipping

function copyBinary(src, dest) {
  mkdirSync(path.dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  copied.push([src, dest]);
}

function run(args, opts = {}) {
  const r = spawnSync(process.execPath, args, { cwd: ROOT, stdio: "inherit", ...opts });
  if (r.status !== 0) throw new Error(`${args.find((a) => /\.(m?js|ts|py)$/.test(a)) ?? args[0]} exited with ${r.status ?? r.signal}`);
}

/** Only the keys we need from the developer's .env (it may hold API keys: nothing else is read or printed). */
function devEnv(key) {
  if (process.env[key]) return process.env[key];
  const file = path.join(ROOT, ".env");
  return existsSync(file) ? parseEnv(readFileSync(file, "utf8"))[key] : undefined;
}

// ---------------------------------------------------------------- 1

step("clean dist/package");
const version = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
if (!version) throw new Error("root package.json has no version");
const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" }).trim() !== "";
const gitSha = dirty ? `${sha}+dirty` : sha;
const buildDate = new Date().toISOString().slice(0, 10);
const zipFile = path.join(DIST, `${BUNDLE_NAME}-${version}-win-x64.zip`);
rmSync(STAGE, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
rmSync(zipFile, { force: true });
mkdirSync(APP, { recursive: true });
info(`version ${version} · git ${gitSha} · ${buildDate}`);

// ---------------------------------------------------------------- 2

step("web: fresh Vite build");
const webModules = new Set();
const vite = await import(pathToFileURL(path.join(ROOT, "node_modules", "vite", "dist", "node", "index.js")).href);
await vite.build({
  root: path.join(ROOT, "apps", "web"),
  configFile: path.join(ROOT, "apps", "web", "vite.config.ts"),
  logLevel: "warn",
  plugins: [
    {
      name: "benchpilot-collect-packages",
      generateBundle(_opts, bundle) {
        for (const chunk of Object.values(bundle)) if (chunk.type === "chunk") for (const id of chunk.moduleIds ?? Object.keys(chunk.modules ?? {})) webModules.add(id);
      },
    },
  ],
});
cpSync(path.join(ROOT, "apps", "web", "dist"), path.join(APP, "web"), { recursive: true });

step("server: esbuild bundle");
const esbuild = await import("esbuild");
const NATIVE_EXTERNAL = ["better-sqlite3"];
const built = await esbuild.build({
  absWorkingDir: ROOT,
  entryPoints: ["apps/server/src/main.ts"],
  outfile: path.join(APP, "server", "index.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  external: NATIVE_EXTERNAL,
  metafile: true,
  legalComments: "none",
  logLevel: "warning",
  // CJS dependencies call require(); an ESM bundle needs one.
  banner: { js: 'import { createRequire as __bpCreateRequire } from "node:module"; const require = __bpCreateRequire(import.meta.url);' },
  define: {
    __BENCHPILOT_BUILD__: JSON.stringify({ version, gitSha, buildDate }),
    // CLI entry blocks (`if (import.meta.main) …`, e.g. seed.ts → Python generator) must never run in the bundle.
    "import.meta.main": "false",
  },
});
// db/index.ts reads schema.sql next to itself (import.meta.dirname = app/server in the bundle).
copyFileSync(path.join(ROOT, "apps", "server", "src", "db", "schema.sql"), path.join(APP, "server", "schema.sql"));
const serverPackages = new Set(Object.keys(built.metafile.inputs).map((f) => packageDirOf(path.resolve(ROOT, f))).filter(Boolean));
info(`bundled ${serverPackages.size} npm packages into app/server/index.mjs (${mb(statSync(path.join(APP, "server", "index.mjs")).size)}); external: ${NATIVE_EXTERNAL.join(", ")}`);
info("choice: esbuild bundle (no `npm install --omit=dev` fallback needed)");

// better-sqlite3 runtime files only: lib/ + the win32-x64 N-API prebuild. node-addon-api is a build-time
// dependency (C++ headers), and deps/ + src/ are its sources; none is loaded at runtime.
const SQLITE = path.join(ROOT, "node_modules", "better-sqlite3");
const SQLITE_OUT = path.join(APP, "node_modules", "better-sqlite3");
mkdirSync(SQLITE_OUT, { recursive: true });
for (const f of ["package.json", "LICENSE"]) copyFileSync(path.join(SQLITE, f), path.join(SQLITE_OUT, f));
cpSync(path.join(SQLITE, "lib"), path.join(SQLITE_OUT, "lib"), { recursive: true });
copyBinary(path.join(SQLITE, "prebuilds", "win32-x64.node"), path.join(SQLITE_OUT, "prebuilds", "win32-x64.node"));

// ---------------------------------------------------------------- 3

step(`node.exe ${process.version} (unmodified copy of ${process.execPath})`);
copyBinary(process.execPath, path.join(RUNTIME, "node", "node.exe"));
const nodeLicenseFile = path.join(PKG, "licenses", `node-${process.version}-LICENSE`);
if (!existsSync(nodeLicenseFile))
  throw new Error(
    `no Node.js LICENSE for ${process.version}: save https://raw.githubusercontent.com/nodejs/node/${process.version}/LICENSE as scripts/package/licenses/node-${process.version}-LICENSE (the Windows installer doesn't ship it)`,
  );

// ---------------------------------------------------------------- 4

const tsharkPath = devEnv("TSHARK_PATH");
if (!tsharkPath || !existsSync(tsharkPath)) throw new Error("TSHARK_PATH (env or .env) must point at an installed tshark.exe");
const WS = path.dirname(tsharkPath);
step(`tshark from ${WS}`);
const wsLocal = new Set(readdirSync(WS).map((n) => n.toLowerCase()));
const vcRuntime = new Set();
const closure = new Set();
const pluginFiles = [];
const pluginsDir = path.join(WS, "plugins");
for (const ver of existsSync(pluginsDir) ? readdirSync(pluginsDir) : [])
  for (const kind of WS_PLUGIN_KINDS) {
    const dir = path.join(pluginsDir, ver, kind);
    if (existsSync(dir)) for (const f of readdirSync(dir).filter((n) => n.endsWith(".dll"))) pluginFiles.push(path.join("plugins", ver, kind, f));
  }
const queue = [path.basename(tsharkPath).toLowerCase(), ...pluginFiles];
while (queue.length) {
  const f = queue.shift();
  if (closure.has(f)) continue;
  closure.add(f);
  const { imports, delayImports } = peImports(path.join(WS, f));
  for (const d of [...imports, ...delayImports]) {
    if (wsLocal.has(d)) queue.push(d);
    else if (VC_RUNTIME.test(d)) vcRuntime.add(d);
    else if (!isWindowsDll(d) && imports.includes(d)) throw new Error(`${f} imports ${d}: neither in ${WS} nor part of Windows`);
  }
}
for (const f of closure) copyBinary(path.join(WS, f), path.join(WS_OUT, f));
for (const d of vcRuntime) {
  if (!existsSync(path.join(SYSTEM32, d))) throw new Error(`${d} (VC++ runtime, needed by tshark) not found in ${SYSTEM32}`);
  copyBinary(path.join(SYSTEM32, d), path.join(WS_OUT, d));
}
const wsData = [];
for (const name of WS_DATA) {
  const src = path.join(WS, name);
  if (!existsSync(src)) continue;
  cpSync(src, path.join(WS_OUT, name), { recursive: true });
  wsData.push(statSync(src).isDirectory() ? `${name}/` : name);
}
if (!wsData.includes("COPYING.txt")) throw new Error(`${WS}\\COPYING.txt not found (GPL text must ship)`);
const tsharkVersion = execFileSync(path.join(WS_OUT, "tshark.exe"), ["-v"], { encoding: "utf8", env: { SystemRoot: process.env.SystemRoot, PATH: SYSTEM32 } }).split(/\r?\n/, 1)[0].trim();
const wsVersion = /\b(\d+\.\d+\.\d+)\b/.exec(tsharkVersion)?.[1];
if (!wsVersion) throw new Error(`cannot read the Wireshark version from "${tsharkVersion}"`);
mkdirSync(path.join(RUNTIME, "wireshark-profile"), { recursive: true });
writeFileSync(
  path.join(RUNTIME, "wireshark-profile", "README.txt"),
  "Intentionally empty: WIRESHARK_CONFIG_DIR for the bundled TShark, so a Wireshark profile on this PC can't change its output.\r\n",
);
const exeCount = [...closure].filter((f) => !f.includes("plugins")).length;
info(`${tsharkVersion}`);
info(`binaries: ${exeCount} (tshark.exe + DLL closure) + ${pluginFiles.length} plugins + VC++ runtime: ${[...vcRuntime].join(", ")}`);
info(`data: ${wsData.join(" ")}`);

// ---------------------------------------------------------------- 5

step("data: generate + seed into the bundle (staged tshark, Python on this machine only)");
const pipelineEnv = {
  ...process.env,
  DATA_DIR: path.join(APP, "data"),
  RUNTIME_DIR: path.join(APP, ".data"),
  CONTENT_DIR: ROOT,
  TSHARK_PATH: path.join(WS_OUT, "tshark.exe"),
  WIRESHARK_CONFIG_DIR: path.join(RUNTIME, "wireshark-profile"),
  RECORD_REPLAY: "0",
  // No Wireshark on PATH: a DLL missing from the staged set must fail here, not resolve from the installation.
  PATH: `${SYSTEM32};${path.dirname(SYSTEM32)}`,
};
run(["--import", "tsx", "apps/server/src/cli/seed.ts"], { env: pipelineEnv });
run([path.join(ROOT, "scripts", "py.mjs"), "generator/validate.py", "--data", path.join(APP, "data")]);
for (const leftover of ["benchpilot.db-wal", "benchpilot.db-shm", "settings.json", "credentials.json"]) rmSync(path.join(APP, ".data", leftover), { force: true });
// Written from scratch, never copied: Demo replay, nothing else (no providers, no installation id, no keys).
writeFileSync(path.join(APP, ".data", "settings.json"), `${JSON.stringify({ active: "replay" }, null, 2)}\n`);
mkdirSync(path.join(APP, ".data", "logs"), { recursive: true });

// ---------------------------------------------------------------- 6

step("content, fixtures, launcher, docs");
for (const d of ["testbenches", "catalog", "skills"]) cpSync(path.join(ROOT, d), path.join(APP, "content", d), { recursive: true });
const replaySrc = path.join(ROOT, "apps", "server", "fixtures", "replay");
for (const f of readdirSync(replaySrc).filter((n) => /\.(jsonl|json)$/.test(n))) cpSync(path.join(replaySrc, f), path.join(APP, "fixtures", "replay", f));
copyFileSync(path.join(PKG, "launcher.mjs"), path.join(APP, "launcher.mjs"));
writeFileSync(
  path.join(APP, ".env"),
  [
    "# BenchPilot demo bundle. Paths are relative to this folder (app\\); the launcher resolves them and they win over",
    "# the real environment. No secrets here: API keys entered in Settings go to .data\\credentials.json on this PC.",
    "DATA_DIR=./data",
    "RUNTIME_DIR=./.data",
    "CONTENT_DIR=./content",
    "WEB_DIST_DIR=./web",
    "NOTICES_FILE=../THIRD-PARTY-NOTICES.txt",
    "TSHARK_PATH=../runtime/wireshark/tshark.exe",
    "WIRESHARK_CONFIG_DIR=../runtime/wireshark-profile",
    "",
  ].join("\n"),
);
const crlf = (s) => s.replace(/\r?\n/g, "\r\n");
writeFileSync(path.join(BUNDLE, "Start BenchPilot.bat"), crlf(readFileSync(path.join(PKG, "Start BenchPilot.bat"), "utf8")));
writeFileSync(path.join(BUNDLE, "README-FIRST.txt"), crlf(readFileSync(path.join(PKG, "README-FIRST.txt"), "utf8")));

const npmPackageDirs = new Set([...serverPackages, path.join(ROOT, "node_modules", "better-sqlite3")]);
for (const id of webModules) {
  const dir = packageDirOf(id);
  if (dir) npmPackageDirs.add(path.resolve(dir));
}
const npm = npmNotices([...npmPackageDirs]);
const wiresharkFiles = walk(WS_OUT)
  .map((f) => f.rel)
  .filter((r) => /\.(exe|dll)$/i.test(r) && !VC_RUNTIME.test(path.posix.basename(r)))
  .sort();
writeFileSync(
  path.join(BUNDLE, "THIRD-PARTY-NOTICES.txt"),
  crlf(
    noticesText({
      version,
      nodeVersion: process.version,
      nodeLicense: readFileSync(nodeLicenseFile, "utf8"),
      wiresharkVersion: wsVersion,
      wiresharkCopying: readFileSync(path.join(WS, "COPYING.txt"), "utf8"),
      wiresharkFiles: [...wiresharkFiles, ...wsData.filter((d) => d !== "COPYING.txt")],
      vcRuntime: [...vcRuntime].sort(),
      npm,
    }),
  ),
);
info(`THIRD-PARTY-NOTICES.txt: Node.js, Wireshark ${wsVersion}, VC++ runtime, ${npm.count} npm packages`);
writeFileSync(
  path.join(BUNDLE, "VERSION.txt"),
  crlf(
    [
      "BenchPilot demo bundle (Windows 10/11 x64)",
      `Version:     ${version}`,
      `Git commit:  ${gitSha}`,
      `Build date:  ${buildDate} (UTC)`,
      `Node.js:     ${process.version}`,
      `TShark:      ${tsharkVersion}`,
      "Model:       Demo replay (default; works offline)",
      "",
    ].join("\n"),
  ),
);

// ---------------------------------------------------------------- 7

step("pre-zip checks");
const files = walk(STAGE);
const problems = [];
const longest = files.reduce((a, f) => (f.rel.length > a.length ? f.rel : a), "");
if (longest.length >= MAX_REL_PATH) problems.push(`longest path is ${longest.length} chars (limit ${MAX_REL_PATH}): ${longest}`);
problems.push(...nonAsciiNames(files));
problems.push(...findSecrets(STAGE, files, `${BUNDLE_NAME}/`));
problems.push(...externalAssetUrls(path.join(APP, "web")));
const pe = unresolvedImports(WS_OUT, pluginFiles.map((f) => path.join(WS_OUT, f)));
problems.push(...pe.problems);
problems.push(...unresolvedImports(path.join(RUNTIME, "node")).problems);
for (const [src, dest] of copied) if (sha256(src) !== sha256(dest)) problems.push(`${path.relative(STAGE, dest)}: differs from ${src}`);
if (problems.length) {
  console.error(`\npackage: ${problems.length} check(s) failed:\n${problems.map((p) => `  ✗ ${p}`).join("\n")}`);
  process.exit(1);
}
const total = files.reduce((s, f) => s + f.size, 0);
info(`✓ longest path ${longest.length} chars: ${longest}`);
info("✓ no .env secrets, no credentials.json, settings.json = Demo replay only");
info("✓ app/web loads no external assets · all names ASCII");
info(`✓ every bundled binary resolves its imports in the bundle or Windows${pe.delayMissing.length ? ` (optional delay-loads absent: ${pe.delayMissing.join("; ")})` : ""}`);
info(`✓ ${copied.length} binaries byte-identical to their sources (signatures intact)`);
info(`${files.length} files, ${mb(total)} uncompressed`);

// ---------------------------------------------------------------- 8

step(`zip → ${path.relative(ROOT, zipFile)}`);
// Windows' bsdtar, not a Git/MSYS tar from PATH (those can't write zip).
const tar = spawnSync(path.join(SYSTEM32, "tar.exe"), ["-a", "-c", "-f", zipFile, BUNDLE_NAME], { cwd: STAGE, stdio: "inherit" });
if (tar.status !== 0) throw new Error(`tar exited with ${tar.status}`);
const zipSize = statSync(zipFile).size;
if (process.env.PACKAGE_KEEP_STAGING !== "1") rmSync(STAGE, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
info(`${mb(zipSize)} zip · ${files.length} files · longest path ${longest.length} chars · ${((Date.now() - t0) / 1000).toFixed(0)} s`);
if (zipSize >= MAX_ZIP_BYTES) {
  console.error(`package: the zip is ${mb(zipSize)}, over the ${mb(MAX_ZIP_BYTES)} limit (08)`);
  process.exit(1);
}
writeFileSync(
  path.join(DIST, "package-report.json"),
  JSON.stringify(
    {
      zip: path.basename(zipFile),
      bytes: zipSize,
      files: files.length,
      uncompressedBytes: total,
      longestPath: longest,
      version,
      gitSha,
      buildDate,
      node: process.version,
      tshark: tsharkVersion,
      tsharkFiles: { binaries: [...closure].sort(), vcRuntime: [...vcRuntime].sort(), data: wsData },
      npmPackages: npm.count,
    },
    null,
    2,
  ),
);
console.log("\npackage: DONE");
