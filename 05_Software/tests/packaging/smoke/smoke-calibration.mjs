// REQ-TEST-f84d343e: isolated instrumented-build renderer probe; never release acceptance.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { exactLoopback } from "./smoke-egress.mjs";
import { fileIdentity } from "./smoke-report.mjs";
import { isolatedEnvironment, launchObserved, seedData, until } from "./smoke-runtime.mjs";

export async function calibrate(executable, appPath, root) {
  assert.equal(process.platform, "linux", "strace renderer calibration requires native Linux");
  await mkdir(root);
  const data = join(root, "data");
  await seedData(data);
  const requests = [];
  const server = createServer((req, res) => {
    requests.push({ url: req.url, method: req.method });
    res.writeHead(200, { "access-control-allow-origin": "*" }).end("renderer calibration");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const permitted = createServer((_req, res) => res.end("allowed calibration endpoint"));
  await new Promise((r) => permitted.listen(0, "127.0.0.1", r));
  const permittedPort = permitted.address().port;
  assert.notEqual(port, permittedPort);
  const report = {
    schema: 1,
    classification: "instrumented-renderer-calibration-only",
    status: "FAIL",
    launches: [],
    forbiddenEndpoint: { family: "AF_INET", address: "127.0.0.1", port },
    allowedEndpoint: exactLoopback(permittedPort),
    requests,
    executable: await fileIdentity(executable),
    main: await fileIdentity(join(appPath, "out/main/index.js")),
  };
  let managed;
  try {
    managed = await launchObserved(
      { executable, data, env: await isolatedEnvironment(root), root, appArgs: [appPath] },
      "calibration",
      report,
      exactLoopback(permittedPort),
      true,
    );
    // A separate fixture window in the test app has an explicit fixture CSP. The
    // production vera://app renderer, its CSP and security policy are untouched.
    report.renderer = await managed.app.evaluate(async ({ BrowserWindow }, endpoint) => {
      const probe = new BrowserWindow({
        show: false,
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false },
      });
      const csp = `default-src 'none'; connect-src ${endpoint}; script-src 'none'; object-src 'none'; base-uri 'none'`;
      await probe.loadURL(
        `data:text/html,${encodeURIComponent(`<meta http-equiv="Content-Security-Policy" content="${csp}"><title>VERA TEST calibration fixture</title>`)}`,
      );
      const result = await probe.webContents.executeJavaScript(
        `fetch(${JSON.stringify(`${endpoint}/deliberate-renderer-request`)}).then(r => r.text())`,
      );
      const identity = {
        pid: probe.webContents.getOSProcessId(),
        preferences: probe.webContents.getLastWebPreferences(),
        result,
      };
      probe.destroy();
      return identity;
    }, `http://127.0.0.1:${port}`);
    await until(async () => requests.length > 0, "renderer HTTP request observed", 10000);
    await managed.finish();
    assert.equal(managed.receipt.egress.status, "FAIL", "Deliberate request not rejected");
    assert(
      managed.receipt.egress.destinations.some((d) => d.address === "127.0.0.1" && d.port === port),
      "Monitor did not see exact renderer destination",
    );
    assert(
      managed.receipt.egress.errors.some((e) =>
        e.startsWith(`Forbidden destination: AF_INET 127.0.0.1:${port} `),
      ),
      "The deliberate endpoint itself must cause rejection",
    );
    assert(requests.some((r) => r.url === "/deliberate-renderer-request"));
    report.expectedOracleResult = "FAIL";
    report.status = "PASS";
  } catch (error) {
    report.error = { message: error.message, stack: error.stack };
  } finally {
    await managed?.finish().catch((e) => {
      report.closeError = String(e);
    });
    await new Promise((r) => server.close(r));
    await new Promise((r) => permitted.close(r));
    await writeFile(join(root, "calibration-report.json"), JSON.stringify(report, null, 2));
  }
  console.log(
    JSON.stringify({
      report: join(root, "calibration-report.json"),
      status: report.status,
      error: report.error?.message,
    }),
  );
  return report.status === "PASS" ? 0 : 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert(process.argv.length === 4, "Usage: smoke-calibration.mjs <built test app dir> <new owned scratch>");
  const app = resolve(process.argv[2]);
  // The caller supplies a test app path; Electron is the pinned development runtime.
  const executable = fileURLToPath(new URL("../../../node_modules/electron/dist/electron", import.meta.url));
  process.exitCode = await calibrate(executable, app, resolve(process.argv[3]));
}
