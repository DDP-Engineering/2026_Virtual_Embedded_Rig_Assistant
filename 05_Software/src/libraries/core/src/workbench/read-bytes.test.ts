import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof fs>();
  return { ...actual, open: vi.fn(actual.open) };
});
let reader: typeof import("./read-bytes.js");
const actual = await vi.importActual<typeof fs>("node:fs/promises");
let root: string;
beforeAll(async () => {
  expect(existsSync(new URL("./read-bytes.ts", import.meta.url)), "bounded file reader exists").toBe(true);
  reader = await import("./read-bytes.js");
});
beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), "vera-view01-"));
  await fs.mkdir(join(root, "ignored"));
  await fs.writeFile(join(root, "ignored/binary.bin"), Buffer.from([0, 255, 42, 128, 65]));
  vi.mocked(fs.open).mockImplementation(actual.open);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

it("reads bounded original bytes from a 200MiB file and preserves physical size at EOF", async () => {
  const size = 200 * 1024 * 1024;
  const file = await actual.open(join(root, "large.bin"), "w+");
  await file.truncate(size);
  await file.write(Buffer.from([0, 255, 128]), 0, 3, size - 3);
  await file.close();
  let volume = 0;
  vi.mocked(fs.open).mockImplementationOnce(async (...args) => {
    const handle = await actual.open(...args);
    const read = handle.read.bind(handle);
    vi.spyOn(handle, "read").mockImplementation(async (options) => {
      volume += options?.length ?? 0;
      return read(options);
    });
    vi.spyOn(handle, "readFile").mockImplementation(() => {
      throw Error("whole-file reads forbidden");
    });
    return handle;
  });
  const value = await reader.readBytes(root, "large.bin", size - 3, 1048576);
  expect(value).toMatchObject({ path: "large.bin", offset: size - 3, size });
  expect(value.bytes.subarray(value.offset - value.start)).toEqual(Buffer.from([0, 255, 128]));
  expect(volume).toBe(65536 + 3);
  const middle = await reader.readBytes(root, "large.bin", 10 * 1024 * 1024, 1048576);
  expect(middle.bytes.length).toBe(1048576 + 2 * 65536);
  for (const offset of [size, size + 100]) {
    const eof = await reader.readBytes(root, "large.bin", offset, 10);
    expect(eof).toMatchObject({ offset, size });
    expect(eof.bytes.length).toBe(0);
  }
  await fs.writeFile(join(root, "empty"), "");
  expect((await reader.readBytes(root, "empty", 0, 1)).bytes.length).toBe(0);
  const binary = await reader.readBytes(root, "ignored/binary.bin", 1, 3);
  expect(binary.bytes.subarray(1, 4)).toEqual(Buffer.from([255, 42, 128]));
});

it("refuses invalid windows before any file open", async () => {
  for (const [offset, length] of [
    [-1, 1],
    [0.5, 1],
    [0, 0],
    [0, -1],
    [0, 1048577],
    [0, 1.5],
    [Number.MAX_SAFE_INTEGER, 1],
    [Infinity, 1],
    [NaN, 1],
  ])
    await expect(
      reader.readBytes(root, "ignored/binary.bin", offset as number, length as number),
    ).rejects.toMatchObject({ code: "INVALID" });
  expect(fs.open).not.toHaveBeenCalled();
});

it("refuses folders, traversal, absolute paths, Windows aliases and ordinary-file links", async () => {
  for (const path of [
    "",
    "ignored",
    "../outside",
    join(root, "ignored/binary.bin"),
    "/absolute",
    "ignored\\binary.bin",
    "ignored/../ignored/binary.bin",
    "ignored/binary.bin.",
    "ignored/binary.bin ",
    "ignored/binary.bin::$DATA",
    "NUL",
    "ignored//binary.bin",
  ])
    await expect(reader.readBytes(root, path, 0, 1), path).rejects.toMatchObject({ code: "DENIED" });
  await fs.symlink(
    join(root, "ignored"),
    join(root, "link"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await expect(reader.readBytes(root, "link/binary.bin", 0, 1)).rejects.toMatchObject({ code: "DENIED" });
  await expect(reader.readBytes(join(root, "link"), "binary.bin", 0, 1)).rejects.toMatchObject({
    code: "DENIED",
  });
  if (process.platform !== "win32") {
    await fs.symlink(join(root, "ignored/binary.bin"), join(root, "file-link"));
    await expect(reader.readBytes(root, "file-link", 0, 1)).rejects.toMatchObject({ code: "DENIED" });
  }
  await expect(reader.readBytes(root, "missing", 0, 1)).rejects.toMatchObject({ code: "NOT_FOUND" });
});

it("refuses a stored canonical root redirected through an ancestor before the request", async () => {
  const parent = join(root, "parent");
  const owner = join(parent, "bench");
  const outside = join(root, "outside");
  await fs.mkdir(owner, { recursive: true });
  await fs.mkdir(join(outside, "bench"), { recursive: true });
  await fs.writeFile(join(owner, "raw.bin"), "owned");
  await fs.writeFile(join(outside, "bench/raw.bin"), "outside");
  const canonicalOwner = await fs.realpath(owner);
  await fs.rename(parent, join(root, "original-parent"));
  await fs.symlink(outside, parent, process.platform === "win32" ? "junction" : "dir");
  await expect(reader.readBytes(canonicalOwner, "raw.bin", 0, 7)).rejects.toMatchObject({ code: "DENIED" });
  expect(fs.open).not.toHaveBeenCalled();
});

it("refuses a replacement between stat and open and closes its descriptor", async () => {
  let closed = false;
  vi.mocked(fs.open).mockImplementationOnce(async (...args) => {
    await fs.rename(join(root, "ignored/binary.bin"), join(root, "old.bin"));
    await fs.writeFile(join(root, "ignored/binary.bin"), Buffer.from([0, 255, 42, 128, 65]));
    const handle = await actual.open(...args);
    const close = handle.close.bind(handle);
    vi.spyOn(handle, "close").mockImplementation(async () => {
      closed = true;
      await close();
    });
    return handle;
  });
  await expect(reader.readBytes(root, "ignored/binary.bin", 0, 5)).rejects.toMatchObject({
    code: "CONFLICT",
  });
  expect(closed).toBe(true);
});

it("reports a vanished file or a replacement folder when open fails", async () => {
  for (const folder of [false, true]) {
    vi.mocked(fs.open).mockImplementationOnce(async (...args) => {
      await fs.unlink(join(root, "ignored/binary.bin"));
      if (folder) {
        await fs.mkdir(join(root, "ignored/binary.bin"));
        throw Object.assign(Error("raced directory"), { code: "EISDIR" });
      }
      return actual.open(...args);
    });
    await expect(reader.readBytes(root, "ignored/binary.bin", 0, 5)).rejects.toMatchObject({
      code: folder ? "CONFLICT" : "NOT_FOUND",
    });
    await fs.rm(join(root, "ignored/binary.bin"), { force: true, recursive: true });
    await fs.writeFile(join(root, "ignored/binary.bin"), "hello");
  }
});

it("reports a file removed between open and the first check as missing", async () => {
  vi.mocked(fs.open).mockImplementationOnce(async (...args) => {
    const handle = await actual.open(...args);
    await fs.unlink(join(root, "ignored/binary.bin"));
    return handle;
  });
  await expect(reader.readBytes(root, "ignored/binary.bin", 0, 5)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
});

it.each(["rewrite", "truncate", "remove"])("refuses %s during a read", async (change) => {
  vi.mocked(fs.open).mockImplementationOnce(async (...args) => {
    const handle = await actual.open(...args);
    const read = handle.read.bind(handle);
    vi.spyOn(handle, "read").mockImplementationOnce(async (options) => {
      const result = await read(options);
      const path = join(root, "ignored/binary.bin");
      if (change === "rewrite") await fs.writeFile(path, Buffer.from([5, 4, 3, 2, 1]));
      else if (change === "truncate") await fs.truncate(path, 1);
      else await fs.unlink(path);
      return result;
    });
    return handle;
  });
  await expect(reader.readBytes(root, "ignored/binary.bin", 0, 5)).rejects.toMatchObject({
    code: change === "remove" ? "NOT_FOUND" : "CONFLICT",
  });
});

it("refuses an ancestor replaced by a link between validation and open", async () => {
  vi.mocked(fs.open).mockImplementationOnce(async (...args) => {
    await fs.rename(join(root, "ignored"), join(root, "moved"));
    await fs.symlink(
      join(root, "moved"),
      join(root, "ignored"),
      process.platform === "win32" ? "junction" : "dir",
    );
    return actual.open(...args);
  });
  await expect(reader.readBytes(root, "ignored/binary.bin", 0, 5)).rejects.toMatchObject({
    code: "CONFLICT",
  });
});

it("fills positional short reads and refuses unexpected EOF without exposing partial data", async () => {
  for (const eof of [false, true]) {
    vi.mocked(fs.open).mockImplementationOnce(async (...args) => {
      const handle = await actual.open(...args);
      const read = handle.read.bind(handle);
      vi.spyOn(handle, "read").mockImplementation((options) =>
        read({ ...options, length: eof ? 0 : Math.min(options?.length ?? 0, 2) }),
      );
      return handle;
    });
    const result = reader.readBytes(root, "ignored/binary.bin", 0, 5);
    if (eof) await expect(result).rejects.toMatchObject({ code: "CONFLICT" });
    else expect((await result).bytes).toEqual(Buffer.from([0, 255, 42, 128, 65]));
  }
});
