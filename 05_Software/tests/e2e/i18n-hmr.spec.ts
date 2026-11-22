import { mkdir, mkdtemp, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import type { InlineConfig } from "vite";

test("catalog updates translate already mounted tool activity without reloading or changing language", {
  tag: "@parallel-browser",
}, async ({ page }) => {
  test.setTimeout(60000);
  const { createServer } = await import("vite");
  const { default: react } = await import("@vitejs/plugin-react");
  const { resolveConfig } = await import("electron-vite");
  const renderer = (await resolveConfig({ root: "src/apps/desktop" }, "serve", "development")).config
    ?.renderer;
  if (!renderer) throw Error("Missing renderer config");
  const directory = await mkdtemp(resolve("test-outputs/i18n-hmr-"));
  const languages = ["en", "ro", "de", "fr"];
  const source = resolve("src/apps/desktop/src/renderer");
  await mkdir(join(directory, "locales"));
  const originals = new Map<string, string>();
  for (const language of languages) {
    const original = await readFile(join(source, "locales", `${language}.json`), "utf8");
    originals.set(language, original);
    const catalog = JSON.parse(original);
    delete catalog.toolActivity;
    await writeFile(join(directory, "locales", `${language}.json`), JSON.stringify(catalog));
  }
  await writeFile(join(directory, "i18n.ts"), await readFile(join(source, "i18n.ts"), "utf8"));
  await writeFile(
    join(directory, "index.html"),
    '<div id="root"></div><script type="module" src="/main.ts"></script>',
  );
  await writeFile(
    join(directory, "main.ts"),
    `
    import { createElement } from 'react';
    import { createRoot } from 'react-dom/client';
    import './i18n';
    import { ToolDetails } from ${JSON.stringify(`/@fs/${join(source, "components/session/tool-details.tsx").replaceAll("\\", "/")}`)};
    const items = [{text:'Actual plan step',status:'done'}];
    createRoot(document.getElementById('root')).render(createElement(ToolDetails, {
      item: {kind:'tool',id:'call',turnId:'turn',name:'todo',args:{items},status:'ok',summary:JSON.stringify({items})},
      sessionId:undefined,update:undefined
    }));
  `,
  );
  const config: InlineConfig = {
    root: directory,
    plugins: [...react()],
    resolve: renderer.resolve ?? {},
    define: renderer.define ?? {},
    cacheDir: resolve("node_modules/.cache/vite-e2e/i18n-hmr"),
    server: { host: "127.0.0.1", port: 0, strictPort: false, fs: { allow: [process.cwd()] } },
  };
  const server = await createServer(config);
  try {
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") throw Error("Missing renderer address");
    await page.goto(`http://127.0.0.1:${address.port}`);
    await page.evaluate(async () => {
      const path = "/i18n.ts";
      return (await import(path)).default.changeLanguage("ro");
    });
    await expect(page.locator(".tool-activity strong")).toHaveText("toolActivity.updatePlan");
    await page.locator(".tool-activity > button").click();
    await expect(page.locator(".plan-text")).toHaveText("Actual plan step");
    const timeOrigin = await page.evaluate(() => performance.timeOrigin);
    for (const language of languages)
      await writeFile(join(directory, "locales", `${language}.json`), originals.get(language) as string);
    await expect(page.locator(".tool-activity strong")).toHaveText("Actualizare plan");
    await expect(page.locator(".tool-technical > button")).toHaveText("Detalii tehnice");
    await expect(page.locator(".plan-status")).toHaveText("Finalizat");
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin);
    expect(
      await page.evaluate(async () => {
        const path = "/i18n.ts";
        return (await import(path)).default.language;
      }),
    ).toBe("ro");
    for (const language of languages) {
      await page.evaluate(async (language) => {
        const path = "/i18n.ts";
        return (await import(path)).default.changeLanguage(language);
      }, language);
      await expect(page.locator(".tool-activity")).not.toContainText("toolActivity.");
    }
  } finally {
    await page.close();
    await server.close();
    for (const language of languages) await unlink(join(directory, "locales", `${language}.json`));
    for (const file of ["main.ts", "i18n.ts", "index.html"]) await unlink(join(directory, file));
    await rmdir(join(directory, "locales"));
    await rmdir(directory);
  }
});
