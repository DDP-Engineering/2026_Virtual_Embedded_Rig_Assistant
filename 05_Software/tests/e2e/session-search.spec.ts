// REQ-FUNC-1b882a4b: WP36 Done scenario authored, execution deferred by user.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron, expect, test } from "@playwright/test";
import type { VeraBridge } from "@vera/shared";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";

const desktop = join(dirname(fileURLToPath(import.meta.url)), "../../src/apps/desktop");
test("finds a renamed session by a word only in a later message", async () => {
  const root = await mkdtemp(join(tmpdir(), "vera-session-search-")),
    folder = join(root, "Board");
  await mkdir(folder);
  await writeFile(join(folder, "board.txt"), "Board uses 3.3 V.\nSecond source line.\n");
  const env = Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === "string"),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERA_REPLAY_DIR = join(desktop, "../../../tests/fixtures/llm-scripts");
  env.VERA_TEST_DIALOG_PATH = folder;
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
    await page.locator('[data-i18n="nav.welcome"]').click();
    await page.locator("#workbench-name").fill("Board");
    await page.locator('[data-i18n="nav.welcome"]').click();
    await page.locator('[data-action="choose-create"]').click();
    await page.locator('[data-action="create-workbench"]').click();
    await page.locator('[data-action="new-session"]').click();
    const id = await page.locator('[data-session][aria-current="page"]').getAttribute("data-session");
    await page.evaluate(async (id) => {
      const api = (window as unknown as { vera: VeraBridge }).vera;
      await api.invoke("session.model.set", { sessionId: id, modelRef: "replay/read-then-answer" });
      for (const text of ["Read the board", "Read again with oscillatorneedle"]) {
        const seq = (await api.invoke("session.get", { sessionId: id })).seq;
        const done = new Promise<void>((resolve) => {
          const off = api.subscribe("session", id, seq, (event) => {
            if (event.type === "turn.done") {
              off();
              resolve();
            }
          });
        });
        await api.invoke("session.send", { sessionId: id, text });
        await done;
      }
      await api.invoke("session.rename", { sessionId: id, title: "Renamed board" });
    }, id as string);
    await expect(page.locator('#sidebar input[type="search"]')).toHaveCount(0);
    const found = await page.evaluate(async () =>
      (window as unknown as { vera: VeraBridge }).vera.invoke("session.search", {
        query: "OSCILLATORNEEDLE",
      }),
    );
    expect(found.some((entry) => entry.id === id && entry.title === "Renamed board")).toBe(true);
    const absent = await page.evaluate(async () =>
      (window as unknown as { vera: VeraBridge }).vera.invoke("session.search", { query: "missingneedle" }),
    );
    expect(absent).toEqual([]);
    await expect(page.locator('[data-message-kind="user"]').last()).toContainText("oscillatorneedle");
    await expect(page.locator(`[data-session="${id}"]`)).toBeVisible();
    expect(await outboundAttempts(app)).toEqual([]);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
