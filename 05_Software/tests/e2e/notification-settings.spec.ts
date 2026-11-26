import { expect, test } from "./fixtures.js";
import { saveSettings } from "./settings-navigation.js";

test("opens notification preferences by keyboard and keeps the draft through a failed save", {
  tag: "@parallel-browser",
}, async ({ page, rendererUrl }) => {
  await page.goto(rendererUrl);
  await page.locator('[data-i18n="nav.settings"]').click();
  for (const section of ["commands", "dictation", "shortcuts", "updates", "data"]) {
    await page.getByRole("tab", { selected: true }).press("ArrowDown");
    await expect(page.locator(`[data-section="${section}"]`)).toBeFocused();
  }
  const tab = page.getByRole("tab", { name: "Data & privacy", exact: true });
  await expect(tab).toBeFocused();
  const panel = page.getByRole("tabpanel", { name: "Data & privacy" });
  const displayMask = panel.locator('[data-mask-area="display"] input');
  const completion = panel.getByRole("combobox", { name: "Turn completion" });
  const approvals = panel.getByRole("switch", { name: "Approval requests in background" });
  const questions = panel.getByRole("switch", { name: "Question notifications" });
  const save = panel.getByRole("button", { name: "Save", exact: true });
  const cancel = panel.getByRole("button", { name: "Cancel", exact: true });
  for (let step = 0; step < 10; step++) {
    await page.keyboard.press("Tab");
    if (await panel.evaluate((element) => document.activeElement === element)) break;
  }
  await expect(panel).toBeFocused();
  for (let step = 0; step < 10; step++) {
    await page.keyboard.press("Tab");
    if (await completion.evaluate((element) => document.activeElement === element)) break;
  }
  await expect(completion).toBeFocused();
  await expect(completion).toHaveValue("background");
  await expect(approvals).toBeChecked();
  await expect(questions).toBeChecked();
  await expect(displayMask).not.toBeChecked();
  await expect(save).toBeDisabled();
  await expect(cancel).toBeDisabled();

  await completion.press("End");
  await page.keyboard.press("Tab");
  await expect(approvals).toBeFocused();
  await approvals.press("Space");
  await expect(approvals).not.toBeChecked();
  await expect(completion).toHaveValue("always");
  await page.keyboard.press("Tab");
  await expect(questions).toBeFocused();
  await questions.press("Space");
  await expect(questions).not.toBeChecked();
  await displayMask.check();
  await cancel.click();
  await expect(completion).toHaveValue("background");
  await expect(approvals).toBeChecked();
  await expect(questions).toBeChecked();
  await expect(displayMask).not.toBeChecked();

  await page.evaluate(async () => {
    const modulePath = "/api/index.ts";
    const { api } = await import(modulePath);
    const original = api.updateSettings.bind(api);
    api.updateSettings = async () => {
      api.updateSettings = original;
      throw { code: "BUSY", messageKey: "errors.BUSY" };
    };
  });
  await completion.selectOption("never");
  await approvals.uncheck();
  await questions.uncheck();
  await displayMask.check();
  await save.click();
  await expect(panel.getByRole("alert")).toBeVisible();
  await expect(completion).toHaveValue("never");
  await expect(approvals).not.toBeChecked();
  await expect(questions).not.toBeChecked();
  await expect(displayMask).toBeChecked();
  expect(
    await page.evaluate(async () => {
      const modulePath = "/api/index.ts";
      const { api } = await import(modulePath);
      const { notifications, privacy } = (await api.getSettings()).settings;
      return { notifications, display: privacy?.mask?.display };
    }),
  ).toEqual({
    notifications: { turnCompletion: "background", approvalRequests: true, questionRequests: true },
    display: false,
  });
  await expect(save).toBeEnabled();
  await saveSettings(page);
  await expect(panel.getByRole("alert")).toHaveCount(0);
  await page.locator('[data-section="updates"]').click();
  await tab.click();
  await expect(completion).toHaveValue("never");
  await expect(approvals).not.toBeChecked();
  await expect(questions).not.toBeChecked();
  await expect(displayMask).toBeChecked();

  await completion.selectOption("always");
  const updates = page.locator('[data-section="updates"]');
  page.once("dialog", (dialog) => dialog.dismiss());
  await updates.click();
  await expect(completion).toHaveValue("always");
  page.once("dialog", (dialog) => dialog.accept());
  await updates.click();
  await expect(updates).toHaveAttribute("aria-selected", "true");
  await tab.click();
  await expect(completion).toHaveValue("never");
});

test("localizes the notification controls and choices in all four interface languages", {
  tag: "@parallel-browser",
}, async ({ page, rendererUrl }) => {
  await page.goto(rendererUrl);
  await page.locator('[data-i18n="nav.settings"]').click();
  const labels = [
    [
      "en",
      "Notifications",
      "Turn completion",
      "Approval requests in background",
      "Question notifications",
      "Never",
      "In background",
      "Always",
    ],
    [
      "ro",
      "Notificări",
      "Finalizarea unei ture",
      "Cereri de aprobare în fundal",
      "Notificări pentru întrebări",
      "Niciodată",
      "În fundal",
      "Întotdeauna",
    ],
    [
      "de",
      "Benachrichtigungen",
      "Abschluss eines Durchlaufs",
      "Freigabeanfragen im Hintergrund",
      "Benachrichtigungen zu Fragen",
      "Nie",
      "Im Hintergrund",
      "Immer",
    ],
    [
      "fr",
      "Notifications",
      "Fin d’un tour",
      "Demandes d’approbation en arrière-plan",
      "Notifications de questions",
      "Jamais",
      "En arrière-plan",
      "Toujours",
    ],
  ] as const;
  for (const [language, title, completion, approvals, questions, never, background, always] of labels) {
    await page.locator('[data-section="appearance"]').click();
    await page.locator("#language").selectOption(language);
    await saveSettings(page);
    await page.locator('[data-section="data"]').click();
    const panel = page.getByRole("tabpanel").getByRole("region", { name: title, exact: true });
    await expect(panel.getByRole("combobox", { name: completion }).getByRole("option")).toHaveText([
      never,
      background,
      always,
    ]);
    await expect(panel.getByRole("switch", { name: approvals })).toBeChecked();
    await expect(panel.getByRole("switch", { name: questions })).toBeChecked();
  }
});
