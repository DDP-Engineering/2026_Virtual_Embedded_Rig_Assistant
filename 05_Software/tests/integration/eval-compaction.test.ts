import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, expect, inject, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));
const load = (path: string) => import(pathToFileURL(join(root, path)).href);
const dirs: string[] = [];
afterAll(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true, maxRetries: 5 });
});

it("replays a session's history and measures the last turn in the same session", async () => {
  const { spec } = await load("evaluators/compaction/run.mjs");
  const { runAgentFamily } = await load("evaluators/shared/agent-runner.mjs");
  const out = await mkdtemp(join(tmpdir(), "vera-eval-compaction-"));
  dirs.push(out);
  const { run } = await runAgentFamily(spec, {
    provider: "replay",
    repeats: 1,
    approve: "none",
    caseIds: ["local-32k"],
    output: join(out, "run", "run.json"),
    cli: join(inject("cliBundle"), "index.js"),
    scratch: join(out, "scratch"),
  });
  const repeat = run.cases[0].repeats[0];
  for (let turn = 1; turn <= 6; turn++)
    expect(existsSync(join(out, "run", "events", `local-32k.1.history-${turn}.jsonl`)), String(turn)).toBe(
      true,
    );
  // The measured turn continued the replayed session: its history was over the threshold.
  expect(repeat.notes.compactionStatuses).toContain("running");
  expect(repeat.metrics).toMatchObject({ completed: true, decisionsRetained: 1, instructionFollowed: false });
}, 240_000);
