import { expect, test } from "./fixtures.js";

const original = "A\r\n😀B\rtail";
test("Plan fragments preserve source line endings through native keyboard and DOM pointer selections", {
  tag: "@parallel-browser",
}, async ({ page, context, rendererUrl }) => {
  await context.route("**/mocks/session-fixtures.ts*", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `export const sessionFixtures = ${JSON.stringify([{ title: "Plan line endings", events: [{ type: "todo.updated", items: [{ text: original, status: "pending" }] }] }])};`,
    }),
  );
  await page.goto(`${rendererUrl}/?mock=chat`);
  await page.locator('[data-i18n="nav.welcome"]').click();
  await page.locator('[data-action="choose-create"]').click();
  await page.locator('[data-action="create-workbench"]').click();
  const selected = page.locator("[data-session]").filter({ hasText: "Plan line endings" });
  await selected.click();
  const sessionId = await selected.getAttribute("data-session");
  if (!sessionId) throw Error("missing session");
  await page.locator('[data-toggle="right"]').click();
  await page.locator("#tab-plan").click();
  const panel = page.locator("#panel-plan"),
    dialog = page.locator("dialog[open]"),
    add = panel.getByRole("button", { name: "Add comment to step 1", exact: true });
  const snapshot = () =>
    page.evaluate(async (sessionId) => {
      const module = "/api/index.ts",
        { api } = await import(/* @vite-ignore */ module);
      return (await api.invoke("session.get", { sessionId })).snapshot;
    }, sessionId);
  const save = async (text: string) => {
    await dialog.getByRole("textbox", { name: "Feedback", exact: true }).fill(text);
    await dialog.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(dialog).toHaveCount(0);
  };
  await add.focus();
  await page.keyboard.press("Enter");
  const selector = dialog.getByRole("textbox", { name: "Step text", exact: true });
  await expect(selector).toHaveValue("A\n😀B\ntail");
  await selector.focus();
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Shift+ArrowRight");
  expect(
    await selector.evaluate((node: HTMLTextAreaElement) => [node.selectionStart, node.selectionEnd]),
  ).toEqual([2, 4]);
  await dialog.getByRole("button", { name: "Use selected text", exact: true }).click();
  await save("Native emoji");
  expect((await snapshot()).planComments[0]?.target).toEqual({
    revision: 1,
    stepIndex: 0,
    stepText: original,
    range: { start: 3, end: 5, quote: "😀" },
  });
  await add.click();
  await selector.focus();
  await page.keyboard.press("Control+A");
  await dialog.getByRole("button", { name: "Use selected text", exact: true }).click();
  await save("Native full text");
  const fullRange = { start: 0, end: original.length, quote: original };
  expect((await snapshot()).planComments[1]?.target.range).toEqual(fullRange);
  await panel.locator(".plan-text").evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await add.click();
  expect(await dialog.locator("blockquote").textContent()).toBe(original);
  await save("Pointer full text");
  const state = await snapshot();
  expect(state.planComments[2]?.target.range).toEqual(fullRange);
  expect(state.planRevision).toBe(1);
  expect(state.items).toEqual([]);
  expect(state.approvals).toEqual([]);
  expect(state.changes).toEqual([]);
});
