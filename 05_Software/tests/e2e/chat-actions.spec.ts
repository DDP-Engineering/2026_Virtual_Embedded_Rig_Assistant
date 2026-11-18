import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron, type Page } from "@playwright/test";
import type { Channel, Request, Response, VeraBridge } from "@vera/shared";
import { expect, test } from "./fixtures.js";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";

const answer =
  "# Știință 🧪\n\n- First\n  - Nested\n\n[[board.txt#L1-L2]]\n\n```powershell\nGet-Content README.MD -TotalCount 10\n```\n\n```text\nMissing type name after '['.\n```\n\n```ts\nconst source = 'λ';\n```\n";
const invoke = <C extends Channel>(page: Page, channel: C, request: Request<C>): Promise<Response<C>> =>
  page.evaluate(
    async ({ channel, request }) =>
      (window as unknown as { vera: VeraBridge }).vera.invoke(channel as never, request as never),
    { channel, request },
  ) as Promise<Response<C>>;

test("chat copy controls are compact, localized and keyboard accessible in four languages", {
  tag: "@parallel-browser",
}, async ({ page, context, rendererUrl }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await context.route("**/mocks/session-fixtures.ts*", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `export const sessionFixtures = ${JSON.stringify([
        {
          title: "Chat actions",
          events: [
            { type: "message.user", messageId: "user", text: "Excluded user text" },
            { type: "message.done", messageId: "first", text: answer, citations: [] },
            { type: "message.done", messageId: "second", text: "Second response only", citations: [] },
          ],
        },
      ])};`,
    }),
  );
  await page.setViewportSize({ width: 1024, height: 640 });
  await page.goto(`${rendererUrl}/?mock=chat`);
  await page.locator('[data-i18n="nav.welcome"]').click();
  await page.locator('[data-action="choose-create"]').click();
  await page.locator('[data-action="create-workbench"]').click();
  const names = {
    en: "Copy response",
    ro: "Copiază răspunsul",
    de: "Antwort kopieren",
    fr: "Copier la réponse",
  };
  for (const language of ["en", "ro", "de", "fr"] as const) {
    await page.locator('[data-i18n="nav.settings"]').click();
    await page.locator('[data-section="appearance"]').click();
    await page.locator("#language").selectOption(language);
    await page.locator('[data-action="leave-settings"]').click();
    await page.locator("[data-session]").filter({ hasText: "Chat actions" }).click();
    const replies = page.locator(".copy-response");
    await expect(replies).toHaveCount(2);
    await expect(replies.first()).toHaveAttribute("aria-label", names[language]);
    await expect(replies.first()).toHaveAttribute("title", names[language]);
    await page.locator("#chat-message").focus();
    await page.mouse.move(0, 0);
    await expect(replies.first()).toHaveCSS("opacity", "0");
    await page.locator('[data-message-kind="assistant"]').first().hover();
    await expect(replies.first()).toHaveCSS("opacity", "1");
    await page.mouse.move(0, 0);
    await page.locator("[data-transcript]").focus();
    for (let step = 0; step < 8; step++) {
      await page.keyboard.press("Tab");
      if (await replies.first().evaluate((button) => button === document.activeElement)) break;
    }
    await expect(replies.first()).toBeFocused();
    await expect(replies.first()).toHaveCSS("opacity", "1");
    await page.keyboard.press("Enter");
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(answer);
    await replies.nth(1).focus();
    await page.keyboard.press("Space");
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("Second response only");
    await expect(page.locator(".chat-code-block")).toHaveCount(3);
    await expect(page.locator("[data-run-block]")).toHaveCount(1);
    await page.locator(".chat-code-block .message-action").first().click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe("Get-Content README.MD -TotalCount 10");
    for (const action of await page.locator(".message-action").all()) {
      const box = await action.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width).toBeGreaterThanOrEqual(24);
      expect(box!.x + box!.width).toBeLessThanOrEqual(1024);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  expect(errors).toEqual([]);
});

test("native chat runs a multiline block exactly once, creates and selects terminals and copies original replies", async () => {
  test.setTimeout(90000);
  const scratch = await mkdtemp(join(tmpdir(), "vera-chat-actions-"));
  const folder = join(scratch, "bench"),
    scripts = join(scratch, "scripts");
  await mkdir(folder);
  await mkdir(scripts);
  const windows = process.platform === "win32";
  const command = windows
    ? "Add-Content -LiteralPath result.txt -Value 'Știință 🧪' -Encoding utf8\nAdd-Content -LiteralPath result.txt -Value 'second line' -Encoding utf8"
    : "printf '%s\\n' 'Știință 🧪' >> result.txt\nprintf '%s\\n' 'second line' >> result.txt";
  const reply = `Run only on click.\n\n\`\`\`${windows ? "powershell" : "bash"}\n${command}\n\`\`\`\n`;
  await writeFile(join(scripts, "commands.jsonl"), JSON.stringify({ text: reply }));
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERA_REPLAY_DIR = scripts;
  const app = await _electron.launch({
    executablePath: resolve("node_modules/electron/dist", windows ? "electron.exe" : "electron"),
    args: [resolve("src/apps/desktop"), `--user-data-dir=${join(scratch, "profile")}`],
    chromiumSandbox: true,
    env,
  });
  try {
    await installNetworkGuard(app);
    const page = await app.firstWindow();
    await invoke(page, "app.settings.update", { language: "en" });
    const workbench = await invoke(page, "workbench.create", { folder, name: "Chat actions" });
    await page.reload();
    await page.locator('[data-action="new-session"]').click();
    const sessionId = await page.locator('[data-session][aria-current="page"]').getAttribute("data-session");
    if (!sessionId) throw Error("No session");
    await invoke(page, "session.model.set", { sessionId, modelRef: "replay/commands" });
    await invoke(page, "session.send", { sessionId, text: "Give commands" });
    await expect(page.locator(".copy-response")).toHaveCount(1);
    await page.locator(".copy-response").focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(reply);
    await expect(page.locator("[data-run-block]")).toBeEnabled();
    expect(await invoke(page, "terminal.list", { workbenchId: workbench.config.id })).toEqual([]);
    await page.locator("[data-run-block]").click();
    await expect(page.locator("#tab-terminal")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".terminal-surface textarea")).toBeFocused();
    await expect
      .poll(async () => {
        try {
          return (await readFile(join(folder, "result.txt"), "utf8"))
            .replace(/^\uFEFF/, "")
            .replaceAll("\r\n", "\n");
        } catch {
          return "";
        }
      })
      .toBe("Știință 🧪\nsecond line\n");
    await invoke(page, "terminal.create", { workbenchId: workbench.config.id, cols: 80, rows: 24 });
    await page.locator(".panel-close").click();
    await page.locator("[data-run-block]").click();
    const choice = page.getByRole("dialog", { name: "Destination terminal" });
    await expect(choice).toBeVisible();
    const rows = await invoke(page, "terminal.list", { workbenchId: workbench.config.id });
    await choice.locator("select").selectOption(rows[1]!.id);
    await choice.getByRole("button", { name: "Run in terminal", exact: true }).click();
    await expect(page.locator(`[data-terminal-id="${rows[1]!.id}"] textarea`)).toBeFocused();
    await expect
      .poll(async () =>
        (await readFile(join(folder, "result.txt"), "utf8")).replace(/^\uFEFF/, "").replaceAll("\r\n", "\n"),
      )
      .toBe("Știință 🧪\nsecond line\nȘtiință 🧪\nsecond line\n");
    expect(await outboundAttempts(app)).toEqual([]);
  } finally {
    await app.close();
    await rm(scratch, { recursive: true, force: true });
  }
});
