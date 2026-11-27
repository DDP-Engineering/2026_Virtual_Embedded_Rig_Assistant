// REQ-FUNC-2a87401e, REQ-SEC-3cb78ea6
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveAdvanced } from "@vera/shared";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HelpLibrary } from "../help/library.js";
import { SkillCatalog } from "../skills/catalog.js";
import { createToolContext } from "./context.js";
import { helpTool } from "./help.js";
import { ToolRegistry } from "./registry.js";

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
      { page: "index", title: "Aide de VERA", language: "fr", ref: "help:index#lang=fr" },
      { page: "permissions", title: "Autorisations", language: "fr", ref: "help:permissions#lang=fr" },
    ],
    plugins: [
      {
        plugin: "serial-monitor",
        title: "Serial monitor",
        language: "en",
        ref: "help:plugin/serial-monitor#lang=en",
      },
    ],
  });
});

it("reads an app or plugin page in the requested language, else the interface language, else English", async () => {
  const { ctx } = context("fr");
  expect(helpTool.description).toContain("[[help:permissions#lang=en]]");
  expect(await run(ctx, { page: "permissions" })).toEqual({
    ref: "help:permissions#lang=fr",
    title: "Autorisations",
    language: "fr",
    text: "# Autorisations\n\nLecture seule.\n",
  });
  expect(await run(ctx, { page: "permissions", language: "de" })).toMatchObject({
    title: "Permissions",
    language: "en",
    ref: "help:permissions#lang=en",
  });
  expect(await run(ctx, { plugin: "serial-monitor", language: "de" })).toMatchObject({
    ref: "help:plugin/serial-monitor#lang=de",
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

it("settles Help on Stop even while plugin discovery is pending", async () => {
  const { ctx, plugins } = context();
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  plugins.mockImplementationOnce(async () => {
    await held;
    return [];
  });
  const controller = new AbortController();
  const request = new ToolRegistry().execute(ctx, "help", {}, controller.signal);
  try {
    await vi.waitFor(() => expect(plugins).toHaveBeenCalledWith(controller.signal));
    controller.abort();
    expect(await request).toMatchObject({ isError: true, text: expect.stringContaining("Tool aborted") });
  } finally {
    release();
  }
});

it("distinguishes a disabled skill from an unavailable skill", async () => {
  const ctx = createToolContext(temporary);
  ctx.skills = new SkillCatalog({ root: temporary, disabled: () => ["disabled"] });
  const registry = new ToolRegistry();
  const signal = new AbortController().signal;
  for (const [name, code] of [
    ["disabled", "DENIED"],
    ["missing", "NOT_FOUND"],
  ]) {
    const result = await registry.execute(ctx, "load_skill", { name }, signal);
    expect(JSON.parse(result.text)).toMatchObject({
      isError: true,
      code,
      error: expect.stringContaining(name === "disabled" ? "disabled" : "unavailable"),
    });
  }
});

it.each(["help", "load_skill"])(
  "reads every character of a long %s page under the tool budget",
  async (name) => {
    const { ctx } = context("en");
    const text = `# Guide\n${'"\\😀secret\n'.repeat(2400)}Final step.`;
    const folder = join(temporary, ".vera", "skills", "guide");
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, "SKILL.md"), `---\nname: guide\ndescription: Long guide\n---\n${text}`);
    await writeFile(join(temporary, "help", "en", "guide.md"), text);
    ctx.skills = new SkillCatalog({ root: temporary, disabled: () => [] });
    ctx.advanced = (key) => resolveAdvanced(key, { app: { toolResultChars: 8000 } }).value;
    ctx.maskText = (value) => value.replaceAll("secret", "[REDACTED]");
    const registry = new ToolRegistry();
    const signal = new AbortController().signal;
    const args = name === "help" ? { page: "guide" } : { name: "guide" };
    let offset: number | undefined = 1;
    let returned = "";
    let pages = 0;
    while (offset !== undefined) {
      const before = offset;
      const result = await registry.execute(ctx, name, { ...args, offset }, signal);
      expect(result).toMatchObject({ isError: false, truncated: false });
      expect(result.text.length).toBeLessThanOrEqual(8000);
      const page = JSON.parse(result.text) as { text: string; nextOffset?: number; ref?: string };
      if (name === "help") expect(page.ref).toBe("help:guide#lang=en");
      expect(page.text.at(-1)).not.toMatch(/[\uD800-\uDBFF]/u);
      returned += page.text;
      offset = page.nextOffset;
      if (offset !== undefined) expect(offset).toBe(before + page.text.length);
      expect(++pages).toBeLessThan(20);
    }
    expect(pages).toBeGreaterThan(1);
    expect(returned).toBe(ctx.maskText(text));
  },
);
