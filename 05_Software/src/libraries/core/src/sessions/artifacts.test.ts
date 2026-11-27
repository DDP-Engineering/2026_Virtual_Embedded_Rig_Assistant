// REQ-FUNC-bf809842 REQ-DATA-e3d4d5ba REQ-FUNC-997412a4 REQ-FUNC-b3d37df6 REQ-SEC-86010eb5
import { createHash } from "node:crypto";
import { link, mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import * as core from "../index.js";
import { ReplayGateway } from "../llm/replay.js";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function setup(
  calls?: { name: string; args: Record<string, unknown> }[],
  options: Partial<core.SessionHost> = {},
) {
  const root = await mkdtemp(join(tmpdir(), "vera-artifact-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".vera"));
  await mkdir(join(root, "scripts"));
  const fixture = calls
    ? [{ toolCalls: calls }, { text: "Saved [[artifact:summary.md]] and [[artifact:missing.md]]" }]
        .map((x) => JSON.stringify(x))
        .join("\n")
    : await readFile(resolve("tests/fixtures/llm-scripts/save-artifact.jsonl"), "utf8");
  await writeFile(join(root, "scripts/save.jsonl"), fixture);
  const handle = await core.openDb(join(root, ".vera/vera.db"), { workbenchId: "wb_test", appVersion: "0" });
  cleanup.push(async () => handle.close());
  const gateway = new ReplayGateway({ dir: join(root, "scripts"), now: () => Date.now() });
  await gateway.models("replay", new AbortController().signal);
  const host: core.SessionHost = {
    root,
    db: handle.db,
    gateway,
    clock: { now: () => new Date(), sleep: async () => {} },
    model: () => "replay/save",
    prompt: () => "Test",
    ...options,
  };
  const service = new core.SessionService(host);
  cleanup.push(() => service.close());
  await service.waitReady();
  return { root, handle, host, service };
}
function save(args: Record<string, unknown>) {
  return { name: "artifact_save", args };
}

it("normalizes covered citations to the smallest issued window only when requested", async () => {
  let script = "save";
  const { service, root } = await setup(
    [
      { name: "read", args: { path: "criterion.md" } },
      { name: "read", args: { path: "criterion.md", offset: 2, limit: 3 } },
      save({
        name: "strict.md",
        content:
          "Unfinished [[criterion.md#L3-L3\nSettled [[criterion.md#L3-L3]] and [[criterion.md#L1-L5]].",
        exactLineRefs: true,
      }),
      save({ name: "unsupported.md", content: "[[criterion.md#L5-L6]]", exactLineRefs: true }),
      save({ name: "literal.md", content: "[[criterion.md#L3-L3]]" }),
    ],
    { model: () => `replay/${script}` },
  );
  await writeFile(join(root, "criterion.md"), "one\ntwo\nthree\nfour\nfive\n");
  const session = service.create(null, "read-only");
  service.send(session.id, "Save checked references");
  await service.waitIdle(session.id);
  const artifacts = service.listArtifacts(session.id);
  const strict = artifacts.find(({ name }) => name === "strict.md");
  const literal = artifacts.find(({ name }) => name === "literal.md");
  const unsupported = artifacts.find(({ name }) => name === "unsupported.md");
  expect(strict).toBeDefined();
  expect(literal).toBeDefined();
  expect((await service.openArtifact(strict?.artifactId ?? "")).content).toBe(
    "Unfinished [[criterion.md#L3-L3\nSettled [[criterion.md#L2-L4]] and [[criterion.md#L1-L5]].",
  );
  expect((await service.openArtifact(literal?.artifactId ?? "")).content).toBe("[[criterion.md#L3-L3]]");
  expect((await service.openArtifact(unsupported?.artifactId ?? "")).content).toBe("[[criterion.md#L5-L6]]");
  await writeFile(
    join(root, "scripts/stale.jsonl"),
    [
      { toolCalls: [save({ name: "stale.md", content: "[[criterion.md#L3-L3]]", exactLineRefs: true })] },
      { text: "Finished." },
    ]
      .map((step) => JSON.stringify(step))
      .join("\n"),
  );
  script = "stale";
  service.send(session.id, "Save without reopening the source");
  await service.waitIdle(session.id);
  const stale = service.listArtifacts(session.id).find(({ name }) => name === "stale.md");
  expect((await service.openArtifact(stale?.artifactId ?? "")).content).toBe("[[criterion.md#L3-L3]]");
});

it("continues escaped artifact pages from the last complete delivered line", async () => {
  const line = '"'.repeat(200);
  const ref = "artifact:report.md";
  const { service, handle } = await setup([
    save({ name: "report.md", content: Array.from({ length: 200 }, () => line).join("\n") }),
    { name: "read", args: { path: ref } },
  ]);
  const session = service.create(null, "read-only");
  service.send(session.id, "Save and read a report");
  await service.waitIdle(session.id);
  const { result_json } = handle.db
    .prepare("SELECT result_json FROM tool_calls WHERE name='read' AND status='ok'")
    .get() as { result_json: string };
  const result = JSON.parse(JSON.parse(result_json).content[0].text);
  const visible = result.text.split("\n");
  expect(visible.at(-1)).toBe(`${visible.length}: ${line}`);
  expect(result).toMatchObject({ ref, nextOffset: visible.length + 1, truncated: true });
});

it("finds and reads verified artifact lines after reopening, only in the owning session", async () => {
  const ref = "artifact:comparison.md";
  const { service, root, handle, host } = await setup([
    save({
      name: "comparison.md",
      description: "Boot comparison",
      content: "Scope\r\nObserved I2C timeout\nEvidence pending\n",
    }),
  ]);
  const session = service.create(null, "read-only");
  service.send(session.id, "Save comparison");
  await service.waitIdle(session.id);
  const [artifact] = service.listArtifacts(session.id);
  expect(artifact).toBeDefined();
  await service.close();
  await writeFile(
    join(root, "scripts/read.jsonl"),
    [
      { toolCalls: [{ name: "artifact_list", args: { namePrefix: "comparison" } }] },
      { toolCalls: [{ name: "read", args: { path: ref, offset: 2, limit: 1 } }] },
      { text: `Evidence [[${ref}]].` },
    ]
      .map((step) => JSON.stringify(step))
      .join("\n"),
  );
  const reopened = new core.SessionService({ ...host, model: () => "replay/read" });
  cleanup.push(() => reopened.close());
  await reopened.waitReady();
  const lastCall = () =>
    handle.db.prepare("SELECT status,result_json FROM tool_calls ORDER BY rowid DESC LIMIT 1").get() as {
      status: string;
      result_json: string;
    };
  const lastList = () => {
    const row = handle.db
      .prepare("SELECT result_json FROM tool_calls WHERE name='artifact_list' ORDER BY rowid DESC LIMIT 1")
      .get() as { result_json: string };
    return JSON.parse(JSON.parse(row.result_json).content[0].text);
  };
  async function read(id: string) {
    reopened.send(id, "Read the saved report");
    await reopened.waitIdle(id);
    return lastCall();
  }
  const saved = await read(session.id);
  expect(lastList()).toEqual({
    artifacts: [
      { name: "comparison.md", ref, description: "Boot comparison", createdAt: artifact?.createdAt },
    ],
  });
  expect(saved.status).toBe("ok");
  expect(saved.result_json).toContain("2: Observed I2C timeout");
  expect(saved.result_json).toContain(artifact?.sha256);
  expect(saved.result_json).toContain("nextOffset");
  expect(saved.result_json).not.toContain("Evidence pending");
  expect(reopened.get(session.id).snapshot.items.at(-1)).toMatchObject({
    citations: [{ ref, valid: true }],
  });
  const other = reopened.create(null, "read-only");
  expect(await read(other.id)).toMatchObject({ status: "error" });
  expect(lastList()).toEqual({ artifacts: [] });
  await writeFile(join(root, ".vera/artifacts", session.id, "comparison.md"), "tampered");
  const changed = await read(session.id);
  expect(changed.status).toBe("error");
  expect(changed.result_json).not.toContain("tampered");
});

it("lists newest matching artifact metadata in pages and refuses a caller-supplied session", async () => {
  let time = Date.now();
  const { service, handle } = await setup(
    [
      save({ name: "boot_old.md", content: "old report" }),
      save({ name: "boot_new.md", content: "new report" }),
      save({ name: "boot-plan.md", content: "unrelated" }),
      { name: "artifact_list", args: { namePrefix: "boot_", limit: 1 } },
      { name: "artifact_list", args: { namePrefix: "boot_", limit: 1, offset: 1 } },
      { name: "artifact_list", args: { sessionId: "ses_other" } },
    ],
    { clock: { now: () => new Date(time++), sleep: async () => {} } },
  );
  const session = service.create(null, "read-only");
  service.send(session.id, "List my saved boot reports");
  expect(await service.waitIdle(session.id)).toEqual({ stopReason: "end" });
  const rows = handle.db
    .prepare("SELECT status,result_json FROM tool_calls WHERE name='artifact_list' ORDER BY rowid")
    .all() as { status: string; result_json: string }[];
  expect(rows.map(({ status }) => status)).toEqual(["ok", "ok", "error"]);
  const pages = rows
    .slice(0, 2)
    .map(({ result_json }) => JSON.parse(JSON.parse(result_json).content[0].text));
  expect(pages).toEqual([
    {
      artifacts: [
        {
          name: "boot_new.md",
          ref: "artifact:boot_new.md",
          description: null,
          createdAt: expect.any(String),
        },
      ],
      nextOffset: 1,
    },
    {
      artifacts: [
        {
          name: "boot_old.md",
          ref: "artifact:boot_old.md",
          description: null,
          createdAt: expect.any(String),
        },
      ],
    },
  ]);
});

it("saves the script output, metadata/event and valid/missing citations without approval in ask and read-only session modes", async () => {
  for (const mode of ["ask", "read-only"] as const) {
    const { service, root, handle, host } = await setup();
    const s = service.create(null, mode);
    service.send(s.id, "Save summary");
    expect(await service.waitIdle(s.id)).toEqual({ stopReason: "end" });
    expect(new core.ToolRegistry().available().find((t) => t.name === "artifact_save")?.class).toBe(
      "session",
    );
    const file = join(root, ".vera/artifacts", s.id, "summary.md");
    expect(await readFile(file, "utf8")).toBe("# Session summary\n\nBoard uses 3.3 V.\n");
    const rows = service.listArtifacts(s.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      artifactId: expect.stringMatching(/^art_[0-9A-HJKMNP-TV-Z]{26}$/),
      sessionId: s.id,
      name: "summary.md",
      mime: "text/markdown",
      bytes: 37,
      description: "Board summary",
    });
    expect(rows[0]?.sha256).toBe(
      createHash("sha256")
        .update(await readFile(file))
        .digest("hex"),
    );
    expect(service.get(s.id).snapshot.artifacts).toEqual([
      { artifactId: rows[0]?.artifactId, name: "summary.md", bytes: 37 },
    ]);
    expect(
      service
        .get(s.id)
        .snapshot.items.filter((i) => i.kind === "assistant")
        .at(-1),
    ).toMatchObject({
      citations: [
        { ref: "artifact:summary.md", valid: true },
        { ref: "artifact:missing.md", valid: false },
      ],
    });
    expect(handle.db.prepare("SELECT * FROM approvals").all()).toEqual([]);
    await service.close();
    const restarted = new core.SessionService(host);
    cleanup.push(() => restarted.close());
    await restarted.waitReady();
    expect(restarted.listArtifacts(s.id)).toEqual(rows);
    expect((await restarted.openArtifact(rows[0]?.artifactId ?? "")).content).toBe(
      await readFile(file, "utf8"),
    );
    await restarted.delete(s.id);
    await expect(readFile(file)).rejects.toMatchObject({ code: "ENOENT" });
    expect(handle.db.prepare("SELECT * FROM artifacts").all()).toEqual([]);
  }
});

it("explains rejected names, byte limits and duplicate artifact saves", { timeout: 15_000 }, async () => {
  // Not file names at all: empty, traversal, a drive, a device, or no letter or digit left.
  const bad = ["", ".", "..", "../summary.md", "a/../b.md", "C:evil", "CON", "NUL.txt", "报告.md"];
  const { service, handle } = await setup([
    ...bad.map((name) => save({ name, content: "bad" })),
    save({ name: "large.txt", content: "ă".repeat((5 * 1024 * 1024) / 2 + 1) }),
    save({ name: "summary.md", content: "one" }),
    save({ name: "summary.md", content: "two" }),
  ]);
  const s = service.create();
  service.send(s.id, "save");
  await service.waitIdle(s.id);
  const rows = handle.db.prepare("SELECT status,result_json FROM tool_calls ORDER BY rowid").all() as {
    status: string;
    result_json: string;
  }[];
  expect(rows).toHaveLength(bad.length + 3);
  for (const row of rows.slice(0, bad.length)) {
    expect(row.status).toBe("error");
    expect(row.result_json).toMatch(/name/i);
  }
  expect(rows[bad.length]?.result_json).toMatch(/5\s*(MB|MiB)/i);
  expect(rows[bad.length + 1]?.status).toBe("ok");
  expect(rows.at(-1)?.result_json).toMatch(/overwrite/i);
  expect(service.listArtifacts(s.id)).toHaveLength(1);
});

it("saves an unportable name under a portable one and says which", async () => {
  const names = [
    ["Test Plan.md", "Test-Plan.md"],
    ["raport-măsurători.md", "raport-masuratori.md"],
    ["reports/plan(v2).md", "reports-plan-v2.md"],
    ["Maß und Größe.txt", "Mass-und-Grosse.txt"],
    ["trailing.", "trailing"],
    [`${"long name ".repeat(12)}.md`, `${"long-name-".repeat(10).slice(0, 97)}.md`],
  ] as const;
  const { service, handle } = await setup([
    ...names.map(([name]) => save({ name, content: "body" })),
    save({ name: "plain.md", content: "body" }),
  ]);
  const s = service.create();
  service.send(s.id, "save");
  await service.waitIdle(s.id);
  const results = (
    handle.db.prepare("SELECT status,result_json FROM tool_calls ORDER BY rowid").all() as {
      status: string;
      result_json: string;
    }[]
  ).map((row) => ({ status: row.status, result: JSON.parse(JSON.parse(row.result_json).content[0].text) }));
  for (const [index, [, saved]] of names.entries())
    expect(results[index]).toEqual({
      status: "ok",
      result: { ref: `artifact:${saved}`, bytes: 4, savedAs: saved },
    });
  // A name that needs no change reports none.
  expect(results.at(-1)?.result).toEqual({ ref: "artifact:plain.md", bytes: 4 });
  expect(service.listArtifacts(s.id).map(({ name }) => name)).toEqual([
    ...names.map(([, saved]) => saved),
    "plain.md",
  ]);
});

it("treats a name that differs only in letter case as the artifact that exists", async () => {
  const { store, artifactHost: host, session } = await direct();
  const signal = new AbortController().signal;
  await store.save(host, { name: "Report.md", content: "one" }, signal);
  // The refusal names the artifact, so the next call can replace it instead of meeting a second refusal.
  await expect(store.save(host, { name: "report.md", content: "two" }, signal)).rejects.toThrow(
    "Artifact Report.md already exists. Set overwrite:true to replace it.",
  );
  expect(await store.save(host, { name: "REPORT.MD", content: "two", overwrite: true }, signal)).toEqual({
    ref: "artifact:Report.md",
    bytes: 3,
  });
  expect(store.list(session.id).map(({ name }) => name)).toEqual(["Report.md"]);
  expect((await store.openNamed(session.id, "Report.md")).content).toBe("two");
});

it("accepts saving what is already stored without overwrite and still guards a different content", async () => {
  const { store, artifactHost: host, session, path } = await direct();
  const signal = new AbortController().signal;
  const first = await store.save(host, { name: "summary.md", content: "same", description: "d" }, signal);
  const before = (await stat(path)).mtimeMs;
  expect(await store.save(host, { name: "summary.md", content: "same", description: "d" }, signal)).toEqual(
    first,
  );
  expect((await stat(path)).mtimeMs).toBe(before);
  await expect(store.save(host, { name: "summary.md", content: "other" }, signal)).rejects.toThrow(
    /overwrite:true/,
  );
  await expect(
    store.save(host, { name: "summary.md", content: "same", description: "changed" }, signal),
  ).rejects.toThrow(/overwrite:true/);
  expect(store.list(session.id)).toHaveLength(1);
});

it("saves the full artifact with a shortened Unicode description and preserves descriptions at the limit", async () => {
  const description = "🙂".repeat(1024);
  const content = "# Résumé\n===\nRezultat integral.\n";
  const { service } = await setup([
    save({ name: "summary.md", content, description: `${description} extra` }),
    save({ name: "exact.md", content, description }),
  ]);
  const session = service.create();
  service.send(session.id, "save");
  await service.waitIdle(session.id);
  const rows = service.listArtifacts(session.id);
  expect(rows).toHaveLength(2);
  const shortened = rows.find((row) => row.name === "summary.md")!;
  expect(shortened.description).toBe(`${"🙂".repeat(1023)}…`);
  expect((await service.openArtifact(shortened.artifactId)).content).toBe(content);
  expect(rows.find((row) => row.name === "exact.md")?.description).toBe(description);
});

it("overwrites sequentially with stable identity, updated metadata and immutable session isolation", async () => {
  const { service, handle } = await setup([
    save({ name: "summary.md", content: "old" }),
    save({ name: "summary.md", content: "ă new", overwrite: true, description: "updated" }),
  ]);
  const a = service.create(),
    b = service.create();
  service.send(a.id, "save");
  service.send(b.id, "save");
  await Promise.all([service.waitIdle(a.id), service.waitIdle(b.id)]);
  const rows = service.listArtifacts(a.id);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ description: "updated", bytes: 6 });
  expect((await service.openArtifact(rows[0]?.artifactId ?? "")).content).toBe("ă new");
  const events = service.get(a.id).snapshot.artifacts;
  expect(events).toHaveLength(2);
  expect(events[0]?.artifactId).toBe(events[1]?.artifactId);
  expect(service.listArtifacts(b.id)[0]?.artifactId).not.toBe(rows[0]?.artifactId);
  expect(handle.db.prepare("SELECT * FROM artifacts").all()).toHaveLength(2);
  expect(() => service.listArtifacts("bad")).toThrow(expect.objectContaining({ code: "INVALID" }));
  await expect(service.openArtifact("art_00000000000000000000000000")).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
});

it("refuses redirected managed ancestors and workbench read-only mutation", async () => {
  const { service, root, handle, host } = await setup([save({ name: "summary.md", content: "new" })]);
  const external = await mkdtemp(join(tmpdir(), "vera-artifact-external-"));
  cleanup.push(() => rm(external, { recursive: true, force: true }));
  await symlink(external, join(root, ".vera/artifacts"), "junction");
  const s = service.create();
  service.send(s.id, "save");
  await service.waitIdle(s.id);
  expect(handle.db.prepare("SELECT status FROM tool_calls").get()).toEqual({ status: "error" });
  await expect(readFile(join(external, s.id, "summary.md"))).rejects.toMatchObject({ code: "ENOENT" });
  await expect(service.delete(s.id)).rejects.toMatchObject({ code: "DENIED" });
  await service.close();
  const ro = new core.SessionService({ ...host, readOnly: true });
  cleanup.push(() => ro.close());
  await expect(ro.delete(s.id)).rejects.toMatchObject({ code: "DENIED" });
});

async function direct() {
  const env = await setup([]);
  const session = env.service.create();
  const store = new core.ArtifactStore(env.root, env.handle.db);
  const host: core.ArtifactHost = {
    store,
    sessionId: session.id,
    queue: new core.WriteQueue(),
    now: () => new Date().toISOString(),
    assertWritable: () => {},
    record: () => () => {},
  };
  return {
    ...env,
    session,
    store,
    artifactHost: host,
    path: join(env.root, ".vera/artifacts", session.id, "summary.md"),
  };
}
it("keeps the file and metadata on an identical masked overwrite, and repairs changed bytes", async () => {
  const { store, artifactHost: host, path, session } = await direct();
  const signal = new AbortController().signal;
  let events = 0;
  host.record = () => () => {
    events++;
  };
  host.scrubContent = (text) => text.replaceAll(/fixture-secret-[ab]/g, "[REDACTED]");
  host.now = () => new Date((events + 1) * 1000).toISOString();
  const args = { name: "summary.md", content: "fixture-secret-a", description: "Note fixture-secret-a" };
  const first = await store.save(host, args, signal);
  const original = store.list(session.id);
  const before = await stat(path, { bigint: true });
  const retry = {
    ...args,
    content: "fixture-secret-b",
    description: "Note fixture-secret-b",
    overwrite: true,
  };
  expect(await store.save(host, retry, signal)).toEqual(first);
  const after = await stat(path, { bigint: true });
  expect(after.ino).toBe(before.ino);
  expect(after.mtimeNs).toBe(before.mtimeNs);
  expect(store.list(session.id)).toEqual(original);
  expect(events).toBe(1);

  await writeFile(path, "content changed outside the store");
  await store.save(host, retry, signal);
  expect(await readFile(path, "utf8")).toBe("[REDACTED]");
  expect(events).toBe(2);
  await store.save(host, { ...retry, description: "New note" }, signal);
  expect(store.list(session.id)[0]?.description).toBe("New note");
  expect(events).toBe(3);
});

it("masks a description before shortening it and skips overwrites that only change its discarded tail", async () => {
  const { store, artifactHost: host, path, session } = await direct();
  const signal = new AbortController().signal;
  let events = 0;
  host.record = () => () => {
    events++;
  };
  host.scrubContent = (text) => text.replaceAll("private-token", "[REDACTED]");
  const prefix = "x".repeat(1013);
  const args = { name: "summary.md", content: "x", description: `${prefix}private-token first tail` };
  const first = await store.save(host, args, signal);
  const original = store.list(session.id);
  expect(original[0]?.description).toBe(`${prefix}[REDACTED]…`);
  const before = await stat(path, { bigint: true });
  const retry = { ...args, description: `${prefix}private-token second tail`, overwrite: true };
  expect(await store.save(host, retry, signal)).toEqual(first);
  expect(store.list(session.id)).toEqual(original);
  expect((await stat(path, { bigint: true })).mtimeNs).toBe(before.mtimeNs);
  expect(events).toBe(1);
});

it("rolls back a cancelled rename before a concurrent read can observe the new version", async () => {
  const { store, artifactHost: host, path, session } = await direct();
  const controller = new AbortController();
  const name = "summary.md";
  await store.save(host, { name, content: "old" }, controller.signal);
  const original = store.list(session.id)[0]!;
  let reading: ReturnType<typeof store.verified> | undefined;
  let checks = 0;
  host.assertWritable = () => {
    if (++checks === 2) {
      reading = store.verified(original.artifactId);
      queueMicrotask(() => controller.abort());
    }
  };
  await expect(
    store.save(host, { name, content: "new", overwrite: true }, controller.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
  await expect(reading).resolves.toMatchObject({ artifact: { content: "old" } });
  expect(store.list(session.id)).toEqual([original]);
  expect(await readdir(join(path, ".."))).toEqual([name]);
});

it("rejects a newly masked projection during asynchronous publication", async () => {
  const { store, artifactHost: host, root, session } = await direct();
  let masked = false;
  let checks = 0;
  host.scrubContent = (text) => (masked ? text.replaceAll("fixture-secret", "[REDACTED]") : text);
  host.assertWritable = () => {
    if (++checks === 2) masked = true;
  };
  await expect(
    store.save(host, { name: "summary.md", content: "fixture-secret" }, new AbortController().signal),
  ).rejects.toBeInstanceOf(core.ArtifactMaskingConflict);
  expect(store.list(session.id)).toEqual([]);
  expect(await readdir(join(root, ".vera/artifacts", session.id))).toEqual([]);
});

it("accepts empty/exact5MiB UTF8 content, refuses overlimit and restores bytes after metadata failure", async () => {
  const { store, artifactHost: host, handle, path, session } = await direct();
  const signal = new AbortController().signal;
  expect(await store.save(host, { name: "summary.md", content: "" }, signal)).toEqual({
    ref: "artifact:summary.md",
    bytes: 0,
  });
  const content = "ă".repeat((5 * 1024 * 1024) / 2);
  expect(await store.save(host, { name: "summary.md", content, overwrite: true }, signal)).toMatchObject({
    bytes: 5 * 1024 * 1024,
  });
  await expect(store.save(host, { name: "large.txt", content: `${content}x` }, signal)).rejects.toThrow(
    /5 MiB/,
  );
  const original = store.list(session.id);
  handle.db.exec(
    "CREATE TRIGGER refuse_artifact_update BEFORE UPDATE ON artifacts BEGIN SELECT RAISE(ABORT,'fixture metadata failure'); END;",
  );
  await expect(
    store.save(host, { name: "summary.md", content: "new", overwrite: true }, signal),
  ).rejects.toThrow(/fixture metadata failure/);
  expect(await readFile(path, "utf8")).toBe(content);
  expect(store.list(session.id)).toEqual(original);
  expect(await readdir(join(path, ".."))).toEqual(["summary.md"]);
});
it("rejects pending abort/ownership loss/disabled tools/credential names and leaves no artifact rows", async () => {
  const { store, artifactHost: host, handle, root, session } = await direct();
  const signal = new AbortController().signal;
  const abort = new AbortController();
  abort.abort();
  await expect(store.save(host, { name: "summary.md", content: "x" }, abort.signal)).rejects.toThrow();
  let checks = 0;
  host.assertWritable = () => {
    if (++checks === 2) throw Error("ownership lost");
  };
  await expect(store.save(host, { name: "summary.md", content: "x" }, signal)).rejects.toThrow(
    /ownership lost/,
  );
  host.assertWritable = () => {};
  host.scrub = (s) => s.replaceAll("credential", "[redacted]");
  await expect(store.save(host, { name: "credential.md", content: "safe" }, signal)).rejects.toThrow(
    /credential/,
  );
  const context = core.createToolContext(root);
  context.artifacts = host;
  expect(
    await new core.ToolRegistry().execute(
      context,
      "artifact_save",
      { name: "summary.md", content: "safe" },
      signal,
      ["artifact_save"],
    ),
  ).toMatchObject({ isError: true });
  expect(handle.db.prepare("SELECT * FROM artifacts").all()).toEqual([]);
  expect(await readdir(join(root, ".vera/artifacts", session.id))).toEqual([]);
});
it("refuses file links/hash mismatch and fabricated or foreign artifact citations", async () => {
  const { store, artifactHost: host, path, session, root, service } = await direct();
  const signal = new AbortController().signal;
  await store.save(host, { name: "summary.md", content: "safe" }, signal);
  const a = store.list(session.id)[0];
  if (!a) throw Error("artifact missing");
  const tool = core.toolResult(
    { type: "toolCall", id: "call", name: "artifact_save", arguments: {} },
    JSON.stringify({ ref: "artifact:summary.md" }),
    false,
    0,
  );
  const check = (messages: (typeof tool)[], owner = session.id) =>
    core.validateCitations(root, "[[artifact:summary.md]]", messages, (name) => store.exists(owner, name));
  expect(await check([tool])).toEqual([{ ref: "artifact:summary.md", valid: true }]);
  expect(await check([])).toEqual([{ ref: "artifact:summary.md", valid: false }]);
  expect(await check([tool], service.create().id)).toEqual([{ ref: "artifact:summary.md", valid: false }]);
  await writeFile(path, "changed");
  expect(await check([tool])).toEqual([{ ref: "artifact:summary.md", valid: false }]);
  await expect(store.verified(a.artifactId)).rejects.toMatchObject({ code: "CONFLICT" });
  const external = join(root, "external.txt");
  await writeFile(external, "safe");
  await rm(path);
  await link(external, path);
  await expect(store.verified(a.artifactId)).rejects.toMatchObject({ code: "DENIED" });
  expect(await readFile(external, "utf8")).toBe("safe");
});
it.skipIf(process.platform === "win32")("refuses native POSIX artifact file symlinks", async () => {
  const { store, artifactHost: host, path, root, session } = await direct();
  await store.save(host, { name: "summary.md", content: "safe" }, new AbortController().signal);
  const a = store.list(session.id)[0];
  if (!a) throw Error("artifact missing");
  const external = join(root, "external.txt");
  await writeFile(external, "safe");
  await rm(path);
  await symlink(external, path, "file");
  await expect(store.verified(a.artifactId)).rejects.toMatchObject({ code: "DENIED" });
});
it("preserves the completed rename and refuses compensation after ownership is lost", async () => {
  const { store, artifactHost: host, path, session } = await direct();
  const signal = new AbortController().signal;
  await store.save(host, { name: "summary.md", content: "old" }, signal);
  const original = store.list(session.id);
  let checks = 0;
  host.assertWritable = () => {
    if (++checks >= 3) throw Error("ownership lost");
  };
  await expect(
    store.save(host, { name: "summary.md", content: "new", overwrite: true }, signal),
  ).rejects.toThrow(/ownership lost/);
  expect(await readFile(path, "utf8")).toBe("new");
  expect(store.list(session.id)).toEqual(original);
  await expect(store.verified(original[0]?.artifactId ?? "")).rejects.toMatchObject({ code: "CONFLICT" });
});

it("artifact fixture preserves automatic pathological and normal grep selection", async () => {
  const gateway = new ReplayGateway({ dir: resolve("tests/fixtures/llm-scripts"), now: () => 0 });
  for (const [prompt, scenario, tool] of [
    ["Pathological grep", "ui-grep-bad", "grep"],
    ["Normal grep", "ui-grep-good", "grep"],
    ["Save summary", "save-artifact", "artifact_save"],
  ]) {
    const events = [];
    for await (const event of gateway.stream({
      model: "replay/auto",
      system: "Test",
      tools: [],
      signal: new AbortController().signal,
      messages: [{ role: "user", content: prompt ?? "", timestamp: 0 }],
    }))
      events.push(event);
    const done = events.find((e) => e.type === "done");
    expect(done?.type === "done" ? done.message.model : null).toBe(scenario);
    expect(
      done?.type === "done" ? done.message.content.find((c) => c.type === "toolCall") : null,
    ).toMatchObject({ name: tool });
  }
});

it("resolves artifact content masking inside the write queue after a live change", async () => {
  const { store, artifactHost: host, path } = await direct();
  let mask = false,
    release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pending = host.queue.run(() => held);
  host.scrub = (text) => text.replaceAll("fixture-private-283", "[REDACTED]");
  host.scrubContent = (text) => (mask ? (host.scrub?.(text) ?? text) : text);
  const save = store.save(
    host,
    { name: "summary.md", content: "fixture-private-283" },
    new AbortController().signal,
  );
  mask = true;
  release();
  await pending;
  expect(await save).toMatchObject({ bytes: 10 });
  expect(await readFile(path, "utf8")).toBe("[REDACTED]");
});
