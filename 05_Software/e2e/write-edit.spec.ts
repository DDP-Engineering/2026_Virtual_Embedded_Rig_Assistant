import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron, expect, test } from "@playwright/test";
import type { SessionEvent, VeraBridge } from "@vera/shared";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";

test("native read/edit records a change through sandboxed IPC and retains it after restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "vera-wp16-native-"));
  const folder = join(root, "Board ă");
  await mkdir(folder);
  await writeFile(join(folder, "board.txt"), "\ufeffBoard uses 3.3 V.\r\nSecond line.\r\n");
  const desktop = join(dirname(fileURLToPath(import.meta.url)), "../apps/desktop");
  const launch = async () => {
    const env = Object.fromEntries(
      Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === "string"),
    );
    delete env.ELECTRON_RUN_AS_NODE;
    env.VERA_REPLAY_DIR = join(desktop, "../../fixtures/llm-scripts");
    env.VERA_TEST_ALLOW_WRITES = "1";
    const app = await _electron.launch({
      executablePath: join(
        desktop,
        "../../node_modules/electron/dist",
        process.platform === "win32" ? "electron.exe" : "electron",
      ),
      chromiumSandbox: true,
      args: [desktop, `--user-data-dir=${join(root, "data")}`],
      env,
    });
    await installNetworkGuard(app);
    await app.firstWindow();
    const loaded = await app.evaluate(({ app, BrowserWindow }) => ({
      entry: app.getAppPath(),
      preload: (
        BrowserWindow.getAllWindows()[0]?.webContents as unknown as {
          // Pinned Electron's own preload routing uses this runtime accessor:
          // https://github.com/electron/electron/blob/main/lib/browser/rpc-server.ts
          _getPreloadScript(): { filePath: string } | null;
        }
      )?._getPreloadScript()?.filePath,
      argv: process.argv,
      cwd: process.cwd(),
    }));
    if (process.env.VERA_E2E_EVIDENCE_DIR) {
      const target = join(process.env.VERA_E2E_EVIDENCE_DIR, `wp16-${randomUUID()}`);
      await mkdir(target, { recursive: true });
      const packageData = JSON.parse(await readFile(join(loaded.entry, "package.json"), "utf8")) as {
        main: string;
      };
      const main = join(loaded.entry, packageData.main);
      const files = { main, preload: loaded.preload ?? "" };
      const hashes: Record<string, string> = {};
      for (const [name, path] of Object.entries(files)) {
        const bytes = await readFile(path);
        hashes[name] = createHash("sha256").update(bytes).digest("hex");
        await writeFile(join(target, `${name}.js`), bytes, { flag: "wx" });
      }
      await writeFile(
        join(target, "execution.json"),
        JSON.stringify(
          {
            ...loaded,
            files,
            hashes,
            UTC: new Date().toISOString(),
            platform: process.platform,
            actualMainPackageEntrypoint: true,
            actualWebContentsPreload: true,
            preloadPathMethod: "webContents._getPreloadScript().filePath",
          },
          null,
          2,
        ),
        { flag: "wx" },
      );
    }
    return app;
  };
  let app = await launch();
  try {
    let page = await app.firstWindow();
    const result = await page.evaluate(async (folder) => {
      const api = (window as unknown as { vera: VeraBridge }).vera;
      await api.invoke("workbench.create", { folder, name: "Board" });
      const session = await api.invoke("session.create", {
        modelRef: "replay/read-then-edit",
        mode: "auto-edit",
      });
      const events: SessionEvent[] = [];
      const done = new Promise<void>((resolve) => {
        const off = api.subscribe("session", session.id, 0, (event) => {
          events.push(event);
          if (event.type === "turn.done") {
            off();
            resolve();
          }
        });
      });
      await api.invoke("session.send", { sessionId: session.id, text: "Edit the board" });
      await done;
      return { session, events, snapshot: await api.invoke("session.get", { sessionId: session.id }) };
    }, folder);
    expect(result.events.filter((e) => e.type === "tool.done")).toHaveLength(2);
    expect(result.events.filter((e) => e.type === "tool.done").every((e) => e.ok)).toBe(true);
    expect(result.events.find((e) => e.type === "change.recorded")).toMatchObject({
      path: "board.txt",
      added: 1,
      removed: 1,
    });
    expect(result.snapshot.snapshot.changes).toHaveLength(1);
    expect(await readFile(join(folder, "board.txt"))).toEqual(
      Buffer.from("\ufeffBoard uses 5 V.\r\nSecond line.\r\n"),
    );
    expect(await outboundAttempts(app)).toEqual([]);
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    const resumed = await page.evaluate(
      async ({ folder, id }) => {
        const api = (window as unknown as { vera: VeraBridge }).vera;
        await api.invoke("workbench.open", { folder });
        return api.invoke("session.get", { sessionId: id });
      },
      { folder, id: result.session.id },
    );
    expect(resumed).toEqual(result.snapshot);
    expect(await outboundAttempts(app)).toEqual([]);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
