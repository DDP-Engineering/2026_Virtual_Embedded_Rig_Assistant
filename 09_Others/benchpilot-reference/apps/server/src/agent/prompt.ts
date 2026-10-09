// System prompt (04 §2) — order matters: role, rules, TESTBENCH.md, skills (frontmatter only), catalog, context.
import type { Skill, TestbenchConfig, TestDefinition } from "@benchpilot/shared";

export interface PromptInput {
  testbench: TestbenchConfig;
  /** TESTBENCH.md verbatim (pinned doc). */
  testbenchMd: string;
  skills: Skill[];
  tests: TestDefinition[];
  /** Data-clock "today" (YYYY-MM-DD). */
  today: string;
  latestReportId: string | null;
}

export function buildPrompt(p: PromptInput): string {
  const skills = p.skills.filter((s) => p.testbench.enabled_skills.includes(s.name));
  const tests = p.tests.filter((t) => p.testbench.enabled_tests.includes(t.id));
  return [
    `You are BenchPilot, a test-engineering copilot for network devices on testbench ${p.testbench.id}.`,
    "",
    "Rules:",
    "- Verdicts come from catalog checks and are final. Explain them; never override them.",
    "- Cite evidence for factual claims as [[ev:…]] using refs from tool results only.",
    "- Running tests: propose_test_plan first; run_test_plan only after approval.",
    "- Load the relevant skill (load_skill) before work it covers.",
    "- Prefer few, targeted tool calls; use display filters and time windows.",
    "- Answer in the user's language. Be concise; use tables for results.",
    "",
    "<testbench>",
    p.testbenchMd.trim(),
    "</testbench>",
    "",
    "<skills>",
    ...skills.map((s) => `- ${s.name}: ${s.description}`),
    "</skills>",
    "",
    "<catalog>",
    ...tests.map((t) => `${t.id} v${t.version} — ${t.name} [${t.area.join(", ")}]`),
    "</catalog>",
    "",
    "Context:",
    `- Device: ${p.testbench.device.model}; firmware available: ${p.testbench.device.firmware.join(", ")}.`,
    `- Today (data clock): ${p.today}. Run times are data-clock UTC.`,
    `- Latest report in this session: ${p.latestReportId ?? "none yet"}.`,
  ].join("\n");
}
