import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron, expect } from "@playwright/test";
import { test } from "./fixtures.js";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";

interface Snapshot {
  activeTurnId: string | null;
  items: { kind: string; text?: string }[];
}

// REQ-FUNC-db6bacf7, REQ-FUNC-4747d310, REQ-FUNC-0dfa01fd, REQ-FUNC-0278c7ba, REQ-REL-b10ee7aa
test("a replay turn in workbench A completes in A after B opens, while B runs its own turn", async () => {
  test.setTimeout(120000);
  const root = await mkdtemp(join(tmpdir(), "vera-runtimes-"));
  const a = join(root, "a");
  const b = join(root, "b");
  const plain = join(root, "plain");
  for (const folder of [a, b, plain]) {
    await mkdir(folder);
    await writeFile(join(folder, "board.txt"), "Board uses 3.3 V.\nSecond source line.\n");
  }
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERA_REPLAY_DIR = resolve("tests/fixtures/llm-scripts");
  // Every streamed chunk waits: A's long answer (about 32 chunks) outlasts B's whole turn (5 chunks).
  env.VERA_REPLAY_DELAY_MS = "250";
  const app = await _electron.launch({
    executablePath: resolve(
      "node_modules/electron/dist",
      process.platform === "win32" ? "electron.exe" : "electron",
    ),
    args: [resolve("src/apps/desktop"), `--user-data-dir=${join(root, "profile")}`],
    env,
  });
  try {
    await installNetworkGuard(app);
    const page = await app.firstWindow();
    await page.waitForFunction(() => !!(window as unknown as { vera?: unknown }).vera);
    /** The IPC result, or the error object it rejected with. */
    const attempt = (channel: string, payload: unknown) =>
      page.evaluate(
        async ([channel, payload]) => {
          const bridge = window as unknown as {
            vera: { invoke(channel: string, payload: unknown): Promise<unknown> };
          };
          try {
            return { value: await bridge.vera.invoke(channel, payload) };
          } catch (error) {
            return { error };
          }
        },
        [channel, payload] as const,
      );
    const call = async <T>(channel: string, payload: unknown) => {
      const result = await attempt(channel, payload);
      if ("error" in result) throw new Error(`${channel} failed: ${JSON.stringify(result.error)}`);
      return result.value as T;
    };
    const snapshot = async (sessionId: string) =>
      (await call<{ snapshot: Snapshot }>("session.get", { sessionId })).snapshot;
    const answer = (state: Snapshot) => state.items.findLast((item) => item.kind === "assistant")?.text ?? "";
    const startTurn = async (modelRef: string, text: string) => {
      const { id } = await call<{ id: string }>("session.create", { modelRef });
      await call("session.send", { sessionId: id, text });
      return id;
    };
    const lock = (folder: string) => existsSync(join(folder, ".vera/lock"));
    // B exists first; creating A releases idle B and leaves A in the foreground.
    await call("workbench.create", { folder: b, name: "B" });
    const workbenchA = await call<{ config: { id: string } }>("workbench.create", { folder: a, name: "A" });
    expect(lock(b)).toBe(false);
    // A failed open and a reopen in place leave A, its terminal included, as it was.
    await call("terminal.create", { workbenchId: workbenchA.config.id, cols: 80, rows: 24 });
    expect(await attempt("workbench.open", { folder: plain })).toMatchObject({
      error: { code: "NOT_FOUND" },
    });
    expect(await call<unknown[]>("terminal.list", { workbenchId: workbenchA.config.id })).toHaveLength(1);
    await call("workbench.open", { folder: a });
    expect(await call<unknown[]>("terminal.list", { workbenchId: workbenchA.config.id })).toHaveLength(1);
    const sessionA = await startTurn("replay/ui-slow", "Slow answer");
    expect((await snapshot(sessionA)).activeTurnId).not.toBeNull();
    const workbenchB = await call<{ config: { id: string } }>("workbench.open", { folder: b });
    expect(await call<unknown[]>("terminal.list", { workbenchId: workbenchB.config.id })).toEqual([]);
    // A's turn keeps A open in the background while B runs a whole turn of its own.
    expect(lock(a)).toBe(true);
    const sessionB = await startTurn("replay/read-then-answer", "Read the board");
    await expect.poll(async () => (await snapshot(sessionB)).activeTurnId, { timeout: 60000 }).toBeNull();
    expect(answer(await snapshot(sessionB))).toContain("3.3 V");
    expect(lock(a)).toBe(true);
    // A completes in A, which is then released.
    await expect.poll(() => lock(a), { timeout: 60000 }).toBe(false);
    await call("workbench.open", { folder: a });
    const finished = await snapshot(sessionA);
    expect(finished.activeTurnId).toBeNull();
    expect(answer(finished)).toContain("SLOW END");
    expect(lock(b)).toBe(false);
    // A's terminal closed when B took the foreground.
    expect(await call<unknown[]>("terminal.list", { workbenchId: workbenchA.config.id })).toEqual([]);
    // A clone of A's folder carries the same workbench ID; it is another workbench, so A's terminals close.
    await call("terminal.create", { workbenchId: workbenchA.config.id, cols: 80, rows: 24 });
    const clone = join(root, "clone");
    await mkdir(join(clone, ".vera"), { recursive: true });
    await copyFile(join(a, ".vera/workbench.yaml"), join(clone, ".vera/workbench.yaml"));
    const cloned = await call<{ config: { id: string } }>("workbench.open", { folder: clone });
    expect(cloned.config.id).toBe(workbenchA.config.id);
    expect(await call<unknown[]>("terminal.list", { workbenchId: workbenchA.config.id })).toEqual([]);
    expect(await outboundAttempts(app)).toEqual([]);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  }
});
