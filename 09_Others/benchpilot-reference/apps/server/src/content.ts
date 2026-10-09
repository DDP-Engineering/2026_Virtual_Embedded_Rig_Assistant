// Shared helpers for loading client content files (03): YAML parsing and readable validation errors.
import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import type { z } from "zod";

export class ContentError extends Error {
  constructor(
    readonly file: string,
    message: string,
  ) {
    super(`${file}: ${message}`);
    this.name = "ContentError";
  }
}

/** Validates `value` with `schema`; failures name the file and every offending path. */
export function validate<T>(schema: z.ZodType<T>, value: unknown, file: string): T {
  const r = schema.safeParse(value);
  if (r.success) return r.data;
  const issues = r.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
  throw new ContentError(file, issues);
}

export function readYaml(file: string): unknown {
  try {
    return parseYaml(readFileSync(file, "utf8"));
  } catch (err) {
    throw new ContentError(file, `invalid YAML: ${(err as Error).message}`);
  }
}

/** Splits `---\nfrontmatter\n---\nbody`. */
export function splitFrontmatter(text: string, file: string): { data: unknown; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) throw new ContentError(file, "missing YAML frontmatter (--- … ---)");
  try {
    return { data: parseYaml(m[1]!), body: m[2]! };
  } catch (err) {
    throw new ContentError(file, `invalid frontmatter: ${(err as Error).message}`);
  }
}
