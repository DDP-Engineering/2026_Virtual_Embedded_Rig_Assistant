import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron, type ElectronApplication, expect, test } from "@playwright/test";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";

const electron = resolve(
  "node_modules/electron/dist",
  process.platform === "win32" ? "electron.exe" : "electron",
);

// REQ-REL-5b7d34d9, REQ-SEC-92a60a12, REQ-SEC-a255c261
test("Install from file starts nothing when the picker closes and refuses a wrong file offline", async () => {
  test.setTimeout(60_000);
  const scratch = await mkdtemp(join(tmpdir(), "vera-install-file-e2e-"));
  const userData = join(scratch, "data");
  const wrong = join(scratch, "not-a-component.zip");
  await writeFile(wrong, "not the pinned archive");
  let app: ElectronApplication | undefined;
  try {
    app = await _electron.launch({
      executablePath: electron,
      chromiumSandbox: true,
      args: [resolve("src/apps/desktop"), `--user-data-dir=${userData}`],
      // An empty value is the instrumented picker closed without a file.
      env: { ...process.env, VERA_TEST: "1", VERA_TEST_COMPONENT_FILE: "" },
    });
    await installNetworkGuard(app);
    const page = await app.firstWindow();
    await page.evaluate(() =>
      (window as unknown as { vera: import("@vera/shared").VeraBridge }).vera.invoke("app.settings.update", {
        language: "en",
      }),
    );
    await page.locator('[data-i18n="nav.settings"]').click();

    await page.locator('[data-section="web"]').click();
    const runtime = page.locator("[data-browser-runtime]");
    await expect(runtime).toHaveAttribute("data-browser-runtime", "missing");
    await page.locator('[data-action="browser-install-file"]').click();
    await expect(page.locator('[data-action="browser-install-file"]')).toBeEnabled();
    await expect(runtime).toHaveAttribute("data-browser-runtime", "missing");

    await page.locator('[data-section="dictation"]').click();
    const base = page.locator("tr.dictation-model").first();
    await expect(base).toContainText("Not installed");
    await base.locator('[data-action="dictation-install-file"]').click();
    await expect(base.locator('[data-action="dictation-install-file"]')).toBeEnabled();
    await expect(base).toContainText("Not installed");
    expect(existsSync(join(userData, "dictation-models", "whisper-base"))).toBe(false);

    await app.evaluate((_electron, file) => {
      process.env.VERA_TEST_COMPONENT_FILE = file;
    }, wrong);
    await base.locator('[data-action="dictation-install-file"]').click();
    await expect(base.locator('[role="status"]')).toHaveText("The files could not be verified.");
    expect(existsSync(join(userData, "dictation-models", "whisper-base"))).toBe(false);

    await page.locator('[data-section="web"]').click();
    await page.locator('[data-action="browser-install-file"]').click();
    await expect(runtime).toHaveAttribute("data-browser-runtime", "failed");
    await expect(runtime).toContainText("Browser runtime verification failed");
    expect(existsSync(join(userData, "browser-runtime", "156.0.8078.4"))).toBe(false);
    expect(await outboundAttempts(app)).toEqual([]);
  } finally {
    await app?.close();
    await rm(scratch, { recursive: true, force: true });
  }
});
