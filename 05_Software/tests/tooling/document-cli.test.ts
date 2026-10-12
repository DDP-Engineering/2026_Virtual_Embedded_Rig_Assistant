import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { expect, it } from "vitest";

const software = fileURLToPath(new URL("../../", import.meta.url));
it("runs owned CLI index/search and PDF replay through real local worker bundles, preserving a locked snapshot", async () => {
  const cache = join(software, "node_modules/.cache");
  await mkdir(cache, { recursive: true });
  const scratch = await mkdtemp(join(cache, "vera-doc-cli-")),
    out = join(scratch, "bundle"),
    bench = join(scratch, "bench");
  const evidence = process.env.VERA_DOC_EVIDENCE_DIR
    ? await mkdtemp(join(process.env.VERA_DOC_EVIDENCE_DIR, "cli-"))
    : undefined;
  try {
    await build({
      entryPoints: {
        index: join(software, "apps/cli/src/index.ts"),
        "grep-worker": join(software, "apps/cli/src/grep-worker.ts"),
        "pdf-worker": join(software, "apps/cli/src/pdf-worker.ts"),
        "embedding-worker": join(software, "apps/cli/src/embedding-worker.ts"),
      },
      outdir: out,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node24",
      packages: "external",
      alias: {
        "@vera/core": join(software, "packages/core/src/index.ts"),
        "@vera/shared": join(software, "packages/shared/src/index.ts"),
        "@vera/core/replay": join(software, "packages/core/src/llm/replay.ts"),
        "@vera/core/grep-worker": join(software, "packages/core/src/tools/grep-worker.ts"),
        "@vera/core/pdf-worker": join(software, "packages/core/src/knowledge/pdf-worker.ts"),
        "@vera/core/embedding-worker": join(software, "packages/core/src/knowledge/embedding-worker.ts"),
      },
    });
    await build({
      entryPoints: [join(software, "tests/network-guard.ts")],
      outfile: join(out, "guard.mjs"),
      bundle: true,
      platform: "node",
      format: "esm",
      footer: { js: "installTestNetworkGuard();" },
    });
    if (evidence) await cp(out, join(evidence, "bundle"), { recursive: true });
    await cp(join(software, "fixtures/workbenches/demo-board"), bench, { recursive: true });
    let count = 0;
    const run = async (args: string[]) => {
      const env = { ...process.env };
      delete env.OPENAI_API_KEY;
      const argv = ["--import", pathToFileURL(join(out, "guard.mjs")).href, join(out, "index.js"), ...args],
        started = new Date().toISOString();
      const result = spawnSync(process.execPath, argv, {
        cwd: software,
        env,
        encoding: "utf8",
        timeout: 60000,
      });
      if (evidence) {
        const name = String(++count);
        await writeFile(join(evidence, `${name}.stdout`), result.stdout ?? "");
        await writeFile(join(evidence, `${name}.stderr`), result.stderr ?? "");
        await writeFile(
          join(evidence, `${name}.json`),
          JSON.stringify(
            {
              argv: [process.execPath, ...argv],
              cwd: software,
              started,
              ended: new Date().toISOString(),
              exit: result.status,
              entrySha256: createHash("sha256")
                .update(await readFile(join(out, "index.js")))
                .digest("hex"),
            },
            null,
            2,
          ),
        );
      }
      expect(result.error).toBeUndefined();
      return result;
    };
    const indexed = await run(["index", "--workbench", bench]);
    expect(indexed.status, indexed.stderr).toBe(0);
    expect(
      JSON.parse(indexed.stdout).documents.filter((d: { status: string }) => d.status === "indexed").length,
    ).toBeGreaterThanOrEqual(5);
    for (const mode of ["keyword", "semantic", "hybrid"]) {
      const search = await run([
        "search",
        "--workbench",
        bench,
        "--query",
        "I2C1_CR1",
        "--mode",
        mode,
        "--path-glob",
        "docs/*.pdf",
        "--k",
        "5",
      ]);
      expect(search.status, search.stderr).toBe(0);
      expect(JSON.parse(search.stdout).results[0].ref).toMatch(/\.pdf#p=[1-9]/);
    }
    const script = join(software, "fixtures/llm-scripts/search-read-document.jsonl");
    const replay = await run([
      "run",
      "--workbench",
      bench,
      "--prompt",
      "Search the I2C register",
      "--provider",
      "replay",
      "--script",
      script,
    ]);
    expect(replay.status, replay.stderr).toBe(0);
    const events = replay.stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line).event);
    expect(events.filter((e) => e.type === "tool.done").every((e) => e.ok)).toBe(true);
    expect(events.filter((e) => e.type === "message.done").at(-1).citations).toEqual([
      { ref: "docs/vera-demo-01-reference-manual.pdf#p=1", valid: true },
      { ref: "docs/vera-demo-01-reference-manual.pdf#p=999", valid: false },
    ]);
    await expect(readFile(join(bench, ".vera/lock"))).rejects.toMatchObject({ code: "ENOENT" });
    const invalid = await run(["search", "--workbench", bench, "--query", "x", "--k", "21"]);
    expect(invalid.status).toBe(2);
    const before = await readFile(join(bench, ".vera/vera.db"));
    await writeFile(
      join(bench, ".vera/lock"),
      JSON.stringify({
        pid: process.pid,
        token: "foreign-owner",
        app: "0.0.0",
        since: new Date().toISOString(),
      }),
    );
    const locked = await run(["index", "--workbench", bench]);
    expect(locked.status).toBe(1);
    const protectedSearch = await run([
      "search",
      "--workbench",
      bench,
      "--query",
      "I2C1_CR1",
      "--mode",
      "hybrid",
    ]);
    expect(protectedSearch.status, protectedSearch.stderr).toBe(0);
    expect(JSON.parse(protectedSearch.stdout).results.length).toBeGreaterThan(0);
    expect(await readFile(join(bench, ".vera/vera.db"))).toEqual(before);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}, 120000);
