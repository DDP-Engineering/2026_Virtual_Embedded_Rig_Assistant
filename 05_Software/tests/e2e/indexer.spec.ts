// REQ-FUNC-f9d5ae8d REQ-REL-6a962d80 REQ-FUNC-276a5da8
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron, expect, test } from "@playwright/test";
import type { SessionEvent, VeraBridge } from "@vera/shared";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";

const desktop = join(dirname(fileURLToPath(import.meta.url)), "../../src/apps/desktop");
const fixtures = join(desktop, "../../../tests/fixtures/documents");

test("native indexing runs in the VERA Indexer process and survives killing it mid-index", async () => {
  test.setTimeout(120000);
  const root = await mkdtemp(join(tmpdir(), "vera-indexer-native-"));
  const folder = join(root, "bench");
  await mkdir(join(folder, "docs"), { recursive: true });
  for (let n = 0; n < 40; n++)
    await copyFile(join(fixtures, "pages.pdf"), join(folder, `docs/board-${n}.pdf`));
  for (let n = 0; n < 6; n++)
    await writeFile(
      join(folder, `docs/note-${n}.md`),
      `# Note ${n}\n## Supply\nThe board ${n} uses 3.3 V.\n`,
    );
  const env = Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === "string"),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERA_REPLAY_DIR = resolve("tests/fixtures/llm-scripts");
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
  try {
    await installNetworkGuard(app);
    const page = await app.firstWindow();
    await page.waitForFunction(() => !!(window as unknown as { vera?: VeraBridge }).vera);
    const workbenchId = await page.evaluate(async (folder) => {
      const api = (window as unknown as { vera: VeraBridge }).vera;
      return (await api.invoke("workbench.create", { folder, name: "Indexer" })).config.id;
    }, folder);
    const indexerPid = () =>
      app.evaluate(() =>
        (globalThis as { veraTestIndexerPid?: () => number | undefined }).veraTestIndexerPid?.(),
      );
    const statuses = () =>
      page.evaluate(async (workbenchId) => {
        const api = (window as unknown as { vera: VeraBridge }).vera;
        const { documents } = await api.invoke("docs.list", { workbenchId });
        return documents.map((d) => d.status).sort();
      }, workbenchId);
    // Kill only once documents are really in flight: some indexed, others still pending.
    await expect
      .poll(
        async () => {
          const now = await statuses();
          return now.includes("indexed") && now.includes("pending");
        },
        { timeout: 30000, intervals: [50] },
      )
      .toBe(true);
    const first = (await indexerPid()) as number;
    // The work runs in its own process, not in main.
    expect(first).toBeGreaterThan(0);
    expect(first).not.toBe(await app.evaluate(() => process.pid));
    process.kill(first);
    // VERA stays up, a new indexer takes over, and every document ends up indexed.
    await expect.poll(indexerPid, { timeout: 20000 }).not.toBe(first);
    await expect
      .poll(statuses, { timeout: 90000, intervals: [500] })
      .toEqual(Array.from({ length: 46 }, () => "indexed"));
    expect(
      await page.evaluate(
        async () =>
          (await (window as unknown as { vera: VeraBridge }).vera.invoke("indexer.status", {})).state,
      ),
    ).toBe("running");
    // The agent's semantic search_docs ranks through the restarted indexer.
    const search = await page.evaluate(async () => {
      const api = (window as unknown as { vera: VeraBridge }).vera;
      const session = await api.invoke("session.create", { modelRef: "replay/indexer-semantic" });
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
      await api.invoke("session.send", { sessionId: session.id, text: "Find the semantic supply" });
      await done;
      return events.filter((event) => event.type === "tool.done");
    });
    expect(search).toHaveLength(1);
    expect(search[0]).toMatchObject({ ok: true });
    expect(JSON.stringify(search[0])).toContain("docs/note-");
    // Ranked by the indexer, not the keyword fallback for a stopped or restarting indexer.
    expect(JSON.stringify(search[0])).not.toContain("Semantic ranking is unavailable");
    // The network guard patches the main process only; the indexer runs no network code.
    expect(await outboundAttempts(app)).toEqual([]);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
