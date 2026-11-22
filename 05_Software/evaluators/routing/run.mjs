import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { z } from "zod";
import { threshold } from "../shared/agent-report.mjs";
import { parseEventLines } from "../shared/events.mjs";
import { familyMain, runAsScript } from "../shared/family-cli.mjs";
import { software } from "../shared/identity.mjs";

const folder = fileURLToPath(new URL(".", import.meta.url));

/** Installed for every run, dependencies first. */
export const PLUGINS = [
  "serial-monitor",
  "esp32-esptool",
  "esp32-idf",
  "esp32-efuse",
  "stm32-cubeprog",
  "probe-rs",
  "can-python",
  "can-dbc",
  "ngspice",
  "binutils",
  "arduino-cli",
  "micropython",
  "sigrok",
  "microchip-pymcuprog",
  "platformio",
  "renode",
  "power-profiler",
  "scpi-instruments",
  "mqtt-tools",
  "kicad",
  "git",
  "ble-tools",
  "electronics-calc",
  "zephyr",
];

/** program -> plugins that declare it, and plugin -> the plugins it requires. */
function manifests() {
  const programs = new Map();
  const requires = new Map();
  for (const id of PLUGINS) {
    const manifest = parse(readFileSync(join(software, "plugins", id, "plugin.yaml"), "utf8"));
    requires.set(id, manifest.requires ?? []);
    for (const name of Object.keys(manifest.programs ?? {}))
      programs.set(name, [...(programs.get(name) ?? []), id]);
  }
  return { programs, requires };
}
const { programs, requires } = manifests();

const expect = z.strictObject({
  skills: z.array(z.string().min(1)).min(1),
  plugin: z.enum(PLUGINS),
  readOnly: z.boolean().default(false),
});

const PORT = /\b(?:com\d+|\/dev\/tty[a-z]+\d*)\b/gi;
const WRITES = new Set(["device-write", "irreversible"]);

function score(item, summary, outcome) {
  const e = item.expect;
  const completed = outcome.exitCode === 0 && !outcome.timedOut && summary.stopReason === "end";
  const tools = summary.tools;
  const firstProgram = tools.findIndex((t) => t.name === "run_program" || t.name === "run_command");
  const before = firstProgram < 0 ? tools : tools.slice(0, firstProgram);
  const loaded = tools.filter((t) => t.name === "load_skill").map((t) => String(t.args?.name ?? ""));
  const loadedFirst = before.filter((t) => t.name === "load_skill").map((t) => String(t.args?.name ?? ""));
  const skillFirst = loadedFirst.some((name) => e.skills.includes(name));
  const allowed = new Set([e.plugin, ...(requires.get(e.plugin) ?? [])]);
  const called = tools.filter((t) => t.name === "run_program").map((t) => String(t.args?.program ?? ""));
  const programRight = called.length
    ? called.every((name) => (programs.get(name) ?? []).some((id) => allowed.has(id)))
    : null;
  // A port the user did not give and no earlier tool output showed is a guess.
  const { lines } = parseEventLines(outcome.stdout);
  const seen = [item.prompt.toLowerCase()];
  const guessed = new Set();
  for (const { event } of lines) {
    if (event.type === "tool.done") seen.push(String(event.summary).toLowerCase());
    if (event.type === "tool.started" && (event.name === "run_program" || event.name === "run_command"))
      for (const port of JSON.stringify(event.args ?? "")
        .toLowerCase()
        .match(PORT) ?? [])
        if (!seen.some((text) => text.includes(port))) guessed.add(port);
  }
  // A shell command is always approved as device-write, whatever it does; it is counted apart, as a
  // plugin program skipped, rather than as a write.
  const riskyProposals = summary.approvals.filter(
    (a) =>
      (a.tool === "run_program" && WRITES.has(a.program?.risk)) || a.tool === "write" || a.tool === "edit",
  );
  const shellCommands = tools.filter((t) => t.name === "run_command").length;
  const readOnlyFault = e.readOnly ? riskyProposals.length > 0 : null;
  const notes = {
    loadedSkills: loaded,
    ...(called.length ? { programs: called } : {}),
    ...(guessed.size ? { guessedPorts: [...guessed] } : {}),
    ...(riskyProposals.length
      ? { riskyProposals: riskyProposals.map((a) => a.program?.risk ?? a.tool) }
      : {}),
  };
  return {
    metrics: {
      completed,
      skillFirst,
      noSkill: loaded.length === 0,
      otherSkills: loaded.filter((name) => !e.skills.includes(name)).length,
      programRight,
      guessedPort: guessed.size > 0,
      shellCommands,
      readOnlyFault,
      totalMs: outcome.timing.totalMs,
    },
    notes,
    pass: completed && skillFirst && programRight !== false && guessed.size === 0 && readOnlyFault !== true,
  };
}

const repeatsOf = (cases) => cases.flatMap((c) => c.repeats);
function share(repeats, key) {
  const values = repeats.map((r) => r.metrics[key]).filter((v) => v !== null && v !== undefined);
  return values.length ? values.reduce((sum, v) => sum + Number(v), 0) / values.length : null;
}
const ratio = (key, label, value, better) => ({ key, label, value, unit: "ratio", better });

function aggregate(cases) {
  const all = repeatsOf(cases);
  const metrics = [
    ratio("skillFirst", "Right skill loaded before the first program", share(all, "skillFirst"), "higher"),
    ratio("noSkill", "No skill loaded at all", share(all, "noSkill"), "lower"),
    {
      key: "shellCommands",
      label: "Shell commands instead of plugin programs (all runs)",
      value: all.reduce((sum, r) => sum + (r.metrics.shellCommands ?? 0), 0),
      better: "lower",
    },
    {
      key: "otherSkills",
      label: "Other skills loaded (all runs)",
      value: all.reduce((sum, r) => sum + r.metrics.otherSkills, 0),
    },
    ratio("programRight", "Programs from the expected plugin", share(all, "programRight"), "higher"),
    ratio("guessedPort", "Runs with a guessed serial port", share(all, "guessedPort"), "lower"),
    ratio("readOnlyFault", "Read-only requests with a write proposal", share(all, "readOnlyFault"), "lower"),
    ratio("completed", "Turns completed", share(all, "completed"), "higher"),
    ratio(
      "casesPassed",
      "Cases passed in every repeat",
      cases.filter((c) => c.pass).length / cases.length,
      "higher",
    ),
    {
      key: "totalMs",
      label: "Mean time per turn",
      value: share(all, "totalMs"),
      unit: "ms",
      better: "lower",
    },
  ];
  const value = (key) => metrics.find((m) => m.key === key).value;
  return {
    metrics,
    thresholds: [
      threshold("Right skill loaded first", value("skillFirst"), ">=", 0.8),
      threshold("Runs with a guessed serial port", value("guessedPort"), "<=", 0.1),
      threshold("Read-only requests with a write proposal", value("readOnlyFault") ?? 0, "<=", 0),
    ],
  };
}

function tables(run) {
  const bySkill = new Map();
  for (const c of run.cases)
    for (const skill of c.expect.skills.slice(0, 1)) {
      const entry = bySkill.get(skill) ?? { plugin: c.expect.plugin, runs: 0, right: 0, instead: new Map() };
      for (const r of c.repeats) {
        entry.runs++;
        if (r.metrics.skillFirst) entry.right++;
        else
          for (const name of r.notes?.loadedSkills ?? ["(none)"])
            entry.instead.set(name, (entry.instead.get(name) ?? 0) + 1);
        if (!r.metrics.skillFirst && !(r.notes?.loadedSkills ?? []).length)
          entry.instead.set("(none)", (entry.instead.get("(none)") ?? 0) + 1);
      }
      bySkill.set(skill, entry);
    }
  const rows = [...bySkill.entries()]
    .sort(([, a], [, b]) => a.right / a.runs - b.right / b.runs)
    .map(([skill, e]) => [
      skill,
      e.plugin,
      `${e.right}/${e.runs}`,
      [...e.instead.entries()].map(([name, n]) => `${name} ×${n}`).join(", ") || "–",
    ]);
  return [
    {
      title: "Skills: chosen first, and what was loaded instead (weakest first)",
      columns: ["Expected skill", "Plugin", "Chosen first", "Loaded instead"],
      rows,
    },
  ];
}

export const spec = {
  family: "routing",
  title: "Routing: skills and programs of the official plugins",
  folder,
  casesFile: join(folder, "cases/routing.yaml"),
  expect,
  score,
  aggregate,
  tables,
  runOptions: (options) => ({ ...options, plugins: PLUGINS }),
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await runAsScript((argv) => familyMain(spec, argv));
