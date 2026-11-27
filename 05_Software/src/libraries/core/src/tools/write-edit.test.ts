import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
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
it("refuses agent writes to installed plugin files and workbench authority even in bypass", async () => {
  const ctx = { ...context(), permissionMode: () => "bypass" as const, managedRoots: [join(root, "data")] };
  for (const path of [
    "data/plugins/installed/fixture/plugin.yaml",
    ".vera/workbench.yaml",
    ".vera/plugins/fixture/plugin.yaml",
  ]) {
    await expect(api.writeTool.prepare?.(ctx, { path, content: "changed" }, signal())).rejects.toThrow();
  }
  expect(
    await api.writeTool.prepare?.(ctx, { path: "plugins/draft/plugin.yaml", content: "draft" }, signal()),
  ).toBeDefined();
});
const read = (ctx: api.ToolContext, path = "file.txt") => api.readTool.execute(ctx, { path }, signal());
const edit = (ctx: api.ToolContext, oldString: string, newString: string, replaceAll = false) =>
  api.editTool.execute(ctx, { path: "file.txt", oldString, newString, replaceAll }, signal());
it("uses the same decoding for read and edit when legacy bytes occur after the first window", async () => {
  const prefix = Buffer.from(`v=é\n${"a\n".repeat(33_000)}`, "utf8");
  const suffix = Buffer.from("voltage=5µV\n", "latin1");
  await writeFile(join(root, "file.txt"), Buffer.concat([prefix, suffix]));
  const ctx = context();
  const result = await api.readTool.execute(ctx, { path: "file.txt", limit: 1 }, signal());
  expect(result.text).toBe("1: v=Ã©");
  await edit(ctx, "v=Ã©", "v=3V");
  expect(
    (await readFile(join(root, "file.txt"))).equals(
      Buffer.concat([Buffer.from("v=3V\n"), prefix.subarray(5), suffix]),
    ),
  ).toBe(true);
});
it("allows reading a program log without allowing file tools to overwrite it", async () => {
  await mkdir(join(root, ".vera/runs"));
  const path = ".vera/runs/run_01ABC.log";
  await writeFile(join(root, path), "native result\n");
  const ctx = context();
  await expect(read(ctx, path)).resolves.toMatchObject({ text: expect.stringContaining("native result") });
  await expect(api.writeTool.prepare?.(ctx, { path, content: "overwritten" }, signal())).rejects.toThrow(
    /ignored/,
  );
});
it("registers sequential write/edit and creates UTF8 files and parent folders", async () => {
  const registry = new api.ToolRegistry();
  expect(
    registry
      .available()
      .filter((t) => t.class === "write")
      .map((t) => t.name),
    // web_download also writes (a managed download under .vera) and needs the same approval.
  ).toEqual([
    "write",
    "edit",
    "web_download",
    "apply_candidate",
    "electrical_model_change",
    "electrical_network",
    "protection_coordination",
    "motor_drives",
    "power_quality",
    "lighting_design",
  ]);
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
it("applies a change whose diff is too large and leaves its preview unavailable", async () => {
  const content = Array.from({ length: 4001 }, (_, line) => `line ${line}`).join("\n");
  const ctx = context();
  const prepared = await api.writeTool.prepare?.(ctx, { path: "big.txt", content }, signal());
  expect(prepared?.request).toMatchObject({ diff: "" });
  expect(await api.writeTool.execute(ctx, { path: "big.txt", content }, signal())).toMatchObject({
    created: true,
  });
  expect(await readFile(join(root, "big.txt"), "utf8")).toBe(content);
  expect(storage.db.prepare("SELECT diff FROM changes").get()).toEqual({ diff: "" });
});
it("preserves the prepared write when diff calculation runs out of time", async () => {
  const ctx = context();
  await writeFile(join(root, "file.txt"), "old\n");
  await read(ctx);
  let time = 0;
  const clock = vi.spyOn(Date, "now").mockImplementation(() => (time += 101));
  try {
    const change = await api.prepareChange(
      ctx,
      "write",
      { path: "file.txt", content: "updated\n" },
      signal(),
    );
    expect(change.request).toMatchObject({ diff: "" });
    await expect(change.apply(signal())).resolves.toMatchObject({ bytes: 8, created: false });
    expect(await readFile(join(root, "file.txt"), "utf8")).toBe("updated\n");
  } finally {
    clock.mockRestore();
  }
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
it("matches an LF passage of a file with mixed line endings as it is written", async () => {
  await writeFile(join(root, "file.txt"), "int a;\r\nint b;\nint c;\nint d;\r\n");
  const ctx = context();
  await read(ctx);
  expect(await edit(ctx, "int b;\nint c;", "int b;\nint C;")).toMatchObject({ replacements: 1 });
  expect(await readFile(join(root, "file.txt"), "utf8")).toBe("int a;\r\nint b;\nint C;\nint d;\r\n");
  // A one-line match in the CRLF part still gets CRLF in a multi-line replacement.
  ctx.change.callId = crypto.randomUUID();
  await edit(ctx, "int a;", "int a;\nint e;");
  expect(await readFile(join(root, "file.txt"), "utf8")).toBe(
    "int a;\r\nint e;\r\nint b;\nint C;\nint d;\r\n",
  );
});
it("keeps CRLF, the BOM and a Latin-1 encoding when a file is overwritten", async () => {
  const ctx = context();
  const overwrite = async (before: string | Buffer, content: string) => {
    await writeFile(join(root, "file.txt"), before);
    await read(ctx);
    ctx.change.callId = crypto.randomUUID();
    await api.writeTool.execute(ctx, { path: "file.txt", content }, signal());
    return readFile(join(root, "file.txt"));
  };
  // Models send LF and no BOM: one changed word must stay a one-line change.
  expect(await overwrite("﻿int a;\r\nint b;\r\n", "int a;\nint B;\n")).toEqual(
    Buffer.from("﻿int a;\r\nint B;\r\n"),
  );
  // A file with mixed line endings has no single form to keep; the content is written as given.
  expect(await overwrite("int a;\r\nint b;\n", "int a;\nint B;\n")).toEqual(Buffer.from("int a;\nint B;\n"));
  // cp1252 degree sign: one byte before and after.
  const degree = (tail: string) =>
    Buffer.concat([Buffer.from("// 25 "), Buffer.from([0xb0]), Buffer.from(tail)]);
  expect(await overwrite(degree("C\nint a;\n"), "// 25 °C\nint A;\n")).toEqual(degree("C\nint A;\n"));
  // A character Latin-1 lacks makes the rewrite UTF-8.
  expect(await overwrite(degree("C\nint a;\nint b;\n"), "// 25 °C Ω\nint a;\n")).toEqual(
    Buffer.from("// 25 °C Ω\nint a;\n"),
  );
});
it("edits a file that is not UTF-8 without changing its other bytes", async () => {
  // cp1252 degree and micro signs, as in vendor C sources.
  const original = Buffer.concat([
    Buffer.from("// 25 "),
    Buffer.from([0xb0]),
    Buffer.from("C, 10 "),
    Buffer.from([0xb5]),
    Buffer.from("F\nint gain = 1;\n"),
  ]);
  await writeFile(join(root, "file.txt"), original);
  const ctx = context();
  await read(ctx);
  await edit(ctx, "int gain = 1;", "int gain = 2;");
  const saved = await readFile(join(root, "file.txt"));
  expect(saved.subarray(0, original.indexOf("int"))).toEqual(original.subarray(0, original.indexOf("int")));
  expect(saved.toString("latin1")).toContain("int gain = 2;");
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
it.each(["LE", "BE"])(
  "reports UTF-16%s as an unsupported write encoding after reading it",
  async (endian) => {
    const file = join(root, "file.txt");
    const bytes = Buffer.from("\ufeffalpha\r\nbeta\r\n", "utf16le");
    if (endian === "BE") bytes.swap16();
    await writeFile(file, bytes);
    const ctx = context();
    expect(await api.readTool.execute(ctx, { path: "file.txt" }, signal())).toMatchObject({
      text: "1: alpha\n2: beta",
    });
    await expect(edit(ctx, "beta", "gamma")).rejects.toThrow(/UTF-16.*write and edit/i);
    await expect(
      api.writeTool.execute(ctx, { path: "file.txt", content: "updated" }, signal()),
    ).rejects.toThrow(/UTF-16.*write and edit/i);
    expect(await readFile(file)).toEqual(bytes);
  },
);
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
  await expect(edit(ctx, "external", "new")).resolves.toMatchObject({
    historyPending: true,
    replacements: 1,
  });
  expect(await readFile(join(root, "file.txt"), "utf8")).toBe("new");
  expect([...ctx.lastReads.values()][0]?.sha256).toBe(hash("new"));
  expect(storage.db.prepare("SELECT status FROM changes ORDER BY id DESC LIMIT 1").get()).toEqual({
    status: "pending",
  });
  storage.db.exec("DROP TRIGGER fail_applied");
  await api.recoverChanges(root, storage.db, signal());
  expect(storage.db.prepare("SELECT status FROM changes ORDER BY id DESC LIMIT 1").get()).toEqual({
    status: "applied",
  });
});

// REQ-SEC-3856567c
it.each(["read-only", "ask", "auto-edit", "bypass"] as const)(
  "refuses app-data reads, discovery and writes in %s",
  async (mode) => {
    const data = join(root, "data");
    await mkdir(data);
    await writeFile(join(data, "settings.json"), "private bytes");
    const ctx = { ...context(), permissionMode: () => mode, managedRoots: [data] };
    const registry = new api.ToolRegistry();
    for (const [name, args] of [
      ["read", { path: "data/settings.json" }],
      ["list", { path: "data" }],
      ["glob", { path: "data", pattern: "**/*" }],
    ] as const) {
      const outcome = await registry.execute(ctx, name, args, signal());
      expect(outcome.isError).toBe(true);
      expect(outcome.text).toContain("VERA application data");
      expect(outcome.text).not.toContain("private bytes");
    }
    for (const path of ["data/settings.json", "data/new/deep.txt"])
      await expect(registry.prepare(ctx, "write", { path, content: "changed" }, signal())).rejects.toThrow(
        /VERA application data/,
      );
    expect(await readFile(join(data, "settings.json"), "utf8")).toBe("private bytes");
    expect((await registry.execute(ctx, "list", { path: ".", depth: 3 }, signal())).text).not.toContain(
      "settings.json",
    );
    expect((await registry.execute(ctx, "glob", { pattern: "**/*" }, signal())).text).not.toContain(
      "settings.json",
    );
  },
);
