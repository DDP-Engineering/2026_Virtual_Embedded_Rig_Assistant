// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import "../i18n.js";
import { Pager, usePaged } from "./pager.js";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
let root: Root | undefined;
let container: HTMLDivElement;
afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
});

function List({ count }: { count: number }) {
  const { rows, pager } = usePaged(Array.from({ length: count }, (_, index) => `row ${index + 1}`));
  return createElement(
    "div",
    null,
    createElement("ul", null, ...rows.map((row) => createElement("li", { key: row }, row))),
    createElement(Pager, pager),
  );
}
async function mount(count: number) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(createElement(List, { count })));
}
const rows = () => [...container.querySelectorAll("li")].map((li) => li.textContent);

it("hides the pager for ten rows or fewer", async () => {
  await mount(10);
  expect(rows()).toHaveLength(10);
  expect(container.querySelector("[data-pager]")).toBeNull();
});

it("pages through rows and returns to page one when the page size changes", async () => {
  await mount(25);
  expect(rows()).toEqual(Array.from({ length: 10 }, (_, index) => `row ${index + 1}`));
  const next = container.querySelector<HTMLButtonElement>("[data-pager-next]");
  await act(async () => next?.click());
  expect(rows()[0]).toBe("row 11");
  await act(async () => container.querySelector<HTMLButtonElement>("[data-pager-next]")?.click());
  expect(rows()).toEqual(["row 21", "row 22", "row 23", "row 24", "row 25"]);
  expect(container.querySelector<HTMLButtonElement>("[data-pager-next]")?.disabled).toBe(true);
  const size = container.querySelector<HTMLSelectElement>("[data-pager-size]");
  await act(async () => {
    if (!size) return;
    size.value = "50";
    size.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(rows()).toHaveLength(25);
  expect(container.querySelector<HTMLButtonElement>("[data-pager-previous]")?.disabled).toBe(true);
});
