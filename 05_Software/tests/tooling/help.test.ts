// REQ-TEST-9f88aab3, REQ-TEST-af2cc3f5, REQ-TEST-781459ea
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { expect, test } from "vitest";

const path = "../02_Tools/build/check-help.mjs";
const page = (title: string) =>
  `# ${title}\n\nText with [Permissions](permissions.md) and [web](https://example.com).\n`;
function complete() {
  const app = Object.fromEntries(
    ["en", "ro", "de", "fr"].map((lang) => [lang, { index: page(`Index ${lang}`), permissions: page(lang) }]),
  ) as Record<string, Record<string, string>>;
  const plugins: Record<string, Record<string, string>> = {
    official: Object.fromEntries(["en", "ro", "de", "fr"].map((lang) => [lang, page(`Plugin ${lang}`)])),
    community: { en: page("Community") },
  };
  return { app, plugins, official: ["official"] };
}

test("help audit requires the same page set in four languages and four languages for official plugins", async () => {
  const { auditHelp } = await import(/* @vite-ignore */ pathToFileURL(`${process.cwd()}/${path}`).href);
  expect(auditHelp(complete())).toEqual([]);
  const help = complete();
  delete help.app.fr?.permissions;
  if (help.app.de) help.app.de.extra = page("Nur Deutsch");
  delete help.plugins.official?.ro;
  expect(auditHelp(help)).toEqual([
    "app de page not in English: extra",
    "app fr missing page: permissions",
    "plugin official missing help: ro",
  ]);
});

test("help audit reports broken relative links and pages with no text besides the title", async () => {
  const { auditHelp } = await import(/* @vite-ignore */ pathToFileURL(`${process.cwd()}/${path}`).href);
  const help = complete();
  if (help.app.en)
    help.app.en.index =
      "# Index\n\n[a](missing.md) [b](../README.md) [c](permissions.md#modes) [d](permissions.md)\n";
  if (help.plugins.community) help.plugins.community.en = "# Community\n\n";
  expect(auditHelp(help)).toEqual([
    "broken link in app/en/index: ../README.md",
    "broken link in app/en/index: missing.md",
    "broken link in app/en/index: permissions.md#modes",
    "empty page: plugin/community/en",
  ]);
});

test("help CLI fails with the broken-link fixture", () => {
  const result = spawnSync(process.execPath, [path, "--fixture", "tests/fixtures/help/broken-link.json"], {
    encoding: "utf8",
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("broken link in app/en/index: missing.md");
});

test("help audit reports a shortcuts page that differs from the generated one", async () => {
  const { auditShortcuts } = await import(/* @vite-ignore */ pathToFileURL(`${process.cwd()}/${path}`).href);
  const generated = { en: "# Keyboard shortcuts\n\nA.\n", fr: "# Raccourcis clavier\n\nA.\n" };
  expect(
    auditShortcuts({ en: { shortcuts: generated.en }, fr: { shortcuts: generated.fr } }, generated),
  ).toEqual([]);
  expect(auditShortcuts({ en: { shortcuts: "# Old\n" }, fr: {} }, generated)).toEqual([
    "app en shortcuts page out of date",
    "app fr shortcuts page out of date",
  ]);
});

test("help links are taken from prose and reference definitions, not from code", async () => {
  const { links } = await import(/* @vite-ignore */ pathToFileURL(`${process.cwd()}/${path}`).href);
  const text = [
    "# Page",
    "",
    'See [a](a.md), [b](<b.md>), [c](c.md "Title"), ![image](img.png) and [mail](mailto:x@example.com).',
    "Inline code `[x](inline.md)` is not a link.",
    "```",
    "[fenced](fenced.md)",
    "```",
    "~~~",
    "[tilde](tilde.md)",
    "~~~",
    "[ref]: ref.md",
  ].join("\n");
  expect(links(text)).toEqual(["a.md", "b.md", "c.md", "img.png", "mailto:x@example.com", "ref.md"]);
});

test("help CLI passes on the repository's app and plugin help", () => {
  const result = spawnSync(process.execPath, [path], { encoding: "utf8" });
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("official plugins in four languages");
}, 15000);
