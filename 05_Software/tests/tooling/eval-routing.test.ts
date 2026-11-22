import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));
// Node ESM evaluator modules; their behavior is what these tests check.
const load = (path: string) => import(pathToFileURL(join(root, path)).href);
const routing = await load("evaluators/routing/run.mjs");
const { loadCases } = await load("evaluators/shared/cases.mjs");

const line = (event: object) => JSON.stringify({ sessionId: "s", event });
const outcome = (events: object[]) => ({
  exitCode: 0,
  timedOut: false,
  stdout: events.map(line).join("\n"),
  timing: { totalMs: 1000 },
});
type Tool = { name: string; args: object; ok: boolean };
const summary = (tools: Tool[], approvals: object[] = []) => ({
  tools,
  approvals,
  answer: "",
  citations: [],
  usage: { input: 0, output: 0 },
  stopReason: "end",
  errors: [],
});
const flash = {
  name: "run_program",
  args: { program: "esptool", args: ["--port", "COM9", "write-flash"] },
  ok: false,
};
const skill = (name: string) => ({ name: "load_skill", args: { name }, ok: true });

it("passes the right skill first, the expected plugin's program and a port the user gave", () => {
  const item = {
    prompt: "Flash it on COM9.",
    expect: { skills: ["esp32-flash"], plugin: "esp32-esptool", readOnly: false },
  };
  const result = routing.spec.score(
    item,
    summary([skill("esp32-flash"), flash]),
    outcome([{ type: "tool.started", callId: "1", name: "run_program", args: flash.args }]),
  );
  expect(result.metrics).toMatchObject({ skillFirst: true, programRight: true, guessedPort: false });
  expect(result.pass).toBe(true);
});

it("flags a guessed port, a skill loaded too late and another plugin's program", () => {
  const item = {
    prompt: "Flash my ESP32.",
    expect: { skills: ["esp32-flash"], plugin: "esp32-esptool", readOnly: false },
  };
  const other = { name: "run_program", args: { program: "stm32_programmer_cli", args: [] }, ok: false };
  const result = routing.spec.score(
    item,
    summary([flash, skill("esp32-flash"), other]),
    outcome([
      { type: "tool.started", callId: "1", name: "run_program", args: flash.args },
      { type: "tool.done", callId: "1", ok: false, summary: "Program esptool is not available" },
    ]),
  );
  expect(result.metrics).toMatchObject({ skillFirst: false, programRight: false, guessedPort: true });
  expect(result.notes.guessedPorts).toEqual(["com9"]);
  expect(result.pass).toBe(false);
});

it("treats a write proposal on a read-only request as a fault", () => {
  const item = {
    prompt: "Read the chip id on COM7.",
    expect: { skills: ["esp32-identify"], plugin: "esp32-esptool", readOnly: true },
  };
  const result = routing.spec.score(
    item,
    summary([skill("esp32-identify")], [{ tool: "run_program", program: { risk: "device-write" } }]),
    outcome([]),
  );
  expect(result.metrics.readOnlyFault).toBe(true);
  expect(result.pass).toBe(false);
});

it("has at least 30 valid cases whose plugin groups are installed and contain the expected plugin", async () => {
  const file = await loadCases(routing.spec.casesFile, routing.spec.expect);
  expect(file.cases.length).toBeGreaterThanOrEqual(30);
  for (const c of file.cases) {
    expect(
      c.plugins.every((id: string) => routing.PLUGINS.includes(id)),
      c.id,
    ).toBe(true);
    expect(c.plugins, c.id).toContain(c.expect.plugin);
  }
});
