// REQ-UX-c28dde55 REQ-UX-775eb693 REQ-FUNC-889beffd REQ-FUNC-70dc2e8f REQ-FUNC-2e3fad2d
// REQ-UX-541a5bee REQ-FUNC-98e9d760 REQ-UX-4d1b3324 REQ-UX-ed65cbbc REQ-UX-9f16abf2 REQ-UX-3a3d67c1
// REQ-UX-b5edf930
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron, expect, test } from "@playwright/test";
import type { VeraBridge } from "@vera/shared";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";

const desktop = join(dirname(fileURLToPath(import.meta.url)), "../../src/apps/desktop");
const fixtures = join(desktop, "../../../tests/fixtures/documents");

test("native Docs tree browses the workbench, marks what VERA ignores, opens files and shows properties", async () => {
  test.setTimeout(90000);
  const root = await mkdtemp(join(tmpdir(), "vera-docs-tree-"));
  const folder = join(root, "bench");
  const files: Record<string, string> = {
    "docs/notes/bringup.md": "# Bring-up\n## Power\nThe board uses 3.3 V.\n",
    "firmware/main.c": "int main(void) {\n  return 0;\n}\n",
    ".git/config": "[core]",
    "node_modules/x/y.js": "x",
    "ignored/z.md": "# hidden",
  };
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(folder, path, ".."), { recursive: true });
    await writeFile(join(folder, path), text);
  }
  await copyFile(join(fixtures, "pages.pdf"), join(folder, "docs/a.pdf"));
  const env = Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === "string"),
  );
  delete env.ELECTRON_RUN_AS_NODE;
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
    const { workbenchId, benchFolder } = await page.evaluate(async (folder) => {
      const api = (window as unknown as { vera: VeraBridge }).vera;
      const bench = await api.invoke("workbench.create", {
        folder,
        name: "Tree",
        config: { docs: { include: ["docs/**"], exclude: [] } },
      });
      await api.invoke("workbench.config.update", { patch: {} }).catch(() => {});
      return { workbenchId: bench.config.id, benchFolder: bench.folder };
    }, folder);
    await writeFile(join(folder, ".vera/.veraignore"), "ignored/\n");
    await expect
      .poll(
        () =>
          page.evaluate(async (workbenchId) => {
            const api = (window as unknown as { vera: VeraBridge }).vera;
            return (await api.invoke("docs.list", { workbenchId })).documents
              .map((d) => `${d.path}:${d.status}`)
              .sort();
          }, workbenchId),
        { timeout: 60000 },
      )
      .toEqual(["docs/a.pdf:indexed", "docs/notes/bringup.md:indexed"]);
    await page.reload();
    await page.locator('[data-toggle="right"]').click();
    await page.locator("#tab-docs").click();
    const docs = page.locator("#panel-docs");
    const rows = () =>
      docs
        .locator('[role="treeitem"]')
        .evaluateAll((items) => items.map((item) => item.getAttribute("data-tree-path")));
    // Everything but links is listed; what VERA ignores is marked (TASK-b34f2cc7).
    await expect.poll(rows).toEqual([".git", ".vera", "docs", "firmware", "ignored", "node_modules"]);
    for (const path of [".git", ".vera", "ignored", "node_modules"])
      await expect(docs.locator(`[data-tree-path="${path}"]`)).toHaveAttribute("data-ignored", "true");
    await expect(docs.locator('[data-tree-path="docs"]')).not.toHaveAttribute("data-ignored", "true");
    await docs.locator('[data-tree-path="ignored"]').click();
    await docs.locator('[data-tree-path="ignored/z.md"]').click();
    await expect(page.locator("[data-source-current]")).toContainText("# hidden");
    await page.locator("#tab-docs").click();
    await docs.locator('[data-tree-path="ignored"]').click();
    await expect(docs.locator('[data-tree-path="docs"] [data-folder-count]')).toHaveText("2");
    await docs.locator('[data-tree-path="docs"]').click();
    await expect(docs.locator('[data-tree-path="docs/a.pdf"]')).toHaveAttribute("data-status", "indexed");
    // The row's context menu replaces the Open in default app button; Properties reads the disk.
    expect(await docs.locator('[role="tree"] button').count()).toBe(0);
    await docs.locator('[data-tree-path="docs/a.pdf"]').click({ button: "right" });
    const menu = docs.locator("[data-tree-menu]");
    const rootItems = menu.locator('[role="menuitem"][data-menu-depth="0"]');
    await expect(rootItems).toHaveText([
      "Open",
      "Attach as context",
      "Open in",
      "Show in Explorer",
      "Copy",
      "Properties",
    ]);
    await menu.locator('[data-menu-action="open-in"]').click();
    await expect(menu.locator('[data-menu-action="open-external"]')).toHaveText("Default app");
    await menu.locator('[data-menu-action="properties"]').click();
    const properties = docs.locator("dialog[data-tree-properties]");
    await expect(properties.locator('[data-prop="path"]')).toHaveText("docs/a.pdf");
    await expect(properties.locator('[data-prop="status"]')).toHaveText("Indexed");
    await expect(properties.locator('[data-prop="pages"]')).toHaveText("2");
    await expect(properties.locator('[data-prop="size"]')).toHaveText(/^12[.,]3\s?kB$/i);
    await expect(properties.locator('[data-prop="modified"]')).not.toBeEmpty();
    await page.keyboard.press("Escape");
    await expect(properties).toHaveCount(0);
    await expect(docs.locator('[data-tree-path="docs/a.pdf"]')).toBeFocused();
    await docs.locator('[data-tree-path="docs/a.pdf"]').click();
    const source = page.locator("[data-source-current]");
    await expect(source.locator(".pdf-viewer")).toHaveAttribute("data-ready", "true");
    await page.locator("#tab-docs").click();
    await docs.locator('[data-tree-path="firmware"]').click();
    await expect(docs.locator('[data-tree-path="firmware/main.c"]')).toHaveAttribute("data-indexed", "false");
    await docs.locator('[data-tree-path="firmware/main.c"]').focus();
    await page.keyboard.press("Shift+F10");
    await expect(rootItems.first()).toHaveText("Open");
    await expect(rootItems.last()).toHaveText("Properties");
    await expect(menu.locator('[data-menu-action="open"]')).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(docs.locator('[data-tree-path="firmware/main.c"]')).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(source).toContainText("int main(void) {");
    await page.locator("#tab-docs").click();
    // Copy puts the path on the clipboard through main; the previous clipboard text comes back.
    const saved = await app.evaluate(({ clipboard }) => clipboard.readText());
    try {
      for (const [action, expected] of [
        ["copy-absolute", join(benchFolder, "firmware", "main.c")],
        ["copy-relative", join("firmware", "main.c")],
        ["copy-name", "main.c"],
      ] as const) {
        await docs.locator('[data-tree-path="firmware/main.c"]').click({ button: "right" });
        await menu.locator('[data-menu-action="copy"]').click();
        await menu.locator(`[data-menu-action="${action}"]`).click();
        await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(expected);
      }
      await expect(docs.locator("[data-tree-notice]")).toHaveText("Copied to the clipboard.");
    } finally {
      await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), saved);
    }
    await docs.locator("[data-docs-search]").fill("main");
    await expect.poll(rows).toEqual(["firmware", "firmware/main.c"]);
    // Ignored folders stay outside the filter.
    await docs.locator("[data-docs-search]").fill("z.md");
    await expect.poll(rows).toEqual([]);
    // Attach as context opens a chat (a new session here) with the entry as a chip (TASK-2fef1397).
    await docs.locator("[data-docs-search]").fill("");
    await docs.locator('[data-tree-path="firmware/main.c"]').click({ button: "right" });
    await menu.locator('[data-menu-action="attach"]').click();
    await expect(page.locator('[data-attachment="firmware/main.c"]')).toBeVisible();
    await expect(page.locator('textarea[aria-label="Message"]')).toBeVisible();
    expect(await outboundAttempts(app)).toEqual([]);
  } finally {
    await app.close();
    // Windows may hold the indexed files briefly after the app exits.
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
