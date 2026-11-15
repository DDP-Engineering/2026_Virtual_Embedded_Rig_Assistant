import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkCatalogSource, PluginStore, SkillCatalog } from "@vera/core";
import { validatePluginManifest } from "@vera/shared";
import { expect, it } from "vitest";
import { parse } from "yaml";

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
