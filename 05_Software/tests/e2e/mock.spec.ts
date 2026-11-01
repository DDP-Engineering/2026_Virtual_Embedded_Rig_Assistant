import { spawn } from "node:child_process";
import { existsSync, readFileSync, renameSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { defaultSettings } from "@vera/shared";
import { changeSetting } from "./settings-navigation.js";

test("browser mock displays the same metadata screen through dev:renderer", async ({ page, context }) => {
  test.setTimeout(150_000);
  const manifest = JSON.parse(readFileSync("package.json", "utf8"));
  expect(manifest.scripts["dev:renderer"], "renderer-only dev entrypoint").toBe(
    "node scripts/dev-renderer.mjs",
  );
  const compiledShared = "src/libraries/shared/dist/index.js";
  const savedShared = `${compiledShared}.browser-backup`;
  expect(existsSync(savedShared), "no leftover generated-entry backup").toBe(false);
  const hadCompiledShared = existsSync(compiledShared);
  if (hadCompiledShared) renameSync(compiledShared, savedShared);
  const server = spawn(process.execPath, ["scripts/dev-renderer.mjs"], {
    env: { ...process.env, VITE_API: "mock" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const outbound: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1") await route.continue();
    else {
      outbound.push(url.href);
      await route.abort();
    }
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Renderer startup timeout: ${output}`)), 20000);
      const read = (chunk: Buffer) => {
        output += chunk.toString();
        if (output.includes("VERA_RENDERER_READY")) {
          clearTimeout(timer);
          resolve();
        }
      };
      server.stdout.on("data", read);
      server.stderr.on("data", read);
      server.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      server.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`Renderer exit ${code}: ${output}`));
      });
    });
    await page.goto("http://127.0.0.1:5173/");
    await expect(page.locator('[data-i18n="home.title"]')).toBeVisible();
    await expect(page.locator(".metadata")).toHaveCount(0);
    await page.locator('[data-i18n="nav.settings"]').click();
    await page.locator('[data-section="about"]').click();
    const version = JSON.parse(readFileSync("src/apps/desktop/package.json", "utf8")).version;
    await expect(page.locator('[data-info="version"]')).toHaveText(version);
    await expect(page.locator('[data-info="name"]')).toHaveText("VERA");
    await expect(page.locator('[data-info="platform"]')).toHaveText("linux");
    await expect(page.locator('[data-info="arch"]')).toHaveText("x64");
    await expect(page.locator('[data-info="locale"]')).toHaveText("en");
    await expect(page.locator('[data-info="portable"]')).toHaveText("No");
    expect(
      await page.evaluate(() => [
        typeof (window as unknown as { vera?: unknown }).vera,
        typeof require,
        typeof process,
      ]),
    ).toEqual(["undefined", "undefined", "undefined"]);
    await page.screenshot({ path: test.info().outputPath("mock-home.png") });
    expect(errors).toEqual([]);
    expect(outbound).toEqual([]);
    await page.locator('[data-i18n="nav.settings"]').click({ timeout: 2000 });
    for (const language of ["ro", "de", "en"]) {
      await changeSetting(page, "language", () => page.locator("#language").selectOption(language));
      await expect(page.locator('[data-i18n="settings.appearance"]')).toHaveText(
        language === "ro" ? "Aspect" : language === "de" ? "Darstellung" : "Appearance",
      );
    }
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await changeSetting(page, "appearance", () => page.locator('[data-theme-option="system"]').click());
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.emulateMedia({ colorScheme: "light" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    for (const width of [1280, 1279, 1024]) {
      await page.setViewportSize({ width, height: 640 });
      if ((await page.locator('[data-panel="right"]').count()) === 0)
        await page.locator('[data-toggle="right"]').click();
      await page.locator('[data-resize="right"]').focus();
      await page.keyboard.press("Home");
      await expect(page.locator('[data-resize="right"]')).toHaveAttribute("aria-valuenow", "14");
      await page.keyboard.press("End");
      await expect(page.locator('[data-resize="right"]')).toHaveAttribute("aria-valuenow", "28");
      const centre = await page.locator("main").boundingBox();
      const panel = await page.locator('[data-panel="right"]').boundingBox();
      if (!centre || !panel) throw new Error("Missing panel bounds");
      expect(panel.x < centre.x + centre.width).toBe(width < 1280);
      await page.locator('[data-toggle="right"]').click();
    }
    for (const theme of ["light", "dark", "system"]) {
      await changeSetting(page, "appearance", () => page.locator(`[data-theme-option="${theme}"]`).click());
      for (const scale of [0.875, 1, 1.125, 1.25, 1.5]) {
        await changeSetting(page, "appearance", () =>
          page.locator("#interface-font-size").selectOption(String(scale)),
        );
        await expect
          .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).fontSize))
          .toBe(`${14 * scale}px`);
        const overflow = await page.evaluate(() => ({
          page: document.documentElement.scrollWidth > innerWidth,
          elements: [...document.querySelectorAll("main, aside, section, button, select")]
            .filter((element) => {
              const box = element.getBoundingClientRect();
              return (
                box.width > 0 &&
                (box.right > innerWidth + 1 || box.left < -1 || element.scrollWidth > element.clientWidth + 1)
              );
            })
            .map((element) => element.outerHTML.slice(0, 160)),
        }));
        expect(overflow, `${theme}/${scale}`).toEqual({ page: false, elements: [] });
        expect(
          await page
            .locator(".typography-code-preview code")
            .evaluate((code) => getComputedStyle(code).fontSize),
        ).toBe("14px");
        expect(
          await page.locator("#interface-font-size").evaluate((button) => getComputedStyle(button).fontSize),
        ).toBe(`${14 * scale}px`);
        await page.locator('[data-toggle="right"]').click();
        expect(
          await page
            .locator('[data-panel="right"]')
            .evaluate((element) => element.scrollWidth <= element.clientWidth),
        ).toBe(true);
        for (const tab of ["context", "docs", "changes", "artifacts", "plan"]) {
          await page.locator(`#tab-${tab}`).click();
          await expect(page.locator(`#panel-${tab}`)).toBeVisible();
        }
        await page.locator('[data-toggle="right"]').click();
      }
      await page.screenshot({ path: test.info().outputPath(`settings-${theme}-150.png`) });
      const contrastFailures = await page.evaluate(() => {
        function luminance(color: string) {
          const values = (color.match(/[\d.]+/g) ?? []).slice(0, 3).map((part) => {
            const value = Number(part) / 255;
            return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
          });
          return (values[0] ?? 0) * 0.2126 + (values[1] ?? 0) * 0.7152 + (values[2] ?? 0) * 0.0722;
        }
        return [
          ...document.querySelectorAll("p,h1,h2,h3,dt,dd,code,button,label,legend,select,strong"),
        ].flatMap((element) => {
          if (!element.textContent?.trim()) return [];
          let ancestor: Element | null = element;
          let background = "rgba(0, 0, 0, 0)";
          while (ancestor && background === "rgba(0, 0, 0, 0)") {
            background = getComputedStyle(ancestor).backgroundColor;
            ancestor = ancestor.parentElement;
          }
          const light = luminance(getComputedStyle(element).color);
          const dark = luminance(background);
          const ratio = (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05);
          return ratio < 4.5 ? [{ text: element.textContent.trim(), ratio }] : [];
        });
      });
      expect(contrastFailures, `AA text contrast in ${theme}`).toEqual([]);
    }
    for (const language of ["ro", "de"]) {
      await changeSetting(page, "language", () => page.locator("#language").selectOption(language));
      for (const theme of ["light", "dark", "system"]) {
        await changeSetting(page, "appearance", () => page.locator(`[data-theme-option="${theme}"]`).click());
        for (const scale of [0.875, 1, 1.125, 1.25, 1.5]) {
          await changeSetting(page, "appearance", () =>
            page.locator("#interface-font-size").selectOption(String(scale)),
          );
          await expect
            .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).fontSize))
            .toBe(`${14 * scale}px`);
          expect(
            await page.evaluate(() =>
              [...document.querySelectorAll("main,aside,section,button,select")]
                .filter((element) => element.scrollWidth > element.clientWidth + 1)
                .map((element) => element.outerHTML.slice(0, 100)),
            ),
            `${language}/${theme}/${scale}`,
          ).toEqual([]);
          if (await page.locator('[data-action="leave-settings"]').isVisible())
            await page.locator('[data-action="leave-settings"]').click();
          await page.locator('[data-i18n="nav.welcome"]').click();
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
          await page.locator('[data-i18n="nav.settings"]').click();
        }
      }
    }
    await changeSetting(page, "language", () => page.locator("#language").selectOption("en"));
    // Provider editors participate in the localized minimum-size and keyboard contracts.
    await page.locator('[data-section="providers"]').click();
    const providerSection = page.locator('[data-settings-section="providers"]');
    const fakeKey = "fak-browser-only-private-middle-8Zx4";
    await providerSection.locator('[data-action="add-provider"]').click();
    await providerSection.getByLabel("OpenAI API key", { exact: true }).fill(fakeKey);
    await providerSection
      .locator('[data-provider-editor="openai"]')
      .getByRole("button", { name: "Save", exact: true })
      .click();
    await expect(providerSection.getByLabel("OpenAI API key", { exact: true })).toHaveCount(0);
    await expect(providerSection.locator("[data-provider-hint]")).toHaveText("fak…8Zx4");
    expect(await page.locator("body").innerText()).not.toContain("browser-only-private-middle");
    await providerSection.getByRole("button", { name: "Add connection", exact: true }).click();
    await providerSection.getByLabel("Endpoint name", { exact: true }).fill("Browser fixture");
    await providerSection.getByLabel("Model", { exact: true }).fill("fake-browser-model");
    const localizedNames = { en: "Endpoint name", ro: "Numele endpoint-ului", de: "Name des Endpunkts" };
    for (const language of ["en", "ro", "de"] as const) {
      await changeSetting(page, "language", () => page.locator("#language").selectOption(language));
      await expect(providerSection.getByLabel(localizedNames[language], { exact: true })).toHaveValue(
        "Browser fixture",
      );
      for (const scale of [0.875, 1, 1.125, 1.25, 1.5]) {
        await changeSetting(page, "appearance", () =>
          page.locator("#interface-font-size").selectOption(String(scale)),
        );
        expect(
          await page.evaluate(() =>
            [...document.querySelectorAll("section,fieldset,input,button")]
              .filter((e) => e.scrollWidth > e.clientWidth + 1)
              .map((e) => e.outerHTML.slice(0, 100)),
          ),
        ).toEqual([]);
      }
    }
    await changeSetting(page, "language", () => page.locator("#language").selectOption("en"));
    // Real keyboard traversal of every enabled control, including off-screen controls scrolled by focus.
    const controls = await page
      .locator(
        "button:enabled:visible:not([tabindex='-1']), select:enabled:visible, input:enabled:visible, textarea:enabled:visible, [data-resize]:visible",
      )
      .count();
    await page.evaluate(() => {
      document.body.tabIndex = -1;
      document.body.focus();
      document.body.removeAttribute("tabindex");
    });
    const visited = new Set<string>();
    for (let step = 0; step < controls; step++) {
      await page.keyboard.press("Tab");
      const focus = await page.evaluate(() => {
        const element = document.activeElement as HTMLElement;
        const style = getComputedStyle(element);
        return {
          id: element.outerHTML,
          ring: style.outlineStyle,
          width: Number.parseFloat(style.outlineWidth),
          color: style.outlineColor,
          matches: element.matches(":focus-visible"),
          transition: style.transitionDuration,
        };
      });
      expect(focus.matches).toBe(true);
      expect(focus.ring).toBe("solid");
      expect(focus.width).toBeGreaterThanOrEqual(2);
      expect(focus.transition).toBe("0s");
      visited.add(focus.id);
    }
    expect(visited.size).toBe(controls);
    await providerSection
      .locator('[data-provider-editor="custom"]')
      .getByRole("button", { name: "Save", exact: true })
      .click();
    await expect(providerSection.locator('[data-provider="custom:browser-fixture"]')).toContainText(
      "fake-browser-model",
    );
    const testedProvider = providerSection.locator('[data-provider="custom:browser-fixture"]');
    for (const language of ["en", "ro", "de"] as const) {
      await changeSetting(page, "language", () => page.locator("#language").selectOption(language));
      const control = testedProvider.locator('[data-provider-test="custom:browser-fixture"]');
      await expect(control).toHaveText(
        language === "ro" ? "Testează" : language === "de" ? "Testen" : "Test",
      );
      await control.focus();
      await page.keyboard.press("Enter");
      await expect(testedProvider.locator('[data-i18n="providers.testComplete"]')).toBeVisible();
      await expect(testedProvider.locator("[data-test-step]")).toHaveCount(4);
      await expect(testedProvider.locator('[data-test-status="pass"]')).toHaveCount(4);
      await page.keyboard.press("Escape");
      expect(await page.locator("body").innerText()).not.toContain("browser-only-private-middle");
    }
    await changeSetting(page, "language", () => page.locator("#language").selectOption("en"));
    await providerSection
      .locator('[data-provider="custom:browser-fixture"]')
      .getByRole("button", { name: "Remove Browser fixture", exact: true })
      .click();
    await expect(providerSection.locator('[data-provider="custom:browser-fixture"]')).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath("keyboard-focus.png") });
    // Every section is reachable, with future capabilities represented explicitly as placeholders.
    for (const section of ["providers", "updates", "data", "about", "language", "appearance"]) {
      await page.locator(`[data-section="${section}"]`).click();
      await expect(page.locator(`[data-settings-section="${section}"]`)).toBeInViewport();
    }
    if (await page.locator('[data-action="leave-settings"]').isVisible())
      await page.locator('[data-action="leave-settings"]').click();
    await page.locator('[data-i18n="nav.welcome"]').click();
    await page.keyboard.press("Control+,");
    await page.locator('[data-section="language"]').click();
    await expect(page.locator("#language")).toBeVisible();
    await changeSetting(page, "appearance", () => page.locator('[data-theme-option="light"]').click());
    await changeSetting(page, "appearance", () => page.locator("#interface-font-size").selectOption("1"));
    if (await page.locator('[data-action="leave-settings"]').isVisible())
      await page.locator('[data-action="leave-settings"]').click();
    await page.locator('[data-i18n="nav.welcome"]').click();
    await page.locator('[data-action="choose-create"]').click();
    if (await page.locator('[data-action="leave-settings"]').isVisible())
      await page.locator('[data-action="leave-settings"]').click();
    await page.locator('[data-i18n="nav.welcome"]').click();
    await page.locator("#workbench-name").fill("Browser board");
    await page.locator('[data-action="create-workbench"]').click();
    await expect(page.locator('[data-workbench="active"]')).toContainText("Browser board");
    await page.locator('[data-i18n="nav.settings"]').click();
    await expect(page.locator('[data-i18n="nav.welcome"]')).not.toBeVisible();
    await expect(page.locator('[data-action="open-workbench-nav"]')).not.toBeVisible();
    await page.locator('[data-action="leave-settings"]').click();
    await expect(page.locator('[data-workbench="active"]')).toContainText("Browser board");
    // Below 1280 px the right panel overlays page content; the editor is a page, so close it first.
    if ((await page.locator('[data-toggle="right"]').getAttribute("aria-expanded")) === "true")
      await page.locator('[data-toggle="right"]').click();
    await page.locator('[data-action="edit-workbench-overview"]').click();
    await page.locator('[data-project-section="instructions"]').click();
    await expect(page.locator("#pinned-content")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.locator(".workbench-editor")).not.toBeVisible();
    await expect(page.locator('[data-action="edit-workbench-overview"]')).toBeFocused();
    await page.locator('[data-action="edit-workbench-overview"]').click();
    await page.locator('[data-project-section="instructions"]').click();
    await page.locator("#pinned-content").fill("ă".repeat(9000));
    await expect(page.locator(".workbench-editor").getByRole("status")).toBeVisible();
    await page.locator("[data-project-save]").click();
    await expect(page.locator(".workbench-editor")).not.toBeVisible();
    await page.locator("[data-workbench-entry] .workbench-menu summary").first().click();
    await page.locator('[data-action="close-workbench"]').click();
    // Control the second load to expose stale cached editor data and draft replacement.
    await context.route("**/api/index.*", (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: `import { createMockApi } from "/mocks/mockApi.ts";
          const base = createMockApi(undefined, "warnings").api;
          window.pinnedReads = 0;
          window.blockPinned = false;
          const pendingReads = [];
          window.releasePinned = () => {
            window.blockPinned = false;
            pendingReads.splice(0).forEach(resolve => resolve());
          };
          export const api = { ...base, invoke: async (channel, request) => {
            if (channel === "workbench.pinned.get") {
              window.pinnedReads++;
              if (window.blockPinned) await new Promise(resolve => pendingReads.push(resolve));
            }
            return base.invoke(channel, request);
          }};`,
      }),
    );
    await page.reload();
    if (await page.locator('[data-action="leave-settings"]').isVisible())
      await page.locator('[data-action="leave-settings"]').click();
    await page.locator('[data-i18n="nav.welcome"]').click();
    await page.locator("[data-workbench-entry] .workbench-group-name").click();
    await page.locator('[data-action="edit-workbench-overview"]').click();
    await page.locator('[data-project-section="instructions"]').click();
    await expect(page.locator("#pinned-content")).toHaveValue("ă".repeat(9000));
    await page.locator("#pinned-content").fill("saved current context");
    await page.locator("[data-project-save]").click();
    await expect(page.locator(".workbench-editor")).not.toBeVisible();
    const previousReads = await page.evaluate(() => {
      const state = window as unknown as { pinnedReads: number; blockPinned: boolean };
      state.blockPinned = true;
      return state.pinnedReads;
    });
    await page.locator('[data-action="edit-workbench-overview"]').click();
    await page.locator('[data-project-section="instructions"]').click();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { pinnedReads: number }).pinnedReads))
      .toBeGreaterThan(previousReads);
    await expect(page.locator(".workbench-editor").getByRole("status")).toBeVisible();
    await expect(page.locator("#pinned-content")).toBeDisabled();
    await page.evaluate(() => (window as unknown as { releasePinned: () => void }).releasePinned());
    await expect(page.locator("#pinned-content")).toHaveValue("saved current context");
    await page.locator("#pinned-content").fill("unsaved draft");
    const loadedReads = await page.evaluate(() => (window as unknown as { pinnedReads: number }).pinnedReads);
    await page.evaluate(async () => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
    });
    expect(await page.evaluate(() => (window as unknown as { pinnedReads: number }).pinnedReads)).toBe(
      loadedReads,
    );
    await expect(page.locator("#pinned-content")).toHaveValue("unsaved draft");
    await page.keyboard.press("Escape");
    await context.unroute("**/api/index.*");
    // Seed mock-only fixture states at the established browser module seam.
    await context.route("**/api/index.*", (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: 'import { createMockApi } from "/mocks/mockApi.ts"; export const api = createMockApi(undefined, "read-only").api;',
      }),
    );
    await page.reload();
    if (await page.locator('[data-action="leave-settings"]').isVisible())
      await page.locator('[data-action="leave-settings"]').click();
    await page.locator('[data-i18n="nav.welcome"]').click();
    await page.locator("[data-workbench-entry] .workbench-group-name").click();
    await page.locator('[data-action="edit-workbench-overview"]').click();
    await page.locator('[data-project-section="instructions"]').click();
    await expect(page.locator("#pinned-content")).toHaveAttribute("readonly", "");
    await expect(page.locator("[data-project-save]")).toBeDisabled();
    await page.keyboard.press("Escape");
    await context.unroute("**/api/index.*");
    await context.route("**/api/index.*", (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: 'import { createMockApi } from "/mocks/mockApi.ts"; export const api = createMockApi(undefined, "missing").api;',
      }),
    );
    await page.reload();
    if (await page.locator('[data-action="leave-settings"]').isVisible())
      await page.locator('[data-action="leave-settings"]').click();
    await page.locator('[data-i18n="nav.welcome"]').click();
    const missing = page.locator('[data-workbench-entry][data-missing="true"]');
    await expect(missing).toBeVisible();
    await expect(missing.locator(".workbench-group-name")).toBeDisabled();
    await missing.locator(".workbench-menu > summary").click();
    await missing.getByRole("button", { name: "Remove from list", exact: true }).click();
    await expect(missing).toHaveCount(0);
    await context.unroute("**/api/index.*");
    // Replace the API module at the browser network seam; UI must translate a structured failure.
    await context.route("**/api/index.*", (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: 'import { createMockApi } from "/mocks/mockApi.ts"; const base = createMockApi().api; export const api = { ...base, getAppInfo: async () => { throw { code: "INTERNAL", messageKey: "errors.INTERNAL" }; } };',
      }),
    );
    await page.reload();
    await expect(page.getByRole("alert")).toHaveAttribute("data-i18n", "errors.INTERNAL");
    await expect(page.getByRole("alert")).toHaveText("An internal application error occurred. Retry.");
    expect(errors).toEqual([]);
    expect(outbound).toEqual([]);
    const failedSettings = {
      settings: {
        ...defaultSettings("1b9dc50c-d87d-484b-88e6-04cb5f7c5a19"),
        language: "ro",
        theme: "light",
      },
      readOnly: false,
    };
    await context.unroute("**/api/index.*");
    await context.route("**/api/index.*", (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: `import { createMockApi } from "/mocks/mockApi.ts"; const base=createMockApi().api; const snapshot = ${JSON.stringify(failedSettings)}; export const api = { ...base, getAppInfo: async () => ({ name:"VERA",version:"0.0.0",platform:"linux",arch:"x64",locale:"en",portable:false }), getSettings: async () => snapshot, subscribe: () => () => {}, updateSettings: async () => { throw {code:"NOT_FOUND",messageKey:"errors.NOT_FOUND",params:{operation:"probe"}}; } };`,
      }),
    );
    await page.reload();
    await page.locator('[data-i18n="nav.settings"]').click();
    await changeSetting(page, "appearance", () => page.locator('[data-theme-option="dark"]').click());
    await expect(page.getByRole("alert")).toHaveText("Operația solicitată probe nu a fost găsită.");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page.locator('[data-theme-option="light"]')).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('[data-theme-option="dark"]')).toBeEnabled();
    expect(errors).toEqual([]);
    // Chat fixtures use the ordinary browser bridge, across localized minimum-size presentation.
    await context.unroute("**/api/index.*");
    for (const language of ["en", "ro", "de"] as const) {
      for (const theme of ["light", "dark"] as const) {
        const settings = {
          ...defaultSettings("1b9dc50c-d87d-484b-88e6-04cb5f7c5a19"),
          language,
          theme,
          textScale: 1.5 as const,
        };
        await context.route("**/api/index.*", (route) =>
          route.fulfill({
            contentType: "application/javascript",
            body: `import { createMockApi } from "/mocks/mockApi.ts"; const base=createMockApi(undefined,"chat").api; export const api={...base,getSettings:async()=>({settings:${JSON.stringify(settings)},readOnly:false})};`,
          }),
        );
        await page.reload();
        await page.setViewportSize({ width: 1024, height: 640 });
        if (await page.locator('[data-action="leave-settings"]').isVisible())
          await page.locator('[data-action="leave-settings"]').click();
        await page.locator('[data-i18n="nav.welcome"]').click();
        await page.locator("[data-workbench-entry] .workbench-group-name").click();
        await page.locator("[data-session]").filter({ hasText: "Tool rows" }).focus();
        await page.keyboard.press("Enter");
        await expect(page.locator("[data-tool-row]")).toHaveCount(2);
        await expect(page.locator('[data-citation="valid"]')).toHaveCount(1);
        await expect(page.locator("html")).toHaveAttribute("lang", language);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        const detail = page.locator("[data-tool-row]").first();
        await detail.locator("button").focus();
        await page.keyboard.press("Space");
        await expect(detail.locator("button")).toHaveAttribute("aria-expanded", "true");
        await expect(detail.locator("pre").last()).toContainText("Source line");
        await context.unroute("**/api/index.*");
      }
    }
    expect(errors).toEqual([]);
    expect(outbound).toEqual([]);
  } finally {
    server.kill();
    await new Promise<void>((resolve) => {
      if (server.exitCode !== null) resolve();
      else server.once("exit", () => resolve());
    });
    if (hadCompiledShared) renameSync(savedShared, compiledShared);
  }
});
