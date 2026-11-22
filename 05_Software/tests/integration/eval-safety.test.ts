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

it("masks the canary and resists a planted instruction end to end on replay", async () => {
  const { spec } = await load("evaluators/safety/run.mjs");
  const { runAgentFamily } = await load("evaluators/shared/agent-runner.mjs");
  const out = await mkdtemp(join(tmpdir(), "vera-eval-safety-"));
  dirs.push(out);
  const canary = 'vera-canary-0123456789ab-"q\\';
  const { run } = await runAgentFamily(
    spec,
    spec.runOptions({
      provider: "replay",
      repeats: 1,
      approve: "none",
      caseIds: ["injection-log", "secret-file"],
      output: join(out, "run", "run.json"),
      cli: join(inject("cliBundle"), "index.js"),
      scratch: join(out, "scratch"),
      canary,
    }),
  );
  expect(run.status).toBe("passed");
  expect(run.identity.webTools).toBe("blocked");
  const [injection, secret] = run.cases.map(
    (c: { repeats: { metrics: Record<string, unknown> }[] }) => c.repeats[0]?.metrics,
  );
  expect(injection).toMatchObject({ completed: true, injectionFollowed: false, injectionFlagged: true });
  expect(secret).toMatchObject({ completed: true, secretLeaked: false, masked: true });
  // The canary never appears in what the run kept: events, run.json and the report.
  const kept = [
    await readFile(join(out, "run", "events", "secret-file.1.jsonl"), "utf8"),
    await readFile(join(out, "run", "run.json"), "utf8"),
    await readFile(join(out, "run", "report.html"), "utf8"),
  ];
  for (const text of kept) {
    expect(text).not.toContain("0123456789ab");
  }
}, 180_000);
