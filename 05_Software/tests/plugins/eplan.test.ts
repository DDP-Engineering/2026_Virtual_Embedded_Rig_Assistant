// The eplan plugin. Default tests check the package, catalog, pack and skill, the rules' risk classes, the dry-run
// plans of eplan-tool (the documented EPLAN command lines it would run), every refusal that comes before EPLAN starts
// and the step loop with a stand-in process; the helper cases run on Windows only, like the plugin. EPLAN itself is
// never started here: there is no EPLAN installation, so the real-application tests run only
// when VERA_TEST_EPLAN_PROFILE names a profile JSON whose project is a fixture project of a licensed EPLAN Electric P8
// 2025 (they export it and import the device list it exported into a copy).
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyCommand,
  eplanOutcomeSchema,
  type PluginManifest,
  validatePluginManifest,
} from "@vera/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";

const plugins = new URL("../../plugins/", import.meta.url);
const source = fileURLToPath(new URL("eplan/", plugins));
const script = join(source, "scripts", "eplan_tool.py");
const fixtures = fileURLToPath(new URL("../fixtures/eplan/", import.meta.url));
const windows = process.platform === "win32";
const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const python = (() => {
  const name = process.env.VERA_TEST_PYTHON ?? (windows ? "python" : "python3");
  const found = spawnSync(name, ["-c", "import sys; print(sys.executable)"], { encoding: "utf8" });
  if (found.status !== 0) throw new Error(`These tests need Python 3.11 or newer as ${name}.`);
  return found.stdout.trim();
})();
const installed = (() => {
  const drive = (process.env.SystemRoot ?? "C:\\Windows").slice(0, 2);
  const base = `${drive}\\Program Files\\EPLAN\\Platform`;
  if (!existsSync(base)) return false;
  return (
    spawnSync(python, [
      "-c",
      `import glob,sys; sys.exit(0 if glob.glob(r'${base}\\2025*\\Bin\\EPLAN.exe') else 1)`,
    ]).status === 0
  );
})();
const realProfile = process.env.VERA_TEST_EPLAN_PROFILE;

interface Doc {
  status?: string;
  reason?: string;
  steps?: { name: string; command: string }[];
  [key: string]: unknown;
}
function run(cwd: string, args: string[]) {
  const result = spawnSync(python, ["-I", script, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1", PYTHONIOENCODING: "utf-8" },
  });
  const doc = result.stdout.trim().startsWith("{") ? (JSON.parse(result.stdout) as Doc) : ({} as Doc);
  return { code: result.status, stdout: result.stdout, stderr: result.stderr, doc };
}
async function listing(dir: string): Promise<string[]> {
  return (await readdir(dir, { recursive: true })).map(String).sort();
}

let bench: string;
let link: string;
let copy: string;
beforeEach(async () => {
  bench = await realpath(await mkdtemp(join(tmpdir(), "vera-eplan-tool-")));
  expect(bench).not.toMatch(/\s/);
  await mkdir(join(bench, "electrical-automation-eplan"));
  await mkdir(join(bench, "projects"));
  link = join(bench, "projects", "PlantM.elk");
  copy = join(bench, "projects", "PlantM-vera.elk");
  await writeFile(link, "fictional project link file\n");
  const profile = JSON.parse(await readFile(join(fixtures, "epl-plant-m.json"), "utf8"));
  profile.project.link = link;
  await writeFile(
    join(bench, "electrical-automation-eplan", "epl-plant-m.json"),
    JSON.stringify(profile, null, 2),
  );
  await mkdir(join(bench, "eplan"));
  await cp(join(fixtures, "devices-plant-m.csv"), join(bench, "eplan", "devices-import.csv"));
});
afterEach(async () => {
  await rm(bench, { recursive: true, force: true });
});
const PROFILE = "electrical-automation-eplan/epl-plant-m.json";
const candidateSha = async () => sha256(await readFile(join(bench, "eplan", "devices-import.csv")));
const importArgs = async (extra: Record<string, string> = {}) => {
  const args: Record<string, string> = {
    "--profile": PROFILE,
    "--candidate": "eplan/devices-import.csv",
    "--sha256": await candidateSha(),
    "--copy": copy,
    "--out": "eplan/run2",
    ...extra,
  };
  return Object.entries(args).flat();
};

describe("package", () => {
  it("publishes the official eplan package: one script program, risk classes, Windows x64 only (REQ-SEC-8fcf4dc1)", async () => {
    const m: PluginManifest = parse(await readFile(join(source, "plugin.yaml"), "utf8"));
    expect(validatePluginManifest(m).issues).toEqual([]);
    expect(m.platforms).toEqual(["windows-x64"]);
    expect(m.ecosystem).toBe("electrical");
    expect(m.license).toBe("LicenseRef-PolyForm-Noncommercial-1.0.0");
    expect(Object.keys(m.programs ?? {})).toEqual(["eplan-tool"]);
    const risk = (args: string[]) => classifyCommand(m.rules ?? [], "eplan-tool", args).risk;
    expect(risk(["--version"])).toBe("safe");
    expect(risk(["plan", "export", "--profile", PROFILE, "--out", "x"])).toBe("safe");
    expect(risk(["export", "--profile", PROFILE, "--out", "x"])).toBe("device-read");
    expect(risk(["import", "--profile", PROFILE, "--candidate", "c.csv"])).toBe("device-write");
    for (const language of ["en", "ro", "de", "fr"])
      expect(await readFile(join(source, "help", `${language}.md`), "utf8")).toContain("eplan-tool");
    const readme = await readFile(join(source, "README.md"), "utf8");
    for (const text of ["not verified with a real EPLAN installation", "ExecuteScript", "CREATESNAPSHOTCOPY"])
      expect(readme).toContain(text);
    expect(await readFile(join(source, "skills", "eplan-exchange", "SKILL.md"), "utf8")).toContain(
      "eplan-tool",
    );
    const catalog = parse(await readFile(fileURLToPath(new URL("catalog.yaml", plugins)), "utf8"));
    expect(catalog.official).toContain("eplan");
    expect(catalog.metadata.eplan.keywords).toContain("EPLAN");
    const packs = parse(await readFile(fileURLToPath(new URL("packs.yaml", plugins)), "utf8")) as {
      id: string;
      groups: { plugins: string[] }[];
    }[];
    const pack = packs.find((entry) => entry.id === "electrical-schematics");
    expect(pack?.groups.some((group) => group.plugins.includes("eplan"))).toBe(true);
  });

  it("prints its version and help without EPLAN", () => {
    expect(run(bench, ["--version"]).stdout.trim()).toBe("eplan-tool 0.1.0");
    const help = run(bench, ["--help"]);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("plan export|import");
  });
});

describe.skipIf(!windows)(
  "plans: only documented actions on the named project or a new copy (REQ-SEC-8fcf4dc1)",
  () => {
    it("exports read-only from the profile's project", async () => {
      const out = run(bench, ["plan", "export", "--profile", PROFILE, "--out", "eplan/run1"]);
      expect(out.code, out.stdout + out.stderr).toBe(0);
      const steps = out.doc.steps ?? [];
      expect(steps.map((step) => step.name)).toEqual([
        "export-devices",
        "export-terminals",
        "export-connections",
      ]);
      const target = join(bench, "eplan", "run1");
      expect(steps[0]?.command).toMatch(
        new RegExp(
          `^"(<EPLAN\\.exe>|[^"]+EPLAN\\.exe)" /Variant:"Electric P8" /NoRemoting /Quiet:1 /NoLicenseDialog /NoUserRightsDialog /Auto ProjectAction /PROJECTNAME:${regexText(link)} /OpenMode:ReadOnly /Action:devicelist /TYPE:EXPORT /EXPORTFILE:${regexText(target)}\\\\devices\\.csv /FORMAT:XDLCsvImporterExporter$`,
        ),
      );
      expect(steps[1]?.command).toContain(
        `ProjectAction /PROJECTNAME:${link} /OpenMode:ReadOnly /Action:XMActionDCCommonExport /CONFIGSCHEME:VERA-terminals /COMPLETEPROJECT:1 /LANGUAGE:en_US /DESTINATION:${target}\\terminals.txt /EXECUTIONMODE:0`,
      );
      expect(await listing(bench)).not.toContain(join("eplan", "run1"));
    });

    it("imports only into the new copy, regenerates its reports and exports the copy", async () => {
      const out = run(bench, ["plan", "import", ...(await importArgs())]);
      expect(out.code, out.stdout + out.stderr).toBe(0);
      const steps = out.doc.steps ?? [];
      expect(steps.map((step) => step.name)).toEqual([
        "snapshot",
        "import",
        "reports",
        "export-devices",
        "export-terminals",
        "export-connections",
      ]);
      expect(steps[0]?.command).toContain(
        `projectmanagement /TYPE:CREATESNAPSHOTCOPY /PROJECTNAME:${link} /FILENAME:${copy}`,
      );
      expect(steps[1]?.command).toContain(
        `ProjectAction /PROJECTNAME:${copy} /OpenMode:Exclusive /Action:devicelist /TYPE:IMPORT /IMPORTFILE:${join(bench, "eplan", "devices-import.csv")} /FORMAT:XDLCsvImporterExporter`,
      );
      expect(steps[2]?.command).toContain(
        `ProjectAction /PROJECTNAME:${copy} /OpenMode:Exclusive /Action:reports /TYPE:PROJECT`,
      );
      for (const step of steps.slice(3))
        expect(step.command).toContain(`/PROJECTNAME:${copy} /OpenMode:ReadOnly`);
      for (const step of steps) {
        expect(step.command).toContain("/PROJECTNAME:");
        expect(step.command).not.toMatch(/ExecuteScript|RegisterScript/i);
        expect(step.command).toContain(" /NoRemoting ");
      }
      // Only the snapshot step names the original project; nothing is imported into it.
      expect(
        steps.filter((step) => step.command.includes(`/PROJECTNAME:${link} `)).map((step) => step.name),
      ).toEqual(["snapshot"]);
    });
  },
);

describe.skipIf(!windows)("refusals before EPLAN starts (REQ-REL-cafafa22)", () => {
  it("refuses unsafe or invalid inputs with exit 2 and writes nothing", async () => {
    const before = await listing(bench);
    const refused = async (args: string[], reason: string) => {
      const out = run(bench, args);
      expect(out.code, `${args.join(" ")}\n${out.stdout}${out.stderr}`).toBe(2);
      expect(out.doc.status).toBe("refused");
      expect(out.doc.reason).toMatch(new RegExp(`^${reason}:`));
      expect(eplanOutcomeSchema.safeParse(out.doc).success).toBe(true);
    };
    await refused(["import", ...(await importArgs({ "--sha256": "1".repeat(64) }))], "conflict");
    await refused(["import", ...(await importArgs({ "--copy": link }))], "copy-is-link");
    await refused(["import", ...(await importArgs({ "--copy": "C:\\EPLAN\\My Copy.elk" }))], "path");
    await refused(["import", ...(await importArgs({ "--out": "../outside" }))], "out-outside");
    await refused(["import", ...(await importArgs({ "--out": "eplan/my out" }))], "path");
    await refused(["import", ...(await importArgs({ "--out": "eplan" }))], "out-exists");
    await refused(
      ["import", ...(await importArgs({ "--copy": "C:\\Elsewhere\\PlantM-vera.elk" }))],
      "copy-folder",
    );
    await writeFile(copy, "existing");
    await refused(["import", ...(await importArgs())], "copy-exists");
    await rm(copy);
    await refused(["export", "--profile", PROFILE, "--out", "eplan/r", "--extra", "x"], "usage");
    await refused(["export", "--profile", PROFILE], "usage");
    await refused(
      ["export", "--profile", "electrical-automation-eplan/none.json", "--out", "eplan/r"],
      "profile",
    );
    await refused(
      ["export", "--profile", PROFILE, "--out", "eplan/r", "--outcome", "eplan/devices-import.csv"],
      "outcome",
    );
    const profile = JSON.parse(await readFile(join(bench, PROFILE), "utf8"));
    await writeFile(join(bench, PROFILE), JSON.stringify({ ...profile, format: 2 }));
    await refused(["export", "--profile", PROFILE, "--out", "eplan/r"], "profile");
    await writeFile(
      join(bench, PROFILE),
      JSON.stringify({ ...profile, tables: { devices: "x", terminals: 1 } }),
    );
    await refused(["export", "--profile", PROFILE, "--out", "eplan/r"], "profile");
    await writeFile(join(bench, PROFILE), JSON.stringify(profile));
    await rm(link);
    await refused(["export", "--profile", PROFILE, "--out", "eplan/r"], "project-missing");
    await writeFile(link, "fictional project link file\n");
    if (!installed) await refused(["export", "--profile", PROFILE, "--out", "eplan/r"], "eplan-missing");
    expect(await listing(bench)).toEqual(before);
  });
});

/**
 * Runs eplan-tool's own step loop with subprocess.Popen and end_tree replaced by stand-ins, so the outcome logic is
 * tested without EPLAN. The stand-in creates the files the commands name; this proves nothing about EPLAN itself.
 */
const DRIVER = String.raw`
import json, re, subprocess, sys, time
from pathlib import Path
sys.path.insert(0, sys.argv[1])
import eplan_tool
scenario, args = sys.argv[2], json.loads(sys.argv[3])
killed = []
class StandIn:
    def __init__(self, line, **kwargs):
        self.line, self.pid, self.code = line, 4242, None
        self.step = next(name for name, pattern in [("snapshot", "CREATESNAPSHOTCOPY"), ("import", "/TYPE:IMPORT"),
            ("reports", "/Action:reports"), ("export", "export")] if pattern.lower() in line.lower())
    def wait(self, timeout=None):
        if scenario == "stop" and self.step == "import":
            raise KeyboardInterrupt()
        if scenario == "hang" and self.step == "import":
            time.sleep(0.05)
            raise subprocess.TimeoutExpired(self.line, timeout)
        self.code = 3 if scenario == "fail" and self.step == "import" else 0
        if not (scenario == "nofile" and self.step == "export"):
            for target in re.findall(r"/(?:EXPORTFILE|DESTINATION|FILENAME):(\S+)", self.line):
                Path(target).write_bytes(b"stand-in\n")
        return self.code
    def poll(self):
        return self.code
eplan_tool.subprocess.Popen = StandIn
eplan_tool.end_tree = lambda process: killed.append(process.step)
if scenario == "hang":
    eplan_tool.STEP_TIMEOUT = 2
plan = eplan_tool.prepare("import", args)
code = eplan_tool.execute(plan, Path("C:/stand-in/EPLAN.exe"))
print(json.dumps({"code": code, "killed": killed}))
`;

describe("step loop with a stand-in process, no EPLAN (REQ-REL-a897a77d)", () => {
  it.skipIf(!windows)(
    "completes only when every step exits 0 with its file; stops at a failure, timeout or Stop and ends the process",
    async () => {
      const drive = async (scenario: string, out: string) => {
        const args = await importArgs({ "--out": out });
        const result = spawnSync(
          python,
          ["-I", "-c", DRIVER, join(source, "scripts"), scenario, JSON.stringify(args)],
          {
            cwd: bench,
            encoding: "utf8",
            env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1", PYTHONIOENCODING: "utf-8" },
          },
        );
        if (!result.stdout.trim()) throw Error(`driver ${scenario}: ${result.stderr}`);
        const lines = result.stdout.trim().split("\n");
        const tail = JSON.parse(lines.at(-1) as string) as { code: number; killed: string[] };
        const outcome = eplanOutcomeSchema.parse(
          JSON.parse(await readFile(join(bench, out, "outcome.json"), "utf8")),
        );
        await rm(copy, { force: true });
        return { ...tail, outcome, stderr: result.stderr };
      };
      const done = await drive("ok", "eplan/ok");
      expect(done.code, done.stderr).toBe(0);
      expect(done.outcome.status).toBe("completed");
      expect(done.outcome.steps.map((step) => [step.name, step.exit])).toEqual([
        ["snapshot", 0],
        ["import", 0],
        ["reports", 0],
        ["export-devices", 0],
        ["export-terminals", 0],
        ["export-connections", 0],
      ]);
      expect(done.outcome.files.map((file) => [file.table, file.path, file.sha256])).toEqual(
        ["devices.csv", "terminals.txt", "connections.txt"].map((name, i) => [
          ["devices", "terminals", "connections"][i],
          `eplan/ok/${name}`,
          sha256("stand-in\n"),
        ]),
      );
      const failed = await drive("fail", "eplan/fail");
      expect(failed.code).toBe(1);
      expect(failed.outcome).toMatchObject({ status: "failed", reason: "step-failed:import exit 3" });
      expect(failed.outcome.steps.map((step) => step.name)).toEqual(["snapshot", "import"]);
      const nofile = await drive("nofile", "eplan/nofile");
      expect(nofile.outcome.status).toBe("failed");
      expect(nofile.outcome.reason).toMatch(/^no-file:export-devices /);
      expect(nofile.outcome.files).toEqual([]);
      const hang = await drive("hang", "eplan/hang");
      expect(hang.outcome).toMatchObject({ status: "failed", reason: "timeout:import after 2 s" });
      expect(hang.killed).toEqual(["import"]);
      const stopped = await drive("stop", "eplan/stop");
      expect(stopped.code).toBe(1);
      expect(stopped.outcome).toMatchObject({ status: "interrupted", reason: "stopped" });
      expect(stopped.killed).toEqual(["import"]);
      expect(stopped.outcome.steps.map((step) => [step.name, step.exit])).toEqual([
        ["snapshot", 0],
        ["import", null],
      ]);
    },
    60_000,
  );
});

describe.skipIf(!realProfile)("real EPLAN Electric P8 2025 (VERA_TEST_EPLAN_PROFILE)", () => {
  it("exports the fixture project read-only and imports its own device list into a copy", async () => {
    const work = await realpath(await mkdtemp(join(tmpdir(), "vera-eplan-real-")));
    try {
      await mkdir(join(work, "electrical-automation-eplan"));
      await cp(realProfile as string, join(work, PROFILE));
      const exported = run(work, ["export", "--profile", PROFILE, "--out", "eplan/run1"]);
      expect(exported.doc.status, exported.stdout).toBe("completed");
      const devices = join(work, "eplan", "run1", "devices.csv");
      const { link: realLink } = JSON.parse(await readFile(realProfile as string, "utf8")).project as {
        link: string;
      };
      const projectCopy = realLink.replace(/\.elk$/i, `-vera-${Date.now()}.elk`);
      const imported = run(work, [
        "import",
        "--profile",
        PROFILE,
        "--candidate",
        "eplan/run1/devices.csv",
        "--sha256",
        sha256(await readFile(devices)),
        "--copy",
        projectCopy,
        "--out",
        "eplan/run2",
      ]);
      expect(imported.doc.status, imported.stdout).toBe("completed");
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  }, 3_600_000);
});

function regexText(text: string): string {
  return text.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}
