import { spawn } from "node:child_process";
import { existsSync, readFileSync, renameSync } from "node:fs";
import { expect, test } from "@playwright/test";

test("browser mock displays the same metadata screen through dev:renderer", async ({ page, context }) => {
  const manifest = JSON.parse(readFileSync("package.json", "utf8"));
  expect(manifest.scripts["dev:renderer"], "renderer-only dev entrypoint").toBe(
    "node scripts/dev-renderer.mjs",
  );
  const compiledShared = "packages/shared/dist/index.js";
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
    const version = JSON.parse(readFileSync("apps/desktop/package.json", "utf8")).version;
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
    // Replace the API module at the browser network seam; UI must translate a structured failure.
    await context.route("**/api/index.*", (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: 'export const api = { getAppInfo: async () => { throw { code: "INTERNAL", messageKey: "errors.INTERNAL" }; } };',
      }),
    );
    await page.reload();
    await expect(page.getByRole("alert")).toHaveAttribute("data-i18n", "errors.INTERNAL");
    await expect(page.getByRole("alert")).toHaveText("Application information could not be loaded.");
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
