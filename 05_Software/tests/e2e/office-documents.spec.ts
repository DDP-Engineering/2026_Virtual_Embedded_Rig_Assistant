// REQ-UX-64738341 REQ-FUNC-56b34eec REQ-FUNC-bc730650 REQ-FUNC-58cba7fd REQ-UX-9be5fd96 REQ-FUNC-845e3114
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron, expect, test } from "@playwright/test";
import type { VeraBridge } from "@vera/shared";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";

const desktop = join(dirname(fileURLToPath(import.meta.url)), "../../src/apps/desktop");
const fixtures = join(desktop, "../../../tests/fixtures/documents/office");

test("native office documents index in the document worker and open cited slides and headings", async () => {
  test.setTimeout(90000);
  const root = await mkdtemp(join(tmpdir(), "vera-office-native-"));
  const folder = join(root, "bench");
  await mkdir(join(folder, "docs"), { recursive: true });
  const env = Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === "string"),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERA_TEST_DIALOG_PATH = folder;
  env.VERA_REPLAY_DIR = join(desktop, "../../../tests/fixtures/llm-scripts");
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
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.locator('[data-i18n="nav.welcome"]').click();
    await page.locator('[data-action="choose-create"]').click();
    await page.locator('[data-action="create-workbench"]').click();
    await page.locator('[data-action="new-session"]').click();
    for (const name of ["bringup.pptx", "review.docx", "timing.ods", "plain.docx"])
      await writeFile(join(folder, "docs", name), await readFile(join(fixtures, name)));
    await page.evaluate(async () => {
      await (window as unknown as { vera: VeraBridge }).vera.invoke("docs.reindex", {});
    });
    // Office files are parsed by the bundled document worker, not in the main process.
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const vera = (window as unknown as { vera: VeraBridge }).vera;
            const { config } = await vera.invoke("workbench.config.get", {});
            const { documents } = await vera.invoke("docs.list", { workbenchId: config.id });
            return documents.map((d) => `${d.path}:${d.kind}:${d.status}:${d.pages ?? "-"}`).sort();
          }),
        { timeout: 30000 },
      )
      .toEqual([
        "docs/bringup.pptx:presentation:indexed:2",
        "docs/plain.docx:document:indexed:-",
        "docs/review.docx:document:indexed:-",
        "docs/timing.ods:spreadsheet:indexed:-",
      ]);
    const id = await page.locator('[data-session][aria-current="page"]').getAttribute("data-session");
    await page.evaluate(async (id) => {
      await (window as unknown as { vera: VeraBridge }).vera.invoke("session.model.set", {
        sessionId: id!,
        modelRef: "replay/office-citations",
      });
    }, id);
    const message = page.getByRole("textbox", { name: "Message", exact: true });
    await message.fill("Office sources");
    await message.press("Enter");
    await expect(page.locator('[data-citation="valid"]')).toHaveCount(3);
    await expect(page.locator('[data-citation="invalid"]')).toHaveCount(2);
    await expect(page.locator('[data-citation="valid"]').nth(0)).toHaveAttribute(
      "data-citation-kind",
      "page",
    );
    await expect(page.locator('[data-citation="valid"]').nth(1)).toHaveAttribute(
      "data-citation-kind",
      "heading",
    );
    const dialog = page.locator("[data-source-current]");
    await page.locator('[data-citation="valid"]').nth(0).click();
    await expect(dialog.locator("[data-slide]")).toHaveCount(2);
    await expect(dialog.locator('[data-slide="2"]')).toHaveAttribute("aria-current", "true");
    await expect(dialog.locator('[data-slide="2"]')).toBeFocused();
    await expect(dialog.locator('[data-slide="2"]')).toContainText("3.29 V");
    await expect(dialog).not.toContainText("SPEAKER NOTE");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await page.locator('[data-citation="valid"]').nth(1).click();
    await expect(dialog.locator('[data-heading="reset"]')).toHaveAttribute("aria-current", "true");
    await expect(dialog.locator('[data-heading="reset"]')).toContainText("100 nF");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    // A headingless Word file is cited as its untitled leading section.
    const lead = page.locator('[data-citation="valid"]').nth(2);
    await expect(lead).toHaveAttribute("data-citation-kind", "heading");
    await expect(lead).toHaveText("plain.docx #start");
    await lead.click();
    await expect(dialog.locator('[data-heading=""]')).toHaveAttribute("aria-current", "true");
    await expect(dialog.locator('[data-heading=""]')).toBeFocused();
    await expect(dialog.locator('[data-heading=""]')).toContainText("4 MHz");
    await page.keyboard.press("Escape");
    await page.locator('[data-toggle="right"]').click();
    await page.getByRole("tab", { name: "Files", exact: true }).click();
    const docs = page.locator("#panel-docs");
    await docs.locator("[data-docs-search]").fill("Clock");
    await expect(docs).toContainText("docs/timing.ods#h=clocks");
    await docs
      .getByRole("button", { name: /^Open / })
      .first()
      .click();
    await expect(dialog.locator('[data-heading="clocks"]')).toContainText("PLL");
    if (process.env.VERA_E2E_EVIDENCE_DIR)
      await page.screenshot({ path: join(process.env.VERA_E2E_EVIDENCE_DIR, "office-documents.png") });
    await page.keyboard.press("Escape");
    expect(errors).toEqual([]);
    expect(await outboundAttempts(app)).toEqual([]);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
