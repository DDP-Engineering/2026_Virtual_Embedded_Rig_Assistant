// `npm run smoke` (06 P5 step 4): Playwright smoke of the 07 demo in replay mode.
// 1. fresh web build (a stale apps/web/dist looks like a working UI), 2. seed an ISOLATED runtime dir (your .data/,
// settings and credentials are never touched), 3. start ONE server process (node + tsx directly, no npm wrapper, so
// nothing is orphaned on Windows), 4. run e2e/ with Playwright, 5. kill the process tree, check the port is free,
// delete the temp dir. Env: SMOKE_SKIP_BUILD=1 reuses dist; SMOKE_BROWSER=chromium uses Playwright's own Chromium
// instead of the system Microsoft Edge; SMOKE_KEEP=1 keeps the temp dir (server log, traces) for debugging.
import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const NODE = process.execPath;
const tmp = mkdtempSync(path.join(os.tmpdir(), "bp-smoke-"));
const runtimeDir = path.join(tmp, "runtime");
const serverLog = path.join(tmp, "server.log");
let server = null;

const step = (s) => console.log(`\n▸ smoke: ${s}`);

function run(args, opts = {}) {
  const r = spawnSync(NODE, args, { cwd: ROOT, stdio: "inherit", ...opts, env: { ...process.env, ...opts.env } });
  if (r.status !== 0) throw new Error(`${path.basename(args.find((a) => a.endsWith(".js") || a.endsWith(".ts")) ?? args[0])} exited with ${r.status ?? r.signal}`);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer().once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

const portFree = (port) =>
  new Promise((resolve) => {
    const srv = net.createServer().once("error", () => resolve(false));
    srv.listen(port, "127.0.0.1", () => srv.close(() => resolve(true)));
  });

async function waitHealthy(url, ms = 60_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (server?.exitCode !== null) throw new Error(`server exited early (code ${server?.exitCode})`);
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) return res.json();
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`server not healthy after ${ms / 1000} s`);
}

function stopServer() {
  if (!server || server.exitCode !== null) return Promise.resolve();
  const exited = new Promise((r) => server.once("exit", r));
  // /T kills the whole tree on Windows (no orphaned children, P0); elsewhere the single process is enough.
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
  else server.kill("SIGTERM");
  return Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
}

async function main() {
  if (process.env.SMOKE_SKIP_BUILD === "1" && existsSync(path.join(ROOT, "apps/web/dist/index.html"))) step("reusing apps/web/dist (SMOKE_SKIP_BUILD=1)");
  else {
    step("building the web app");
    run([path.join(ROOT, "node_modules/vite/bin/vite.js"), "build"], { cwd: path.join(ROOT, "apps/web") });
  }

  step(`seeding an isolated runtime dir ${runtimeDir}`);
  run(["--import", "tsx", "apps/server/src/cli/seed.ts"], { env: { RUNTIME_DIR: runtimeDir } });

  const port = await freePort();
  const baseURL = `http://127.0.0.1:${port}`;
  step(`starting the server on ${baseURL} (log: ${serverLog})`);
  const log = createWriteStream(serverLog);
  server = spawn(NODE, ["--import", "tsx", "apps/server/src/index.ts", "--prod"], {
    cwd: ROOT,
    // Real env beats .env (config.ts), so these win over the developer's settings.
    env: { ...process.env, PORT: String(port), RUNTIME_DIR: runtimeDir, DEMO_SPEED: process.env.SMOKE_DEMO_SPEED ?? "10", RECORD_REPLAY: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.pipe(log);
  server.stderr.pipe(log);
  const health = await waitHealthy(baseURL);
  console.log(`  health: tshark ${health.tshark ?? "not found"}`);

  step("running Playwright (e2e/)");
  const pw = spawnSync(NODE, [path.join(ROOT, "node_modules/@playwright/test/cli.js"), "test", "-c", "e2e/playwright.config.ts"], {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, BASE_URL: baseURL, SMOKE_OUTPUT_DIR: path.join(tmp, "playwright") },
  });
  return { status: pw.status ?? 1, port };
}

let code = 1;
let port = null;
const cleanup = async () => {
  await stopServer();
  if (port && !(await portFree(port))) console.error(`smoke: port ${port} is still in use after shutdown`);
  if (code !== 0 && existsSync(serverLog)) console.error(`\n--- server log (last 40 lines) ---\n${readFileSync(serverLog, "utf8").split("\n").slice(-40).join("\n")}`);
  if (process.env.SMOKE_KEEP === "1" || code !== 0) console.log(`smoke: kept ${tmp}`);
  else rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
};
process.once("SIGINT", () => void cleanup().then(() => process.exit(130)));

try {
  const r = await main();
  code = r.status;
  port = r.port;
} catch (err) {
  console.error(`smoke: ${err.message}`);
  code = 1;
} finally {
  await cleanup();
}
console.log(code === 0 ? "\nsmoke: PASSED" : "\nsmoke: FAILED");
process.exit(code);
