import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron, type ElectronApplication, expect, test } from "@playwright/test";
import type { VeraBridge } from "@vera/shared";
import { dictationCatalog } from "../../src/apps/desktop/src/main/dictation/catalog.js";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";

const models = process.env.VERA_DICTATION_MODEL_ROOT;
const packaged = process.env.VERA_DICTATION_PACKAGED_APP;
const desktop = resolve("src/apps/desktop");
const electron = resolve(
  "node_modules/electron/dist",
  process.platform === "win32" ? "electron.exe" : "electron",
);
const clip = resolve("tests/fixtures/dictation/en.wav");

test("native composer downloads a verified model, dictates offline into the draft and cancels", async () => {
  test.skip(!models, "Set VERA_DICTATION_MODEL_ROOT to verified local Whisper models");
  test.setTimeout(100_000);
  const root = await mkdtemp(join(tmpdir(), "vera-dictation-composer-"));
  const userData = join(root, "data");
  const workbench = join(root, "bench");
  let app: ElectronApplication | undefined;
  async function launch() {
    const instance = await _electron.launch({
      executablePath: packaged ?? electron,
      chromiumSandbox: true,
      args: [
        ...(packaged ? [] : [desktop]),
        `--user-data-dir=${userData}`,
        "--use-fake-device-for-media-stream",
        `--use-file-for-fake-audio-capture=${clip}%noloop`,
      ],
      env: { ...process.env, VERA_TEST: "1", VERA_REPLAY_DIR: resolve("tests/fixtures/llm-scripts") },
    });
    app = instance;
    expect(await instance.evaluate(({ app }) => app.getPath("userData"))).toBe(userData);
    await installNetworkGuard(instance);
    const page = await instance.firstWindow();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.focus());
    return { page, instance };
  }
  try {
    await mkdir(workbench);
    const initial = await launch();
    let { page } = initial;
    const base = dictationCatalog.find((entry) => entry.id === "whisper-base");
    if (!base) throw Error("Missing Base catalog entry");
    const files = base.files.map((file) => ({
      request: `/${base.repository}/resolve/${base.revision}/${file.path}?download=true`,
      local: join(models ?? "", base.id, file.path),
    }));
    // Exercise the real Settings action and staged integrity verification. Only the pinned
    // HTTP responses are supplied by the verified fixture cache.
    await initial.instance.evaluate(
      (_electron, { modulePath, files }) => {
        const { createRequire } = process.getBuiltinModule("node:module");
        const { readFileSync } = process.getBuiltinModule("node:fs");
        const require = createRequire(modulePath);
        const { MockAgent, setGlobalDispatcher } = require(modulePath) as typeof import("undici");
        const fixture = new MockAgent();
        fixture.disableNetConnect();
        const host = fixture.get("https://huggingface.co");
        for (const { request, local } of files)
          host.intercept({ path: request }).reply(200, readFileSync(local));
        setGlobalDispatcher(fixture);
      },
      { modulePath: resolve("node_modules/undici/index.js"), files },
    );

    await page.locator('[data-i18n="nav.settings"]').click();
    await page.locator('[data-section="dictation"]').click();
    const panel = page.locator("#section-dictation");
    await panel.getByRole("button", { name: "Download: Whisper Base" }).click();
    const useModel = panel.getByRole("button", { name: "Use model: Whisper Base" });
    await expect(useModel).toBeEnabled({ timeout: 30_000 });
    await useModel.click();
    await expect(useModel).toBeDisabled();
    await panel.locator("#dictation-language").selectOption("en");
    await panel.locator("#dictation-recording-mode").selectOption("toggle");
    await expect(panel.locator("#dictation-recording-mode")).toHaveValue("toggle");
    await panel.getByRole("button", { name: "Add shortcut: Dictate" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox").press("Control+Shift+U");
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(panel.locator("kbd")).toHaveText("Ctrl+Shift+U");
    expect(await outboundAttempts(initial.instance)).toEqual([]);
    await initial.instance.close();

    // Reload the installed model and input preference with all external traffic blocked.
    const restarted = await launch();
    page = restarted.page;
    await page.locator('[data-i18n="nav.settings"]').click();
    await page.locator('[data-section="dictation"]').click();
    await expect(page.locator("#dictation-recording-mode")).toHaveValue("toggle");
    await expect(page.locator("#section-dictation kbd")).toHaveText("Ctrl+Shift+U");
    await expect(page.getByRole("button", { name: "Use model: Whisper Base" })).toBeDisabled();
    await page.locator('[data-action="leave-settings"]').click();
    await page.evaluate(async (folder) => {
      const api = (window as unknown as { vera: VeraBridge }).vera;
      await api.invoke("workbench.create", {
        folder,
        name: "Dictation fixture",
        config: { agent: { model: "replay/ui-slow" } },
      });
    }, workbench);
    await page.reload();
    await page.locator('[data-action="new-session"]').click();
    const editor = page.locator("#chat-message");
    const microphone = page.getByRole("button", { name: "Start or stop dictation" });
    const status = page.locator("[data-dictation-status]");
    const attachment = page.locator("[data-image-attachment]");
    const { default: sharp } = await import("sharp");
    const image = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#298042" } })
      .png()
      .toBuffer();
    await page.locator('.composer input[type="file"]').setInputFiles({
      name: "board.png",
      mimeType: "image/png",
      buffer: image,
    });
    await expect(attachment).toHaveCount(1);
    await editor.fill("Before after");
    await editor.evaluate((node: HTMLTextAreaElement) => node.setSelectionRange(0, 6));
    await microphone.focus();
    await page.keyboard.press("Space");
    await expect(status).toHaveText("Recording…");
    // Use the entire 5.28-second clip from the fake OS microphone.
    await page.waitForTimeout(5_800);
    await page.keyboard.press("Space");
    await expect(status).toHaveText("Dictation added to draft.", { timeout: 35_000 });
    await expect(editor).toHaveValue(/^Before .*open the window.* after$/i);
    await expect(attachment).toHaveCount(1);
    const draft = await editor.inputValue();

    await editor.focus();
    await page.keyboard.press("Control+Shift+U");
    await expect(status).toHaveText("Recording…");
    await page.keyboard.press("Escape");
    await expect(status).toHaveText("Dictation cancelled.");
    await expect(editor).toHaveValue(draft);
    const transcript = page.locator("[data-transcript]");
    await expect(transcript.getByText(draft, { exact: true })).toHaveCount(0);
    await editor.press("Enter");
    await expect(attachment).toHaveCount(0);
    await expect(transcript.getByText(draft, { exact: true })).toBeVisible();
    expect(await outboundAttempts(restarted.instance)).toEqual([]);
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true, maxRetries: 3 });
  }
});
