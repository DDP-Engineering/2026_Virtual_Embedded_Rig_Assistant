import { expect, it } from "vitest";
import {
  configurationNeeds,
  type PluginSettingState,
  pluginConfigurationRequestSchema,
} from "./plugin-settings.js";
import { validatePluginManifest } from "./plugins.js";

const base = {
  format: 1,
  id: "bench-tools",
  version: "0.1.0",
  name: "Bench tools",
  summary: "Bench tools.",
  description: "Bench tools.",
  ecosystem: "lab",
  platforms: ["windows-x64"],
};
const issues = (manifest: unknown) =>
  validatePluginManifest(manifest).issues.map((issue) => `${issue.code}:${issue.path ?? ""}`);

// REQ-DATA-af8807e1
it("accepts a manifest without settings and keeps the declared parameters in manifest order", () => {
  expect(validatePluginManifest(base).manifest?.settings).toBeUndefined();
  const declared = validatePluginManifest({
    ...base,
    settings: {
      "broker-credential": { kind: "secret", scope: "mqtt", description: "Broker login." },
      "lab-resources": {
        kind: "workbench-file",
        path: "lab/resources.json",
        format: "lab-resources",
        description: "Bench resources.",
      },
      "pi-project": {
        kind: "workbench-file",
        path: "*/vera-pi.json",
        optional: true,
        description: "Project.",
      },
      "ssh-agent": { kind: "value", value: "System SSH agent", description: "Login keys." },
    },
  });
  expect(declared.issues).toEqual([]);
  const settings = declared.manifest?.settings ?? {};
  expect(Object.keys(settings)).toEqual(["broker-credential", "lab-resources", "pi-project", "ssh-agent"]);
  expect(settings["pi-project"]).toEqual({
    kind: "workbench-file",
    path: "*/vera-pi.json",
    optional: true,
    description: "Project.",
  });
});

it("reports each invalid settings entry as a field issue naming it", () => {
  const one = (setting: unknown) => issues({ ...base, settings: { bad: setting } });
  expect(one({ kind: "toggle", description: "x" })).toEqual(["field:settings.bad.kind"]);
  expect(one({ kind: "secret", description: "x" })).toEqual(["field:settings.bad.scope"]);
  expect(one({ kind: "secret", scope: "ssh", description: "x" })).toEqual(["field:settings.bad.scope"]);
  expect(one({ kind: "workbench-file", path: "../lab/resources.json", description: "x" })).toEqual([
    "field:settings.bad.path",
  ]);
  expect(one({ kind: "workbench-file", path: "/etc/passwd", description: "x" })).toEqual([
    "field:settings.bad.path",
  ]);
  expect(one({ kind: "workbench-file", path: "lab\\resources.json", description: "x" })).toEqual([
    "field:settings.bad.path",
  ]);
  expect(one({ kind: "workbench-file", path: "lab/r.json", format: "yaml", description: "x" })).toEqual([
    "field:settings.bad.format",
  ]);
  expect(one({ kind: "value", value: "two\nlines", description: "x" })).toEqual(["field:settings.bad.value"]);
  expect(one({ kind: "value", value: "v" })).toEqual(["field:settings.bad.description"]);
  expect(one({ kind: "secret", scope: "mqtt", description: "x", extra: 1 })).toEqual([
    "field:settings.bad.extra",
  ]);
  expect(
    issues({ ...base, settings: { Bad_Name: { kind: "value", value: "v", description: "x" } } }),
  ).toEqual(["field:settings.Bad_Name"]);
  const many = Object.fromEntries(
    Array.from({ length: 33 }, (_, index) => [`p${index}`, { kind: "value", value: "v", description: "x" }]),
  );
  expect(issues({ ...base, settings: many })).toEqual(["field:settings"]);
});

// REQ-UX-05e0ed17
it("names missing secrets, missing required files and invalid files as configuration needs", () => {
  const settings = {
    key: { kind: "secret", scope: "mqtt", description: "x" },
    registry: { kind: "workbench-file", path: "lab/resources.json", description: "x" },
    project: { kind: "workbench-file", path: "*/vera-pi.json", optional: true, description: "x" },
    agent: { kind: "value", value: "v", description: "x" },
  } as const;
  const states = (patch: Record<string, PluginSettingState["state"]>): PluginSettingState[] =>
    Object.entries(settings).map(([name, setting]) => ({
      name,
      kind: setting.kind,
      state:
        patch[name] ??
        (setting.kind === "value" ? "value" : setting.kind === "secret" ? "stored" : "present"),
    }));
  expect(configurationNeeds(settings, states({}))).toEqual([]);
  expect(configurationNeeds(settings, states({ key: "missing", registry: "missing" }))).toEqual([
    "key",
    "registry",
  ]);
  expect(configurationNeeds(settings, states({ project: "missing", registry: "unchecked" }))).toEqual([]);
  expect(configurationNeeds(settings, states({ project: "invalid" }))).toEqual(["project"]);
  expect(configurationNeeds(settings, undefined)).toEqual([]);
});

// REQ-FUNC-cbdb46ac
it("carries declared settings to the configuration channel and no secret value back", () => {
  const request = pluginConfigurationRequestSchema.safeParse({
    plugins: [
      { key: "catalog/mqtt-tools", settings: { key: { kind: "secret", scope: "mqtt", description: "x" } } },
    ],
  });
  expect(request.success).toBe(true);
  expect(
    pluginConfigurationRequestSchema.safeParse({ plugins: [{ key: "k", settings: { key: {} } }] }).success,
  ).toBe(false);
});
