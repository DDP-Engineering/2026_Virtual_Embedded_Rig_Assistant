import { expect, test } from "@playwright/test";
import { resolveConfig } from "electron-vite";
import { createServer } from "vite";
import { changeSetting } from "./settings-navigation.js";

test("provider categories support concurrent connections, presets and aligned actions", async ({
  page,
  context,
}) => {
  test.setTimeout(120000);
  const resolved = await resolveConfig({ root: "src/apps/desktop" }, "serve", "development");
  const renderer = resolved.config?.renderer;
  if (!renderer) throw Error("Missing renderer config");
  const server = await createServer({
    ...renderer,
    define: { ...renderer.define, "import.meta.env.VITE_API": JSON.stringify("mock") },
    server: { ...renderer.server, port: 0, strictPort: false, hmr: false },
  });
  const errors: string[] = [],
    outbound: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await context.route("**/*", async (route) => {
    if (new URL(route.request().url()).hostname === "127.0.0.1") await route.continue();
    else {
      outbound.push(route.request().url());
      await route.abort();
    }
  });
  try {
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") throw Error("Missing local server address");
    await page.setViewportSize({ width: 1024, height: 640 });
    await page.goto(`http://127.0.0.1:${address.port}`);

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.locator('[data-i18n="nav.settings"]').click();
    await page.locator('[data-section="providers"]').click();
    const section = page.locator('[data-settings-section="providers"]');
    const subscription = section.locator('[data-provider="chatgpt"]');
    await expect(section.locator('[data-provider-group="subscriptions"]')).toBeVisible();
    await expect(section.locator('[data-provider-group="api"]')).toBeVisible();
    await expect(section.locator("[data-provider-editor]")).toHaveCount(0);
    await subscription.getByRole("button", { name: "Sign in with ChatGPT", exact: true }).click();
    await subscription
      .getByLabel("Paste the final redirect URL if sign-in does not complete")
      .fill("http://127.0.0.1:1455/auth/callback?code=mock-ui");
    await subscription.getByRole("button", { name: "Complete sign-in", exact: true }).click();
    await expect(subscription.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
    await expect(subscription.getByRole("button", { name: "Sign in with ChatGPT", exact: true })).toHaveCount(
      0,
    );
    await expect(subscription).not.toContainText("port 1455");
    await section.locator('[data-action="add-provider"]').click();
    await expect(section.locator("[data-provider-preset]")).toHaveValue("openai");
    const secret = "fak-ui-only-private-9Zx4";
    await section.getByLabel("OpenAI API key", { exact: true }).fill(secret);
    await section.getByLabel("OpenAI model (optional)", { exact: true }).fill("mock-openai");
    await expect(section.locator('[data-provider-editor="openai"] [data-provider-test]')).toHaveCount(0);
    await section.locator('[data-provider-action="save-openai"]').click();
    await expect(section.locator("[data-provider-editor]")).toHaveCount(0);
    await expect(section.locator('[data-provider="openai"] [data-provider-hint]')).toHaveText("fak…9Zx4");
    await expect(section).not.toContainText(secret);
    await section.locator('[data-action="add-provider"]').click();
    await section.locator("[data-provider-preset]").selectOption("ollama");
    await section.getByLabel("Endpoint API key", { exact: true }).fill("private-draft");
    await section.locator("[data-provider-preset]").selectOption("lmstudio");
    await expect(section.getByLabel("Endpoint API key", { exact: true })).toHaveValue("");
    await expect(section.getByLabel("Base URL", { exact: true })).toHaveValue("http://localhost:1234");
    await section.locator('[data-action="discover-models"]').click();
    await expect(section.locator("[data-discovered-model]")).toHaveValue("mock-local");
    await expect(section.locator("[data-model-loaded]")).toContainText("65536");
    await section.locator("[data-model-reasoning]").selectOption("off");
    await section.locator("[data-model-temperature]").fill("0");
    await section.locator("[data-discovered-model]").selectOption("mock-small");
    await expect(section.locator("[data-model-reasoning]")).toHaveCount(0);
    await section.locator("[data-model-temperature]").fill("0.7");
    await section.locator("[data-discovered-model]").selectOption("mock-local");
    await expect(section.locator("[data-model-temperature]")).toHaveValue("0");
    await section.locator('[data-provider-action="save-lmstudio"]').click();
    await expect(section.locator('[data-provider="custom:lm-studio"]')).toBeVisible();
    await section.locator('[data-action="add-provider"]').click();
    await section.locator("[data-provider-preset]").selectOption("ollama");
    await expect(section.getByLabel("Base URL", { exact: true })).toHaveValue("http://localhost:11434/v1");
    await section.getByLabel("Model", { exact: true }).fill("mock-ollama");
    await section.locator('[data-provider-action="save-custom"]').click();
    await expect(section.locator(".provider-list > li")).toHaveCount(3);
    const row = section.locator('[data-provider="openai"]');
    await row.getByRole("button", { name: "Edit OpenAI API", exact: true }).click();
    await expect(row.locator('[data-provider-editor="openai"]')).toBeVisible();
    const editingButtons = row.locator(".provider-actions button");
    await expect(editingButtons).toHaveCount(4);
    const editYs = await editingButtons.evaluateAll((buttons) =>
      buttons.map((button) => button.getBoundingClientRect().y),
    );
    expect(Math.max(...editYs) - Math.min(...editYs)).toBeLessThan(2);
    await row.getByRole("button", { name: "Cancel", exact: true }).click();
    await row.locator("[data-provider-test]").click();
    await expect(row.locator('[data-test-status="pass"]')).toHaveCount(4);
    for (const language of ["en", "ro", "de"]) {
      await changeSetting(page, "language", () => page.locator("#language").selectOption(language));
      for (const scale of ["0.75", "1", "1.5"]) {
        await changeSetting(page, "appearance", () =>
          page.locator("#interface-font-size").selectOption(scale),
        );
        await page.setViewportSize({ width: 1024, height: 640 });
        const ys = await row
          .locator(".provider-actions button")
          .evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().y));
        expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(2);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
    }
    await changeSetting(page, "language", () => page.locator("#language").selectOption("en"));
    await subscription.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(
      subscription.getByRole("button", { name: "Sign in with ChatGPT", exact: true }),
    ).toBeVisible();
    await expect(subscription.getByRole("button", { name: "Sign out", exact: true })).toHaveCount(0);
    await expect(section.locator(".provider-list > li")).toHaveCount(3);
    await section.locator('[data-action="add-provider"]').click();
    await section.locator("[data-provider-preset]").selectOption("other");
    await expect(section.getByLabel("Base URL", { exact: true })).toHaveValue("");
    await section.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(section.locator("[data-provider-editor]")).toHaveCount(0);
    expect(errors).toEqual([]);
    expect(outbound).toEqual([]);
  } finally {
    await server.close();
  }
});
