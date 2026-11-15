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
export async function readHelpFile(root: string, path: string): Promise<string | undefined> {
  try {
    const [base, real] = await Promise.all([realpath(root), realpath(path)]);
    const inside = relative(base, real);
    if (!inside || inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) return undefined;
    const info = await stat(real);
    if (!info.isFile() || info.size > HELP_PAGE_BYTES) return undefined;
    return await readFile(real, "utf8");
  } catch {
    return undefined;
  }
}

/** App help: `<root>/<language>/<page>.md`, read-only, English when a language lacks a page. */
export class HelpLibrary {
  constructor(private readonly root: string) {}

  /** The pages of `language`, English pages filling its gaps; index first, then its links, then by name. */
  async list(language: HelpLanguage): Promise<HelpPageSummary[]> {
    const own = await this.load(language);
    const english = language === "en" ? own : await this.load("en");
    const pages = new Map<string, HelpPage>([...english, ...own]);
    return orderHelpPages(pages.keys(), pages.get("index")?.content ?? "").flatMap((name) => {
      const page = pages.get(name);
      return page ? [{ page: page.page, title: page.title, language: page.language }] : [];
    });
  }

  /** One page in `language`, else in English; NOT_FOUND when neither exists, INVALID for a malformed name. */
  async read(page: string, language: HelpLanguage): Promise<HelpPage> {
    if (!helpPageNameSchema.safeParse(page).success) throw veraError("INVALID");
    for (const served of language === "en" ? (["en"] as const) : [language, "en" as const]) {
      const content = await readHelpFile(this.root, join(this.root, served, `${page}.md`));
      if (content !== undefined) return { page, title: helpTitle(content, page), language: served, content };
    }
    throw veraError("NOT_FOUND");
  }

  private async load(language: HelpLanguage): Promise<Map<string, HelpPage>> {
    const folder = join(this.root, language);
    const pages = new Map<string, HelpPage>();
    let names: string[];
    try {
      names = await readdir(folder);
    } catch {
      return pages;
    }
    for (const file of names.sort()) {
      const page = file.endsWith(".md") ? file.slice(0, -3) : "";
      if (!helpPageNameSchema.safeParse(page).success) continue;
      const content = await readHelpFile(this.root, join(folder, file));
      if (content !== undefined)
        pages.set(page, { page, title: helpTitle(content, page), language, content });
    }
    return pages;
  }
}
