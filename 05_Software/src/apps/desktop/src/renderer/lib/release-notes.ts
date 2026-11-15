import { z } from "zod";

/** Release-note categories, in display order. */
export const releaseCategories = ["new", "improved", "fixed"] as const;
export type ReleaseCategory = (typeof releaseCategories)[number];

const texts = z.object({ en: z.string().min(1) }).catchall(z.string());
const fileSchema = z.object({
  version: z.string().min(1),
  date: z.string().nullable(),
  entries: z.array(z.object({ category: z.enum(releaseCategories), topic: texts, text: texts })),
});

export interface Release {
  version: string;
  date: string | null;
  groups: { category: ReleaseCategory; items: { topic: string; text: string }[] }[];
}

const core = (version: string) => version.split("-")[0]?.split(".").map(Number) ?? [];

/** Unreleased first, then releases newest first; a pre-release sorts below its release. */
function newestFirst(a: string, b: string): number {
  if (a === "Unreleased" || b === "Unreleased") return a === b ? 0 : a === "Unreleased" ? -1 : 1;
  const [x, y] = [core(a), core(b)];
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0);
  return Number(a.includes("-")) - Number(b.includes("-")) || b.localeCompare(a);
}

/**
 * The release notes bundled at build time, in `language` with English where a text is missing.
 * Files that do not match the format and releases without entries are left out.
 */
export function releasesFor(files: unknown[], language: string): Release[] {
  const pick = (value: Record<string, string> & { en: string }) => value[language] || value.en;
  return files
    .flatMap((file) => {
      const parsed = fileSchema.safeParse(file);
      return parsed.success && parsed.data.entries.length ? [parsed.data] : [];
    })
    .sort((a, b) => newestFirst(a.version, b.version))
    .map((file) => ({
      version: file.version,
      date: file.date,
      groups: releaseCategories
        .map((category) => ({
          category,
          items: file.entries
            .filter((entry) => entry.category === category)
            .map((entry) => ({ topic: pick(entry.topic), text: pick(entry.text) })),
        }))
        .filter((group) => group.items.length),
    }));
}
