// REQ-TEST-df5ff0ba REQ-TEST-a14f8f9b REQ-TEST-58d27601 REQ-TEST-5c4d259f REQ-SEC-4bebe590
import { execFileSync, spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { cpus, hostname, platform, release, tmpdir, totalmem } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "@playwright/test";
import { installNetworkGuard, outboundAttempts } from "../../tests/e2e/network-guard.ts";
import { fixtures, tiers } from "./fixtures.mjs";
import { hash, scenarios, validateReport, validateSample } from "./report.mjs";

const software = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const executable = join(
  software,
  "node_modules/electron/dist",
  process.platform === "win32" ? "electron.exe" : "electron",
);
const kill = (app) => {
  if (!app) return;
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill", ["/PID", String(app.process().pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
    } catch {}
  } else app.process().kill("SIGKILL");
};
const invoke = (page, channel, request) =>
  page.evaluate(({ channel, request }) => window.vera.invoke(channel, request), { channel, request });
export async function deadline(operation, milliseconds, terminate) {
  let timer;
  try {
    return await Promise.race([
      operation(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          try {
            terminate();
          } catch {
            /* rejection still owns the deadline */
          }
          reject(Error("external-deadline"));
        }, milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function build(buildRoot) {
  const env = {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("VERA_"))),
    VERA_TEST: "1",
    VERA_SESSION_PERF: "1",
    VERA_BUILD_ROOT: buildRoot,
  };
  delete env.VITE_API;
  const script = join(software, "node_modules/electron-vite/bin/electron-vite.js");
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, "build", "src/apps/desktop"], {
      cwd: software,
      env,
      stdio: "ignore",
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(Error("build-deadline"));
    }, 120000);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(Error("performance build failed"));
    });
  });
  await writeFile(
    join(buildRoot, "package.json"),
    JSON.stringify({ name: "vera-session-perf", version: "1.0.0", type: "module", main: "main/index.js" }),
  );
}
async function sourceIdentity() {
  const git = (...args) =>
    execFileSync("git", args, { cwd: resolve(software, ".."), maxBuffer: 32 * 1024 * 1024 });
  const head = git("rev-parse", "HEAD").toString().trim(),
    patch = git("diff", "--binary", "HEAD");
  const untracked = git("ls-files", "--others", "--exclude-standard", "-z")
    .toString()
    .split("\0")
    .filter(Boolean)
    .sort();
  // Run Git at the repository root so planning/journals and new sources are included.
  const files = [];
  for (const path of untracked) files.push([path, hash(await readFile(resolve(software, "..", path)))]);
  return {
    commit: head,
    dirty: patch.length > 0 || files.length > 0,
    candidateHash: hash({ patch: hash(patch), files }),
  };
}
async function treeHash(root) {
  const result = [];
  async function walk(folder) {
    for (const entry of (await readdir(folder, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) await walk(path);
      else result.push([path.slice(root.length + 1).replaceAll("\\", "/"), hash(await readFile(path))]);
    }
  }
  await walk(root);
  return hash(result);
}
export async function run(options) {
  const mode = options.mode ?? "quick";
  if (!["quick", "full"].includes(mode)) throw Error("invalid mode");
  const selectedTiers = options.cases?.split(",") ?? Object.keys(tiers),
    selectedScenarios = options.scenarios?.split(",") ?? scenarios;
  if (
    !selectedTiers.length ||
    new Set(selectedTiers).size !== selectedTiers.length ||
    selectedTiers.some((s) => !Object.hasOwn(tiers, s)) ||
    !selectedScenarios.length ||
    new Set(selectedScenarios).size !== selectedScenarios.length ||
    selectedScenarios.some((s) => !scenarios.includes(s))
  )
    throw Error("invalid cases/scenarios");
  const timeoutMs = Number(options.timeout ?? 30000),
    inject = Number(options["inject-stall-ms"] ?? 0);
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 100 ||
    timeoutMs > 120000 ||
    !Number.isSafeInteger(inject) ||
    inject < 0 ||
    inject > 120000
  )
    throw Error("invalid deadline/control");
  const root = await mkdtemp(join(tmpdir(), "vera-session-performance-")),
    buildRoot = join(root, "src/apps/desktop/out"),
    profile = join(root, "profile"),
    folder = join(root, "workbench");
  const fixture = fixtures();
  const anchor = fixture.sessions.find((s) => s.tier === "anchor" && s.side === "a");
  let app,
    page,
    versions,
    workbenchId,
    prepared = false;
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !key.startsWith("VERA_") &&
        !["ELECTRON_RUN_AS_NODE", "ELECTRON_RENDERER_URL", "VITE_API"].includes(key),
    ),
  );
  env.VERA_TEST_BUNDLED_PLUGINS = "";
  const launch = async () => {
    app = await _electron.launch({
      executablePath: executable,
      args: [buildRoot, `--user-data-dir=${profile}`],
      env,
      chromiumSandbox: true,
      timeout: 30000,
    });
    await installNetworkGuard(app);
    const errors = [];
    app.process().stderr?.on("data", (data) => errors.push(String(data)));
    try {
      page = await app.firstWindow({ timeout: 15000 });
    } catch (error) {
      console.error(errors.join("").slice(-6000));
      for (const name of await readdir(join(profile, "logs")).catch(() => []))
        console.error((await readFile(join(profile, "logs", name), "utf8")).slice(-4000));
      throw error;
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForFunction(() => window.vera && Reflect.get(window, "veraSessionPerformance"));
    page.setDefaultTimeout(30000);
    if (prepared) {
      await page.evaluate(({ workbenchId, id }) => localStorage.setItem(`vera.session.${workbenchId}`, id), {
        workbenchId,
        id: fixture.sessions[0].id,
      });
      await page.locator(".workbench-group-name", { hasText: "Session performance" }).click();
    }
    versions ??= await app.evaluate(() => ({
      electron: process.versions.electron,
      chromium: process.versions.chrome,
      node: process.versions.node,
    }));
  };
  const close = async () => {
    if (app) {
      await deadline(
        () => app.close(),
        5000,
        () => kill(app),
      ).catch(() => kill(app));
      app = undefined;
    }
  };
  const memory = () =>
    app.evaluate(({ app }) => ({
      main: { rssBytes: process.memoryUsage().rss },
      renderer: {
        rssBytes: app
          .getAppMetrics()
          .filter((p) => p.type === "Tab")
          .reduce((n, p) => n + p.memory.workingSetSize * 1024, 0),
      },
    }));
  const select = async (session) => {
    const row = page.locator(`[data-session="${session.id}"]`);
    await row.scrollIntoViewIfNeeded();
    await row.click();
    await page.locator("[data-transcript]").getByText(session.last, { exact: false }).waitFor();
    await page.locator("#chat-message:not(:disabled)").waitFor();
  };
  const report = {
    format: 1,
    runId: crypto.randomUUID(),
    mode,
    repetitions: mode === "full" ? 30 : 5,
    cases: selectedTiers.flatMap((tier) => selectedScenarios.map((scenario) => `${tier}/${scenario}`)),
    source: await sourceIdentity(),
    identity: null,
    fixture: fixture.manifest,
    samples: [],
    method: {
      heartbeatMs: 20,
      viewport: [1440, 900],
      textScale: 1,
      clock: "independent monotonic durations; no cross-process subtraction",
      overhead:
        "load includes Playwright click dispatch/readiness/draft/scroll; presentation includes driver checks after API receipt",
      cache: "fresh process first-open, OS cache uncontrolled",
      memory: "main process.memoryUsage.rss; sum Electron Tab workingSetSize KiB times1024",
      deadlineMs: timeoutMs,
      injectedStallMs: inject,
    },
    status: "diagnostic",
  };
  try {
    await mkdir(folder);
    await mkdir(join(root, "src"), { recursive: true });
    await symlink(
      join(software, "src/models"),
      join(root, "src/models"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await writeFile(join(folder, "board.txt"), "board ready\nregister captured\n");
    await symlink(
      join(software, "node_modules"),
      join(root, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    );
    console.log("Building isolated session performance application…");
    await build(buildRoot);
    await deadline(
      async () => {
        await launch();
        await invoke(page, "app.settings.update", {
          language: "en",
          theme: "light",
          textScale: 1,
          updates: { mode: "off" },
        });
        const settings = (await invoke(page, "app.settings.get", {})).settings;
        report.method.presentation = {
          language: settings.language,
          theme: settings.theme,
          textScale: settings.textScale,
          chatFontSize: settings.chatFontSize ?? null,
          codeFontSize: settings.codeFontSize ?? null,
        };
        workbenchId = (await invoke(page, "workbench.create", { folder, name: "Session performance" })).config
          .id;
        const requireBase = join(software, "package.json");
        await app.evaluate(
          (_, { dbPath, sessions, requireBase }) => {
            const require = process.getBuiltinModule("node:module").createRequire(requireBase),
              Database = require("better-sqlite3");
            const db = new Database(dbPath);
            try {
              db.transaction(() => {
                const insertSession = db.prepare(
                  "INSERT INTO sessions(id,title,created_at,updated_at,model_ref,permission_mode,status,archived) VALUES(?,?,?, ?,NULL,'ask','idle',0)",
                );
                const insertEvent = db.prepare(
                  "INSERT INTO events(session_id,seq,type,payload_json,created_at) VALUES(?,?,?,?,?)",
                );
                const insertMessage = db.prepare(
                  "INSERT INTO messages(session_id,seq,role,content_json,created_at) VALUES(?,?,?,?,?)",
                );
                for (const session of sessions) {
                  const now = "2026-11-11T00:00:00.000Z";
                  insertSession.run(session.id, session.title, now, now);
                  session.events.forEach((event, index) => {
                    insertEvent.run(session.id, index + 1, event.type, JSON.stringify(event), now);
                  });
                  session.stored.forEach((message, index) => {
                    insertMessage.run(session.id, index + 1, message.role, JSON.stringify(message), now);
                  });
                }
              })();
            } finally {
              db.close();
            }
          },
          { dbPath: join(folder, ".vera/vera.db"), sessions: fixture.sessions, requireBase },
        );
        await page.reload();
        await select(anchor);
        prepared = true;
        await close();
      },
      90000,
      () => kill(app),
    );
    report.identity = {
      fixtureHash: fixture.fixtureHash,
      harnessHash: hash({
        scripts: await treeHash(resolve(software, "scripts/eval-performance-harness")),
        cli: hash(await readFile(join(software, "scripts/perf-sessions.mjs"))),
        probes: await Promise.all(
          ["main/session-performance.ts", "renderer/api/session-performance.ts"].map((p) =>
            readFile(join(software, "src/apps/desktop/src", p), "utf8"),
          ),
        ),
        viewport: report.method.viewport,
        scale: 1,
      }),
      environment: {
        host: hash(hostname()),
        os: platform(),
        hostKind: /microsoft/i.test(release()) ? "wsl" : "native-os",
        release: release(),
        cpu: cpus()[0]?.model ?? "unknown",
        cores: cpus().length,
        ramBytes: totalmem(),
        runtime: versions,
        nodeRunner: process.version,
      },
      presentation: report.method.presentation,
      buildMode: "compiled-test-session-performance",
      viewport: [1440, 900],
      scale: 1,
    };
    report.source.buildHash = await treeHash(buildRoot);
    for (const key of report.cases) {
      const [tier, scenario] = key.split("/"),
        target = fixture.sessions.find((s) => s.tier === tier && s.side === "a"),
        other = fixture.sessions.find((s) => s.tier === tier && s.side === "b");
      console.log(`Measuring ${key} (${report.repetitions} samples)…`);
      for (let index = 0; index < report.repetitions; index++) {
        const prepareStart = performance.now();
        const sample = { case: key, index, ok: false };
        report.samples.push(sample);
        try {
          await deadline(
            async () => {
              if (!app) {
                await launch();
                await page.locator(`[data-session="${anchor.id}"]`).waitFor();
              }
              if (scenario === "warm") {
                await select(target);
                await select(other);
              } else if (scenario === "cross") await select(anchor);
              const before = await memory();
              sample.preparationMs = performance.now() - prepareStart;
              const row = page.locator(`[data-session="${target.id}"]`);
              await row.scrollIntoViewIfNeeded();
              await app.evaluate(
                (_, { id, inject }) => Reflect.get(globalThis, "veraSessionPerformance").begin(id, inject),
                { id: target.id, inject },
              );
              await page.evaluate((id) => Reflect.get(window, "veraSessionPerformance").begin(id), target.id);
              const start = performance.now();
              await deadline(
                async () => {
                  await row.click({ timeout: timeoutMs });
                  await page
                    .locator(`[data-session="${target.id}"][aria-current="page"]`)
                    .waitFor({ timeout: timeoutMs });
                  await page
                    .locator("[data-transcript]")
                    .getByText(target.last, { exact: false })
                    .waitFor({ timeout: timeoutMs });
                  const composer = page.locator("#chat-message:not(:disabled)");
                  await composer.fill("performance draft", { timeout: timeoutMs });
                  if ((await composer.inputValue()) !== "performance draft") throw Error("draft-not-usable");
                  const transcript = page.locator("[data-transcript]");
                  await transcript.focus();
                  await page.keyboard.press("Control+End");
                  const beforeScroll = await transcript.evaluate((node) => node.scrollTop);
                  await page.keyboard.press("Control+Home");
                  const first = transcript.getByText(target.first, { exact: false });
                  await first.waitFor({ timeout: timeoutMs });
                  await page.waitForFunction(
                    () => document.querySelector("[data-transcript]")?.scrollTop === 0,
                    undefined,
                    { timeout: timeoutMs },
                  );
                  await page.evaluate(
                    () =>
                      new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
                  );
                  const historyUsable = await first.evaluate((node) => {
                    const viewport = node.closest("[data-transcript]");
                    const outer = viewport.getBoundingClientRect(),
                      inner = node.getBoundingClientRect();
                    return {
                      top: viewport.scrollTop,
                      max: viewport.scrollHeight - viewport.clientHeight,
                      intersects: inner.bottom > outer.top && inner.top < outer.bottom,
                    };
                  });
                  if (
                    !historyUsable.intersects ||
                    historyUsable.top > 1 ||
                    (historyUsable.max > 1 && beforeScroll <= historyUsable.top)
                  )
                    throw Error("history-not-scrollable");
                },
                timeoutMs,
                () => kill(app),
              );
              const loadMs = performance.now() - start;
              await deadline(
                async () => {
                  const { snapshotHash: deliveredHash, ...renderer } = await page.evaluate(() =>
                    Reflect.get(window, "veraSessionPerformance").end(),
                  );
                  const main = await app.evaluate(() =>
                    Reflect.get(globalThis, "veraSessionPerformance").end(),
                  );
                  const correct =
                    main.snapshotHash === target.snapshotHash && deliveredHash === target.snapshotHash;
                  const externalTraffic =
                    (await outboundAttempts(app)).length +
                    (await app.evaluate(() => Reflect.get(globalThis, "veraSessionPerformance").traffic()));
                  Object.assign(sample, {
                    ok: correct && !externalTraffic && !main.providerRequests,
                    correct,
                    contentProof: {
                      expected: target.snapshotHash,
                      main: main.snapshotHash,
                      renderer: deliveredHash,
                    },
                    externalTraffic,
                    providerRequests: main.providerRequests,
                    metrics: {
                      loadMs,
                      storageMs: main.storageMs,
                      snapshotMs: main.snapshotMs,
                      mainHandlerMs: main.mainHandlerMs,
                      payloadBytes: main.payloadBytes,
                      mainGapMs: main.mainGapMs,
                      ...renderer,
                    },
                    memory: { before, after: await memory() },
                  });
                  if (!sample.ok) sample.error = "content-or-network-contract";
                  validateSample(sample);
                  await page.locator("#chat-message").fill("");
                },
                timeoutMs,
                () => kill(app),
              );
            },
            timeoutMs * 4 + 30000,
            () => kill(app),
          );
        } catch (error) {
          sample.ok = false;
          console.error(key, index, String(error).split("\n").slice(0, 3).join("\n"));
          sample.error =
            error.message === "external-deadline" ? "external-deadline" : "crash-or-measurement-failure";
        }
        if (sample.ok && scenario === "first")
          await deadline(
            () => select(anchor),
            timeoutMs,
            () => kill(app),
          ).catch(() => {
            sample.ok = false;
            sample.error = "reset-failed";
          });
        if (!sample.ok || scenario === "first") await close();
        if ((index + 1) % 5 === 0)
          console.log(
            `${key}: ${index + 1}/${report.repetitions}; last ${sample.ok ? `${sample.metrics.loadMs.toFixed(1)}ms` : sample.error}`,
          );
      }
      const good = report.samples
        .filter((sample) => sample.case === key && sample.ok)
        .map((sample) => sample.metrics.loadMs);
      console.log(
        `${key}: ${good.length}/${report.repetitions} complete; mean ${(good.reduce((n, value) => n + value, 0) / Math.max(1, good.length)).toFixed(1)}ms`,
      );
      await close();
    }
    report.status = report.samples.every((s) => s.ok) ? "diagnostic" : "failed";
    if (report.status === "diagnostic") validateReport(report);
    return report;
  } finally {
    await close();
    await rm(root, { recursive: true, force: true });
  }
}
