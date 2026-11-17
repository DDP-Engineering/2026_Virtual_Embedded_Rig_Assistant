import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { _electron, expect, type Page, test } from "@playwright/test";
import type { Channel, Request, Response, VeraBridge } from "@vera/shared";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";

const evidence = resolve("evaluation-outputs/view02");
const invoke = <C extends Channel>(page: Page, channel: C, request: Request<C>): Promise<Response<C>> =>
  page.evaluate(
    async ({ channel, request }) =>
      (window as unknown as { vera: VeraBridge }).vera.invoke(channel as never, request as never),
    { channel, request },
  ) as Promise<Response<C>>;

async function acceptance(page: Page, platform: string) {
  const docs = page.locator("#panel-docs");
  const panel = page.locator("[data-source-current]");
  const open = async (name: string) => docs.locator(`[data-tree-path="text-samples/${name}"]`).click();
  await docs.locator('[data-tree-path="text-samples"]').click();
  await open("latin1.txt");
  await expect(panel.locator("[data-show-as-text]")).toBeVisible();
  await panel.locator("[data-text-encoding]").selectOption("iso-8859-1");
  await expect(panel.locator('[data-line="1"]')).toContainText("café £");
  await panel.locator("[data-text-encoding]").selectOption("utf-8");
  await panel.locator("[data-show-as-text]").click();
  await expect(panel.locator('[data-line="1"]')).toContainText("caf� �");
  await open("utf16.txt");
  await expect(panel.locator("[data-text-encoding]")).toHaveValue("utf-16le");
  await expect(panel.locator('[data-line="1"]')).toContainText("café");
  await panel.locator("[data-text-encoding]").selectOption("utf-16be");
  await expect(panel.locator('[data-line="1"]')).not.toContainText("café");
  await panel.locator("[data-text-encoding]").selectOption("utf-16le");
  await expect(panel.locator('[data-line="1"]')).toContainText("café");
  await open("invalid.txt");
  await panel.locator("[data-show-as-text]").click();
  await expect(panel.locator('[data-line="1"]')).toContainText("ok�");
  await open("wrapped.log");
  await panel.locator("[data-text-wrap]").check();
  const body = panel.locator(".document-body");
  const geometry = (line: number) =>
    panel.locator(`[data-line="${line}"]`).evaluate((row) => {
      const body = row.closest(".document-body");
      if (!body) throw Error("Missing scroll body");
      const rect = row.getBoundingClientRect(),
        view = body.getBoundingClientRect();
      return {
        height: rect.height,
        lineHeight: Number.parseFloat(getComputedStyle(row).lineHeight),
        y: rect.top - view.top,
        viewport: view.height,
        width: body.clientWidth,
        scrollWidth: body.scrollWidth,
      };
    });
  await body.focus();
  await page.keyboard.press("Control+g");
  await panel.locator("[data-document-goto]").fill("1200");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await geometry(1200)).y).toBeGreaterThanOrEqual(0);
  await expect
    .poll(async () => {
      const g = await geometry(1200);
      return g.y < g.viewport;
    })
    .toBe(true);
  const jump = await geometry(1200);
  expect(jump.height).toBeGreaterThan(jump.lineHeight * 2);
  expect(jump.scrollWidth).toBeLessThanOrEqual(jump.width + 1);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+f");
  await panel.locator("[data-document-search]").fill("Source 1375 ");
  await expect(panel.locator('[data-line="1375"]')).toHaveAttribute("data-current-match", "true");
  await expect
    .poll(async () => {
      const g = await geometry(1375);
      return g.y >= 0 && g.y < g.viewport;
    })
    .toBe(true);
  const found = await geometry(1375);
  // Width and font changes invalidate heights, keeping the visible source anchor navigable.
  await page.setViewportSize({ width: 1100, height: 780 });
  await panel.locator("[data-document-search]").fill("Source 1400 ");
  await expect
    .poll(async () => {
      const g = await geometry(1400);
      return g.y >= 0 && g.y < g.viewport;
    })
    .toBe(true);
  await panel.locator("[data-text-wrap]").uncheck();
  await expect
    .poll(async () => {
      const g = await geometry(1400);
      return g.height < found.height;
    })
    .toBe(true);
  expect(await panel.locator("[data-line]").count()).toBeLessThan(180);
  await panel.locator("[data-text-wrap]").check();
  await page.screenshot({ path: join(evidence, `${platform}-wrapped.png`) });
  await writeFile(
    join(evidence, `${platform}-receipt.json`),
    JSON.stringify(
      { platform, jump, found, final: await geometry(1400), done: ["VIEW-02-A", "VIEW-02-B"] },
      null,
      2,
    ),
  );
}

test("browser text encodings, explicit replacement and measured wrapped navigation", async ({ page }) => {
  test.setTimeout(90000);
  await mkdir(evidence, { recursive: true });
  const server = spawn(process.execPath, ["../02_Tools/environment/dev-renderer.mjs"], {
    env: { ...process.env, VITE_API: "mock" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  server.stdout.on("data", (chunk) => {
    output += chunk;
  });
  server.stderr.on("data", (chunk) => {
    output += chunk;
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await expect.poll(() => output, { timeout: 25000 }).toContain("VERA_RENDERER_READY");
    await page.goto("http://127.0.0.1:5173/?mock=chat");
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.locator("[data-workbench-entry] .workbench-group-name").click();
    await page.locator('[data-toggle="right"]').click();
    await page.locator("#tab-docs").click();
    await acceptance(page, "browser");
    expect(errors).toEqual([]);
  } finally {
    if (server.exitCode === null) {
      const stopped = once(server, "exit");
      server.kill("SIGTERM");
      await stopped;
    }
    await writeFile(join(evidence, "browser-server.log"), output);
  }
});

test("native text encodings and measured wrapped navigation through confined masked bytes", async () => {
  test.setTimeout(120000);
  await mkdir(evidence, { recursive: true });
  const scratch = await mkdtemp(join(evidence, "native-owned-"));
  const folder = join(scratch, "bench"),
    profile = join(scratch, "profile");
  await mkdir(join(folder, "text-samples"), { recursive: true });
  await mkdir(profile);
  const write = (name: string, data: string | Uint8Array) =>
    writeFile(join(folder, "text-samples", name), data);
  await write("latin1.txt", Buffer.from("café £", "latin1"));
  await write("utf16.txt", Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("café", "utf16le")]));
  await write("invalid.txt", Buffer.from([0x6f, 0x6b, 0xff, 0x0a, 0x65, 0x6e, 0x64]));
  const secret = "view02-synthetic-password";
  await write(`${secret}.log`, `LIVE ${secret}`);
  await write(
    "wrapped.log",
    Array.from(
      { length: 1500 },
      (_, i) => `Source ${i + 1} ${"measured wrapped words ".repeat(((i % 5) + 1) * 8)}`,
    ).join("\n"),
  );
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
  try {
    await installNetworkGuard(app);
    const page = await app.firstWindow();
    await invoke(page, "app.settings.update", { language: "en" });
    const bench = await invoke(page, "workbench.create", {
      folder,
      name: "VIEW02",
      config: { docs: { include: [], exclude: [] } },
    });
    const session = await invoke(page, "session.create", { workbenchId: bench.config.id });
    await page.reload();
    await page.locator(`[data-session="${session.id}"]`).click();
    await page.locator('[data-toggle="right"]').click();
    await page.locator("#tab-docs").click();
    await acceptance(page, "native");
    expect(
      (await invoke(page, "mqtt.credentials.save", { ref: "view02", password: secret, storageConsent: true }))
        .status,
    ).toBe("saved");
    const files = await invoke(page, "docs.tree", { workbenchId: bench.config.id, path: "text-samples" });
    const maskedFile = files.entries.find((entry) => entry.name === `${secret}.log`);
    if (!maskedFile) throw Error("Missing masked byte fixture");
    await page.locator(`[data-tree-path="${maskedFile.path}"]`).click();
    await expect(page.locator("[data-source-current]")).toContainText(`LIVE ${secret}`);
    await invoke(page, "app.settings.update", { privacy: { mask: { display: true } } });
    await expect(page.locator("[data-source-current]")).toContainText(`LIVE ${"*".repeat(secret.length)}`);
    await expect(page.locator("[data-source-current]")).not.toContainText(secret);
    await expect(page.locator(`[data-tree-path="${maskedFile.path}"] .tree-name`)).toHaveText(
      "[REDACTED].log",
    );
    await invoke(page, "app.settings.update", { privacy: { mask: { display: false } } });
    await expect(page.locator("[data-source-current]")).toContainText(`LIVE ${secret}`);
    expect(await outboundAttempts(app)).toEqual([]);
  } finally {
    await app.close();
    await rm(scratch, { recursive: true, force: true });
  }
});
