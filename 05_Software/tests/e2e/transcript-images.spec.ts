// REQ-UX-9c6aa149 REQ-UX-482d2ced REQ-UX-16e08c34
import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron, type Locator, type Page } from "@playwright/test";
import type { Channel, Request, Response, VeraBridge } from "@vera/shared";
import { expect, test } from "./fixtures.js";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";

const invoke = <C extends Channel>(page: Page, channel: C, request: Request<C>): Promise<Response<C>> =>
  page.evaluate(
    ({ channel, request }) =>
      (window as unknown as { vera: VeraBridge }).vera.invoke(channel as never, request as never),
    { channel, request },
  ) as Promise<Response<C>>;

async function width(image: Locator, expected: number) {
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBe(expected);
}

test("native transcript restores images, opens them and shows the persisted path after deletion (IMG-04-A)", async () => {
  test.setTimeout(120000);
  const root = await mkdtemp(join(tmpdir(), "vera-img04-"));
  const folder = join(root, "bench");
  await mkdir(folder);
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERA_REPLAY_DIR = resolve("tests/fixtures/llm-scripts");
  const launch = () =>
    _electron.launch({
      executablePath: resolve(
        "node_modules/electron/dist",
        process.platform === "win32" ? "electron.exe" : "electron",
      ),
      chromiumSandbox: true,
      args: [resolve("src/apps/desktop"), `--user-data-dir=${join(root, "profile")}`],
      env,
    });
  let app: Awaited<ReturnType<typeof launch>> | undefined;
  try {
    const { default: sharp } = await import("sharp");
    const screenshot = await sharp({ create: { width: 400, height: 200, channels: 3, background: "cyan" } })
      .png()
      .toBuffer();
    const board = await sharp({ create: { width: 64, height: 32, channels: 3, background: "purple" } })
      .jpeg()
      .toBuffer();
    const boardPath = "board-img04-private.jpg";
    const boardReference = "./images//../board-img04-private.jpg";
    await writeFile(join(folder, boardPath), board);
    app = await launch();
    await installNetworkGuard(app);
    let page = await app.firstWindow();
    await invoke(page, "app.settings.update", { language: "en", privacy: { mask: { display: false } } });
    const { config } = await invoke(page, "workbench.create", {
      folder,
      name: "Transcript images",
      config: { agent: { model: "replay/ui-slow" } },
    });
    const { id: sessionId } = await invoke(page, "session.create", { workbenchId: config.id });
    await page.reload();
    await page.locator(`[data-session="${sessionId}"]`).click();
    const input = page.getByRole("textbox", { name: "Message", exact: true });
    await expect(input).toBeEnabled();
    await input.evaluate((target, data) => {
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([Uint8Array.from(atob(data), (value) => value.charCodeAt(0))], "scope.png"),
      );
      target.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }),
      );
    }, screenshot.toString("base64"));
    const chip = page.locator("[data-image-attachment]");
    await expect(chip).toBeVisible();
    const stored = await chip.getAttribute("data-image-attachment");
    if (!stored) throw Error("Expected a persisted clipboard path");
    expect(stored).toMatch(/^\.vera\/attachments\/ses_/);
    await invoke(page, "mqtt.credentials.save", {
      ref: "img04-test-credential",
      password: "img04-private",
      storageConsent: true,
    });
    await invoke(page, "session.send", {
      sessionId,
      text: "Compare these images",
      images: [stored, boardReference],
    });
    const user = () => page.locator('[data-message-kind="user"]').filter({ hasText: "Compare these images" });
    const buttons = () =>
      user()
        .locator("button")
        .filter({ has: page.locator("img") });
    await width(buttons().nth(0).locator("img"), 128);
    await width(buttons().nth(1).locator("img"), 64);
    expect(await outboundAttempts(app)).toEqual([]);

    await app.close();
    app = await launch();
    await installNetworkGuard(app);
    page = await app.firstWindow();
    await page.locator('[data-i18n="nav.welcome"]').click();
    await page.locator("[data-workbench-entry] .workbench-group-name").click();
    await page.locator(`[data-session="${sessionId}"]`).click();
    await width(buttons().nth(0).locator("img"), 128);
    await width(buttons().nth(1).locator("img"), 64);
    const preview = page.locator("[data-image-preview]");
    const chat = page.getByRole("tab", { name: "Chat", exact: true });
    await page.evaluate(() =>
      localStorage.setItem(
        "vera.viewer.modes",
        JSON.stringify({ version: 1, extensions: { ".jpg": "hex" } }),
      ),
    );
    await buttons().nth(0).press("Enter");
    await width(preview, 400);
    await page.keyboard.press("Escape");
    await expect(buttons().nth(0)).toBeFocused();
    await buttons().nth(1).click();
    await width(preview, 64);

    await unlink(join(folder, stored));
    await chat.click();
    await expect(user().getByText(stored, { exact: true })).toBeVisible();
    await expect(buttons()).toHaveCount(1);
    await width(buttons().first().locator("img"), 64);

    await unlink(join(folder, boardPath));
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(user().getByText(boardReference, { exact: true })).toBeVisible();
    await invoke(page, "app.settings.update", { privacy: { mask: { display: true } } });
    await expect(user().getByText("./images//../board-[REDACTED].jpg", { exact: true })).toBeVisible();
    await expect(user()).not.toContainText(boardPath);
    await expect(buttons()).toHaveCount(0);
    expect(await outboundAttempts(app)).toEqual([]);
  } finally {
    await app?.close().catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});
