import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { _electron, expect, type Page, test } from "@playwright/test";
import type { Channel, Request, Response, VeraBridge } from "@vera/shared";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";

const evidence = resolve("test-outputs/view04");
const invoke = <C extends Channel>(page: Page, channel: C, request: Request<C>): Promise<Response<C>> =>
  page.evaluate(
    async ({ channel, request }) =>
      (window as unknown as { vera: VeraBridge }).vera.invoke(channel as never, request as never),
    { channel, request },
  ) as Promise<Response<C>>;

test("native Hex border Find, partial row, keyboard copy and live Display use original confined bytes", async () => {
  test.setTimeout(120000);
  await mkdir(evidence, { recursive: true });
  const scratch = await mkdtemp(join(evidence, "native-owned-")),
    folder = join(scratch, "bench"),
    profile = join(scratch, "profile");
  await mkdir(folder);
  await mkdir(profile);
  const secret = "view04-stored-password",
    name = `hex-${secret}.bin`,
    size = 16 * 1024 * 1024 + 19;
  const bytes = Buffer.alloc(size, 46);
  bytes.set(Buffer.from(secret), 65534);
  bytes.set([65, 66, 0, 255, 67], 131070);
  bytes.set([0, 127, 65], size - 3);
  await writeFile(join(folder, name), bytes);
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({
    executablePath: resolve(
      "node_modules/electron/dist",
      process.platform === "win32" ? "electron.exe" : "electron",
    ),
    args: [resolve("src/apps/desktop"), `--user-data-dir=${profile}`],
    env,
    chromiumSandbox: true,
  });
  try {
    await installNetworkGuard(app);
    const page = await app.firstWindow(),
      errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await invoke(page, "app.settings.update", { language: "en" });
    const bench = await invoke(page, "workbench.create", {
      folder,
      name: "VIEW04",
      config: { docs: { include: [], exclude: [] } },
    });
    expect(
      (await invoke(page, "mqtt.credentials.save", { ref: "view04", password: secret, storageConsent: true }))
        .status,
    ).toBe("saved");
    const session = await invoke(page, "session.create", { workbenchId: bench.config.id });
    await page.reload();
    await page.locator(`[data-session="${session.id}"]`).click();
    await page.locator('[data-toggle="right"]').click();
    await page.locator("#tab-docs").click();
    const tree = await invoke(page, "docs.tree", { workbenchId: bench.config.id, path: "" }),
      entry = tree.entries.find((entry) => entry.name === name);
    if (!entry) throw Error("Missing binary fixture");
    expect(entry.path).not.toBe(name);
    await page.locator(`[data-tree-path="${entry.path}"]`).click({ button: "right" });
    await page.locator('[data-tree-menu] [data-menu-action="open-hex"]').click();
    const viewer = page.locator("[data-hex-viewer]"),
      rows = viewer.locator("[data-hex-rows]");
    await expect(viewer.locator('[data-hex-byte="0"]')).toHaveText("2E");
    await rows.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    await viewer.locator('[data-hex-byte="65534"]').click();
    await page.keyboard.press("Shift+ArrowRight");
    await page.keyboard.press("Shift+ArrowRight");
    await expect(viewer.locator('[data-hex-byte="65536"]')).toHaveAttribute("aria-pressed", "true");
    await expect(rows).toBeFocused();
    await app.evaluate(({ clipboard }) => clipboard.writeText("window-copy-sentinel"));
    await page.keyboard.press("Control+c");
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe("76 69 65");
    await rows.focus();
    await page.keyboard.press("Control+f");
    await viewer.locator("[data-document-search]").fill("41 42 00 FF 43");
    await page.keyboard.press("Enter");
    await expect(viewer.locator('[data-hex-byte="131070"]')).toHaveAttribute("aria-pressed", "true");
    await expect(viewer.locator('[data-hex-byte="131074"]')).toHaveAttribute("aria-pressed", "true");
    await page.locator('.viewer-toolbar-controls [data-hex-copy="hex"]').click();
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe("41 42 00 FF 43");
    await viewer.locator("[data-document-search]").press("Escape");
    await expect(rows).toBeFocused();
    await page.keyboard.press("Control+g");
    await viewer.locator("[data-hex-offset]").fill("131070");
    await page.keyboard.press("Enter");
    await viewer.locator("[data-hex-offset]").press("Escape");
    await app.evaluate(({ clipboard }) => clipboard.writeText("keyboard-copy-sentinel"));
    for (let i = 0; i < 4; i++) await page.keyboard.press("Shift+ArrowRight");
    await page.keyboard.press("Control+c");
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe("41 42 00 FF 43");
    await page.keyboard.press("Control+g");
    await viewer.locator("[data-hex-offset]").fill(String(size - 1));
    await page.keyboard.press("Enter");
    const final = viewer.locator(`[data-hex-row="${size - 3}"]`);
    await expect(final.locator("[data-hex-ascii]")).toHaveText("..A");
    expect(await final.locator("[data-hex-byte]").allTextContents()).toEqual(["00", "7F", "41"]);
    await viewer.locator("[data-hex-offset]").press("Escape");
    await page.keyboard.press("Control+f");
    await viewer.locator("select").selectOption("text");
    await viewer.locator("[data-document-search]").fill(secret);
    await page.keyboard.press("Enter");
    await expect(viewer.locator('[data-hex-byte="65534"]')).toHaveAttribute("aria-pressed", "true");
    await page.locator('.viewer-toolbar-controls [data-hex-copy="text"]').click();
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(secret);
    await viewer.locator("[data-document-search]").fill("pending scan");
    await page.keyboard.press("Enter");
    await invoke(page, "app.settings.update", { privacy: { mask: { display: true } } });
    await expect(viewer.locator('[data-hex-byte="65534"]')).toHaveText("2A");
    await expect(page.locator('[data-document-tabs] [role="tab"][aria-selected="true"]')).toHaveText(
      "hex-[REDACTED].bin",
    );
    await rows.focus();
    await page.keyboard.press("Control+f");
    await viewer.locator("select").selectOption("text");
    await viewer.locator("[data-document-search]").fill(secret);
    await page.keyboard.press("Enter");
    await expect(viewer.locator(".hex-status")).toHaveText("No matching bytes.", { timeout: 30000 });
    await viewer.locator("[data-document-search]").fill("*".repeat(secret.length));
    await page.keyboard.press("Enter");
    await expect(viewer.locator('[data-hex-byte="65534"]')).toHaveText("2A");
    await page.locator('.viewer-toolbar-controls [data-hex-copy="text"]').click();
    await expect
      .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
      .toBe("*".repeat(secret.length));
    await viewer.locator("[data-document-search]").fill("missing query");
    await page.keyboard.press("Enter");
    await page.locator(".viewer-toolbar-controls [data-hex-cancel]").click();
    await expect(page.locator(".viewer-toolbar-controls [data-hex-cancel]")).toHaveCount(0);
    await viewer.locator("[data-document-search]").press("Escape");
    await expect(rows).toBeFocused();
    for (const [language, label] of [
      ["ro", "Găsește următorul"],
      ["de", "Weitersuchen"],
      ["fr", "Rechercher suivant"],
      ["en", "Find next"],
    ] as const) {
      await invoke(page, "app.settings.update", { language });
      await rows.focus();
      await page.keyboard.press("Control+f");
      await expect(viewer.locator('button[type="submit"]').first()).toHaveText(label);
      await viewer.locator("[data-document-search]").press("Escape");
    }
    const geometry = await rows.evaluate((node) => ({
      height: node.clientHeight,
      scrollHeight: node.scrollHeight,
      rows: node.querySelectorAll("[data-hex-row]").length,
    }));
    expect(geometry.height).toBeGreaterThan(100);
    expect(geometry.rows).toBeLessThanOrEqual(100);
    expect(geometry.scrollHeight).toBeLessThan(120000);
    await page.screenshot({ path: join(evidence, "native-hex.png") });
    await writeFile(
      join(evidence, "native-receipt.json"),
      JSON.stringify(
        {
          platform: process.platform,
          size,
          identity: entry.path,
          border: 131070,
          finalOffset: size - 3,
          geometry,
          done: ["VIEW-04-A", "VIEW-04-B"],
          clipboard: true,
          liveDisplay: true,
          locales: ["en", "ro", "de", "fr"],
        },
        null,
        2,
      ),
    );
    expect(errors).toEqual([]);
    expect(await outboundAttempts(app)).toEqual([]);
  } finally {
    await app.close();
    await rm(scratch, { recursive: true, force: true });
  }
});
