// @vitest-environment jsdom
// REQ-UX-4bea0002 REQ-UX-2bbfd052
// PERF-07 (#255): the newest rows mount first, older rows are prepended in idle chunks.

import { emptySessionState, type SessionState } from "@vera/shared";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setAppAdvanced } from "../../hooks/app-advanced.js";
import i18n from "../../i18n.js";
import { Transcript } from "./transcript.js";

vi.mock("./markdown.js", async () => {
  const { memo } = await import("react");
  return {
    Markdown: memo(({ text }: { text: string }) => createElement("div", { className: "markdown" }, text)),
  };
});
vi.mock("../../api/index.js", () => ({ api: { invoke: vi.fn().mockResolvedValue({}) } }));
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

/** Idle callbacks run only when a test drains them. */
const idle = new Map<number, () => void>();
let handles = 0;
vi.stubGlobal("requestIdleCallback", (callback: () => void) => {
  idle.set(++handles, callback);
  return handles;
});
vi.stubGlobal("cancelIdleCallback", (handle: number) => idle.delete(handle));
/** The oldest pending idle callback, removed from the queue. */
function takeIdle() {
  const [handle, callback] = idle.entries().next().value ?? [];
  if (handle !== undefined) idle.delete(handle);
  return callback;
}

/** The viewport is 500 px high and every article 100 px, so scroll positions follow the mounted rows. */
const ROW = 100;
const VIEWPORT = 500;
const positions = new WeakMap<Element, number>();
const transcriptOf = (node: Element) => node.hasAttribute("data-transcript");
const height = (node: Element) => node.querySelectorAll("article").length * ROW;
const descriptors = {
  scrollHeight: Object.getOwnPropertyDescriptor(Element.prototype, "scrollHeight"),
  clientHeight: Object.getOwnPropertyDescriptor(Element.prototype, "clientHeight"),
  scrollTop: Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop"),
};

let root: Root;
let container: HTMLDivElement;
beforeEach(async () => {
  await i18n.changeLanguage("en");
  idle.clear();
  Object.defineProperty(Element.prototype, "scrollHeight", {
    configurable: true,
    get(this: Element) {
      return transcriptOf(this) ? height(this) : 0;
    },
  });
  Object.defineProperty(Element.prototype, "clientHeight", {
    configurable: true,
    get(this: Element) {
      return transcriptOf(this) ? VIEWPORT : 0;
    },
  });
  Object.defineProperty(Element.prototype, "scrollTop", {
    configurable: true,
    get(this: Element) {
      return positions.get(this) ?? 0;
    },
    set(this: Element, value: number) {
      positions.set(this, Math.max(0, Math.min(value, height(this) - VIEWPORT)));
    },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  for (const [name, descriptor] of Object.entries(descriptors))
    if (descriptor) Object.defineProperty(Element.prototype, name, descriptor);
});

/** `pairs` user/assistant exchanges, oldest first. */
function conversation(pairs: number): SessionState {
  const state = emptySessionState();
  for (let i = 0; i < pairs; i++)
    state.items.push(
      { kind: "user", id: `u${i}`, text: `question ${i}` },
      {
        kind: "assistant",
        id: `a${i}`,
        turnId: `t${i}`,
        text: `answer ${i}`,
        streaming: false,
        citations: [],
      },
    );
  return state;
}
async function render(state: SessionState, search = "") {
  await act(async () =>
    root.render(
      createElement(Transcript, {
        state,
        detail: "verbose",
        reasoning: {},
        updates: {},
        retry: () => {},
        search,
        sessionId: "session",
      }),
    ),
  );
}
const articles = () => container.querySelectorAll("article");
const viewport = () => container.querySelector("[data-transcript]") as HTMLElement;
/** Runs pending idle callbacks, and the ones their commits schedule, until none is left. */
async function drainIdle() {
  for (let callback = takeIdle(); callback; callback = takeIdle()) await act(async () => callback());
}

it("mounts the newest 40 rows first and the rest in idle chunks, keeping the end in view", async () => {
  await render(conversation(1000));
  expect(articles()).toHaveLength(40);
  expect(articles()[39]?.textContent).toContain("answer 999");
  expect(viewport().scrollTop).toBe(40 * ROW - VIEWPORT);
  const first = takeIdle();
  await act(async () => first?.());
  expect(articles()).toHaveLength(140);
  expect(viewport().scrollTop).toBe(140 * ROW - VIEWPORT);
  await drainIdle();
  expect(articles()).toHaveLength(2000);
  expect(articles()[0]?.textContent).toContain("question 0");
  expect(viewport().scrollTop).toBe(2000 * ROW - VIEWPORT);
}, 15000);

it("mounts a short session at once and keeps rows that arrive later", async () => {
  const state = conversation(10);
  await render(state);
  expect(articles()).toHaveLength(20);
  await drainIdle();
  const longer = {
    ...state,
    items: [...state.items, ...conversation(30).items.map((item) => ({ ...item, id: `n${item.id}` }))],
  };
  await render(longer);
  expect(articles()).toHaveLength(80);
});

it("keeps the newest rows shown when a chat detail change leaves fewer rows", async () => {
  await render(conversation(1000));
  const shorter = { ...conversation(10), items: conversation(1000).items.slice(-20) };
  await render(shorter);
  expect(articles()).toHaveLength(20);
});

it("does not pull a reader who scrolled up to the end when a chunk is prepended", async () => {
  await render(conversation(1000));
  const node = viewport();
  node.scrollTop = 2000;
  await act(async () => node.dispatchEvent(new Event("scroll")));
  // Chromium's scroll anchoring moves the position by the prepended height; jsdom does not.
  const first = takeIdle();
  await act(async () => first?.());
  expect(articles()).toHaveLength(140);
  expect(node.scrollTop).toBe(2000);
});

it("mounts every row for a search, so the oldest match is outlined", async () => {
  await render(conversation(1000), "question 0");
  expect(articles()).toHaveLength(2000);
  expect(container.querySelector("[data-search-match=true]")?.textContent).toContain("question 0");
  await render(conversation(1000), "");
  expect(articles()).toHaveLength(2000);
}, 15000);

it("mounts the rest at once when the reader reaches the top, and Ctrl+Home lands on the first message", async () => {
  await render(conversation(1000));
  const node = viewport();
  node.scrollTop = 0;
  await act(async () => node.dispatchEvent(new Event("scroll")));
  expect(articles()).toHaveLength(2000);
  expect(node.scrollTop).toBe(0);
  expect(articles()[0]?.textContent).toContain("question 0");
});

it("cancels pending idle work on unmount", async () => {
  const cancel = vi.spyOn(globalThis, "cancelIdleCallback");
  await render(conversation(1000));
  await act(async () => root.unmount());
  expect(cancel).toHaveBeenCalled();
  root = createRoot(container);
});
// REQ-UX-a4cf0527
it("mounts the resolved first rows and chunk size, read when the session is shown", async () => {
  setAppAdvanced({ transcriptRows: 20, transcriptChunkRows: 50 });
  try {
    await render(conversation(150));
    expect(articles()).toHaveLength(20);
    // A change while the session is shown applies to the next session shown, not to this one.
    setAppAdvanced({ transcriptRows: 20, transcriptChunkRows: 500 });
    const first = takeIdle();
    await act(async () => first?.());
    expect(articles()).toHaveLength(70);
    const second = takeIdle();
    await act(async () => second?.());
    expect(articles()).toHaveLength(120);
  } finally {
    setAppAdvanced(undefined);
  }
});
