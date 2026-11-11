// REQ-TEST-ef975c5d REQ-UX-b2f6ffa8 REQ-UX-2bbfd052 REQ-UX-a3be2b11 REQ-UX-7b49305a REQ-UX-958b58c2 REQ-FUNC-1219a1e4 REQ-REL-47308c01 REQ-REL-c8ac2ecc
import { expect, type Page, test } from "@playwright/test";
import { resolveConfig } from "electron-vite";
import { createServer } from "vite";

type Geometry = {
  starts: number[];
  scrollHeight: number;
  clientHeight: number;
  lane: { height: number; right: number };
  contentLeft: number;
  markers: { center: number; members: number; width: number; height: number }[];
};

async function open(page: Page) {
  const config = (await resolveConfig({ root: "src/apps/desktop" }, "serve", "development")).config?.renderer;
  if (!config) throw Error("Missing renderer config");
  const server = await createServer({
    ...config,
    define: { ...config.define, "import.meta.env.VITE_API": JSON.stringify("mock") },
    server: { ...config.server, port: 0, strictPort: false, hmr: false },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw Error("Missing renderer address");
  const outbound: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.protocol.startsWith("http") && !["127.0.0.1", "localhost"].includes(url.hostname))
      outbound.push(request.url());
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`http://127.0.0.1:${address.port}/?mock=chat`);
  await page.locator('[data-i18n="nav.welcome"]').click();
  await page.locator("#workbench-name").fill("Navigation bench");
  await page.locator('[data-action="choose-create"]').click();
  await page.locator('[data-action="create-workbench"]').click();
  await page.locator('[data-action="new-session"]').click();
  const sessionId = await page.locator('[data-session][aria-current="page"]').getAttribute("data-session");
  if (!sessionId) throw Error("Missing session identity");
  return { server, outbound, sessionId };
}
const shot = async (page: Page, name: string) => {
  if (process.env.VERA_NAV_SCREENSHOT)
    await page.screenshot({ path: `${process.env.VERA_NAV_SCREENSHOT}.${name}.png` });
};
const view = (page: Page) => page.locator("[data-transcript]");
const lane = (page: Page) => page.getByRole("toolbar", { name: "Your messages" });
const users = (page: Page) => page.locator('[data-message-kind="user"]');
const marker = (page: Page, ordinal: number) =>
  lane(page).getByRole("button", { name: `Message ${ordinal}`, exact: true });
const status = (page: Page) => page.locator(".transcript-navigator [role=status]");
async function send(page: Page, text: string, userCount: number, assistantCount?: number) {
  const input = page.getByRole("textbox", { name: "Message", exact: true });
  await expect(input).toBeEnabled();
  await input.fill(text);
  await input.press("Enter");
  await expect(users(page)).toHaveCount(userCount, { timeout: 60_000 });
  if (assistantCount !== undefined)
    await expect(page.locator('[data-message-kind="assistant"]')).toHaveCount(assistantCount, {
      timeout: 60_000,
    });
}
function geometry(page: Page): Promise<Geometry> {
  return page.evaluate(() => {
    const viewport = document.querySelector<HTMLElement>("[data-transcript]");
    const navigator = document.querySelector<HTMLElement>(".transcript-navigator");
    const content = document.querySelector<HTMLElement>(".transcript-content");
    if (!viewport || !navigator || !content) throw Error("Missing navigator geometry");
    const origin = viewport.getBoundingClientRect().top + viewport.clientTop - viewport.scrollTop;
    const box = navigator.getBoundingClientRect();
    return {
      starts: [...document.querySelectorAll('[data-message-kind="user"]')].map(
        (node) => node.getBoundingClientRect().top - origin,
      ),
      scrollHeight: viewport.scrollHeight,
      clientHeight: viewport.clientHeight,
      lane: { height: box.height, right: box.right },
      contentLeft: content.getBoundingClientRect().left,
      markers: [...navigator.querySelectorAll<HTMLElement>("[data-nav-marker]")].map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          center: rect.top + rect.height / 2 - box.top,
          members: Number(node.dataset.navMembers),
          width: rect.width,
          height: rect.height,
        };
      }),
    };
  });
}
/** Markers follow the real message starts over the whole content, never overlap and never cover text. */
async function expectMapped(page: Page) {
  await expect(async () => {
    const g = await geometry(page);
    const lane = g.clientHeight;
    expect(Math.abs(g.lane.height - lane)).toBeLessThanOrEqual(1);
    expect(g.lane.right).toBeLessThanOrEqual(g.contentLeft);
    expect(g.markers.reduce((sum, item) => sum + item.members, 0)).toBe(g.starts.length);
    let first = 0;
    g.markers.forEach((item, index) => {
      expect(Math.abs(item.height - 24)).toBeLessThanOrEqual(0.5);
      expect(item.width).toBeGreaterThanOrEqual(24);
      const centers = g.starts
        .slice(first, first + item.members)
        .map((y) => 12 + Math.min(1, Math.max(0, y / Math.max(g.scrollHeight, 1))) * Math.max(0, lane - 24));
      expect(
        Math.abs(item.center - centers.reduce((sum, value) => sum + value, 0) / centers.length),
      ).toBeLessThan(1.5);
      if (index > 0) expect(item.center - (g.markers[index - 1]?.center ?? 0)).toBeGreaterThanOrEqual(23.5);
      first += item.members;
    });
  }).toPass({ timeout: 10_000 });
}
/**
 * The target sits about 16 px below the top, or the native scroll limit applies. `growing`: the jump
 * met the limit and a reply streamed in since, so the limit moved while the reading position stayed.
 */
async function expectJump(page: Page, index: number, growing = false) {
  await expect(async () => {
    const { offset, top, max, height } = await page.evaluate((target) => {
      const viewport = document.querySelector("[data-transcript]") as HTMLElement;
      const node = document.querySelectorAll('[data-message-kind="user"]')[target] as HTMLElement;
      return {
        offset: node.getBoundingClientRect().top - viewport.getBoundingClientRect().top - viewport.clientTop,
        top: viewport.scrollTop,
        max: viewport.scrollHeight - viewport.clientHeight,
        height: viewport.clientHeight,
      };
    }, index);
    if (top <= 0.5) expect(offset).toBeLessThanOrEqual(17.5);
    else if (top >= max - 0.5) expect(offset).toBeGreaterThanOrEqual(14.5);
    else if (growing) {
      expect(offset).toBeGreaterThanOrEqual(14.5);
      expect(offset).toBeLessThan(height / 2);
    } else expect(Math.abs(offset - 16)).toBeLessThanOrEqual(1.5);
    expect(offset).toBeGreaterThanOrEqual(0);
    expect(offset).toBeLessThan(height);
  }).toPass({ timeout: 5_000 });
}
/**
 * WCAG non-text contrast of the focused marker: the ring against the pixels it replaces (the marker's
 * own fill, else the surface) and a quiet marker against the surface.
 */
function focusContrast(page: Page) {
  return page.evaluate(() => {
    const rgb = (value: string) => (value.match(/[\d.]+/g) ?? []).slice(0, 4).map(Number);
    const luminance = ([r = 0, g = 0, b = 0]: number[]) => {
      const [x = 0, y = 0, z = 0] = [r, g, b].map((part) => {
        const c = part / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * x + 0.7152 * y + 0.0722 * z;
    };
    const ratio = (a: string, b: string) => {
      const [high, low] = [luminance(rgb(a)), luminance(rgb(b))].sort((p, q) => q - p);
      return ((high ?? 0) + 0.05) / ((low ?? 0) + 0.05);
    };
    const filled = (node: Element) => (rgb(getComputedStyle(node).backgroundColor)[3] ?? 1) !== 0;
    let surface = document.querySelector(".transcript-navigator") as HTMLElement | null;
    while (surface && !filled(surface)) surface = surface.parentElement;
    const background = getComputedStyle(surface ?? document.body).backgroundColor;
    const focused = document.activeElement as HTMLElement;
    const under = filled(focused) ? getComputedStyle(focused).backgroundColor : background;
    const quiet = document.querySelector<HTMLElement>("[data-nav-marker]:not([aria-current]):not(:focus)");
    return {
      focused: focused.matches("[data-nav-marker]"),
      filled: filled(focused),
      outline: getComputedStyle(focused).outlineStyle,
      ring: ratio(getComputedStyle(focused).outlineColor, under),
      marker: quiet ? ratio(getComputedStyle(quiet).color, background) : 0,
    };
  });
}
const scrollTop = (page: Page) => view(page).evaluate((node) => node.scrollTop);
const contentBox = (page: Page) =>
  page.locator(".transcript-content").evaluate((node) => {
    const box = node.getBoundingClientRect();
    return { left: box.left, width: box.width };
  });
const lastAnswer = (page: Page) => page.locator('[data-message-kind="assistant"]').last();

test("markers map, preview and reach user messages while the rail keeps its controls", async ({ page }) => {
  test.setTimeout(90_000);
  const { server, outbound, sessionId } = await open(page);
  try {
    await expect(lane(page)).toHaveCount(0);
    await expect(page.getByRole("scrollbar")).toBeHidden();
    await send(page, "Short question", 1, 1);
    await expect(lane(page)).toHaveCount(0);
    const hidden = await contentBox(page);
    await send(page, "seed 12 messages", 14, 14);
    await expect(lane(page)).toBeVisible();
    // The lane's room is reserved, so text does not move when the lane appears.
    expect(await contentBox(page)).toEqual(hidden);
    await expect(lane(page)).toHaveAttribute("aria-controls", (await view(page).getAttribute("id")) ?? "");
    await expectMapped(page);
    await shot(page, "sparse");
    await marker(page, 1).click();
    await expectJump(page, 0);
    await expect(users(page).nth(0)).toHaveAttribute("data-nav-highlight", "");
    await expect(status(page)).toHaveText("Moved to message 1");
    expect(await page.evaluate(() => getSelection()?.toString() ?? "")).toBe("");
    await marker(page, 7).click();
    await expectJump(page, 6);
    await expect(page.locator("[data-nav-highlight]")).toHaveCount(1);
    await expect(users(page).nth(6)).toHaveAttribute("data-nav-highlight", "");
    await expect(page.locator("[data-nav-highlight]")).toHaveCount(0, { timeout: 3_000 });
    await marker(page, 14).click();
    await expectJump(page, 13);
    // Reduced motion: the jump lands at once and the highlight has no transition or animation.
    await page.emulateMedia({ reducedMotion: "reduce" });
    const immediate = await page.evaluate(() => {
      const viewport = document.querySelector("[data-transcript]") as HTMLElement;
      const button = [...document.querySelectorAll<HTMLElement>("[data-nav-marker]")].find(
        (node) => node.getAttribute("aria-label") === "Message 7",
      );
      button?.click();
      const target = document.querySelectorAll<HTMLElement>('[data-message-kind="user"]')[6] as HTMLElement;
      const style = getComputedStyle(target);
      return {
        offset:
          target.getBoundingClientRect().top - viewport.getBoundingClientRect().top - viewport.clientTop,
        behavior: getComputedStyle(viewport).scrollBehavior,
        transition: style.transitionDuration,
        animation: style.animationName,
        highlighted: target.hasAttribute("data-nav-highlight"),
      };
    });
    expect(Math.abs(immediate.offset - 16)).toBeLessThanOrEqual(1.5);
    expect(immediate).toMatchObject({ behavior: "auto", transition: "0s", animation: "none" });
    await expect(users(page).nth(6)).toHaveAttribute("data-nav-highlight", "");
    await page.emulateMedia({ reducedMotion: null });
    // The reading line, not the last click, marks the current message.
    await view(page).evaluate((node) => {
      const fifth = document.querySelectorAll('[data-message-kind="user"]')[4] as HTMLElement;
      node.scrollTop += fifth.getBoundingClientRect().top - node.getBoundingClientRect().top - 10;
    });
    await expect(marker(page, 5)).toHaveAttribute("aria-current", "location");
    // One Tab stop; arrows, Home and End move focus only; Enter jumps and keeps focus.
    const rail = page.getByRole("scrollbar", { name: "Scroll conversation" });
    await rail.focus();
    await page.keyboard.press("Tab");
    await expect(lane(page).locator('[tabindex="0"]')).toBeFocused();
    await expect(lane(page).locator('[tabindex="0"]')).toHaveCount(1);
    const reading = await scrollTop(page);
    await page.keyboard.press("Home");
    await expect(marker(page, 1)).toBeFocused();
    // The seed request and the first seeded question are adjacent, so they share one group.
    await page.keyboard.press("ArrowDown");
    await expect(lane(page).getByRole("button", { name: "Messages 2–3 (2)" })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(marker(page, 4)).toBeFocused();
    await page.keyboard.press("End");
    await expect(marker(page, 14)).toBeFocused();
    await page.keyboard.press("Home");
    await expect(marker(page, 1)).toBeFocused();
    expect(await scrollTop(page)).toBe(reading);
    await expect(page.getByRole("tooltip")).toHaveText("Message 1 — Short question");
    await shot(page, "keyboard");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    await page.keyboard.press("Enter");
    await expectJump(page, 0);
    await expect(marker(page, 1)).toBeFocused();
    await expect(status(page)).toHaveText(/^Moved to message 1/);
    await page.keyboard.press("Tab");
    await expect(view(page)).toBeFocused();
    // Pointer preview: plain text, inside the window, dismissible.
    await marker(page, 7).hover();
    const tooltip = page.getByRole("tooltip");
    await expect(tooltip).toHaveText(/^Message 7 — Seeded question 5\./);
    const box = await tooltip.boundingBox();
    expect(box).toBeTruthy();
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(1280);
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(900);
    // Moving the pointer onto the preview keeps it open.
    await page.mouse.move((box?.x ?? 0) + (box?.width ?? 0) / 2, (box?.y ?? 0) + (box?.height ?? 0) / 2, {
      steps: 4,
    });
    await page.waitForTimeout(600);
    await expect(tooltip).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(tooltip).toHaveCount(0);
    // The existing rail keys and wheel scrolling keep working beside the markers.
    await rail.focus();
    await page.keyboard.press("End");
    await expect(rail).toHaveAttribute("aria-valuenow", "100");
    const laneBox = await page.locator(".transcript-navigator").boundingBox();
    if (!laneBox) throw Error("Missing lane");
    await page.mouse.move(laneBox.x + laneBox.width / 2, laneBox.y + laneBox.height / 2);
    await page.mouse.wheel(0, -400);
    await expect
      .poll(() => view(page).evaluate((node) => node.scrollHeight - node.scrollTop - node.clientHeight))
      .toBeGreaterThan(100);
    // Markers and the keyboard focus ring keep at least 3:1 contrast in the light and dark themes.
    for (const theme of ["dark", "light"]) {
      await page.locator('[data-i18n="nav.settings"]').click();
      await page.locator('[data-section="appearance"]').click();
      await page.locator(`[data-theme-option="${theme}"]`).click();
      await page.locator('[data-action="leave-settings"]').click();
      await page.locator(`[data-session="${sessionId}"]`).click();
      await rail.focus();
      await page.keyboard.press("Tab");
      const contrast = await focusContrast(page);
      expect(contrast.focused).toBe(true);
      expect(contrast.outline).toBe("solid");
      expect(contrast.ring).toBeGreaterThanOrEqual(3);
      expect(contrast.marker).toBeGreaterThanOrEqual(3);
    }
    expect(outbound).toEqual([]);
  } finally {
    await server.close();
  }
});

test("a streaming reply never pulls the reader back after a jump until an explicit return to the end", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const { server } = await open(page);
  try {
    await send(page, "seed 8 messages", 9, 9);
    await send(page, "Twin question", 10, 10);
    await send(page, "Twin question", 11, 11);
    await marker(page, 11).click();
    await expectJump(page, 10);
    await expect(users(page).nth(10)).toHaveAttribute("data-nav-highlight", "");
    await expect(users(page).nth(9)).not.toHaveAttribute("data-nav-highlight", "");
    await send(page, "stream slowly please", 12);
    await expect(lastAnswer(page)).toContainText("Streaming line 3");
    await send(page, "Queued while streaming", 13);
    await expect(users(page).nth(12).locator("[data-message-pending]")).toHaveCount(1);
    await marker(page, 13).hover();
    await expect(page.getByRole("tooltip")).toHaveText(
      "Message 13 — Pending delivery — Queued while streaming",
    );
    // A jump that lands within the 80 px follow threshold of the end still suspends following.
    const nearEnd = await page.evaluate(() => {
      const viewport = document.querySelector("[data-transcript]") as HTMLElement;
      [...document.querySelectorAll<HTMLElement>("[data-nav-marker]")]
        .find((node) => node.getAttribute("aria-label") === "Message 12")
        ?.click();
      return {
        gap: viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop,
        top: viewport.scrollTop,
      };
    });
    expect(nearEnd.gap).toBeLessThan(80);
    await expectJump(page, 11, true);
    await expect(lastAnswer(page)).toContainText("Streaming line 12", { timeout: 10_000 });
    expect(await scrollTop(page)).toBe(nearEnd.top);
    await expectJump(page, 11, true);
    await marker(page, 4).click();
    await expectJump(page, 3);
    const early = await scrollTop(page);
    await expect(lastAnswer(page)).toContainText("Streaming line 20", { timeout: 10_000 });
    expect(await scrollTop(page)).toBe(early);
    await expectJump(page, 3);
    await page.getByRole("scrollbar", { name: "Scroll conversation" }).focus();
    await page.keyboard.press("End");
    await expect(lastAnswer(page)).toContainText("Streaming line 28", { timeout: 10_000 });
    await expect
      .poll(() => view(page).evaluate((node) => node.scrollHeight - node.scrollTop - node.clientHeight))
      .toBeLessThan(2);
    await expect(page.getByRole("status").filter({ hasText: "Streaming" })).toHaveCount(0, {
      timeout: 15_000,
    });
    await send(page, "Deliver now", 14);
    await expect(page.locator("[data-message-pending]")).toHaveCount(0, { timeout: 10_000 });
    await expectMapped(page);
    // The delivered message keeps its single marker or group entry, now without the pending label.
    if (await marker(page, 13).count()) {
      await marker(page, 13).hover();
      await expect(page.getByRole("tooltip")).toHaveText("Message 13 — Queued while streaming");
    } else {
      await lane(page).locator("[data-nav-marker][aria-expanded]").last().click();
      await expect(page.locator("[data-nav-selector]")).toContainText("Message 13 — Queued while streaming");
    }
  } finally {
    await server.close();
  }
});

test("geometry follows disclosures and detail levels, and each session keeps only its own navigation", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    const live = { mutation: new Set<object>(), resize: new Set<object>() };
    const watched = (target: unknown) =>
      target instanceof Element && target.classList.contains("transcript-content");
    const mutation = MutationObserver.prototype;
    const { observe: mutationObserve, disconnect: mutationDisconnect } = mutation;
    mutation.observe = function (this: MutationObserver, target: Node, options?: MutationObserverInit) {
      if (watched(target)) live.mutation.add(this);
      return mutationObserve.call(this, target, options);
    };
    mutation.disconnect = function (this: MutationObserver) {
      live.mutation.delete(this);
      return mutationDisconnect.call(this);
    };
    const resize = ResizeObserver.prototype;
    const { observe: resizeObserve, disconnect: resizeDisconnect } = resize;
    resize.observe = function (this: ResizeObserver, target: Element, options?: ResizeObserverOptions) {
      if (watched(target)) live.resize.add(this);
      return resizeObserve.call(this, target, options);
    };
    resize.disconnect = function (this: ResizeObserver) {
      live.resize.delete(this);
      return resizeDisconnect.call(this);
    };
    Object.assign(window, {
      veraObservers: () => ({ mutation: live.mutation.size, resize: live.resize.size }),
    });
  });
  const { server, sessionId } = await open(page);
  try {
    const tools = page.locator("[data-session]").filter({ hasText: "Tool rows" });
    const toolsId = await tools.getAttribute("data-session");
    await tools.click();
    await send(page, "seed 6 messages", 8, 8);
    await expectMapped(page);
    const before = (await geometry(page)).starts;
    await page.locator("[data-tool-group] > section > .disclosure-toggle").click();
    await expect.poll(async () => (await geometry(page)).starts[1]).toBeGreaterThan((before[1] ?? 0) + 10);
    await expectMapped(page);
    for (const level of ["verbose", "minimal", "normal"]) {
      await page
        .locator("[data-workbench-entry]")
        .filter({ hasText: "Navigation bench" })
        .locator(".workbench-group-name")
        .click();
      await page.locator('[data-action="edit-workbench-overview"]').click();
      await page.locator('[data-project-section="chat"]').click();
      await page.locator("[data-chat-detail] select, select[data-chat-detail]").selectOption(level);
      await page.locator("[data-project-save]").click();
      await expect(page.locator(".workbench-editor")).toHaveCount(0);
      await page.locator(`[data-session="${toolsId}"]`).click();
      await expect(page.locator(".transcript-frame")).toHaveAttribute("data-chat-detail", level);
      await expectMapped(page);
    }
    // Switching sessions drops the preview, highlight and announcement of the previous one.
    for (let round = 0; round < 3; round++) {
      await marker(page, 4).click();
      await marker(page, 5).hover();
      await expect(page.getByRole("tooltip")).toBeVisible();
      await page.locator(`[data-session="${sessionId}"]`).click();
      await expect(lane(page)).toHaveCount(0);
      await expect(page.getByRole("tooltip")).toHaveCount(0);
      await expect(page.locator("[data-nav-highlight]")).toHaveCount(0);
      await page.locator(`[data-session="${toolsId}"]`).click();
      await expect(lane(page)).toBeVisible();
      await expect(page.locator("[data-nav-highlight]")).toHaveCount(0);
      await expect(page.getByRole("tooltip")).toHaveCount(0);
      await expect(status(page)).toHaveText("");
    }
    // Only the current navigator and the rail observe the conversation after repeated switches.
    expect(
      await page.evaluate(() => (window as unknown as { veraObservers: () => object }).veraObservers()),
    ).toEqual({
      mutation: 1,
      resize: 2,
    });
  } finally {
    await server.close();
  }
});

test("500 messages stay reachable through groups, scrolling reuses measured anchors, and layout changes regroup", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const { server, sessionId } = await open(page);
  try {
    await send(page, "seed 500 messages", 501, 501);
    await expectMapped(page);
    const groups = lane(page).locator("[data-nav-marker][aria-expanded]");
    expect(await groups.count()).toBeGreaterThan(0);
    await shot(page, "dense");
    await page.evaluate(() => {
      const read = Element.prototype.getBoundingClientRect;
      const counter = { reads: 0 };
      Element.prototype.getBoundingClientRect = function (this: Element) {
        if (this.matches('[data-message-kind="user"]')) counter.reads += 1;
        return read.call(this);
      };
      Object.assign(window, { veraAnchorReads: counter });
    });
    const reads = () =>
      page.evaluate(
        () => (window as unknown as { veraAnchorReads: { reads: number } }).veraAnchorReads.reads,
      );
    const visited = new Set<string | null>();
    for (let step = 0; step <= 10; step++) {
      await view(page).evaluate(
        (node, fraction) =>
          new Promise<void>((resolve) => {
            node.scrollTop = (node.scrollHeight - node.clientHeight) * fraction;
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
          }),
        step / 10,
      );
      visited.add(await lane(page).locator("[aria-current]").getAttribute("aria-label"));
    }
    await view(page).hover();
    await page.mouse.wheel(0, -600);
    expect(visited.size).toBeGreaterThan(5);
    // The keyboard ring stays visible on the filled current group (the initial Tab stop).
    await page.getByRole("scrollbar", { name: "Scroll conversation" }).focus();
    await page.keyboard.press("Tab");
    const ring = await focusContrast(page);
    expect(ring).toMatchObject({ focused: true, filled: true, outline: "solid" });
    expect(ring.ring).toBeGreaterThanOrEqual(3);
    await page.keyboard.press("Shift+Tab");
    expect(await reads()).toBe(0);
    // A group lists every member; Escape and an outside click close it without scrolling.
    const group = groups.nth(Math.floor((await groups.count()) / 2));
    const members = Number(await group.getAttribute("data-nav-members"));
    await group.click();
    const selector = page.locator("[data-nav-selector]");
    await expect(selector.getByRole("button")).toHaveCount(members);
    await expect(selector.getByRole("button").first()).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(selector).toHaveCount(0);
    await expect(group).toBeFocused();
    const resting = await scrollTop(page);
    await group.click();
    await shot(page, "group");
    const list = page.locator(".transcript-navigator-selector");
    const listBox = await list.boundingBox();
    if (!listBox) throw Error("Missing selector");
    await page.mouse.move(listBox.x + listBox.width / 2, listBox.y + listBox.height / 2);
    await page.mouse.wheel(0, 300);
    await expect.poll(() => list.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
    expect(await scrollTop(page)).toBe(resting);
    await page.locator(".composer textarea").click();
    await expect(selector).toHaveCount(0);
    expect(await scrollTop(page)).toBe(resting);
    await group.click();
    const entry = selector.getByRole("button").nth(Math.floor(members / 2));
    const ordinal = Number(/^Message (\d+)/.exec((await entry.textContent()) ?? "")?.[1]);
    await entry.click();
    await expect(selector).toHaveCount(0);
    await expectJump(page, ordinal - 1);
    await expect(group).toBeFocused();
    await expect(status(page)).toHaveText(`Moved to message ${ordinal}`);
    // Resize and text size regroup from fresh measurements; markers stay beside the text.
    await page.setViewportSize({ width: 1024, height: 640 });
    await expect.poll(reads).toBeGreaterThan(0);
    // Regrouping keeps keyboard focus on the control that holds the chosen message.
    await expect
      .poll(() =>
        page.evaluate((chosen) => {
          const active = document.activeElement;
          const label = active?.matches("[data-nav-marker]") ? (active.getAttribute("aria-label") ?? "") : "";
          const range = /^Messages? (\d+)(?:–(\d+))?/.exec(label);
          return !!range && Number(range[1]) <= chosen && chosen <= Number(range[2] ?? range[1]);
        }, ordinal),
      )
      .toBe(true);
    await expectMapped(page);
    await shot(page, "narrow");
    await groups.last().hover();
    const tooltip = await page.getByRole("tooltip").boundingBox();
    expect(tooltip).toBeTruthy();
    expect((tooltip?.x ?? 0) + (tooltip?.width ?? 0)).toBeLessThanOrEqual(1024);
    expect((tooltip?.y ?? 0) + (tooltip?.height ?? 0)).toBeLessThanOrEqual(640);
    await page.locator('[data-i18n="nav.settings"]').click();
    await page.locator('[data-section="appearance"]').click();
    await page.locator("#interface-font-size").selectOption("1.5");
    await page.locator('[data-action="leave-settings"]').click();
    await page.locator(`[data-session="${sessionId}"]`).click();
    await expect(lane(page)).toBeVisible();
    await expectMapped(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await expectMapped(page);
  } finally {
    await server.close();
  }
});
