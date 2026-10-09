// Loads a testbench folder (03 §1): testbench.yaml, docs/** (markdown + topology.yaml).
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { TestbenchConfig, Topology } from "@benchpilot/shared";
import { testbenchConfigSchema, topologySchema } from "@benchpilot/shared/content";
import { readYaml, validate } from "../content.ts";

export interface LoadedDoc {
  /** Relative to the testbench folder, forward slashes: `docs/lab-notes.md`. */
  path: string;
  title: string;
  content: string;
  pinned: boolean;
}

export interface LoadedTestbench {
  dir: string;
  config: TestbenchConfig;
  topology: Topology;
  docs: LoadedDoc[];
}

export const PINNED_DOC = "docs/TESTBENCH.md";
export const TOPOLOGY_DOC = "docs/topology.yaml";

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]))
    .sort();
}

/** First `# heading` of a markdown doc, else the file name. */
export function docTitle(relPath: string, content: string): string {
  if (relPath.endsWith(".md")) {
    const h = /^#\s+(.+)$/m.exec(content);
    if (h) return h[1]!.trim();
  }
  return path.posix.basename(relPath);
}

export function loadTestbench(dir: string): LoadedTestbench {
  const config = validate(testbenchConfigSchema, readYaml(path.join(dir, "testbench.yaml")), path.join(dir, "testbench.yaml"));
  const topoFile = path.join(dir, TOPOLOGY_DOC);
  const topology = validate(topologySchema, readYaml(topoFile), topoFile);
  const docs = walk(path.join(dir, "docs"))
    .filter((f) => /\.(md|ya?ml)$/i.test(f))
    .map((f) => {
      const rel = path.relative(dir, f).split(path.sep).join("/");
      const content = readFileSync(f, "utf8").replace(/\r\n/g, "\n");
      return { path: rel, title: docTitle(rel, content), content, pinned: rel === PINNED_DOC };
    });
  return { dir, config, topology, docs };
}

/** Every `testbenches/<dir>/testbench.yaml` under the content root. */
export function loadTestbenches(contentDir: string): LoadedTestbench[] {
  const root = path.join(contentDir, "testbenches");
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => loadTestbench(path.join(root, e.name)));
}
