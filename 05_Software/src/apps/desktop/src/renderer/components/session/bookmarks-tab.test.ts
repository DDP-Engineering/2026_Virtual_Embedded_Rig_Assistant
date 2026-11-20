// @vitest-environment jsdom
// REQ-UX-8a37ed29 REQ-UX-53130782 REQ-FUNC-10d85a47 REQ-UX-dc45c39a REQ-FUNC-d65a3585 REQ-SEC-8c0cc59a REQ-REL-2b8d452f
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { foldSessionEvents, type SessionEvent, veraError } from "@vera/shared";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "../../api/index.js";
import i18n from "../../i18n.js";
import { BookmarksTab } from "./bookmarks-tab.js";
import { SessionBookmarksProvider, useBookmarkJump, useSessionBookmarks } from "./session-bookmarks.js";

vi.mock("../../api/index.js", () => ({ api: { invoke: vi.fn(), subscribe: vi.fn() } }));
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const A = "ses_00000000000000000000000001";
const B = "ses_00000000000000000000000002";
const events: SessionEvent[] = [
  { type: "message.user", messageId: "u1", text: "How is the UART wired?" },
  { type: "message.done", messageId: "a1", text: "TX goes to PA9 and RX to PA10.", citations: [] },
  { type: "message.user", messageId: "u2", text: "Which clock feeds the timer?" },
  { type: "message.done", messageId: "a2", text: "The HSE oscillator.", citations: [] },
  { type: "message.user", messageId: "u3", text: "Check the brown-out level" },
  // Bookmarked out of conversation order.
  { type: "message.bookmarked", messageId: "u3", bookmarked: true },
  { type: "message.bookmarked", messageId: "u1", bookmarked: true },
  { type: "message.bookmarked", messageId: "u2", bookmarked: true },
];
const other: SessionEvent[] = [
  { type: "message.user", messageId: "b1", text: "Another session question" },
  { type: "message.bookmarked", messageId: "b1", bookmarked: true },
];
let root: Root;
let container: HTMLDivElement;
let notify: ((event: SessionEvent) => void) | undefined;
let removal: (input: unknown) => Promise<unknown>;
const removals = () =>
  vi.mocked(api.invoke).mock.calls.filter(([channel]) => channel === "session.bookmarks.remove");

beforeEach(async () => {
  await i18n.changeLanguage("en");
  removal = async () => ({});
  vi.mocked(api.invoke).mockImplementation((async (channel: string, input: unknown) => {
    if (channel === "session.bookmarks.remove") return removal(input);
    const id = (input as { sessionId: string }).sessionId;
    return { snapshot: foldSessionEvents(id === A ? events : other), seq: 10 };
  }) as typeof api.invoke);
  vi.mocked(api.subscribe).mockImplementation(((...args: unknown[]) => {
    notify = args[3] as (event: SessionEvent) => void;
    return () => {};
  }) as typeof api.subscribe);
  // jsdom has no modal dialogs.
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.open = false;
  };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
});
async function render(sessionId = A, locked = { readOnly: false, archived: false }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    root.render(
      createElement(QueryClientProvider, { client }, createElement(BookmarksTab, { sessionId, ...locked })),
    ),
  );
  await act(async () => new Promise((done) => setTimeout(done, 10)));
}
/** Another reader of the shared state, as the message buttons and rail markers are. */
function Probe() {
  const bookmarks = useSessionBookmarks(A, [], false);
  const { jump } = useBookmarkJump(A);
  return createElement(
    "output",
    { "data-probe": "" },
    `${["u1", "u2", "u3"].filter((id) => bookmarks.has(id)).join(",")}|${jump?.id ?? ""}`,
  );
}
async function renderShared(locked = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(
          SessionBookmarksProvider,
          // Children follow as arguments; the props type names them as required.
          { sessionId: A, disabled: locked } as Parameters<typeof SessionBookmarksProvider>[0],
          createElement(BookmarksTab, { sessionId: A, readOnly: locked, archived: false }),
          createElement(Probe),
        ),
      ),
    ),
  );
  await act(async () => new Promise((done) => setTimeout(done, 10)));
}
const probe = () => container.querySelector("[data-probe]")?.textContent;
const rows = () =>
  [...container.querySelectorAll<HTMLButtonElement>("[data-bookmark-row]")].map((b) => b.dataset.bookmarkRow);
const count = () => container.querySelector("[data-bookmarks-count]")?.textContent;
const filter = async (text: string) => {
  const input = container.querySelector<HTMLInputElement>("[data-bookmarks-filter]") as HTMLInputElement;
  await act(async () => {
    await userEvent.setup().clear(input);
    if (text) await userEvent.setup().type(input, text);
  });
};
const click = async (selector: string) => {
  const node = container.querySelector<HTMLElement>(selector);
  expect(node, selector).not.toBeNull();
  await act(async () => userEvent.setup().click(node as HTMLElement));
};

it("lists bookmarks in conversation order with previews, filters message and reply text and counts matches", async () => {
  await render();
  expect(rows()).toEqual(["u1", "u2", "u3"]);
  expect(container.querySelector('[data-bookmark-id="u1"] .bookmark-text')?.textContent).toBe(
    "How is the UART wired?",
  );
  expect(container.querySelector('[data-bookmark-id="u1"] .bookmark-reply')?.textContent).toBe(
    "TX goes to PA9 and RX to PA10.",
  );
  expect(container.querySelector('[data-bookmark-id="u3"] .bookmark-reply')).toBeNull();
  expect(count()).toBe("Bookmarks: 3");
  // RULING-001: the reply excerpt is searched too, case-insensitively.
  await filter("hse");
  expect(rows()).toEqual(["u2"]);
  expect(count()).toBe("Bookmarks: 1 of 3");
  await filter("BROWN");
  expect(rows()).toEqual(["u3"]);
  await filter("nothing like this");
  expect(rows()).toEqual([]);
  expect(container.querySelector("[data-bookmarks-no-matches]")).not.toBeNull();
  expect(container.querySelector("[data-bookmarks-empty]")).toBeNull();
  await act(async () => notify?.({ type: "message.bookmarked", messageId: "u1", bookmarked: false }));
  await act(async () => notify?.({ type: "message.bookmarked", messageId: "u2", bookmarked: false }));
  await act(async () => notify?.({ type: "message.bookmarked", messageId: "u3", bookmarked: false }));
  expect(container.querySelector("[data-bookmarks-empty]")).not.toBeNull();
  expect(container.querySelector("[data-bookmarks-no-matches]")).toBeNull();
});

it("moves between rows with the arrow keys and names each row", async () => {
  await render();
  const first = container.querySelector<HTMLButtonElement>('[data-bookmark-row="u1"]') as HTMLButtonElement;
  expect(first.getAttribute("aria-label")).toBe("Go to message 1: How is the UART wired?");
  first.focus();
  await act(async () => userEvent.setup().keyboard("{ArrowDown}"));
  expect(document.activeElement?.getAttribute("data-bookmark-row")).toBe("u2");
  await act(async () => userEvent.setup().keyboard("{End}"));
  expect(document.activeElement?.getAttribute("data-bookmark-row")).toBe("u3");
  await act(async () => userEvent.setup().keyboard("{Home}"));
  expect(document.activeElement?.getAttribute("data-bookmark-row")).toBe("u1");
});

it("selects all filtered rows and removes exactly those in one request", async () => {
  await render();
  await filter("ch");
  expect(rows()).toEqual(["u2", "u3"]);
  await click('[data-action="bookmarks-select-all"]');
  await filter("");
  expect(
    [...container.querySelectorAll<HTMLInputElement>("[data-bookmark-select]")]
      .filter((box) => box.checked)
      .map((box) => box.dataset.bookmarkSelect),
  ).toEqual(["u2", "u3"]);
  await click('[data-action="bookmarks-remove-selected"]');
  expect(removals()).toEqual([["session.bookmarks.remove", { sessionId: A, messageIds: ["u2", "u3"] }]]);
  expect(rows()).toEqual(["u1"]);
  await click('[data-bookmark-remove="u1"]');
  expect(removals().at(-1)).toEqual(["session.bookmarks.remove", { sessionId: A, messageIds: ["u1"] }]);
});

it("restores every row and shows the error when a removal fails", async () => {
  removal = async () => {
    throw veraError("DENIED");
  };
  await render();
  await click('[data-action="bookmarks-select-all"]');
  await click('[data-action="bookmarks-remove-selected"]');
  expect(removals()).toHaveLength(1);
  expect(rows()).toEqual(["u1", "u2", "u3"]);
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
});

it("clears every bookmark of the session only after confirmation, whatever the filter shows", async () => {
  await render();
  await filter("uart");
  expect(rows()).toEqual(["u1"]);
  await click('[data-action="bookmarks-clear-all"]');
  expect(container.querySelector("dialog")?.textContent).toContain(
    "Remove every bookmark from this conversation (3)?",
  );
  await click("dialog button:not([data-action])");
  expect(removals()).toHaveLength(0);
  expect(container.querySelector("dialog")).toBeNull();
  await click('[data-action="bookmarks-clear-all"]');
  await click('[data-action="confirm-clear-bookmarks"]');
  expect(removals()).toEqual([["session.bookmarks.remove", { sessionId: A, all: true }]]);
  await filter("");
  expect(rows()).toEqual([]);
});

it("offers browsing and filtering but no removal in archived sessions and read-only workbenches", async () => {
  for (const locked of [
    { readOnly: true, archived: false },
    { readOnly: false, archived: true },
  ]) {
    await render(A, locked);
    expect(rows()).toEqual(["u1", "u2", "u3"]);
    for (const selector of [
      "[data-bookmark-select]",
      "[data-bookmark-remove]",
      '[data-action="bookmarks-select-all"]',
      '[data-action="bookmarks-remove-selected"]',
      '[data-action="bookmarks-clear-all"]',
    ])
      expect(container.querySelector(selector), selector).toBeNull();
    await filter("timer");
    expect(rows()).toEqual(["u2"]);
    await filter("");
  }
});

it("keeps every bookmark in the shared state when a removal fails", async () => {
  let fail: () => void = () => {};
  removal = () =>
    new Promise((_, reject) => {
      fail = () => reject(veraError("DENIED"));
    });
  await renderShared();
  expect(probe()).toBe("u1,u2,u3|");
  await click('[data-action="bookmarks-select-all"]');
  await click('[data-action="bookmarks-remove-selected"]');
  // Hidden at once for every reader while the request runs.
  expect(probe()).toBe("|");
  expect(rows()).toEqual([]);
  await act(async () => fail());
  expect(probe()).toBe("u1,u2,u3|");
  expect(rows()).toEqual(["u1", "u2", "u3"]);
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
});

it("jumps from a row in a read-only or archived session", async () => {
  await renderShared(true);
  expect(container.querySelector("[data-bookmark-remove]")).toBeNull();
  await click('[data-bookmark-row="u2"]');
  expect(probe()).toBe("u1,u2,u3|u2");
});

it("keeps no rows, filter or selection from another session", async () => {
  await render(A);
  await filter("uart");
  await click('[data-action="bookmarks-select-all"]');
  await render(B);
  expect(rows()).toEqual(["b1"]);
  expect(container.querySelector<HTMLInputElement>("[data-bookmarks-filter]")?.value).toBe("");
  expect(container.querySelector<HTMLInputElement>('[data-action="bookmarks-select-all"]')?.checked).toBe(
    false,
  );
  expect(container.querySelector<HTMLInputElement>('[data-bookmark-select="b1"]')?.checked).toBe(false);
});
