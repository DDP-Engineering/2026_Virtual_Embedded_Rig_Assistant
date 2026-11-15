// REQ-FUNC-2a87401e, REQ-SEC-3cb78ea6
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HelpLibrary } from "../help/library.js";
import { createToolContext } from "./context.js";
import { helpTool } from "./help.js";

let temporary: string;
beforeEach(async () => {
  temporary = await mkdtemp(join(tmpdir(), "vera-help-tool-"));
  const pages: Record<string, string> = {
    "help/en/index.md": "# VERA help\n\nSee [Permissions](permissions.md).\n",
    "help/en/permissions.md": "# Permissions\n\nRead-only, Ask.\n",
    "help/fr/index.md": "# Aide de VERA\n\nVoir.\n",
    "help/fr/permissions.md": "# Autorisations\n\nLecture seule.\n",
    "serial/help/en.md": "# Serial monitor\n\nCapture consoles.\n",
    "serial/help/de.md": "# Serieller Monitor\n\nKonsolen.\n",
    "bare/plugin.yaml": "",
  };
  for (const [path, text] of Object.entries(pages)) {
    await mkdir(join(temporary, path, ".."), { recursive: true });
    await writeFile(join(temporary, path), text);
  }
});
afterEach(async () => {
  await rm(temporary, { recursive: true, force: true });
});
function context(language: "en" | "fr" | "de" = "fr") {
  const plugins = vi.fn(async () => [
    { id: "serial-monitor", folder: join(temporary, "serial") },
    { id: "bare-tools", folder: join(temporary, "bare") },
  ]);
  const ctx = createToolContext(temporary);
  ctx.help = { app: new HelpLibrary(join(temporary, "help")), language: () => language, plugins };
  return { ctx, plugins };
}
const run = (ctx: ReturnType<typeof context>["ctx"], args: unknown) =>
  helpTool.execute(ctx, helpTool.params.parse(args), new AbortController().signal);

it("lists app pages and enabled plugins' help with help refs in the interface language", async () => {
  const { ctx } = context("fr");
  expect(helpTool.class).toBe("read");
  expect(await run(ctx, {})).toEqual({
    language: "fr",
    pages: [
      { page: "index", title: "Aide de VERA", language: "fr", ref: "help:index" },
      { page: "permissions", title: "Autorisations", language: "fr", ref: "help:permissions" },
    ],
    plugins: [
      {
        plugin: "serial-monitor",
        title: "Serial monitor",
        language: "en",
        ref: "help:plugin/serial-monitor",
      },
    ],
  });
});

it("reads an app or plugin page in the requested language, else the interface language, else English", async () => {
  const { ctx } = context("fr");
  expect(await run(ctx, { page: "permissions" })).toEqual({
    ref: "help:permissions",
    title: "Autorisations",
    language: "fr",
    text: "# Autorisations\n\nLecture seule.\n",
  });
  expect(await run(ctx, { page: "permissions", language: "de" })).toMatchObject({
    title: "Permissions",
    language: "en",
  });
  expect(await run(ctx, { plugin: "serial-monitor", language: "de" })).toMatchObject({
    ref: "help:plugin/serial-monitor",
    title: "Serieller Monitor",
    language: "de",
  });
  await expect(run(ctx, { page: "missing" })).rejects.toThrow(/missing/);
  expect(helpTool.params.safeParse({ page: "index", plugin: "serial-monitor" }).success).toBe(false);
});

it("refuses a plugin that is not enabled in the workbench or has no help", async () => {
  const { ctx } = context();
  await expect(run(ctx, { plugin: "esp32-efuse" })).rejects.toThrow(/esp32-efuse.*not enabled/);
  await expect(run(ctx, { plugin: "bare-tools" })).rejects.toThrow(/bare-tools.*no help/);
});
