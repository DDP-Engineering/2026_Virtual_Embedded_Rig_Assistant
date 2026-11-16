// @vitest-environment jsdom
// REQ-UX-b2f6ffa8 REQ-UX-2bbfd052 REQ-UX-a3be2b11 REQ-UX-7b49305a REQ-UX-958b58c2 REQ-FUNC-1219a1e4 REQ-REL-47308c01 REQ-REL-c8ac2ecc

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import type { ShortcutOverrides } from "@vera/shared";
import {
  applySessionEvent,
  emptySessionState,
  foldSessionEvents,
  type SessionEvent,
  type SessionState,
} from "@vera/shared";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "../../api/index.js";
import i18n from "../../i18n.js";
import { ShortcutContext } from "../../lib/shortcuts.js";
import * as documentTabs from "../documents/viewer-context.js";
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
  onNavigate = vi.fn((_id: string) => true),
  scrollHeight = 4000,
  bookmarked = (_id: string) => false,
  bindings?: ShortcutOverrides,
) {
  const { viewport, content, anchors, reads } = geometry(starts, scrollHeight);
  const viewportRef = { current: viewport };
  const contentRef = { current: content };
  const render = async (next: readonly NavigatorMessage[]) => {
    await act(async () =>
      root?.render(
        createElement(
          ShortcutContext.Provider,
          { value: bindings },
          createElement(TranscriptNavigator, {
            viewport: viewportRef,
            content: contentRef,
            anchors,
            messages: next,
            controls: "transcript",
            onNavigate,
            bookmarked,
          }),
        ),
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
  const tooltip = () => container.querySelector("[data-nav-preview]");
  expect(tooltip()?.textContent).toBe("<b>Hello</b>");
  expect(tooltip()?.querySelector("b")).toBeNull();
  expect(markers()[0]?.getAttribute("aria-describedby")).toBe(tooltip()?.id);
  await user.keyboard("{Escape}");
  expect(tooltip()).toBeNull();
  await user.keyboard("{ArrowDown}");
  expect(tooltip()?.textContent).toBe("Empty message");
  await user.keyboard("{ArrowDown}");
  expect(tooltip()?.textContent).toBe("QueuedPending delivery");
  await render(messages);
  expect(markers()).toHaveLength(4);
  expect(tooltip()?.textContent).toBe("Queued");
  await user.keyboard("{ArrowDown}");
  expect(tooltip()?.textContent).toBe(`${"x".repeat(140)}…`);
  await user.hover(markers()[1] as HTMLElement);
  expect(tooltip()?.textContent).toBe("Empty message");
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
  expect(entries().map((entry) => entry.textContent)).toEqual(["Question 2", "Question 3", "Question 4"]);
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
  expect(container.querySelector("[data-nav-preview]")?.textContent).toBe("Messages 2–4 (3)");
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
  expect(container.querySelector("[data-nav-preview]")).not.toBeNull();
  expect(await pressEscape()).toBe(true);
  expect(container.querySelector("[data-nav-preview]")).toBeNull();
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
      replyToMessageIds: [`u${index}`],
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
const renderTranscript = async (state: SessionState, sessionId: string, disabled = false) => {
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
          disabled,
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
  expect(container.querySelector("[data-nav-preview]")).toBeNull();
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
it("throttles measuring while a turn streams and moves markers when the turn ends", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  const { viewport, content, anchors, reads } = geometry([0, 1000, 2000, 3000]);
  const render = (live: boolean) =>
    act(async () =>
      root?.render(
        createElement(TranscriptNavigator, {
          viewport: { current: viewport },
          content: { current: content },
          anchors,
          messages: texts(4),
          live,
          controls: "transcript",
          onNavigate: vi.fn(() => true),
        }),
      ),
    );
  await render(true);
  await flushFrames();
  expect(reads.count).toBe(4);
  const top = () => markers()[3]?.style.top;
  expect(top()).toBe("282px");
  // Streamed text above the last question moves it; every frame reports a resize.
  const last = anchors.get("m3");
  if (last) last.getBoundingClientRect = () => rect(3500 - viewport.scrollTop);
  window.dispatchEvent(new Event("resize"));
  expect(frames.size).toBe(0);
  await act(async () => vi.advanceTimersByTime(100));
  window.dispatchEvent(new Event("resize"));
  expect(frames.size).toBe(0);
  await act(async () => vi.advanceTimersByTime(150));
  expect(frames.size).toBe(1);
  await flushFrames();
  expect(top()).toBe("329px");
  if (last) last.getBoundingClientRect = () => rect(3750 - viewport.scrollTop);
  window.dispatchEvent(new Event("resize"));
  expect(frames.size).toBe(0);
  await render(false);
  expect(frames.size).toBe(1);
  await flushFrames();
  expect(top()).toBe("352.5px");
  expect(vi.getTimerCount()).toBe(0);
  expect(reads.count).toBeGreaterThan(4);
});

// REQ-UX-94b2ef16 REQ-UX-88f317e2 REQ-REL-16690ed0
it("shares optimistic bookmarks with a keyboard-reachable title/reply card and rolls back failures", async () => {
  transcriptGeometry();
  const state = conversation(4);
  state.items[0] = { kind: "user", id: "u0", text: "First line\nSecond line" };
  state.items.splice(1, 0, { kind: "tool", id: "tool", turnId: "t0", name: "read", args: {}, status: "ok" });
  await renderTranscript(state, "a");
  const button = () =>
    container.querySelector<HTMLButtonElement>('[data-message-kind="user"] [data-bookmark]');
  expect(button()?.getAttribute("aria-label")).toBe("Bookmark");
  expect(container.querySelector('[data-message-kind="assistant"] [data-bookmark]')).toBeNull();
  let reject!: (error: unknown) => void;
  vi.mocked(api.invoke).mockImplementationOnce(
    () =>
      new Promise((_, no) => {
        reject = no;
      }),
  );
  await act(async () => button()?.click());
  expect(button()?.getAttribute("aria-pressed")).toBe("true");
  await act(async () => markers()[0]?.focus());
  const card = () => container.querySelector<HTMLElement>("[data-nav-preview]");
  expect(card()?.querySelector("strong")?.textContent).toBe("First line");
  expect(card()?.textContent).toContain("Answer 1");
  expect(card()?.textContent).not.toContain("Second line");
  expect(card()?.textContent).not.toContain("Message 1");
  expect(card()?.querySelectorAll("button")).toHaveLength(1);
  expect(card()?.querySelector("button")?.getAttribute("aria-pressed")).toBe("true");
  expect(card()?.querySelector("button")?.disabled).toBe(true);
  await act(async () => reject({ code: "DENIED", messageKey: "errors.DENIED" }));
  expect(button()?.getAttribute("aria-pressed")).toBe("false");
  expect(card()?.querySelector("button")?.getAttribute("aria-pressed")).toBe("false");
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(i18n.t("errors.DENIED"));
  const user = userEvent.setup();
  await act(async () => user.tab());
  expect(document.activeElement).toBe(card()?.querySelector("button"));
  await act(async () => user.keyboard("{Enter}"));
  expect(api.invoke).toHaveBeenLastCalledWith("session.bookmark", {
    sessionId: "a",
    messageId: "u0",
    bookmarked: true,
  });
  expect(button()?.getAttribute("aria-pressed")).toBe("true");
  await renderTranscript({ ...state, bookmarkedMessageIds: ["u0"] }, "a");
  await act(async () => user.keyboard("{Escape}"));
  expect(card()).toBeNull();
  expect(document.activeElement).toBe(markers()[0]);
});

it.each([
  ["en", "Bookmark", "Remove bookmark"],
  ["ro", "Marchează", "Elimină marcajul"],
  ["de", "Lesezeichen setzen", "Lesezeichen entfernen"],
  ["fr", "Ajouter un signet", "Retirer le signet"],
])("localizes bookmark names in %s and discards obsolete session failures", async (language, add, remove) => {
  transcriptGeometry();
  await i18n.changeLanguage(language);
  const state = conversation(2);
  await renderTranscript({ ...state, bookmarkedMessageIds: ["u0"] }, "a");
  const button = () =>
    container.querySelector<HTMLButtonElement>('[data-message-kind="user"] [data-bookmark]');
  expect(button()?.getAttribute("aria-label")).toBe(remove);
  let reject!: (error: unknown) => void;
  vi.mocked(api.invoke).mockImplementationOnce(
    () =>
      new Promise((_, no) => {
        reject = no;
      }),
  );
  await act(async () => button()?.click());
  expect(button()?.getAttribute("aria-label")).toBe(add);
  await renderTranscript(state, "b");
  await act(async () => reject(Error("obsolete")));
  expect(button()?.getAttribute("aria-pressed")).toBe("false");
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it("locks both bookmark controls when disabled and retains an acknowledged optimistic value on retry failure", async () => {
  transcriptGeometry();
  const state = conversation(4);
  const button = () =>
    container.querySelector<HTMLButtonElement>('[data-message-kind="user"] [data-bookmark]');
  await renderTranscript(state, "a", true);
  await act(async () => markers()[0]?.focus());
  expect(button()?.disabled).toBe(true);
  expect(container.querySelector<HTMLButtonElement>("[data-nav-preview] button")?.disabled).toBe(true);
  await renderTranscript(state, "a");
  await act(async () => button()?.click());
  expect(button()?.getAttribute("aria-pressed")).toBe("true");
  vi.mocked(api.invoke).mockRejectedValueOnce(Error("offline"));
  await act(async () => button()?.click());
  expect(button()?.getAttribute("aria-pressed")).toBe("true");
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  await renderTranscript({ ...state, bookmarkedMessageIds: ["u0"] }, "a");
  await act(async () => button()?.click());
  expect(button()?.getAttribute("aria-pressed")).toBe("false");
  await renderTranscript(state, "a");
  expect(button()?.getAttribute("aria-pressed")).toBe("false");
});

it("keeps a running reply with its admitted prompt across queued delivery and replay", async () => {
  transcriptGeometry();
  const events: SessionEvent[] = [
    { type: "message.user", messageId: "u", text: "Original" },
    { type: "turn.started", turnId: "t" },
    { type: "usage.updated", inputTokens: 0, outputTokens: 0, promptIds: ["u"] },
    { type: "message.queued", messageId: "q", text: "Queued", timestamp: 1 },
    { type: "message.done", messageId: "a", text: "Original reply", citations: [] },
  ];
  let state = foldSessionEvents(events);
  const reply = async (index: number) => {
    await act(async () => markers()[index]?.focus());
    return container.querySelector("[data-nav-preview] p")?.textContent;
  };
  await renderTranscript(state, "a");
  expect(await reply(0)).toBe("Original reply");
  expect(await reply(1)).toBeUndefined();
  const delivered: SessionEvent = { type: "message.delivered", messageIds: ["q"] };
  state = applySessionEvent(state, delivered);
  await renderTranscript(state, "a");
  expect(await reply(0)).toBe("Original reply");
  expect(await reply(1)).toBeUndefined();
  const later: SessionEvent[] = [
    delivered,
    { type: "usage.updated", inputTokens: 0, outputTokens: 0, promptIds: ["q"] },
    { type: "message.done", messageId: "b", text: "Queued reply", citations: [] },
  ];
  await renderTranscript(foldSessionEvents([...events, ...later]), "a");
  expect(await reply(0)).toBe("Original reply");
  expect(await reply(1)).toBe("Queued reply");
});

// REQ-UX-f62a82bc REQ-UX-5722a63f
it("marks sparse and grouped markers when any member is bookmarked and updates without layout reads", async () => {
  const marked = new Set(["m0", "m2"]);
  const { render, reads } = await navigator([0, 1000, 1010, 3000], undefined, undefined, 4000, (id) =>
    marked.has(id),
  );
  expect(markers().map((node) => node.hasAttribute("data-nav-bookmarked"))).toEqual([true, true, false]);
  const count = reads.count;
  marked.clear();
  await render(texts(4));
  expect(markers().every((node) => !node.hasAttribute("data-nav-bookmarked"))).toBe(true);
  expect(reads.count).toBe(count);
});

it("jumps through exact bookmarked members in both directions without wrapping, retaining lane focus", async () => {
  const user = userEvent.setup();
  const starts = [0, 1000, 1010, 2000, 3000];
  const onNavigate = vi.fn((_id: string) => true);
  const { viewport } = await navigator(starts, undefined, onNavigate, 4000, (id) =>
    ["m1", "m2", "m4"].includes(id),
  );
  onNavigate.mockImplementation((id: string) => {
    viewport.scrollTop = (starts[Number(id.slice(1))] ?? 0) - 16;
    viewport.dispatchEvent(new Event("scroll"));
    return true;
  });
  await user.keyboard("{Control>}{Alt>}n{/Alt}{/Control}");
  expect(onNavigate).toHaveBeenLastCalledWith("m1");
  expect(document.activeElement).toBe(markers()[1]);
  expect(status()).toBe("Moved to message 2");
  await user.keyboard("{Control>}{Alt>}n{/Alt}{/Control}");
  expect(onNavigate).toHaveBeenLastCalledWith("m2");
  await user.keyboard("{Control>}{Alt>}n{/Alt}{/Control}");
  expect(onNavigate).toHaveBeenLastCalledWith("m4");
  const calls = onNavigate.mock.calls.length;
  await user.keyboard("{Control>}{Alt>}n{/Alt}{/Control}");
  expect(onNavigate).toHaveBeenCalledTimes(calls);
  await user.keyboard("{Control>}{Alt>}p{/Alt}{/Control}");
  expect(onNavigate).toHaveBeenLastCalledWith("m2");
  await user.keyboard("{Control>}{Alt>}p{/Alt}{/Control}");
  expect(onNavigate).toHaveBeenLastCalledWith("m1");
  await user.keyboard("{Control>}{Alt>}p{/Alt}{/Control}");
  expect(onNavigate).toHaveBeenCalledTimes(calls + 2);
});

it("uses custom keys, removes default keys and yields to modal, capture, handled, IME and repeated events", async () => {
  const user = userEvent.setup();
  const { onNavigate } = await navigator([0, 1000, 3000], undefined, undefined, 4000, (id) => id === "m1", {
    nextBookmark: ["Mod+Shift+U"],
    previousBookmark: [],
  });
  await user.keyboard("{Control>}{Alt>}n{/Alt}{/Control}");
  expect(onNavigate).not.toHaveBeenCalled();
  const command = (extra: KeyboardEventInit = {}) =>
    new KeyboardEvent("keydown", {
      key: "U",
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
      ...extra,
    });
  for (const extra of [{ repeat: true }, { isComposing: true }]) {
    await act(async () => window.dispatchEvent(command(extra)));
  }
  const handled = command();
  handled.preventDefault();
  await act(async () => window.dispatchEvent(handled));
  const altGraph = command();
  Object.defineProperty(altGraph, "getModifierState", { value: () => true });
  await act(async () => window.dispatchEvent(altGraph));
  const dialog = document.createElement("dialog");
  dialog.setAttribute("open", "");
  document.body.append(dialog);
  await act(async () => window.dispatchEvent(command()));
  dialog.remove();
  const input = document.createElement("input");
  input.setAttribute("data-shortcut-capture", "");
  document.body.append(input);
  await act(async () => input.dispatchEvent(command()));
  expect(onNavigate).not.toHaveBeenCalled();
  await act(async () => window.dispatchEvent(command()));
  expect(onNavigate).toHaveBeenCalledWith("m1");
});

it("leaves empty bookmark sessions still and focuses the transcript when there is no overflow lane", async () => {
  const user = userEvent.setup();
  const empty = await navigator([0, 100, 200]);
  await user.keyboard("{Control>}{Alt>}n{/Alt}{/Control}");
  expect(empty.onNavigate).not.toHaveBeenCalled();
  const fit = await navigator([0, 100, 200], undefined, undefined, 400, (id) => id === "m2");
  fit.viewport.tabIndex = 0;
  await user.keyboard("{Control>}{Alt>}n{/Alt}{/Control}");
  expect(fit.onNavigate).toHaveBeenCalledWith("m2");
  expect(document.activeElement).toBe(fit.viewport);
  expect(status()).toBe("Moved to message 3");
});

it("mounts an older bookmarked row before retrying the shared rail jump", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const viewport = transcriptGeometry();
  const state = { ...conversation(100), bookmarkedMessageIds: ["u0"] };
  await renderTranscript(state, "progressive-bookmarks");
  expect(container.querySelectorAll("article")).toHaveLength(40);
  await act(async () =>
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "p",
        ctrlKey: true,
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  await flushFrames();
  expect(container.querySelectorAll("article")).toHaveLength(200);
  expect(container.querySelector("[data-nav-highlight]")?.textContent).toBe("YouQuestion 1");
  expect(viewport()?.scrollTop).toBe(0);
  expect(document.activeElement).toBe(markers()[0]);
});

it("yields bookmark commands while a document tab owns the conversation area", async () => {
  const user = userEvent.setup();
  const tab = vi
    .spyOn(documentTabs, "useDocumentTabs")
    .mockReturnValue({ active: "file:manual" } as NonNullable<
      ReturnType<typeof documentTabs.useDocumentTabs>
    >);
  const { onNavigate, render } = await navigator(
    [0, 1000, 3000],
    undefined,
    undefined,
    4000,
    (id) => id === "m1",
  );
  await user.keyboard("{Control>}{Alt>}n{/Alt}{/Control}");
  expect(onNavigate).not.toHaveBeenCalled();
  tab.mockReturnValue(undefined);
  await render(texts(3));
  await user.keyboard("{Control>}{Alt>}n{/Alt}{/Control}");
  expect(onNavigate).toHaveBeenCalledWith("m1");
});

it("starts shortcuts from the latest manual rail destination when jumps share the end clamp", async () => {
  const user = userEvent.setup();
  const starts = [0, 1200, 1300, 1400];
  const onNavigate = vi.fn((_id: string) => true);
  const { viewport } = await navigator(starts, undefined, onNavigate, 1500, (id) => id !== "m0");
  onNavigate.mockImplementation((id: string) => {
    viewport.scrollTop = Math.min(1100, (starts[Number(id.slice(1))] ?? 0) - 16);
    viewport.dispatchEvent(new Event("scroll"));
    return true;
  });
  await user.keyboard("{Control>}{Alt>}n{/Alt}{/Control}");
  expect(onNavigate).toHaveBeenLastCalledWith("m1");
  await user.click(markers()[3] as HTMLButtonElement);
  expect(onNavigate).toHaveBeenLastCalledWith("m3");
  await user.keyboard("{Control>}{Alt>}p{/Alt}{/Control}");
  expect(onNavigate).toHaveBeenLastCalledWith("m2");
});
