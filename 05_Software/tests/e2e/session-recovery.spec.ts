import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron, expect, test } from "@playwright/test";
import type { VeraBridge } from "@vera/shared";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";

test("native session recovers missed completion, error and cancellation without navigation", async () => {
  test.setTimeout(90000);
  const root = await mkdtemp(join(tmpdir(), "vera-session-recovery-"));
  const folder = join(root, "board");
  const scripts = join(root, "replay");
  await mkdir(folder);
  await mkdir(scripts);
  await writeFile(join(folder, "board.txt"), "Board uses 3.3 V.\n");
  const read = { toolCalls: [{ name: "read", args: { path: "board.txt" } }] };
  for (const kind of ["end", "error", "aborted"] as const) {
    const steps = [read];
    const text = kind === "aborted" ? "Long running response. ".repeat(80) : "The board uses 3.3 V.";
    await writeFile(
      join(scripts, `${kind}.jsonl`),
      [...steps, ...(kind === "error" ? [] : [{ text }])].map((step) => JSON.stringify(step)).join("\n"),
    );
  }
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  env.VERA_REPLAY_DIR = scripts;
  env.VERA_REPLAY_DELAY_MS = "300";
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
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.evaluate(async (folder) => {
      await (window as unknown as { vera: VeraBridge }).vera.invoke("workbench.create", {
        folder,
        name: "Session recovery",
      });
    }, folder);
    await page.reload();
    let previousId: string | null = null;
    for (const kind of ["end", "error", "aborted"] as const) {
      await page.locator('[data-action="new-session"]').click();
      await expect
        .poll(() => page.locator('[data-session][aria-current="page"]').getAttribute("data-session"))
        .not.toBe(previousId);
      const id = await page.locator('[data-session][aria-current="page"]').getAttribute("data-session");
      if (!id) throw Error("Missing session identity");
      previousId = id;
      await page.evaluate(
        async ({ id, kind }) => {
          await (window as unknown as { vera: VeraBridge }).vera.invoke("session.model.set", {
            sessionId: id,
            modelRef: `replay/${kind}`,
          });
        },
        { id, kind },
      );
      // Disconnect only session notifications after the first tool starts. IPC queries still work.
      await app.evaluate(({ BrowserWindow }, id) => {
        const contents = BrowserWindow.getAllWindows()[0]?.webContents;
        if (!contents) throw Error("Missing renderer");
        const send = contents.send.bind(contents);
        let dropped = false;
        contents.send = (channel, ...args) => {
          const payload = args[0];
          if (channel === "vera:event" && payload?.topic === "session" && payload.id === id) {
            if (dropped) return;
            if (payload.event.type === "tool.started") dropped = true;
          }
          send(channel, ...args);
        };
      }, id);
      const message = page.getByRole("textbox", { name: "Message", exact: true });
      await message.fill("Read the board");
      await message.press("Enter");
      const stop = page.locator('[data-action="stop-session"]');
      await expect(stop).toBeVisible();
      const transcript = page.locator("[data-transcript]");
      await expect(transcript).toContainText("Running");
      await page.screenshot({ path: join(root, `${kind}-running.png`) });
      if (kind === "aborted") await stop.click();
      await expect(stop).toHaveCount(0, { timeout: 10000 });
      await expect(transcript).not.toContainText("Running");
      await expect(page.locator("[data-model-picker]")).toBeEnabled();
      await expect(page.locator('[data-session][aria-current="page"]')).toHaveAttribute("data-session", id);
      const final = await page.evaluate(
        async (id) =>
          (window as unknown as { vera: VeraBridge }).vera.invoke("session.get", { sessionId: id }),
        id,
      );
      expect(final.snapshot.activeTurnId).toBeNull();
      expect(final.snapshot.turns.at(-1)?.stopReason).toBe(kind);
      await page.screenshot({ path: join(root, `${kind}-recovered.png`) });
      await message.fill("Ready for the next request");
      await expect(page.locator('[data-action="send-message"]')).toBeEnabled();
      await message.fill("");
    }
    expect(errors).toEqual([]);
    expect(await outboundAttempts(app)).toEqual([]);
    console.log(`Session recovery screenshots: ${root}`);
  } finally {
    await app.close();
    // Owned scratch only; screenshots are consumed during the visual verification run.
    if (!process.env.VERA_KEEP_RECOVERY_PROOF) await rm(root, { recursive: true, force: true });
  }
});
