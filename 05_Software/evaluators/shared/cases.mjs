import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, normalize, resolve } from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import { sha256, software } from "./identity.mjs";

const relativePath = z
  .string()
  .min(1)
  .max(260)
  .refine(
    (path) => !isAbsolute(path) && !normalize(path).split(/[\\/]/).includes(".."),
    "must stay inside its folder",
  );

/**
 * Schema of a case file (`schema: 1`). `expect` is the family's own expectation schema. `workbench`
 * is relative to 05_Software; `replay` is relative to the case file; `setup` writes extra files into
 * the run's copy of the workbench.
 */
export function caseFileSchema(expect) {
  const item = z.strictObject({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/, "lowercase letters, digits and dashes"),
    language: z.enum(["en", "ro", "de", "fr"]),
    prompt: z.string().min(1).max(32_000),
    workbench: relativePath.optional(),
    replay: relativePath.optional(),
    timeoutSeconds: z.number().int().min(10).max(3600).optional(),
    /** Plugins enabled in this case's workbench (installed by the family); default: all installed. */
    plugins: z
      .array(z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/))
      .max(40)
      .optional(),
    // A text file, or a PDF rendered from Markdown (`<!-- page -->` breaks pages) like the demo PDFs.
    setup: z
      .array(
        z.union([
          z.strictObject({ path: relativePath, content: z.string().max(1_000_000) }),
          z.strictObject({ path: relativePath, pdf: z.string().max(200_000) }),
        ]),
      )
      .max(50)
      .optional(),
    expect,
  });
  return z
    .strictObject({
      schema: z.literal(1),
      workbench: relativePath,
      timeoutSeconds: z.number().int().min(10).max(3600).optional(),
      cases: z.array(item).min(1).max(500),
    })
    .superRefine((file, context) => {
      const seen = new Set();
      file.cases.forEach((item, index) => {
        if (seen.has(item.id))
          context.addIssue({
            code: "custom",
            path: ["cases", index, "id"],
            message: `duplicate id ${item.id}`,
          });
        seen.add(item.id);
      });
    });
}

const describe = (issues) =>
  issues.map((issue) => `${issue.path.join(".") || "(file)"}: ${issue.message}`).join("; ");

/** Parses and validates a case file before any model call; throws with every problem found. */
export function parseCases(text, expect, file = "cases") {
  const parsed = caseFileSchema(expect).safeParse(parse(text));
  if (!parsed.success) throw Error(`Invalid case file ${file}: ${describe(parsed.error.issues)}`);
  return parsed.data;
}

export async function loadCases(path, expect) {
  const text = await readFile(path, "utf8");
  const data = parseCases(text, expect, path);
  const folder = dirname(path);
  return {
    ...data,
    file: path,
    sha256: sha256(text),
    cases: data.cases.map((item) => ({
      ...item,
      workbenchPath: resolve(software, item.workbench ?? data.workbench),
      ...(item.replay ? { replayPath: resolve(folder, item.replay) } : {}),
      timeoutSeconds: item.timeoutSeconds ?? data.timeoutSeconds ?? 600,
    })),
  };
}
