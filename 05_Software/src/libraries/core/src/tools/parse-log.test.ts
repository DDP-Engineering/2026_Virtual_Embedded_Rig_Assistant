import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createToolContext, NodeWorkerPool, ToolRegistry } from "../index.js";
import { workerFixture } from "../workers/worker.test-support.js";

let root: string;
let pool: NodeWorkerPool;
let bundle: ReturnType<typeof workerFixture>;
const signal = () => new AbortController().signal;
const registry = new ToolRegistry();
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "vera-parse-log-"));
  bundle = workerFixture();
  pool = new NodeWorkerPool(bundle.url, { deadlineMs: 3000, capacity: 1 });
});
afterEach(async () => {
  await pool.dispose();
  bundle.close();
  await rm(root, { recursive: true, force: true });
});
async function call(args: unknown, disabled: string[] = []) {
  const outcome = await registry.execute(
    createToolContext(root, pool),
    "parse_log",
    args,
    signal(),
    disabled,
  );
  return { ...outcome, value: JSON.parse(outcome.text) };
}
async function log(text: string | Uint8Array) {
  await writeFile(join(root, "log.txt"), text);
}
it("validates defaults, exclusive selectors and strict argument boundaries", async () => {
  const schema = registry.available().find((tool) => tool.name === "parse_log")?.params;
  expect(schema).toBeDefined();
  expect(schema?.parse({ path: "log.txt", profile: "iso" })).toMatchObject({ fromLine: 1, maxEvents: 50 });
  for (const args of [
    {},
    { path: "x" },
    { path: "x", profile: "iso", pattern: "x" },
    { path: "x".repeat(257), profile: "iso" },
    { path: "x", pattern: "x".repeat(513) },
    { path: "x", profile: "iso", fromLine: 0 },
    { path: "x", profile: "iso", maxEvents: 201 },
    { path: "x", profile: "iso", levels: ["fatal"] },
    { path: "x", profile: "iso", contains: "x".repeat(201) },
    { path: "x", profile: "iso", extra: true },
    { path: "x", profile: "iso", expectedSha256: "bad" },
  ])
    expect((await call(args)).value).toMatchObject({
      isError: true,
      code: "INVALID",
      reason: "invalid_arguments",
    });
});
it("counts baseline and candidate fixture logs with exact cited WARN and ERROR", async () => {
  await cp(
    new URL("../../../../../tests/fixtures/workbenches/demo-board/logs/", import.meta.url),
    join(root, "logs"),
    { recursive: true },
  );
  const baseline = await call({ path: "logs/boot-0412.log", profile: "iso" });
  expect(baseline.isError).toBe(false);
  expect(baseline.value).toMatchObject({
    counts: { info: 3, warn: 1, error: 0 },
    scan: { complete: true, stopReason: "eof", lines: 4 },
    source: { ref: "logs/boot-0412.log#L1-L4" },
  });
  expect(baseline.value.events[2]).toMatchObject({ level: "warn", ref: "logs/boot-0412.log#L3-L3" });
  const candidate = await call({ path: "logs/boot-0413.log", profile: "iso" });
  expect(candidate.value.counts.error).toBe(1);
  expect(candidate.value.events.at(-1)).toMatchObject({
    level: "error",
    message: "i2c initialization failed",
    ref: "logs/boot-0413.log#L4-L4",
  });
});
it("parses ANSI, ESP-IDF timestamps, Zephyr and custom normalized levels", async () => {
  await log(
    "\x1b[0;32mI (1234) wifi: connected\x1b[0m\nW (12:34:56.789) i2c: delayed\nE (44) i2c: failed\nV (45) x: trace\nD (46) x: debug\nBacktrace: panic\n\n",
  );
  const esp = (await call({ path: "log.txt", profile: "esp-idf" })).value;
  expect(esp.counts).toEqual({
    info: 1,
    warn: 1,
    error: 1,
    debug: 1,
    verbose: 1,
    other: 0,
    unparsed: 1,
    blank: 1,
  });
  expect(esp.events[0]).toMatchObject({ time: "1234", source: "wifi", message: "connected" });
  expect(esp.events[1].time).toBe("12:34:56.789");
  await log("[00:00:01.234,567] <inf> net: ready\n[00:00:02.000,000] <err> net: failed");
  expect((await call({ path: "log.txt", profile: "zephyr" })).value.events).toMatchObject([
    { level: "info", source: "net" },
    { level: "error" },
  ]);
  await log("F fatal\nwarning delayed\nTRACE trace\nunknown data\nI info\nD debug\nV verbose\n");
  expect((await call({ path: "log.txt", pattern: "^(?<level>\\w+) (?<message>.*)$" })).value.counts).toEqual({
    error: 1,
    warn: 1,
    verbose: 2,
    info: 1,
    debug: 1,
    other: 1,
    unparsed: 0,
    blank: 0,
  });
});
it("filters only events, counts every line and counts omitted eligible previews", async () => {
  await log(
    "2026-04-12T08:00:00Z INFO ready\n2026-04-12T08:00:00Z ERROR bus failed\n2026-04-12T08:00:00Z ERROR BUS failed\n2026-04-12T08:00:00Z WARN delay\nstack\n\n",
  );
  const value = (
    await call({
      path: "log.txt",
      profile: "iso",
      levels: ["error"],
      contains: "bus",
      fromLine: 2,
      maxEvents: 1,
    })
  ).value;
  expect(value.counts).toEqual({
    error: 2,
    warn: 1,
    info: 1,
    debug: 0,
    verbose: 0,
    other: 0,
    unparsed: 1,
    blank: 1,
  });
  expect(value.events).toHaveLength(1);
  expect(value.preview).toEqual({ truncated: true, omitted: 1 });
  expect(value.scan.complete).toBe(true);
});
it("keeps exact byte hashes across LF CRLF BOM and handles empty source", async () => {
  let events: unknown;
  for (const bytes of [
    "2026-04-12T08:00:00Z INFO ready\n2026-04-12T08:00:00Z WARN delay\n",
    "2026-04-12T08:00:00Z INFO ready\r\n2026-04-12T08:00:00Z WARN delay\r\n",
    "\ufeff2026-04-12T08:00:00Z INFO ready\r\n2026-04-12T08:00:00Z WARN delay\r\n",
  ]) {
    await log(bytes);
    const value = (await call({ path: "log.txt", profile: "iso" })).value;
    expect(value.source.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(value.scan).toMatchObject({ lines: 2, bytes: Buffer.byteLength(bytes), complete: true });
    if (events) expect(value.events).toEqual(events);
    events = value.events;
  }
  for (const bytes of ["", "\ufeff"]) {
    await log(bytes);
    expect((await call({ path: "log.txt", profile: "iso" })).value).toMatchObject({
      source: { ref: null, sha256: createHash("sha256").update(bytes).digest("hex") },
      scan: { lines: 0, bytes: Buffer.byteLength(bytes) },
      counts: { blank: 0 },
    });
  }
});
it("bounds escaped previews and samples without corrupting counts", async () => {
  await log(
    `${Array.from({ length: 200 }, () => `2026-04-12T08:00:00Z INFO ${'"\\'.repeat(150)}`).join("\n")}\n${"unparsed".repeat(50)}\n${"bad\n".repeat(9)}`,
  );
  const result = await call({ path: "log.txt", profile: "iso", maxEvents: 200 });
  expect(result.isError).toBe(false);
  expect(result.text.length).toBeLessThanOrEqual(32000);
  expect(result.value.counts.info).toBe(200);
  expect(result.value.preview.omitted).toBe(200 - result.value.events.length);
  expect(result.value.preview.truncated).toBe(true);
  expect(result.value.unparsedSamples).toHaveLength(5);
  expect(result.value.unparsedSamples[0].text).toHaveLength(256);
  expect(result.value.events.every((e: { message: string }) => e.message.length <= 256)).toBe(true);
});
it("refuses invalid UTF8, byte/line limits, regex syntax/groups and stale hashes", async () => {
  for (const [bytes, reason] of [
    [Buffer.from([0xff]), "invalid_utf8"],
    ["a".repeat(16385), "line_too_large"],
    ["é".repeat(8193), "line_too_large"],
  ] as const) {
    await log(bytes);
    expect((await call({ path: "log.txt", profile: "iso" })).value).toMatchObject({
      isError: true,
      code: "INVALID",
      reason,
    });
  }
  await log("é".repeat(8192));
  expect((await call({ path: "log.txt", profile: "iso" })).value).toMatchObject({
    scan: { complete: true, lines: 1, bytes: 16384 },
    counts: { unparsed: 1 },
  });
  await log(`\ufeff${"é".repeat(8192)}`);
  expect((await call({ path: "log.txt", profile: "iso" })).value).toMatchObject({
    scan: { complete: true, lines: 1, bytes: 16387 },
  });
  const handle = await open(join(root, "large.log"), "w");
  await handle.truncate(50 * 1024 * 1024 + 1);
  await handle.close();
  expect((await call({ path: "large.log", profile: "iso" })).value).toMatchObject({
    code: "INVALID",
    reason: "file_too_large",
  });
  await log("2026-04-12T08:00:00Z INFO data");
  for (const pattern of ["[", "(?<message>.*)", "(?<level>.*)"])
    expect((await call({ path: "log.txt", pattern })).value).toMatchObject({
      code: "INVALID",
      reason: "invalid_pattern",
    });
  expect(
    (await call({ path: "log.txt", profile: "iso", expectedSha256: "0".repeat(64) })).value,
  ).toMatchObject({ code: "CONFLICT", reason: "source_changed" });
});
it("refuses a stale expected hash before a pathological regex can return source events", async () => {
  const bytes = `${"I ok\n".repeat(1000)}I ${"a".repeat(12000)}!`;
  await log(bytes);
  const value = (
    await call({
      path: "log.txt",
      pattern: "^(?<level>I) (?<message>ok|(a+)+)$",
      expectedSha256: "0".repeat(64),
    })
  ).value;
  expect(value).toMatchObject({ isError: true, code: "CONFLICT", reason: "source_changed" });
  expect(value.events).toBeUndefined();
  await log("I ok\n");
  expect(
    (
      await call({
        path: "log.txt",
        profile: "esp-idf",
        expectedSha256: createHash("sha256").update("I ok\n").digest("hex").toUpperCase(),
      })
    ).value.scan.complete,
  ).toBe(true);
});
it("refuses traversal, ignore, metadata, absent files and disabled execution even in Bypass", async () => {
  await mkdir(join(root, ".vera"));
  await writeFile(join(root, ".vera/.veraignore"), "hidden.log\n");
  await log("2026-04-12T08:00:00Z INFO data");
  await writeFile(join(root, "hidden.log"), "secret");
  for (const path of ["../outside.log", ".vera/.veraignore", "hidden.log"]) {
    const ctx = createToolContext(root, pool);
    ctx.permissionMode = () => "bypass";
    expect(
      JSON.parse((await registry.execute(ctx, "parse_log", { path, profile: "iso" }, signal())).text),
    ).toMatchObject({ code: "DENIED", reason: "path_denied" });
  }
  expect((await call({ path: "absent.log", profile: "iso" })).value).toMatchObject({
    code: "NOT_FOUND",
    reason: "not_found",
  });
  expect((await call({ path: "log.txt", profile: "iso" }, ["parse_log"])).value).toMatchObject({
    code: "DENIED",
    reason: "tool_disabled",
  });
});

it("refuses a source changed while its checkpointed scan is in progress", async () => {
  await log("2026-04-12T08:00:00Z INFO ready\n".repeat(100000));
  let mutation: Promise<void> | undefined;
  const outcome = await pool.run(
    { kind: "parse_log", root, args: { path: "log.txt", profile: "iso" } },
    signal(),
    () => {
      mutation ??= (async () => {
        const handle = await open(join(root, "log.txt"), "r+");
        try {
          await handle.write(Buffer.from("X"), 0, 1, 1);
        } finally {
          await handle.close();
        }
      })();
    },
  );
  await mutation;
  expect(mutation).toBeDefined();
  expect(outcome.failure).toMatchObject({ code: "CONFLICT", reason: "source_changed" });
}, 20000);

it("terminates catastrophic regex with a last checkpoint, remains responsive and replaces capacity", async () => {
  await pool.dispose();
  pool = new NodeWorkerPool(bundle.url, { deadlineMs: 1500, capacity: 1 });
  await log(`${"I ok\n".repeat(1000)}I ${"a".repeat(12000)}!`);
  let ticks = 0;
  const timer = setInterval(() => {
    ticks++;
  }, 20);
  try {
    const started = performance.now();
    const value = (await call({ path: "log.txt", pattern: "^(?<level>I) (?<message>ok|(a+)+)$" })).value;
    expect(performance.now() - started).toBeLessThan(4000);
    expect(ticks).toBeGreaterThan(10);
    expect(value).toMatchObject({
      source: { sha256: null, ref: "log.txt#L1-L1000" },
      scan: { complete: false, stopReason: "timeout", lines: 1000, bytes: 5000 },
      counts: { info: 1000 },
      preview: { omitted: 950 },
    });
    expect(pool.activeCount).toBe(0);
    await log("2026-04-12T08:00:00Z INFO recovered");
    expect((await call({ path: "log.txt", profile: "iso" })).value.scan.complete).toBe(true);
    expect(
      (await pool.run({ kind: "grep", root, args: { pattern: "recovered", glob: "*.txt" } }, signal()))
        .matches,
    ).toHaveLength(1);
  } finally {
    clearInterval(timer);
  }
}, 20000);

it("aborts active and queued log work, includes queue time in deadlines and disposes capacity", async () => {
  await pool.dispose();
  pool = new NodeWorkerPool(bundle.url, { deadlineMs: 2000, capacity: 1 });
  await log(`I ${"a".repeat(12000)}!`);
  const args = { path: "log.txt", pattern: "^(?<level>I) (?<message>(a+)+)$" };
  const controller = new AbortController();
  let ready!: () => void;
  const checkpoint = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const active = pool.run({ kind: "parse_log", root, args }, controller.signal, ready);
  await checkpoint;
  const queuedController = new AbortController();
  const queued = pool.run({ kind: "parse_log", root, args }, queuedController.signal);
  queuedController.abort();
  expect(await queued).toMatchObject({ reason: "aborted" });
  controller.abort();
  expect(await active).toMatchObject({ reason: "aborted" });
  expect(pool.activeCount).toBe(0);
  const busy = pool.run({ kind: "parse_log", root, args }, signal());
  const start = performance.now();
  const deadline = pool.run({ kind: "parse_log", root, args }, signal());
  expect(await deadline).toMatchObject({ reason: "timeout" });
  expect(performance.now() - start).toBeLessThan(3500);
  expect(await busy).toMatchObject({ reason: "timeout" });
  const closing = pool.run({ kind: "parse_log", root, args }, signal());
  await pool.dispose();
  expect(await closing).toMatchObject({ reason: "aborted" });
}, 20000);
