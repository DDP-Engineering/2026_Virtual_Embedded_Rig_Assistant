// REQ-FUNC-b975a8b5, REQ-DATA-fd1933a1, REQ-REL-45112294, REQ-REL-39e8cc78, REQ-FUNC-4c3f4f0c
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { link, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { WriteQueue } from "../workbench/write-queue.js";
import { ConfiguredWebProvider } from "./configured-provider.js";
import { createDownloadPdfExtractor, WebDownloads } from "./downloads.js";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const bytes = Buffer.from("%PDF-1.7\n\x00\xfflocal PDF fixture\n%%EOF");
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "vera-pdf-store-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".vera"));
  const settings = { enabled: true, provider: "brave" as const, authentication: "api-key" as const };
  const getKey = vi.fn(async () => undefined);
  const access = new ConfiguredWebProvider({ config: () => settings, getKey });
  cleanups.push(() => access.close());
  const pdf = vi.fn(async () => ({ kind: "pdf" as const, pages: ["Page one", "Page two"] }));
  const transfer = vi.fn(async (_url: string, _signal: AbortSignal) => ({
    data: bytes,
    finalUrl: "https://cdn.example.org/chip.pdf",
    mime: "application/pdf",
  }));
  const store = new WebDownloads(root, { access, pdf, transfer });
  cleanups.push(() => store.close());
  const context = {
    sessionId: `ses_${"0".repeat(26)}`,
    callId: "download-1",
    now: () => "2026-10-30T12:00:00.000Z",
    queue: new WriteQueue(),
    assertWritable: vi.fn(),
  };
  const target = store.allocate("https://datasheets.example.org/chip.pdf");
  return { root, settings, getKey, access, pdf, transfer, store, context, target };
}
it("stores exact immutable binary/provenance, reopens offline, and never creates a docs folder", async () => {
  const f = await fixture();
  const record = await f.store.save(f.target, f.context, new AbortController().signal);
  expect(record).toMatchObject({
    ...f.target,
    mime: "application/pdf",
    bytes: bytes.length,
    pages: 2,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    sessionId: f.context.sessionId,
  });
  expect(await readFile(join(f.root, record.path))).toEqual(bytes);
  expect(f.getKey).not.toHaveBeenCalled();
  f.settings.enabled = false;
  const content = await f.store.open(record.downloadId);
  expect(Buffer.from(content.data, "base64")).toEqual(bytes);
  expect(content.pages).toEqual(["Page one", "Page two"]);
  expect(await f.store.list()).toEqual([record]);
  expect(existsSync(join(f.root, "docs"))).toBe(false);
  const second = new WebDownloads(f.root, { access: f.access, pdf: f.pdf, transfer: f.transfer });
  cleanups.push(() => second.close());
  expect(await second.list()).toEqual([record]);
});
it("uses fresh identities for repeated names and refuses overwriting an existing identity", async () => {
  const f = await fixture();
  const first = await f.store.save(f.target, f.context, new AbortController().signal);
  const second = await f.store.save(
    f.store.allocate(f.target.sourceUrl),
    f.context,
    new AbortController().signal,
  );
  expect(second.path).not.toBe(first.path);
  await expect(f.store.save(f.target, f.context, new AbortController().signal)).rejects.toBeDefined();
  expect(await f.store.list()).toHaveLength(2);
  expect(await readFile(join(f.root, first.path))).toEqual(bytes);
});
it.each([
  ["archive.zip", "application/zip", Buffer.from("PK\x03\x04\x00\xff")],
  ["firmware.bin", "application/octet-stream", Buffer.from([0, 255, 1, 2])],
  ["measurements.csv", "text/csv", Buffer.from("time,voltage\n1,3.3\n")],
  ["notes.txt", "text/plain", Buffer.from("Bench notes")],
  ["manifest.json", "application/json", Buffer.from('{"board":"ESP32"}')],
  ["empty.txt", "text/plain", Buffer.alloc(0)],
])("stores and lists %s exactly without invoking the PDF parser", async (name, mime, data) => {
  const f = await fixture();
  f.transfer.mockResolvedValue({ data, mime, finalUrl: `https://cdn.example.org/${name}` });
  const target = f.store.allocate(`https://example.org/${name}`);
  const record = await f.store.save(target, f.context, new AbortController().signal);
  expect(record).toMatchObject({ name, mime, bytes: data.length });
  expect(record.pages).toBeUndefined();
  expect(await readFile(join(f.root, record.path))).toEqual(data);
  expect(await f.store.list()).toEqual([record]);
  expect(f.pdf).not.toHaveBeenCalled();
  await expect(f.store.open(record.downloadId)).rejects.toMatchObject({ code: "INVALID" });
});
it.each([
  "../escape.pdf",
  "C:\\escape.pdf",
  "CON.pdf",
  ".vera-download.json",
  "a.pdf:stream",
  ".pdf/../a.pdf",
])("refuses nonportable name %s before transfer", async (filename) => {
  const f = await fixture();
  expect(() => f.store.allocate(f.target.sourceUrl, filename)).toThrow();
  expect(f.transfer).not.toHaveBeenCalled();
});
it("detects changed PDF bytes and rejects malformed identifiers or manifest identities", async () => {
  const f = await fixture();
  const record = await f.store.save(f.target, f.context, new AbortController().signal);
  await writeFile(join(f.root, record.path), "%PDF-1.7\nchanged");
  await expect(f.store.open(record.downloadId)).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(f.store.open("../../outside")).rejects.toMatchObject({ code: "INVALID" });
  await writeFile(
    join(f.root, ".vera/downloads", record.downloadId, ".vera-download.json"),
    JSON.stringify({ ...record, path: "../outside.pdf" }),
  );
  await expect(f.store.open(record.downloadId)).rejects.toBeDefined();
  expect(await f.store.list()).toEqual([]);
});
it("rejects a linked managed directory without touching the outside sentinel", async () => {
  const f = await fixture(),
    outside = join(f.root, "outside");
  await mkdir(outside);
  await writeFile(join(outside, "sentinel"), "keep");
  await symlink(outside, join(f.root, ".vera/downloads"), process.platform === "win32" ? "junction" : "dir");
  await expect(f.store.save(f.target, f.context, new AbortController().signal)).rejects.toMatchObject({
    code: "DENIED",
  });
  expect(await readdir(outside)).toEqual(["sentinel"]);
});
it("rejects hard-linked PDF bytes before parsing", async () => {
  const f = await fixture();
  const record = await f.store.save(f.target, f.context, new AbortController().signal);
  await link(join(f.root, record.path), join(f.root, "outside.pdf"));
  f.pdf.mockClear();
  await expect(f.store.open(record.downloadId)).rejects.toMatchObject({ code: "DENIED" });
  expect(f.pdf).not.toHaveBeenCalled();
});
it("cleans unpublished files when live ownership is lost during publication", async () => {
  const f = await fixture();
  const staged = join(f.root, ".vera/downloads", `.pending-${f.target.downloadId}`, f.target.name);
  f.context.assertWritable.mockImplementation(() => {
    if (existsSync(staged)) throw Error("Ownership lost");
  });
  await expect(f.store.save(f.target, f.context, new AbortController().signal)).rejects.toThrow(/ownership/i);
  expect(await readdir(join(f.root, ".vera/downloads"))).toEqual([]);
});
it("rechecks authority at the completed rename and removes an unaccepted publication", async () => {
  const f = await fixture();
  f.context.assertWritable.mockImplementation(() => {
    if (existsSync(join(f.root, f.target.path))) throw Error("Ownership lost at publication");
  });
  await expect(f.store.save(f.target, f.context, new AbortController().signal)).rejects.toThrow(/ownership/i);
  expect(await readdir(join(f.root, ".vera/downloads"))).toEqual([]);
});
it("reports missing files and corrupt manifests through the current structured error contract", async () => {
  const f = await fixture();
  const record = await f.store.save(f.target, f.context, new AbortController().signal);
  await rm(join(f.root, record.path));
  await expect(f.store.open(record.downloadId)).rejects.toMatchObject({ code: "NOT_FOUND" });
  await writeFile(join(f.root, ".vera/downloads", record.downloadId, ".vera-download.json"), "not JSON");
  await expect(f.store.open(record.downloadId)).rejects.toMatchObject({ code: "INVALID" });
});
it("blocks global-disabled downloads before network and cancels a pending request on revocation", async () => {
  const f = await fixture();
  f.settings.enabled = false;
  await expect(f.store.save(f.target, f.context, new AbortController().signal)).rejects.toThrow(/disabled/i);
  expect(f.transfer).not.toHaveBeenCalled();
  f.settings.enabled = true;
  f.transfer.mockImplementation(
    async (_url, signal) =>
      new Promise((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
      ),
  );
  const pending = f.store.save(f.target, f.context, new AbortController().signal);
  await vi.waitFor(() => expect(f.transfer).toHaveBeenCalledOnce());
  f.settings.enabled = false;
  f.access.revoke();
  await expect(pending).rejects.toThrow(/cancel/i);
  expect(await f.store.list()).toEqual([]);
});
it("validates real PDF pages before saving and rejects corrupt or fake PDF bodies", async () => {
  const f = await fixture();
  const pdf = createDownloadPdfExtractor(new URL("../knowledge/pdf-worker.ts", import.meta.url));
  const valid = await readFile(
    "tests/fixtures/workbenches/demo-board/docs/vera-demo-01-reference-manual.pdf",
  );
  const store = new WebDownloads(f.root, {
    access: f.access,
    pdf,
    transfer: async () => ({ data: valid, finalUrl: f.target.sourceUrl, mime: "application/pdf" }),
  });
  cleanups.push(() => store.close());
  const record = await store.save(f.target, f.context, new AbortController().signal);
  expect(record.pages).toBeGreaterThan(1);
  if (record.pages === undefined) throw Error("PDF page count missing");
  expect((await store.open(record.downloadId)).pages).toHaveLength(record.pages);
  for (const data of [Buffer.from("%PDF-1.7\nnot a document"), Buffer.from("<html>Login</html>")]) {
    const invalid = new WebDownloads(f.root, {
      access: f.access,
      pdf,
      transfer: async () => ({ data, finalUrl: f.target.sourceUrl, mime: "application/pdf" }),
    });
    cleanups.push(() => invalid.close());
    await expect(
      invalid.save(invalid.allocate(f.target.sourceUrl), f.context, new AbortController().signal),
    ).rejects.toBeDefined();
  }
  expect(await store.list()).toHaveLength(1);
}, 20_000);
it("publishes nothing when the PDF parser requests a password", async () => {
  const f = await fixture();
  f.pdf.mockRejectedValueOnce(Object.assign(Error("Password required"), { name: "PasswordException" }));
  await expect(f.store.save(f.target, f.context, new AbortController().signal)).rejects.toThrow(/password/i);
  expect(await f.store.list()).toEqual([]);
});
