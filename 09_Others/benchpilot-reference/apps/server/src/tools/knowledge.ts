// skills + knowledge + catalog tools (04 §3): load_skill, search_testbench_docs, read_testbench_doc, list_tests,
// get_test_definition. Documents are read from the DB (indexed testbench docs), never from the file system.
import { formatEvidenceRef, headingSlug, markdownSection } from "@benchpilot/shared";
import { z } from "zod";
import type { Db } from "../db/index.ts";
import { getDoc, searchDocs } from "../db/repos/testbenches.ts";
import { flips, lastVerdicts, testHistory } from "../queries.ts";
import { defineTool, type ToolContext } from "./registry.ts";

const DOC_CAP = 8_000;

const docRef = (tb: string, path: string, anchor: string | null) => formatEvidenceRef({ kind: "doc", ref: "", testbenchId: tb, path, anchor });

/** Nearest heading at or before `index` in a markdown text (the line holding `index` included). */
function headingBefore(content: string, index: number): string | null {
  const eol = content.indexOf("\n", index);
  const lines = content.slice(0, eol === -1 ? undefined : eol).split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = /^#{1,6}\s+(.+)$/.exec(lines[i]!);
    if (m) return m[1]!.trim();
  }
  return null;
}

function docPaths(db: Db, tb: string): string[] {
  return (db.prepare("SELECT path FROM docs WHERE testbench_id = ? ORDER BY path").all(tb) as { path: string }[]).map((r) => r.path);
}

export const loadSkill = defineTool({
  name: "load_skill",
  group: "skills",
  label: "Load a skill's full instructions.",
  description: "Load the full instructions (SKILL.md body) of one of the skills listed in <skills>. Load the relevant skill before work it covers.",
  requiresApproval: false,
  schema: z.object({ name: z.string().describe("Skill name, e.g. failure-analyzer") }),
  async run({ name }, ctx: ToolContext) {
    if (!ctx.testbench.enabled_skills.includes(name))
      return { error: `Skill ${name} is not enabled on ${ctx.testbench.id}. Enabled: ${ctx.testbench.enabled_skills.join(", ")}.` };
    const skill = ctx.skills.find((s) => s.name === name);
    if (!skill) return { error: `Skill ${name} not found.` };
    ctx.emit({ type: "skill.loaded", name });
    return `# Skill: ${skill.name}\n\n${skill.body}`;
  },
  summarize: () => "loaded",
});

export const searchTestbenchDocs = defineTool({
  name: "search_testbench_docs",
  group: "knowledge",
  label: "Full-text search over testbench documents.",
  description:
    "Full-text search (bm25) over this testbench's documents: TESTBENCH.md, release notes per firmware, device and lab-equipment notes, lab notes, test policy. Returns snippets with a doc evidence ref.",
  requiresApproval: false,
  schema: z.object({ query: z.string().min(1).max(200), limit: z.number().int().min(1).max(20).default(5) }),
  async run({ query, limit }, ctx: ToolContext) {
    const hits = searchDocs(ctx.db, ctx.testbench.id, query, limit);
    return hits.map((h) => {
      const content = getDoc(ctx.db, ctx.testbench.id, h.path)?.content ?? "";
      const marked = /\[([^\]]+)\]/.exec(h.snippet)?.[1] ?? "";
      const at = marked ? content.toLowerCase().indexOf(marked.toLowerCase()) : -1;
      // Only markdown has headings (a `#` in YAML is a comment).
      const heading = at >= 0 && h.path.endsWith(".md") ? headingBefore(content, at) : null;
      const anchor = heading && markdownSection(content, headingSlug(heading)) ? headingSlug(heading) : null;
      return { path: h.path, title: h.title, heading, snippet: h.snippet, ev: docRef(ctx.testbench.id, h.path, anchor) };
    });
  },
  summarize: (r: unknown[]) => `${r.length} result${r.length === 1 ? "" : "s"}`,
});

export const readTestbenchDoc = defineTool({
  name: "read_testbench_doc",
  group: "knowledge",
  label: "Read a document or one of its sections.",
  description: `Read one testbench document (path as returned by search, e.g. docs/firmware/2.1.0.md), optionally only the section under a heading. Max ${DOC_CAP} chars.`,
  requiresApproval: false,
  schema: z.object({ path: z.string().min(1).max(200), heading: z.string().max(200).optional() }),
  async run({ path, heading }, ctx: ToolContext) {
    const doc = getDoc(ctx.db, ctx.testbench.id, path);
    if (!doc) return { error: `No document ${path} on ${ctx.testbench.id}. Documents: ${docPaths(ctx.db, ctx.testbench.id).join(", ")}.` };
    let markdown = doc.content;
    let anchor: string | null = null;
    if (heading) {
      const slug = markdownSection(doc.content, heading) ? heading : headingSlug(heading);
      const section = markdownSection(doc.content, slug);
      if (!section) return { error: `No heading "${heading}" in ${path}.` };
      anchor = slug;
      markdown = `## ${section.heading}\n\n${section.body}`;
    }
    const truncated = markdown.length > DOC_CAP;
    return { path, title: doc.title, ev: docRef(ctx.testbench.id, path, anchor), markdown: truncated ? markdown.slice(0, DOC_CAP) : markdown, ...(truncated ? { truncated: true } : {}) };
  },
  summarize: (r: { title: string }) => r.title,
});

export const listTests = defineTool({
  name: "list_tests",
  group: "catalog",
  label: "List catalog tests with recent verdicts.",
  description: "List the catalog tests enabled on this testbench, optionally filtered by area (dhcp, ipv6, performance, stability, dns …), with the last 8 verdicts (oldest first).",
  requiresApproval: false,
  schema: z.object({ area: z.string().max(40).optional() }),
  async run({ area }, ctx: ToolContext) {
    return ctx.testbench.enabled_tests
      .map((id) => ctx.catalog.get(id))
      .filter((t) => t && (!area || t.area.some((a) => a.toLowerCase() === area.toLowerCase())))
      .map((t) => {
        const h = testHistory(ctx.db, t!.id);
        const last = lastVerdicts(h);
        return {
          id: t!.id,
          name: t!.name,
          version: t!.version,
          area: t!.area,
          owner: t!.owner,
          duration: t!.duration,
          last_verdicts: last.verdicts,
          last_verdicts_fw: last.fw,
          flips_last_8: flips(h),
        };
      });
  },
  summarize: (r: unknown[]) => `${r.length} test${r.length === 1 ? "" : "s"}`,
});

export const getTestDefinition = defineTool({
  name: "get_test_definition",
  group: "catalog",
  label: "Procedure and machine checks of a test.",
  description: "Full definition of a catalog test: description, procedure, inputs, durations and the machine-evaluated checks with thresholds.",
  requiresApproval: false,
  schema: z.object({ test_id: z.string().max(40) }),
  async run({ test_id }, ctx: ToolContext) {
    const t = ctx.catalog.get(test_id);
    if (!t || !ctx.testbench.enabled_tests.includes(test_id)) return { error: `Test ${test_id} is not enabled on ${ctx.testbench.id}.` };
    return t;
  },
  summarize: (r: { id: string; version: number }) => `${r.id} v${r.version}`,
});
