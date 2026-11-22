import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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

it("runs the smoke family end to end on replay and renders its report", async () => {
  const { spec } = await load("evaluators/smoke/run.mjs");
  const { runAgentFamily } = await load("evaluators/shared/agent-runner.mjs");
  const { writeReport } = await load("evaluators/shared/family-cli.mjs");
  const { agentReportModel } = await load("evaluators/shared/agent-report.mjs");
  const out = await mkdtemp(join(tmpdir(), "vera-eval-smoke-"));
  dirs.push(out);
  const output = join(out, "run", "run.json");
  const { run, report } = await runAgentFamily(spec, {
    provider: "replay",
    repeats: 1,
    approve: "none",
    output,
    cli: join(inject("cliBundle"), "index.js"),
    scratch: join(out, "scratch"),
  });
  expect(run.status).toBe("passed");
  expect(run.cases.map((c: { id: string; pass: boolean }) => [c.id, c.pass])).toEqual([
    ["board-voltage", true],
    ["sensor-address", true],
  ]);
  for (const c of run.cases)
    for (const r of c.repeats) expect(existsSync(join(out, "run", r.eventsPath)), r.eventsPath).toBe(true);
  const page = await readFile(report, "utf8");
  expect(page).toContain("Evaluation smoke");
  expect(page).not.toMatch(/(?:href|src)="(?:[a-z][a-z0-9+.-]*:|\/\/)/i);
  // A second report of the same run, compared with itself: compatible, every metric unchanged.
  const again = await writeReport(
    { input: output, reference: output, output: join(out, "again.html") },
    (data: unknown, path: string) => agentReportModel(data, spec, path),
  );
  expect(await readFile(again, "utf8")).not.toContain("Incompatible runs");
  await expect(
    runAgentFamily(spec, { provider: "replay", repeats: 1, approve: "none", output }),
  ).rejects.toThrow(/already exists/);
}, 180_000);
