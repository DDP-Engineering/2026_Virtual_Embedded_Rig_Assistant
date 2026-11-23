import { expect, test } from "./fixtures.js";
import { saveSettings } from "./settings-navigation.js";

test("opens notification preferences by keyboard and keeps the draft through a failed save", {
  tag: "@parallel-browser",
}, async ({ page, rendererUrl }) => {
  await page.goto(rendererUrl);
  await page.locator('[data-i18n="nav.settings"]').click();
  const appearance = page.getByRole("tab", { selected: true });
  await appearance.press("ArrowDown");
  await page.getByRole("tab", { selected: true }).press("ArrowDown");
  const tab = page.getByRole("tab", { name: "Notifications", exact: true });
  await expect(tab).toBeFocused();
  const panel = page.getByRole("tabpanel", { name: "Notifications" });
  const completion = panel.getByRole("combobox", { name: "Turn completion" });
  const approvals = panel.getByRole("switch", { name: "Approval requests in background" });
  const save = panel.getByRole("button", { name: "Save", exact: true });
  const cancel = panel.getByRole("button", { name: "Cancel", exact: true });
  for (let step = 0; step < 10; step++) {
    await page.keyboard.press("Tab");
    if (await panel.evaluate((element) => document.activeElement === element)) break;
  }
  await expect(panel).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(completion).toBeFocused();
  await expect(completion).toHaveValue("background");
  await expect(approvals).toBeChecked();
  await expect(save).toBeDisabled();
  await expect(cancel).toBeDisabled();

  await completion.press("End");
  await page.keyboard.press("Tab");
  await expect(approvals).toBeFocused();
  await approvals.press("Space");
  await expect(approvals).not.toBeChecked();
  await expect(completion).toHaveValue("always");
  await cancel.click();
  await expect(completion).toHaveValue("background");
  await expect(approvals).toBeChecked();

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
  await save.click();
  await expect(panel.getByRole("alert")).toBeVisible();
  await expect(completion).toHaveValue("never");
  await expect(approvals).not.toBeChecked();
  expect(
    await page.evaluate(async () => {
      const modulePath = "/api/index.ts";
      const { api } = await import(modulePath);
      return (await api.getSettings()).settings.notifications;
    }),
  ).toEqual({ turnCompletion: "background", approvalRequests: true });
  await expect(save).toBeEnabled();
  await saveSettings(page);
  await expect(panel.getByRole("alert")).toHaveCount(0);
  await page.locator('[data-section="updates"]').click();
  await tab.click();
  await expect(completion).toHaveValue("never");
  await expect(approvals).not.toBeChecked();

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
      "Never",
      "In background",
      "Always",
    ],
    [
      "ro",
      "Notificări",
      "Finalizarea unei ture",
      "Cereri de aprobare în fundal",
      "Niciodată",
      "În fundal",
      "Întotdeauna",
    ],
    [
      "de",
      "Benachrichtigungen",
      "Abschluss eines Durchlaufs",
      "Freigabeanfragen im Hintergrund",
      "Nie",
      "Im Hintergrund",
      "Immer",
    ],
    [
      "fr",
      "Notifications",
      "Fin d’un tour",
      "Demandes d’approbation en arrière-plan",
      "Jamais",
      "En arrière-plan",
      "Toujours",
    ],
  ] as const;
  for (const [language, title, completion, approvals, never, background, always] of labels) {
    await page.locator('[data-section="appearance"]').click();
    await page.locator("#language").selectOption(language);
    await saveSettings(page);
    await page.getByRole("tab", { name: title, exact: true }).click();
    const panel = page.getByRole("tabpanel", { name: title });
    await expect(panel.getByRole("combobox", { name: completion }).getByRole("option")).toHaveText([
      never,
      background,
      always,
    ]);
    await expect(panel.getByRole("switch", { name: approvals })).toBeChecked();
  }
});
