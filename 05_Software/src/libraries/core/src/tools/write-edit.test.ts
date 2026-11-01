import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import * as api from "../index.js";

let root: string;
let storage: api.WorkbenchDatabase;
const signal = () => new AbortController().signal;
const hash = (data: string) => createHash("sha256").update(data).digest("hex");
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "vera-write-"));
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
});
afterEach(async () => {
  storage?.close();
  await rm(root, { recursive: true, force: true });
});
function context(queue = new api.WriteQueue()) {
  return {
    ...api.createToolContext(root),
    change: {
      db: storage.db,
      queue,
      sessionId: "ses_test",
      turnId: "turn",
      callId: crypto.randomUUID(),
      now: () => "now",
      recorded: () => undefined,
    },
  };
}
const read = (ctx: api.ToolContext, path = "file.txt") => api.readTool.execute(ctx, { path }, signal());
const edit = (ctx: api.ToolContext, oldString: string, newString: string, replaceAll = false) =>
  api.editTool.execute(ctx, { path: "file.txt", oldString, newString, replaceAll }, signal());
it("registers sequential write/edit and creates UTF8 files and parent folders", async () => {
  const registry = new api.ToolRegistry();
  expect(
    registry
      .available()
      .filter((t) => t.class === "write")
      .map((t) => t.name),
    // web_download also writes (a managed download under .vera) and needs the same approval.
  ).toEqual(["write", "edit", "web_download"]);
  const result = await registry.execute(
    context(),
    "write",
    { path: "notes/Äƒ/a.txt", content: "banc Äƒ\n" },
    signal(),
  );
  expect(result.isError).toBe(false);
  expect(JSON.parse(result.text)).toEqual({
    path: "notes/Äƒ/a.txt",
    bytes: Buffer.byteLength("banc Äƒ\n"),
    created: true,
  });
  expect(await readFile(join(root, "notes/Äƒ/a.txt"), "utf8")).toBe("banc Äƒ\n");
  const row = storage.db.prepare("SELECT * FROM changes").get();
  expect(row).toMatchObject({ before_sha256: null, after_sha256: hash("banc Äƒ\n"), status: "applied" });
});
it("requires a fresh read for overwrite and refreshes the fingerprint after a write", async () => {
  await writeFile(join(root, "file.txt"), "old\n");
  const ctx = context();
  await expect(api.writeTool.execute(ctx, { path: "file.txt", content: "new\n" }, signal())).rejects.toThrow(
    "Read the file before overwriting it.",
  );
  await read(ctx);
  expect(await api.writeTool.execute(ctx, { path: "file.txt", content: "new\n" }, signal())).toMatchObject({
    created: false,
  });
  ctx.change.callId = crypto.randomUUID();
  expect(await edit(ctx, "new", "next")).toMatchObject({ replacements: 1, added: 1, removed: 1 });
});
it("requires exactly one match unless replaceAll and rejects empty and zero matches", async () => {
  await writeFile(join(root, "file.txt"), "one\none\n");
  const ctx = context();
  await read(ctx);
  await expect(edit(ctx, "missing", "x")).rejects.toThrow(/not found|no match/i);
  await expect(edit(ctx, "one", "x")).rejects.toThrow(/multiple|several|2 matches/i);
  await expect(edit(ctx, "", "x")).rejects.toThrow();
  expect(await edit(ctx, "one", "two", true)).toMatchObject({ replacements: 2, added: 2, removed: 2 });
  expect(await readFile(join(root, "file.txt"), "utf8")).toBe("two\ntwo\n");
});
it("rejects externally stale reads for edit and overwrite without losing content", async () => {
  await writeFile(join(root, "file.txt"), "old");
  const ctx = context();
  await read(ctx);
  await writeFile(join(root, "file.txt"), "external");
  await expect(edit(ctx, "old", "new")).rejects.toThrow(/conflict/i);
  await expect(api.writeTool.execute(ctx, { path: "file.txt", content: "new" }, signal())).rejects.toThrow(
    /conflict/i,
  );
  expect(await readFile(join(root, "file.txt"), "utf8")).toBe("external");
  expect(storage.db.prepare("SELECT * FROM changes").all()).toEqual([]);
});
it("preserves CRLF and BOM while matching LF arguments", async () => {
  const original = "\ufeffone\r\ntwo\r\n";
  await writeFile(join(root, "file.txt"), original);
  const ctx = context();
  await read(ctx);
  expect(await edit(ctx, "one\ntwo\n", "three\nfour\n")).toMatchObject({ added: 2, removed: 2 });
  expect(await readFile(join(root, "file.txt"))).toEqual(Buffer.from("\ufeffthree\r\nfour\r\n"));
});
it.skipIf(process.platform === "win32")("preserves existing POSIX modes for edit and overwrite", async () => {
  await writeFile(join(root, "file.txt"), "old\n");
  await chmod(join(root, "file.txt"), 0o751);
  const ctx = context();
  await read(ctx);
  await edit(ctx, "old", "edited");
  expect((await stat(join(root, "file.txt"))).mode & 0o777).toBe(0o751);
  ctx.change.callId = crypto.randomUUID();
  await api.writeTool.execute(ctx, { path: "file.txt", content: "overwritten\n" }, signal());
  expect((await stat(join(root, "file.txt"))).mode & 0o777).toBe(0o751);
  expect(await readFile(join(root, "file.txt"), "utf8")).toBe("overwritten\n");
});
it("rejects outside/ignored paths and project metadata", async () => {
  const ctx = context();
  for (const path of ["../outside", ".vera/new", "C:/outside", "node_modules/new"]) {
    await expect(api.writeTool.execute(ctx, { path, content: "new" }, signal())).rejects.toThrow();
  }
  for (const path of [
    ".vera/workbench.yaml",
    ".vera/WORKBENCH.md",
    ".vera/skills/reader/SKILL.md",
    ".vera/.veraignore",
  ]) {
    await expect(api.prepareChange(ctx, "write", { path, content: "new" }, signal())).rejects.toThrow();
  }
});
it("applies only one of two prepared same-version edits and never recalculates", async () => {
  await writeFile(join(root, "file.txt"), "old\n");
  const queue = new api.WriteQueue();
  const a = context(queue),
    b = context(queue);
  await Promise.all([read(a), read(b)]);
  const first = await api.prepareChange(
    a,
    "edit",
    { path: "file.txt", oldString: "old", newString: "a" },
    signal(),
  );
  const second = await api.prepareChange(
    b,
    "edit",
    { path: "file.txt", oldString: "old", newString: "b" },
    signal(),
  );
  const results = await Promise.allSettled([first.apply(signal()), second.apply(signal())]);
  expect(results[0]?.status).toBe("fulfilled");
  expect(results[1]?.status).toBe("rejected");
  expect(await readFile(join(root, "file.txt"), "utf8")).toBe("a\n");
  expect(storage.db.prepare("SELECT status FROM changes").all()).toEqual([{ status: "applied" }]);
  await expect(first.apply(signal())).rejects.toThrow(/consumed|used/i);
});
it("resolves pending hashes on restart without writing files, including new-file absence and conflicts", async () => {
  await writeFile(join(root, "after.txt"), "new");
  await writeFile(join(root, "before.txt"), "old");
  await writeFile(join(root, "conflict.txt"), "external");
  const insert = storage.db.prepare(
    "INSERT INTO changes(session_id,tool_call_id,path,before_sha256,after_sha256,diff,status) VALUES ('ses_test',?,?,?,?,'diff','pending')",
  );
  for (const path of ["after.txt", "before.txt", "conflict.txt", "missing.txt"])
    insert.run(path, path, path === "missing.txt" ? null : hash("old"), hash("new"));
  storage.close();
  storage = await api.openDb(join(root, ".vera/vera.db"), { workbenchId: "wb_test", appVersion: "0" });
  await api.recoverChanges(root, storage.db, signal());
  expect(storage.db.prepare("SELECT path,status FROM changes ORDER BY id").all()).toEqual([
    { path: "after.txt", status: "applied" },
    { path: "conflict.txt", status: "conflict" },
  ]);
  expect(await readFile(join(root, "conflict.txt"), "utf8")).toBe("external");
  await api.recoverChanges(root, storage.db, signal());
  expect(storage.db.prepare("SELECT count(*) n FROM changes").get()).toEqual({ n: 2 });
});

it("rejects newly created files at admission, keeps immutable args and prevents queued aborted writes", async () => {
  const ctx = context();
  const args = { path: "new.txt", content: "prepared" };
  const change = await api.prepareChange(ctx, "write", args, signal());
  args.content = "tampered";
  await writeFile(join(root, "new.txt"), "external");
  await expect(change.apply(signal())).rejects.toThrow(/Conflict/);
  expect(await readFile(join(root, "new.txt"), "utf8")).toBe("external");
  const controller = new AbortController();
  const next = await api.prepareChange(ctx, "write", { path: "another.txt", content: "new" }, signal());
  controller.abort();
  await expect(next.apply(controller.signal)).rejects.toThrow();
  expect(storage.db.prepare("SELECT * FROM changes").all()).toEqual([]);
});

it("checks again after pending insertion and resolves rename/recording failures by hash", async () => {
  await writeFile(join(root, "file.txt"), "old");
  const ctx = context();
  await read(ctx);
  storage.db.function("external_change", () => {
    writeFileSync(join(root, "file.txt"), "external");
    return 1;
  });
  storage.db.exec(
    "CREATE TRIGGER external_before_temp AFTER INSERT ON changes BEGIN SELECT external_change(); END",
  );
  await expect(edit(ctx, "old", "new")).rejects.toThrow(/Conflict/);
  expect(await readFile(join(root, "file.txt"), "utf8")).toBe("external");
  await api.recoverChanges(root, storage.db, signal());
  expect(storage.db.prepare("SELECT status FROM changes").get()).toEqual({ status: "conflict" });
  storage.db.exec("DROP TRIGGER external_before_temp");
  ctx.change.callId = crypto.randomUUID();
  await read(ctx);
  storage.db.exec(
    "CREATE TRIGGER fail_applied BEFORE UPDATE OF status ON changes WHEN NEW.status='applied' BEGIN SELECT RAISE(FAIL,'recording unavailable'); END",
  );
  await expect(edit(ctx, "external", "new")).rejects.toThrow(/recording unavailable/);
  expect(await readFile(join(root, "file.txt"), "utf8")).toBe("new");
  expect(storage.db.prepare("SELECT status FROM changes ORDER BY id DESC LIMIT 1").get()).toEqual({
    status: "pending",
  });
  storage.db.exec("DROP TRIGGER fail_applied");
  await api.recoverChanges(root, storage.db, signal());
  expect(storage.db.prepare("SELECT status FROM changes ORDER BY id DESC LIMIT 1").get()).toEqual({
    status: "applied",
  });
});
