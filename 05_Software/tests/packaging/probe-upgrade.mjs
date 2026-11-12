import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, cp, mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "yaml";
import { prepareBundledUv } from "../../../02_Tools/environment/prepare-uv.mjs";
import { distributionConfig, stageRuntime } from "../../../02_Tools/release/package.mjs";
import { checkStagedPayload } from "../../../02_Tools/release/package-checks.mjs";
import { startUpdateFeed } from "../../../02_Tools/release/update-feed.mjs";

// Probes the update feature on real installed builds. Data migration and upgrade safety are not
// tested during development (AGENTS.md).
const ticket = "WP31";
const oldVersion = "0.31.0";
const newVersion = "0.31.1";
const executableName = "vera-wp31-test";
const software = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const scratch = resolve(process.argv[2] ?? "");
assert(
  process.argv[2] && !scratch.startsWith(join(software, "node_modules")),
  "Explicit owned scratch required",
);
const require = createRequire(join(software, "package.json"));
const { _electron } = require("playwright");
const builder = require("electron-builder");
const asar = require("@electron/asar");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await mkdir(scratch, { recursive: true });
const previous = process.argv.includes("--reuse")
  ? JSON.parse(await readFile(join(scratch, "upgrade-report.json"), "utf8"))
  : null;
const feedRoot = join(scratch, "feed");
await mkdir(feedRoot, { recursive: true });
const feed = await startUpdateFeed(feedRoot, previous ? Number(new URL(previous.feed).port) : 0);
const report = {
  schema: 1,
  started: new Date().toISOString(),
  platform: process.platform,
  base: "d2544a568d0d2b21128a77e5a43e4674460b1ef0",
  feed: feed.url,
  artifacts: [],
  launches: [],
  checks: [],
  driverSha256: sha(await readFile(fileURLToPath(import.meta.url))),
  purpose: `Instrumented local ${ticket} acceptance; connected host, no clean/offline release claim`,
};
const inputFiles = spawnSync(
  "git",
  [
    "ls-files",
    "-co",
    "--exclude-standard",
    "-z",
    "05_Software",
    "02_Tools/environment",
    "02_Tools/build",
    "02_Tools/release",
  ],
  {
    cwd: resolve(software, ".."),
    encoding: "utf8",
  },
);
assert.equal(inputFiles.status, 0);
report.inputs = await Promise.all(
  [...new Set(inputFiles.stdout.split("\0").filter(Boolean))]
    .sort()
    .map(async (path) => ({ path, sha256: sha(await readFile(resolve(software, "..", path))) })),
);
let app;
let saveCurrent;
const processes = [];
const exits = [];
async function reservePort() {
  const server = createServer();
  await new Promise((accept) => server.listen(0, "127.0.0.1", accept));
  const port = server.address().port;
  await new Promise((accept) => server.close(accept));
  return port;
}
const inspectorPort = previous?.relaunchFixture.inspectorPort ?? (await reservePort()),
  browserPort = previous?.relaunchFixture.browserPort ?? (await reservePort());
const installedData = join(scratch, "profiles/installed/config/VERA Test");
async function artifact(path) {
  const bytes = await readFile(path);
  return {
    path,
    bytes: bytes.length,
    sha256: sha(bytes),
    sha512: createHash("sha512").update(bytes).digest("base64"),
  };
}
function run(args, cwd, env, name) {
  const result = spawnSync(args[0], args.slice(1), {
    cwd,
    env,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return writeFile(join(scratch, `${name}.stdout.log`), result.stdout ?? "").then(async () => {
    await writeFile(join(scratch, `${name}.stderr.log`), result.stderr ?? "");
    report.checks.push({ name, args, exitCode: result.status });
    assert.equal(result.status, 0, `${name}: ${result.stderr?.slice(-2000)}`);
  });
}
const env = { ...process.env, VERA_TEST: "1", VERA_UPDATE_URL: feed.url, VERA_SIGNED_BUILD: "0" };
delete env.ELECTRON_RUN_AS_NODE;
async function launch(executable, label, extra = {}) {
  const profile = join(scratch, "profiles", label.startsWith("installed") ? "installed" : label);
  const cache = join(profile, "cache"),
    config = join(profile, "config"),
    temp = process.platform === "linux" ? join(resolve(scratch, "../.."), "t") : join(profile, "tmp");
  for (const path of [cache, config, temp]) await mkdir(path, { recursive: true });
  const childEnv = {
    ...env,
    LOCALAPPDATA: cache,
    APPDATA: config,
    XDG_CACHE_HOME: cache,
    XDG_CONFIG_HOME: config,
    TMPDIR: temp,
    TMP: temp,
    TEMP: temp,
    ...extra,
  };
  if (childEnv.APPIMAGE === null) delete childEnv.APPIMAGE;
  app = await _electron.launch({
    executablePath: executable,
    args: [`--user-data-dir=${join(config, "VERA Test")}`],
    env: childEnv,
    chromiumSandbox: true,
    timeout: 60000,
  });
  const child = app.process();
  processes.push(child.pid);
  const exit = new Promise((accept) => child.once("exit", (code, signal) => accept({ code, signal })));
  exits.push(exit);
  const stdout = [],
    stderr = [];
  child.stdout?.on("data", (b) => stdout.push(Buffer.from(b)));
  child.stderr?.on("data", (b) => stderr.push(Buffer.from(b)));
  const page = await app.firstWindow();
  await page.waitForFunction(() => !!window.vera);
  const invoke = (channel, request = {}) =>
    page.evaluate(
      async ({ channel, request }) => {
        try {
          return await window.vera.invoke(channel, request);
        } catch (error) {
          throw Error(JSON.stringify(error));
        }
      },
      { channel, request },
    );
  const runtime = await app.evaluate(({ app }) => ({
    executable: process.execPath,
    resources: process.resourcesPath,
    data: app.getPath("userData"),
    version: app.getVersion(),
    packaged: app.isPackaged,
    electron: process.versions.electron,
    pid: process.pid,
  }));
  const info = await invoke("app.info");
  const expectedData = info.portable ? join(dirname(executable), "data") : join(config, "VERA Test");
  assert.equal(
    resolve(runtime.data).toLowerCase(),
    resolve(expectedData).toLowerCase(),
    "Observed userData must equal the owned path before any mutation",
  );
  assert(resolve(runtime.data).startsWith(scratch));
  report.checks.push({
    name: `${label}-isolated-userData`,
    expected: expectedData,
    observed: runtime.data,
    result: "PASS",
  });
  assert(runtime.packaged);
  assert.equal(runtime.electron, "44.7.0");
  assert.equal(info.testBuild, true);
  assert.match(page.url(), /^vera:\/\/app\//);
  const receipt = {
    label,
    runtime,
    info,
    executable: await artifact(executable),
    asar: await artifact(join(runtime.resources, "app.asar")),
    origin: page.url(),
  };
  report.launches.push(receipt);
  async function save() {
    await writeFile(join(scratch, `${label}.stdout.log`), Buffer.concat(stdout));
    await writeFile(join(scratch, `${label}.stderr.log`), Buffer.concat(stderr));
    receipt.exit = await exit;
  }
  saveCurrent = save;
  return { page, invoke, runtime, receipt, save, profile };
}
async function versionAt(resources) {
  try {
    return JSON.parse(asar.extractFile(join(resources, "app.asar"), "package.json").toString()).version;
  } catch {
    return null;
  }
}
async function until(test, message, timeout = 120000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await test();
    if (value) return value;
    await sleep(200);
  }
  throw Error(`Timed out: ${message}`);
}
async function observeOwnedRelaunch() {
  const endpoint = await until(async () => {
    try {
      return (await (await fetch(`http://127.0.0.1:${inspectorPort}/json/list`)).json())[0]
        ?.webSocketDebuggerUrl;
    } catch {
      return null;
    }
  }, "isolated real updater relaunch inspector");
  const socket = new WebSocket(endpoint);
  await new Promise((accept, reject) => {
    socket.addEventListener("open", accept, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let next = 0;
  function evaluate(expression) {
    const id = ++next;
    return new Promise((accept, reject) => {
      const on = (event) => {
        const result = JSON.parse(event.data);
        if (result.id !== id) return;
        socket.removeEventListener("message", on);
        if (result.error || result.result.exceptionDetails) reject(Error(JSON.stringify(result)));
        else accept(result.result.result.value);
      };
      socket.addEventListener("message", on);
      socket.send(
        JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, returnByValue: true } }),
      );
    });
  }
  const getApp = 'process.getBuiltinModule("module").createRequire(process.execPath)("electron").app';
  const runtime = await evaluate(
    `(()=>{const app=${getApp};return {data:app.getPath("userData"),version:app.getVersion(),executable:process.execPath,resources:process.resourcesPath,image:process.env.APPIMAGE,packaged:app.isPackaged,electron:process.versions.electron,pid:process.pid};})()`,
  );
  assert.equal(resolve(runtime.data).toLowerCase(), resolve(installedData).toLowerCase());
  if (process.platform === "win32") assert(resolve(runtime.executable).startsWith(scratch));
  else {
    assert.equal(resolve(runtime.image), join(scratch, `Install é/VERA-${ticket}-test.AppImage`));
    assert.equal(
      (await artifact(runtime.image)).sha256,
      report.artifacts.find((item) => item.version === newVersion).sha256,
    );
    assert.equal(await versionAt(runtime.resources), newVersion);
    // AppImage's own extract-and-run runtime owns the temporary executable path.
    assert.equal((await artifact(runtime.executable)).sha256, report.launches[0].executable.sha256);
  }
  assert.equal(runtime.version, newVersion);
  assert(runtime.packaged);
  report.checks.push({
    name: "updater-real-relaunch-isolated",
    runtime,
    expectedUserData: installedData,
    result: "PASS",
  });
  // Normal app quit after ownership/userData observation; no process-tree killing.
  await evaluate(`${getApp}.quit(); true`);
  socket.close();
  await until(async () => {
    try {
      await fetch(`http://127.0.0.1:${browserPort}/json/version`);
      return false;
    } catch {
      return true;
    }
  }, "owned relaunched app quit");
}
try {
  const outputs = {};
  if (!previous) {
    const vite = join(dirname(require.resolve("electron-vite/package.json")), "bin/electron-vite.js");
    await run([process.execPath, vite, "build", "src/apps/desktop"], software, env, "compile");
    await prepareBundledUv();
    const staged = await stageRuntime("test", scratch);
    const manifest = JSON.parse(await readFile(join(software, "src/models/model-manifest.json"), "utf8"));
    report.prepack = await checkStagedPayload(staged.stage, process.platform, manifest);
    const distribution = distributionConfig(process.platform, true, env);
    distribution.appId = "engineering.ddp.vera.wp31.task4be77adc";
    distribution.productName = `VERA ${ticket} Test`;
    distribution.executableName = executableName;
    distribution.artifactName = `VERA-${ticket}-test-\${version}-\${os}-\${arch}.\${ext}`;
    const packagePath = join(staged.stage, "package.json");
    const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
    packageJson.name = "vera-wp31-task4be77adc-test";
    await writeFile(packagePath, JSON.stringify(packageJson, null, 2));
    const nsisIsolation = join(scratch, "isolated-relaunch.nsh");
    await writeFile(
      nsisIsolation,
      [
        "!macro customInstall",
        `  \${If} \${isForceRun}`,
        `    Exec '"$appExe" "--user-data-dir=${installedData}" "--inspect=${inspectorPort}" "--remote-debugging-port=${browserPort}"'`,
        "    !insertmacro quitSuccess",
        `  \${EndIf}`,
        "!macroend",
        "",
      ].join("\n"),
    );
    report.relaunchFixture = {
      nsisInclude: nsisIsolation,
      userData: installedData,
      inspectorPort,
      browserPort,
      purpose:
        "Instrumented launch isolation/observation only; updater and actual NSIS/AppImage installation stay real.",
    };
    for (const version of [oldVersion, newVersion]) {
      const output = join(scratch, version);
      const target = process.platform === "win32" ? "nsis" : "AppImage";
      const config = {
        extends: join(software, "src/apps/desktop/electron-builder.yml"),
        directories: { app: staged.stage, output },
        ...distribution,
        compression: "normal",
        electronVersion: "44.7.0",
        extraMetadata: {
          version,
          description: `${ticket} local update test`,
          author: "DDP Engineering",
          homepage: "http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant",
        },
        releaseInfo: { releaseNotes: `${ticket} local update release ${version}` },
        nsis: { ...distribution.nsis, include: nsisIsolation },
        win: { ...distribution.win, target: [{ target, arch: ["x64"] }] },
        linux: { ...distribution.linux, target: [{ target, arch: ["x64"] }] },
      };
      process.env.ELECTRON_BUILDER_COMPRESSION_LEVEL = "1";
      const buildConfig = structuredClone(config);
      if (process.platform === "linux") {
        buildConfig.afterPack = async ({ appOutDir }) => {
          const binary = join(appOutDir, executableName);
          await rename(binary, `${binary}.bin`);
          await writeFile(
            binary,
            [
              "#!/bin/sh",
              'here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)',
              `exec "$here/${executableName}.bin" "--user-data-dir=${installedData}" "--inspect=${inspectorPort}" "--remote-debugging-port=${browserPort}" "$@"`,
              "",
            ].join("\n"),
          );
          await chmod(binary, 0o755);
        };
      }
      await builder.build({
        projectDir: staged.stage,
        config: buildConfig,
        publish: "never",
        targets: (process.platform === "win32"
          ? builder.Platform.WINDOWS
          : builder.Platform.LINUX
        ).createTarget(target, builder.Arch.x64),
      });
      const ext = process.platform === "win32" ? ".exe" : ".AppImage";
      const file = (await readdir(output)).find((p) => p.endsWith(ext));
      assert(file, "update artifact");
      const path = join(output, file);
      const item = { version, ...(await artifact(path)), target };
      report.artifacts.push(item);
      outputs[version] = { output, path, config };
      await cp(path, join(feedRoot, file));
      for (const name of await readdir(output))
        if (name.endsWith(".blockmap") || name.endsWith(".yml"))
          await cp(join(output, name), join(feedRoot, name));
      if (process.platform === "win32" && version === oldVersion) {
        // Actual portable package layout, generated independently of the NSIS installation.
        const zipOutput = join(scratch, "portable");
        await builder.build({
          projectDir: staged.stage,
          publish: "never",
          targets: builder.Platform.WINDOWS.createTarget("zip", builder.Arch.x64),
          config: {
            ...structuredClone(config),
            directories: { app: staged.stage, output: zipOutput },
            win: { ...distribution.win, target: [{ target: "zip", arch: ["x64"] }] },
            afterPack: async ({ appOutDir }) => writeFile(join(appOutDir, "vera.portable"), ""),
          },
        });
        const zip = (await readdir(zipOutput)).find((p) => p.endsWith(".zip"));
        report.artifacts.push({ version, ...(await artifact(join(zipOutput, zip))), target: "portable-zip" });
      }
    }
  } else {
    assert(previous.inputs, "Reused artifacts require original complete candidate inputs");
    const buildInputs = (inputs) =>
      inputs.filter(
        ({ path }) =>
          !path.includes(".test.") &&
          !path.startsWith("05_Software/tests/e2e/") &&
          !path.startsWith("05_Software/tests/") &&
          !path.startsWith("05_Software/tests/fixtures/"),
      );
    assert.deepEqual(
      buildInputs(report.inputs),
      buildInputs(previous.inputs),
      "Compiled product/configuration must match original artifact inputs",
    );
    for (const item of previous.artifacts) {
      assert.equal(
        (await artifact(item.path)).sha256,
        item.sha256,
        "Reused artifact bytes must match the original receipt",
      );
      report.artifacts.push(item);
      if (item.target !== "portable-zip")
        outputs[item.version] = { output: dirname(item.path), path: item.path };
    }
    report.relaunchFixture = previous.relaunchFixture;
    report.reusedBuild = {
      priorDriverSha256: previous.driverSha256,
      priorResult: previous.result,
      originalInputs: previous.inputs,
      reason: "Native artifacts/source unchanged; only external probe environment or diagnostics corrected.",
    };
  }
  if (process.platform === "linux" && !process.argv.includes("--portable-only")) {
    const before = feed.requests.length;
    const managed = await launch(
      join(outputs[oldVersion].output, `linux-unpacked/${executableName}.bin`),
      "managed",
      { APPIMAGE: null },
    );
    await until(
      async () => (await managed.invoke("update.get")).phase !== "checking",
      "managed startup check",
    );
    await managed.invoke("app.settings.update", { updates: { mode: "download", channel: "beta" } });
    await until(
      async () => (await managed.invoke("update.get")).phase !== "checking",
      "managed preference check",
    );
    const snapshot = await managed.invoke("update.check");
    assert.equal(snapshot.distribution, "managed");
    assert.equal(snapshot.phase, "available");
    assert.equal(snapshot.offer.version, newVersion);
    let denied = false;
    try {
      await managed.invoke("update.download", { confirmed: true });
    } catch (error) {
      denied = error.message.includes('"code":"DENIED"');
    }
    assert(denied);
    assert(feed.requests.slice(before).length > 0);
    assert(feed.requests.slice(before).every((request) => request.path.endsWith(".yml")));
    report.checks.push({
      name: "real-managed-metadata-only",
      snapshot,
      requests: feed.requests.slice(before),
      downloadDenied: true,
    });
    await app.close();
    await managed.save();
    app = undefined;
  }
  const metaName = process.platform === "win32" ? "latest.yml" : "latest-linux.yml";
  const meta = parse(await readFile(join(feedRoot, metaName), "utf8"));
  assert.equal(meta.version, newVersion);
  assert(meta.files.every((f) => f.sha512));
  await writeFile(
    join(feedRoot, process.platform === "win32" ? "beta.yml" : "beta-linux.yml"),
    stringify({ ...meta, version: `${newVersion}-beta.1`, releaseNotes: "Beta metadata; stable is newer" }),
  );
  report.feedMetadata = await artifact(join(feedRoot, metaName));
  if (!process.argv.includes("--portable-only")) {
    const install = join(scratch, "Install é");
    await mkdir(install, { recursive: true });
    let executable;
    if (process.platform === "win32") {
      const child = spawn(outputs[oldVersion].path, ["/S", `/D=${install}`], { env, windowsHide: true });
      const code = await new Promise((accept) => child.once("exit", (code) => accept(code)));
      report.checks.push({
        name: "NSIS-vN-install",
        pid: child.pid,
        exitCode: code,
        artifactSha256: report.artifacts[0].sha256,
        destination: install,
      });
      assert.equal(code, 0);
      executable = join(install, `${executableName}.exe`);
    } else {
      const appImage = join(install, `VERA-${ticket}-test.AppImage`);
      await cp(outputs[oldVersion].path, appImage);
      await run([appImage, "--appimage-extract"], install, env, "extract-vN");
      executable = join(install, `squashfs-root/${executableName}.bin`);
      outputs.installedAppImage = appImage;
    }
    const replay = join(scratch, "replay");
    await mkdir(replay, { recursive: true });
    await writeFile(
      join(replay, "edit.jsonl"),
      [
        { match: "edit", toolCalls: [{ name: "read", args: { path: "docs/note.md" } }] },
        { toolCalls: [{ name: "edit", args: { path: "docs/note.md", oldString: "old", newString: "new" } }] },
        { text: "Done" },
      ]
        .map(JSON.stringify)
        .join("\n"),
    );
    const extra = {
      VERA_REPLAY_DIR: replay,
      ...(process.platform === "linux"
        ? {
            APPIMAGE: outputs.installedAppImage,
            APPIMAGE_EXTRACT_AND_RUN: "1",
          }
        : {}),
    };
    const old = await launch(executable, "installed", extra);
    assert.equal(old.runtime.version, oldVersion);
    await old.invoke("app.settings.update", { updates: { mode: "off", channel: "beta" } });
    const checked = await old.invoke("update.check");
    assert.equal(checked.offer.version, newVersion);
    assert.equal(checked.phase, "available");
    await old.invoke("app.settings.update", { updates: { channel: "latest" } });
    const sha2Only = structuredClone(meta);
    for (const file of sha2Only.files) {
      delete file.sha512;
      file.sha2 = "a".repeat(64);
    }
    delete sha2Only.sha512;
    sha2Only.sha2 = "a".repeat(64);
    await writeFile(join(feedRoot, metaName), stringify(sha2Only));
    const beforeSha2 = feed.requests.length;
    const sha2Refused = await old.invoke("update.check");
    assert.equal(sha2Refused.phase, "error");
    assert.equal(sha2Refused.errorCode, "INTEGRITY");
    assert(feed.requests.slice(beforeSha2).every((request) => request.path.endsWith(".yml")));
    report.checks.push({ name: "real-SHA512-required", snapshot: sha2Refused, artifactRequests: 0 });
    await writeFile(join(feedRoot, metaName), stringify(meta));
    await old.invoke("app.settings.update", { updates: { channel: "beta" } });
    // Actual updater rejection, before the valid artifact download.
    const corrupt = structuredClone(meta);
    for (const file of corrupt.files) file.sha512 = Buffer.alloc(64).toString("base64");
    corrupt.sha512 = Buffer.alloc(64).toString("base64");
    await writeFile(join(feedRoot, metaName), stringify(corrupt));
    await old.invoke("update.check");
    const refused = await old.invoke("update.download", { confirmed: true });
    assert.equal(refused.phase, "error");
    assert.equal(refused.errorCode, "INTEGRITY");
    assert.equal(await versionAt(old.runtime.resources), oldVersion);
    report.checks.push({ name: "real-SHA512-rejection", snapshot: refused, installedVersion: oldVersion });
    await writeFile(join(feedRoot, metaName), stringify(meta));
    await old.invoke("update.check");
    const downloaded = await old.invoke("update.download", { confirmed: true });
    assert.equal(downloaded.phase, "ready");
    const downloads = feed.requests.filter((r) =>
      r.path.endsWith(process.platform === "win32" ? ".exe" : ".AppImage"),
    );
    assert(downloads.length > 0);
    report.checks.push({
      name: "installed-discovery-download",
      version: checked.offer.version,
      metadata: checked,
      downloaded,
      downloadedArtifactSha256: report.artifacts.find((a) => a.version === newVersion).sha256,
    });
    await old.page.locator("[data-update-banner]").waitFor();
    const benchRoot = join(scratch, "bench é");
    await mkdir(benchRoot, { recursive: true });
    if ((await readdir(join(benchRoot, ".vera")).catch(() => [])).includes("workbench.yaml"))
      await old.invoke("workbench.open", { folder: benchRoot });
    else await old.invoke("workbench.create", { folder: benchRoot, name: "WP31 upgrade board" });
    await writeFile(join(benchRoot, "docs/note.md"), "old\n");
    const session = await old.invoke("session.create");
    await old.invoke("session.send", { sessionId: session.id, text: "edit" });
    const pending = await until(async () => {
      const state = await old.invoke("session.get", { sessionId: session.id });
      return state.snapshot.approvals.find((a) => !a.decision);
    }, "real approval");
    const deferred = await old.invoke("update.restart");
    assert.equal(deferred.phase, "deferred");
    await sleep(500);
    assert.equal(await versionAt(old.runtime.resources), oldVersion);
    assert.equal(
      (await old.invoke("session.get", { sessionId: session.id })).snapshot.status,
      "awaiting_approval",
    );
    report.checks.push({
      name: "real-turn-approval-deferral",
      sessionId: session.id,
      approvalId: pending.approvalId,
      pidStillRunning: old.runtime.pid,
      observedInstalledVersion: oldVersion,
      snapshot: deferred,
    });
    await old.page.screenshot({ path: join(scratch, "deferred.png") });
    await old.invoke("session.approval.decide", {
      sessionId: session.id,
      approvalId: pending.approvalId,
      requestSha256: pending.requestSha256,
      decision: "approved",
    });
    await until(() => Promise.resolve(app.process().exitCode !== null), "old app clean exit");
    await old.save();
    assert.equal(old.receipt.exit.code, 0);
    app = undefined;
    assert.equal(await readFile(join(benchRoot, "docs/note.md"), "utf8"), "new\n");
    if (process.platform === "win32") {
      await until(
        async () => (await versionAt(old.runtime.resources)) === newVersion,
        "NSIS real installed upgrade",
      );
      await observeOwnedRelaunch();
    } else {
      const expected = report.artifacts.find((a) => a.version === newVersion).sha256;
      await until(
        async () => sha(await readFile(outputs.installedAppImage)) === expected,
        "AppImage replaced bytes",
      );
      await observeOwnedRelaunch();
      await run([outputs.installedAppImage, "--appimage-extract"], install, env, "extract-vN+1");
    }
    const newer = await launch(executable, "installed-vN+1", extra);
    assert.equal(newer.runtime.version, newVersion);
    report.checks.push({
      name: "real-installed-vN+1",
      version: newer.runtime.version,
      asarSha256: newer.receipt.asar.sha256,
    });
    await app.close();
    await newer.save();
    app = undefined;
  }
  if (process.platform === "win32") {
    const portableExe = join(scratch, `portable/win-unpacked/${executableName}.exe`);
    const portable = await launch(portableExe, "portable");
    assert.equal(portable.receipt.info.portable, true);
    await portable.invoke("app.settings.update", { updates: { mode: "download", channel: "latest" } });
    const before = feed.requests.length;
    const available = await portable.invoke("update.check");
    assert.equal(available.offer.version, newVersion);
    assert.equal(available.phase, "available");
    await sleep(500);
    assert(feed.requests.slice(before).every((r) => r.path.endsWith(".yml")));
    let denied = false;
    try {
      await portable.invoke("update.download", { confirmed: true });
    } catch (e) {
      denied = e.message.includes('"code":"DENIED"');
    }
    assert(denied);
    await app.evaluate(({ shell }) => {
      Reflect.set(globalThis, "wp31OpenedReleaseLinks", []);
      shell.openExternal = async (url) => {
        Reflect.get(globalThis, "wp31OpenedReleaseLinks").push(url);
      };
    });
    await portable.page.locator('[data-i18n="nav.settings"]').click();
    await portable.page.locator('[data-i18n="updates.openRelease"]').click();
    await portable.page.locator("dialog").waitFor({ state: "visible" });
    assert.deepEqual(await app.evaluate(() => Reflect.get(globalThis, "wp31OpenedReleaseLinks")), []);
    await portable.page.locator('[data-i18n="updates.confirm"]').click();
    await until(
      async () => (await app.evaluate(() => Reflect.get(globalThis, "wp31OpenedReleaseLinks"))).length === 1,
      "confirmed native portable link",
      3000,
    );
    assert.deepEqual(await app.evaluate(() => Reflect.get(globalThis, "wp31OpenedReleaseLinks")), [
      available.offer.link,
    ]);
    report.checks.push({
      name: "portable-confirmed-release-link",
      url: available.offer.link,
      beforeConfirmationCalls: 0,
      afterConfirmationCalls: 1,
      systemBrowserSuppressedByExternalDriver: true,
    });
    report.checks.push({
      name: "packaged-portable-metadata-only",
      snapshot: available,
      requests: feed.requests.slice(before),
      downloadDenied: true,
      asarSha256: portable.receipt.asar.sha256,
    });
    await app.close();
    await portable.save();
    app = undefined;
  }
  report.result = "PASS";
} catch (error) {
  report.result = "FAIL";
  report.error = { message: error.message, stack: error.stack };
  console.error(error);
  process.exitCode = 1;
} finally {
  if (app) await app.close().catch(() => {});
  if (app && saveCurrent) await saveCurrent();
  report.finished = new Date().toISOString();
  report.requests = feed.requests;
  await writeFile(join(scratch, "upgrade-report.json"), JSON.stringify(report, null, 2));
  await feed.close();
  console.log(report.result);
}
process.exit(report.result === "PASS" ? 0 : 1);
