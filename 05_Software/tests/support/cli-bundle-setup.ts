import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    cliBundle: string;
  }
}

/** Compile once per integration run; each consumer copies before modifying its private fixture. */
export default async function setup(project: TestProject) {
  const root = resolve(import.meta.dirname, "../..");
  await mkdir(join(root, "node_modules/.cache"), { recursive: true });
  const output = await mkdtemp(join(root, "node_modules/.cache/vera-cli-suite-"));
  try {
    await build({
      entryPoints: Object.fromEntries(
        ["index", "grep-worker", "pdf-worker", "embedding-worker"].map((name) => [
          name,
          join(root, `src/apps/cli/src/${name}.ts`),
        ]),
      ),
      outdir: output,
      bundle: true,
      format: "esm",
      platform: "node",
      target: "node24",
      packages: "external",
      alias: {
        "@vera/core": join(root, "src/libraries/core/src/index.ts"),
        "@vera/shared": join(root, "src/libraries/shared/src/index.ts"),
        "@vera/core/replay": join(root, "src/libraries/core/src/llm/replay.ts"),
        ...Object.fromEntries(
          ["grep-worker", "pdf-worker", "embedding-worker"].map((name) => [
            `@vera/core/${name}`,
            join(root, `src/libraries/core/src/${name === "grep-worker" ? "tools" : "knowledge"}/${name}.ts`),
          ]),
        ),
      },
    });
    await build({
      entryPoints: [join(root, "tests/support/network-guard.ts")],
      outfile: join(output, "guard.mjs"),
      platform: "node",
      format: "esm",
      bundle: true,
      footer: { js: "installTestNetworkGuard();" },
    });
    project.provide("cliBundle", output);
  } catch (error) {
    await rm(output, { recursive: true, force: true });
    throw error;
  }
  return () => rm(output, { recursive: true, force: true });
}
