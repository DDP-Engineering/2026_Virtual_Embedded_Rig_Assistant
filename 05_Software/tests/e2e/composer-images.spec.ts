import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron, type Locator, type Page } from "@playwright/test";
import type { VeraBridge } from "@vera/shared";
import { expect, test } from "./fixtures.js";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";

const message = (page: Page) => page.getByRole("textbox", { name: "Message", exact: true });
const chips = (page: Page) => page.locator("[data-image-attachment]");
const launcher = resolve("src/apps/desktop");

async function paste(input: Locator, name: string, bytes: Buffer) {
  await input.evaluate(
    (target, { name, data }) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([Uint8Array.from(atob(data), (value) => value.charCodeAt(0))], name));
      target.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }),
      );
    },
    { name, data: bytes.toString("base64") },
  );
}

async function decoded(chip: Locator) {
  await expect(chip).toBeVisible();
  await expect
    .poll(() => chip.locator("img").evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0);
}

test("browser composer bounds the draft, shows removable thumbnails and sends image references", {
  tag: "@parallel-browser",
}, async ({ page, rendererUrl }) => {
  await page.goto(`${rendererUrl}/?mock=chat`);
  await page.locator("[data-workbench-entry] .workbench-group-name").click();
  await page.locator('[data-action="new-session"]').click();
  const input = message(page);
  await expect(input).toBeEnabled();
  await expect(page.getByRole("button", { name: "Attach image", exact: true })).toBeEnabled({
    timeout: 2000,
  });
  const screenshot = await input.screenshot();
  const choosing = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Attach image", exact: true }).click();
  const picker = await choosing;
  await picker.setFiles(
    Array.from({ length: 9 }, (_, id) => ({
      name: `picked-${id}.png`,
      mimeType: "image/png",
      buffer: screenshot,
    })),
  );
  await expect(chips(page)).toHaveCount(8);
  await decoded(chips(page).first());
  await expect(page.getByText(/up to 8 images/i)).toBeVisible();
  await chips(page)
    .first()
    .getByRole("button", { name: /Remove attachment/ })
    .click();
  await expect(chips(page)).toHaveCount(7);
  await paste(input, "pasted.png", screenshot);
  await expect(chips(page)).toHaveCount(8);
  await page.evaluate(async () => {
    const modulePath = "/api/index.ts";
    const { api } = await import(modulePath);
    const sessionId = document
      .querySelector('[data-session][aria-current="page"]')
      ?.getAttribute("data-session");
    await api.invoke("providers.save", {
      provider: "custom",
      config: { name: "Plain text", baseUrl: "http://127.0.0.1:11434/v1", model: "fixture" },
    });
    const original = api.invoke.bind(api);
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    Reflect.set(window, "__releaseImageCapability", release);
    window.dispatchEvent(new Event("offline"));
    api.invoke = async (channel: string, request: unknown) => {
      const result = await original(channel, request);
      if (channel === "session.image.capability" && result.acceptsImages === false) await held;
      return result;
    };
    await api.invoke("session.model.set", { sessionId, modelRef: "custom:plain-text/fixture" });
  });
  const warning = page.getByText(/model only accepts text/i);
  const send = page.getByRole("button", { name: "Send", exact: true });
  await expect(page.getByRole("combobox", { name: "Model", exact: true })).toHaveValue(
    "custom:plain-text/fixture",
  );
  await expect(send).toBeDisabled();
  await page.evaluate(() => Reflect.get(window, "__releaseImageCapability")());
  await expect(warning).toBeVisible();
  await expect(send).toBeEnabled();
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.evaluate(async () => {
    const modulePath = "/api/index.ts";
    const { api } = await import(modulePath);
    const sessionId = document
      .querySelector('[data-session][aria-current="page"]')
      ?.getAttribute("data-session");
    await api.invoke("session.model.set", { sessionId, modelRef: "openai/mock-openai" });
  });
  await expect(warning).toHaveCount(0);
  const paths = await chips(page).evaluateAll((elements) =>
    elements.map((el) => el.getAttribute("data-image-attachment")),
  );
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(chips(page)).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const modulePath = "/api/index.ts";
        const { api } = await import(modulePath);
        const sessionId = document
          .querySelector('[data-session][aria-current="page"]')
          ?.getAttribute("data-session");
        const { snapshot } = await api.invoke("session.get", { sessionId });
        return snapshot.items.findLast((item: { kind: string }) => item.kind === "user")?.images;
      }),
    )
    .toEqual(paths);
});

test("native composer sends pasted and Files images, and refuses spoofed local files", async () => {
  test.setTimeout(90000);
  const root = await mkdtemp(join(tmpdir(), "vera-img03-"));
  const folder = join(root, "bench");
  await mkdir(folder);
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERA_REPLAY_DIR = resolve("tests/fixtures/llm-scripts");
  const app = await _electron.launch({
    executablePath: resolve(
      "node_modules/electron/dist",
      process.platform === "win32" ? "electron.exe" : "electron",
    ),
    chromiumSandbox: true,
    args: [launcher, `--user-data-dir=${join(root, "data")}`],
    env,
  });
  try {
    await installNetworkGuard(app);
    const page = await app.firstWindow();
    await page.waitForFunction(() => !!(window as unknown as { vera?: VeraBridge }).vera);
    const workbenchId = await page.evaluate(async (folder) => {
      const api = (window as unknown as { vera: VeraBridge }).vera;
      const workbench = await api.invoke("workbench.create", {
        folder,
        name: "Images",
        config: { agent: { model: "replay/ui-slow" } },
      });
      return workbench.config.id;
    }, folder);
    const { default: sharp } = await import("sharp");
    const board = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#298042" } })
      .png()
      .toBuffer();
    await writeFile(join(folder, "board.png"), board);
    await page.reload();
    await page.locator('[data-action="new-session"]').click();
    const input = message(page);
    await expect(input).toBeEnabled();
    const sessionId = await page.locator('[data-session][aria-current="page"]').getAttribute("data-session");
    if (!sessionId) throw Error("Missing session");
    const uploadDir = join(folder, ".vera", "attachments", sessionId);
    const screenshot = await input.screenshot();

    await paste(input, "screenshot.png", screenshot);
    await decoded(chips(page).first());
    const stored = await chips(page).first().getAttribute("data-image-attachment");
    expect(stored).toMatch(new RegExp(`^\\.vera/attachments/${sessionId}/`));
    expect(await readFile(join(folder, stored ?? ""))).toEqual(screenshot);
    await expect(page.getByText(/model only accepts text/i)).toBeVisible();

    const picker = page.locator('input[type="file"][accept*="image/png"]');
    await picker.setInputFiles({
      name: "pretend.png",
      mimeType: "image/png",
      buffer: Buffer.from("plain text"),
    });
    await expect(page.locator('[data-i18n="errors.IMAGE_FORMAT"]')).toBeVisible();
    await expect(chips(page)).toHaveCount(1);
    expect(await readdir(uploadDir)).toHaveLength(1);

    const choosing = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Attach image", exact: true }).click();
    await (await choosing).setFiles({ name: "picked.png", mimeType: "image/png", buffer: board });
    await decoded(chips(page).nth(1));
    const picked = await chips(page).nth(1).getAttribute("data-image-attachment");
    expect(picked).toMatch(new RegExp(`^\\.vera/attachments/${sessionId}/`));
    expect(await readFile(join(folder, picked ?? ""))).toEqual(board);
    await chips(page)
      .nth(1)
      .getByRole("button", { name: /Remove attachment/ })
      .click();

    const transfer = await page.evaluateHandle(
      ({ data }) => {
        const transfer = new DataTransfer();
        transfer.items.add(
          new File([Uint8Array.from(atob(data), (value) => value.charCodeAt(0))], "external.png", {
            type: "image/png",
          }),
        );
        return transfer;
      },
      { data: board.toString("base64") },
    );
    await input.dispatchEvent("drop", { dataTransfer: transfer });
    await decoded(chips(page).nth(1));
    const external = await chips(page).nth(1).getAttribute("data-image-attachment");
    expect(await readFile(join(folder, external ?? ""))).toEqual(board);
    await chips(page)
      .nth(1)
      .getByRole("button", { name: /Remove attachment/ })
      .click();

    if (!(await page.locator("#tab-docs").isVisible())) await page.locator('[data-toggle="right"]').click();
    await page.locator("#tab-docs").click();
    const row = page.locator('[data-tree-path="board.png"]');
    await row.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Attach image", exact: true }).click();
    await decoded(chips(page).nth(1));
    await chips(page)
      .nth(1)
      .getByRole("button", { name: /Remove attachment/ })
      .click();
    await row.dragTo(input);
    await decoded(chips(page).nth(1));
    await expect(chips(page).nth(1)).toHaveAttribute("data-image-attachment", "board.png");

    await expect(input).toHaveValue("");
    await page.locator("#right-panel .panel-close").click();
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(chips(page)).toHaveCount(0);
    const images = await page.evaluate(async (sessionId) => {
      const api = (window as unknown as { vera: VeraBridge }).vera;
      const { snapshot } = await api.invoke("session.get", { sessionId });
      return snapshot.items.find((item) => item.kind === "user")?.images;
    }, sessionId);
    expect(images).toEqual([stored, "board.png"]);
    expect(await readFile(join(folder, "board.png"))).toEqual(board);
    await expect(page.locator('[data-message-kind="assistant"]')).toContainText("SLOW START");
    await expect.poll(() => outboundAttempts(app)).toEqual([]);

    const refusals = await page.evaluate(
      async ({ workbenchId, sessionId }) => {
        const api = (window as unknown as { vera: VeraBridge }).vera;
        const request = { workbenchId, sessionId, source: { path: "board.png" } };
        const wrong = await api
          .invoke("session.image.attach", {
            ...request,
            workbenchId: workbenchId.replace(/.$/, workbenchId.endsWith("1") ? "2" : "1"),
          })
          .catch((error) => error.code);
        const archived = await api.invoke("session.create", { workbenchId });
        await api.invoke("session.archive.set", { sessionId: archived.id, archived: true });
        const denied = await api
          .invoke("session.image.attach", {
            ...request,
            sessionId: archived.id,
          })
          .catch((error) => error.code);
        return { wrong, denied };
      },
      { workbenchId, sessionId },
    );
    expect(refusals).toEqual({ wrong: "CONFLICT", denied: "DENIED" });
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  }
});
