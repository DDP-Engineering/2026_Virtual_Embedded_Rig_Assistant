import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { _electron, expect, type Page } from "@playwright/test";
import type { Channel, Request, Response, VeraBridge } from "@vera/shared";
import { test } from "./fixtures.js";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";

const evidence = resolve("test-outputs/view05");
const invoke = <C extends Channel>(page: Page, channel: C, request: Request<C>): Promise<Response<C>> =>
  page.evaluate(
    async ({ channel, request }) =>
      (window as unknown as { vera: VeraBridge }).vera.invoke(channel as never, request as never),
    { channel, request },
  ) as Promise<Response<C>>;
const panel = (page: Page) => page.locator("[data-source-current]");
const choose = async (page: Page, mode: string) => {
  await panel(page).locator(`[data-viewer-mode="${mode}"]`).click();
  await expect(panel(page).locator(`[data-viewer-mode="${mode}"]`)).toHaveAttribute("aria-pressed", "true");
};
async function markdownModes(page: Page) {
  await expect(panel(page).locator("[data-heading]").first()).toBeVisible();
  await choose(page, "text");
  await expect(panel(page).locator("[data-text-encoding]")).toBeVisible();
  await choose(page, "rendered");
  await expect(panel(page).locator("[data-heading]").first()).toBeVisible();
  await choose(page, "hex");
  await expect(panel(page).locator('[data-hex-byte="0"]')).toBeVisible();
}

test("tab search opens in the viewport center and keeps its controls visible", {
  tag: "@parallel-browser",
}, async ({ page, rendererUrl }) => {
  await page.goto(`${rendererUrl}/?mock=chat`);
  await page.locator("[data-workbench-entry] .workbench-group-name").click();
  await page.locator('[data-toggle="right"]').click();
  await page.locator("#tab-docs").click();
  const docs = page.locator('[data-tree-path="docs"]');
  if ((await docs.getAttribute("aria-expanded")) === "false") await docs.click();
  await page.locator('[data-tree-path="docs/a.md"]').click();
  const search = page.getByRole("button", { name: "Search open tabs", exact: true });
  await search.click();
  const dialog = page.getByRole("dialog", { name: "Search open tabs" });
  await expect(dialog.getByRole("searchbox")).toBeFocused();
  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 600, height: 360 },
  ]) {
    await page.setViewportSize(viewport);
    const box = await dialog.boundingBox();
    if (!box) throw new Error("Search dialog is not visible");
    expect(Math.abs(box.x + box.width / 2 - viewport.width / 2)).toBeLessThan(2);
    expect(Math.abs(box.y + box.height / 2 - viewport.height / 2)).toBeLessThan(2);
    expect(box.x).toBeGreaterThan(0);
    expect(box.y).toBeGreaterThan(0);
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeInViewport();
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(search).toBeFocused();
});

test("browser unknown defaults Hex, Markdown switches and remembers its extension on reload", {
  tag: "@parallel-browser",
}, async ({ page, rendererUrl }) => {
  test.setTimeout(90000);
  await mkdir(evidence, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto(`${rendererUrl}/?mock=chat`);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.locator("[data-workbench-entry] .workbench-group-name").click();
    await page.locator('[data-toggle="right"]').click();
    await page.locator("#tab-docs").click();
    await page.locator('[data-tree-path="manuals"]').click();
    await page.locator('[data-tree-path="manuals/scope-capture.png"]').click();
    await expect(panel(page).locator("[data-image-retry]")).toBeVisible();
    await choose(page, "hex");
    await expect(panel(page).locator('[data-hex-byte="0"]')).toHaveText("00");
    await expect(panel(page).locator('[data-viewer-mode="rendered"]')).toHaveCount(1);
    await choose(page, "text");
    await panel(page).locator("[data-show-as-text]").click();
    await expect(panel(page).locator('[data-line="1"]')).toBeVisible();
    await page.locator('[data-tree-path="docs"]').click();
    await page.locator('[data-tree-path="docs/a.md"]').click();
    await markdownModes(page);
    await page.reload();
    await page.locator("[data-workbench-entry] .workbench-group-name").click();
    if (!(await page.locator("#tab-docs").isVisible())) await page.locator('[data-toggle="right"]').click();
    await page.locator("#tab-docs").click();
    const folder = page.locator('[data-tree-path="docs"]');
    if ((await folder.getAttribute("aria-expanded")) === "false") await folder.click();
    await page.locator('[data-tree-path="docs/a.md"]').click();
    await expect(panel(page).locator('[data-viewer-mode="hex"]')).toHaveAttribute("aria-pressed", "true");
    await page.screenshot({ path: join(evidence, "browser-modes.png") });
    await writeFile(
      join(evidence, "browser-receipt.json"),
      JSON.stringify(
        { unknownHex: true, markdownModes: ["rendered", "text", "hex"], reloadRemembered: true, errors },
        null,
        2,
      ),
    );
    expect(errors).toEqual([]);
  } catch (error) {
    if (!page.isClosed()) {
      await page.screenshot({ path: join(evidence, "browser-failure.png"), timeout: 3000 }).catch(() => {});
      await writeFile(
        join(evidence, "browser-failure.txt"),
        await page
          .locator("body")
          .innerText({ timeout: 1000 })
          .catch(() => "Page unavailable"),
      );
    }
    throw error;
  } finally {
  }
});

test("native binary automatic Hex and real extension preference survive full application restart", async () => {
  test.setTimeout(150000);
  await mkdir(evidence, { recursive: true });
  const scratch = await mkdtemp(join(evidence, "native-owned-"));
  const folder = join(scratch, "bench"),
    profile = join(scratch, "profile");
  await mkdir(folder);
  await mkdir(profile);
  const secret = "view05-private-stem";
  await writeFile(join(folder, "binary.bin"), Uint8Array.of(0, 255, 65, 66));
  await writeFile(join(folder, "invalid.unknown"), Uint8Array.of(111, 107, 255));
  await writeFile(join(folder, `${secret}.md`), "# First heading\n\nFirst source text.\n");
  await writeFile(join(folder, "second.md"), "# Second heading\n\nSecond source text.\n");
  await writeFile(join(folder, "ordinary.txt"), "Independent text extension.");
  await mkdir(join(folder, "unindexed"));
  await writeFile(join(folder, "unindexed/source.md"), "# Unindexed source\nReadable without indexing.");
  await writeFile(join(folder, "unindexed/container.pdf"), Uint8Array.of(0, 255, 65));
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  const launch = () =>
    _electron.launch({
      executablePath: resolve(
        "node_modules/electron/dist",
        process.platform === "win32" ? "electron.exe" : "electron",
      ),
      args: [resolve("src/apps/desktop"), `--user-data-dir=${profile}`],
      env,
      chromiumSandbox: true,
    });
  let app = await launch();
  const errors: string[] = [];
  let sessionId = "",
    workbenchId = "",
    identity = "";
  try {
    await installNetworkGuard(app);
    let page = await app.firstWindow();
    page.on("pageerror", (error) => errors.push(error.message));
    await invoke(page, "app.settings.update", { language: "en" });
    const bench = await invoke(page, "workbench.create", {
      folder,
      name: "VIEW05",
      config: { docs: { include: [`${secret}.md`, "second.md"], exclude: [] } },
    });
    workbenchId = bench.config.id;
    await writeFile(join(folder, ".vera/ignored.md"), "# Ignored source\nReadable while ignored.");
    await invoke(page, "docs.reindex", {});
    await expect
      .poll(
        async () =>
          (await invoke(page, "docs.list", { workbenchId })).documents.filter(
            (doc) => doc.kind === "markdown" && doc.status === "indexed",
          ).length,
        { timeout: 45000 },
      )
      .toBe(2);
    const session = await invoke(page, "session.create", { workbenchId });
    sessionId = session.id;
    await invoke(page, "mqtt.credentials.save", { ref: "view05", password: secret, storageConsent: true });
    await invoke(page, "app.settings.update", { privacy: { mask: { display: true } } });
    await page.reload();
    await page.locator(`[data-session="${sessionId}"]`).click();
    await page.locator('[data-toggle="right"]').click();
    await page.locator("#tab-docs").click();
    const tree = await invoke(page, "docs.tree", { workbenchId, path: "" });
    identity = tree.entries.find((entry) => entry.name === "[REDACTED].md")?.path ?? "";
    expect(identity).not.toContain(secret);
    expect(identity).toBeTruthy();
    await page.locator('[data-tree-path="binary.bin"]').click();
    await expect(panel(page).locator('[data-hex-byte="1"]')).toHaveText("FF");
    await page.locator('[data-tree-path="invalid.unknown"]').click();
    await expect(panel(page).locator('[data-viewer-mode="hex"]')).toHaveAttribute("aria-pressed", "true");
    await choose(page, "text");
    await panel(page).locator("[data-show-as-text]").click();
    await expect(panel(page).locator('[data-line="1"]')).toContainText("ok�");
    await page.locator('[data-tree-path="unindexed"]').click();
    await page.locator('[data-tree-path="unindexed/source.md"]').click();
    await expect(panel(page).locator('[data-viewer-mode="text"]')).toHaveAttribute("aria-pressed", "true");
    await expect(panel(page).locator('[data-viewer-mode="rendered"]')).toHaveCount(0);
    await expect(panel(page).locator('[data-line="1"]')).toContainText("# Unindexed source");
    await page.locator(`[data-tree-path="${identity}"]`).click();
    await markdownModes(page);
    await choose(page, "rendered");
    const preferences = await page.evaluate(() => localStorage.getItem("vera.viewer.modes"));
    await page.locator('[data-tree-path=".vera"]').click();
    await page.locator('[data-tree-path=".vera/ignored.md"]').click();
    await expect(panel(page).locator('[data-viewer-mode="text"]')).toHaveAttribute("aria-pressed", "true");
    await expect(panel(page).locator('[data-line="1"]')).toContainText("# Ignored source");
    await expect(panel(page).locator('[role="alert"]')).toHaveCount(0);
    await page.locator('[data-tree-path="unindexed/source.md"]').click();
    await expect(panel(page).locator('[data-viewer-mode="text"]')).toHaveAttribute("aria-pressed", "true");
    await page.locator('[data-tree-path="unindexed/container.pdf"]').click();
    await expect(panel(page).locator('[data-hex-byte="1"]')).toHaveText("FF");
    expect(await page.evaluate(() => localStorage.getItem("vera.viewer.modes"))).toBe(preferences);
    await page.locator(`[data-tree-path="${identity}"]`).click();
    await expect(panel(page).locator('[data-viewer-mode="rendered"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.locator('[data-tree-path=".vera/ignored.md"]').click();
    await choose(page, "text");
    await page.locator(`[data-tree-path="${identity}"]`).click();
    await expect(panel(page).locator('[data-viewer-mode="text"]')).toHaveAttribute("aria-pressed", "true");
    await expect(panel(page).locator("[data-text-encoding]")).toBeVisible();
    await choose(page, "hex");
    await page.locator('[data-tree-path="second.md"]').click();
    await expect(panel(page).locator('[data-viewer-mode="hex"]')).toHaveAttribute("aria-pressed", "true");
    await page.locator('[data-tree-path="ordinary.txt"]').click();
    await expect(panel(page).locator("[data-text-encoding]")).toBeVisible();
    await expect(page.locator("[data-document-tabs]")).not.toContainText(secret);
    expect(await outboundAttempts(app)).toEqual([]);
    await app.close();
    app = await launch();
    await installNetworkGuard(app);
    page = await app.firstWindow();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.locator('[data-i18n="nav.welcome"]').click();
    await page.locator("[data-workbench-entry] .workbench-group-name").click();
    await page.locator(`[data-session="${sessionId}"]`).click();
    await page.locator("#tab-docs").click();
    await page.locator('[data-tree-path="second.md"]').click();
    await expect(panel(page).locator('[data-viewer-mode="hex"]')).toHaveAttribute("aria-pressed", "true");
    await expect(panel(page).locator('[data-hex-byte="0"]')).toHaveText("23");
    await page.locator('[data-tree-path="invalid.unknown"]').click();
    await expect(panel(page).locator('[data-viewer-mode="text"]')).toHaveAttribute("aria-pressed", "true");
    await expect(panel(page).locator("[data-text-encoding]")).toBeVisible();
    await page.locator('[data-tree-path="second.md"]').click();
    for (const [language, rendered, text] of [
      ["ro", "Randat", "Text"],
      ["de", "Gerendert", "Text"],
      ["fr", "Rendu", "Texte"],
      ["en", "Rendered", "Text"],
    ] as const) {
      await invoke(page, "app.settings.update", { language });
      await expect(panel(page).locator('[data-viewer-mode="rendered"]')).toHaveText(rendered);
      await expect(panel(page).locator('[data-viewer-mode="text"]')).toHaveText(text);
      await expect(panel(page).locator('[data-hex-byte="0"]')).toHaveText("23");
    }
    await page.screenshot({ path: join(evidence, "native-restarted-modes.png") });
    expect(await outboundAttempts(app)).toEqual([]);
    expect(errors).toEqual([]);
    await writeFile(
      join(evidence, "native-receipt.json"),
      JSON.stringify(
        {
          platform: process.platform,
          workbenchId,
          sessionId,
          identity,
          binaryHex: true,
          markdownModes: ["rendered", "text", "hex"],
          anotherFileRemembered: true,
          fullRestartRemembered: true,
          opaqueExtension: ".md",
          unknownExtensionRemembered: true,
          unindexedAndIgnoredText: true,
          unavailableRenderedPreferencePreserved: true,
          activeFallbackChoiceRemembered: true,
          errors,
        },
        null,
        2,
      ),
    );
  } finally {
    await app.close();
  }
});
