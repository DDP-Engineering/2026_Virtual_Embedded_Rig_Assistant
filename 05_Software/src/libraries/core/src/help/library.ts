import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import {
  HELP_PAGE_BYTES,
  type HelpLanguage,
  type HelpPage,
  type HelpPageSummary,
  helpPageNameSchema,
  helpTitle,
  orderHelpPages,
  veraError,
} from "@vera/shared";

/**
 * Reads a help file only when its real path stays below the real `root` and it is a regular file within the page
 * size limit; anything else, a symlink that leaves the root included, counts as absent.
 */
export async function readHelpFile(
  root: string,
  path: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  signal?.throwIfAborted();
  try {
    const [base, real] = await Promise.all([realpath(root), realpath(path)]);
    const inside = relative(base, real);
    if (!inside || inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) return undefined;
    const info = await stat(real);
    if (!info.isFile() || info.size > HELP_PAGE_BYTES) return undefined;
    const content = await readFile(real, { encoding: "utf8", ...(signal && { signal }) });
    return Buffer.byteLength(content, "utf8") <= HELP_PAGE_BYTES ? content : undefined;
  } catch {
    signal?.throwIfAborted();
    return undefined;
  }
}

/**
 * An installed plugin's help: `<folder>/help/<language>.md`, else `help/en.md`; undefined when it has neither. The
 * file's real path must stay below `<folder>/help`.
 */
export async function readPluginHelp(
  folder: string,
  language: HelpLanguage,
  signal?: AbortSignal,
): Promise<{ title: string; language: HelpLanguage; content: string } | undefined> {
  signal?.throwIfAborted();
  const root = join(folder, "help");
  // The help folder itself must be the package's own folder, not a link that leaves the package.
  try {
    const [base, real] = await Promise.all([realpath(folder), realpath(root)]);
    if (relative(base, real) !== "help") return undefined;
  } catch {
    signal?.throwIfAborted();
    return undefined;
  }
  for (const served of language === "en" ? (["en"] as const) : [language, "en" as const]) {
    const content = await readHelpFile(root, join(root, `${served}.md`), signal);
    if (content !== undefined) return { title: helpTitle(content, served), language: served, content };
  }
  return undefined;
}

/** App help: `<root>/<language>/<page>.md`, read-only, English when a language lacks a page. */
export class HelpLibrary {
  constructor(private readonly root: string) {}

  /** The pages of `language`, English pages filling its gaps; index first, then its links, then by name. */
  async list(language: HelpLanguage, signal?: AbortSignal): Promise<HelpPageSummary[]> {
    const pages = await this.load(language, signal);
    if (language !== "en") await this.load("en", signal, pages);
    return orderHelpPages(pages.keys(), pages.get("index")?.content ?? "").flatMap((name) => {
      const page = pages.get(name);
      return page ? [{ page: page.page, title: page.title, language: page.language }] : [];
    });
  }

  /** One page in `language`, else in English; NOT_FOUND when neither exists, INVALID for a malformed name. */
  async read(page: string, language: HelpLanguage, signal?: AbortSignal): Promise<HelpPage> {
    signal?.throwIfAborted();
    if (!helpPageNameSchema.safeParse(page).success) throw veraError("INVALID");
    for (const served of language === "en" ? (["en"] as const) : [language, "en" as const]) {
      const content = await readHelpFile(this.root, join(this.root, served, `${page}.md`), signal);
      if (content !== undefined) return { page, title: helpTitle(content, page), language: served, content };
    }
    throw veraError("NOT_FOUND");
  }

  private async load(language: HelpLanguage, signal?: AbortSignal, pages = new Map<string, HelpPage>()) {
    signal?.throwIfAborted();
    const folder = join(this.root, language);
    let names: string[];
    try {
      names = await readdir(folder);
    } catch {
      signal?.throwIfAborted();
      return pages;
    }
    for (const file of names.sort()) {
      signal?.throwIfAborted();
      const page = file.endsWith(".md") ? file.slice(0, -3) : "";
      if (pages.has(page) || !helpPageNameSchema.safeParse(page).success) continue;
      const content = await readHelpFile(this.root, join(folder, file), signal);
      if (content !== undefined)
        pages.set(page, { page, title: helpTitle(content, page), language, content });
    }
    return pages;
  }
}
