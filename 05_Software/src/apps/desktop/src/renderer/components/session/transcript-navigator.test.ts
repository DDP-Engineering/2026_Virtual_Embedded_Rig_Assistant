// @vitest-environment jsdom
// REQ-UX-b2f6ffa8 REQ-UX-2bbfd052 REQ-UX-a3be2b11 REQ-UX-7b49305a REQ-UX-958b58c2 REQ-FUNC-1219a1e4 REQ-REL-47308c01 REQ-REL-c8ac2ecc

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { emptySessionState, type SessionState } from "@vera/shared";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import i18n from "../../i18n.js";
import { Transcript } from "./transcript.js";
import { type NavigatorMessage, TranscriptNavigator } from "./transcript-navigator.js";

vi.mock("../../api/index.js", () => ({ api: { invoke: vi.fn().mockResolvedValue({}) } }));
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
const frames = new Map<number, FrameRequestCallback>();
let frameNumber = 0;
const resizeObservers: { disconnect: ReturnType<typeof vi.fn> }[] = [];
class FakeResizeObserver {
  observe = vi.fn();
  disconnect = vi.fn();
  constructor(readonly callback: () => void) {
    resizeObservers.push(this);
  }
}
let root: Root | undefined;
let container: HTMLDivElement;
const restore: (() => void)[] = [];
const rect = (top: number) =>
  ({ top, bottom: top, left: 0, right: 0, width: 0, height: 0, x: 0, y: top }) as DOMRect;
const flushFrames = () =>
  act(async () => {
    const pending = [...frames.values()];
    frames.clear();
    for (const callback of pending) callback(0);
  });
beforeEach(async () => {
  await i18n.changeLanguage("en");
  frames.clear();
  resizeObservers.length = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++frameNumber, callback);
    return frameNumber;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  for (const undo of restore.splice(0)) undo();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
/** A viewport whose geometry is set per element: jsdom has no layout. */
function geometry(starts: readonly number[], scrollHeight = 4000, clientHeight = 400) {
  const viewport = document.createElement("div");
  const content = document.createElement("div");
  viewport.append(content);
  let top = 0;
  Object.defineProperties(viewport, {
    scrollHeight: { get: () => scrollHeight },
    clientHeight: { get: () => clientHeight },
    clientTop: { get: () => 0 },
    scrollTop: { get: () => top, set: (value: number) => (top = value) },
  });
  viewport.getBoundingClientRect = () => rect(0);
  const anchors = new Map<string, HTMLElement>();
  const reads = { count: 0 };
  starts.forEach((y, index) => {
    const article = document.createElement("article");
    article.getBoundingClientRect = () => {
      reads.count += 1;
      return rect(y - top);
    };
    content.append(article);
    anchors.set(`m${index}`, article);
  });
  document.body.append(viewport);
  return { viewport, content, anchors, reads };
}
const texts = (count: number, text = (index: number) => `Question ${index + 1}`): NavigatorMessage[] =>
  Array.from({ length: count }, (_, index) => ({ id: `m${index}`, text: text(index), pending: false }));
async function navigator(
  starts: readonly number[],
  messages = texts(starts.length),
  onNavigate = vi.fn(() => true),
  scrollHeight = 4000,
) {
  const { viewport, content, anchors, reads } = geometry(starts, scrollHeight);
  const render = async (next: readonly NavigatorMessage[]) => {
    await act(async () =>
      root?.render(
        createElement(TranscriptNavigator, {
          viewport: { current: viewport },
          content: { current: content },
          anchors,
          messages: next,
          controls: "transcript",
          onNavigate,
        }),
      ),
    );
    await flushFrames();
  };
  await render(messages);
  return { viewport, content, onNavigate, render, reads };
}
const markers = () => [...container.querySelectorAll<HTMLButtonElement>("[role=toolbar] > button")];
const status = () => container.querySelector('[role="status"]')?.textContent?.trim();

it("hides the navigator without overflow and without user messages", async () => {
  await navigator([0, 100], undefined, undefined, 400);
  expect(container.querySelector("[role=toolbar]")).toBeNull();
  await navigator([], []);
  expect(container.querySelector("[role=toolbar]")).toBeNull();
});

it("keeps one Tab stop, moves focus with arrows, Home and End, and navigates only on activation", async () => {
  const user = userEvent.setup();
  const { viewport, onNavigate } = await navigator([0, 1000, 2000, 3000]);
  const toolbar = container.querySelector("[role=toolbar]");
  expect(toolbar?.getAttribute("aria-label")).toBe("Your messages");
  expect(toolbar?.getAttribute("aria-orientation")).toBe("vertical");
  expect(markers().map((marker) => marker.getAttribute("aria-label"))).toEqual([
    "Message 1",
    "Message 2",
    "Message 3",
    "Message 4",
  ]);
  expect(markers().filter((marker) => marker.tabIndex === 0)).toHaveLength(1);
  expect(markers()[0]?.getAttribute("aria-current")).toBe("location");
  const tops = markers().map((marker) => Number.parseFloat(marker.style.top));
  expect(tops).toEqual([...tops].sort((a, b) => a - b));
  await user.tab();
  expect(document.activeElement).toBe(markers()[0]);
  await user.keyboard("{ArrowDown}");
  expect(document.activeElement).toBe(markers()[1]);
  expect(markers()[1]?.tabIndex).toBe(0);
  expect(markers()[0]?.tabIndex).toBe(-1);
  await user.keyboard("{End}");
  expect(document.activeElement).toBe(markers()[3]);
  await user.keyboard("{ArrowDown}");
  expect(document.activeElement).toBe(markers()[3]);
  await user.keyboard("{Home}");
  expect(document.activeElement).toBe(markers()[0]);
  await user.keyboard("{ArrowUp}");
  expect(document.activeElement).toBe(markers()[0]);
  expect(onNavigate).not.toHaveBeenCalled();
  await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");
  expect(onNavigate).toHaveBeenCalledWith("m2");
  expect(document.activeElement).toBe(markers()[2]);
  expect(status()).toBe("Moved to message 3");
  await user.keyboard(" ");
  expect(onNavigate).toHaveBeenCalledTimes(2);
  viewport.scrollTop = 1500;
  await act(async () => viewport.dispatchEvent(new Event("scroll")));
  expect(markers().map((marker) => marker.getAttribute("aria-current"))).toEqual([
    null,
    "location",
    null,
    null,
  ]);
});

it("previews plain normalized text on focus, labels empty and pending messages, and closes with Escape", async () => {
  const user = userEvent.setup();
  const messages = texts(
    4,
    (index) => ["  <b>Hello</b>\n\n world  ", " ", "Queued", "x".repeat(200)][index] ?? "",
  );
  const pending = messages.map((message) => (message.id === "m2" ? { ...message, pending: true } : message));
  const { render } = await navigator([0, 1000, 2000, 3000], pending);
  await user.tab();
  const tooltip = () => container.querySelector('[role="tooltip"]');
  expect(tooltip()?.textContent).toBe("Message 1 — <b>Hello</b> world");
  expect(tooltip()?.querySelector("b")).toBeNull();
  expect(markers()[0]?.getAttribute("aria-describedby")).toBe(tooltip()?.id);
  await user.keyboard("{Escape}");
  expect(tooltip()).toBeNull();
  await user.keyboard("{ArrowDown}");
  expect(tooltip()?.textContent).toBe("Message 2 — Empty message");
  await user.keyboard("{ArrowDown}");
  expect(tooltip()?.textContent).toBe("Message 3 — Pending delivery — Queued");
  await render(messages);
  expect(markers()).toHaveLength(4);
  expect(tooltip()?.textContent).toBe("Message 3 — Queued");
  await user.keyboard("{ArrowDown}");
  expect(tooltip()?.textContent).toBe(`Message 4 — ${"x".repeat(140)}…`);
  await user.hover(markers()[1] as HTMLElement);
  expect(tooltip()?.textContent).toContain("Message 2");
  await user.keyboard("{Escape}");
  expect(tooltip()).toBeNull();
});

it("opens a group selector, navigates to the exact member and restores focus to the group", async () => {
  const user = userEvent.setup();
  const { onNavigate } = await navigator([0, 1000, 1010, 1020, 3000]);
  expect(markers()).toHaveLength(3);
  const group = markers()[1] as HTMLButtonElement;
  expect(group.getAttribute("aria-label")).toBe("Messages 2–4 (3)");
  expect(group.getAttribute("aria-expanded")).toBe("false");
  expect(group.textContent).toBe("3");
  const selector = () => container.querySelector<HTMLElement>("[data-nav-selector]");
  const entries = () => [...(selector()?.querySelectorAll("button") ?? [])];
  await user.click(group);
  expect(group.getAttribute("aria-expanded")).toBe("true");
  expect(group.getAttribute("aria-controls")).toBe(selector()?.id);
  expect(selector()?.tagName).toBe("FIELDSET");
  expect(selector()?.querySelector("legend")?.textContent).toBe("Messages 2–4 (3)");
  expect(entries().map((entry) => entry.textContent)).toEqual([
    "Message 2 — Question 2",
    "Message 3 — Question 3",
    "Message 4 — Question 4",
  ]);
  expect(document.activeElement).toBe(entries()[0]);
  await user.keyboard("{ArrowDown}");
  expect(document.activeElement).toBe(entries()[1]);
  await user.keyboard("{Escape}");
  expect(selector()).toBeNull();
  expect(document.activeElement).toBe(group);
  expect(onNavigate).not.toHaveBeenCalled();
  await user.click(group);
  await user.click(entries()[1] as HTMLElement);
  expect(onNavigate).toHaveBeenCalledWith("m2");
  expect(selector()).toBeNull();
  expect(document.activeElement).toBe(group);
  expect(status()).toBe("Moved to message 3");
  await user.click(group);
  await user.click(document.body);
  expect(selector()).toBeNull();
  await user.click(group);
  await user.click(selector()?.querySelector("legend") as HTMLElement);
  expect(selector()).not.toBeNull();
  await user.keyboard("{End}");
  expect(document.activeElement).toBe(entries()[2]);
  await user.tab();
  expect(selector()).toBeNull();
  expect(onNavigate).toHaveBeenCalledTimes(1);
  await user.hover(group);
  expect(container.querySelector('[role="tooltip"]')?.textContent).toBe("Messages 2–4 (3)");
  expect(group.hasAttribute("aria-describedby")).toBe(false);
});

it("forwards the wheel from markers to the conversation but lets the open selector scroll on its own", async () => {
  const user = userEvent.setup();
  const { viewport } = await navigator([0, 1000, 1010, 1020, 3000]);
  const wheel = (target: Element | undefined, init: WheelEventInit = {}) =>
    act(async () => {
      target?.dispatchEvent(
        new WheelEvent("wheel", { deltaY: 120, bubbles: true, cancelable: true, ...init }),
      );
    });
  await wheel(markers()[0]);
  expect(viewport.scrollTop).toBe(120);
  await wheel(markers()[0], { ctrlKey: true });
  expect(viewport.scrollTop).toBe(120);
  await user.click(markers()[1] as HTMLElement);
  const entry = container.querySelector("[data-nav-selector] button") ?? undefined;
  expect(entry).toBeDefined();
  await wheel(entry);
  expect(viewport.scrollTop).toBe(120);
});

it("consumes Escape only while a preview is open, so other Escape shortcuts still work", async () => {
  const user = userEvent.setup();
  await navigator([0, 1000, 2000, 3000]);
  const pressEscape = async () => {
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    await act(async () => document.body.dispatchEvent(event));
    return event.defaultPrevented;
  };
  await user.hover(markers()[1] as HTMLElement);
  expect(container.querySelector('[role="tooltip"]')).not.toBeNull();
  expect(await pressEscape()).toBe(true);
  expect(container.querySelector('[role="tooltip"]')).toBeNull();
  expect(await pressEscape()).toBe(false);
});

it("reaches every one of 500 messages through markers and groups", async () => {
  const user = userEvent.setup();
  const starts = Array.from({ length: 500 }, (_, index) => index * 8);
  const { onNavigate } = await navigator(starts, texts(500));
  const tops = markers().map((marker) => Number.parseFloat(marker.style.top));
  expect(tops.every((top, index) => index === 0 || top - (tops[index - 1] ?? 0) >= 24)).toBe(true);
  let reached = 0;
  for (const marker of markers()) {
    if (marker.getAttribute("aria-expanded") === null) {
      reached += 1;
      continue;
    }
    await user.click(marker);
    reached += container.querySelectorAll("[data-nav-selector] button").length;
    await user.keyboard("{Escape}");
  }
  expect(reached).toBe(500);
  expect(onNavigate).not.toHaveBeenCalled();
});

it("measures once per frame on invalidation, reuses positions on scroll and cleans up on unmount", async () => {
  const fonts = new EventTarget();
  Object.defineProperty(document, "fonts", { value: fonts, configurable: true });
  restore.push(() => Reflect.deleteProperty(document, "fonts"));
  const { viewport, content, reads } = await navigator([0, 1000, 2000, 3000]);
  expect(reads.count).toBe(4);
  content.firstElementChild?.dispatchEvent(new Event("load"));
  fonts.dispatchEvent(new Event("loadingdone"));
  expect(frames.size).toBe(1);
  await flushFrames();
  expect(reads.count).toBe(8);
  viewport.scrollTop = 2100;
  await act(async () => viewport.dispatchEvent(new Event("scroll")));
  expect(markers()[2]?.getAttribute("aria-current")).toBe("location");
  expect(reads.count).toBe(8);
  window.dispatchEvent(new Event("resize"));
  window.dispatchEvent(new Event("resize"));
  expect(frames.size).toBe(1);
  await flushFrames();
  expect(frames.size).toBe(0);
  expect(reads.count).toBe(12);
  window.dispatchEvent(new Event("resize"));
  expect(frames.size).toBe(1);
  vi.useFakeTimers();
  await act(async () => markers()[0]?.dispatchEvent(new MouseEvent("pointerover", { bubbles: true })));
  await act(async () =>
    markers()[0]?.dispatchEvent(
      new MouseEvent("pointerout", { bubbles: true, relatedTarget: document.body }),
    ),
  );
  expect(vi.getTimerCount()).toBeGreaterThan(0);
  const disconnect = vi.spyOn(MutationObserver.prototype, "disconnect");
  await act(async () => root?.unmount());
  root = undefined;
  expect(frames.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  expect(disconnect).toHaveBeenCalled();
  expect(resizeObservers.every((observer) => observer.disconnect.mock.calls.length > 0)).toBe(true);
  window.dispatchEvent(new Event("resize"));
  fonts.dispatchEvent(new Event("loadingdone"));
  content.firstElementChild?.dispatchEvent(new Event("load"));
  viewport.dispatchEvent(new Event("scroll"));
  expect(frames.size).toBe(0);
  expect(reads.count).toBe(12);
});

const conversation = (count: number): SessionState => ({
  ...emptySessionState(),
  items: Array.from({ length: count }, (_, index) => [
    { kind: "user" as const, id: `u${index}`, text: `Question ${index + 1}` },
    {
      kind: "assistant" as const,
      id: `a${index}`,
      turnId: `t${index}`,
      text: `Answer ${index + 1}`,
      streaming: false,
      citations: [],
    },
  ]).flat(),
});
/** Layout for a whole Transcript: user articles start 1000 px apart in a 4000 px conversation. */
function transcriptGeometry() {
  const scrollTops = new WeakMap<Element, number>();
  const viewportOnly = (value: number) =>
    function (this: HTMLElement) {
      return this.hasAttribute("data-transcript") ? value : 0;
    };
  const stubs: Record<string, PropertyDescriptor> = {
    scrollHeight: { get: viewportOnly(4000) },
    clientHeight: { get: viewportOnly(400) },
    scrollTop: {
      get(this: HTMLElement) {
        return scrollTops.get(this) ?? 0;
      },
      set(this: HTMLElement, value: number) {
        scrollTops.set(this, value);
      },
    },
    getBoundingClientRect: {
      value(this: HTMLElement) {
        const viewport = this.closest<HTMLElement>("[data-transcript]");
        const index = [...document.querySelectorAll('[data-message-kind="user"]')].indexOf(this);
        return rect(index < 0 || !viewport ? 0 : index * 1000 - (scrollTops.get(viewport) ?? 0));
      },
    },
  };
  for (const [name, descriptor] of Object.entries(stubs))
    Object.defineProperty(HTMLElement.prototype, name, { ...descriptor, configurable: true });
  restore.push(() => {
    for (const name of Object.keys(stubs)) Reflect.deleteProperty(HTMLElement.prototype, name);
  });
  return () => document.querySelector<HTMLElement>("[data-transcript]");
}

const client = new QueryClient();
const renderTranscript = async (state: SessionState, sessionId: string) => {
  await act(async () =>
    root?.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(Transcript, {
          state,
          reasoning: {},
          updates: {},
          retry: vi.fn(),
          search: "",
          sessionId,
        }),
      ),
    ),
  );
  await flushFrames();
};

it("jumps near the top, highlights briefly, keeps auto-follow suspended until an explicit return and resets per session", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const transcript = transcriptGeometry();
  const render = renderTranscript;
  const state = conversation(4);
  await render(state, "a");
  const viewport = transcript();
  if (!viewport) throw Error("Missing transcript");
  expect(viewport.scrollTop).toBe(4000);
  const navigator = container.querySelector("[role=toolbar]");
  expect(navigator?.getAttribute("aria-controls")).toBe(viewport.id);
  await act(async () => markers()[2]?.click());
  expect(viewport.scrollTop).toBe(1984);
  const highlighted = () =>
    [...container.querySelectorAll("[data-nav-highlight]")].map((node) => node.textContent);
  expect(highlighted()).toEqual(["YouQuestion 3"]);
  await act(async () => markers()[1]?.click());
  expect(viewport.scrollTop).toBe(984);
  expect(highlighted()).toEqual(["YouQuestion 2"]);
  await act(async () => viewport.dispatchEvent(new Event("scroll")));
  const streaming = (text: string): SessionState => ({
    ...state,
    items: [
      ...state.items,
      { kind: "assistant", id: "live", turnId: "live", text, streaming: true, citations: [] },
    ],
  });
  await render(streaming("Partial"), "a");
  expect(viewport.scrollTop).toBe(984);
  await act(async () => vi.advanceTimersByTime(1500));
  expect(highlighted()).toEqual([]);
  await act(async () => markers()[3]?.click());
  expect(viewport.scrollTop).toBe(2984);
  await act(async () => viewport.dispatchEvent(new Event("scroll")));
  await render(streaming("Partial answer"), "a");
  expect(viewport.scrollTop).toBe(2984);
  viewport.scrollTop = 3590;
  await act(async () => viewport.dispatchEvent(new Event("scroll")));
  await render(streaming("Partial answer continues"), "a");
  expect(viewport.scrollTop).toBe(4000);
  await act(async () => markers()[0]?.click());
  expect(highlighted()).toEqual(["YouQuestion 1"]);
  await render(conversation(2), "b");
  expect(vi.getTimerCount()).toBe(0);
  expect(highlighted()).toEqual([]);
  expect(container.querySelector('[role="tooltip"]')).toBeNull();
  expect(status()).toBe("");
  await act(async () => vi.advanceTimersByTime(1500));
  expect(vi.getTimerCount()).toBe(0);
});

it("keeps following after a return to the end whose scroll event arrives after the next commit", async () => {
  const transcript = transcriptGeometry();
  await renderTranscript(conversation(2), "a");
  const viewport = transcript();
  if (!viewport) throw Error("Missing transcript");
  viewport.scrollTop = 1000;
  await act(async () => viewport.dispatchEvent(new Event("scroll")));
  await renderTranscript(conversation(3), "a");
  expect(viewport.scrollTop).toBe(1000);
  viewport.scrollTop = 3600;
  await renderTranscript(conversation(4), "a");
  expect(viewport.scrollTop).toBe(4000);
});
