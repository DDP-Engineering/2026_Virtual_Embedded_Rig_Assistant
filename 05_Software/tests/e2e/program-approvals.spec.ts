// REQ-UX-9744e270 REQ-UX-12185f60

import { expect, type Page, test } from "@playwright/test";
import { resolveConfig } from "electron-vite";
import { createServer, type ViteDevServer } from "vite";

/**
 * Program approvals in browser mock mode: the mock requests run_program approvals for prompts that
 * start with "flash" (device-write) or "burn" (irreversible) and decides them with the shared policy.
 */
async function serve(): Promise<{ server: ViteDevServer; url: string }> {
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
  return { server, url: `http://127.0.0.1:${address.port}/?mock=chat` };
}
async function session(page: Page, url: string) {
  await page.goto(url);
  await page.locator('[data-i18n="nav.welcome"]').click();
  await page.locator("#workbench-name").fill("Flash bench");
  await page.locator('[data-action="choose-create"]').click();
  await page.locator('[data-action="create-workbench"]').click();
  await page.locator('[data-action="new-session"]').click();
  const input = page.getByRole("textbox", { name: "Message", exact: true });
  await expect(input).toBeEnabled();
  return input;
}

test("approves a device-write run on the card and an irreversible run only with the typed word", async ({
  page,
}) => {
  const { server, url } = await serve();
  try {
    const input = await session(page, url);
    await input.fill("flash the board");
    await input.press("Enter");
    const flash = page.locator('[data-approval-card][data-risk="device-write"]');
    await expect(flash).toBeVisible();
    await expect(flash.locator(".risk-badge")).toHaveText("Device write");
    await expect(flash.locator("h4")).toHaveText("run_program · esptool 5.1.0");
    await expect(flash.locator("[data-approval-command]")).toHaveText(
      "esptool --port COM3 write-flash 0x10000 build/app.bin",
    );
    await expect(flash).toContainText("Overwrites firmware or data stored on the chip.");
    await expect(flash.locator(".approval-files")).toContainText(`build/app.bin SHA-256 ${"c".repeat(64)}`);
    await expect(flash.locator("[data-approval-confirmation]")).toHaveCount(0);
    await flash.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(flash.getByRole("status")).toHaveText("Approved · user");
    await expect(input).toBeEnabled();

    await input.fill("burn the key");
    await input.press("Enter");
    const burn = page.locator('[data-approval-card][data-risk="irreversible"]');
    await expect(burn).toBeVisible();
    await expect(burn.locator(".risk-badge")).toHaveText("Irreversible");
    await expect(burn.locator("[data-approval-command]")).toHaveText(
      "espefuse --port COM3 burn-key BLOCK_KEY0 key.bin XTS_AES_128_KEY",
    );
    await expect(burn.getByRole("button", { name: "Approve and switch to auto-edit" })).toHaveCount(0);
    const approve = burn.getByRole("button", { name: "Approve", exact: true });
    await expect(approve).toBeDisabled();
    const word = burn.getByLabel("This change is permanent. Type burn-key to confirm.");
    await word.fill("burn");
    await approve.click();
    await expect(burn.getByRole("alert")).toContainText("The typed word does not match");
    await expect(burn.getByRole("status")).toHaveCount(0);
    await expect(input).toBeDisabled();
    await word.fill("burn-key");
    await approve.click();
    await expect(burn.getByRole("status")).toHaveText("Approved · user");
    await expect(page.locator("strong", { hasText: /^run_program$/ })).toHaveCount(2);
    await expect(input).toBeEnabled();
  } finally {
    await server.close();
  }
});

test("lists irreversible plugin rules in the bypass warning, then runs the command without a prompt", async ({
  page,
}) => {
  const { server, url } = await serve();
  try {
    const input = await session(page, url);
    await page.evaluate(async () => {
      const { api } = await import(/* @vite-ignore */ `${"/api/index.ts"}`);
      const { config } = (await api.invoke("workbench.config.get", {})) as { config: { id: string } };
      const path = "C:/plugins/esp32-efuse";
      const { sha256 } = (await api.invoke("plugins.review", { path })) as { sha256: string };
      await api.invoke("plugins.install", { path, sha256 });
      await api.invoke("plugins.toggle", { workbenchId: config.id, id: "esp32-efuse", enabled: true });
    });
    await page.locator(".composer [data-permission-picker]").selectOption("bypass");
    const warning = page.locator(".bypass-warning");
    await expect(warning).toBeVisible();
    await expect(warning.locator("[data-bypass-irreversible] li")).toHaveText(
      "esp32-efuse espefuse * burn-key * — Burns a key into eFuse permanently.",
    );
    await page.locator('[data-action="close-bypass-warning"]').click();
    await expect(warning).toBeHidden();
    await input.fill("burn the key");
    await input.press("Enter");
    const burn = page.locator('[data-approval-card][data-risk="irreversible"]');
    await expect(burn.getByRole("status")).toHaveText("Approved · automatic mode");
    await expect(burn.locator("[data-approval-confirmation]")).toHaveCount(0);
    await expect(input).toBeEnabled();
  } finally {
    await server.close();
  }
});
