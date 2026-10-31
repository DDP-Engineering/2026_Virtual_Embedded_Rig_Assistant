import { once } from "node:events";
import { connect as connectTcp, createServer } from "node:net";
import { session } from "electron";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createDesktopDownloadTransfer, createDownloadTunnel } from "./download-transfer.js";

const { lookup } = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup }));
vi.mock("electron", () => ({ session: { fromPartition: vi.fn() } }));
const fetch = vi.fn();
const setProxy = vi.fn(async () => {});
const closeAllConnections = vi.fn(async () => {});
beforeEach(() => {
  lookup.mockResolvedValue([{ address: "93.184.215.14", family: 4 }]);
  vi.mocked(session.fromPartition).mockReturnValue({ fetch, setProxy, closeAllConnections } as never);
});
afterEach(() => vi.resetAllMocks());

it("uses anonymous Chromium fetch, validates redirects and reuses only cleaned sessions", async () => {
  fetch
    .mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: "https://cdn.example.org/data.zip" } }),
    )
    .mockResolvedValueOnce(
      new Response(new Uint8Array([80, 75, 0, 255]), { headers: { "content-type": "application/zip" } }),
    )
    .mockResolvedValueOnce(new Response("text", { headers: { "content-type": "text/plain" } }));
  const transfer = createDesktopDownloadTransfer();
  const first = await transfer("https://example.org/data.zip", new AbortController().signal);
  expect(first).toMatchObject({ mime: "application/zip", data: Buffer.from([80, 75, 0, 255]) });
  expect(fetch.mock.calls[0]?.[1]).toMatchObject({
    credentials: "omit",
    redirect: "manual",
    cache: "no-store",
  });
  expect(fetch.mock.calls[0]?.[1].headers).not.toHaveProperty("Authorization");
  expect(fetch.mock.calls[0]?.[1].headers).not.toHaveProperty("Cookie");
  expect(lookup.mock.calls.map(([host]) => host)).toEqual(["example.org", "cdn.example.org"]);
  expect(closeAllConnections).toHaveBeenCalledOnce();
  expect(setProxy).toHaveBeenLastCalledWith({ mode: "direct" });
  await transfer("https://example.org/notes.txt", new AbortController().signal);
  expect(session.fromPartition).toHaveBeenCalledTimes(1);
  expect(closeAllConnections).toHaveBeenCalledTimes(2);
});
it("rejects private DNS and redirect targets before Chromium contacts them", async () => {
  const transfer = createDesktopDownloadTransfer();
  lookup.mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
  await expect(transfer("https://example.org/file", new AbortController().signal)).rejects.toThrow(/public/i);
  expect(fetch).not.toHaveBeenCalled();
  fetch.mockResolvedValueOnce(
    new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private" } }),
  );
  await expect(transfer("https://example.org/file", new AbortController().signal)).rejects.toThrow(/public/i);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(closeAllConnections).toHaveBeenCalledTimes(2);
});
it("aborts stalled Chromium requests and releases the tunnel", async () => {
  const controller = new AbortController();
  fetch.mockImplementation(
    async (_url, options: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
      }),
  );
  const pending = createDesktopDownloadTransfer()("https://example.org/file", controller.signal);
  const outcome = expect(pending).rejects.toBeDefined();
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  controller.abort();
  await outcome;
  expect(closeAllConnections).toHaveBeenCalledOnce();
  expect(setProxy).toHaveBeenLastCalledWith({ mode: "direct" });
});
it("tunnels only the exact approved authority to the supplied public IP", async () => {
  const upstream = createServer((socket) => socket.pipe(socket));
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const address = upstream.address();
  if (!address || typeof address === "string") throw Error("Fixture port missing");
  const dial = vi.fn((_options: { host: string; family: number; port: number }) =>
    connectTcp(address.port, "127.0.0.1"),
  );
  const tunnel = await createDownloadTunnel(dial);
  const target = { address: "93.184.215.14", family: 4 };
  tunnel.pin(new URL("https://datasheets.example.org/file"), target);
  const port = Number(new URL(tunnel.proxy).port);
  try {
    const rejected = connectTcp(port, "127.0.0.1");
    rejected.write("CONNECT other.example.org:443 HTTP/1.1\r\nHost: other.example.org:443\r\n\r\n");
    expect(String((await once(rejected, "data"))[0])).toContain("403 Forbidden");
    rejected.destroy();
    expect(dial).not.toHaveBeenCalled();
    expect(() =>
      tunnel.pin(new URL("https://example.org/file"), { address: "192.168.1.1", family: 4 }),
    ).toThrow(/public/i);
    const accepted = connectTcp(port, "127.0.0.1");
    accepted.write("CONNECT datasheets.example.org:443 HTTP/1.1\r\nHost: datasheets.example.org:443\r\n\r\n");
    expect(String((await once(accepted, "data"))[0])).toContain("200 Connection Established");
    expect(dial).toHaveBeenCalledExactlyOnceWith({ host: target.address, family: 4, port: 443 });
    accepted.write("TLS bytes pass through unchanged");
    expect(String((await once(accepted, "data"))[0])).toBe("TLS bytes pass through unchanged");
    accepted.destroy();
  } finally {
    await tunnel.close();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  }
});
