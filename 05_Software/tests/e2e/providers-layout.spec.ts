import { expect } from "@playwright/test";
import { test } from "./fixtures.js";
import { changeSetting } from "./settings-navigation.js";

test("provider categories support concurrent connections, presets and aligned actions", {
  tag: "@parallel-browser",
}, async ({ page, rendererUrl, context }) => {
  test.setTimeout(120000);
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

  await page.setViewportSize({ width: 1024, height: 640 });
  await page.goto(`${rendererUrl}`);

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
  const search = section.getByRole("searchbox", { name: "Search providers" });
  await expect(search).toBeVisible();
  await search.fill("OLLAMA");
  const choices = section.locator("[data-provider-preset] option:not([hidden])");
  await expect(choices).toHaveText(["Ollama"]);
  await search.fill("no matching service");
  await expect(choices).toHaveCount(0);
  await expect(section.getByText("No matching providers")).toBeVisible();
  await search.clear();
  await expect(choices).toHaveCount(19);
  await search.fill("OpenCode");
  await expect(choices).toHaveText(["OpenCode Console", "OpenCode Go"]);
  for (const [preset, label, baseUrl] of [
    ["opencode-console", "OpenCode Console", "https://opencode.ai/inference/openai/v1"],
    ["opencode-go", "OpenCode Go", "https://opencode.ai/inference/go/openai/v1"],
  ]) {
    await section.locator("[data-provider-preset]").selectOption(preset!);
    await expect(section.locator("[data-provider-editor]").getByText(label!, { exact: true })).toBeVisible();
    await expect(section.getByLabel("Base URL", { exact: true })).toHaveValue(baseUrl!);
    await expect(section.getByLabel("Base URL", { exact: true })).not.toBeEditable();
  }
  await search.fill("QwenCloud");
  await expect(choices).toHaveText(["QwenCloud Standard", "QwenCloud Token Plan"]);
  for (const [preset, baseUrl] of [
    ["qwencloud-standard", "https://maas.qwencloudapi.com/compatible-mode/v1"],
    ["qwencloud-token-plan", "https://token-plan.maas.qwencloudapi.com/compatible-mode/v1"],
  ]) {
    await section.locator("[data-provider-preset]").selectOption(preset!);
    await expect(section.getByLabel("Base URL", { exact: true })).toHaveValue(baseUrl!);
    await expect(section.getByLabel("Base URL", { exact: true })).not.toBeEditable();
    await expect(section.getByLabel("Model", { exact: true })).toBeEditable();
  }
  for (const [preset, label, baseUrl, discovery] of [
    ["deepseek", "DeepSeek", "https://api.deepseek.com", true],
    ["moonshot-ai", "Moonshot AI", "https://api.moonshot.ai/v1", true],
    ["kimi-coding", "Kimi For Coding", "https://api.kimi.ai/coding", false],
  ] as const) {
    await search.fill(label);
    await expect(choices).toHaveText([label]);
    await section.locator("[data-provider-preset]").selectOption(preset);
    await expect(section.getByLabel("Base URL", { exact: true })).toHaveValue(baseUrl);
    await expect(section.getByLabel("Base URL", { exact: true })).not.toBeEditable();
    await expect(section.getByLabel("Model", { exact: true })).toBeEditable();
    await expect(section.locator('[data-action="discover-models"]')).toHaveCount(discovery ? 1 : 0);
  }
  await search.clear();
  await section.locator("[data-provider-preset]").selectOption("openai");
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
  const acceptsImages = section.getByRole("switch", { name: "Accepts images", exact: true });
  await expect(acceptsImages).toBeVisible();
  await expect(acceptsImages).not.toBeChecked();
  await acceptsImages.check();
  await expect(section.locator("[data-model-loaded]")).toContainText("65536");
  await section.locator("[data-model-reasoning]").selectOption("off");
  await section.locator("[data-model-temperature]").fill("0");
  await section.locator("[data-discovered-model]").selectOption("mock-small");
  await expect(acceptsImages).not.toBeChecked();
  await expect(section.locator("[data-model-reasoning]")).toHaveCount(0);
  await section.locator("[data-model-temperature]").fill("0.7");
  await section.locator("[data-discovered-model]").selectOption("mock-local");
  await expect(acceptsImages).toBeChecked();
  await expect(section.locator("[data-model-temperature]")).toHaveValue("0");
  await section.locator('[data-provider-action="save-lmstudio"]').click();
  await expect(section.locator('[data-provider="custom:lm-studio"]')).toBeVisible();
  await section.getByRole("button", { name: "Edit LM Studio", exact: true }).click();
  await expect(acceptsImages).toBeChecked();
  await section.locator('[data-action="discover-models"]').click();
  await expect(acceptsImages).toBeChecked();
  await acceptsImages.uncheck();
  await section.locator('[data-provider-action="save-lmstudio"]').click();
  await expect(section.locator("[data-provider-editor]")).toHaveCount(0);
  await section.getByRole("button", { name: "Edit LM Studio", exact: true }).click();
  await expect(acceptsImages).not.toBeChecked();
  await section.getByRole("button", { name: "Cancel", exact: true }).click();
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
  const dialog = row.getByRole("dialog");
  for (const viewport of [
    { width: 1495, height: 997 },
    { width: 1024, height: 640 },
    { width: 640, height: 480 },
  ]) {
    await page.setViewportSize(viewport);
    const bounds = await dialog.boundingBox();
    expect(bounds).not.toBeNull();
    if (!bounds) throw Error("Missing test results dialog");
    expect(Math.abs(bounds.x + bounds.width / 2 - viewport.width / 2)).toBeLessThan(2);
    expect(Math.abs(bounds.y + bounds.height / 2 - viewport.height / 2)).toBeLessThan(2);
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
  }
  await page.keyboard.press("Escape");
  for (const language of ["en", "ro", "de"]) {
    await changeSetting(page, "appearance", () => page.locator("#language").selectOption(language));
    await row.locator("[data-provider-test]").click();
    await expect(dialog.getByRole("heading")).toHaveText(
      language === "ro"
        ? "Testarea conexiunii: API OpenAI"
        : language === "de"
          ? "Verbindungstest: OpenAI-API"
          : "Connection test: OpenAI API",
    );
    const close = dialog.locator("[data-provider-test-close]");
    await expect(close).toHaveText(language === "ro" ? "Închide" : language === "de" ? "Schließen" : "Close");
    await expect(close).toBeInViewport();
    await close.click();
    await expect(dialog).not.toBeVisible();
    for (const scale of ["0.75", "1", "1.5"]) {
      await changeSetting(page, "appearance", () => page.locator("#interface-font-size").selectOption(scale));
      await page.setViewportSize({ width: 1024, height: 640 });
      const ys = await row
        .locator(".provider-actions button")
        .evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().y));
      expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(2);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  }
  await changeSetting(page, "appearance", () => page.locator("#language").selectOption("en"));
  await subscription.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(subscription.getByRole("button", { name: "Sign in with ChatGPT", exact: true })).toBeVisible();
  await expect(subscription.getByRole("button", { name: "Sign out", exact: true })).toHaveCount(0);
  await expect(section.locator(".provider-list > li")).toHaveCount(3);
  await section.locator('[data-action="add-provider"]').click();
  await section.locator("[data-provider-preset]").selectOption("other");
  await expect(section.getByLabel("Base URL", { exact: true })).toHaveValue("");
  await section.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(section.locator("[data-provider-editor]")).toHaveCount(0);
  expect(errors).toEqual([]);
  expect(outbound).toEqual([]);
});

test("a saved Moonshot connection can Test with its VERA output budget", {
  tag: "@parallel-browser",
}, async ({ page, rendererUrl }) => {
  await page.goto(rendererUrl);
  await page.locator('[data-i18n="nav.settings"]').click();
  await page.locator('[data-section="providers"]').click();
  const section = page.locator('[data-settings-section="providers"]');
  await section.locator('[data-action="add-provider"]').click();
  await section.locator("[data-provider-preset]").selectOption("moonshot-ai");
  await section.getByLabel("Model", { exact: true }).fill("kimi-k3");
  await section.getByLabel("Endpoint API key", { exact: true }).fill("fixture-moonshot-browser");
  await expect(section.getByLabel("Maximum output (tokens)")).toHaveValue("16384");
  await section.locator('[data-provider-action="save-custom"]').click();
  await section.getByRole("button", { name: "Edit Moonshot AI", exact: true }).click();
  const editor = section.locator("[data-provider-editor]");
  const testConnection = editor.getByRole("button", { name: "Test Moonshot AI", exact: true });
  await expect(editor.getByLabel("Maximum output (tokens)")).toHaveValue("16384");
  await expect(testConnection).toBeEnabled();
  await editor.getByLabel("Model", { exact: true }).fill("unsaved-model");
  await expect(testConnection).toBeDisabled();
  await editor.getByLabel("Model", { exact: true }).fill("kimi-k3");
  await testConnection.click();
  await expect(editor.getByRole("dialog").locator('[data-test-status="pass"]')).toHaveCount(4);
});

test("international MiniMax and Z.AI plans use fixed routes and independent key drafts", {
  tag: "@parallel-browser",
}, async ({ page, rendererUrl }) => {
  await page.goto(rendererUrl);
  await page.locator('[data-i18n="nav.settings"]').click();
  await page.locator('[data-section="providers"]').click();
  const section = page.locator('[data-settings-section="providers"]');
  await section.locator('[data-action="add-provider"]').click();
  const search = section.getByRole("searchbox", { name: "Search providers" });
  const choices = section.locator("[data-provider-preset] option:not([hidden])");
  const key = section.getByLabel("Endpoint API key", { exact: true });
  const eligibility = section.getByRole("note").filter({ hasText: "Z.AI limits Coding Plan" });
  for (const [brand, standard, plan, standardUrl, planUrl, model] of [
    [
      "MiniMax",
      "MiniMax API",
      "MiniMax M Plan",
      "https://api.minimax.io/anthropic",
      "https://api.minimax.io/anthropic",
      "MiniMax-M3.1-Flash",
    ],
    [
      "Z.AI",
      "Z.AI API",
      "Z.AI GLM Coding Plan",
      "https://api.z.ai/api/paas/v4",
      "https://api.z.ai/api/coding/paas/v4",
      "glm-5.3",
    ],
  ] as const) {
    await search.fill(brand);
    await expect(choices).toHaveText([standard, plan]);
    const preset = section.locator("[data-provider-preset]");
    await preset.selectOption({ label: standard });
    const base = section.getByLabel("Base URL", { exact: true });
    await expect(base).toHaveValue(standardUrl);
    await expect(eligibility).toHaveCount(0);
    await expect(base).not.toBeEditable();
    await key.fill("private-plan-draft");
    await preset.selectOption({ label: plan });
    await expect(key).toHaveValue("");
    await expect(base).toHaveValue(planUrl);
    await expect(base).not.toBeEditable();
    await expect(section.getByLabel("Model", { exact: true })).toBeEditable();
    await expect(section.locator(`datalist option[value="${model}"]`)).toHaveCount(1);
    await expect(eligibility).toHaveCount(brand === "Z.AI" ? 1 : 0);
  }
  await expect(eligibility).toBeVisible();
  await expect(eligibility).toContainText("Its published list does not include VERA");
  await section.getByLabel("Model", { exact: true }).fill("glm-5.3");
  await key.fill("fictional-zai-plan-key");
  await section.locator('[data-provider-action="save-custom"]').click();
  await section.getByRole("button", { name: "Edit Z.AI GLM Coding Plan", exact: true }).click();
  await expect(eligibility).toBeVisible();
});

test("Alibaba and Xiaomi presets expose scoped region and workspace controls", {
  tag: "@parallel-browser",
}, async ({ page, rendererUrl }) => {
  await page.goto(rendererUrl);
  await page.locator('[data-i18n="nav.settings"]').click();
  await page.locator('[data-section="providers"]').click();
  const section = page.locator('[data-settings-section="providers"]');
  await section.locator('[data-action="add-provider"]').click();
  const preset = section.locator("[data-provider-preset]");
  const region = section.getByLabel("Region", { exact: true });
  const workspaceId = section.getByLabel("Workspace ID", { exact: true });
  const base = section.getByLabel("Base URL", { exact: true });
  const key = section.getByLabel("Endpoint API key", { exact: true });
  await preset.selectOption("xiaomi-mimo-api");
  await expect(region.locator("option:checked")).toHaveText("Global");
  await expect(base).toHaveValue("https://api.xiaomimimo.com/v1");
  await preset.selectOption("xiaomi-mimo-token-plan");
  await expect(region.locator("option")).toHaveText(["China", "Singapore", "Europe"]);
  await key.fill("tp-fixture-china");
  await region.selectOption("europe");
  await expect(base).toHaveValue("https://token-plan-ams.xiaomimimo.com/v1");
  await expect(key).toHaveValue("");
  await preset.selectOption("alibaba-coding-plan");
  await expect(region.locator("option:checked")).toHaveText("Singapore");
  await expect(base).toHaveValue("https://coding-intl.dashscope.aliyuncs.com/v1");
  await preset.selectOption("alibaba-model-studio");
  await expect(base).toHaveValue("");
  await expect(base).not.toBeEditable();
  await expect(region.locator("option")).toHaveCount(6);
  await workspaceId.fill("token-plan");
  await expect(section.getByRole("alert")).toContainText("Workspace ID");
  await expect(section.locator('[data-provider-action="save-custom"]')).toBeDisabled();
  await workspaceId.fill("llm-browser353");
  await region.selectOption("eu-central-1");
  await expect(base).toHaveValue("https://llm-browser353.eu-central-1.maas.aliyuncs.com/compatible-mode/v1");
  await key.fill("sk-fixture-model-studio");
  await workspaceId.fill("llm-otherbrowser");
  await expect(key).toHaveValue("");
  await key.fill("sk-fixture-other-workspace");
  await section.getByLabel("Model", { exact: true }).fill("qwen3.7-flash");
  await section.locator('[data-provider-action="save-custom"]').click();
  await section.getByRole("button", { name: "Edit Alibaba Cloud Model Studio", exact: true }).click();
  await expect(workspaceId).toHaveValue("llm-otherbrowser");
  await expect(workspaceId).not.toBeEditable();
  await expect(region).toBeDisabled();
  await expect(
    section.getByRole("button", { name: "Test Alibaba Cloud Model Studio", exact: true }),
  ).toBeEnabled();
});
