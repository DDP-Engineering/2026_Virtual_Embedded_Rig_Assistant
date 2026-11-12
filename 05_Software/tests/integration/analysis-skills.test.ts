import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { checkCatalogSource, createToolContext, NodeWorkerPool, PluginStore, SkillCatalog } from "@vera/core";
import { validatePluginManifest } from "@vera/shared";
import { build } from "esbuild";
import { expect, it } from "vitest";
import { parse } from "yaml";
import { faultRegistry, prepareCase } from "../../evaluators/eval-firmware-comparator-harness/harness.js";

const software = join(import.meta.dirname, "../..");
const source = join(software, "plugins/analysis-skills");
const sections = [
  "Scope and sources",
  "Comparability",
  "Observed differences",
  "Criterion",
  "Binary differences",
  "Interpretation",
  "Recommended checks",
];

// REQ-FUNC-c0300001; semantic compliance is separately measured with a real model.
it("installs the official skills-only source and loads the body and seven-section template", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "vera-cap03-assets-"));
  try {
    const raw = parse(await readFile(join(source, "plugin.yaml"), "utf8"));
    expect(raw.format).toBe(1);
    expect(raw).not.toHaveProperty("programs");
    expect(raw).not.toHaveProperty("rules");
    expect(validatePluginManifest(raw).issues).toEqual([]);
    const store = new PluginStore({ root: join(scratch, "plugins") });
    await store.install(source);
    const plugin = await store.load("analysis-skills");
    await mkdir(join(scratch, "bench"));
    const catalog = new SkillCatalog({
      root: join(scratch, "bench"),
      disabled: () => [],
      plugins: async () => [{ id: "analysis-skills", folder: plugin.folder }],
    });
    expect(await catalog.list()).toContainEqual(
      expect.objectContaining({ name: "firmware-comparator", source: "plugin", plugin: "analysis-skills" }),
    );
    const signal = new AbortController().signal;
    const body = await catalog.load("firmware-comparator", undefined, signal);
    expect(body).toMatchObject({ name: "firmware-comparator" });
    expect(JSON.stringify(body)).toContain("expectedSha256");
    const template = await catalog.load("firmware-comparator", "templates/comparison.md", signal);
    expect(template).toMatchObject({ name: "firmware-comparator", file: "templates/comparison.md" });
    const headings = String(template.text).match(/^## .+$/gm);
    expect(headings).toEqual(sections.map((section) => `## ${section}`));
    expect(await catalog.list()).toContainEqual(
      expect.objectContaining({ name: "test-planner", source: "plugin", plugin: "analysis-skills" }),
    );
    expect(await catalog.load("test-planner", undefined, signal)).toMatchObject({
      name: "test-planner",
      text: expect.stringContaining("observation-only"),
    });
    const plan = await catalog.load("test-planner", "templates/test-plan.md", signal);
    expect(String(plan.text).match(/^## .+$/gm)).toEqual(
      [
        "Target and objective",
        "Readiness",
        "Setup and prerequisites",
        "Test cases",
        "Stop conditions and exclusions",
        "Results to collect",
      ].map((section) => `## ${section}`),
    );
    for (const field of [
      "TP-01",
      "Rationale",
      "Setup",
      "Manual steps",
      "Capture",
      "Criterion",
      "Stop conditions",
      "Optional plugin step",
    ])
      expect(plan.text).toContain(field);
    expect(plan.text).toContain(
      "| Case | Run | Firmware | Log path | Measurement | Value | Unit | Met / not met | Source reference |",
    );
    expect(await checkCatalogSource(join(software, "plugins"))).toEqual([]);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

it("grounds partial scan and source-change rubric faults in actual worker parses", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "vera-cap03-faults-"));
  const bundle = await mkdtemp(join(software, "node_modules/.cache/cap03-faults-"));
  const workerPath = join(bundle, "grep-worker.mjs");
  await build({
    entryPoints: [join(software, "src/apps/cli/src/grep-worker.ts")],
    outfile: workerPath,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node24",
    packages: "external",
    alias: {
      "@vera/core/grep-worker": join(software, "src/libraries/core/src/tools/grep-worker.ts"),
      "@vera/shared": join(software, "src/libraries/shared/src/index.ts"),
    },
  });
  const workers = new NodeWorkerPool(pathToFileURL(workerPath));
  try {
    for (const id of ["incomplete-scan", "log-changed-between-calls"] as const) {
      const root = await prepareCase(software, join(scratch, id), id);
      const { registry, faults } = faultRegistry(id, root);
      const context = createToolContext(root, workers),
        signal = new AbortController().signal;
      const first = await registry.execute(
        context,
        "parse_log",
        { path: "./logs/boot-0413.log", profile: "iso", maxEvents: 200 },
        signal,
      );
      expect(first.isError).toBe(false);
      const value = JSON.parse(first.text);
      if (id === "incomplete-scan") {
        expect(value).toMatchObject({
          scan: { complete: false, stopReason: "timeout", lines: 2 },
          source: { sha256: null },
          counts: { info: 2, error: 0 },
        });
        expect(value.events).toHaveLength(2);
      } else {
        expect(value).toMatchObject({
          scan: { complete: true, lines: 264 },
          preview: { truncated: true },
          counts: { error: 1 },
        });
        expect(value.events.length).toBeLessThanOrEqual(200);
        const changed = await registry.execute(
          context,
          "parse_log",
          { path: "logs/boot-0413.log", profile: "iso", fromLine: 201, expectedSha256: value.source.sha256 },
          signal,
        );
        expect(changed.isError).toBe(true);
        expect(JSON.parse(changed.text)).toMatchObject({ code: "CONFLICT", reason: "source_changed" });
      }
      expect(faults).toHaveLength(1);
    }
  } finally {
    await workers.dispose();
    await rm(scratch, { recursive: true, force: true });
    await rm(bundle, { recursive: true, force: true });
  }
}, 30000);
