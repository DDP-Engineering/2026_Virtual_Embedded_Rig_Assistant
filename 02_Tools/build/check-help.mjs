import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { importSoftware, software } from "../environment/software.mjs";
import { shortcutPages } from "./generate-help-shortcuts.mjs";

const languages = ["en", "ro", "de", "fr"];
const external = /^(?:https?|mailto):/i;

/** Link targets of Markdown text outside code: inline `[t](target)` links and `[ref]: target` definitions. */
export function links(text) {
  const prose = text.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, "").replace(/`[^`\n]*`/g, "");
  const inline = [...prose.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)];
  const definitions = [...prose.matchAll(/^ {0,3}\[[^\]]+\]:\s*<?([^\s>]+)>?/gm)];
  return [...inline, ...definitions].map((match) => match[1]);
}

/** True when the page has no text besides its level-one title. */
function empty(text) {
  return text.replace(/^#[ \t]+.*$/m, "").trim() === "";
}

/**
 * Help completeness: the app page set of every language equals English's, official plugins have all four languages,
 * relative links name an existing app page as `name.md`, and no page is only a title.
 */
export function auditHelp({ app, plugins, official }) {
  const errors = new Set();
  const english = new Set(Object.keys(app.en ?? {}));
  for (const language of languages) {
    const pages = new Set(Object.keys(app[language] ?? {}));
    if (language === "en") continue;
    for (const page of english) if (!pages.has(page)) errors.add(`app ${language} missing page: ${page}`);
    for (const page of pages)
      if (!english.has(page)) errors.add(`app ${language} page not in English: ${page}`);
  }
  for (const id of official)
    for (const language of languages)
      if (plugins[id]?.[language] === undefined) errors.add(`plugin ${id} missing help: ${language}`);
  const pages = [
    ...Object.entries(app).flatMap(([language, entries]) =>
      Object.entries(entries).map(([page, text]) => [`app/${language}/${page}`, text]),
    ),
    ...Object.entries(plugins).flatMap(([id, entries]) =>
      Object.entries(entries).map(([language, text]) => [`plugin/${id}/${language}`, text]),
    ),
  ];
  for (const [where, text] of pages) {
    if (empty(text)) errors.add(`empty page: ${where}`);
    for (const target of links(text)) {
      if (external.test(target)) continue;
      const page = /^([a-z0-9][a-z0-9-]{0,63})\.md$/.exec(target)?.[1];
      if (!page || !english.has(page)) errors.add(`broken link in ${where}: ${target}`);
    }
  }
  return [...errors].sort();
}

/** A shortcuts page that differs from the one the shortcut registry generates (npm run help:shortcuts). */
export function auditShortcuts(app, generated) {
  return Object.entries(generated)
    .filter(([language, text]) => app[language]?.shortcuts !== text)
    .map(([language]) => `app ${language} shortcuts page out of date`);
}

async function markdownIn(folder) {
  try {
    return (await readdir(folder)).filter((name) => name.endsWith(".md"));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

/** The repository's app help, plugin help and official plugin ids. */
async function repositoryHelp() {
  const app = {};
  for (const language of languages) {
    app[language] = {};
    const folder = join(software, "help", language);
    for (const name of await markdownIn(folder))
      app[language][name.slice(0, -3)] = await readFile(join(folder, name), "utf8");
  }
  const plugins = {};
  const root = join(software, "plugins");
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const folder = join(root, entry.name, "help");
    for (const name of await markdownIn(folder)) {
      plugins[entry.name] ??= {};
      plugins[entry.name][name.slice(0, -3)] = await readFile(join(folder, name), "utf8");
    }
  }
  const { parse } = await importSoftware("yaml");
  const official = parse(await readFile(join(root, "catalog.yaml"), "utf8")).official ?? [];
  return { app, plugins, official };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const help =
    process.argv[2] === "--fixture" && process.argv[3]
      ? JSON.parse(await readFile(resolve(process.argv[3]), "utf8"))
      : await repositoryHelp();
  const errors = auditHelp(help);
  if (process.argv[2] !== "--fixture") errors.push(...auditShortcuts(help.app, await shortcutPages()));
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
  } else
    console.log(
      `help: en/ro/de/fr app pages complete (${Object.keys(help.app.en ?? {}).length}), ` +
        `${help.official.length} official plugins in four languages, links valid`,
    );
}
