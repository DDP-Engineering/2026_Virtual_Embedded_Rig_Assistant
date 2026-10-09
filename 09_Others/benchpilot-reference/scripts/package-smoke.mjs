// `npm run package:smoke` (08 Verify §2): the built zip, extracted and started like a user would, in a clean env.
//  1. extract dist/BenchPilot-Demo-<version>-win-x64.zip with Windows' tar into a temp path with a space and a
//     non-ASCII character
//  2. static checks on the extracted tree: every binary resolves its DLLs in the bundle or Windows; the bundled
//     tshark decodes every demo capture (-V) byte-identically to the installed Wireshark (proves the minimal set)
//  3. `Start BenchPilot.bat --no-browser` via cmd.exe with a sanitized env: PATH = System32 only, no Node, Python
//     or Wireshark, no developer variables
//  4. HTTP: /api/health = the bundled tshark · About = bundle · web root + /assets/* 200 · provider = Demo replay ·
//     demo-1 via the API → RPT-0009 PERF fail / DNS pass / END fail · pcap evidence with a tshark -V tree ·
//     a second start opens the browser on the running instance · /admin/reset
//  5. e2e/smoke.spec.ts (Playwright, system Edge) against the bundle: no request leaves the origin, no console error
//  6. the server process opens no non-loopback connection (netstat sampler for the whole run)
//  7. kill the server like a closed console window → port free, no process left from the bundle, temp dir removed
// SMOKE_KEEP=1 keeps the temp dir; SMOKE_BROWSER=chromium as in `npm run smoke`.
import { execFile, execFileSync, spawn, spawnSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { parseEnv } from "node:util";
import { unresolvedImports, walk } from "./package/checks.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const SYSTEM32 = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32");
const version = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
const zipFile = path.join(ROOT, "dist", `BenchPilot-Demo-${version}-win-x64.zip`);
const MARK = "bp-pkg-smoke-";
const tmp = mkdtempSync(path.join(os.tmpdir(), MARK));
const extractDir = path.join(tmp, "Demo ă test"); // 08 Verify §2 + §4: a space and a non-ASCII character
const BUNDLE = path.join(extractDir, "BenchPilot-Demo");
const launcherLog = path.join(tmp, "launcher.log");
const PROMPT_1 = "Run the performance tests for firmware 2.1.0.";

const step = (s) => console.log(`\n▸ package:smoke: ${s}`);
const ok = (s) => console.log(`  ✓ ${s}`);
function assert(cond, message) {
  if (!cond) throw new Error(message);
}

/** The env a PC without dev tools gives a double-clicked .bat: Windows basics only, PATH = System32. */
function cleanEnv() {
  const keep = ["SystemRoot", "windir", "SystemDrive", "ComSpec", "PATHEXT", "TEMP", "TMP", "USERPROFILE", "USERNAME", "USERDOMAIN", "COMPUTERNAME", "APPDATA", "LOCALAPPDATA", "HOMEDRIVE", "HOMEPATH", "PROCESSOR_ARCHITECTURE", "NUMBER_OF_PROCESSORS", "OS"];
  const env = {};
  for (const k of keep) if (process.env[k] !== undefined) env[k] = process.env[k];
  env.PATH = SYSTEM32;
  env.DEMO_SPEED = "10"; // not a path key: the launcher keeps it (a 12 h test plays in ~4 s instead of ~40 s)
  return env;
}

/** The developer's installed tshark, for the equivalence check only (env or .env key; nothing else is read). */
function installedTshark() {
  if (process.env.TSHARK_PATH) return process.env.TSHARK_PATH;
  const file = path.join(ROOT, ".env");
  return existsSync(file) ? parseEnv(readFileSync(file, "utf8")).TSHARK_PATH : undefined;
}

function tsharkRun(exe, args, configDir) {
  return new Promise((resolve) => {
    execFile(
      exe,
      args,
      { env: { SystemRoot: process.env.SystemRoot, PATH: SYSTEM32, WIRESHARK_CONFIG_DIR: configDir }, maxBuffer: 512 * 1024 * 1024, windowsHide: true, encoding: "utf8" },
      (err, stdout, stderr) => resolve({ code: err ? (err.code ?? 1) : 0, stdout, stderr }),
    );
  });
}

async function mapLimit(items, n, fn) {
  const out = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    }),
  );
  return out;
}

const answers = (host, port) =>
  new Promise((resolve) => {
    const s = net.connect({ host, port });
    const done = (v) => {
      s.destroy();
      resolve(v);
    };
    s.setTimeout(500, () => done(false));
    s.once("connect", () => done(true));
    s.once("error", () => done(false));
  });
const canBind = (port) =>
  new Promise((resolve) => {
    const srv = net.createServer().once("error", () => resolve(false));
    srv.listen(port, "127.0.0.1", () => srv.close(() => resolve(true)));
  });

/** PIDs of processes whose executable lives under this smoke's temp dir (ASCII marker: PowerShell output is OEM). */
function bundleProcesses() {
  const r = spawnSync(
    path.join(SYSTEM32, "WindowsPowerShell", "v1.0", "powershell.exe"),
    ["-NoProfile", "-NonInteractive", "-Command", `Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like '*${path.basename(tmp)}*' } | ForEach-Object { \"$($_.ProcessId) $($_.Name)\" }`],
    { encoding: "utf8" },
  );
  return r.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

/** Non-loopback TCP peers of `pid` right now. */
function externalPeers(pid) {
  const out = spawnSync(path.join(SYSTEM32, "netstat.exe"), ["-ano"], { encoding: "utf8" }).stdout ?? "";
  const peers = [];
  for (const line of out.split(/\r?\n/)) {
    const f = line.trim().split(/\s+/);
    if (f[0] !== "TCP" || f.at(-1) !== String(pid)) continue;
    const remote = f[2];
    if (!/^(127\.0\.0\.1|\[::1\]|0\.0\.0\.0|\[::\]):/.test(remote)) peers.push(`${f[1]} → ${remote} ${f[3]}`);
  }
  return peers;
}

async function http(base, p, init) {
  const res = await fetch(`${base}${p}`, init);
  return res;
}
const getJson = async (base, p) => {
  const res = await http(base, p);
  assert(res.ok, `GET ${p} → ${res.status}`);
  return res.json();
};
const postJson = (base, p, body) => http(base, p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });

/** Reads the session's SSE stream; approves the plan; resolves once a run completed and its turn is done. */
async function demo1(base) {
  const created = await postJson(base, "/api/sessions", { testbenchId: "TB-01" });
  assert(created.ok, `POST /api/sessions → ${created.status}`);
  const { id } = await created.json();
  const ctrl = new AbortController();
  const stream = await fetch(`${base}/api/sessions/${id}/events?since=0`, { signal: ctrl.signal, headers: { Accept: "text/event-stream" } });
  assert(stream.ok, `events stream → ${stream.status}`);
  const sent = await postJson(base, `/api/sessions/${id}/messages`, { text: PROMPT_1 });
  assert(sent.status === 202, `POST messages → ${sent.status}`);
  const reader = stream.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let completed = null;
  const deadline = setTimeout(() => ctrl.abort(), 240_000);
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) throw new Error("event stream ended before the run completed");
      buf += dec.decode(value, { stream: true });
      let at;
      while ((at = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, at);
        buf = buf.slice(at + 2);
        const data = block.split("\n").find((l) => l.startsWith("data:"));
        if (!data || block.includes("event: ping")) continue;
        const e = JSON.parse(data.slice(5));
        if (e.type === "plan.proposed") {
          const r = await postJson(base, `/api/plans/${e.planId}/decision`, { decision: "approve" });
          assert(r.ok, `approve ${e.planId} → ${r.status}`);
          console.log(`    plan ${e.planId}: ${e.items.map((x) => x.testId).join(", ")} → approved`);
        }
        if (e.type === "error") throw new Error(`session error: ${e.message}`);
        if (e.type === "run.completed") completed = e.reportId;
        if (e.type === "turn.done" && completed) return completed;
      }
    }
  } finally {
    clearTimeout(deadline);
    ctrl.abort();
  }
}

let launcher = null;
let serverPid = null;
let port = null;
let sampler = null;
const external = new Set();

async function main() {
  assert(existsSync(zipFile), `${path.relative(ROOT, zipFile)} not found: run \`npm run package\` first`);

  step(`extract ${path.basename(zipFile)} → ${extractDir}`);
  mkdirSync(extractDir, { recursive: true });
  // cwd = the target dir: tar gets only ASCII arguments, the Unicode path goes through CreateProcessW.
  execFileSync(path.join(SYSTEM32, "tar.exe"), ["-x", "-f", zipFile], { cwd: extractDir, stdio: "inherit" });
  const files = walk(BUNDLE);
  const report = JSON.parse(readFileSync(path.join(ROOT, "dist", "package-report.json"), "utf8"));
  assert(files.length === report.files, `extracted ${files.length} files, the package reported ${report.files}`);
  ok(`${files.length} files extracted`);

  step("static checks on the extracted tree");
  const ws = path.join(BUNDLE, "runtime", "wireshark");
  const plugins = walk(path.join(ws, "plugins")).map((f) => f.abs);
  const pe = [...unresolvedImports(ws, plugins).problems, ...unresolvedImports(path.join(BUNDLE, "runtime", "node")).problems];
  assert(pe.length === 0, `unresolved imports:\n${pe.join("\n")}`);
  ok(`every binary in runtime/ resolves its imports in the bundle or Windows (${plugins.length} plugins included)`);

  const bundled = path.join(ws, "tshark.exe");
  const installed = installedTshark();
  const profile = path.join(tmp, "empty-profile");
  mkdirSync(profile);
  const bundledVersion = (await tsharkRun(bundled, ["-v"], profile)).stdout.split(/\r?\n/, 1)[0].trim();
  assert(bundledVersion.startsWith("TShark"), `bundled tshark -v failed: ${bundledVersion}`);
  if (installed && existsSync(installed)) {
    const captures = walk(path.join(BUNDLE, "app", "data")).filter((f) => f.rel.endsWith(".pcapng")).map((f) => f.abs);
    const diffs = await mapLimit(captures, 4, async (cap) => {
      const [a, b] = await Promise.all([tsharkRun(bundled, ["-V", "-r", cap], profile), tsharkRun(installed, ["-V", "-r", cap], profile)]);
      return a.code === 0 && a.stdout === b.stdout && a.stderr === b.stderr && a.stdout.length > 0 ? null : `${path.basename(cap)} (exit ${a.code}, stderr: ${a.stderr.trim().slice(0, 200)})`;
    });
    const bad = diffs.filter(Boolean);
    assert(bad.length === 0, `bundled tshark output differs from ${installed} on:\n${bad.join("\n")}`);
    ok(`bundled tshark -V output is identical to the installed Wireshark on all ${captures.length} demo captures`);
  } else console.log("  (no installed tshark: equivalence check skipped)");

  step("start: Start BenchPilot.bat --no-browser (PATH = System32 only)");
  const bat = path.join(BUNDLE, "Start BenchPilot.bat");
  const log = createWriteStream(launcherLog);
  // cmd /s /c ""<bat>" args": the outer quotes are stripped, the path keeps its spaces.
  launcher = spawn(process.env.ComSpec ?? path.join(SYSTEM32, "cmd.exe"), ["/d", "/s", "/c", `""${bat}" --no-browser"`], {
    cwd: SYSTEM32,
    env: cleanEnv(),
    stdio: ["ignore", "pipe", "pipe"],
    windowsVerbatimArguments: true,
  });
  let output = "";
  for (const s of [launcher.stdout, launcher.stderr])
    s.on("data", (d) => {
      output += d;
      log.write(d);
    });
  const until = Date.now() + 90_000;
  while (!/BenchPilot is running: http:\/\/localhost:(\d+)\//.test(output)) {
    if (launcher.exitCode !== null) throw new Error(`launcher exited (${launcher.exitCode}):\n${output}`);
    if (Date.now() > until) throw new Error(`launcher not ready after 90 s:\n${output}`);
    await new Promise((r) => setTimeout(r, 250));
  }
  port = Number(/BenchPilot is running: http:\/\/localhost:(\d+)\//.exec(output)[1]);
  serverPid = JSON.parse(readFileSync(path.join(BUNDLE, "app", ".data", "server.json"), "utf8")).pid;
  ok(`listening on port ${port} (server pid ${serverPid})`);
  sampler = setInterval(() => {
    for (const p of externalPeers(serverPid)) external.add(p);
  }, 1000);
  const base = `http://127.0.0.1:${port}`;

  step("HTTP checks");
  const health = await getJson(base, "/api/health");
  assert(health.tshark === bundledVersion, `health.tshark = ${health.tshark}, bundled = ${bundledVersion}`);
  ok(`/api/health: ${health.tshark} (the bundled one: no Wireshark on PATH, TSHARK_PATH unset)`);
  const about = await getJson(base, "/api/about");
  assert(about.distribution === "bundle" && about.version === version && about.notices === true, `about: ${JSON.stringify(about)}`);
  const notices = await http(base, "/api/about/notices");
  assert(notices.ok && /GNU GENERAL PUBLIC LICENSE/.test(await notices.text()), "notices not served");
  ok(`/api/about: ${about.version} · ${about.gitSha} · ${about.buildDate} · node ${about.node} · notices served`);

  const index = await http(base, "/");
  const html = await index.text();
  assert(index.ok && html.includes('<div id="root">'), `GET / → ${index.status}`);
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
  assert(assets.length > 0, "index.html references no /assets/*");
  for (const a of assets) assert((await http(base, a)).status === 200, `GET ${a} failed`);
  assert((await http(base, "/sessions")).status === 200, "SPA fallback failed");
  ok(`web root, SPA fallback and ${assets.length} /assets/* → 200`);

  const llm = await getJson(base, "/api/settings/llm");
  assert(llm.active === "replay", `active provider = ${llm.active}`);
  ok("default provider: Demo replay");

  const t = Date.now();
  const reportId = await demo1(base);
  assert(reportId === "RPT-0009", `run completed as ${reportId}`);
  const rpt = await getJson(base, `/api/reports/${reportId}`);
  const verdicts = Object.fromEntries(rpt.runs.map((r) => [r.testId, r.verdict]));
  assert(JSON.stringify(verdicts) === JSON.stringify({ "TC-PERF-003": "fail", "TC-DNS-005": "pass", "TC-END-004": "fail" }), `verdicts ${JSON.stringify(verdicts)}`);
  ok(`demo-1 via the API in ${((Date.now() - t) / 1000).toFixed(0)} s → ${reportId}: PERF fail · DNS pass · END fail`);

  // RPT-0009's checks cite metrics and logs; its DNS run has captures. Frame 1 of the first one, like the drawer.
  const pcapRun = rpt.runs.find((r) => r.artifacts.some((a) => a.type === "pcapng"));
  assert(pcapRun, "RPT-0009 has no capture");
  const pcapRef = `ev:${pcapRun.id}/pcap/${pcapRun.artifacts.find((a) => a.type === "pcapng").name}/1`;
  const ev = await getJson(base, `/api/evidence?ref=${encodeURIComponent(pcapRef)}`);
  const tree = JSON.stringify(ev.detail ?? []);
  assert(ev.kind === "pcap" && ev.rows.length > 0 && /Frame \d+/.test(tree) && /Ethernet II/.test(tree), `evidence for ${pcapRef}: ${tree.slice(0, 200)}`);
  const download = await http(base, ev.downloadUrl);
  assert(download.ok && (await download.arrayBuffer()).byteLength > 0, `GET ${ev.downloadUrl} → ${download.status}`);
  ok(`GET /api/evidence ${pcapRef}: ${ev.rows.length} rows, tshark -V tree of ${ev.detail.length} layers; capture download 200`);

  step("second start while running");
  const second = spawnSync(process.env.ComSpec ?? path.join(SYSTEM32, "cmd.exe"), ["/d", "/s", "/c", `""${bat}" --no-browser"`], {
    cwd: SYSTEM32,
    env: cleanEnv(),
    encoding: "utf8",
    timeout: 30_000,
    windowsVerbatimArguments: true,
  });
  assert(second.status === 0 && second.stdout.includes(`already running from this folder: http://localhost:${port}/`), `second start: ${second.status}\n${second.stdout}${second.stderr}`);
  ok("a second start opens the running instance and exits (exit 0)");

  step("POST /api/admin/reset");
  const reset = await (await postJson(base, "/api/admin/reset")).json();
  assert(reset.ok && reset.nextReport === "RPT-0009", `reset: ${JSON.stringify(reset)}`);
  ok(`reset → ${reset.reports} history reports, next ${reset.nextReport}`);

  step("Playwright e2e/smoke.spec.ts against the bundle (system Edge)");
  const pw = spawnSync(process.execPath, [path.join(ROOT, "node_modules/@playwright/test/cli.js"), "test", "-c", "e2e/playwright.config.ts"], {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, BASE_URL: base, SMOKE_OUTPUT_DIR: path.join(tmp, "playwright") },
  });
  assert(pw.status === 0, `Playwright failed (${pw.status})`);
  ok("UI demo prompts 1–2 + /eval: no request left the origin, no console errors");

  clearInterval(sampler);
  for (const p of externalPeers(serverPid)) external.add(p);
  assert(external.size === 0, `the server connected to non-loopback addresses:\n${[...external].join("\n")}`);
  ok("the server process opened no non-loopback connection (netstat, sampled every second)");
}

async function stopAndVerify() {
  clearInterval(sampler);
  if (!launcher) return [];
  const problems = [];
  // Closing the console window terminates node.exe outright (CTRL_CLOSE_EVENT); the hardest equivalent is a kill.
  if (serverPid) spawnSync(path.join(SYSTEM32, "taskkill.exe"), ["/PID", String(serverPid), "/F"], { stdio: "ignore" });
  const exited = launcher.exitCode !== null ? Promise.resolve() : new Promise((r) => launcher.once("exit", r));
  await Promise.race([exited, new Promise((r) => setTimeout(r, 10_000))]);
  if (launcher.exitCode === null) {
    problems.push("cmd.exe did not exit after node.exe was killed");
    spawnSync(path.join(SYSTEM32, "taskkill.exe"), ["/PID", String(launcher.pid), "/T", "/F"], { stdio: "ignore" });
  }
  await new Promise((r) => setTimeout(r, 500));
  if (port !== null) {
    if ((await answers("127.0.0.1", port)) || !(await canBind(port))) problems.push(`port ${port} still in use after shutdown`);
    else ok(`port ${port} is free after the kill`);
  }
  const left = bundleProcesses();
  if (left.length) {
    problems.push(`processes still running from the bundle: ${left.join(", ")}`);
    for (const l of left) spawnSync(path.join(SYSTEM32, "taskkill.exe"), ["/PID", l.split(" ")[0], "/T", "/F"], { stdio: "ignore" });
  } else ok("no process left running from the bundle");
  return problems;
}

let code = 1;
try {
  await main();
  code = 0;
} catch (err) {
  console.error(`\npackage:smoke: ${err.message}`);
  if (existsSync(launcherLog)) console.error(`\n--- launcher output ---\n${readFileSync(launcherLog, "utf8").slice(-4000)}`);
}
step("stop like a closed console window");
const problems = await stopAndVerify();
if (problems.length) {
  console.error(problems.map((p) => `  ✗ ${p}`).join("\n"));
  code = 1;
}
if (process.env.SMOKE_KEEP === "1" || code !== 0) console.log(`package:smoke: kept ${tmp}`);
else {
  rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
  if (existsSync(tmp)) console.error(`package:smoke: could not delete ${tmp}`);
  else ok("temp dir removed");
}
for (const d of readdirSync(os.tmpdir()).filter((n) => n.startsWith(MARK) && path.join(os.tmpdir(), n) !== tmp)) console.log(`  (older smoke dir left by a failed run: ${d})`);
console.log(code === 0 ? "\npackage:smoke: PASSED" : "\npackage:smoke: FAILED");
process.exit(code);
