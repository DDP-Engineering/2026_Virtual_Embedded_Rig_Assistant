import {
  type HelpLanguage,
  type HelpPage,
  type HelpPageSummary,
  helpPageNameSchema,
  helpTitle,
  orderHelpPages,
  veraError,
} from "@vera/shared";

/** The app help of the source tree, `05_Software/help/<language>/<page>.md`, for the browser mock. */
const files = import.meta.glob<string>("../../../../../../help/*/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
});
/** The official plugins' help, `05_Software/plugins/<id>/help/<language>.md`. */
const pluginFiles = import.meta.glob<string>("../../../../../../plugins/*/help/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
});
const pages = new Map<string, string>();
for (const [path, content] of Object.entries(files)) {
  const match = /\/help\/([a-z]{2})\/([a-z0-9-]+)\.md$/.exec(path);
  if (match) pages.set(`${match[1]}/${match[2]}`, content);
}
const pluginPages = new Map<string, string>();
for (const [path, content] of Object.entries(pluginFiles)) {
  const match = /\/plugins\/([a-z0-9-]+)\/help\/(en|ro|de|fr)\.md$/.exec(path);
  if (match) pluginPages.set(`${match[1]}/${match[2]}`, content);
}

export function mockHelpRead(page: string, language: HelpLanguage): HelpPage {
  if (!helpPageNameSchema.safeParse(page).success) throw veraError("INVALID");
  for (const served of language === "en" ? (["en"] as const) : [language, "en" as const]) {
    const content = pages.get(`${served}/${page}`);
    if (content !== undefined) return { page, title: helpTitle(content, page), language: served, content };
  }
  throw veraError("NOT_FOUND");
}

export function mockHelpList(language: HelpLanguage): HelpPageSummary[] {
  const names = new Set(
    [...pages.keys()]
      .filter((key) => key.startsWith("en/") || key.startsWith(`${language}/`))
      .map((key) => key.slice(3)),
  );
  const index = pages.get(`${language}/index`) ?? pages.get("en/index") ?? "";
  return orderHelpPages(names, index).map((name) => {
    const { content: _, ...summary } = mockHelpRead(name, language);
    return summary;
  });
}

/** The help languages of an official plugin in the source tree, for its mock composition. */
export function mockPluginHelpLanguages(id: string): HelpLanguage[] {
  return (["de", "en", "fr", "ro"] as const).filter((language) => pluginPages.has(`${id}/${language}`));
}

export function mockPluginHelpRead(id: string, language: HelpLanguage): HelpPage {
  for (const served of language === "en" ? (["en"] as const) : [language, "en" as const]) {
    const content = pluginPages.get(`${id}/${served}`);
    if (content !== undefined)
      return { page: id, plugin: id, title: helpTitle(content, id), language: served, content };
  }
  throw veraError("NOT_FOUND");
}
