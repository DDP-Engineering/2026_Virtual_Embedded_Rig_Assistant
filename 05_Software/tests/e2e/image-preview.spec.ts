import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { _electron, expect, type Page } from "@playwright/test";
import type { Channel, Request, Response, VeraBridge } from "@vera/shared";
import { productionCsp } from "../../src/apps/desktop/src/main/content-policy.js";
import { imagePreviewFixtures } from "../support/image-preview-fixtures.js";
import { test } from "./fixtures.js";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";

const evidence = resolve("test-outputs/view06");
const panel = (page: Page) => page.locator("[data-source-current]");
const invoke = <C extends Channel>(page: Page, channel: C, request: Request<C>): Promise<Response<C>> =>
  page.evaluate(
    async ({ channel, request }) =>
      (window as unknown as { vera: VeraBridge }).vera.invoke(channel as never, request as never),
    { channel, request },
  ) as Promise<Response<C>>;
async function choose(page: Page, mode: string) {
  await panel(page).locator(`[data-viewer-mode="${mode}"]`).click();
  await expect(panel(page).locator(`[data-viewer-mode="${mode}"]`)).toHaveAttribute("aria-pressed", "true");
}
async function trackResources(page: Page) {
  await page.evaluate(() => {
    const revoked: string[] = [];
    const original = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = (url) => {
      revoked.push(url);
      original(url);
    };
    Object.assign(window, { __imageScriptRan: false, __imageRevoked: revoked });
  });
}
async function decoded(page: Page) {
  await expect(panel(page).locator("[data-image-preview]")).toBeVisible();
  await expect
    .poll(() =>
      panel(page)
        .locator("img")
        .evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
    )
    .toBe(true);
}
async function geometry(page: Page) {
  return panel(page)
    .locator("[data-image-preview]")
    .evaluate((image: HTMLImageElement) => {
      const rect = image.getBoundingClientRect();
      const viewport = image.closest("[data-image-viewport]") as HTMLElement;
      return {
        width: rect.width,
        height: rect.height,
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
        boxWidth: viewport.clientWidth,
        boxHeight: viewport.clientHeight,
        src: image.src,
      };
    });
}
async function inspect(
  page: Page,
  names: string[],
  label: string,
  open: (name: string) => Promise<void>,
  resize?: () => Promise<void>,
) {
  const results: Record<string, unknown> = {};
  const startUrl = page.url();
  for (const name of names) {
    await open(name);
    await decoded(page);
    const fit = await geometry(page);
    expect(fit.width).toBeLessThanOrEqual(fit.boxWidth + 1);
    expect(fit.height).toBeLessThanOrEqual(fit.boxHeight + 1);
    if (name.endsWith(".png")) {
      await panel(page).locator("[data-image-zoom]").selectOption("400");
      const rasterZoom = await geometry(page);
      expect(rasterZoom.width).toBe(fit.naturalWidth * 4);
      expect(rasterZoom.src).toBe(fit.src);
      await page.screenshot({ path: join(evidence, `${label}-png-400.png`) });
      await panel(page).locator("[data-image-zoom]").selectOption("fit");
    }
    await choose(page, "hex");
    await expect(panel(page).locator('[data-hex-byte="0"]')).toBeVisible();
    const firstByte = await panel(page).locator('[data-hex-byte="0"]').innerText();
    expect(firstByte).toBe(
      ({ png: "89", jpg: "FF", gif: "47", webp: "52", bmp: "42", svg: "3C" } as Record<string, string>)[
        name.split(".").at(-1) ?? ""
      ],
    );
    await choose(page, "rendered");
    await decoded(page);
    results[name] = { fit, firstByte };
  }
  expect(page.url()).toBe(startUrl);
  await panel(page)
    .locator("img")
    .click({ position: { x: 10, y: 10 }, force: true });
  expect(page.url()).toBe(startUrl);
  expect(await page.evaluate(() => Reflect.get(window, "__imageScriptRan"))).toBe(false);
  expect(await panel(page).locator("svg, iframe, object, embed").count()).toBe(0);
  if (await page.locator("#tab-docs").isVisible()) await page.locator('[data-toggle="right"]').click();
  const before = await geometry(page);
  await page.screenshot({ path: join(evidence, `${label}-fit.png`) });
  await panel(page).locator("[data-image-zoom]").selectOption("400");
  const full = await geometry(page);
  expect(full.width).toBe(before.naturalWidth * 4);
  expect(full.height).toBe(before.naturalHeight * 4);
  expect(full.src).toBe(before.src);
  await page.screenshot({ path: join(evidence, `${label}-400.png`) });
  await panel(page).locator("[data-image-zoom]").selectOption("50");
  expect((await geometry(page)).width).toBe(before.naturalWidth / 2);
  await panel(page).locator("[data-image-zoom]").selectOption("fit");
  const image = panel(page).locator("img");
  if (resize) await resize();
  else await page.locator('[data-toggle="right"]').click();
  await expect.poll(async () => (await geometry(page)).boxWidth).not.toBe(before.boxWidth);
  await expect
    .poll(async () => {
      const current = await geometry(page);
      const fitted =
        Math.min(1, current.boxWidth / current.naturalWidth, current.boxHeight / current.naturalHeight) *
        current.naturalWidth;
      return Math.abs(current.width - fitted);
    })
    .toBeLessThan(0.5);
  const resized = await geometry(page);
  expect(resized.width).toBeCloseTo(
    Math.min(1, resized.boxWidth / resized.naturalWidth, resized.boxHeight / resized.naturalHeight) *
      resized.naturalWidth,
    0,
  );
  expect(await image.getAttribute("src")).toBe(before.src);
  results.zoom = { fit: before, full, resized, sameOriginalResource: true };
  return results;
}

test("browser previews six formats with inert SVG, Hex and original-image400 percent zoom", {
  tag: "@parallel-browser",
}, async ({ page, rendererUrl }) => {
  test.setTimeout(90000);
  await mkdir(evidence, { recursive: true });
  const fixtures = await imagePreviewFixtures(page);
  const errors: string[] = [],
    requests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (request.url().includes("image-probe")) requests.push(request.url());
  });
  try {
    await page.goto(`${rendererUrl}/?mock=chat`);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.evaluate(async (fixtures) => {
      const modulePath = "/api/index.ts";
      const { api } = await import(modulePath);
      const original = api.invoke.bind(api);
      const calls: { channel: string; offset?: number; length?: number }[] = [];
      Object.assign(window, { __imageCalls: calls });
      api.invoke = async (
        channel: string,
        input: { path?: string; workbenchId: string; offset: number; length: number },
      ) => {
        const value = fixtures[input.path ?? ""];
        if (channel === "docs.tree" && input.path === "") {
          const reply = await original(channel, input);
          return {
            ...reply,
            entries: [
              ...reply.entries,
              ...Object.keys(fixtures).map((path) => ({ path, name: path, type: "file", ignored: false })),
            ],
          };
        }
        if (value !== undefined && ["docs.stat", "docs.readBytes", "docs.open"].includes(channel)) {
          calls.push({ channel, offset: input.offset, length: input.length });
          const bytes = atob(value);
          if (channel === "docs.open") throw Error("Images must not use indexing");
          if (channel === "docs.stat")
            return {
              workbenchId: input.workbenchId,
              properties: {
                path: input.path,
                type: "file",
                extension: `.${input.path?.split(".").at(-1)}`,
                size: bytes.length,
                modified: null,
                rendered: false,
              },
            };
          return {
            workbenchId: input.workbenchId,
            path: input.path,
            size: bytes.length,
            offset: input.offset,
            data: btoa(bytes.slice(input.offset, input.offset + input.length)),
          };
        }
        return original(channel, input);
      };
    }, fixtures);
    await trackResources(page);
    await page.locator("[data-workbench-entry] .workbench-group-name").click();
    await page.locator('[data-toggle="right"]').click();
    await page.locator("#tab-docs").click();
    const results = await inspect(page, Object.keys(fixtures), "browser", async (name) => {
      await page.locator(`[data-tree-path="${name}"]`).click();
    });
    const calls = (await page.evaluate(() => Reflect.get(window, "__imageCalls"))) as {
      channel: string;
      length?: number;
    }[];
    expect(
      calls
        .filter((call) => call.channel === "docs.readBytes")
        .every((call) => (call.length ?? Infinity) <= 65536),
    ).toBe(true);
    expect(requests).toEqual([]);
    expect(errors).toEqual([]);
    await writeFile(
      join(evidence, "browser-receipt.json"),
      JSON.stringify({ results, calls, requests, errors }, null, 2),
    );
  } finally {
    if (!page.isClosed())
      await page.screenshot({ path: join(evidence, "browser-final.png") }).catch(() => {});
  }
});

test("native previews six unindexed formats and refreshes masked SVG bytes without stale URLs", async ({
  page: generator,
}) => {
  test.setTimeout(120000);
  await mkdir(evidence, { recursive: true });
  const fixtures = await imagePreviewFixtures(generator);
  const scratch = await mkdtemp(join(evidence, "native-owned-")),
    folder = join(scratch, "bench"),
    profile = join(scratch, "profile");
  await mkdir(folder);
  await mkdir(profile);
  for (const [name, data] of Object.entries(fixtures))
    await writeFile(join(folder, name), Buffer.from(data, "base64"));
  await writeFile(join(folder, "corrupt.png"), "invalid image");
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({
    executablePath: resolve(
      "node_modules/electron/dist",
      process.platform === "win32" ? "electron.exe" : "electron",
    ),
    args: [resolve("src/apps/desktop"), `--user-data-dir=${profile}`],
    env,
    chromiumSandbox: true,
  });
  const errors: string[] = [],
    requests: string[] = [],
    consoleMessages: string[] = [];
  try {
    await installNetworkGuard(app);
    const page = await app.firstWindow();
    page.on("console", (message) => consoleMessages.push(message.text()));
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (request.url().includes("image-probe")) requests.push(request.url());
    });
    expect(await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content")).toBe(
      productionCsp,
    );
    expect(
      await page.evaluate(async () => (await fetch(location.href)).headers.get("Content-Security-Policy")),
    ).toBe(productionCsp);
    const injectedRan = await page.evaluate(async () => {
      Object.assign(window, { __imageInjectedRan: false });
      const script = document.createElement("script");
      script.textContent = "window.__imageInjectedRan = true";
      document.body.append(script);
      await new Promise((resolve) => setTimeout(resolve, 20));
      script.remove();
      return Reflect.get(window, "__imageInjectedRan");
    });
    expect(injectedRan).toBe(false);
    await invoke(page, "app.settings.update", { language: "en" });
    const bench = await invoke(page, "workbench.create", {
      folder,
      name: "VIEW06",
      config: { docs: { include: [], exclude: [] } },
    });
    const workbenchId = bench.config.id;
    const session = await invoke(page, "session.create", { workbenchId });
    await invoke(page, "mqtt.credentials.save", {
      ref: "view06-name",
      password: "view06-private",
      storageConsent: true,
    });
    await invoke(page, "app.settings.update", { privacy: { mask: { display: true } } });
    await page.reload();
    await trackResources(page);
    await page.locator(`[data-session="${session.id}"]`).click();
    await page.locator('[data-toggle="right"]').click();
    await page.locator("#tab-docs").click();
    const tree = await invoke(page, "docs.tree", { workbenchId, path: "" });
    const identity = tree.entries.find((entry) => entry.name === "[REDACTED].svg")?.path ?? "";
    expect(identity).toBeTruthy();
    expect(identity).not.toContain("view06-private");
    const results = await inspect(
      page,
      Object.keys(fixtures),
      "native",
      async (name) => {
        await page.locator(`[data-tree-path="${name.endsWith(".svg") ? identity : name}"]`).click();
      },
      async () => {
        await app.evaluate(({ BrowserWindow }) => {
          BrowserWindow.getAllWindows()[0]?.setContentSize(1024, 640);
        });
      },
    );
    expect((await invoke(page, "docs.list", { workbenchId })).documents).toHaveLength(0);
    const originalUrl = await panel(page).locator("img").getAttribute("src");
    await invoke(page, "mqtt.credentials.save", {
      ref: "view06-bytes",
      password: "http://www.w3.org/2000/svg",
      storageConsent: true,
    });
    await invoke(page, "app.settings.update", { privacy: { mask: { display: false } } });
    await decoded(page);
    await invoke(page, "app.settings.update", { privacy: { mask: { display: true } } });
    await expect(panel(page).locator("[data-image-retry]")).toBeVisible();
    await expect(panel(page)).toContainText("Cannot preview this image");
    expect(
      await page.evaluate(
        (url) => (Reflect.get(window, "__imageRevoked") as string[]).includes(url ?? ""),
        originalUrl,
      ),
    ).toBe(true);
    await choose(page, "hex");
    await expect(panel(page).locator('[data-hex-byte="0"]')).toHaveText("3C");
    const masked = await invoke(page, "docs.readBytes", {
      workbenchId,
      path: identity,
      offset: 0,
      length: 1024,
    });
    expect(Buffer.from(masked.data, "base64").toString()).not.toContain("http://www.w3.org/2000/svg");
    await invoke(page, "app.settings.update", { privacy: { mask: { display: false } } });
    await choose(page, "rendered");
    await decoded(page);
    // Both failed image bytes and current changed-file state recover through the parent Retry.
    if (!(await page.locator("#tab-docs").isVisible())) await page.locator('[data-toggle="right"]').click();
    await page.locator('[data-tree-path="corrupt.png"]').click();
    await expect(panel(page).locator("[data-image-retry]")).toBeVisible();
    await choose(page, "hex");
    await expect(panel(page).locator('[data-hex-byte="0"]')).toHaveText("69");
    await choose(page, "rendered");
    await expect(panel(page).locator("[data-image-retry]")).toBeVisible();
    await writeFile(join(folder, "corrupt.png"), Buffer.from(fixtures["preview.png"] ?? "", "base64"));
    await panel(page).locator("[data-image-retry]").click();
    await decoded(page);
    for (const language of ["en", "ro", "de", "fr"] as const) {
      await invoke(page, "app.settings.update", { language });
      await expect(panel(page).locator("[data-image-zoom]")).toBeVisible();
      expect(
        await panel(page)
          .locator("[data-image-zoom]")
          .evaluate((select) => select.getBoundingClientRect().right <= window.innerWidth),
      ).toBe(true);
    }
    expect(await outboundAttempts(app)).toEqual([]);
    expect(requests).toEqual([]);
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => Reflect.get(window, "__imageScriptRan"))).toBe(false);
    await writeFile(
      join(evidence, "native-receipt.json"),
      JSON.stringify(
        {
          results,
          identityOpaque: true,
          indexedDocuments: 0,
          displayRefresh: true,
          corruptRetry: true,
          locales: 4,
          requests,
          errors,
          outboundAttempts: await outboundAttempts(app),
        },
        null,
        2,
      ),
    );
  } finally {
    const page = await app.firstWindow().catch(() => undefined);
    if (page && !page.isClosed())
      await page.screenshot({ path: join(evidence, "native-final.png") }).catch(() => {});
    await writeFile(join(evidence, "native-console.log"), consoleMessages.join("\n"));
    await app.close();
  }
});
