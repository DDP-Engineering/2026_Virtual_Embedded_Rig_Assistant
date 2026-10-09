// The 19 agent tools of 04 §3, by exact name. P3's registry implements them; content (testbench.yaml
// `enabled_tools`, SKILL.md bodies) is validated against this list.
export const TOOL_NAMES = [
  "load_skill",
  "search_testbench_docs",
  "read_testbench_doc",
  "list_tests",
  "get_test_definition",
  "propose_test_plan",
  "run_test_plan",
  "list_reports",
  "get_report",
  "get_test_history",
  "search_logs",
  "get_log_context",
  "query_packets",
  "get_metrics",
  "get_timeline",
  "compare_runs",
  "compare_traffic_profiles",
  "save_report_analysis",
  "draft_ticket",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];
