import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { readWindow } from "../../src/libraries/core/src/tools/read-window.js";
import { PathGuard } from "../../src/libraries/core/src/workbench/path-guard.js";
import { readBytes } from "../../src/libraries/core/src/workbench/read-bytes.js";

const root = await mkdtemp(join(tmpdir(), "vera-view03-source-"));
try {
  const text = `${"x".repeat(6 * 1024 * 1024)}\r\nTARGET\rLAST`;
  const path = join(root, "source.txt");
  await writeFile(path, text);
  const fixedTime = new Date("2026-11-17T00:00:00.000Z");
  await utimes(path, fixedTime, fixedTime);
  const signal = new AbortController().signal;
  const fractionalTime = 1794873600 + 0.75 / 1000;
  await utimes(path, fractionalTime, fractionalTime);
  const fractional = await readWindow(await PathGuard.create(root), "source.txt", 2, 2, signal);
  assert.equal(fractional.modified, (await stat(path)).mtime.toISOString());
  await utimes(path, fixedTime, fixedTime);
  const verified = await readWindow(await PathGuard.create(root), "source.txt", 2, 2, signal);
  assert.equal(verified.totalLines, 3);
  assert.equal(verified.modified, (await stat(path)).mtime.toISOString());
  assert.equal(verified.sha256, createHash("sha256").update(text).digest("hex"));
  const bytes = await readBytes(root, "source.txt", 6 * 1024 * 1024, 32);
  assert.equal(bytes.revision, verified.revision);
  assert.equal(bytes.size, verified.size);
  const before = await stat(path);
  await writeFile(path, text.replace("TARGET", "CHANGE"));
  await utimes(path, before.atime, before.mtime);
  assert.equal((await stat(path)).mtimeMs, before.mtimeMs);
  const changed = await readBytes(root, "source.txt", 6 * 1024 * 1024, 32);
  assert.notEqual(changed.revision, verified.revision);
  process.stdout.write(
    `${JSON.stringify({
      platform: process.platform,
      node: process.versions.node,
      bytes: verified.size,
      lines: verified.totalLines,
      sameVerifiedRevision: true,
      restoredMtimeReplacementRejected: true,
      capturedFractionalStatDate: true,
    })}\n`,
  );
} finally {
  assert.equal(dirname(resolve(root)), resolve(tmpdir()));
  assert.ok(basename(root).startsWith("vera-view03-source-"));
  await rm(root, { recursive: true, force: true });
}
