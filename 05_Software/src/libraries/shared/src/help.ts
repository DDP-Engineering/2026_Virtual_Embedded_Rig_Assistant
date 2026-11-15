import { z } from "zod";

/** The languages help is written in; the same codes as the interface languages. */
export const helpLanguages = ["en", "ro", "de", "fr"] as const;
export const helpLanguageSchema = z.enum(helpLanguages);
export type HelpLanguage = z.infer<typeof helpLanguageSchema>;
/** A page is a file stem: `getting-started` is `<lang>/getting-started.md`. */
export const helpPageNameSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
export const HELP_PAGE_BYTES = 256 * 1024;
export const helpListRequestSchema = z.strictObject({ language: helpLanguageSchema });
export const helpPageSummarySchema = z.strictObject({
  page: helpPageNameSchema,
  title: z.string().min(1).max(256),
  /** The language served: the requested one, or en when the page exists only in English. */
  language: helpLanguageSchema,
});
export const helpReadRequestSchema = z.strictObject({
  page: helpPageNameSchema,
  language: helpLanguageSchema,
});
export const helpPageSchema = helpPageSummarySchema.extend({ content: z.string().max(HELP_PAGE_BYTES) });
export type HelpPageSummary = z.infer<typeof helpPageSummarySchema>;
export type HelpPage = z.infer<typeof helpPageSchema>;

/** The first level-one heading of a page, else `fallback`. */
export function helpTitle(content: string, fallback: string): string {
  const heading = /^#[ \t]+(.+?)[ \t#]*$/m.exec(content)?.[1]?.trim();
  return (heading || fallback).slice(0, 256);
}

/** Page names linked from Markdown as `(name.md)` or `(name.md#anchor)`, in link order. */
export function helpLinks(content: string): string[] {
  return [...content.matchAll(/\]\(([a-z0-9][a-z0-9-]{0,63})\.md(?:#[^)\s]*)?\)/g)].map(
    (match) => match[1] ?? "",
  );
}

/** `index` first, then the pages `index` links in link order, then the rest by name; only names in `names`. */
export function orderHelpPages(names: Iterable<string>, index: string): string[] {
  const present = new Set(names);
  return [...new Set(["index", ...helpLinks(index), ...[...present].sort()])].filter((name) =>
    present.has(name),
  );
}
