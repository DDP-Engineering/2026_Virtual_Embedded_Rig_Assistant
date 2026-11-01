// REQ-TEST-8928f10f REQ-TEST-f84d343e
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmod,
  cp,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rmdir,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { checkEgress } from "./smoke-egress.mjs";
import { fileIdentity, startupFailureFacts } from "./smoke-report.mjs";

export const software = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const veraInstallNamePattern = "^VERA(?:\\s|$)";
const require = createRequire(import.meta.url);
const { _electron } = require("playwright");
const asar = require("@electron/asar");
const shQuote = (s) => `'${s.replaceAll("'", "'\\''")}'`;
export function within(root, path) {
  const rel = relative(resolve(root), resolve(path));
  assert(rel && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel), "Path outside owned root");
  return path;
}
export async function until(fn, message, timeout = 240000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw Error(`Timed out: ${message}`);
}
export async function command(root, label, argv, cwd, env = process.env) {
  const receipt = { argv, cwd, started: new Date().toISOString() };
  const stdout = [],
    stderr = [];
  const child = spawn(argv[0], argv.slice(1), { cwd, env, windowsHide: true });
  receipt.pid = child.pid;
  const timer = setTimeout(() => child.kill(), 300000);
  child.stdout.on("data", (b) => stdout.push(b));
  child.stderr.on("data", (b) => stderr.push(b));
  try {
    receipt.exit = await new Promise((accept, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => accept({ code, signal }));
    });
  } finally {
    clearTimeout(timer);
    receipt.finished = new Date().toISOString();
    await writeFile(join(root, `${label}.stdout.log`), Buffer.concat(stdout));
    await writeFile(join(root, `${label}.stderr.log`), Buffer.concat(stderr));
    receipt.logs = await Promise.all(
      ["stdout", "stderr"].map((s) => fileIdentity(join(root, `${label}.${s}.log`))),
    );
    await writeFile(join(root, `${label}.execution.json`), JSON.stringify(receipt, null, 2));
  }
  assert.equal(receipt.exit.code, 0, `${label}: ${Buffer.concat(stderr).toString().slice(-2000)}`);
  return { receipt, stdout: Buffer.concat(stdout).toString() };
}
async function findFile(root, name) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isFile() && entry.name === name) return path;
    if (entry.isDirectory()) {
      const found = await findFile(path, name);
      if (found) return found;
    }
  }
}
async function cachedSevenZip() {
  const { getCacheDirectory } = require("app-builder-lib/out/util/electronGet.js");
  const root = join(getCacheDirectory({ allowEnvVarOverride: true }), "7zip@1.0.0");
  const tool = await findFile(root, "7za.exe");
  assert(
    tool,
    "Cached pinned builder 7-Zip required; prepare it in the separate package build, never in smoke",
  );
  return tool;
}
export async function nsisPayload(envelope) {
  const archive = await findFile(envelope, "app-64.7z");
  if (archive) return { archive };
  if ((await findFile(envelope, "vera.exe")) && (await findFile(envelope, "app.asar")))
    return { directory: envelope };
  throw Error("NSIS x64 payload absent");
}
export async function extractArtifact(artifact, root, report, reuse = false) {
  const install = join(root, "Release é");
  if (!reuse) await mkdir(install);
  const env = await isolatedEnvironment(root);
  let executable, kind;
  if (reuse) {
    kind = /\.zip$/i.test(artifact)
      ? "portable-zip"
      : /\.exe$/i.test(artifact)
        ? "nsis"
        : /\.deb$/i.test(artifact)
          ? "deb"
          : "AppImage";
    executable = await findFile(install, process.platform === "win32" ? "vera.exe" : "vera");
    report.extractionReuse = { priorFailedReport: true, artifactSHA256: report.artifact.sha256 };
    if (kind === "AppImage") env.APPIMAGE = artifact;
  } else if (process.platform === "win32" && /\.zip$/i.test(artifact)) {
    kind = "portable-zip";
    await command(root, "extract-zip", [await cachedSevenZip(), "x", artifact, `-o${install}`, "-y"], root);
    executable = await findFile(install, "vera.exe");
  } else if (process.platform === "win32" && /\.exe$/i.test(artifact)) {
    kind = "nsis";
    const script = `$ErrorActionPreference='Stop'; @('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*') | ForEach-Object { Get-ItemProperty $_ -ErrorAction SilentlyContinue } | Where-Object { $_.DisplayName -match '${veraInstallNamePattern}' } | Select-Object DisplayName,InstallLocation,UninstallString | ConvertTo-Json -Compress`;
    const inventory = await command(
      root,
      "nsis-existing-identity",
      ["powershell.exe", "-NoProfile", "-Command", script],
      root,
    );
    report.existingInstallation = inventory.stdout.trim() ? JSON.parse(inventory.stdout) : null;
    if (report.existingInstallation) {
      report.installation = {
        status: "pending",
        reason:
          "Existing VERA identity protected; NSIS payload extracted without running installer/uninstaller.",
      };
      const envelope = join(root, "nsis-envelope");
      await mkdir(envelope);
      await command(
        root,
        "extract-nsis",
        [await cachedSevenZip(), "x", artifact, `-o${envelope}`, "-y"],
        root,
      );
      const payload = await nsisPayload(envelope);
      if (payload.archive)
        await command(
          root,
          "extract-nsis-payload",
          [await cachedSevenZip(), "x", payload.archive, `-o${install}`, "-y"],
          root,
        );
      else {
        // The pinned extractor can expose the embedded 7z as a flat app tree.
        // Replace only our newly claimed empty directory; retain one payload.
        within(root, await realpath(envelope));
        within(root, await realpath(install));
        await rmdir(install);
        await rename(envelope, install);
      }
    } else {
      await command(root, "install-nsis", [artifact, "/S", `/D=${install}`], root, env);
      report.installation = { status: "PASS", path: install, perUser: true };
    }
    executable = await findFile(install, "vera.exe");
  } else if (process.platform === "linux" && /\.AppImage$/i.test(artifact)) {
    kind = "AppImage";
    // Do not chmod or otherwise mutate the input artifact.
    await command(root, "extract-appimage", [artifact, "--appimage-extract"], install);
    executable = join(install, "squashfs-root/vera");
    env.APPIMAGE = artifact;
  } else if (process.platform === "linux" && /\.deb$/i.test(artifact)) {
    kind = "deb";
    await command(root, "extract-deb", ["dpkg-deb", "-x", artifact, install], root);
    executable = await findFile(install, "vera");
  } else throw Error("Artifact must be a native NSIS/ZIP or AppImage/deb");
  assert(executable, "Native executable absent");
  within(root, await realpath(executable));
  const archive = join(dirname(executable), "resources/app.asar");
  const pkg = JSON.parse(asar.extractFile(archive, "package.json").toString());
  assert.equal(pkg.name, "vera", "Instrumented or foreign artifact package");
  const main = asar.extractFile(archive, join("out", "main", "index.js")).toString();
  for (const marker of [
    "VERA_TEST_DIALOG_PATH",
    "VERA_REPLAY_DIR",
    "VERA_NETWORK_AUDIT",
    "VERA_TEST_ALLOW_WRITES",
    "--packaging-probe=",
  ])
    assert(!main.includes(marker), `Release contains test marker ${marker}`);
  const portable = await lstat(join(dirname(executable), "vera.portable"))
    .then((s) => s.isFile())
    .catch((e) => {
      if (e.code === "ENOENT") return false;
      throw e;
    });
  assert.equal(portable, kind === "portable-zip", "Wrong portable layout");
  const data = portable ? join(dirname(executable), "data") : join(root, "profile/data");
  const existingSettings = await readFile(join(data, "settings.json"), "utf8").catch((e) => {
    if (e.code === "ENOENT") return null;
    throw e;
  });
  if (existingSettings)
    assert.equal(
      JSON.parse(existingSettings).updates.mode,
      "off",
      "Owned resumed profile must retain updates Off",
    );
  else await seedData(data);
  report.artifact.version = pkg.version;
  report.format = kind;
  report.executable = await fileIdentity(executable);
  report.asar = await fileIdentity(archive);
  report.extraction = {
    path: install,
    spacedUnicode: true,
    status: "PASS",
    installation: report.installation ?? { status: "not-applicable", method: "extracted" },
  };
  return { executable, data, env, portable, root };
}
export async function isolatedEnvironment(root) {
  const config = join(root, "profile/config"),
    cache = join(root, "profile/cache"),
    temp = join(root, "t"),
    home = join(root, "profile/home");
  for (const p of [config, cache, temp, home]) await mkdir(p, { recursive: true });
  const env = {
    ...process.env,
    APPDATA: config,
    LOCALAPPDATA: cache,
    XDG_CONFIG_HOME: config,
    XDG_CACHE_HOME: cache,
    TMPDIR: temp,
    TMP: temp,
    TEMP: temp,
    HOME: home,
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
  };
  for (const key of Object.keys(env))
    if (key.startsWith("VERA_") || key === "ELECTRON_RUN_AS_NODE") delete env[key];
  return env;
}
export async function seedData(data) {
  await mkdir(data, { recursive: true });
  await writeFile(
    join(data, "settings.json"),
    JSON.stringify({
      schemaVersion: 1,
      installationId: randomUUID(),
      webAccess: { enabled: true, provider: "exa", authentication: "anonymous" },
      language: "en",
      theme: "light",
      textScale: 1,
      defaultModel: null,
      providers: { openai: {}, custom: [] },
      updates: { mode: "off", channel: "latest" },
      recentWorkbenches: [],
      limits: { maxToolCallsPerTurn: 50 },
    }),
  );
}
export async function launchObserved(context, label, report, allowed = [], testBuild = false) {
  const { executable, data, env, root } = context;
  const tracePath = join(root, `${label}.strace.log`);
  let launchPath = executable;
  if (process.platform === "linux") {
    launchPath = join(root, `${label}-exec.sh`);
    await writeFile(
      launchPath,
      `#!/bin/sh\nexec strace -f -s 4096 -v -e trace=connect,sendto,sendmsg -o ${shQuote(tracePath)} ${shQuote(executable)} "$@"\n`,
    );
    await chmod(launchPath, 0o755);
  }
  const args = [...(context.appArgs ?? []), `--user-data-dir=${data}`];
  const receipt = {
    label,
    started: new Date().toISOString(),
    argv: [launchPath, ...args],
    cwd: root,
    allowed,
  };
  report.launches.push(receipt);
  let app;
  // Playwright races two startup-line promises; an early child exit can reject
  // one before the other is awaited. Keep that dependency error as evidence
  // while its launch promise rejects, so the failed-launch receipt can finish.
  const dependencyErrors = [];
  const observeDependencyError = (error) => {
    if (!(error instanceof Error) || error.message !== "Process failed to launch!") throw error;
    dependencyErrors.push(error.stack ?? String(error));
  };
  process.on("unhandledRejection", observeDependencyError);
  try {
    app = await _electron.launch({
      executablePath: launchPath,
      args,
      cwd: root,
      env,
      chromiumSandbox: true,
      timeout: 60000,
    });
  } catch (error) {
    const path = join(root, `${label}.launch-error.log`);
    await writeFile(path, error.stack ?? String(error));
    Object.assign(receipt, startupFailureFacts(error.message), {
      finished: new Date().toISOString(),
      error: error.message,
      logs: [await fileIdentity(path)],
      stdoutStatus: "not exposed; original launch log retained",
      stderrStatus: "not exposed; original launch log retained",
      dependencyErrors,
    });
    if (process.platform === "linux") {
      const trace = await readFile(tracePath, "utf8").catch((e) => {
        if (e.code === "ENOENT") return null;
        throw e;
      });
      receipt.trace = trace === null ? { status: "absent" } : await fileIdentity(tracePath);
      receipt.egress =
        trace === null
          ? { status: "FAIL", errors: ["Trace absent after startup failure"] }
          : checkEgress(trace, allowed);
    }
    throw error;
  } finally {
    process.removeListener("unhandledRejection", observeDependencyError);
  }
  const child = app.process(),
    stdout = [],
    stderr = [];
  receipt.pid = child.pid;
  child.stdout?.on("data", (b) => stdout.push(b));
  child.stderr?.on("data", (b) => stderr.push(b));
  const exit = new Promise((accept) => child.once("exit", (code, signal) => accept({ code, signal })));
  let closed = false;
  const finish = async () => {
    if (closed) return;
    closed = true;
    await app.close();
    receipt.exit = await exit;
    receipt.finished = new Date().toISOString();
    await writeFile(join(root, `${label}.stdout.log`), Buffer.concat(stdout));
    await writeFile(join(root, `${label}.stderr.log`), Buffer.concat(stderr));
    receipt.logs = await Promise.all(
      ["stdout", "stderr"].map((s) => fileIdentity(join(root, `${label}.${s}.log`))),
    );
    if (process.platform === "linux") {
      receipt.trace = await fileIdentity(tracePath);
      receipt.egress = checkEgress(await readFile(tracePath, "utf8"), allowed);
    }
  };
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(60000);
    await page.waitForFunction(() => !!window.vera);
    const invoke = (channel, request = {}) =>
      page.evaluate(
        async ({ channel, request }) => {
          try {
            return await window.vera.invoke(channel, request);
          } catch (e) {
            throw Error(JSON.stringify(e));
          }
        },
        { channel, request },
      );
    async function identity() {
      const runtime = await app.evaluate(({ app, BrowserWindow }) => ({
        executable: process.execPath,
        resources: process.resourcesPath,
        data: app.getPath("userData"),
        version: app.getVersion(),
        packaged: app.isPackaged,
        electron: process.versions.electron,
        pid: process.pid,
        argv: process.argv,
        cwd: process.cwd(),
        sandbox: BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences().sandbox,
        spellcheck: BrowserWindow.getAllWindows()[0].webContents.session.isSpellCheckerEnabled(),
        ortTelemetryDisabled: process.env.ORT_DISABLE_TELEMETRY === "1",
      }));
      receipt.runtime = runtime;
      assert.equal(
        await realpath(runtime.data),
        await realpath(data),
        "FAIL before mutation: actual userData differs from owned profile",
      );
      within(root, await realpath(runtime.data));
      assert.equal(runtime.electron, "44.7.0");
      assert.equal(runtime.sandbox, true);
      assert.equal(runtime.spellcheck, false, "Automatic dictionary networking must be disabled by the app");
      assert.equal(
        runtime.ortTelemetryDisabled,
        true,
        "Native telemetry must be disabled by the app before workers start",
      );
      if (!testBuild) assert.equal(runtime.packaged, true);
      const info = await invoke("app.info");
      assert.equal(info.testBuild, testBuild);
      assert.match(page.url(), /^vera:\/\/app\//);
      receipt.runtime = runtime;
      receipt.info = info;
      receipt.origin = page.url();
      assert.equal((await invoke("app.settings.get")).settings.updates.mode, "off");
      return runtime;
    }
    await identity();
    return { app, page, invoke, receipt, identity, finish };
  } catch (error) {
    await finish();
    throw error;
  }
}
export async function copyDemo(root, reuse = false) {
  const bench = join(root, "Demo board é");
  if (
    reuse &&
    (await lstat(bench)
      .then(() => true)
      .catch((e) => {
        if (e.code === "ENOENT") return false;
        throw e;
      }))
  )
    return bench;
  await cp(join(software, "tests/fixtures/workbenches/demo-board"), bench, {
    recursive: true,
    errorOnExist: true,
  });
  return bench;
}
