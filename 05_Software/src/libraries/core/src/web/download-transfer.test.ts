// REQ-SEC-6c43bda5, REQ-REL-45112294, REQ-FUNC-17f34e4b
import { describe, expect, it, vi } from "vitest";
import {
  CONNECT_PATIENCE_MS,
  type DownloadHttpResponse,
  type DownloadTransferPorts,
  publicDownloadAddress,
  transferFile,
} from "./download-transfer.js";

const signal = () => new AbortController().signal;
const bytes = Buffer.from("%PDF-1.7\npublic binary\x00\xff\n%%EOF");
function reply(
  status = 200,
  body: Uint8Array[] = [bytes],
  headers: DownloadHttpResponse["headers"] = { "content-type": "application/pdf" },
): DownloadHttpResponse {
  return {
    status,
    headers,
    body: (async function* () {
      yield* body;
    })(),
    close: vi.fn(),
  };
}
function fixture(responses: DownloadHttpResponse[] = [reply()]) {
  const chunks: Uint8Array[] = [];
  const resolve = vi.fn(async () => [{ address: "93.184.215.14", family: 4 }]);
  const connect = vi.fn<NonNullable<DownloadTransferPorts["connect"]>>(async () => {
    const response = responses.shift();
    if (!response) throw Error("Unexpected HTTP request");
    return response;
  });
  return {
    resolve,
    connect,
    chunks,
    write: async (chunk: Uint8Array) => {
      chunks.push(chunk);
    },
  };
}
it("preserves PDF bytes and pins validated DNS without sending credentials", async () => {
  const f = fixture();
  expect(await transferFile("https://datasheets.example.org/file.pdf", signal(), f)).toEqual({
    bytes: bytes.length,
    finalUrl: "https://datasheets.example.org/file.pdf",
    mime: "application/pdf",
  });
  expect(Buffer.concat(f.chunks)).toEqual(bytes);
  expect(f.resolve).toHaveBeenCalledExactlyOnceWith("datasheets.example.org");
  expect(f.connect.mock.calls[0]?.slice(0, 3)).toEqual([
    new URL("https://datasheets.example.org/file.pdf"),
    { address: "93.184.215.14", family: 4 },
    { Accept: "*/*", "Accept-Encoding": "identity", "User-Agent": "VERA" },
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
    await expect(transferFile(url, signal(), f)).rejects.toThrow(/public/i);
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
      await expect(transferFile("https://datasheets.example.org/a.pdf", signal(), f)).rejects.toThrow(
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
    await expect(transferFile("https://datasheets.example.org/a.pdf", signal(), f)).rejects.toThrow(
      /public/i,
    );
    expect(f.connect).toHaveBeenCalledTimes(1);
    expect(response.close).toHaveBeenCalledOnce();
  });
  it("pins a fresh DNS result for each public redirect", async () => {
    const f = fixture([reply(302, [], { location: "https://cdn.example.org/a.pdf" }), reply()]);
    f.resolve
      .mockResolvedValueOnce([{ address: "93.184.215.14", family: 4 }])
      .mockResolvedValueOnce([{ address: "1.1.1.1", family: 4 }]);
    expect((await transferFile("https://datasheets.example.org/a.pdf", signal(), f)).finalUrl).toBe(
      "https://cdn.example.org/a.pdf",
    );
    expect(f.connect.mock.calls[1]?.[1]).toEqual({ address: "1.1.1.1", family: 4 });
  });
});
it.each([
  ["a missing content type", {}],
  ["an empty content type", { "content-type": "" }],
  ["a malformed content type", { "content-type": "pdf" }],
  ["a repeated content type", { "content-type": "application/pdf, application/pdf" }],
] as const)("stores a reply with %s as a file of unknown kind", async (_name, headers) => {
  const f = fixture([reply(200, [bytes], headers)]);
  expect(await transferFile("https://files.example.org/board.bin", signal(), f)).toMatchObject({
    bytes: bytes.length,
    mime: "application/octet-stream",
  });
  expect(Buffer.concat(f.chunks)).toEqual(bytes);
});
it("stores a reply that carries a Content-Encoding as it was sent", async () => {
  // Identity was asked for; a server that marks its .tar.gz files as gzip-encoded still sends the archive.
  const archive = Buffer.from([0x1f, 0x8b, 8, 0, 0, 0, 0, 0]);
  const f = fixture([
    reply(200, [archive], { "content-type": "application/x-tar", "content-encoding": "x-gzip" }),
  ]);
  expect((await transferFile("https://files.example.org/sdk.tar.gz", signal(), f)).bytes).toBe(8);
  expect(Buffer.concat(f.chunks)).toEqual(archive);
});
describe("several resolved addresses", () => {
  const v6 = { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 };
  const v4 = { address: "93.184.215.14", family: 4 };
  it("downloads from the next address when the first cannot be reached", async () => {
    const f = fixture();
    f.resolve.mockResolvedValue([v6, v4]);
    f.connect.mockRejectedValueOnce(Object.assign(Error("connect ENETUNREACH"), { code: "ENETUNREACH" }));
    expect((await transferFile("https://files.example.org/a.pdf", signal(), f)).bytes).toBe(bytes.length);
    expect(f.connect.mock.calls.map((call) => call[1])).toEqual([v6, v4]);
  });
  it("moves on from an address that does not answer and gives the last one the whole budget", async () => {
    vi.useFakeTimers();
    try {
      const f = fixture();
      f.resolve.mockResolvedValue([v6, v4]);
      const abandoned = vi.fn();
      f.connect.mockImplementationOnce(
        (_url, _address, _headers, attempt) =>
          new Promise((_resolve, reject) => {
            attempt.addEventListener("abort", () => {
              abandoned();
              reject(attempt.reason);
            });
          }),
      );
      const pending = transferFile("https://files.example.org/a.pdf", signal(), f);
      await vi.advanceTimersByTimeAsync(CONNECT_PATIENCE_MS);
      expect((await pending).bytes).toBe(bytes.length);
      expect(abandoned).toHaveBeenCalledOnce();
      // The address that answered is not cut off when the patience of an earlier one would have run out.
      expect(f.connect.mock.calls[1]?.[3].aborted).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
  it("reports the last failure when no address can be reached", async () => {
    const f = fixture([]);
    f.resolve.mockResolvedValue([v6, v4]);
    f.connect
      .mockRejectedValueOnce(Error("connect ENETUNREACH"))
      .mockRejectedValueOnce(Error("connect ETIMEDOUT"));
    await expect(transferFile("https://files.example.org/a.pdf", signal(), f)).rejects.toThrow("ETIMEDOUT");
  });
});
it("names run_command for a destination on the local network", async () => {
  const f = fixture();
  await expect(transferFile("http://192.168.1.50/log.csv", signal(), f)).rejects.toThrow(/run_command/);
  f.resolve.mockResolvedValue([{ address: "10.0.0.7", family: 4 }]);
  await expect(transferFile("https://build.example.org/fw.bin", signal(), f)).rejects.toThrow(
    /public network destination.*run_command/,
  );
  expect(f.connect).not.toHaveBeenCalled();
});
it.each([
  ["oversize header", reply(200, [bytes], { "content-type": "application/pdf", "content-length": "1000" })],
  ["oversize stream", reply(200, [bytes, bytes, bytes])],
  ["short response", reply(200, [bytes], { "content-type": "application/pdf", "content-length": "50" })],
  ["HTTP error", reply(403)],
] as const)("rejects %s and closes the response", async (_name, response) => {
  await expect(
    transferFile("https://datasheets.example.org/a.pdf", signal(), { ...fixture([response]), maxBytes: 64 }),
  ).rejects.toThrow();
  expect(response.close).toHaveBeenCalledOnce();
});
it("bounds redirect loops", async () => {
  const f = fixture(Array.from({ length: 6 }, () => reply(302, [], { location: "/again.pdf" })));
  await expect(transferFile("https://datasheets.example.org/a.pdf", signal(), f)).rejects.toThrow(
    /redirect limit/i,
  );
  expect(f.connect).toHaveBeenCalledTimes(6);
});
it("preserves a binary-download MIME and its original bytes", async () => {
  const f = fixture([reply(200, [bytes], { "content-type": "application/octet-stream" })]);
  expect((await transferFile("https://datasheets.example.org/chip", signal(), f)).bytes).toBe(bytes.length);
  expect(Buffer.concat(f.chunks)).toEqual(bytes);
});
it.each([
  ["application/zip", Buffer.from("PK\x03\x04\x00\xff")],
  ["application/octet-stream", Buffer.from([0, 255, 1, 2])],
  ["text/csv; charset=utf-8", Buffer.from("time,voltage\n1,3.3\n")],
  ["text/plain", Buffer.alloc(0)],
])("transfers %s without imposing a PDF signature", async (mime, data) => {
  const f = fixture([reply(200, [data], { "content-type": mime })]);
  const result = await transferFile("https://example.org/file", signal(), f);
  expect(Buffer.concat(f.chunks)).toEqual(data);
  expect(result.bytes).toBe(data.length);
  expect(result.mime).toBe(mime.split(";")[0]);
});
it("bounds stalled DNS and honors an already cancelled caller", async () => {
  const connect = vi.fn(),
    resolve = vi.fn(() => new Promise<never>(() => {})),
    write = vi.fn(async () => {});
  await expect(
    transferFile("https://datasheets.example.org/a.pdf", signal(), {
      resolve,
      connect,
      write,
      deadlineMs: 10,
    }),
  ).rejects.toThrow();
  const controller = new AbortController();
  controller.abort();
  await expect(
    transferFile("https://datasheets.example.org/a.pdf", controller.signal, { resolve, connect, write }),
  ).rejects.toThrow();
  expect(connect).not.toHaveBeenCalled();
});
it("bounds a stalled connector or body independently of transport cancellation", async () => {
  const f = fixture();
  await expect(
    transferFile("https://datasheets.example.org/a.pdf", signal(), {
      ...f,
      deadlineMs: 10,
      connect: () => new Promise<never>(() => {}),
    }),
  ).rejects.toThrow();
  const response = reply();
  response.body = { [Symbol.asyncIterator]: () => ({ next: () => new Promise<never>(() => {}) }) };
  await expect(
    transferFile("https://datasheets.example.org/a.pdf", signal(), {
      ...fixture([response]),
      deadlineMs: 10,
    }),
  ).rejects.toThrow();
  expect(response.close).toHaveBeenCalledOnce();
}, 500);
