// REQ-FUNC-51165496 REQ-UX-34535128
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron, type ElectronApplication, expect, test } from "@playwright/test";
import type { VeraBridge } from "@vera/shared";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";

const desktop = join(dirname(fileURLToPath(import.meta.url)), "../apps/desktop");
test("native citation kinds show verified and warning chips and persist after restart", async () => {
  test.setTimeout(60000);
  const root = await mkdtemp(join(tmpdir(), "vera-citations-native-"));
  const folder = join(root, "bench");
  await mkdir(folder);
  const executable = join(
    desktop,
    "../../node_modules/electron/dist",
    process.platform === "win32" ? "electron.exe" : "electron",
  );
  const env = Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === "string"),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERA_TEST_DIALOG_PATH = folder;
  env.VERA_REPLAY_DIR = join(desktop, "../../fixtures/llm-scripts");
  const outputs: { stdout: string[]; stderr: string[]; loaded: unknown }[] = [];
  const launch = async () => {
    const app = await _electron.launch({
      executablePath: executable,
      chromiumSandbox: true,
      args: [desktop, `--user-data-dir=${join(root, "data")}`],
      env,
    });
    const output = {
      stdout: [] as string[],
      stderr: [] as string[],
      loaded: await app.evaluate(() => ({
        execPath: process.execPath,
        electron: process.versions.electron,
        node: process.versions.node,
      })),
    };
    app.process().stdout?.on("data", (b) => output.stdout.push(String(b)));
    app.process().stderr?.on("data", (b) => output.stderr.push(String(b)));
    outputs.push(output);
    expect(output.loaded.electron).toBe("44.7.0");
    await installNetworkGuard(app);
    return app;
  };
  let app: ElectronApplication | undefined;
  try {
    app = await launch();
    let page = await app.firstWindow();
    await page.locator("#workbench-name").fill("Citations");
    await page.locator('[data-action="choose-create"]').click();
    await page.locator('[data-action="create-workbench"]').click();
    await page.locator('[data-action="new-session"]').click();
    await writeFile(
      join(folder, "docs/a.pdf"),
      await readFile(join(desktop, "../../fixtures/documents/pages.pdf")),
    );
    await writeFile(join(folder, "docs/a.md"), "# Power\n3.3 V\n");
    await writeFile(join(folder, "docs/a.html"), "<h1>Reset</h1><p>Assert.</p>");
    await writeFile(join(folder, "docs/a.log"), "first\nsecond\n");
    await page.evaluate(async () => {
      await (window as unknown as { vera: VeraBridge }).vera.invoke("docs.reindex", {});
    });
    const id = await page.locator('[data-session][aria-current="page"]').getAttribute("data-session");
    expect(id).toBeTruthy();
    await page.evaluate(async (id) => {
      await (window as unknown as { vera: VeraBridge }).vera.invoke("session.model.set", {
        sessionId: id!,
        modelRef: "replay/citations-all",
      });
    }, id);
    await page.getByRole("textbox", { name: "Message", exact: true }).fill("Citation kinds");
    await page.getByRole("textbox", { name: "Message", exact: true }).press("Enter");
    await expect(page.locator('[data-citation="valid"]')).toHaveCount(6);
    await expect(page.locator('[data-citation="invalid"]')).toHaveCount(7);
    await expect(page.getByRole("textbox", { name: "Message", exact: true })).toBeEnabled();
    const kinds = ["page", "page-range", "heading", "heading", "lines", "artifact"];
    const labels = ["a.pdf p1", "a.pdf p1–2", "a.md #power", "a.html #reset", "a.log L1–2", "summary.md"];
    for (let n = 0; n < kinds.length; n++) {
      const chip = page.locator('[data-citation="valid"]').nth(n);
      await expect(chip).toHaveAttribute("data-citation-kind", kinds[n]!);
      await expect(chip).toHaveText(labels[n]!);
      expect(await chip.getAttribute("title")).toBe(await chip.getAttribute("aria-label"));
      await expect(chip.locator('svg[aria-hidden="true"]')).toHaveCount(1);
    }
    const warning = page.locator('[data-citation="invalid"]').first();
    await expect(warning).toHaveAttribute("aria-disabled", "true");
    await expect(warning).toHaveClass(/invalid/);
    const validColour = await page
      .locator('[data-citation="valid"]')
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(await warning.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(validColour);
    await warning.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".citation-note")).toHaveCount(0);
    const before = await page.evaluate(
      async (id) =>
        (await (window as unknown as { vera: VeraBridge }).vera.invoke("session.get", { sessionId: id! }))
          .snapshot,
      id,
    );
    const transcript = await page.locator("[data-transcript]").textContent();
    expect(await outboundAttempts(app)).toEqual([]);
    if (process.env.VERA_E2E_EVIDENCE_DIR)
      await page.screenshot({ path: join(process.env.VERA_E2E_EVIDENCE_DIR, "citations-before.png") });
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await page.locator('[data-action="open-recent"]').click();
    await expect(page.locator('[data-citation="valid"]')).toHaveCount(6);
    await expect(page.locator('[data-citation="invalid"]')).toHaveCount(7);
    await expect(page.locator("[data-transcript]")).toHaveText(transcript!);
    const after = await page.evaluate(
      async (id) =>
        (await (window as unknown as { vera: VeraBridge }).vera.invoke("session.get", { sessionId: id! }))
          .snapshot,
      id,
    );
    expect(after).toEqual(before);
    expect(await outboundAttempts(app)).toEqual([]);
    if (process.env.VERA_E2E_EVIDENCE_DIR) {
      await page.screenshot({ path: join(process.env.VERA_E2E_EVIDENCE_DIR, "citations-after.png") });
      await writeFile(
        join(process.env.VERA_E2E_EVIDENCE_DIR, "citation-snapshots.json"),
        JSON.stringify({ before, after }, null, 2),
      );
    }
  } finally {
    await app?.close();
    if (process.env.VERA_E2E_EVIDENCE_DIR) {
      const hash = async (path: string) =>
        createHash("sha256")
          .update(await readFile(path))
          .digest("hex");
      await writeFile(
        join(process.env.VERA_E2E_EVIDENCE_DIR, "citation-native.json"),
        JSON.stringify(
          {
            executable,
            executableSha256: await hash(executable),
            mainSha256: await hash(join(desktop, "out/main/index.js")),
            outputs,
          },
          null,
          2,
        ),
      );
    }
    await rm(root, { recursive: true, force: true });
  }
});
