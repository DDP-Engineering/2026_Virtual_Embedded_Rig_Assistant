// REQ-SEC-6c43bda5, REQ-REL-45112294
import { describe, expect, it, vi } from "vitest";
import {
  type PdfHttpResponse,
  type PdfTransferPorts,
  publicDownloadAddress,
  transferPdf,
} from "./pdf-transfer.js";

const signal = () => new AbortController().signal;
const bytes = Buffer.from("%PDF-1.7\npublic binary\x00\xff\n%%EOF");
function reply(
  status = 200,
  body: Uint8Array[] = [bytes],
  headers: PdfHttpResponse["headers"] = { "content-type": "application/pdf" },
): PdfHttpResponse {
  return {
    status,
    headers,
    body: (async function* () {
      yield* body;
    })(),
    close: vi.fn(),
  };
}
function fixture(responses: PdfHttpResponse[] = [reply()]) {
  const resolve = vi.fn(async () => [{ address: "93.184.215.14", family: 4 }]);
  const connect = vi.fn<NonNullable<PdfTransferPorts["connect"]>>(async () => {
    const response = responses.shift();
    if (!response) throw Error("Unexpected HTTP request");
    return response;
  });
  return { resolve, connect };
}
it("preserves PDF bytes and pins validated DNS without sending credentials", async () => {
  const f = fixture();
  expect(await transferPdf("https://datasheets.example.org/file.pdf", signal(), f)).toEqual({
    data: bytes,
    finalUrl: "https://datasheets.example.org/file.pdf",
  });
  expect(f.resolve).toHaveBeenCalledExactlyOnceWith("datasheets.example.org");
  expect(f.connect.mock.calls[0]?.slice(0, 3)).toEqual([
    new URL("https://datasheets.example.org/file.pdf"),
    { address: "93.184.215.14", family: 4 },
    { Accept: "application/pdf", "Accept-Encoding": "identity", "User-Agent": "VERA" },
  ]);
});
describe("public destination boundary", () => {
  it.each([
    "http://127.0.0.1/a.pdf",
    "http://192.168.1.13/a.pdf",
    "http://[::1]/a.pdf",
    "file:///a.pdf",
    "https://user:password@example.org/a.pdf",
    "http://metadata.internal/a.pdf",
  ])("rejects %s before DNS or connect", async (url) => {
    const f = fixture();
    await expect(transferPdf(url, signal(), f)).rejects.toThrow(/public/i);
    expect(f.resolve).not.toHaveBeenCalled();
    expect(f.connect).not.toHaveBeenCalled();
  });
  it.each(["10.0.0.1", "169.254.169.254", "127.0.0.1", "192.168.2.1"])(
    "rejects mixed DNS answers containing %s",
    async (address) => {
      const f = fixture();
      f.resolve.mockResolvedValue([
        { address: "93.184.215.14", family: 4 },
        { address, family: 4 },
      ]);
      await expect(transferPdf("https://datasheets.example.org/a.pdf", signal(), f)).rejects.toThrow(
        /public/i,
      );
      expect(f.connect).not.toHaveBeenCalled();
    },
  );
  it.each(["::ffff:127.0.0.1", "64:ff9b::7f00:1", "2002:7f00:1::", "2001:db8::1", "fd00::1"])(
    "rejects nonpublic/tunneled IPv6 %s",
    (address) => {
      expect(publicDownloadAddress({ address, family: 6 })).toBe(false);
    },
  );
  it("accepts global IPv6 and refuses family mismatches", () => {
    expect(publicDownloadAddress({ address: "2606:4700:4700::1111", family: 6 })).toBe(true);
    expect(publicDownloadAddress({ address: "127.0.0.1", family: 6 })).toBe(false);
  });
  it("revalidates a redirect before contacting its private destination", async () => {
    const response = reply(302, [], { location: "http://127.0.0.1/admin.pdf" }),
      f = fixture([response]);
    await expect(transferPdf("https://datasheets.example.org/a.pdf", signal(), f)).rejects.toThrow(/public/i);
    expect(f.connect).toHaveBeenCalledTimes(1);
    expect(response.close).toHaveBeenCalledOnce();
  });
  it("pins a fresh DNS result for each public redirect", async () => {
    const f = fixture([reply(302, [], { location: "https://cdn.example.org/a.pdf" }), reply()]);
    f.resolve
      .mockResolvedValueOnce([{ address: "93.184.215.14", family: 4 }])
      .mockResolvedValueOnce([{ address: "1.1.1.1", family: 4 }]);
    expect((await transferPdf("https://datasheets.example.org/a.pdf", signal(), f)).finalUrl).toBe(
      "https://cdn.example.org/a.pdf",
    );
    expect(f.connect.mock.calls[1]?.[1]).toEqual({ address: "1.1.1.1", family: 4 });
  });
});
it.each([
  ["empty response", reply(200, [])],
  ["HTML", reply(200, [Buffer.from("<html>login</html>")], { "content-type": "text/html" })],
  ["forged MIME", reply(200, [Buffer.from("<html>login</html>")])],
  ["encoding", reply(200, [bytes], { "content-type": "application/pdf", "content-encoding": "gzip" })],
  ["oversize header", reply(200, [bytes], { "content-type": "application/pdf", "content-length": "1000" })],
  ["oversize stream", reply(200, [bytes, bytes, bytes])],
  ["short response", reply(200, [bytes], { "content-type": "application/pdf", "content-length": "50" })],
  ["HTTP error", reply(403)],
] as const)("rejects %s and closes the response", async (_name, response) => {
  await expect(
    transferPdf("https://datasheets.example.org/a.pdf", signal(), { ...fixture([response]), maxBytes: 64 }),
  ).rejects.toThrow();
  expect(response.close).toHaveBeenCalledOnce();
});
it("bounds redirect loops", async () => {
  const f = fixture(Array.from({ length: 6 }, () => reply(302, [], { location: "/again.pdf" })));
  await expect(transferPdf("https://datasheets.example.org/a.pdf", signal(), f)).rejects.toThrow(
    /redirect limit/i,
  );
  expect(f.connect).toHaveBeenCalledTimes(6);
});
it("accepts a binary-download MIME only when the body is a PDF", async () => {
  const f = fixture([reply(200, [bytes], { "content-type": "application/octet-stream" })]);
  expect((await transferPdf("https://datasheets.example.org/chip", signal(), f)).data).toEqual(bytes);
});
it("bounds stalled DNS and honors an already cancelled caller", async () => {
  const connect = vi.fn(),
    resolve = vi.fn(() => new Promise<never>(() => {}));
  await expect(
    transferPdf("https://datasheets.example.org/a.pdf", signal(), { resolve, connect, deadlineMs: 10 }),
  ).rejects.toThrow();
  const controller = new AbortController();
  controller.abort();
  await expect(
    transferPdf("https://datasheets.example.org/a.pdf", controller.signal, { resolve, connect }),
  ).rejects.toThrow();
  expect(connect).not.toHaveBeenCalled();
});
it("bounds a stalled connector or body independently of transport cancellation", async () => {
  const f = fixture();
  await expect(
    transferPdf("https://datasheets.example.org/a.pdf", signal(), {
      ...f,
      deadlineMs: 10,
      connect: () => new Promise<never>(() => {}),
    }),
  ).rejects.toThrow();
  const response = reply();
  response.body = { [Symbol.asyncIterator]: () => ({ next: () => new Promise<never>(() => {}) }) };
  await expect(
    transferPdf("https://datasheets.example.org/a.pdf", signal(), { ...fixture([response]), deadlineMs: 10 }),
  ).rejects.toThrow();
  expect(response.close).toHaveBeenCalledOnce();
}, 500);
