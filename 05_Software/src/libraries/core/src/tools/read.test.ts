import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as api from "../index.js";
import { readGuardedFile } from "./files.js";
import { readWindow } from "./read-window.js";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "vera-read-"));
  await mkdir(join(root, "docs"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
function context() {
  expect(api.createToolContext).toBeTypeOf("function");
  return api.createToolContext(root);
}
it("refuses redirected program logs and adjacent runtime data", async () => {
  await mkdir(join(root, ".vera"));
  await symlink(join(root, "docs"), join(root, ".vera/runs"), "junction");
  await writeFile(join(root, "docs/build.log"), "log\n");
  await writeFile(join(root, "docs/runtime.txt"), "runtime\n");
  for (const path of [".vera/runs/build.log", ".vera/runs/runtime.txt"])
    await expect(api.readTool.execute(context(), { path }, new AbortController().signal)).rejects.toThrow();
});
it("refuses a changed source before replaying a legacy text window", async () => {
  const path = "docs/encoding.txt";
  const file = join(root, path);
  await writeFile(file, Buffer.from("Legacy voltage 5µV\n", "latin1"));
  const guard = await api.PathGuard.create(root);
  const resolve = guard.resolve.bind(guard);
  const resolvePath = vi.spyOn(guard, "resolve").mockImplementationOnce(resolve);
  resolvePath.mockImplementationOnce(async (name) => {
    await writeFile(file, "Replacement UTF-8 3.3µV\n");
    return resolve(name);
  });
  await expect(readWindow(guard, path, 1, 1, new AbortController().signal)).rejects.toThrow(/changed/i);
});
it("reads numbered offset/limit lines with canonical refs and independent session fingerprints", async () => {
  const data = "one\r\nBanc ă\r\nthree\r\n";
  await writeFile(join(root, "docs/notes.md"), data);
  const first = context();
  const second = context();
  const result = await api.readTool.execute(
    first,
    { path: "docs/notes.md", offset: 2, limit: 1 },
    new AbortController().signal,
  );
  expect(result).toMatchObject({
    text: "2: Banc ă",
    totalLines: 3,
    truncated: true,
    ref: "docs/notes.md#L2-L2",
  });
  const guarded = await (await api.PathGuard.create(root)).resolve("docs/notes.md");
  expect(first.lastReads.get(guarded.key)).toEqual({
    sha256: createHash("sha256").update(data).digest("hex"),
    mtimeMs: (await stat(guarded.absolute)).mtimeMs,
  });
  expect(second.lastReads.size).toBe(0);
  await writeFile(guarded.absolute, "changed");
  await api.readTool.execute(second, { path: "docs/notes.md" }, new AbortController().signal);
  expect(first.lastReads.get(guarded.key)?.sha256).not.toBe(second.lastReads.get(guarded.key)?.sha256);
});
// REQ-FUNC-150dcb0b REQ-FUNC-f041ba07
it("reads up to the session's Read window lines and Read output size", async () => {
  const limits: Record<string, number> = { readLines: 3000, readChars: 120000 };
  const ctx = { ...context(), advanced: ((key: string) => limits[key]) as never };
  await writeFile(join(root, "many.txt"), Array.from({ length: 5000 }, (_, i) => `l${i}`).join("\n"));
  const lines = async (limit?: number) => {
    const result = await api.readTool.execute(
      ctx,
      { path: "many.txt", ...(limit ? { limit } : {}) },
      new AbortController().signal,
    );
    return String(result.text).split("\n").length;
  };
  expect(await lines()).toBe(3000);
  expect(await lines(4000)).toBe(3000);
  expect(await lines(100)).toBe(100);
  expect(
    (await api.readTool.execute(ctx, { path: "many.txt" }, new AbortController().signal)).truncated,
  ).toBe(true);
  expect(api.readTool.params.safeParse({ path: "many.txt", limit: 10000 }).success).toBe(true);
  limits.readChars = 10000;
  await writeFile(join(root, "wide.txt"), "y".repeat(20000));
  const wide = await api.readTool.execute(ctx, { path: "wide.txt" }, new AbortController().signal);
  expect(String(wide.text).length).toBeLessThanOrEqual(10000);
  expect(wide.truncated).toBe(true);
  limits.readChars = 60000;
  const whole = await api.readTool.execute(ctx, { path: "wide.txt" }, new AbortController().signal);
  expect(String(whole.text)).toBe(`1: ${"y".repeat(20000)}`);
});
it("handles empty files, offset beyond end, line limit and byte ceiling", async () => {
  const ctx = context();
  await writeFile(join(root, "empty.txt"), "");
  expect(await api.readTool.execute(ctx, { path: "empty.txt" }, new AbortController().signal)).toMatchObject({
    text: "",
    totalLines: 0,
    truncated: false,
  });
  await writeFile(join(root, "lines.txt"), Array.from({ length: 2100 }, (_, i) => `line${i}`).join("\n"));
  expect(await api.readTool.execute(ctx, { path: "lines.txt" }, new AbortController().signal)).toMatchObject({
    totalLines: 2100,
    truncated: true,
  });
  expect(
    await api.readTool.execute(ctx, { path: "lines.txt", offset: 3000 }, new AbortController().signal),
  ).toMatchObject({ text: "", totalLines: 2100 });
  const data = `${"x".repeat(270000)}\nlast line\n`;
  await writeFile(join(root, "large.txt"), data);
  expect(
    await api.readTool.execute(ctx, { path: "large.txt", offset: 2, limit: 1 }, new AbortController().signal),
  ).toMatchObject({ text: "2: last line", totalLines: 2, truncated: false, ref: "large.txt#L2-L2" });
  const large = await api.readTool.execute(ctx, { path: "large.txt" }, new AbortController().signal);
  expect(large.truncated).toBe(true);
  expect(large.ref).toBe("large.txt#L1-L1");
  expect(JSON.stringify(large).length).toBeLessThanOrEqual(32000);
  const target = await (await api.PathGuard.create(root)).resolve("large.txt");
  expect(ctx.lastReads.get(target.key)?.sha256).toBe(createHash("sha256").update(data).digest("hex"));
  expect(ctx.lastReads.size).toBe(3);
});
it("refuses binaries and PDFs and records no failed fingerprint", async () => {
  const ctx = context();
  await writeFile(join(root, "blob"), Buffer.from([0, 1]));
  await writeFile(join(root, "vendor.PDF"), "%PDF");
  await expect(api.readTool.execute(ctx, { path: "blob" }, new AbortController().signal)).rejects.toThrow(
    /binary/i,
  );
  await expect(
    api.readTool.execute(ctx, { path: "vendor.PDF" }, new AbortController().signal),
  ).rejects.toThrow(/read_doc/);
  expect(ctx.lastReads.size).toBe(0);
});
it("reads the full log of a command run, the only readable file under .vera", async () => {
  await mkdir(join(root, ".vera/runs"), { recursive: true });
  await writeFile(join(root, ".vera/runs/run_01ABC.log"), "first error\n");
  await writeFile(join(root, ".vera/other.txt"), "private\n");
  const signal = new AbortController().signal;
  expect(await api.readTool.execute(context(), { path: ".vera/runs/run_01ABC.log" }, signal)).toMatchObject({
    text: expect.stringContaining("first error"),
  });
  await expect(api.readTool.execute(context(), { path: ".vera/other.txt" }, signal)).rejects.toThrow(
    /ignored/,
  );
});
// The FIFO has no writer: opening it would block the read for good.
it.skipIf(process.platform === "win32")("refuses a FIFO without opening it", async () => {
  execFileSync("mkfifo", [join(root, "pipe")]);
  const signal = new AbortController().signal;
  await expect(api.readTool.execute(context(), { path: "pipe" }, signal)).rejects.toThrow(
    "Read an ordinary file.",
  );
  await expect(readGuardedFile(await api.PathGuard.create(root), "pipe", 1024, signal)).rejects.toThrow(
    "Read an ordinary file.",
  );
});
it("registry capping of escaped numbered text retains the exact visible line range", async () => {
  const ctx = context();
  await writeFile(join(root, "quotes.txt"), Array.from({ length: 200 }, () => '"'.repeat(200)).join("\n"));
  const outcome = await new api.ToolRegistry().execute(
    ctx,
    "read",
    { path: "quotes.txt" },
    new AbortController().signal,
  );
  const result = JSON.parse(outcome.text) as { ref: string; text: string; truncated: boolean };
  expect(outcome.text.length).toBeLessThanOrEqual(32000);
  expect(result.truncated).toBe(true);
  const last = [...result.text.matchAll(/(?:^|\n)(\d+): /g)].at(-1);
  expect(result.ref).toBe(`quotes.txt#L1-L${Number(last?.[1])}`);
});
