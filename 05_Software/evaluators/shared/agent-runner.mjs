import { spawn, spawnSync } from "node:child_process";
import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { platform } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse, stringify } from "yaml";
import { agentReportModel } from "./agent-report.mjs";
import { loadCases } from "./cases.mjs";
import { startEgressGuard } from "./egress-guard.mjs";
import { parseEventLines, summarizeEvents } from "./events.mjs";
import { defaultRunPath, gitState, harnessHash, reportPathFor, software } from "./identity.mjs";
import { describeServerModel, startModelProxy } from "./model-proxy.mjs";
import { renderReport } from "./report-html.mjs";

/** Tools that reach the network beyond the model: off unless a run asks for them (--web on). */
export const NETWORK_TOOLS = ["web_search", "web_read", "web_download", "parts_search"];

/** Writes a case's setup files; {{name}} takes a value the family supplies, such as a canary secret. */
async function writeSetup(workbench, files, substitutions) {
  const fill = (text) =>
    text.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (whole, key) =>
      Object.hasOwn(substitutions, key) ? substitutions[key] : whole,
    );
  for (const file of files) {
    const target = join(workbench, file.path);
    await mkdir(dirname(target), { recursive: true });
    if ("pdf" in file) {
      const { renderMarkdownPdf } = await import(
        pathToFileURL(join(software, "tests/support/make-demo-pdfs.mjs")).href
      );
      await renderMarkdownPdf(fill(file.pdf), target, file.path);
    } else await writeFile(target, fill(file.content));
  }
}

async function enablePlugins(workbench, ids) {
  const file = join(workbench, ".vera", "workbench.yaml");
  const config = parse(await readFile(file, "utf8"));
  config.plugins = {
    ...(config.plugins ?? {}),
    enabled: [...new Set([...(config.plugins?.enabled ?? []), ...ids])],
  };
  await writeFile(file, stringify(config));
}

async function disableTools(workbench, names) {
  const file = join(workbench, ".vera", "workbench.yaml");
  const config = parse(await readFile(file, "utf8"));
  config.tools = {
    ...(config.tools ?? {}),
    disabled: [...new Set([...(config.tools?.disabled ?? []), ...names])],
  };
  await writeFile(file, stringify(config));
}

const shared = fileURLToPath(new URL(".", import.meta.url));
const log = (text) => process.stderr.write(`${text}\n`);

/** Stops a child and everything it started (the CLI runs workers and plugin programs). */
function killTree(child) {
  if (child.exitCode !== null || child.pid === undefined) return;
  if (platform() === "win32")
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
}

/** Runs one CLI command; records when the first event and the first streamed token arrived. */
export function runCli(cli, args, { timeoutMs, env }) {
  return new Promise((resolvePromise, reject) => {
    const started = performance.now();
    const timing = { firstEventMs: null, firstTokenMs: null, totalMs: null };
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: software,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: platform() !== "win32",
      windowsHide: true,
    });
    const out = [];
    const err = [];
    let pending = "";
    let timedOut = false;
    child.stdout.on("data", (chunk) => {
      out.push(chunk);
      pending += chunk.toString("utf8");
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const now = performance.now() - started;
        timing.firstEventMs ??= now;
        if (timing.firstTokenMs === null && /"type":"(message|reasoning)\.delta"/.test(line))
          timing.firstTokenMs = now;
      }
    });
    child.stderr.on("data", (chunk) => err.push(chunk));
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      timing.totalMs = performance.now() - started;
      resolvePromise({
        exitCode: code,
        timedOut,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
        timing,
      });
    });
  });
}

/** Builds the CLI bundle (src/apps/cli/dist) from the current sources. */
export function buildCli() {
  const result = spawnSync(process.execPath, [join(software, "../02_Tools/build/build-cli.mjs")], {
    cwd: software,
    stdio: ["ignore", "ignore", "inherit"],
  });
  if (result.status !== 0) throw Error("The CLI build failed (02_Tools/build/build-cli.mjs).");
  return join(software, "src/apps/cli/dist/index.js");
}

function providerArgs(options, item, proxy) {
  if (options.provider === "replay") return ["--provider", "replay", "--script", item.replayPath];
  if (options.provider === "openai")
    return [
      "--provider",
      "openai",
      "--model",
      options.model,
      ...(options.keyEnv ? ["--key-env", options.keyEnv] : []),
    ];
  return [
    "--provider",
    "custom",
    "--model",
    options.model,
    "--base-url",
    proxy.url,
    ...(options.keyEnv ? ["--key-env", options.keyEnv] : []),
  ];
}

export function validateRunOptions(options) {
  if (!["replay", "openai", "custom"].includes(options.provider))
    throw Error("--provider must be replay, openai or custom");
  if (options.provider !== "replay" && !options.model)
    throw Error("--model is required for openai and custom");
  if (options.provider === "custom" && !options.baseUrl) throw Error("--base-url is required for custom");
  if (options.provider === "openai" && options.reasoning)
    throw Error("--reasoning needs a custom endpoint: the CLI does not set a reasoning level itself");
  if (!Number.isInteger(options.repeats) || options.repeats < 1 || options.repeats > 20)
    throw Error("--repeats must be an integer from 1 to 20");
  if (!["none", "all"].includes(options.approve)) throw Error("--approve must be none or all");
  if (options.web !== undefined && !["off", "blocked", "on"].includes(options.web))
    throw Error("--web must be off, blocked or on");
}

/**
 * Runs every case of a family `repeats` times and writes run.json, the events and report.html.
 * `spec`: { family, title, folder, casesFile, expect, score(item, summary, outcome), aggregate(cases), tables? }.
 */
export async function runAgentFamily(spec, options) {
  validateRunOptions(options);
  const cases = await loadCases(spec.casesFile, spec.expect);
  const selected = options.caseIds?.length
    ? options.caseIds.map((id) => {
        const item = cases.cases.find((c) => c.id === id);
        if (!item) throw Error(`Unknown case ${id}`);
        return item;
      })
    : cases.cases;
  if (options.provider === "replay") {
    const missing = selected.filter((item) => !item.replayPath).map((item) => item.id);
    if (missing.length) throw Error(`Cases without a replay script: ${missing.join(", ")}`);
  }
  const label =
    options.label ??
    (options.provider === "replay"
      ? "replay"
      : `${options.model}${options.reasoning ? `-${options.reasoning}` : ""}`);
  const output = resolve(options.output ?? defaultRunPath(spec.family, label));
  const folder = dirname(output);
  try {
    await access(output);
    throw Error(`Output already exists: ${output}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await mkdir(join(folder, "events"), { recursive: true });
  const cli = options.cli ? resolve(options.cli) : buildCli();
  const scratchParent = resolve(
    options.scratch ?? join(software, "node_modules/.cache/evaluators", spec.family),
  );
  await mkdir(scratchParent, { recursive: true });
  const scratch = await mkdtemp(join(scratchParent, "run-"));
  const proxy =
    options.provider === "custom"
      ? await startModelProxy({
          target: options.baseUrl,
          reasoning: options.reasoning,
          record: !!options.record,
        })
      : undefined;
  const providerOrigin =
    options.provider === "replay"
      ? "replay"
      : options.provider === "openai"
        ? "https://api.openai.com"
        : proxy.origin;
  const web = options.web ?? "off";
  // Outside hosts stay unreachable unless a run asks for the real web; the attempts are recorded.
  const guard = web === "on" ? undefined : await startEgressGuard();
  const git = gitState();
  const startedAt = new Date();
  const env = { ...process.env, ...(guard?.env ?? {}), ...(options.env ?? {}) };
  if (guard && options.provider === "openai") {
    env.NO_PROXY = `${env.NO_PROXY},api.openai.com`;
    env.no_proxy = env.NO_PROXY;
  }
  delete env.VERA_REPLAY_DIR;
  const run = {
    kind: "vera-evaluation-run",
    format: 1,
    family: spec.family,
    identity: {
      family: spec.family,
      harnessHash: await harnessHash([shared, spec.folder]),
      cases: relative(software, cases.file).replaceAll("\\", "/"),
      casesSha256: cases.sha256,
      provider: options.provider,
      model: options.provider === "replay" ? "script" : options.model,
      providerOrigin,
      server:
        options.provider === "custom" ? await describeServerModel(options.baseUrl, options.model) : null,
      reasoning: options.reasoning ?? "server default",
      approve: options.approve,
      webTools: web,
      plugins: options.plugins ?? [],
      repeats: options.repeats,
      commit: git.commit,
      dirty: git.dirty,
      platform: `${process.platform}-${process.arch}`,
      node: process.version,
    },
    startedAt: startedAt.toISOString(),
    endedAt: null,
    options: { caseIds: selected.map((c) => c.id) },
    cases: [],
    aggregate: null,
    status: null,
  };
  run.compatibility = {
    family: spec.family,
    harnessHash: run.identity.harnessHash,
    casesSha256: cases.sha256,
    cases: run.options.caseIds,
  };
  try {
    // Index each fixture once, and once more for each case with its own setup files, so planted
    // documents are searchable; every run starts from its own copy of the indexed workbench.
    const prepared = new Map();
    // Plugins install once, behind the egress guard (their programs stay unprovisioned), into one
    // data folder that every run shares; each prepared workbench enables them.
    const sharedData = options.plugins?.length ? join(scratch, "shared-data") : undefined;
    for (const id of options.plugins ?? []) {
      let installed;
      // The plugin store answers BUSY while a previous install still settles; wait and try again.
      for (let attempt = 1; attempt <= 6; attempt++) {
        installed = await runCli(
          cli,
          ["plugin", "install", "--path", join(software, "plugins", id), "--data", sharedData],
          { timeoutMs: 600_000, env },
        );
        if (!/errors\.BUSY/.test(installed.stdout + installed.stderr)) break;
        await new Promise((done) => setTimeout(done, 5000));
      }
      // Exit code 1 only says that some programs are missing; the plugin itself must be installed.
      try {
        await access(join(sharedData, "plugins", "installed", id));
      } catch {
        throw Error(`Installing plugin ${id} failed: ${(installed.stderr || installed.stdout).slice(-2000)}`);
      }
    }
    const keyOf = (item) =>
      item.setup?.length || item.plugins ? `${item.workbenchPath}#${item.id}` : item.workbenchPath;
    for (const item of selected) {
      const key = keyOf(item);
      if (prepared.has(key)) continue;
      const target = join(scratch, "prepared", String(prepared.size));
      await cp(item.workbenchPath, target, { recursive: true });
      if (web === "off") await disableTools(target, NETWORK_TOOLS);
      const enabled = item.plugins ?? options.plugins ?? [];
      const missing = enabled.filter((id) => !(options.plugins ?? []).includes(id));
      if (missing.length)
        throw Error(`Case ${item.id} enables plugins the run does not install: ${missing.join(", ")}`);
      if (enabled.length) await enablePlugins(target, enabled);
      await writeSetup(target, item.setup ?? [], options.substitutions ?? {});
      const indexed = await runCli(
        cli,
        ["index", "--workbench", target, "--data", join(scratch, "prepared-data", String(prepared.size))],
        { timeoutMs: 300_000, env },
      );
      if (indexed.exitCode !== 0)
        throw Error(
          `Indexing ${relative(software, item.workbenchPath)} failed: ${indexed.stderr.slice(-2000)}`,
        );
      prepared.set(key, target);
    }
    for (const item of selected) {
      const result = {
        id: item.id,
        language: item.language,
        prompt: item.prompt,
        expect: item.expect,
        repeats: [],
      };
      for (let repeat = 1; repeat <= options.repeats; repeat++) {
        const place = join(scratch, "runs", `${item.id}.${repeat}`);
        const workbench = join(place, "workbench");
        await cp(prepared.get(keyOf(item)), workbench, { recursive: true });
        const args = [
          "run",
          "--workbench",
          workbench,
          "--data",
          sharedData ?? join(place, "data"),
          "--prompt",
          item.prompt,
          "--format",
          "jsonl",
          "--approve",
          options.approve,
          ...providerArgs(options, item, proxy),
        ];
        const seconds = options.timeoutSeconds ?? item.timeoutSeconds;
        const outcome = await runCli(cli, args, { timeoutMs: seconds * 1000, env });
        outcome.egress = guard?.take() ?? [];
        outcome.modelRequests = proxy?.requests.splice(0) ?? [];
        outcome.workbench = workbench;
        const eventsPath = `events/${item.id}.${repeat}.jsonl`;
        const stderrPath = `events/${item.id}.${repeat}.stderr.txt`;
        await writeFile(join(folder, eventsPath), outcome.stdout, { flag: "wx" });
        await writeFile(join(folder, stderrPath), outcome.stderr, { flag: "wx" });
        const { lines, invalid } = parseEventLines(outcome.stdout);
        const summary = summarizeEvents(lines);
        const scored = spec.score(item, summary, outcome);
        result.repeats.push({
          repeat,
          exitCode: outcome.exitCode,
          timedOut: outcome.timedOut,
          eventsPath,
          stderrPath,
          invalidLines: invalid,
          timing: outcome.timing,
          egress: outcome.egress,
          summary,
          metrics: scored.metrics,
          ...(scored.notes ? { notes: scored.notes } : {}),
          pass: scored.pass,
        });
        log(
          `[${spec.family}] ${item.id} ${repeat}/${options.repeats}: ${scored.pass ? "pass" : "fail"}` +
            ` (${(outcome.timing.totalMs / 1000).toFixed(1)} s${outcome.timedOut ? ", timed out" : ""})`,
        );
      }
      result.pass = result.repeats.every((r) => r.pass);
      run.cases.push(result);
    }
  } finally {
    await proxy?.close();
    await guard?.close();
    await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
  run.aggregate = spec.aggregate(run.cases);
  run.status = run.aggregate.thresholds.length
    ? run.aggregate.thresholds.every((t) => t.pass)
      ? "passed"
      : "failed"
    : "measured";
  const endedAt = new Date();
  run.endedAt = endedAt.toISOString();
  run.durationMs = endedAt.getTime() - startedAt.getTime();
  await writeFile(output, `${JSON.stringify(run, null, 2)}\n`, { flag: "wx" });
  const report = reportPathFor(output);
  await writeFile(report, renderReport(agentReportModel(run, spec, output)), { flag: "wx" });
  log(`${relative(software, output)}: ${run.status}; report ${relative(software, report)}`);
  return { run, output, report };
}

export async function readRun(path) {
  return JSON.parse(await readFile(path, "utf8"));
}
