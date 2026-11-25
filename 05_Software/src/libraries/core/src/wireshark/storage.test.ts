import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CaptureReference } from "@vera/shared";
import { expect, it } from "vitest";
import { PathGuard } from "../workbench/path-guard.js";
import { WriteQueue } from "../workbench/write-queue.js";
import { publishCapture, publishCaptures } from "./storage.js";

it("reserves managed capture paths without following a workspace-owned redirect", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "vera-capture-path-")));
  try {
    const ordinary = join(root, "ordinary");
    const managed = join(root, ".vera", "captures");
    await mkdir(ordinary);
    await mkdir(join(root, ".vera"));
    await writeFile(join(ordinary, "notes.txt"), "fixture");
    await symlink(ordinary, managed, process.platform === "win32" ? "junction" : "dir");
    const guard = await PathGuard.create(root, root, "filesystem");
    await expect(guard.resolve(".vera/captures/notes.txt")).rejects.toThrow("Agent access");
    await expect(guard.resolve("ordinary/notes.txt")).resolves.toMatchObject({
      relative: "ordinary/notes.txt",
    });
    await rm(join(ordinary, "notes.txt"));
    await rm(ordinary, { recursive: true });
    await expect(PathGuard.create(root, root, "filesystem")).resolves.toBeInstanceOf(PathGuard);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("fails a capture batch before publication when any staged member is changed", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "vera-capture-batch-")));
  try {
    await mkdir(join(root, ".vera"));
    const folder = join(root, ".vera", "captures");
    const first = Buffer.from("d4c3b2a1020004000000000000000000ffff000001000000", "hex");
    const second = Buffer.from(first);
    second.writeUInt32LE(64, 16);
    const files = [];
    for (const [index, data] of [first, second].entries()) {
      const input = join(root, `valid-${index}.pcap`);
      const reference: CaptureReference = {
        format: 1,
        source: { kind: "managed" },
        fileFormat: "pcap",
        bytes: data.length,
        sha256: createHash("sha256").update(data).digest("hex"),
      };
      await writeFile(input, data);
      files.push({ input, reference });
    }
    await expect(
      publishCaptures(
        root,
        { queue: new WriteQueue(), assertWritable() {} },
        files,
        new AbortController().signal,
        async () => {
          const entries = await readdir(folder);
          expect(entries).toHaveLength(2);
          expect(entries.every((path) => path.endsWith(".tmp"))).toBe(true);
          await writeFile(join(folder, entries[1] ?? ""), Buffer.alloc(24));
        },
      ),
    ).rejects.toMatchObject({ reason: "invalid_capture" });
    expect(await readdir(folder)).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("withholds publication when staged capture bytes change on the authorization boundary", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "vera-capture-stage-")));
  try {
    await mkdir(join(root, ".vera"));
    const folder = join(root, ".vera", "captures");
    const input = join(root, "valid.pcap");
    const fixture = Buffer.from("d4c3b2a1020004000000000000000000ffff000001000000", "hex");
    const reference: CaptureReference = {
      format: 1,
      source: { kind: "workbench", path: "valid.pcap" },
      fileFormat: "pcap",
      bytes: fixture.length,
      sha256: createHash("sha256").update(fixture).digest("hex"),
    };
    await writeFile(input, fixture);
    await expect(
      publishCapture(
        root,
        { queue: new WriteQueue(), assertWritable() {} },
        input,
        reference,
        new AbortController().signal,
        async () => {
          const [stage] = await readdir(folder);
          if (!stage) throw Error("Expected staged bytes.");
          const amended = Buffer.from(fixture);
          amended[amended.length - 5] = 1;
          await writeFile(join(folder, stage), amended);
        },
      ),
    ).rejects.toMatchObject({ reason: "capture_changed" });
    expect(await readdir(folder)).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("publishes neither file when a staged provenance manifest changes before admission", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "vera-capture-provenance-")));
  try {
    await mkdir(join(root, ".vera"));
    const folder = join(root, ".vera", "captures");
    const input = join(root, "capture.pcapng");
    const capture = Buffer.from("0a0d0d0a1c0000004d3c2b1a01000000ffffffffffffffff1c000000", "hex");
    const reference: CaptureReference = {
      format: 1,
      source: { kind: "managed" },
      fileFormat: "pcapng",
      bytes: capture.length,
      sha256: createHash("sha256").update(capture).digest("hex"),
    };
    const manifestPath = join(root, "provenance.json");
    const manifest = Buffer.from(JSON.stringify({ format: 1, capture: reference }));
    const manifestReference = {
      bytes: manifest.length,
      sha256: createHash("sha256").update(manifest).digest("hex"),
    };
    await writeFile(input, capture);
    await writeFile(manifestPath, manifest);
    const access = { queue: new WriteQueue(), assertWritable() {} };
    const signal = new AbortController().signal;
    const files = [{ input, reference }];
    const options = { provenance: { input: manifestPath, reference: manifestReference } };
    await expect(
      publishCaptures(
        root,
        access,
        files,
        signal,
        async () => {
          const entries = await readdir(folder);
          expect(entries).toHaveLength(2);
          expect(entries.every((entry) => entry.endsWith(".tmp"))).toBe(true);
          let modified = false;
          for (const entry of entries) {
            const path = join(folder, entry);
            if (!(await readFile(path)).equals(manifest)) continue;
            await writeFile(path, Buffer.alloc(manifest.length));
            modified = true;
          }
          expect(modified).toBe(true);
        },
        options,
      ),
    ).rejects.toMatchObject({ reason: "capture_changed" });
    expect(await readdir(folder)).toEqual([]);
    const captureFile = join(folder, `${reference.sha256}.pcapng`);
    const manifestFile = join(folder, `${manifestReference.sha256}.provenance.json`);
    await expect(publishCaptures(root, access, files, signal, async () => {}, options)).resolves.toEqual([
      reference,
    ]);
    expect(await readFile(captureFile)).toEqual(capture);
    expect(await readFile(manifestFile)).toEqual(manifest);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
