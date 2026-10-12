// REQ-FUNC-bf809842 REQ-DATA-e3d4d5ba REQ-FUNC-997412a4 REQ-FUNC-b3d37df6 REQ-SEC-86010eb5
import { createHash } from "node:crypto";
import { link, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
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
    : await readFile(resolve("fixtures/llm-scripts/save-artifact.jsonl"), "utf8");
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

it("returns actionable tool errors for invalid names, UTF8 bytes over5MiB and duplicate names", async () => {
  const bad = [
    "",
    ".",
    "..",
    "../summary.md",
    "a/b",
    "a\\b",
    "C:evil",
    "CON",
    "NUL.txt",
    "trailing.",
    "ă.md",
    "a".repeat(101),
  ];
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
    /5MiB/,
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
it("rejects pending abort/ownership loss/disabled tools/credential saves and leaves no artifact rows", async () => {
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
  await expect(store.save(host, { name: "summary.md", content: "credential" }, signal)).rejects.toThrow(
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
  expect(() => store.verified(a.artifactId)).toThrow(expect.objectContaining({ code: "CONFLICT" }));
  const external = join(root, "external.txt");
  await writeFile(external, "safe");
  await rm(path);
  await link(external, path);
  expect(() => store.verified(a.artifactId)).toThrow(expect.objectContaining({ code: "DENIED" }));
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
  expect(() => store.verified(a.artifactId)).toThrow(expect.objectContaining({ code: "DENIED" }));
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
  expect(() => store.verified(original[0]?.artifactId ?? "")).toThrow(
    expect.objectContaining({ code: "CONFLICT" }),
  );
});

it("artifact fixture preserves automatic pathological and normal grep selection", async () => {
  const gateway = new ReplayGateway({ dir: resolve("fixtures/llm-scripts"), now: () => 0 });
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
