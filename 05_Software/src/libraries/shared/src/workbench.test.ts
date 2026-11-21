import { expect, it } from "vitest";
import {
  defaultRightPanelTabs,
  mergeWorkbench,
  rightPanelTabIds,
  workbenchSchema as schema,
  configWarnings as warnings,
  workbenchPatchSchema,
} from "./workbench.js";

it("defaults to every content tab, preserves presentation settings and validates tab identities", () => {
  const base = schema.parse({ format: 1, id: "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C", name: "Board" });
  // REQ-UX-effec625: Bookmarks is opt-in, after Plan, and not in the default set.
  expect(base.interface.right_panel_tabs).toEqual(defaultRightPanelTabs);
  expect(defaultRightPanelTabs).not.toContain("bookmarks");
  expect(rightPanelTabIds.indexOf("bookmarks")).toBe(rightPanelTabIds.indexOf("plan") + 1);
  for (const right_panel_tabs of [[], ["docs"], [...rightPanelTabIds]]) {
    const config = mergeWorkbench(base, workbenchPatchSchema.parse({ interface: { right_panel_tabs } }));
    expect(mergeWorkbench(config, { name: "Other", interface: {} }).interface.right_panel_tabs).toEqual(
      right_panel_tabs,
    );
    expect(config.agent).toEqual(base.agent);
    expect(config.tools).toEqual(base.tools);
    expect(warnings(config)).toEqual([]);
  }
  for (const right_panel_tabs of [["close"], ["Files"], ["terminal", "terminal"], null, "docs", [1]]) {
    expect(schema.safeParse({ ...base, interface: { right_panel_tabs } }).success).toBe(false);
    expect(workbenchPatchSchema.safeParse({ interface: { right_panel_tabs } }).success).toBe(false);
  }
  const extended = schema.parse({ ...base, interface: { extra: true } });
  expect(warnings(extended)).toContainEqual({ code: "UNKNOWN_KEY", path: "interface.extra" });
  expect(workbenchPatchSchema.safeParse({ interface: { extra: true } }).success).toBe(false);
});

// REQ-DATA-7521ac37
it("opts in to Git per workbench through the format-1 interface patch", () => {
  const seed = { format: 1, id: "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C", name: "Board" };
  const base = schema.parse(seed);
  expect(base.interface.git_status).toBe(false);
  const enabled = mergeWorkbench(base, workbenchPatchSchema.parse({ interface: { git_status: true } }));
  expect(schema.parse(enabled).interface.git_status).toBe(true);
  expect(mergeWorkbench(enabled, { interface: { right_panel_tabs: [] } }).interface.git_status).toBe(true);
  expect(schema.parse({ ...seed, name: "Another board" }).interface.git_status).toBe(false);
  expect(workbenchPatchSchema.safeParse({ interface: { git_status: "true" } }).success).toBe(false);
});

// REQ-DATA-4a830b9a
it("defaults chat detail to normal, merges independently and rejects invalid levels", () => {
  const base = schema.parse({ format: 1, id: "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C", name: "Board" });
  expect(base.chat).toEqual({ detail: "normal" });
  for (const detail of ["verbose", "normal", "minimal"] as const) {
    const config = mergeWorkbench(base, workbenchPatchSchema.parse({ chat: { detail } }));
    expect(config.chat).toEqual({ detail });
    expect(mergeWorkbench(config, { name: "Other" }).chat).toEqual({ detail });
    expect(warnings(config)).toEqual([]);
  }
  for (const detail of ["invalid", null, 1]) {
    expect(schema.safeParse({ ...base, chat: { detail } }).success).toBe(false);
    expect(workbenchPatchSchema.safeParse({ chat: { detail } }).success).toBe(false);
  }
  const extended = schema.parse({ ...base, chat: { detail: "normal", extra: true } });
  expect(warnings(extended)).toContainEqual({ code: "UNKNOWN_KEY", path: "chat.extra" });
  expect(workbenchPatchSchema.safeParse({ chat: { extra: true } }).success).toBe(false);
});

it("validates format1, defaults and retains nested extensions with warning paths", () => {
  const config = schema.parse({
    format: 1,
    id: "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C",
    name: "Board",
    vendor: { enabled: true },
    agent: { extension: 42 },
  });
  expect(config.docs).toEqual({ include: ["docs/**"], exclude: [], gitignore: true, maxFiles: 10000 });
  expect(config.agent).toEqual({ permission_mode: "ask", model: null, allowed_commands: [], extension: 42 });
  expect(config.vendor).toEqual({ enabled: true });
  expect(warnings(config)).toEqual([
    { code: "UNKNOWN_KEY", path: "vendor" },
    { code: "UNKNOWN_KEY", path: "agent.extension" },
  ]);
  for (const patch of [{ format: 2 }, { name: "" }, { id: "wb_bad" }, { agent: { permission_mode: "bad" } }])
    expect(schema.safeParse({ ...config, ...patch }).success).toBe(false);
});

it("validates both registered embedding models in format 1 and defaults to BGE", () => {
  const base = { format: 1, id: "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C", name: "Board" };
  expect(schema.parse(base).embeddings.model).toBe("Xenova/bge-small-en-v1.5");
  for (const model of ["Xenova/bge-small-en-v1.5", "Xenova/multilingual-e5-small"]) {
    expect(schema.parse({ ...base, embeddings: { model } }).embeddings.model).toBe(model);
    expect(workbenchPatchSchema.parse({ embeddings: { model } }).embeddings?.model).toBe(model);
  }
});

// REQ-DATA-4992f40c
it("holds bounded retrieval defaults that patches merge and validation rejects out of range", () => {
  const base = schema.parse({ format: 1, id: "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C", name: "Board" });
  expect(base.retrieval).toEqual({ results: 8, mode: "hybrid" });
  const merged = mergeWorkbench(base, { retrieval: { results: 12, mode: "keyword" } });
  expect(merged.retrieval).toEqual({ results: 12, mode: "keyword" });
  for (const retrieval of [
    { results: 0, mode: "hybrid" },
    { results: 21, mode: "hybrid" },
    { results: 8, mode: "fuzzy" },
  ])
    expect(workbenchPatchSchema.safeParse({ retrieval }).success).toBe(false);
  expect(schema.safeParse({ ...base, retrieval: { results: 1.5, mode: "hybrid" } }).success).toBe(false);
  const extended = schema.parse({ ...base, retrieval: { results: 4, mode: "semantic", rerank: true } });
  expect(warnings(extended)).toContainEqual({ code: "UNKNOWN_KEY", path: "retrieval.rerank" });
});

// REQ-FUNC-41f5c03b
it("defaults plugins.enabled to empty and merges a plugins patch like the other sections", () => {
  const base = schema.parse({ format: 1, id: "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C", name: "Board" });
  expect(base.plugins).toEqual({ enabled: [] });
  const merged = mergeWorkbench(base, { plugins: { enabled: ["esp32-esptool"] } });
  expect(merged.plugins).toEqual({ enabled: ["esp32-esptool"] });
  expect(mergeWorkbench(merged, { name: "Renamed" }).plugins).toEqual({ enabled: ["esp32-esptool"] });
  expect(workbenchPatchSchema.safeParse({ plugins: { enabled: [""] } }).success).toBe(false);
  expect(workbenchPatchSchema.safeParse({ plugins: { other: [] } }).success).toBe(false);
});

// REQ-FUNC-0c4bc419
it("warns about enabled plugins that are not installed and unknown plugins keys", () => {
  const config = schema.parse({
    format: 1,
    id: "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C",
    name: "Board",
    plugins: { enabled: ["esp32-esptool", "ghost"], other: true },
  });
  expect(warnings(config, { skills: [], tools: [], plugins: ["esp32-esptool"] })).toEqual([
    { code: "UNKNOWN_KEY", path: "plugins.other" },
    { code: "UNKNOWN_NAME", path: "plugins.enabled.ghost" },
  ]);
});

// REQ-UX-adae0c2f
it("turns docs.gitignore on by default and lets a patch turn it off", () => {
  const config = schema.parse({ format: 1, id: "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C", name: "Board" });
  expect(config.docs.gitignore).toBe(true);
  const off = mergeWorkbench(config, { docs: { gitignore: false } });
  expect(off.docs).toEqual({ include: ["docs/**"], exclude: [], gitignore: false, maxFiles: 10000 });
  expect(warnings(off)).toEqual([]);
  expect(workbenchPatchSchema.safeParse({ docs: { gitignore: "yes" } }).success).toBe(false);
});

// REQ-DATA-9fd427f1
it("holds an optional file size limit and a file count that defaults to 10,000", () => {
  const config = schema.parse({ format: 1, id: "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C", name: "Board" });
  expect(config.docs.maxFiles).toBe(10000);
  expect(config.docs).not.toHaveProperty("maxFileMB");
  for (const maxFileMB of [25, 0.5, 500]) {
    const parsed = schema.parse({ ...config, docs: { ...config.docs, maxFileMB, maxFiles: 500 } });
    expect(parsed.docs).toMatchObject({ maxFileMB, maxFiles: 500 });
  }
  const limited = mergeWorkbench(config, { docs: { maxFileMB: 25, maxFiles: 500 } });
  expect(limited.docs).toMatchObject({ maxFileMB: 25, maxFiles: 500 });
  expect(limited.format).toBe(1);
  expect(warnings(limited)).toEqual([]);
  const cleared = mergeWorkbench(limited, { docs: { maxFileMB: null } });
  expect(cleared.docs).not.toHaveProperty("maxFileMB");
  expect(cleared.docs.maxFiles).toBe(500);
});

// REQ-DATA-3bae7e69
it("rejects a zero, negative or non-numeric file size limit and a file count that is no positive integer", () => {
  const config = schema.parse({ format: 1, id: "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C", name: "Board" });
  for (const maxFileMB of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, "25"]) {
    expect(schema.safeParse({ ...config, docs: { ...config.docs, maxFileMB } }).success).toBe(false);
    expect(workbenchPatchSchema.safeParse({ docs: { maxFileMB } }).success).toBe(false);
  }
  for (const maxFiles of [0, -1, 2.5, "10", Number.NaN]) {
    expect(schema.safeParse({ ...config, docs: { ...config.docs, maxFiles } }).success).toBe(false);
    expect(workbenchPatchSchema.safeParse({ docs: { maxFiles } }).success).toBe(false);
  }
  expect(
    schema.safeParse({ ...config, docs: { ...config.docs, maxFileMB: 0.001, maxFiles: 1 } }).success,
  ).toBe(true);
});

// REQ-DATA-f0170301
it("validates bounded absolute additional folders in format1", () => {
  const base = { format: 1, id: "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C", name: "Folders" };
  expect(schema.parse(base).additional_folders).toEqual([]);
  for (const path of ["/home/user/repo", "D:/Projects/repo", "D:\\Projects\\repo", "//server/share/repo"])
    expect(workbenchPatchSchema.safeParse({ additional_folders: [path] }).success).toBe(true);
  for (const path of [
    "relative",
    "../repo",
    "C:repo",
    "\\repo",
    "//?/C:/repo",
    "/repo/../other",
    "/repo/aux.txt",
    "/repo/trailing.",
    "/repo/stream:x",
    "/repo/a\nb",
  ])
    expect(schema.safeParse({ ...base, additional_folders: [path] }).success, path).toBe(false);
  expect(workbenchPatchSchema.safeParse({ additional_folders: ["/repo", "/repo"] }).success).toBe(false);
  expect(
    workbenchPatchSchema.safeParse({ additional_folders: Array.from({ length: 65 }, (_, i) => `/repo${i}`) })
      .success,
  ).toBe(false);
});
