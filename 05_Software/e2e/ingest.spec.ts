import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron, expect, test } from "@playwright/test";
import type { VeraBridge, WorkbenchEvent } from "@vera/shared";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";

const desktop = join(dirname(fileURLToPath(import.meta.url)), "../apps/desktop");
test("native hosts ingest and reindex through confined IPC/events, then close and reopen", async () => {
  const root = await mkdtemp(join(tmpdir(), "vera-ingest-native-"));
  const folder = join(root, "bench");
  await mkdir(folder);
  const env = Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === "string"),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  const executable = join(
    desktop,
    "../../node_modules/electron/dist",
    process.platform === "win32" ? "electron.exe" : "electron",
  );
  const app = await _electron.launch({
    executablePath: executable,
    chromiumSandbox: true,
    args: [desktop, `--user-data-dir=${join(root, "data")}`],
    env,
  });
  const stdout: Buffer[] = [],
    stderr: Buffer[] = [];
  const processHandle = app.process();
  processHandle.stdout?.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
  processHandle.stderr?.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
  const started = new Date().toISOString();
  const loaded = await app.evaluate(() => ({
    execPath: process.execPath,
    electron: process.versions.electron,
    node: process.versions.node,
  }));
  try {
    expect(loaded.execPath).toBe(executable);
    expect(loaded.electron).toBe("44.7.0");
    await installNetworkGuard(app);
    const page = await app.firstWindow();
    await page.waitForFunction(() => !!(window as unknown as Window & { vera?: VeraBridge }).vera);
    await page.evaluate(async (folder) => {
      const host = window as unknown as Window & { vera: VeraBridge; indexEvents: WorkbenchEvent[] };
      const bench = await host.vera.invoke("workbench.create", { folder, name: "Native ingest" });
      host.indexEvents = [];
      host.vera.subscribe("workbench", bench.config.id, (event) => host.indexEvents.push(event));
    }, folder);
    await writeFile(join(folder, "docs/board.md"), "board one");
    const records = () =>
      page.evaluate(() =>
        (window as unknown as Window & { indexEvents: WorkbenchEvent[] }).indexEvents.filter(
          (e) => e.type === "index.document" && e.document,
        ),
      );
    await expect.poll(records).toHaveLength(1);
    const first = (await records())[0];
    expect(first).toMatchObject({ path: "docs/board.md", document: { status: "pending", kind: "markdown" } });
    const firstHash = first?.type === "index.document" ? first.document?.sha256 : null;
    await writeFile(join(folder, "docs/board.md"), "board two");
    await expect.poll(records).toHaveLength(2);
    const second = (await records())[1];
    expect(second?.type === "index.document" ? second.document?.sha256 : null).not.toBe(firstHash);
    await page.evaluate(async () => {
      await (window as unknown as Window & { vera: VeraBridge }).vera.invoke("docs.reindex", {});
    });
    await expect.poll(records).toHaveLength(3);
    await page.evaluate(async () => {
      await (window as unknown as Window & { vera: VeraBridge }).vera.invoke("workbench.close", {});
    });
    await rm(join(folder, "docs/board.md"));
    await page.evaluate(async (folder) => {
      await (window as unknown as Window & { vera: VeraBridge }).vera.invoke("workbench.open", { folder });
    }, folder);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as Window & { indexEvents: WorkbenchEvent[] }).indexEvents.filter(
              (e) => e.type === "index.document" && e.document === null,
            ).length,
        ),
      )
      .toBe(2);
    expect(await outboundAttempts(app)).toEqual([]);
  } finally {
    await app.close();
    if (process.env.VERA_E2E_EVIDENCE_DIR) {
      const evidence = join(process.env.VERA_E2E_EVIDENCE_DIR, "ingest-native");
      await mkdir(evidence, { recursive: true });
      const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
      const main = await readFile(join(desktop, "out/main/index.js"));
      await writeFile(join(evidence, "main.js"), main);
      await writeFile(join(evidence, "stdout.log"), Buffer.concat(stdout));
      await writeFile(join(evidence, "stderr.log"), Buffer.concat(stderr));
      await writeFile(
        join(evidence, "execution.json"),
        JSON.stringify(
          {
            started,
            ended: new Date().toISOString(),
            ...loaded,
            argv: processHandle.spawnargs,
            exitCode: processHandle.exitCode,
            signalCode: processHandle.signalCode,
            mainSha256: hash(main),
            executableSha256: hash(await readFile(executable)),
          },
          null,
          2,
        ),
      );
    }
    await rm(root, { recursive: true, force: true });
  }
});
