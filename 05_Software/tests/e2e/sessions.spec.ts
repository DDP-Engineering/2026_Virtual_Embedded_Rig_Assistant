import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron, expect, test } from "@playwright/test";
import type { SessionEvent, VeraBridge } from "@vera/shared";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";

const desktop = join(dirname(fileURLToPath(import.meta.url)), "../../src/apps/desktop");
test("session IPC streams a grounded read turn, replays sinceSeq and resumes after native restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "vera-wp13-native-")),
    folder = join(root, "Board ă");
  await mkdir(folder);
  await writeFile(join(folder, "board.txt"), "Board uses 3.3 V.\nSecond source line.\n");
  const launch = async () => {
    const env: Record<string, string> = Object.fromEntries(
      Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === "string"),
    );
    delete env.ELECTRON_RUN_AS_NODE;
    env.VERA_REPLAY_DIR = join(desktop, "../../../tests/fixtures/llm-scripts");
    const app = await _electron.launch({
      executablePath: join(
        desktop,
        "../../../node_modules/electron/dist",
        process.platform === "win32" ? "electron.exe" : "electron",
      ),
      chromiumSandbox: true,
      args: [desktop, `--user-data-dir=${join(root, "data")}`],
      env,
    });
    await installNetworkGuard(app);
    return app;
  };
  let app = await launch();
  try {
    let page = await app.firstWindow();
    const result = await page.evaluate(async (folder) => {
      const api = (window as unknown as { vera: VeraBridge }).vera;
      await api.invoke("workbench.create", { folder, name: "Board" });
      const session = await api.invoke("session.create", { modelRef: "replay/read-then-answer" });
      const events: SessionEvent[] = [];
      const done = new Promise<void>((resolve) => {
        const off = api.subscribe("session", session.id, 0, (e) => {
          events.push(e);
          if (e.type === "turn.done") {
            off();
            resolve();
          }
        });
      });
      await api.invoke("session.send", { sessionId: session.id, text: "Read the board" });
      await done;
      const snapshot = await api.invoke("session.get", { sessionId: session.id });
      return { session, snapshot, events };
    }, folder);
    expect(result.events.filter((e) => e.type === "tool.done")).toHaveLength(2);
    expect(result.events.some((e) => e.type === "message.delta")).toBe(true);
    expect(result.events.filter((e) => e.type === "message.done").at(-1)).toMatchObject({
      citations: [{ ref: "board.txt#L1-L2", valid: true }],
    });
    expect(result.snapshot.snapshot.status).toBe("idle");
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
    const later = await page.evaluate(
      async ({ id, seq }) => {
        const api = (window as unknown as { vera: VeraBridge }).vera;
        const events: SessionEvent[] = [];
        const done = new Promise<void>((resolve) => {
          const off = api.subscribe("session", id, seq, (e) => {
            events.push(e);
            if (e.type === "turn.done") {
              off();
              resolve();
            }
          });
        });
        await api.invoke("session.send", { sessionId: id, text: "Read again" });
        await done;
        return { events, snapshot: await api.invoke("session.get", { sessionId: id }) };
      },
      { id: result.session.id, seq: result.snapshot.seq },
    );
    expect(later.events.filter((e) => e.type === "message.user")).toHaveLength(1);
    expect(later.snapshot.snapshot.items.filter((i) => i.kind === "user")).toHaveLength(2);
    expect(await outboundAttempts(app)).toEqual([]);
    await page.evaluate(async (id) => {
      const api = (window as unknown as { vera: VeraBridge }).vera;
      await api.invoke("session.rename", { sessionId: id, title: "Renamed" });
      await api.invoke("session.mode.set", { sessionId: id, mode: "read-only" });
      await api.invoke("session.model.set", { sessionId: id, modelRef: null });
      await api.invoke("session.delete", { sessionId: id });
    }, result.session.id);
    expect(
      await page.evaluate(() => (window as unknown as { vera: VeraBridge }).vera.invoke("session.list", {})),
    ).toEqual([]);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
