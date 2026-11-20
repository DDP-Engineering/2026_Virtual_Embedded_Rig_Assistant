import type { Page } from "@playwright/test";
import { channels, type SessionState } from "@vera/shared";
import { expect, test } from "./fixtures.js";

type Audit = { channel: string; request: unknown }[];
async function audit(page: Page): Promise<Audit> {
  return page.evaluate(() => (window as unknown as { planAudit: Audit }).planAudit);
}
async function snapshot(page: Page, scope: { sessionId: string }): Promise<SessionState> {
  return page.evaluate(async (scope) => {
    const module = "/api/index.ts";
    const { api } = await import(/* @vite-ignore */ module);
    return (await api.invoke("session.get", { sessionId: scope.sessionId })).snapshot;
  }, scope);
}

const labels = {
  en: {
    feedback: "Feedback",
    stepText: "Step text",
    selection: "Use selected text",
    save: "Save draft",
    cancel: "Cancel",
    review: "Review plan",
    previous: "Previous reviews",
    delete: "Delete feedback",
    draft: "Drafts: 1",
  },
  ro: {
    feedback: "Feedback",
    stepText: "Textul pasului",
    selection: "Folosește textul selectat",
    save: "Salvează schița",
    cancel: "Anulează",
    review: "Revizuiește planul",
    previous: "Revizuiri anterioare",
    delete: "Șterge feedbackul",
    draft: "Schițe: 1",
  },
  de: {
    feedback: "Feedback",
    stepText: "Schritttext",
    selection: "Ausgewählten Text verwenden",
    save: "Entwurf speichern",
    cancel: "Abbrechen",
    review: "Plan prüfen",
    previous: "Frühere Prüfungen",
    delete: "Feedback löschen",
    draft: "Entwürfe: 1",
  },
  fr: {
    feedback: "Commentaire",
    stepText: "Texte de l’étape",
    selection: "Utiliser le texte sélectionné",
    save: "Enregistrer le brouillon",
    cancel: "Annuler",
    review: "Réviser le plan",
    previous: "Révisions précédentes",
    delete: "Supprimer le commentaire",
    draft: "Brouillons : 1",
  },
} as const;

test("Plan feedback preserves exact keyboard fragments and isolated explicit review in four languages at minimum geometry", {
  tag: "@parallel-browser",
}, async ({ page, context, rendererUrl }) => {
  test.setTimeout(120000);
  const errors: string[] = [],
    outbound: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await context.route("**/*", async (route) => {
    if (new URL(route.request().url()).hostname === "127.0.0.1") await route.continue();
    else {
      outbound.push(route.request().url());
      await route.abort();
    }
  });
  await page.setViewportSize({ width: 1024, height: 640 });
  await page.goto(`${rendererUrl}/?mock=chat`);
  await page.locator('[data-i18n="nav.welcome"]').click();
  await page.locator('[data-action="choose-create"]').click();
  await page.locator('[data-action="create-workbench"]').click();
  await page.locator("[data-session]").filter({ hasText: "Plan feedback targets" }).click();
  await page.locator('[data-toggle="right"]').click();
  await page.locator("#tab-plan").click();
  await page.locator('[data-resize="right"]').focus();
  await page.keyboard.press("Home");
  await page.evaluate(async () => {
    const module = "/api/index.ts",
      { api } = await import(/* @vite-ignore */ module);
    const invoke = api.invoke.bind(api),
      planAudit: Audit = [];
    Object.assign(window, { planAudit });
    api.invoke = async (channel: string, request: unknown) => {
      planAudit.push({ channel, request: structuredClone(request) });
      return invoke(channel, request);
    };
  });
  const panel = page.locator("#panel-plan"),
    rows = panel.locator(".plan-tab > .plan-list > li");
  const sessionId = await page.locator('[data-session][aria-current="page"]').getAttribute("data-session");
  if (!sessionId) throw Error("missing Plan fixture session");
  const initialUsers = (await snapshot(page, { sessionId })).items.filter((item) => item.kind === "user");
  let completed = 0;
  for (const language of ["en", "ro", "de", "fr"] as const) {
    const names = labels[language];
    await page.evaluate(async (language) => {
      const module = "/api/index.ts",
        { api } = await import(/* @vite-ignore */ module);
      await api.updateSettings({ language, theme: "light", textScale: 1 });
    }, language);
    await expect(page.locator("html")).toHaveAttribute("lang", language);
    await expect(rows).toHaveCount(4);
    const duplicate = rows.filter({ hasText: "A😀B" }).nth(1);
    const stepIndex = Number(await duplicate.getAttribute("data-plan-step"));
    const opener = duplicate.locator("button").first();
    await opener.focus();
    await page.keyboard.press("Enter");
    const dialog = page.locator("dialog[open]"),
      input = dialog.getByRole("textbox", { name: names.feedback, exact: true });
    const feedback = `Vérifier ${language}\n 😀 μC `;
    await input.fill(feedback);
    for (const theme of ["light", "dark"])
      for (const textScale of [0.75, 0.875, 1, 1.125, 1.25, 1.5]) {
        await page.evaluate(
          async ({ theme, textScale }) => {
            const module = "/api/index.ts",
              { api } = await import(/* @vite-ignore */ module);
            await api.updateSettings({ theme, textScale });
          },
          { theme, textScale },
        );
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await expect
          .poll(() => page.locator("html").evaluate((node) => getComputedStyle(node).fontSize))
          .toBe(`${14 * textScale}px`);
        await expect(input).toHaveValue(feedback);
        expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
        expect(await panel.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        const visibleSave = await dialog.getByRole("button", { name: names.save, exact: true }).boundingBox(),
          bounds = await dialog.boundingBox();
        expect(
          visibleSave &&
            bounds &&
            visibleSave.y >= bounds.y &&
            visibleSave.y + visibleSave.height <= bounds.y + bounds.height,
        ).toBe(true);
      }
    const selector = dialog.getByRole("textbox", { name: names.stepText, exact: true });
    await expect(selector).toHaveValue("A😀B\n μC ");
    await selector.focus();
    await page.keyboard.press("Control+Home");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Shift+ArrowRight");
    expect(
      await selector.evaluate((node: HTMLTextAreaElement) => [node.selectionStart, node.selectionEnd]),
    ).toEqual([1, 3]);
    await expect(selector).toHaveAttribute("aria-readonly", "true");
    await page.keyboard.type("MUST NOT EDIT");
    await page.keyboard.press("Backspace");
    await expect(selector).toHaveValue("A😀B\n μC ");
    await selector.focus();
    await page.keyboard.press("Control+Home");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Shift+ArrowRight");
    await dialog.getByRole("button", { name: names.selection, exact: true }).click();
    await expect(dialog.locator("blockquote")).toHaveText("😀");
    await dialog.getByRole("button", { name: names.save, exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const writes = await audit(page),
      write = writes.findLast((entry) => entry.channel === "session.plan.comment.save");
    const request = channels["session.plan.comment.save"].request.parse(write?.request);
    expect(request).toMatchObject({
      action: "create",
      text: feedback,
      target: { stepIndex, stepText: "A😀B\n μC ", range: { start: 1, end: 3, quote: "😀" } },
    });
    const scope = { workbenchId: request.workbenchId, sessionId: request.sessionId };
    const saved = await snapshot(page, scope);
    const savedUsers = saved.items.filter((item) => item.kind === "user");
    expect(savedUsers).toHaveLength(initialUsers.length + completed);
    expect(savedUsers.slice(0, initialUsers.length)).toEqual(initialUsers);
    expect(saved.planComments).toHaveLength(1);
    await rows.nth(stepIndex).getByRole("button", { name: names.draft, exact: true }).click();
    await expect(rows.nth(stepIndex).locator(".plan-feedback-text")).toHaveText(feedback);
    await panel.getByRole("button", { name: names.review, exact: true }).click();
    await expect.poll(async () => (await snapshot(page, scope)).planReviews.at(-1)?.stopReason).toBe("end");
    const reviewed = await snapshot(page, scope);
    completed++;
    expect(reviewed.planReviews).toHaveLength(completed);
    expect(reviewed.items.filter((item) => item.kind === "user")).toHaveLength(
      initialUsers.length + completed,
    );
    expect(reviewed.planReviews.at(-1)?.comments[0]?.text).toBe(feedback);
    expect(reviewed.planRevision).toBe(saved.planRevision + 1);
    expect(reviewed.planComments).toEqual([]);
    expect(reviewed.items.filter((item) => item.kind === "tool").every((item) => item.name === "todo")).toBe(
      true,
    );
    expect(reviewed.changes).toEqual([]);
    expect(reviewed.approvals).toEqual([]);
    await expect(rows.getByRole("button", { name: names.draft, exact: true })).toHaveCount(0);
    await panel.getByRole("button", { name: names.previous, exact: true }).click();
    await expect(panel.locator(".plan-review-history").first().locator(".plan-feedback-text")).toHaveText(
      feedback,
    );
    await panel.getByRole("button", { name: names.previous, exact: true }).click();
    const empty = rows.filter({ has: page.locator(".plan-text:empty") });
    await empty.locator("button").first().click();
    await expect(dialog.getByRole("textbox", { name: names.stepText, exact: true })).toHaveValue("");
    await dialog.getByRole("textbox", { name: names.feedback, exact: true }).fill("Whole empty step");
    await dialog.getByRole("button", { name: names.save, exact: true }).click();
    await empty.getByRole("button", { name: names.draft, exact: true }).click();
    await empty.getByRole("button", { name: names.delete, exact: true }).click();
    await expect(empty.getByRole("button", { name: names.draft, exact: true })).toHaveCount(0);
  }
  const pointerRow = rows.filter({ hasText: "A😀B" }).nth(1),
    opener = pointerRow.locator("button").first();
  for (const cancel of [true, false]) {
    await pointerRow.locator(".plan-text").scrollIntoViewIfNeeded();
    const coordinates = await pointerRow.locator(".plan-text").evaluate((node) => {
      const text = node.firstChild;
      if (!text) throw Error("missing pointer text");
      const range = document.createRange();
      range.setStart(text, 1);
      range.setEnd(text, 3);
      const rect = range.getBoundingClientRect();
      return { start: rect.left + 1, end: rect.right - 1, y: rect.top + rect.height / 2 };
    });
    await page.mouse.move(coordinates.start, coordinates.y);
    await page.mouse.down();
    await page.mouse.move(coordinates.end, coordinates.y, { steps: 6 });
    await page.mouse.up();
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("😀");
    await opener.click();
    await expect(page.locator("dialog[open] blockquote")).toHaveText("😀");
    if (cancel) {
      await page.keyboard.press("Escape");
      await expect(page.locator("dialog[open]")).toHaveCount(0);
      await expect(opener).toBeFocused();
    }
  }
  await page
    .locator("dialog[open]")
    .getByRole("textbox", { name: labels.fr.feedback, exact: true })
    .fill("Pointer feedback after Escape");
  await page.locator("dialog[open]").getByRole("button", { name: labels.fr.save, exact: true }).click();
  const lastWrite = (await audit(page)).findLast((entry) => entry.channel === "session.plan.comment.save");
  const captured = channels["session.plan.comment.save"].request.parse(lastWrite?.request);
  expect(captured).toMatchObject({ target: { range: { start: 1, end: 3, quote: "😀" } } });
  await page.evaluate(async () => {
    const module = "/api/index.ts",
      { api } = await import(/* @vite-ignore */ module),
      invoke = api.invoke.bind(api);
    let unknown = true;
    api.invoke = async (channel: string, request: unknown) => {
      const result = await invoke(channel, request);
      if (channel === "session.plan.review" && unknown) {
        unknown = false;
        throw { code: "OFFLINE", messageKey: "errors.OFFLINE", stacks: [] };
      }
      return result;
    };
  });
  await panel.getByRole("button", { name: labels.fr.review, exact: true }).click();
  await panel.getByRole("button", { name: "Réessayer la révision", exact: true }).click();
  const scope = { workbenchId: captured.workbenchId, sessionId: captured.sessionId };
  await expect.poll(async () => (await snapshot(page, scope)).planReviews.at(-1)?.stopReason).toBe("end");
  expect((await snapshot(page, scope)).planReviews).toHaveLength(completed + 1);
  const reviewRequests = (await audit(page)).filter((entry) => entry.channel === "session.plan.review");
  expect(reviewRequests.at(-1)?.request).toEqual(reviewRequests.at(-2)?.request);
  expect(
    (await audit(page)).some(
      (entry) =>
        entry.channel === "session.send" ||
        entry.channel === "terminal.start" ||
        entry.channel === "program.run",
    ),
  ).toBe(false);
  expect(errors).toEqual([]);
  expect(outbound).toEqual([]);
});

test("Plan comment read/edit/re-anchor/delete and review work with keyboard-only actions", {
  tag: "@parallel-browser",
}, async ({ page, rendererUrl }) => {
  await page.setViewportSize({ width: 1024, height: 640 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${rendererUrl}/?mock=chat`);
  await page.locator('[data-i18n="nav.welcome"]').click();
  await page.locator('[data-action="choose-create"]').click();
  await page.locator('[data-action="create-workbench"]').click();
  const selected = page.locator("[data-session]").filter({ hasText: "Plan feedback targets" });
  await selected.click();
  const sessionId = await selected.getAttribute("data-session");
  if (!sessionId) throw Error("missing session identity");
  await page.locator('[data-toggle="right"]').click();
  await page.locator("#tab-plan").focus();
  await page.keyboard.press("Enter");
  const panel = page.locator("#panel-plan"),
    rows = panel.locator(".plan-tab > .plan-list > li"),
    dialog = page.locator("dialog[open]");
  const activate = async (name: string) => {
    const control = page.getByRole("button", { name, exact: true });
    await control.focus();
    await page.keyboard.press("Enter");
  };
  await page.locator('[data-resize="right"]').focus();
  await page.keyboard.press("Home");
  await page.evaluate(async () => {
    const module = "/api/index.ts",
      { api } = await import(/* @vite-ignore */ module);
    await api.updateSettings({ theme: "dark", textScale: 1.5 });
  });
  await activate("Add comment to step 2");
  const selector = dialog.getByRole("textbox", { name: "Step text", exact: true });
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Save draft", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("combobox", { name: "Step", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(selector).toBeFocused();
  expect(
    await selector.evaluate((node) => {
      const style = getComputedStyle(node);
      return Number.parseFloat(style.outlineWidth) > 0 && style.outlineStyle !== "none";
    }),
  ).toBe(true);
  expect(await dialog.evaluate((node) => getComputedStyle(node).animationName)).toBe("none");
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+ArrowLeft");
  expect(
    await selector.evaluate((node: HTMLTextAreaElement) => [
      node.selectionStart,
      node.selectionEnd,
      node.selectionDirection,
    ]),
  ).toEqual([1, 3, "backward"]);
  await activate("Use selected text");
  const input = dialog.getByRole("textbox", { name: "Feedback", exact: true });
  await page.keyboard.press("Tab");
  await expect(input).toBeFocused();
  await input.pressSequentially("Vérifier 😀");
  await page.keyboard.press("Enter");
  await input.pressSequentially("μC");
  await activate("Save draft");
  await expect(dialog).toHaveCount(0);
  await activate("Drafts: 1");
  await activate("Edit feedback");
  await input.focus();
  await page.keyboard.press("Control+A");
  await input.pressSequentially("Edited 😀");
  await page.keyboard.press("Enter");
  await input.pressSequentially("μ");
  await activate("Save draft");
  await page.evaluate(async (sessionId) => {
    const module = "/api/index.ts",
      { api } = await import(/* @vite-ignore */ module);
    await api.invoke("session.send", { sessionId, text: "Update the plan" });
  }, sessionId);
  await expect
    .poll(async () => (await snapshot(page, { sessionId })).todos[0]?.text)
    .toBe("Board verification complete");
  await expect.poll(async () => (await snapshot(page, { sessionId })).status).toBe("idle");
  await expect(panel.getByRole("heading", { name: "Needs re-anchor", exact: true })).toBeVisible();
  await activate("Re-anchor");
  await dialog.getByRole("combobox", { name: "Step", exact: true }).focus();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await activate("Entire step");
  await activate("Save re-anchor");
  await expect(dialog).toHaveCount(0);
  await activate("Drafts: 1");
  await expect(panel.locator(".plan-feedback-text")).toHaveText("Edited 😀\nμ");
  await activate("Review plan");
  await expect
    .poll(async () => (await snapshot(page, { sessionId })).planReviews.at(-1)?.stopReason)
    .toBe("end");
  await activate("Previous reviews");
  await expect(panel.locator(".plan-review-history .plan-feedback-text")).toHaveText("Edited 😀\nμ");
  await activate("Previous reviews");
  await expect(rows).toHaveCount(1);
  await activate("Add comment to step 1");
  await input.focus();
  await input.pressSequentially("Delete only this draft");
  await activate("Save draft");
  await activate("Drafts: 1");
  await activate("Delete feedback");
  await expect.poll(async () => (await snapshot(page, { sessionId })).planComments.length).toBe(0);
  expect((await snapshot(page, { sessionId })).planReviews).toHaveLength(1);
});

test("Plan saved dialogs follow projection refresh and stale pointer capture requires explicit recapture", {
  tag: "@parallel-browser",
}, async ({ page, rendererUrl }) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1024, height: 640 });
  await page.goto(`${rendererUrl}/?mock=chat`);
  await page.locator('[data-i18n="nav.welcome"]').click();
  await page.locator('[data-action="choose-create"]').click();
  await page.locator('[data-action="create-workbench"]').click();
  await page.locator("[data-session]").filter({ hasText: "Plan feedback targets" }).click();
  await page.locator('[data-toggle="right"]').click();
  await page.locator("#tab-plan").click();
  await page.locator('[data-resize="right"]').focus();
  await page.keyboard.press("Home");
  // Supply a projected response and held refresh at the API seam. This proves browser
  // disclosure/interaction, not native host credential masking (covered separately).
  await page.evaluate(async () => {
    const module = "/api/index.ts",
      { api } = await import(/* @vite-ignore */ module);
    await api.updateSettings({ privacy: { mask: { agent: false } } });
    const invoke = api.invoke.bind(api),
      planAudit: Audit = [];
    let masked = false,
      held = Promise.resolve(),
      release = () => {};
    Object.assign(window, {
      planAudit,
      planRelease: () => release(),
      planRefresh: async (next: boolean, hold: boolean) => {
        masked = next;
        held = hold
          ? new Promise<void>((resolve) => {
              release = resolve;
            })
          : Promise.resolve();
        await api.updateSettings({ privacy: { mask: { agent: next } } });
      },
    });
    api.invoke = async (channel: string, request: unknown) => {
      planAudit.push({ channel, request: structuredClone(request) });
      if (channel === "session.get") {
        await held;
        const response = await invoke(channel, request);
        if (masked)
          response.snapshot.planComments = response.snapshot.planComments.map(
            (comment: { text: string }) => ({
              ...comment,
              text: comment.text.replaceAll("fake-secret", "[REDACTED]"),
            }),
          );
        return response;
      }
      return invoke(channel, request);
    };
  });
  const panel = page.locator("#panel-plan"),
    dialog = page.locator("dialog[open]"),
    input = dialog.getByRole("textbox", { name: "Feedback", exact: true });
  const refresh = (masked: boolean, hold = false) =>
    page.evaluate(
      async ({ masked, hold }) => {
        await (
          window as unknown as { planRefresh(masked: boolean, hold: boolean): Promise<void> }
        ).planRefresh(masked, hold);
      },
      { masked, hold },
    );
  const release = () => page.evaluate(() => (window as unknown as { planRelease(): void }).planRelease());
  await panel.getByRole("button", { name: "Add comment to step 2", exact: true }).click();
  await input.fill("fake-secret\n Vérifier 😀 ");
  await dialog.getByRole("button", { name: "Save draft", exact: true }).click();
  for (const action of ["Edit feedback", "Re-anchor"] as const) {
    if (action === "Re-anchor") {
      await refresh(false);
      await expect(panel.getByRole("button", { name: "Drafts: 1", exact: true })).toBeEnabled();
    }
    await panel.getByRole("button", { name: "Drafts: 1", exact: true }).click();
    await panel.getByRole("button", { name: action, exact: true }).click();
    await refresh(true, true);
    const save = dialog.getByRole("button", {
      name: action === "Re-anchor" ? "Save re-anchor" : "Save draft",
      exact: true,
    });
    await expect(save).toBeDisabled();
    await expect(dialog).not.toContainText("fake-secret");
    if (action === "Edit feedback") await expect(input).toHaveValue("");
    await release();
    if (action === "Edit feedback") {
      await expect(input).toHaveValue("[REDACTED]\n Vérifier 😀 ");
      await input.fill("Actual edit\n 😀 μC ");
      await refresh(false);
      await expect(input).toHaveValue("Actual edit\n 😀 μC ");
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    } else {
      await expect(dialog.locator(".plan-feedback-text")).toHaveText("[REDACTED]\n Vérifier 😀 ");
      await dialog.getByRole("button", { name: "Entire step", exact: true }).click();
      await save.click();
      const change = (await audit(page))
        .filter((entry) => entry.channel === "session.plan.comment.save")
        .at(-1)?.request;
      expect(change).toMatchObject({ action: "reanchor" });
      expect(change).not.toHaveProperty("text");
    }
  }
  await refresh(false);
  const row = panel.locator('.plan-tab > .plan-list > li[data-plan-step="1"]');
  await expect(row.locator(".plan-text")).toContainText("A😀B");
  await row.evaluate((node) => {
    const text = node.querySelector(".plan-text")?.firstChild;
    if (!text) throw Error("missing exact step text");
    window.getSelection()?.setBaseAndExtent(text, 3, text, 1);
    node.querySelector("button")?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    window.getSelection()?.removeAllRanges();
  });
  await refresh(true);
  const opener = panel.getByRole("button", { name: "Add comment to step 2", exact: true });
  await expect(opener).toBeEnabled();
  // No second pointer-down: click is the continuation of the captured activation.
  await opener.evaluate((node: HTMLButtonElement) => node.click());
  await input.fill("Pointer race\n 😀 ");
  await expect(dialog.locator("blockquote")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Save draft", exact: true })).toBeDisabled();
  const selector = dialog.getByRole("textbox", { name: "Step text", exact: true });
  await selector.focus();
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+ArrowRight");
  await dialog.getByRole("button", { name: "Use selected text", exact: true }).click();
  await expect(dialog.locator("blockquote")).toHaveText("😀");
  await dialog.getByRole("button", { name: "Save draft", exact: true }).click();
  const change = (await audit(page))
    .filter((entry) => entry.channel === "session.plan.comment.save")
    .at(-1)?.request;
  expect(change).toMatchObject({
    action: "create",
    text: "Pointer race\n 😀 ",
    target: { stepIndex: 1, range: { start: 1, end: 3, quote: "😀" } },
  });
  expect(errors).toEqual([]);
});
