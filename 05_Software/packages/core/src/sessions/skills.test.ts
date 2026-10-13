import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { ReplayGateway } from "../llm/replay.js";
import { SkillCatalog } from "../skills/catalog.js";
import { openDb } from "../storage/db.js";
import { SessionService } from "./service.js";

it("replay loads a user skill body and its extra file through the production registry", async () => {
  const root = await mkdtemp(join(tmpdir(), "vera-skill-replay-"));
  const bench = join(root, "bench"),
    data = join(root, "data"),
    scripts = join(root, "scripts");
  await mkdir(join(bench, ".vera"), { recursive: true });
  await mkdir(join(data, "skills", "reader"), { recursive: true });
  await mkdir(scripts);
  await writeFile(
    join(data, "skills/reader/SKILL.md"),
    "---\nname: reader\ndescription: Read board evidence.\n---\nBODY INSTRUCTIONS\n",
  );
  await writeFile(join(data, "skills/reader/extra.md"), "EXTRA EVIDENCE");
  await writeFile(
    join(scripts, "skills.jsonl"),
    [
      { toolCalls: [{ name: "load_skill", args: { name: "reader" } }] },
      { text: "{{text}}", toolCalls: [{ name: "load_skill", args: { name: "reader", file: "extra.md" } }] },
      { text: "{{text}}" },
    ]
      .map((s) => JSON.stringify(s))
      .join("\n"),
  );
  const storage = await openDb(join(bench, ".vera/vera.db"), { workbenchId: "wb_test", appVersion: "0" });
  const disabled: string[] = [];
  const service = new SessionService({
    root: bench,
    db: storage.db,
    skills: new SkillCatalog({ root: bench, userData: data, disabled: () => disabled }),
    gateway: new ReplayGateway({ dir: scripts, now: () => Date.now() }),
    clock: { now: () => new Date(), sleep: async () => {} },
    model: () => "replay/skills",
    prompt: () => "Skills test",
  });
  try {
    await service.waitReady();
    const session = service.create(null, "read-only");
    service.send(session.id, "Use reader");
    expect(await service.waitIdle(session.id)).toEqual({ stopReason: "end" });
    const rows = storage.db.prepare("SELECT status,result_json FROM tool_calls ORDER BY rowid").all() as {
      status: string;
      result_json: string;
    }[];
    expect(rows.map((r) => r.status)).toEqual(["ok", "ok"]);
    expect(rows[0]?.result_json).toContain("BODY INSTRUCTIONS");
    expect(rows[1]?.result_json).toContain("EXTRA EVIDENCE");
    disabled.push("reader");
    service.send(session.id, "Again");
    await service.waitIdle(session.id);
    expect(
      (
        storage.db.prepare("SELECT status FROM tool_calls ORDER BY rowid DESC LIMIT 1").get() as {
          status: string;
        }
      ).status,
    ).toBe("error");
  } finally {
    await service.close();
    storage.close();
    await rm(root, { recursive: true, force: true });
  }
});
