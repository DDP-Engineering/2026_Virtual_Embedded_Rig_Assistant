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

it("scores an answerable and an unanswerable grounding case end to end on replay", async () => {
  const { spec } = await load("evaluators/grounding/run.mjs");
  const { runAgentFamily } = await load("evaluators/shared/agent-runner.mjs");
  const out = await mkdtemp(join(tmpdir(), "vera-eval-grounding-"));
  dirs.push(out);
  const { run, report } = await runAgentFamily(spec, {
    provider: "replay",
    repeats: 1,
    approve: "none",
    caseIds: ["sensor-address-en", "spi-clock-en"],
    output: join(out, "run", "run.json"),
    cli: join(inject("cliBundle"), "index.js"),
    scratch: join(out, "scratch"),
  });
  const [answer, unknown] = run.cases.map(
    (c: { repeats: { metrics: Record<string, unknown> }[] }) => c.repeats[0]?.metrics,
  );
  expect(answer).toMatchObject({
    completed: true,
    factCorrect: true,
    onTarget: true,
    grounded: true,
    searchFirst: true,
  });
  expect(unknown).toMatchObject({ completed: true, abstained: true, fabricated: false });
  expect(run.identity.webTools).toBe("off");
  const page = await readFile(report, "utf8");
  expect(page).toContain("Accuracy and citation");
  expect(page).toContain("Values the model stated without having seen them");
}, 180_000);
