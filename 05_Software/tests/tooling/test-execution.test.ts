import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, it } from "vitest";
// @ts-expect-error Node ESM test runner helper.
import { ensureDesktopTestBuild } from "../support/test-build.mjs";
// @ts-expect-error Node ESM test runner helper.
import { e2eLanes, needsSingleE2eRun } from "../support/test-execution.mjs";

it("keeps stateful selection and machine reports in one run instead of dropping or overwriting results", () => {
  for (const args of [
    ["--shard=1/2"],
    ["--last-failed"],
    ["--test-list", "selected.txt"],
    ["-c", "custom.ts"],
    ["--reporter=json"],
    ["--reporter", "list,junit"],
  ])
    expect(needsSingleE2eRun(args)).toBe(true);
  expect(needsSingleE2eRun(["bookmarks.spec.ts", "--grep", "browser", "--reporter=list"])).toBe(false);
});

it("partitions nested and parameterized tests without duplicating native or browser execution", () => {
  const spec = (title: string, tags: string[]) => ({
    title,
    tags,
    file: "fixture.spec.ts",
    tests: [{ projectName: "" }],
  });
  const report = {
    suites: [
      {
        title: "fixture.spec.ts",
        line: 0,
        specs: [spec("native", [])],
        suites: [
          {
            title: "nested",
            line: 4,
            specs: [spec("browser en", ["parallel-browser"]), spec("browser fr", ["parallel-browser"])],
          },
        ],
      },
    ],
  };
  expect(e2eLanes(report)).toEqual({
    browser: ["fixture.spec.ts › nested › browser en", "fixture.spec.ts › nested › browser fr"],
    serial: ["fixture.spec.ts › native"],
  });
});

it("reuses an exact build but rebuilds changed sources, flags and damaged outputs", async () => {
  const parent = await mkdtemp(join(tmpdir(), "vera-test-build-"));
  const root = join(parent, "05_Software");
  let count = 0;
  const source = join(root, "src/apps/desktop/src/main.ts");
  const output = join(root, "src/apps/desktop/out/main/index.js");
  const build = async () => {
    count++;
    for (const file of ["main/index.js", "preload/index.cjs", "renderer/index.html"]) {
      const path = join(root, "src/apps/desktop/out", file);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, `build${count}`);
    }
  };
  try {
    await mkdir(dirname(source), { recursive: true });
    await writeFile(source, "source");
    expect(await ensureDesktopTestBuild(root, { VERA_TEST: "1" }, build)).toBe("built");
    expect(await ensureDesktopTestBuild(root, { VERA_TEST: "1" }, build)).toBe("reused");
    await writeFile(source, "changed");
    expect(await ensureDesktopTestBuild(root, { VERA_TEST: "1" }, build)).toBe("built");
    expect(await ensureDesktopTestBuild(root, { VERA_TEST: "0" }, build)).toBe("built");
    await writeFile(output, "tampered");
    expect(await ensureDesktopTestBuild(root, { VERA_TEST: "0" }, build)).toBe("built");
    await rm(output);
    expect(await ensureDesktopTestBuild(root, { VERA_TEST: "0" }, build)).toBe("built");
    expect(count).toBe(5);
    await expect(
      ensureDesktopTestBuild(root, { VERA_TEST: "changed" }, async () => {
        await build();
        await writeFile(source, "edited while building");
      }),
    ).rejects.toThrow("Build inputs changed");
    expect(await readFile(output, "utf8")).toBe("build6");
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
