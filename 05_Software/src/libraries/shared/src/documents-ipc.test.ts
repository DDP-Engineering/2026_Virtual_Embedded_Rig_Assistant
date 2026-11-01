import { expect, it } from "vitest";
import { documentSchema, exceedsDocumentVolume, opensExternally, viewerContentSchema } from "./documents.js";
import { eventEnvelopeSchema } from "./events.js";
import { channels } from "./ipc.js";

const document = {
  id: 1,
  path: "docs/a.md",
  kind: "markdown",
  sha256: "a".repeat(64),
  bytes: 3,
  mtime: "2026-10-12T00:00:00.000Z",
  pages: null,
  status: "pending",
  error: null,
  indexedAt: null,
};
const envelope = (event: unknown) => ({ topic: "workbench", id: "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C", event });
// REQ-FUNC-28ad0001
it("requires exact workbench identity and typed viewer requests without client snippets", () => {
  const workbenchId = "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C";
  expect(channels["docs.list"].request.parse({ workbenchId })).toEqual({ workbenchId });
  expect(channels["docs.open"].request.safeParse({ workbenchId, path: "docs/a.pdf" }).success).toBe(true);
  for (const value of [
    { path: "docs/a.pdf" },
    { workbenchId, path: "../secret" },
    { workbenchId, path: "docs/a.pdf", snippet: "invented" },
    { workbenchId, ref: "artifact:a.md" },
  ])
    expect(channels["docs.open"].request.safeParse(value).success).toBe(false);
  expect(channels["docs.search"].request.safeParse({ workbenchId, query: " " }).success).toBe(false);
});
it("validates strict reindex requests/responses and truthful document/progress/removal events", () => {
  expect(channels["docs.reindex"].request.parse({})).toEqual({});
  expect(channels["docs.reindex"].response.parse({})).toEqual({});
  expect(channels["docs.reindex"].request.safeParse({ path: "../outside" }).success).toBe(false);
  expect(channels["docs.reindex"].response.safeParse({ indexed: 99 }).success).toBe(false);
  for (const status of ["pending", "indexed", "failed", "unsupported", "needs_ocr"]) {
    expect(
      eventEnvelopeSchema.safeParse(
        envelope({ type: "index.document", path: document.path, document: { ...document, status } }),
      ).success,
    ).toBe(true);
  }
  expect(
    eventEnvelopeSchema.safeParse(envelope({ type: "index.document", path: document.path, document: null }))
      .success,
  ).toBe(true);
  expect(
    eventEnvelopeSchema.safeParse(envelope({ type: "index.progress", pending: 2, done: 1, failed: 0 }))
      .success,
  ).toBe(true);
  expect(
    eventEnvelopeSchema.safeParse(envelope({ type: "index.progress", pending: -1, done: 0, failed: 0 }))
      .success,
  ).toBe(false);
  expect(
    eventEnvelopeSchema.safeParse(envelope({ type: "index.progress", pending: 0, done: 1.2, failed: 0 }))
      .success,
  ).toBe(false);
  for (const patch of [
    { sha256: "bogus" },
    { bytes: -1 },
    { status: "complete" },
    { error: "raw error" },
    { absolutePath: "/secrets" },
  ])
    expect(documentSchema.safeParse({ ...document, ...patch }).success).toBe(false);
});
// REQ-UX-64738341
it("bounds presentation viewer content by its slides", () => {
  const deck = {
    kind: "presentation",
    path: "docs/a.pptx",
    ref: "docs/a.pptx#p=2",
    snippet: "",
    slides: ["one", "two"],
    page: 2,
    pageEnd: 2,
  };
  expect(viewerContentSchema.safeParse(deck).success).toBe(true);
  for (const bounds of [
    { page: 3, pageEnd: 3 },
    { page: 2, pageEnd: 1 },
    { page: 0, pageEnd: 1 },
    { slides: [], page: 1, pageEnd: 1 },
  ])
    expect(viewerContentSchema.safeParse({ ...deck, ...bounds }).success).toBe(false);
});

// REQ-SEC-33b98d33 REQ-FUNC-d37a2092
it("opens externally only allowlisted document extensions, in any case", () => {
  for (const path of [
    "docs/a.pdf",
    "docs/A.PDF",
    "notes.txt",
    "r.md",
    "r.markdown",
    "t.csv",
    "t.tsv",
    "boot.log",
    "w.docx",
    "x.xlsx",
    "p.pptx",
    "w.doc",
    "x.xls",
    "p.ppt",
    "o.odt",
    "o.ods",
    "o.odp",
    "r.rtf",
    "rev.v2/datasheet.pdf",
  ])
    expect(opensExternally(path), path).toBe(true);
  for (const path of [
    "run.bat",
    "tool.js",
    "flash.py",
    "app.exe",
    "page.html",
    "page.htm",
    "schematic.png",
    "schematic.svg",
    "README",
    "docs.pdf/notes",
    "macro.docm",
    "macro.xlsm",
    ".pdf",
    "",
  ])
    expect(opensExternally(path), path).toBe(false);
  expect(channels["app.openPath"].request.safeParse({ path: "docs/a.pdf" }).success).toBe(true);
  expect(channels["app.openPath"].request.safeParse({}).success).toBe(false);
});

// REQ-FUNC-a187563c
it("accepts document volumes as non-negative safe integers on docs.volume and index.volume", () => {
  const workbenchId = "wb_01ARZ3NDEKTSV4RRFFQ69G5FAV";
  const response = channels["docs.volume"].response;
  expect(response.parse({ workbenchId, volume: { files: 3, bytes: 400 } })).toEqual({
    workbenchId,
    volume: { files: 3, bytes: 400 },
  });
  expect(response.parse({ workbenchId, volume: null })).toEqual({ workbenchId, volume: null });
  for (const volume of [
    { files: -1, bytes: 0 },
    { files: 1.5, bytes: 0 },
    { files: 1, bytes: 1, extra: 1 },
    { files: 1 },
  ])
    expect(response.safeParse({ workbenchId, volume }).success).toBe(false);
  expect(channels["docs.volume"].request.safeParse({ workbenchId, extra: 1 }).success).toBe(false);
  const event = {
    topic: "workbench",
    id: workbenchId,
    event: { type: "index.volume", files: 2001, bytes: 5 },
  };
  expect(eventEnvelopeSchema.parse(event)).toEqual(event);
  expect(
    eventEnvelopeSchema.safeParse({ ...event, event: { type: "index.volume", files: -2, bytes: 5 } }).success,
  ).toBe(false);
  expect(exceedsDocumentVolume({ files: 2000, bytes: 2 * 1024 ** 3 })).toBe(false);
  expect(exceedsDocumentVolume({ files: 2001, bytes: 0 })).toBe(true);
  expect(exceedsDocumentVolume({ files: 0, bytes: 2 * 1024 ** 3 + 1 })).toBe(true);
});

// REQ-UX-f6c347b8 REQ-REL-08946818
it("reports the indexer state and restarts it through strict channels and an app event", () => {
  expect(channels["indexer.status"].request.parse({})).toEqual({});
  expect(channels["indexer.status"].response.parse({ state: "stopped" })).toEqual({ state: "stopped" });
  expect(channels["indexer.status"].response.safeParse({ state: "crashed" }).success).toBe(false);
  expect(channels["indexer.restart"].request.safeParse({ now: true }).success).toBe(false);
  expect(channels["indexer.restart"].response.parse({})).toEqual({});
  const event = { topic: "app", id: "app", event: { type: "indexer.status", state: "running" } };
  expect(eventEnvelopeSchema.parse(event)).toEqual(event);
  expect(
    eventEnvelopeSchema.safeParse({ ...event, event: { type: "indexer.status", state: "busy" } }).success,
  ).toBe(false);
});

// REQ-FUNC-889beffd REQ-FUNC-2e3fad2d REQ-FUNC-70dc2e8f
it("lists, finds and reads workbench files through strict docs channels", () => {
  const workbenchId = "wb_01ARZ3NDEKTSV4RRFFQ69G5FAV";
  const entry = { name: "main.c", path: "firmware/main.c", type: "file", ignored: false };
  expect(channels["docs.tree"].request.parse({ workbenchId, path: "" })).toEqual({ workbenchId, path: "" });
  expect(channels["docs.tree"].request.safeParse({ workbenchId, path: "x", extra: 1 }).success).toBe(false);
  expect(
    channels["docs.tree"].response.parse({
      workbenchId,
      path: "firmware",
      entries: [entry],
      truncated: false,
    }),
  ).toMatchObject({ entries: [entry] });
  expect(
    channels["docs.tree"].response.safeParse({
      workbenchId,
      path: "",
      entries: [{ ...entry, type: "link" }],
      truncated: false,
    }).success,
  ).toBe(false);
  // Every entry says whether VERA ignores it (TASK-b34f2cc7).
  const { ignored: _, ...unmarked } = entry;
  expect(
    channels["docs.tree"].response.safeParse({ workbenchId, path: "", entries: [unmarked], truncated: false })
      .success,
  ).toBe(false);
  expect(channels["docs.find"].request.safeParse({ workbenchId, query: "  " }).success).toBe(false);
  expect(
    channels["docs.find"].response.parse({ workbenchId, paths: ["a.txt"], truncated: true }),
  ).toMatchObject({
    truncated: true,
  });
  expect(channels["docs.read"].request.safeParse({ workbenchId, path: "" }).success).toBe(false);
  const content = {
    kind: "text",
    path: "firmware/main.c",
    ref: null,
    snippet: "",
    lines: ["int x;"],
    start: 1,
    end: 1,
  };
  expect(channels["docs.read"].response.parse({ workbenchId, content })).toEqual({ workbenchId, content });
});

// REQ-FUNC-98e9d760
it("reports workbench entry properties through a strict docs.stat channel", () => {
  const workbenchId = "wb_01ARZ3NDEKTSV4RRFFQ69G5FAV";
  const properties = { path: "docs/a.pdf", type: "file", size: 100, modified: "2026-10-13T00:00:00.000Z" };
  expect(channels["docs.stat"].request.parse({ workbenchId, path: "docs/a.pdf" })).toEqual({
    workbenchId,
    path: "docs/a.pdf",
  });
  expect(channels["docs.stat"].request.safeParse({ workbenchId, path: "" }).success).toBe(false);
  expect(channels["docs.stat"].response.parse({ workbenchId, properties })).toEqual({
    workbenchId,
    properties,
  });
  const folder = { path: "docs", type: "folder", size: null, modified: "2026-10-13T00:00:00.000Z" };
  expect(channels["docs.stat"].response.parse({ workbenchId, properties: folder }).properties).toEqual(
    folder,
  );
  for (const bad of [
    { ...properties, size: -1 },
    { ...properties, modified: "yesterday" },
    { ...properties, type: "link" },
    { ...properties, extra: 1 },
  ])
    expect(channels["docs.stat"].response.safeParse({ workbenchId, properties: bad }).success).toBe(false);
});

// REQ-FUNC-fe252a3c REQ-FUNC-593428f6 REQ-FUNC-aad416b5 REQ-FUNC-62ed1c20
it("opens, reveals and copies workbench entries through strict docs channels", () => {
  const workbenchId = "wb_01ARZ3NDEKTSV4RRFFQ69G5FAV";
  expect(channels["docs.openers"].request.parse({})).toEqual({});
  expect(channels["docs.openers"].response.parse({ apps: ["vscode", "terminal"] })).toEqual({
    apps: ["vscode", "terminal"],
  });
  expect(channels["docs.openers"].response.safeParse({ apps: ["emacs"] }).success).toBe(false);
  for (const app of ["vscode", "cursor", "notepadpp", "terminal"])
    expect(channels["docs.openWith"].request.parse({ workbenchId, path: "a.c", app })).toEqual({
      workbenchId,
      path: "a.c",
      app,
    });
  expect(channels["docs.openWith"].request.safeParse({ workbenchId, path: "a.c", app: "cmd" }).success).toBe(
    false,
  );
  expect(channels["docs.openWith"].request.safeParse({ workbenchId, path: "", app: "vscode" }).success).toBe(
    false,
  );
  expect(channels["docs.reveal"].request.parse({ workbenchId, path: "docs" })).toEqual({
    workbenchId,
    path: "docs",
  });
  expect(channels["docs.reveal"].request.safeParse({ workbenchId, path: "docs", extra: 1 }).success).toBe(
    false,
  );
  for (const form of ["absolute", "relative", "name"])
    expect(channels["docs.copyPath"].request.parse({ workbenchId, path: "a", form })).toEqual({
      workbenchId,
      path: "a",
      form,
    });
  expect(channels["docs.copyPath"].request.safeParse({ workbenchId, path: "a", form: "url" }).success).toBe(
    false,
  );
  for (const channel of ["docs.openWith", "docs.reveal", "docs.copyPath"] as const) {
    expect(channels[channel].response.parse({})).toEqual({});
    expect(channels[channel].response.safeParse({ text: "x" }).success).toBe(false);
  }
});

// REQ-FUNC-fe252a3c REQ-FUNC-ad5254e8 REQ-FUNC-6bf664d7
it("offers the system's Open with dialog and registered applications through strict channels", () => {
  const workbenchId = "wb_01ARZ3NDEKTSV4RRFFQ69G5FAV";
  expect(channels["docs.openers"].response.parse({ apps: ["vscode", "other"] }).apps).toEqual([
    "vscode",
    "other",
  ]);
  expect(channels["docs.openWith"].request.parse({ workbenchId, path: "a.png", app: "other" }).app).toBe(
    "other",
  );
  expect(channels["docs.systemApps"].request.parse({ workbenchId, path: "a.png" })).toEqual({
    workbenchId,
    path: "a.png",
  });
  const apps = [{ id: "org.gnome.eog.desktop", name: "Image Viewer" }];
  expect(channels["docs.systemApps"].response.parse({ apps })).toEqual({ apps });
  for (const bad of [
    { id: "eog", name: "x" },
    { id: "../x.desktop", name: "x" },
    { id: "a.desktop", name: "" },
  ])
    expect(channels["docs.systemApps"].response.safeParse({ apps: [bad] }).success, JSON.stringify(bad)).toBe(
      false,
    );
  expect(
    channels["docs.openSystemApp"].request.parse({ workbenchId, path: "a.png", app: "gimp.desktop" }).app,
  ).toBe("gimp.desktop");
  expect(
    channels["docs.openSystemApp"].request.safeParse({ workbenchId, path: "a.png", app: "/usr/bin/gimp" })
      .success,
  ).toBe(false);
  expect(channels["docs.openSystemApp"].response.parse({})).toEqual({});
});
