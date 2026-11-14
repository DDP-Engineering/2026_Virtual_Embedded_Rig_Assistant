// apply_candidate (spec REQ-DATA-891d5b5d §10): a kicad-layout candidate replaces its source board only through the
// write flow, after every check, and never when the source or the candidate changed or KiCad has the board open.
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as api from "../index.js";

let root: string;
let outside: string;
let storage: api.WorkbenchDatabase;
const signal = () => new AbortController().signal;
const hash = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const SOURCE = '(kicad_pcb\n\t(version 20260206)\n\t(footprint "C1"\n\t\t(at 140 125)\n\t)\n)\n';
const CANDIDATE = '(kicad_pcb\n\t(version 20260206)\n\t(footprint "C1"\n\t\t(at 124 112 90)\n\t)\n)\n';
const RUN = "electronics-results/r1";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "vera-apply-"));
  outside = await mkdtemp(join(tmpdir(), "vera-apply-outside-"));
  await mkdir(join(root, ".vera"));
  storage = await api.openDb(join(root, ".vera/vera.db"), { workbenchId: "wb_test", appVersion: "0" });
  new api.SessionsRepository(storage.db).create({
    id: "ses_test",
    title: "",
    created_at: "now",
    updated_at: "now",
    model_ref: null,
    permission_mode: "auto-edit",
    status: "idle",
    archived: 0,
  });
  await mkdir(join(root, "boards"));
  await writeFile(join(root, "boards/main.kicad_pcb"), SOURCE);
  await run();
});
afterEach(async () => {
  storage?.close();
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

function context() {
  return {
    ...api.createToolContext(root),
    change: {
      db: storage.db,
      queue: new api.WriteQueue(),
      sessionId: "ses_test",
      turnId: "turn",
      callId: crypto.randomUUID(),
      now: () => "now",
      recorded: () => undefined,
    },
  };
}

/** Writes a kicad-layout run folder; `state` overrides fields of state.json. */
async function run(candidate = CANDIDATE, state: Record<string, unknown> = {}, folder = RUN) {
  await mkdir(join(root, folder, "candidate"), { recursive: true });
  await writeFile(join(root, folder, "candidate/main.kicad_pcb"), candidate);
  const document = {
    format: 1,
    kind: "kicad-layout-state",
    runId: "r1",
    tool: "kicad-layout-tool",
    toolVersion: "1.0.0",
    kicad: "10.0.8",
    source: { path: "boards/main.kicad_pcb", sha256: hash(SOURCE), bytes: Buffer.byteLength(SOURCE) },
    candidate: { path: "candidate/main.kicad_pcb", sha256: hash(candidate), memorySha256: "0".repeat(64) },
    editor: { pid: 1 },
    edits: 1,
    objectives: { status: "pass" },
    ...state,
  };
  await writeFile(join(root, folder, "state.json"), JSON.stringify(document, null, 2));
}
const prepare = (args: unknown = { run: RUN }) => {
  const prepare = api.applyCandidateTool.prepare;
  if (!prepare) throw Error("apply_candidate has no prepare step");
  return prepare(context(), args, signal());
};
const source = () => readFile(join(root, "boards/main.kicad_pcb"), "utf8");
const diffOf = (change: api.PreparedChange) => (change.request as api.FileChangeRequest).diff;

describe("apply_candidate", () => {
  it("prepares a write-class change and applies the candidate's bytes over the source (REQ-FUNC-73b4e5d0)", async () => {
    expect(api.applyCandidateTool).toMatchObject({ name: "apply_candidate", class: "write" });
    const change = await prepare();
    expect(change.request).toMatchObject({
      tool: "apply_candidate",
      path: "boards/main.kicad_pcb",
      existed: true,
      beforeSha256: hash(SOURCE),
      afterSha256: hash(CANDIDATE),
      bytes: Buffer.byteLength(CANDIDATE),
      protected: false,
    });
    expect(diffOf(change)).toContain("-\t\t(at 140 125)");
    expect(diffOf(change)).toContain("+\t\t(at 124 112 90)");
    expect(await source()).toBe(SOURCE);
    const result = await change.apply(signal());
    expect(result).toMatchObject({ path: "boards/main.kicad_pcb", sha256: hash(CANDIDATE), run: RUN });
    expect(await source()).toBe(CANDIDATE);
    expect(storage.db.prepare("SELECT path,before_sha256,after_sha256,status FROM changes").get()).toEqual({
      path: "boards/main.kicad_pcb",
      before_sha256: hash(SOURCE),
      after_sha256: hash(CANDIDATE),
      status: "applied",
    });
  });

  it("applies through the registry like a write (REQ-FUNC-73b4e5d0)", async () => {
    const registry = new api.ToolRegistry();
    expect(
      registry
        .available()
        .filter((tool) => tool.class === "write")
        .map((tool) => tool.name),
    ).toContain("apply_candidate");
    const result = await registry.execute(context(), "apply_candidate", { run: RUN }, signal());
    expect(result.isError, result.text).toBe(false);
    expect(await source()).toBe(CANDIDATE);
  });

  it("refuses a source or candidate that changed, before and after preparing (REQ-SEC-c445ab5c)", async () => {
    await writeFile(join(root, "boards/main.kicad_pcb"), `${SOURCE} `);
    await expect(prepare()).rejects.toThrow(/source.*changed|changed.*source/i);
    await writeFile(join(root, "boards/main.kicad_pcb"), SOURCE);
    await writeFile(join(root, RUN, "candidate/main.kicad_pcb"), `${CANDIDATE} `);
    await expect(prepare()).rejects.toThrow(/candidate.*changed/i);
    await writeFile(join(root, RUN, "candidate/main.kicad_pcb"), CANDIDATE);
    const later = await prepare();
    await writeFile(join(root, RUN, "candidate/main.kicad_pcb"), `${CANDIDATE}\n`);
    await expect(later.apply(signal())).rejects.toThrow(/Conflict/);
    await writeFile(join(root, RUN, "candidate/main.kicad_pcb"), CANDIDATE);
    const again = await prepare();
    await writeFile(join(root, "boards/main.kicad_pcb"), `${SOURCE}\n`);
    await expect(again.apply(signal())).rejects.toThrow(/Conflict/);
    expect(await source()).toBe(`${SOURCE}\n`);
    expect(storage.db.prepare("SELECT * FROM changes WHERE status='applied'").all()).toEqual([]);
  });

  it("refuses while KiCad has the source board open (REQ-SEC-e27836d3)", async () => {
    await writeFile(join(root, "boards/~main.kicad_pcb.lck"), "{}");
    await expect(prepare()).rejects.toThrow(/open in KiCad/);
    await rm(join(root, "boards/~main.kicad_pcb.lck"));
    const change = await prepare();
    await writeFile(join(root, "boards/~main.kicad_pcb.lck"), "{}");
    await expect(change.apply(signal())).rejects.toThrow(/open in KiCad/);
    expect(await source()).toBe(SOURCE);
  });

  it("refuses runs, candidates and targets outside the contract (REQ-SEC-8483534b)", async () => {
    // Each refusal is checked by its own message, so an earlier unrelated error cannot pass for it.
    const refusals: [string, () => Promise<void>, RegExp][] = [
      ["another kind", () => run(CANDIDATE, { kind: "kicad-tool-result" }), /no kicad-layout state/],
      ["format 2", () => run(CANDIDATE, { format: 2 }), /no kicad-layout state/],
      [
        "candidate outside the run",
        () =>
          run(CANDIDATE, {
            candidate: { path: "../x.kicad_pcb", sha256: hash(CANDIDATE), memorySha256: "0".repeat(64) },
          }),
        /inside the run folder/,
      ],
      ["not a KiCad board", () => run("hello\n"), /not a KiCad board file/],
      ["no edit", () => run(CANDIDATE, { edits: 0 }), /no edit to apply/],
      [
        "objectives failed",
        () => run(CANDIDATE, { objectives: { status: "fail" } }),
        /did not pass its objectives/,
      ],
      [
        "target under .vera",
        () => run(CANDIDATE, { source: { path: ".vera/x.kicad_pcb", sha256: hash(SOURCE), bytes: 1 } }),
        /ignored by the workbench/,
      ],
      [
        "target not a board",
        () => run(CANDIDATE, { source: { path: "boards/notes.txt", sha256: hash(SOURCE), bytes: 1 } }),
        /must be a \.kicad_pcb file/,
      ],
      [
        "target outside the workbench",
        () =>
          run(CANDIDATE, {
            source: { path: join(outside, "main.kicad_pcb"), sha256: hash(SOURCE), bytes: 1 },
          }),
        /workbench|outside/i,
      ],
    ];
    await writeFile(join(root, ".vera/x.kicad_pcb"), SOURCE);
    await writeFile(join(root, "boards/notes.txt"), SOURCE);
    await writeFile(join(outside, "main.kicad_pcb"), SOURCE);
    for (const [label, arrange, message] of refusals) {
      await arrange();
      await expect(prepare(), label).rejects.toThrow(message);
    }
    await expect(prepare({ run: "../elsewhere" }), "run outside").rejects.toThrow(/workbench|outside/i);
    await expect(prepare({ run: "boards" }), "not a run folder").rejects.toThrow(/no kicad-layout state/);
    expect(await source()).toBe(SOURCE);
    expect(await readFile(join(root, ".vera/x.kicad_pcb"), "utf8")).toBe(SOURCE);
    expect(await readFile(join(root, "boards/notes.txt"), "utf8")).toBe(SOURCE);
    expect(await readFile(join(outside, "main.kicad_pcb"), "utf8")).toBe(SOURCE);
    expect(storage.db.prepare("SELECT * FROM changes").all()).toEqual([]);
  });

  it("cuts a long diff and says how many lines it left out (REQ-FUNC-73b4e5d0)", async () => {
    const lines = Array.from({ length: 3000 }, (_, index) => `\t(segment ${index})`).join("\n");
    await run(`(kicad_pcb\n${lines}\n)\n`);
    const change = await prepare();
    const diffLines = diffOf(change).split("\n");
    expect(diffLines.length).toBeLessThanOrEqual(2002);
    expect(diffOf(change)).toMatch(/lines left out/);
  });
});
