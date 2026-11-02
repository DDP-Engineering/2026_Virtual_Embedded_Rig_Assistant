import { type ProgramResolver, unresolvedPrograms } from "@vera/core";
import { z } from "zod";

const testPrograms = z.record(
  z.string().regex(/^[a-z0-9-]{1,64}\/[a-z0-9._-]{1,64}$/),
  z.strictObject({
    executable: z.string().min(1).max(4096),
    prefix: z.array(z.string().min(1).max(4096)).max(64).optional(),
  }),
);
/**
 * The resolver of instrumented builds: `VERA_TEST_PROGRAMS` maps `<plugin>/<program>` to an executable
 * and leading arguments, so end-to-end tests run fixture plugins before provisioning exists. A missing or
 * malformed value resolves nothing.
 */
export function testProgramResolver(value: string | undefined): ProgramResolver {
  let parsed: z.infer<typeof testPrograms>;
  try {
    parsed = testPrograms.parse(JSON.parse(value ?? ""));
  } catch {
    return unresolvedPrograms;
  }
  return {
    resolve: async (plugin, program) => {
      const entry = parsed[`${plugin.manifest.id}/${program}`];
      return entry
        ? { executable: entry.executable, ...(entry.prefix ? { prefix: entry.prefix } : {}) }
        : undefined;
    },
  };
}
