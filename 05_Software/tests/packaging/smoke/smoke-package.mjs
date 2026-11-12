// REQ-TEST-8928f10f REQ-TEST-b111844b
import assert from "node:assert/strict";
import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { exactLoopback } from "./smoke-egress.mjs";
import {
  fileIdentity,
  parseSmokeArgs,
  smokeStatus,
  upgradeSummary,
  windowsEvidence,
} from "./smoke-report.mjs";
import { copyDemo, extractArtifact, launchObserved, until } from "./smoke-runtime.mjs";
import { assertSnapshotBudget, startSmokeServer } from "./smoke-server.mjs";

export async function smokePackage(options) {
  const root = options.resume ?? options.scratch ?? join(tmpdir(), `vera-smoke-${Date.now()}`);
  // Claim a new root exclusively; never reuse or mutate somebody else's scratch.
  const input = await fileIdentity(options.artifact);
  let previous;
  if (options.resume) {
    previous = JSON.parse(await readFile(join(root, "smoke-report.json"), "utf8"));
    assert.equal(previous.status, "FAIL", "Only failed smoke can resume");
    assert.equal(previous.artifactAfter.sha256, input.sha256, "Resumed artifact mismatch");
    assert.equal(previous.artifact.path, input.path);
    assert(
      previous.launches.every((launch) => launch.exit && launch.exitConfirmed !== false),
      "Prior launches must have exit evidence before reuse",
    );
    const archive = join(root, `failed-${Date.now()}`);
    await mkdir(archive);
    const relocation = [];
    for (const name of await readdir(root)) {
      if (/\.(?:log|json|png)$/.test(name)) {
        const dest = join(archive, name);
        await cp(join(root, name), dest);
        relocation.push({ original: join(root, name), retained: await fileIdentity(dest) });
      }
    }
    await writeFile(join(archive, "relocation.json"), JSON.stringify(relocation, null, 2));
  } else await mkdir(root);
  const report = {
    schema: 1,
    started: new Date().toISOString(),
    platform: process.platform,
    host: "Current native host; no clean machine, separate kernel or signing inference",
    artifact: input,
    driver: await fileIdentity(fileURLToPath(import.meta.url)),
    harnessInputs: await Promise.all(
      ["package", "runtime", "egress", "report", "server"].map((name) =>
        fileIdentity(join(dirname(fileURLToPath(import.meta.url)), `smoke-${name}.mjs`)),
      ),
    ),
    launches: [],
    runs: [],
    upgrade: [],
    manual: { windows: { status: "pending" } },
    status: "FAIL",
  };
  let current, server;
  async function endRun(outcome) {
    await current.finish();
    outcome.egress = current.receipt.egress ?? {
      status: "pending",
      reason: "Windows manual monitor required",
    };
    if (process.platform === "linux")
      assert.equal(outcome.egress.status, "PASS", JSON.stringify(outcome.egress.errors));
    assert.equal(current.receipt.exit.code, 0, "App exit failed");
    outcome.status = "PASS";
    current = undefined;
  }
  try {
    for (const path of options.upgradeProof) {
      const bytes = await readFile(path);
      report.upgrade.push({ report: await fileIdentity(path), ...upgradeSummary(JSON.parse(bytes)) });
    }
    report.manual.windows = windowsEvidence(
      options.windowsEvidence ? JSON.parse(await readFile(options.windowsEvidence, "utf8")) : null,
      report.artifact.sha256,
    );
    if (options.windowsEvidence) {
      report.manual.windows.captureObserved = await fileIdentity(report.manual.windows.capture.path);
      assert.equal(report.manual.windows.captureObserved.sha256, report.manual.windows.capture.sha256);
    }
    if (previous?.installation) report.installation = previous.installation;
    const context = await extractArtifact(options.artifact, root, report, !!previous);
    if (previous?.asar) assert.equal(report.asar.sha256, previous.asar.sha256, "Resumed ASAR changed");
    if (previous?.executable)
      assert.equal(report.executable.sha256, previous.executable.sha256, "Resumed executable changed");
    const bench = await copyDemo(root, !!previous);
    const offline = { name: "offline", status: "FAIL" };
    report.runs.push(offline);
    current = await launchObserved(context, "offline", report);
    await current.identity();
    const wb = await current.invoke("workbench.open", { folder: bench });
    assert.equal(wb.readOnly, false);
    const workbenchId = wb.config.id;
    await current.invoke("docs.reindex", { workbenchId });
    const docs = await until(async () => {
      const { documents } = await current.invoke("docs.list", { workbenchId });
      assert(!documents.some((d) => d.status === "failed"), JSON.stringify(documents));
      return documents.length > 0 && !documents.some((d) => d.status === "pending") ? documents : null;
    }, "demo documents indexed");
    const pdf = docs.find((d) => d.kind === "pdf" && d.status === "indexed");
    assert(pdf && pdf.pages > 0);
    offline.documents = docs;
    const search = await current.invoke("docs.search", { workbenchId, query: "SDA I2C power board" });
    assert(search.results.length > 0, "Real local embedding search returned no result");
    offline.search = search;
    const opened = await current.invoke("docs.open", { workbenchId, path: pdf.path });
    assert.equal(opened.content.kind, "pdf");
    assert(opened.content.data && opened.content.pages.length > 0);
    offline.pdf = {
      path: pdf.path,
      pages: opened.content.pages.length,
      extractedText: opened.content.pages.join("\n").slice(0, 1000),
      bytesBase64: opened.content.data.length,
    };
    const offlineSession = await current.invoke("session.create", { modelRef: null });
    await current.page.reload();
    await current.page.locator(`[data-session="${offlineSession.id}"]`).click();
    const docsTab = current.page.getByRole("tab", { name: "Docs", exact: true });
    if (!(await docsTab.isVisible())) await current.page.locator('[data-toggle="right"]').click();
    await docsTab.click();
    await current.page
      .locator("[data-document]")
      .filter({ has: current.page.getByText(pdf.path, { exact: true }) })
      .getByRole("button", { name: "Open", exact: true })
      .click();
    await current.page.waitForFunction(
      () => document.querySelector(".pdf-viewer")?.getAttribute("data-ready") === "true",
    );
    offline.canvas = await current.page.locator(".pdf-viewer canvas").evaluate((canvas) => ({
      width: canvas.width,
      height: canvas.height,
      painted: canvas
        .getContext("2d")
        .getImageData(0, 0, canvas.width, canvas.height)
        .data.some((value, index) => index % 4 !== 3 && value !== 255),
    }));
    assert(offline.canvas.width > 0 && offline.canvas.height > 0 && offline.canvas.painted);
    await current.page.screenshot({ path: join(root, "offline-pdf.png") });
    offline.sessionId = offlineSession.id;
    await endRun(offline);

    const offlineRestart = { name: "offline-restart", status: "FAIL" };
    report.runs.push(offlineRestart);
    current = await launchObserved(context, "offline-restart", report);
    await current.identity();
    await current.invoke("workbench.open", { folder: bench });
    offlineRestart.documents = (await current.invoke("docs.list", { workbenchId })).documents;
    assert(offlineRestart.documents.some((d) => d.path === pdf.path && d.status === "indexed"));
    assert(
      (await current.invoke("session.list")).some((s) => s.id === offlineSession.id),
      "SQLite session did not persist",
    );
    await endRun(offlineRestart);

    server = await startSmokeServer();
    report.endpoint = { url: server.url, allowed: exactLoopback(server.port) };
    const scripted = { name: "scripted", status: "FAIL" };
    report.runs.push(scripted);
    current = await launchObserved(context, "scripted", report, exactLoopback(server.port));
    await current.identity();
    await current.invoke("workbench.open", { folder: bench });
    await current.invoke("providers.save", {
      provider: "custom",
      config: {
        name: "Smoke",
        baseUrl: server.url,
        model: "smoke",
        contextWindow: 32768,
        maxOutputTokens: 4096,
        supportsTools: true,
      },
    });
    const session = await current.invoke("session.create", { modelRef: "custom:smoke/smoke", mode: "ask" });
    await current.page.reload();
    await current.page.locator(`[data-session="${session.id}"]`).click();
    await current.invoke("session.send", {
      sessionId: session.id,
      text: "Read the demo workbench context, write the smoke approval note, and cite the context.",
    });
    const waiting = await until(async () => {
      const s = (await current.invoke("session.get", { sessionId: session.id })).snapshot;
      if (s.status === "error") throw Error(JSON.stringify(s));
      return s.status === "awaiting_approval" ? s : null;
    }, "normal approval");
    assert.equal(waiting.approvals.at(-1).path, "notes/smoke-approved.md");
    scripted.beforeApproval = waiting;
    scripted.beforeApprovalBudget = assertSnapshotBudget(waiting.usage);
    await current.page
      .locator("[data-approval-card]")
      .getByRole("button", { name: "Approve", exact: true })
      .click();
    const done = await until(async () => {
      const s = (await current.invoke("session.get", { sessionId: session.id })).snapshot;
      if (s.status === "error") throw Error(JSON.stringify(s));
      return s.status === "idle" ? s : null;
    }, "scripted done");
    assert(done.items.some((i) => i.kind === "tool" && i.name === "read" && i.status === "ok"));
    assert(done.items.some((i) => i.kind === "tool" && i.name === "write" && i.status === "ok"));
    assert(
      done.items.some(
        (i) => i.kind === "assistant" && i.citations.some((c) => c.valid && c.ref === "board.txt#L1-L2"),
      ),
    );
    assert.equal(done.approvals.at(-1).decision, "approved");
    assert.equal(
      await readFile(join(bench, "notes/smoke-approved.md"), "utf8"),
      "Release smoke approval passed.\n",
    );
    assert.equal(server.requests.length, 3);
    assert.deepEqual(server.errors, []);
    scripted.snapshot = done;
    scripted.finalBudget = assertSnapshotBudget(done.usage);
    scripted.requests = server.requests;
    scripted.sessionId = session.id;
    await current.page.screenshot({ path: join(root, "scripted.png") });
    await endRun(scripted);
    const restarted = { name: "scripted-restart", status: "FAIL" };
    report.runs.push(restarted);
    current = await launchObserved(context, "scripted-restart", report, exactLoopback(server.port));
    await current.identity();
    await current.invoke("workbench.open", { folder: bench });
    restarted.snapshot = (await current.invoke("session.get", { sessionId: session.id })).snapshot;
    assert.deepEqual(restarted.snapshot, done);
    assert.equal(server.requests.length, 3, "Restart issued an unexpected provider request");
    await endRun(restarted);
    report.functionalStatus = "PASS";
    report.egressStatus = process.platform === "linux" ? "PASS" : report.manual.windows.status;
    report.status = smokeStatus(report.egressStatus, report.installation?.status);
  } catch (error) {
    report.error = { message: error.message, stack: error.stack };
    report.status = "FAIL";
    if (current) {
      await current.page.screenshot({ path: join(root, "failure.png") }).catch(() => {});
    }
  } finally {
    await current?.finish().catch((error) => {
      report.closeError = String(error);
    });
    await server?.close();
    if (server) report.server = { url: server.url, requests: server.requests, errors: server.errors };
    report.artifactAfter = await fileIdentity(options.artifact);
    if (report.artifactAfter.sha256 !== report.artifact.sha256) {
      report.status = "FAIL";
      report.artifactMutation = true;
    }
    report.finished = new Date().toISOString();
    await writeFile(join(root, "smoke-report.json"), JSON.stringify(report, null, 2));
  }
  console.log(
    JSON.stringify({
      report: join(root, "smoke-report.json"),
      status: report.status,
      functional: report.functionalStatus,
      egress: report.egressStatus,
      error: report.error?.message.slice(0, 500),
    }),
  );
  return report.status === "PASS" ? 0 : report.status === "pending" ? 2 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await smokePackage(parseSmokeArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
