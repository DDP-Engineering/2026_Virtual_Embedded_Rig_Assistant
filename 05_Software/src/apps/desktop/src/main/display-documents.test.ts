import { createMaskingResolver, type WorkbenchService } from "@vera/core";
import {
  channels,
  DOCS_BYTE_WINDOW_LIMIT,
  MAX_MESSAGE_IMAGE_BYTES,
  type Settings,
  type ViewerContent,
  veraError,
  workbenchSchema,
} from "@vera/shared";
import { describe, expect, it, vi } from "vitest";
import { DisplayDocuments } from "./display-documents.js";
import { DisplayIdentities } from "./display-identities.js";

const id = "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C";
const otherId = "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0D";
const secrets = ["mqtt-password-one", "mqtt-password-two"];
const rawPaths = secrets.map((secret) => `docs/${secret}.txt`);
function fixture() {
  const registered = [...secrets];
  let settings: Pick<Settings, "privacy"> = {};
  let config = workbenchSchema.parse({ format: 1, id, name: "Mask" });
  const content = (path: string): ViewerContent => ({
    kind: "text",
    path,
    ref: null,
    snippet: "",
    lines: [path === rawPaths[0] ? (secrets[0] as string) : (secrets[1] as string)],
    start: 1,
    end: 1,
  });
  const host = {
    getSnapshot: () => ({ config, folder: "/owned" }),
    listFolder: vi.fn(async (_id, path) => ({
      entries: (path === "docs" ? rawPaths : ["docs"]).map((path) => ({
        path,
        name: path.split("/").at(-1),
        type: path === "docs" ? "folder" : "file",
        ignored: false,
      })),
      truncated: true,
    })),
    findFiles: vi.fn(async () => ({ paths: rawPaths, truncated: true })),
    readText: vi.fn(async (_id, path) => content(path)),
    readBytes: vi.fn(async (_id: string, path: string, offset: number, _length: number) => {
      const bytes = Buffer.from(`prefix ${registered[0]} suffix`);
      return { path, offset, size: bytes.length, start: 0, bytes };
    }),
    statEntry: vi.fn(async (_id, path) => ({
      path,
      type: "file",
      size: 12,
      modified: "2026-11-17T00:00:00.000Z",
    })),
    listDocuments: vi.fn(async () =>
      rawPaths.map((path, i) => ({
        id: i + 1,
        path,
        kind: "text",
        sha256: null,
        bytes: 12,
        mtime: "2026-11-17T00:00:00.000Z",
        pages: null,
        status: "pending",
        error: null,
        indexedAt: null,
      })),
    ),
    searchDocuments: vi.fn(async () => ({
      coverage: "partial",
      usage: { mode: "keyword" },
      results: rawPaths.map((path) => ({ path, ref: `${path}#L1-L1`, snippet: secrets[0], score: 1 })),
    })),
    documentGuard: () => null,
  };
  const display = new DisplayDocuments(
    host as unknown as WorkbenchService,
    createMaskingResolver(() => settings),
    (text) => secrets.reduce((s, secret) => s.replaceAll(secret, "[REDACTED]"), text),
    new DisplayIdentities(Buffer.alloc(32, 1)),
    () => registered,
  );
  return {
    display,
    host,
    content,
    register: (secret: string) => registered.push(secret),
    app: (on: boolean) => {
      settings = { privacy: { mask: { display: on } } };
    },
    choice: (display: "default" | "on" | "off") => {
      config = { ...config, privacy: { mask: { display } } };
    },
    switch: () => {
      config = { ...config, id: otherId };
    },
  };
}
describe("Display boundary", () => {
  it("projects Git status with the same opaque identities and masked rename labels as Files", async () => {
    const f = fixture();
    f.app(true);
    const [source, destination] = rawPaths as [string, string];
    const status = f.display.gitStatus(id, {
      state: "ready",
      branch: { kind: "named", name: secrets[0] as string },
      entries: [
        {
          path: source,
          staged: "R",
          unstaged: null,
          conflict: false,
          virtual: true,
          rename: { path: destination, role: "destination" },
        },
      ],
      changed: 1,
      conflicts: 0,
    });
    const tree = await f.display.tree(id, "docs");
    expect(status).toMatchObject({
      branch: { name: "[REDACTED]" },
      entries: [
        {
          path: tree.entries[0]?.path,
          displayPath: "docs/[REDACTED].txt",
          rename: { path: tree.entries[1]?.path },
        },
      ],
    });
    for (const secret of secrets) expect(JSON.stringify(status)).not.toContain(secret);
  });

  it("keeps unknown secret-bearing extensions opaque and stable across files and Display choices", async () => {
    const f = fixture();
    f.app(true);
    const first = await f.display.stat(id, `docs/one.${secrets[0]}`);
    expect(JSON.stringify(first)).not.toContain(secrets[0]);
    f.app(false);
    const second = await f.display.stat(id, `docs/two.${secrets[0]}`);
    expect(second.properties.extension).toBe(first.properties.extension);
    expect((await f.display.stat(id, "docs/file.txt")).properties.extension).toBe(".txt");
  });
  it("keeps colliding entries and counts with live app/default/on/off presentation", async () => {
    const f = fixture();
    const off = channels["docs.tree"].response.parse(await f.display.tree(id, "docs"));
    expect(off.entries.map((entry) => entry.name)).toEqual(secrets.map((secret) => `${secret}.txt`));
    const first = off.entries[0];
    expect(first?.path).not.toContain(secrets[0]);
    expect((await f.display.read(id, first?.path as string)).content).toMatchObject({
      lines: [secrets[0]],
      displayPath: rawPaths[0],
    });
    const foundOff = await f.display.find(id, "mqtt");
    f.app(true);
    const on = channels["docs.tree"].response.parse(await f.display.tree(id, "docs"));
    expect(on.entries.map((entry) => entry.name)).toEqual(["[REDACTED].txt", "[REDACTED].txt"]);
    expect(on.entries.map((entry) => entry.path)).toEqual(off.entries.map((entry) => entry.path));
    expect(new Set(on.entries.map((entry) => entry.path)).size).toBe(2);
    expect(on.truncated).toBe(true);
    const foundOn = channels["docs.find"].response.parse(await f.display.find(id, "mqtt"));
    expect(foundOn.paths).toEqual(foundOff.paths);
    expect(JSON.stringify(foundOn)).not.toContain("mqtt-password");
    for (const entry of on.entries) {
      expect((await f.display.read(id, entry.path)).content).toMatchObject({
        lines: ["[REDACTED]"],
        displayPath: "docs/[REDACTED].txt",
      });
      expect((await f.display.stat(id, entry.path)).properties.path).toBe(entry.path);
      expect(
        channels["docs.stat"].response.parse(await f.display.stat(id, entry.path)).properties.extension,
      ).toBe(".txt");
    }
    expect(f.host.readText.mock.calls.map((call) => call[1])).toContain(rawPaths[0]);
    f.choice("off");
    expect((await f.display.read(id, first?.path as string)).content).toMatchObject({ lines: [secrets[0]] });
    f.app(false);
    f.choice("on");
    expect((await f.display.read(id, first?.path as string)).content).toMatchObject({
      lines: ["[REDACTED]"],
    });
    f.choice("default");
    expect((await f.display.read(id, first?.path as string)).content).toMatchObject({ lines: [secrets[0]] });
  });
  it("retains indexed list/search and exact reference identity without metadata secrets", async () => {
    const f = fixture();
    f.app(true);
    const list = channels["docs.list"].response.parse(await f.display.list(id));
    const hits = channels["docs.search"].response.parse(await f.display.search(id, "mqtt"));
    expect(list.documents).toHaveLength(2);
    expect(hits.results).toHaveLength(2);
    expect(JSON.stringify([list, hits])).not.toContain("mqtt-password");
    const hit = hits.results[0];
    expect(f.display.resolveRef(id, hit?.ref as string)).toBe(`${rawPaths[0]}#L1-L1`);
    const result = await f.display.open(
      id,
      async () => ({
        ...f.content(rawPaths[0] as string),
        ref: `${rawPaths[0]}#L1-L1`,
      }),
      { ref: hit?.ref as string },
    );
    expect(result.content.path).toBe(hit?.path);
    expect(result.content.ref).toBe(hit?.ref);
    const heading = `notes.md#h=${secrets[0]}`;
    const opaque = f.display.ref(id, heading);
    expect(opaque).not.toContain(secrets[0]);
    expect(f.display.resolveRef(id, opaque)).toBe(heading);
    expect(() => f.display.resolveRef(id, opaque.replace("#L1-L1", "#L2-L2"))).toThrowError();
    expect(() => f.display.resolveRef(id, opaque.replace("notes.md/", "other.md/"))).toThrowError();
  });
  it("refuses a host reply for another original path or reference before publication", async () => {
    const f = fixture();
    const first = f.display.path(id, rawPaths[0] as string);
    f.host.readText.mockImplementationOnce(async () => f.content(rawPaths[1] as string));
    await expect(f.display.read(id, first, "request")).rejects.toMatchObject({ code: "NOT_FOUND" });
    const ref = f.display.ref(id, `${rawPaths[0]}#L1-L1`);
    await expect(
      f.display.open(
        id,
        async () => ({ ...f.content(rawPaths[1] as string), ref: `${rawPaths[1]}#L1-L1` }),
        { ref },
        "request",
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    for (const slug of ["", "_", secrets[0] as string]) {
      const raw = `notes.md#h=${slug}`;
      expect(f.display.resolveRef(id, f.display.ref(id, raw))).toBe(raw);
    }
  });
  it("refuses forged and foreign identities before disk access and reopens stable identities", async () => {
    const f = fixture();
    const token = f.display.path(id, rawPaths[0] as string);
    await expect(f.display.read(id, `${token}/wrong`)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(f.host.readText).not.toHaveBeenCalled();
    f.switch();
    await expect(f.display.read(id, token)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(f.display.read(otherId, token)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const next = f.display.path(otherId, rawPaths[0] as string);
    f.display.close();
    expect((await f.display.read(otherId, next)).content).toMatchObject({ lines: [secrets[0]] });
  });
  it("rejects late replies after ownership changes or close/reopen", async () => {
    const f = fixture();
    let finish!: (value: { paths: string[]; truncated: boolean }) => void;
    f.host.findFiles.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const result = f.display.find(id, "mqtt");
    f.display.close();
    finish({ paths: rawPaths, truncated: false });
    await expect(result).rejects.toMatchObject({ code: "CONFLICT" });
    f.host.findFiles.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const stale = f.display.find(id, "mqtt");
    f.switch();
    finish({ paths: rawPaths, truncated: false });
    await expect(stale).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

it("publishes bounded byte windows through opaque identities and the current Display choice", async () => {
  const f = fixture();
  const path = f.display.path(id, rawPaths[0] as string);
  const read = async () =>
    channels["docs.readBytes"].response.parse(await f.display.readBytes(id, path, 9, 4));
  expect(f.display.readBytes, "byte publication boundary exists").toBeTypeOf("function");
  expect(Buffer.from((await read()).data, "base64").toString()).toBe("tt-p");
  f.app(true);
  const masked = await read();
  expect(masked).toMatchObject({
    workbenchId: id,
    path,
    displayPath: "docs/[REDACTED].txt",
    offset: 9,
    size: 31,
  });
  expect(Buffer.from(masked.data, "base64").toString()).toBe("****");
  expect(f.host.readBytes).toHaveBeenLastCalledWith(id, rawPaths[0], 9, 4);
  f.choice("off");
  expect(Buffer.from((await read()).data, "base64").toString()).toBe("tt-p");
  f.app(false);
  f.choice("on");
  expect(Buffer.from((await read()).data, "base64").toString()).toBe("****");
  f.choice("default");
  expect(Buffer.from((await read()).data, "base64").toString()).toBe("tt-p");
  expect((await f.display.stat(id, path)).properties.size).toBe(12);
});

it("resolves Display and newly registered byte secrets after all asynchronous work", async () => {
  const f = fixture();
  for (const on of [true, false]) {
    f.app(!on);
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    f.host.readBytes.mockImplementationOnce(async (_id, path, offset) => {
      await gate;
      return { path, offset, start: 0, size: 16, bytes: Buffer.from("late-secret-1234") };
    });
    const result = f.display.readBytes(id, "safe.bin", 2, 4);
    f.register("late-secret-1234");
    f.app(on);
    finish();
    expect(Buffer.from((await result).data, "base64").toString()).toBe(on ? "****" : "te-s");
  }
});

it("refuses forged, foreign, mismatched and stale byte identities", async () => {
  const f = fixture();
  const token = f.display.path(id, rawPaths[0] as string);
  await expect(f.display.readBytes(id, `${token}/wrong`, 0, 1)).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(f.display.readBytes(otherId, token, 0, 1)).rejects.toMatchObject({ code: "CONFLICT" });
  expect(f.host.readBytes).not.toHaveBeenCalled();
  f.host.readBytes.mockImplementationOnce(async () => ({
    path: "wrong",
    offset: 0,
    start: 0,
    size: 0,
    bytes: Buffer.alloc(0),
  }));
  await expect(f.display.readBytes(id, token, 0, 1)).rejects.toMatchObject({ code: "NOT_FOUND" });
  for (const close of [() => f.display.close(), () => f.switch()]) {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    f.host.readBytes.mockImplementationOnce(async (_id, path, offset) => {
      await gate;
      return { path, offset, start: 0, size: 0, bytes: Buffer.alloc(0) };
    });
    const result = f.display.readBytes(id, token, 0, 1);
    close();
    finish();
    await expect(result).rejects.toMatchObject({ code: "CONFLICT" });
  }
});

it("keeps raw core-issued session citation paths and heading slugs exact", async () => {
  const f = fixture();
  for (const ref of ["__vera_display_notes/child.txt#L1-L1", "notes.md#h=__vera_display_heading"]) {
    const path = ref.split("#")[0] as string;
    const target = { sessionId: "ses_01JB8Z6Q4M7N2K5R9T3V8X1Y0C", ref };
    const read = vi.fn(async () => ({ ...f.content(path), ref }));
    await expect(f.display.open(id, read, target)).resolves.toMatchObject({ workbenchId: id });
    expect(read).toHaveBeenCalledOnce();
  }
});

it("bounds ordinary and session original references before host access", async () => {
  const f = fixture();
  const head = "notes.md#h=";
  const within = head + "x".repeat(8192 - head.length);
  expect(f.display.resolveRef(id, within)).toBe(within);
  const ref = within + "x";
  const read = vi.fn(async () => ({ ...f.content("notes.md"), ref }));
  await expect(f.display.open(id, read, { ref })).rejects.toMatchObject({ code: "INVALID" });
  await expect(
    f.display.open(id, read, { ref, sessionId: "ses_01JB8Z6Q4M7N2K5R9T3V8X1Y0C" }),
  ).rejects.toMatchObject({ code: "INVALID" });
  expect(read).not.toHaveBeenCalled();
});

it("seals verified text revisions to owner and path and retains original newline positions under Display masking", async () => {
  const f = fixture(),
    path = rawPaths[0] as string;
  const raw = Buffer.from("a\r\nb\rc\n");
  f.host.readBytes.mockImplementation(async (_id, sourcePath, offset) => ({
    path: sourcePath,
    offset,
    size: raw.length,
    start: 0,
    bytes: raw,
    revision: "verified-revision",
  }));
  const shown = f.display.viewer(id, {
    ...f.content(path),
    kind: "text",
    ref: `${path}#L2-L3`,
    lines: [],
    start: 2,
    end: 3,
    byteSource: {
      size: 6 * 1024 * 1024,
      modified: "2026-11-17T00:00:00.000Z",
      revision: "verified-revision",
      lines: 3,
      utf8Log: false,
    },
  });
  if (shown.kind !== "text" || !shown.byteSource) throw Error("Missing source");
  expect(shown.byteSource.revision).not.toContain("verified-revision");
  f.register("a\r\nb");
  f.app(true);
  const reply = await f.display.readBytes(id, shown.path, 0, raw.length, shown.byteSource.revision);
  expect(reply.lineEnds).toEqual([3, 5, 7]);
  expect(reply.revision).toBe(shown.byteSource.revision);
  await expect(f.display.readBytes(id, shown.path, 0, 1, "verified-revision")).rejects.toMatchObject({
    code: "DENIED",
  });
  expect(Buffer.from(reply.data, "base64").toString()).toBe("****\rc\n");
  await expect(
    f.display.readBytes(id, f.display.path(id, rawPaths[1] as string), 0, 1, shown.byteSource.revision),
  ).rejects.toBeDefined();
  f.host.readBytes.mockImplementation(async (_id, sourcePath, offset) => ({
    path: sourcePath,
    offset,
    size: raw.length,
    start: 0,
    bytes: raw,
    revision: "replaced-same-size",
  }));
  await expect(f.display.readBytes(id, shown.path, 0, 4, shown.byteSource.revision)).rejects.toMatchObject({
    code: "CONFLICT",
  });
});

// REQ-UX-9c6aa149 REQ-UX-16e08c34
describe("transcript image thumbnails", () => {
  it("returns a bounded PNG through opaque Display identities and the current byte policy", async () => {
    const f = fixture();
    const { default: sharp } = await import("sharp");
    const bytes = await sharp({
      create: { width: 240, height: 120, channels: 3, background: "cornflowerblue" },
    })
      .png()
      .toBuffer();
    f.host.readBytes.mockImplementation(async (_id, path, offset) => ({
      path,
      offset,
      start: 0,
      size: bytes.length,
      bytes,
      revision: "image-version",
    }));
    const original = `docs/${secrets[0]}.png`;
    const path = f.display.path(id, original);
    f.app(true);
    const reply = channels["docs.imageThumbnail"].response.parse(await f.display.imageThumbnail(id, path));
    expect(reply).toMatchObject({
      workbenchId: id,
      path,
      displayPath: "docs/[REDACTED].png",
      preview: { format: "png" },
    });
    expect(JSON.stringify(reply)).not.toContain(secrets[0]);
    const metadata = await sharp(Buffer.from(reply.preview?.thumbnail ?? "", "base64")).metadata();
    expect(metadata).toMatchObject({ format: "png", width: 128, height: 64 });
    f.register("PNG");
    expect((await f.display.imageThumbnail(id, path)).preview).toBeUndefined();
    await expect(f.display.imageThumbnail(otherId, path)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("authenticates an alias while keeping its persisted spelling as the unavailable label", async () => {
    const f = fixture();
    const original = `./docs//../${secrets[0]}.png`;
    const path = f.display.sessionImagePath(id, original);
    expect(path).not.toContain(secrets[0]);
    expect(f.display.resolveSessionImagePath(id, path)).toBe(original);
    expect(() => f.display.resolveSessionImagePath(otherId, path)).toThrow();
    f.app(true);
    f.host.readBytes.mockRejectedValueOnce(veraError("NOT_FOUND"));
    const missing = await f.display.imageThumbnail(id, path);
    expect(missing).toEqual({
      workbenchId: id,
      path: f.display.path(id, `${secrets[0]}.png`),
      displayPath: "./docs//../[REDACTED].png",
    });
    expect(f.host.readBytes).toHaveBeenLastCalledWith(id, `${secrets[0]}.png`, 0, DOCS_BYTE_WINDOW_LIMIT);
  });

  it("returns the label for missing, oversized and changed files", async () => {
    const f = fixture();
    const path = "scope.png";
    f.host.readBytes.mockRejectedValueOnce(veraError("NOT_FOUND"));
    expect(await f.display.imageThumbnail(id, path)).toEqual({ workbenchId: id, path, displayPath: path });
    f.host.readBytes.mockImplementationOnce(async () => ({
      path,
      offset: 0,
      start: 0,
      size: MAX_MESSAGE_IMAGE_BYTES + 1,
      bytes: Buffer.alloc(0),
    }));
    expect((await f.display.imageThumbnail(id, path)).preview).toBeUndefined();
    expect(f.host.readBytes).toHaveBeenCalledTimes(2);
    f.host.readBytes.mockImplementation(async (_id, path, offset) => ({
      path,
      offset,
      start: offset,
      size: DOCS_BYTE_WINDOW_LIMIT + 1,
      bytes: Buffer.alloc(offset ? 1 : DOCS_BYTE_WINDOW_LIMIT),
      revision: offset ? "changed" : "initial",
    }));
    expect(await f.display.imageThumbnail(id, path)).toEqual({ workbenchId: id, path, displayPath: path });
    expect(f.host.readBytes).toHaveBeenLastCalledWith(id, path, DOCS_BYTE_WINDOW_LIMIT, 1);
  });
});
