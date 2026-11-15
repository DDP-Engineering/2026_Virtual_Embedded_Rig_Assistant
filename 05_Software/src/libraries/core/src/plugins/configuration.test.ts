import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginParameters } from "@vera/shared";
import { afterEach, beforeEach, expect, it } from "vitest";
import { settingStates } from "./configuration.js";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "vera-configuration-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const settings: PluginParameters = {
  broker: { kind: "secret", scope: "mqtt", description: "Broker login." },
  registry: {
    kind: "workbench-file",
    path: "lab/resources.json",
    format: "lab-resources",
    description: "Bench.",
  },
  project: {
    kind: "workbench-file",
    path: "*/vera-pi.json",
    format: "json",
    optional: true,
    description: "Pi.",
  },
  agent: { kind: "value", value: "System SSH agent", description: "Login keys." },
};
const registry = {
  format: 1,
  resources: [{ alias: "psu", kind: "visa", resource: "TCPIP0::192.0.2.10::INSTR", profile: "psu" }],
};
const secrets =
  (stored: Record<string, string[]>) =>
  async (scope: string): Promise<string[]> =>
    stored[scope] ?? [];

// REQ-FUNC-cbdb46ac
it("reports each declared parameter without a workbench: secrets by scope, files unchecked, values", async () => {
  expect(await settingStates(settings, { secrets: secrets({ mqtt: ["bench"] }) })).toEqual([
    { name: "broker", kind: "secret", state: "stored", refs: ["bench"] },
    { name: "registry", kind: "workbench-file", state: "unchecked" },
    { name: "project", kind: "workbench-file", state: "unchecked" },
    { name: "agent", kind: "value", state: "value" },
  ]);
  expect((await settingStates(settings, { secrets: secrets({}) }))[0]).toEqual({
    name: "broker",
    kind: "secret",
    state: "missing",
  });
});

it("checks workbench files: missing, broken JSON, an invalid registry, a valid one and one-level matches", async () => {
  const states = async () => {
    const all = await settingStates(settings, { workbench: root, secrets: secrets({}) });
    return { registry: all[1], project: all[2] };
  };
  expect(await states()).toEqual({
    registry: { name: "registry", kind: "workbench-file", state: "missing" },
    project: { name: "project", kind: "workbench-file", state: "missing" },
  });
  await mkdir(join(root, "lab"));
  await writeFile(join(root, "lab", "resources.json"), "{ not json");
  expect((await states()).registry).toEqual({
    name: "registry",
    kind: "workbench-file",
    state: "invalid",
    paths: ["lab/resources.json"],
    problem: "lab/resources.json is not valid UTF-8 JSON.",
  });
  await writeFile(join(root, "lab", "resources.json"), JSON.stringify({ format: 2, resources: [] }));
  const invalid = (await states()).registry;
  expect(invalid?.state).toBe("invalid");
  expect(invalid?.problem).toMatch(/^lab\/resources\.json is not valid: format: /);
  await writeFile(join(root, "lab", "resources.json"), JSON.stringify(registry));
  expect((await states()).registry).toEqual({
    name: "registry",
    kind: "workbench-file",
    state: "present",
    paths: ["lab/resources.json"],
  });
  await mkdir(join(root, "blink"));
  await mkdir(join(root, "deep", "nested"), { recursive: true });
  await writeFile(join(root, "blink", "vera-pi.json"), "{}");
  await writeFile(join(root, "deep", "nested", "vera-pi.json"), "{}");
  expect((await states()).project).toEqual({
    name: "project",
    kind: "workbench-file",
    state: "present",
    paths: ["blink/vera-pi.json"],
  });
  await mkdir(join(root, "other"));
  await writeFile(join(root, "other", "vera-pi.json"), "[");
  expect((await states()).project).toEqual({
    name: "project",
    kind: "workbench-file",
    state: "invalid",
    paths: ["blink/vera-pi.json", "other/vera-pi.json"],
    problem: "other/vera-pi.json is not valid UTF-8 JSON.",
  });
});

it("reports a folder in place of a file and a file the workbench ignores as invalid", async () => {
  await mkdir(join(root, "lab", "resources.json"), { recursive: true });
  const [, folder] = await settingStates(settings, { workbench: root, secrets: secrets({}) });
  expect(folder).toMatchObject({ state: "invalid", problem: "lab/resources.json is not a regular file." });
  await rm(join(root, "lab"), { recursive: true });
  await mkdir(join(root, ".vera"));
  await writeFile(join(root, ".vera", ".veraignore"), "lab/\n");
  await mkdir(join(root, "lab"));
  await writeFile(join(root, "lab", "resources.json"), JSON.stringify(registry));
  const [, ignored] = await settingStates(settings, { workbench: root, secrets: secrets({}) });
  expect(ignored).toMatchObject({
    state: "invalid",
    problem: "lab/resources.json is ignored by the workbench.",
  });
});
