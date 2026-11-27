/// <reference lib="dom" />

import { errors, type Page, type Response } from "playwright-core";
import { z } from "zod";
import { BrowserError } from "./failure.js";
import { browserNavigationErrorHeader, readableBrowserType } from "./network.js";

const browserDocumentSchema = z.discriminatedUnion("supported", [
  z.strictObject({ supported: z.literal(false) }),
  z.strictObject({
    supported: z.literal(true),
    url: z.string().max(4096),
    title: z.string().max(241),
    text: z.string().max(4001),
    links: z.array(z.strictObject({ label: z.string().max(161), url: z.string().max(4096) })).max(48),
    truncated: z.boolean(),
  }),
]);

function navigationError(response: Response) {
  const code = response.headers()[browserNavigationErrorHeader];
  switch (code) {
    case "destination-denied":
    case "unsupported-content":
    case "resource-limit":
    case "operation-timeout":
      return new BrowserError(code);
    default:
      return undefined;
  }
}

export async function navigatePage(page: Page, url: string, timeout = 0): Promise<string> {
  let blocked: BrowserError | undefined;
  const report = (response: Response) => {
    const request = response.request();
    const failure = navigationError(response);
    if (!failure || !request.isNavigationRequest()) return;
    try {
      if (request.frame() === page.mainFrame()) blocked = failure;
    } catch {
      // Playwright can report a navigation before its frame is attached.
    }
  };
  page.on("response", report);
  try {
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout });
    if (blocked) throw blocked;
    if (response) {
      const status = response.status();
      if (status < 200 || status >= 400) throw new BrowserError("navigation-failed");
      if (!readableBrowserType(response.headers()["content-type"]))
        throw new BrowserError("unsupported-content");
    }
    return page.url();
  } catch (error) {
    if (page.isClosed()) throw new BrowserError("page-closed");
    if (blocked) throw blocked;
    if (error instanceof BrowserError) throw error;
    if (error instanceof errors.TimeoutError) throw new BrowserError("operation-timeout");
    if (
      error instanceof Error &&
      /net::ERR_(TUNNEL_CONNECTION_FAILED|BLOCKED_BY_ADMINISTRATOR)/.test(error.message)
    )
      throw new BrowserError("destination-denied");
    throw new BrowserError("navigation-failed");
  } finally {
    page.off("response", report);
  }
}

export async function inspectPage(page: Page) {
  const result = browserDocumentSchema.parse(await inDocument(page, "snapshot"));
  if (!result.supported) throw new BrowserError("unsupported-content");
  const { supported: _, ...snapshot } = result;
  return snapshot;
}

export async function scrollPage(page: Page, direction: "up" | "down") {
  const moved = await inDocument(page, direction);
  if (typeof moved !== "boolean") throw new BrowserError("unsupported-content");
  return moved;
}

async function inDocument(page: Page, action: "snapshot" | "up" | "down"): Promise<unknown> {
  try {
    const cdp = await page.context().newCDPSession(page);
    try {
      const { frameTree } = await cdp.send("Page.getFrameTree");
      const { executionContextId } = await cdp.send("Page.createIsolatedWorld", {
        frameId: frameTree.frame.id,
        worldName: "VERA browser reader",
      });
      const { result, exceptionDetails } = await cdp.send("Runtime.evaluate", {
        expression: `(${readDocument.toString()})(${JSON.stringify(action)})`,
        contextId: executionContextId,
        returnByValue: true,
      });
      if (exceptionDetails) throw new BrowserError("operation-failed");
      return result.value;
    } finally {
      await cdp.detach().catch(() => {});
    }
  } catch (error) {
    if (page.isClosed()) throw new BrowserError("page-closed");
    throw error;
  }
}

// Executed as a fixed function in an isolated Chromium world. Keep all browser globals and limits local.
function readDocument(action: "snapshot" | "up" | "down") {
  const root = document.body;
  const url = location.href;
  const supported =
    !!root &&
    url.length <= 4096 &&
    /^https?:\/\//.test(url) &&
    ["text/html", "text/plain", "application/xhtml+xml"].includes(document.contentType);
  if (!supported) return { supported: false };
  if (action !== "snapshot") {
    const before = window.scrollY;
    window.scrollBy({ top: innerHeight * (action === "up" ? -0.85 : 0.85), behavior: "instant" });
    return window.scrollY !== before;
  }

  function onScreen(rect: DOMRect): boolean {
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < innerHeight &&
      rect.left < innerWidth
    );
  }

  function visible(element: Element): boolean {
    let current: Element | null = element;
    for (let depth = 0; current && depth < 32; depth++, current = current.parentElement) {
      const style = getComputedStyle(current);
      if (style.display !== "contents")
        return current.checkVisibility({
          checkOpacity: true,
          checkVisibilityCSS: true,
          contentVisibilityAuto: true,
        });
      if (style.visibility !== "visible") return false;
    }
    return false;
  }

  function inertText(element: Element): boolean {
    return ["script", "style", "noscript", "template"].includes(element.localName);
  }

  function clean(value: string, limit: number): string {
    return value.slice(0, limit).replace(/\s+/gu, " ").trim();
  }

  function labelText(element: Element, referenced = false, limit = 161): string {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (
          node instanceof Element &&
          (inertText(node) ||
            (!referenced && (node.matches('[aria-hidden="true"], [inert]') || !visible(node))))
        )
          return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let result = "";
    for (let visited = 0; visited < 32 && result.length < limit; visited++) {
      const node = walker.nextNode();
      if (!node) break;
      if (node instanceof Text) result += ` ${node.substringData(0, limit - result.length)}`;
      if (node instanceof HTMLImageElement) result += ` ${node.alt.slice(0, limit - result.length)}`;
    }
    return clean(result.trimStart(), limit);
  }

  function accessibleLabel(anchor: HTMLAnchorElement): string {
    const labelledBy = clean(anchor.getAttribute("aria-labelledby") ?? "", 240);
    const named = labelledBy
      .split(" ", 4)
      .filter(Boolean)
      .map((id) => {
        const source = document.getElementById(id);
        return source ? labelText(source, true) : "";
      })
      .join(" ")
      .trim();
    return (
      clean(named, 161) ||
      clean(anchor.getAttribute("aria-label") ?? "", 161) ||
      labelText(anchor) ||
      clean(anchor.title, 161)
    );
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return node instanceof Element && inertText(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
  });
  const links: { label: string; url: string }[] = [];
  let text = "";
  let truncated = false;
  let previousBlock: Element | null = null;
  const range = document.createRange();
  let geometry = 16_000;

  function bounds(node: Text, start: number, end: number): DOMRect {
    range.setStart(node, start);
    range.setEnd(node, end);
    return range.getBoundingClientRect();
  }

  function findBoundary(start: number, end: number, before: (offset: number) => boolean): number {
    while (start < end) {
      const middle = start + Math.floor((end - start) / 2);
      if (before(middle)) start = middle + 1;
      else end = middle;
    }
    return start;
  }

  function visibleRange(node: Text, start: number, end: number): string {
    if (start === end) return "";
    if (--geometry < 0) {
      truncated = true;
      return "";
    }
    const rect = bounds(node, start, end);
    if (!onScreen(rect)) return "";
    if ((rect.left >= 0 && rect.right <= innerWidth) || end - start === 1)
      return node.substringData(start, end - start);
    const middle = start + Math.floor((end - start) / 2);
    return visibleRange(node, start, middle) + visibleRange(node, middle, end);
  }

  function viewportText(node: Text, limit: number): string {
    const first = bounds(node, 0, 1);
    if (first.top >= innerHeight) return "";
    const start =
      first.bottom > 0
        ? 0
        : findBoundary(0, node.length, (offset) => bounds(node, offset, offset + 1).bottom <= 0);
    if (start >= node.length) return "";
    const capped = Math.min(node.length, start + limit);
    const end =
      bounds(node, capped - 1, capped).top < innerHeight
        ? capped
        : findBoundary(start, capped, (offset) => bounds(node, offset, offset + 1).top < innerHeight);
    if (end === capped && end < node.length && bounds(node, end, end + 1).top < innerHeight) truncated = true;
    return clean(visibleRange(node, start, end), limit);
  }

  let visited = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (++visited > 4_000) {
      truncated = true;
      break;
    }
    if (
      node instanceof HTMLAnchorElement &&
      node.hasAttribute("href") &&
      !node.closest('[aria-hidden="true"], [inert]') &&
      visible(node) &&
      onScreen(node.getBoundingClientRect())
    ) {
      const destination = node.href;
      const label = accessibleLabel(node);
      if (label && /^https?:\/\//.test(destination) && destination.length <= 4096) {
        if (links.length < 48) links.push({ label, url: destination });
        else truncated = true;
      }
    }
    if (!(node instanceof Text) || !node.length) continue;
    const element = node.parentElement;
    if (!element?.isConnected || !visible(element)) continue;
    if (text.length >= 4001) {
      truncated = true;
      continue;
    }
    const part = viewportText(node, 4001 - text.length);
    if (!part) continue;
    const block = element.closest(
      "article, aside, blockquote, div, h1, h2, h3, h4, h5, h6, li, p, pre, section, table, tr",
    );
    text = `${text}${text && (block === previousBlock ? " " : "\n")}${part}`.slice(0, 4001);
    previousBlock = block;
  }
  const title = document.querySelector("title");
  return { supported: true, url, title: title ? labelText(title, true, 241) : "", text, links, truncated };
}
