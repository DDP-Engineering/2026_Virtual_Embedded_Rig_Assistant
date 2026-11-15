// REQ-FUNC-3b3bc8bd
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "vitest";
import { defaultShortcuts, shortcutCommands } from "../../src/libraries/shared/src/keyboard-shortcuts.js";

test("the shortcuts help page lists every registry command with its default keys and catalog labels", async () => {
  const { shortcutPages } = await import(
    /* @vite-ignore */ pathToFileURL(`${process.cwd()}/../02_Tools/build/generate-help-shortcuts.mjs`).href
  );
  const pages: Record<string, string> = await shortcutPages();
  expect(Object.keys(pages)).toEqual(["en", "ro", "de", "fr"]);
  for (const [language, page] of Object.entries(pages)) {
    const catalog = JSON.parse(
      await readFile(join("src/apps/desktop/src/renderer/locales", `${language}.json`), "utf8"),
    );
    expect(page.split("\n")[0]).toBe(`# ${catalog.keyboard.shortcuts}`);
    for (const command of shortcutCommands) {
      const keys = defaultShortcuts[command].map((binding) => binding.replace("Mod", "Ctrl")).join(", ");
      expect(page).toContain(`| ${catalog.keyboard[command]} | ${keys || catalog.keyboard.unassigned} |`);
    }
    expect(page).toContain("| F1 |");
    // The committed page is the generated one.
    expect(await readFile(join("help", language, "shortcuts.md"), "utf8")).toBe(page);
  }
});
