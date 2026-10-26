import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron, expect, test } from "@playwright/test";
import type { VeraBridge } from "@vera/shared";
import { installNetworkGuard, outboundAttempts } from "./network-guard.js";

test("native UI skill creation/edit/disable changes the NEXT turn system prompt", async () => {
  test.setTimeout(90000);
  const root = await mkdtemp(join(tmpdir(), "vera-wp29-native-")),
    folder = join(root, "Board ă");
  await mkdir(folder);
  const requests: {
    messages: { role: string; content: string }[];
    tools: { function: { name: string } }[];
  }[] = [];
  const server = createServer((req, res) => {
    if (req.method === "GET")
      return void res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ data: [{ id: "skills" }] }));
    let raw = "";
    req.on("data", (b) => (raw += b));
    req.on("end", () => {
      requests.push(JSON.parse(raw));
      res.writeHead(200, { "content-type": "text/event-stream" });
      for (const [delta, finish] of [
        [{ content: "OK" }, null],
        [{}, "stop"],
      ])
        res.write(
          `data: ${JSON.stringify({ id: "skills", object: "chat.completion.chunk", created: 0, model: "skills", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`,
        );
      res.end("data: [DONE]\n\n");
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const addr = server.address();
  if (!addr || typeof addr === "string") throw Error("address");
  const env = Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === "string"),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  const executable = resolve(
    "node_modules/electron/dist",
    process.platform === "win32" ? "electron.exe" : "electron",
  );
  const args = [resolve("src/apps/desktop"), `--user-data-dir=${join(root, "data")}`];
  const started = new Date().toISOString();
  const app = await _electron.launch({ executablePath: executable, args, chromiumSandbox: true, env });
  try {
    await installNetworkGuard(app);
    const page = await app.firstWindow();
    const setup = await page.evaluate(
      async ({ folder, baseUrl }) => {
        const api = (window as unknown as { vera: VeraBridge }).vera;
        await api.invoke("app.settings.update", { language: "en" });
        const wb = await api.invoke("workbench.create", { folder, name: "Board" });
        await api.invoke("providers.save", {
          provider: "custom",
          config: {
            name: "Skills",
            baseUrl,
            model: "skills",
            contextWindow: 32768,
            maxOutputTokens: 4096,
            supportsTools: true,
          },
        });
        const session = await api.invoke("session.create", { modelRef: "custom:skills/skills" });
        return { wb, session };
      },
      { folder, baseUrl: `http://127.0.0.1:${addr.port}/v1` },
    );
    const turn = async (text: string) =>
      page.evaluate(
        async ({ sessionId, text }) => {
          const api = (window as unknown as { vera: VeraBridge }).vera;
          const sinceSeq = (await api.invoke("session.get", { sessionId })).seq;
          const done = new Promise<void>((resolve) => {
            const off = api.subscribe("session", sessionId, sinceSeq, (event) => {
              if (event.type === "turn.done") {
                off();
                resolve();
              }
            });
          });
          await api.invoke("session.send", { sessionId, text });
          await done;
          return api.invoke("session.get", { sessionId });
        },
        { sessionId: setup.session.id, text },
      );
    await turn("Before creation");
    expect(requests[0]?.messages.find((m) => m.role === "system")?.content).not.toContain("ui-reader:");
    await page.reload();
    await page.locator('[data-i18n="nav.welcome"]').click();
    const trigger = page.locator('[data-action="skills-settings"]').first();
    await trigger.focus();
    await page.keyboard.press("Enter");
    const dialog = page.locator(".skills-dialog");
    await expect(dialog).toBeVisible();
    await dialog.locator("[data-skill-name]").fill("ui-reader");
    await dialog.locator('[data-action="create-skill"]').click();
    await expect(dialog.locator(".skills-list li")).toHaveCount(1);
    await dialog.locator('[data-action="open-skill"]').click();
    const content = page.locator("[data-skill-content]");
    await expect(content).toBeFocused();
    await content.fill(
      "---\nname: ui-reader\ndescription: Use for UI-created board reviews.\n---\nBODY NOT IN PROMPT\n",
    );
    await page.locator('[data-action="save-skill"]').click();
    await expect(dialog.locator('[data-action="open-skill"]')).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await turn("After creation");
    const prompt = requests[1]?.messages.find((m) => m.role === "system")?.content ?? "";
    expect(prompt).toContain("ui-reader: Use for UI-created board reviews.");
    expect(prompt).not.toContain("BODY NOT IN PROMPT");
    expect(requests[1]?.tools.some((tool) => tool.function.name === "load_skill")).toBe(true);
    await trigger.click();
    await dialog.locator('input[type="checkbox"]').click();
    await expect(dialog.locator('input[type="checkbox"]')).not.toBeChecked();
    await page.keyboard.press("Escape");
    await turn("After disabling");
    expect(requests[2]?.messages.find((m) => m.role === "system")?.content).not.toContain("ui-reader:");
    await trigger.click();
    await dialog.locator('input[type="checkbox"]').click();
    await expect(dialog.locator('input[type="checkbox"]')).toBeChecked();
    await dialog.locator('[data-action="open-skill"]').click();
    await expect(content).toBeFocused();
    await content.fill(
      "---\nname: ui-reader\ndescription: Updated metadata for next turn.\n---\nEDITED BODY\n",
    );
    await page.locator('[data-action="save-skill"]').click();
    await expect(content).toHaveCount(0);
    await page.keyboard.press("Escape");
    await turn("After edit");
    expect(requests[3]?.messages.find((m) => m.role === "system")?.content).toContain(
      "ui-reader: Updated metadata for next turn.",
    );
    await trigger.click();
    await page.screenshot({ path: test.info().outputPath("skills-native.png") });
    await page.keyboard.press("Escape");
    expect(await outboundAttempts(app)).toEqual([]);
    if (process.env.VERA_E2E_EVIDENCE_DIR) {
      const loaded = await app.evaluate(({ app, BrowserWindow }) => ({
        entry: app.getAppPath(),
        preload: (
          BrowserWindow.getAllWindows()[0]?.webContents as unknown as {
            _getPreloadScript(): { filePath: string } | null;
          }
        )?._getPreloadScript()?.filePath,
        argv: process.argv,
        cwd: process.cwd(),
        execPath: process.execPath,
      }));
      const hashes: Record<string, string> = {};
      for (const [name, path] of Object.entries({
        main: join(loaded.entry, "out/main/index.js"),
        preload: loaded.preload ?? "",
        executable,
      }))
        hashes[name] = createHash("sha256")
          .update(await readFile(path))
          .digest("hex");
      await writeFile(
        join(process.env.VERA_E2E_EVIDENCE_DIR, "skills-native.json"),
        JSON.stringify(
          { started, ended: new Date().toISOString(), args, ...loaded, hashes, requests },
          null,
          2,
        ),
      );
    }
  } finally {
    await app.close();
    server.close();
    server.closeAllConnections();
    await once(server, "close");
    await rm(root, { recursive: true, force: true });
  }
});

test("browser skills editor fits en/ro/de, light/dark and every text scale with keyboard focus", async ({
  page,
  context,
}) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 1024, height: 640 });
  const server = spawn(process.execPath, ["scripts/dev-renderer.mjs"], {
    env: { ...process.env, VITE_API: "mock" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const errors: string[] = [],
    attempts: string[] = [];
  server.stdout.on("data", (b) => (output += b));
  server.stderr.on("data", (b) => (output += b));
  page.on("pageerror", (e) => errors.push(e.message));
  await context.route("**/*", async (route) => {
    if (new URL(route.request().url()).hostname === "127.0.0.1") await route.continue();
    else {
      attempts.push(route.request().url());
      await route.abort();
    }
  });
  try {
    await new Promise<void>((done, fail) => {
      const timer = setTimeout(() => fail(Error(output)), 20000);
      const ready = () => {
        if (output.includes("VERA_RENDERER_READY")) {
          clearTimeout(timer);
          done();
        }
      };
      server.stdout.on("data", ready);
      server.stderr.on("data", ready);
      server.once("error", fail);
    });
    for (const lang of ["en", "ro", "de"]) {
      await page.goto("http://127.0.0.1:5173/?mock=chat");
      await page.evaluate(() => localStorage.clear());
      await page.reload();
      await page.locator('[data-i18n="nav.settings"]').click();
      await page.locator("#language").selectOption(lang);
      await expect(page.locator("html")).toHaveAttribute("lang", lang);
      await page.locator('[data-i18n="nav.welcome"]').click();
      await page.locator('[data-action="open-recent"]').click();
      await page.locator('[data-i18n="nav.welcome"]').click();
      const trigger = page.locator('[data-action="skills-settings"]').first();
      await trigger.click();
      const dialog = page.locator(".skills-dialog");
      await dialog.locator("[data-skill-name]").fill("browser-reader");
      await dialog.locator('[data-action="create-skill"]').click();
      await expect(dialog.locator(".skills-list li")).toHaveCount(1);
      await page.keyboard.press("Escape");
      for (const theme of ["light", "dark"])
        for (const scale of [0.875, 1, 1.125, 1.25, 1.5]) {
          await page.evaluate(
            async ({ theme, scale }) => {
              const module = "/api/index.ts";
              const { api } = await import(/* @vite-ignore */ module);
              await api.updateSettings({ theme, textScale: scale });
            },
            { theme, scale },
          );
          await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
          await expect
            .poll(() => page.locator("html").evaluate((el) => getComputedStyle(el).fontSize))
            .toBe(`${14 * scale}px`);
          await trigger.focus();
          await page.keyboard.press("Enter");
          await expect(dialog).toBeVisible();
          expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
          await dialog.locator('[data-action="open-skill"]').focus();
          await page.keyboard.press("Enter");
          await expect(page.locator("[data-skill-content]")).toBeFocused();
          const editor = page.locator("dialog[open]").last();
          expect(await editor.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
          if (scale === 1.5)
            await page.screenshot({ path: test.info().outputPath(`skills-${lang}-${theme}.png`) });
          await page.keyboard.press("Escape");
          await expect(dialog.locator('[data-action="open-skill"]')).toBeFocused();
          await page.keyboard.press("Escape");
          await expect(dialog).toHaveCount(0);
          await expect(trigger).toBeFocused();
        }
    }
    expect(errors).toEqual([]);
    expect(attempts).toEqual([]);
  } finally {
    server.kill();
    await once(server, "exit");
  }
});
