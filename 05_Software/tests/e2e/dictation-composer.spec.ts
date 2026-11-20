import type { Page } from "@playwright/test";
import type { SettingsPatch } from "@vera/shared";
import de from "../../src/apps/desktop/src/renderer/locales/de.json" with { type: "json" };
import en from "../../src/apps/desktop/src/renderer/locales/en.json" with { type: "json" };
import fr from "../../src/apps/desktop/src/renderer/locales/fr.json" with { type: "json" };
import ro from "../../src/apps/desktop/src/renderer/locales/ro.json" with { type: "json" };
import { expect, test } from "./fixtures.js";

const status = (page: Page) => page.locator("[data-dictation-status]");
const microphone = (page: Page) => page.locator("[data-action=dictate]");
const input = (page: Page) => page.locator("#chat-message");
const transcript = (page: Page) => page.locator("[data-transcript]");
const shortcut = "Control+Shift+U";

async function openChat(page: Page, rendererUrl: string) {
  await page.route("**/dictation/microphone.ts*", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `export async function openMicrophone(_signal, submit) {
        return {
          start() {},
          stop() { submit(new Float32Array([0.25])); },
          close() { document.body.dataset.micClosed = String(Number(document.body.dataset.micClosed ?? 0) + 1); },
        };
      }`,
    }),
  );
  await page.goto(`${rendererUrl}/?mock=chat`);
  await page.evaluate(async () => {
    const module = "/api/index.ts";
    const { api } = await import(module);
    const invoke = api.invoke.bind(api);
    api.invoke = async (channel: string, request: unknown) => {
      if (channel === "dictation.begin") {
        const count = Number(document.body.dataset.dictationStarts ?? 0);
        document.body.dataset.dictationStarts = String(count + 1);
        return { status: document.body.dataset.dictationFailure ?? "opening" };
      }
      if (channel === "dictation.recording") return { status: "recording" };
      if (channel === "dictation.cancel") {
        document.body.dataset.dictationCancelled = "true";
        return { status: "cancelled" };
      }
      if (channel === "dictation.finish") {
        return new Promise((resolve) => {
          Reflect.set(window, "finishFixtureDictation", () =>
            resolve({ status: "complete", text: "spoken words", language: "en" }),
          );
          document.body.dataset.dictationFinishing = "true";
        });
      }
      return invoke(channel, request);
    };
  });
  await page.locator("[data-workbench-entry] .workbench-group-name").first().click();
  await page.locator('[data-action="new-session"]').click();
  await expect(microphone(page)).toBeEnabled();
}

async function complete(page: Page) {
  await expect(page.locator("body")).toHaveAttribute("data-dictation-finishing", "true");
  await page.evaluate(() => {
    Reflect.get(window, "finishFixtureDictation")();
    delete document.body.dataset.dictationFinishing;
  });
}

async function settings(page: Page) {
  await page.keyboard.press("Control+,");
  const tab = page.locator('[data-section="dictation"]');
  await tab.click();
  return page.locator("#section-dictation");
}

async function leaveSettingsForChat(page: Page) {
  await page.locator('[data-action="leave-settings"]').click();
  await page.locator("[data-session]").first().click();
  await expect(microphone(page)).toBeEnabled();
}

async function configureShortcut(page: Page) {
  const panel = await settings(page);
  await panel.getByRole("button", { name: "Add shortcut: Dictate", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const recorder = dialog.getByRole("textbox");
  for (const conflict of ["Control+n", "Control+c"]) {
    await recorder.press(conflict);
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog.getByRole("alert")).toBeVisible();
  }
  await recorder.press(shortcut);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(panel.locator("kbd")).toHaveText("Ctrl+Shift+U");
  await leaveSettingsForChat(page);
}

test("keyboard-only hold mic and app shortcut preserve selected text and dispatch one gesture", {
  tag: "@parallel-browser",
}, async ({ page, rendererUrl }) => {
  await openChat(page, rendererUrl);
  const editor = input(page);
  await editor.fill("left right");
  await editor.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(0, 4));
  for (
    let step = 0;
    step < 8 && !(await microphone(page).evaluate((node) => node === document.activeElement));
    step++
  )
    await page.keyboard.press("Tab");
  await expect(microphone(page)).toBeFocused();
  await page.keyboard.down("Space");
  await expect(status(page)).toHaveText(en.dictation.recording);
  await page.keyboard.down("Space");
  await expect(page.locator("body")).toHaveAttribute("data-dictation-starts", "1");
  await page.keyboard.up("Space");
  await expect(status(page)).toHaveText(en.dictation.transcribing);
  await complete(page);
  await expect(editor).toHaveValue("left spoken words right");
  expect(await editor.evaluate((element: HTMLTextAreaElement) => element.selectionStart)).toBe(17);
  await configureShortcut(page);
  await editor.fill("original");
  await editor.focus();
  await page.keyboard.down("Control");
  await page.keyboard.down("Shift");
  await page.keyboard.down("U");
  await expect(status(page)).toHaveText(en.dictation.recording);
  await page.keyboard.down("U");
  await expect(page.locator("body")).toHaveAttribute("data-dictation-starts", "2");
  await page.keyboard.up("Shift");
  await expect(status(page)).toHaveText(en.dictation.transcribing);
  await page.keyboard.up("U");
  await page.keyboard.up("Control");
  await editor.fill("new draft text");
  await complete(page);
  await expect(editor).toHaveValue("new draft text spoken words");
  await expect(transcript(page).getByText("new draft text spoken words", { exact: true })).toHaveCount(0);
  await editor.press("Enter");
  await expect(editor).toHaveValue("");
  await expect(transcript(page).getByText("new draft text spoken words", { exact: true })).toBeVisible();
});

test("toggle mode supports the mic and shortcut, and Escape owns an active dictation", {
  tag: "@parallel-browser",
}, async ({ page, rendererUrl }) => {
  await openChat(page, rendererUrl);
  await configureShortcut(page);
  const panel = await settings(page);
  await panel.getByLabel(en.dictation.recordingMode).selectOption("toggle");
  await expect(panel.getByLabel(en.dictation.recordingMode)).toHaveValue("toggle");
  await leaveSettingsForChat(page);
  await microphone(page).click();
  await expect(status(page)).toHaveText(en.dictation.recording);
  await microphone(page).click();
  await expect(status(page)).toHaveText(en.dictation.transcribing);
  await complete(page);
  await expect(input(page)).toHaveValue("spoken words");

  // The mock runs through normal session.send so Stop is available.
  await page.evaluate(async () => {
    const module = "/api/index.ts";
    const { api } = await import(module);
    const id = document.querySelector("[data-session][aria-current=page]")?.getAttribute("data-session");
    await api.invoke("session.send", { sessionId: id, text: "Stream slowly" });
  });
  await expect(page.locator("[data-action=stop-session]")).toBeVisible();
  await page.keyboard.press(shortcut);
  await expect(status(page)).toHaveText(en.dictation.recording);
  await page.keyboard.press("Escape");
  await expect(status(page)).toHaveText(en.dictation.cancelled);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("[data-action=stop-session]")).toBeVisible();

  await page.keyboard.down("Control");
  await page.keyboard.down("Shift");
  await page.keyboard.down("U");
  await expect(status(page)).toHaveText(en.dictation.recording);
  await page.keyboard.down("U");
  await expect(status(page)).toHaveText(en.dictation.recording);
  await page.keyboard.up("U");
  await page.keyboard.up("Shift");
  await page.keyboard.up("Control");
  await page.keyboard.press(shortcut);
  await expect(status(page)).toHaveText(en.dictation.transcribing);
  await page.keyboard.press("Escape");
  await complete(page);
  await expect(input(page)).toHaveValue("spoken words");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await microphone(page).focus();
  await page.keyboard.press("Space");
  await expect(status(page)).toHaveText(en.dictation.recording);
  await page.keyboard.press("Tab");
  const cancel = page.getByRole("button", { name: en.dictation.cancelCapture });
  await expect(cancel).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(status(page)).toHaveText(en.dictation.cancelled);
  await expect(microphone(page)).toBeFocused();
});

test("Escape cancels active dictation and still dismisses a modal", {
  tag: "@parallel-browser",
}, async ({ page, rendererUrl }) => {
  await openChat(page, rendererUrl);
  const panel = await settings(page);
  await panel.getByLabel(en.dictation.recordingMode).selectOption("toggle");
  await expect(panel.getByLabel(en.dictation.recordingMode)).toHaveValue("toggle");
  await leaveSettingsForChat(page);
  await microphone(page).click();
  await expect(status(page)).toHaveText(en.dictation.recording);
  const permissions = page.locator(".composer [data-permission-picker]");
  await permissions.selectOption("bypass");
  await expect(page.locator("dialog.bypass-warning")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog.bypass-warning")).toHaveCount(0);
  await expect(status(page)).toHaveText(en.dictation.cancelled, { timeout: 1500 });
  await expect(permissions).toBeFocused();
});

test("a keyboard shortcut save restores local focus during a confirmed settings update", {
  tag: "@parallel-browser",
}, async ({ page, rendererUrl }) => {
  await openChat(page, rendererUrl);
  const panel = await settings(page);
  await page.evaluate(async () => {
    const module = "/api/index.ts";
    const { api } = await import(module);
    const save = api.updateSettings.bind(api);
    api.updateSettings = async (patch: SettingsPatch) => {
      if (patch.keyboardShortcuts?.dictate)
        await new Promise<void>((resolve) => {
          Reflect.set(window, "releaseShortcutSave", resolve);
        });
      return save(patch);
    };
  });
  const add = panel.getByRole("button", { name: "Add shortcut: Dictate" });
  await add.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox").press(shortcut);
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(add).toBeDisabled();
  await expect(panel.getByRole("heading", { name: "Dictate", exact: true })).toBeFocused({ timeout: 1500 });
  await page.evaluate(() => Reflect.get(window, "releaseShortcutSave")());
  await expect(panel.locator("kbd")).toHaveText("Ctrl+Shift+U");
  await expect(add).toBeEnabled();
  await page.keyboard.press("Tab");
  const edit = panel.getByRole("button", { name: "Edit Dictate: Ctrl+Shift+U" });
  await expect(edit).toBeFocused();
  await page.keyboard.press("Enter");
  await dialog.getByRole("textbox").press("Control+Shift+K");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(add).toBeDisabled();
  await expect(panel.getByRole("heading", { name: "Dictate", exact: true })).toBeFocused();
  await page.evaluate(() => Reflect.get(window, "releaseShortcutSave")());
  await expect(panel.locator("kbd")).toHaveText("Ctrl+Shift+K");
});

test("focus loss ends a missed release and pending results cannot cross session or send", {
  tag: "@parallel-browser",
}, async ({ page, rendererUrl }) => {
  await openChat(page, rendererUrl);
  await configureShortcut(page);
  await input(page).focus();
  await page.keyboard.down("Control");
  await page.keyboard.down("Shift");
  await page.keyboard.down("U");
  await expect(status(page)).toHaveText(en.dictation.recording);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(status(page)).toHaveText(en.dictation.cancelled);
  await expect(page.locator("body")).toHaveAttribute("data-mic-closed", "1");
  await page.keyboard.up("U");
  await page.keyboard.up("Shift");
  await page.keyboard.up("Control");
  await expect(page.locator("body")).toHaveAttribute("data-dictation-starts", "1");
  await expect(page.locator("body")).not.toHaveAttribute("data-dictation-finishing", "true");

  await page.keyboard.press(shortcut, { delay: 80 });
  await expect(status(page)).toHaveText(en.dictation.transcribing);
  await complete(page);
  await expect(input(page)).toHaveValue("spoken words");

  await microphone(page).focus();
  await page.keyboard.press("Space", { delay: 80 });
  await expect(status(page)).toHaveText(en.dictation.transcribing);
  await input(page).fill("a separate message");
  await input(page).press("Enter");
  await complete(page);
  await expect(input(page)).toHaveValue("");

  await microphone(page).focus();
  await page.keyboard.press("Space", { delay: 80 });
  await expect(status(page)).toHaveText(en.dictation.transcribing);
  await page.locator('[data-action="new-session"]').click();
  await complete(page);
  await expect(input(page)).toHaveValue("");
});

test("a held pointer releases outside the microphone and hidden chat drops a pending result", {
  tag: "@parallel-browser",
}, async ({ page, rendererUrl }) => {
  await openChat(page, rendererUrl);
  const mic = microphone(page);
  const position = await mic.boundingBox();
  if (!position) throw Error("Missing microphone position");
  await page.mouse.move(position.x + position.width / 2, position.y + position.height / 2);
  await page.mouse.down();
  await expect(status(page)).toHaveText(en.dictation.recording);
  await page.mouse.move(2, 2);
  await page.mouse.up();
  await expect(status(page)).toHaveText(en.dictation.transcribing);

  if (!(await page.locator("#tab-docs").isVisible())) await page.locator('[data-toggle="right"]').click();
  await page.locator("#tab-docs").click();
  const docs = page.locator('[data-tree-path="docs"]');
  if ((await docs.getAttribute("aria-expanded")) === "false") await docs.click();
  await page.locator('[data-tree-path="docs/a.md"]').click();
  await expect(input(page)).toBeHidden();
  await complete(page);
  await page.locator('[data-document-tabs] [data-tab-key="chat"]').click();
  await expect(input(page)).toHaveValue("");
});

for (const [language, catalog] of Object.entries({ en, ro, de, fr })) {
  test(`dictation settings and keyboard feedback use ${language}`, {
    tag: "@parallel-browser",
  }, async ({ page, rendererUrl }) => {
    await openChat(page, rendererUrl);
    await page.keyboard.press("Control+,");
    const locale = page.locator("#language");
    await locale.selectOption(language);
    const tab = page.locator('[data-section="dictation"]');
    await expect(tab).toHaveText(catalog.settings.dictation);
    await tab.click();
    const panel = page.locator("#section-dictation");
    await expect(panel.getByLabel(catalog.dictation.recordingMode)).toHaveValue("hold");
    await expect(panel.getByRole("heading", { name: catalog.keyboard.dictate, exact: true })).toBeVisible();
    await leaveSettingsForChat(page);
    await expect(microphone(page)).toHaveAccessibleName(catalog.dictation.holdToTalk);
    await page.evaluate(() => {
      document.body.dataset.dictationFailure = "missing-model";
    });
    await microphone(page).focus();
    await page.keyboard.down("Space");
    await expect(page.getByRole("alert")).toHaveText(catalog.dictation.missingModel);
    await page.keyboard.up("Space");
    await page.evaluate(() => {
      delete document.body.dataset.dictationFailure;
    });
    await page.keyboard.down("Space");
    await expect(status(page)).toHaveText(catalog.dictation.recording);
    await page.keyboard.up("Space");
    await expect(status(page)).toHaveText(catalog.dictation.transcribing);
    await complete(page);
    await expect(status(page)).toHaveText(catalog.dictation.inserted);
  });
}
