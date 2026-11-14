import { describe, expect, it } from "vitest";
import { hilPlanProblems, hilPlanSchema } from "./hil-plan.js";
import { validatePluginManifest } from "./plugins.js";

const sha = "a".repeat(64);
export const minimalPlan = (fields: Record<string, unknown> = {}) => ({
  format: 1,
  id: "blinky-smoke",
  title: "Blinky smoke test",
  setup: {
    board: "NUCLEO-F401RE",
    revision: "C-03",
    description: "ST-LINK on USB, VCP on COM5",
    wiring: ["scope CH1 -> PA5"],
    firmwareEffect: "device-read",
    effectNote: "Toggles LD2 only.",
  },
  firmware: { path: "build/app.elf", sha256: sha, format: "elf" },
  budget: { seconds: 60 },
  steps: [{ id: "ping", use: "serial.send", with: { port: "COM5" } }],
  ...fields,
});

describe("HIL plan format 1", () => {
  it("accepts a plan with setup, firmware, budget, steps and cleanup", () => {
    const plan = hilPlanSchema.parse(
      minimalPlan({
        steps: [
          { id: "flash", phase: "setup", use: "probe-rs.flash", with: { probe: "0483:374b" } },
          { id: "log", use: "serial.capture", background: true, timeout: 20 },
          { id: "boot", use: "await", with: { step: "log" } },
          { id: "ping", use: "serial.send", retries: 2, repeat: 3, expect: "^pong$" },
          { id: "later", use: "scpi.read", skip: "no meter today" },
        ],
        cleanup: [{ id: "halt", use: "probe-rs.reset", timeout: 10 }],
      }),
    );
    expect(plan.steps).toHaveLength(5);
    expect(plan.cleanup?.[0]?.id).toBe("halt");
    expect(hilPlanProblems(minimalPlan())).toEqual([]);
  });

  it("names the path of every refusal", () => {
    const cases: [unknown, string][] = [
      [minimalPlan({ extra: 1 }), "extra"],
      [minimalPlan({ format: 2 }), "format"],
      [minimalPlan({ id: "Bad_Id" }), "id"],
      [minimalPlan({ budget: { seconds: 0 } }), "budget.seconds"],
      [minimalPlan({ budget: { seconds: 3601 } }), "budget.seconds"],
      [minimalPlan({ firmware: { path: "a.bin", sha256: sha, format: "bin" } }), "firmware.address"],
      [
        minimalPlan({ firmware: { path: "a.elf", sha256: sha, format: "elf", address: "0x0" } }),
        "firmware.address",
      ],
      [minimalPlan({ firmware: { path: "a.elf", sha256: "x", format: "elf" } }), "firmware.sha256"],
      [minimalPlan({ steps: [] }), "steps"],
      [minimalPlan({ steps: [{ id: "a", use: "serial.send", phase: "setup" }] }), "steps"],
      [minimalPlan({ steps: [{ id: "a", use: "serial.send", retries: 6 }] }), "steps.0.retries"],
      [minimalPlan({ steps: [{ id: "a", use: "serial.send", repeat: 101 }] }), "steps.0.repeat"],
      [minimalPlan({ steps: [{ id: "a", use: "serial.send", timeout: -1 }] }), "steps.0.timeout"],
      [minimalPlan({ steps: [{ id: "a", use: "serial.send", shell: "rm -rf /" }] }), "steps.0.shell"],
      [minimalPlan({ steps: [{ id: "a", use: "serial.send", background: false }] }), "steps.0.background"],
      [
        minimalPlan({
          steps: [
            { id: "a", use: "serial.send" },
            { id: "a", use: "serial.send" },
          ],
        }),
        "steps.1.id",
      ],
      [minimalPlan({ cleanup: [{ id: "ping", use: "scpi.close" }] }), "cleanup.0.id"],
      [minimalPlan({ cleanup: [{ id: "c", use: "scpi.close", retries: 1 }] }), "cleanup.0.retries"],
      [minimalPlan({ steps: [{ id: "a", use: "serial.send", repeat: 100, retries: 5 }] }), "steps"],
      [minimalPlan({ title: "bad\u0007bell" }), "title"],
    ];
    for (const [plan, path] of cases) {
      const problems = hilPlanProblems(plan);
      expect(problems.length, JSON.stringify(plan)).toBeGreaterThan(0);
      expect(problems.map((problem) => problem.path)).toContain(path);
    }
  });
});

describe("manifest program field plan", () => {
  const manifest = (program: Record<string, unknown>) => ({
    format: 1,
    id: "hil-testing",
    version: "1.0.0",
    name: "HIL",
    description: "Runs HIL plans.",
    ecosystem: "lab",
    platforms: ["windows-x64"],
    programs: {
      hil: {
        install: { script: "scripts/hil_tool.py" },
        version: { args: ["--version"], match: "(\\d+)" },
        ...program,
      },
    },
  });
  it("accepts plan: hil and refuses any other kind", () => {
    expect(validatePluginManifest(manifest({ plan: "hil" })).issues).toEqual([]);
    expect(validatePluginManifest(manifest({ plan: "robot" })).issues).not.toEqual([]);
  });
});
