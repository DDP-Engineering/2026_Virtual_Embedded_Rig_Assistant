import { once } from "node:events";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { Socket } from "node:net";
import { beforeAll, expect, it } from "vitest";

let guard: typeof import("../support/network-guard.js");
beforeAll(async () => {
  expect(
    existsSync(new URL("../support/network-guard.ts", import.meta.url)),
    "core test egress guard exists",
  ).toBe(true);
  guard = await import("../support/network-guard.js");
});
it("fails non-loopback fetch and socket before traffic, permits loopback", async () => {
  guard.installTestNetworkGuard();
  await expect(fetch("https://example.invalid/")).rejects.toThrow("Non-loopback");
  const socket = new Socket();
  expect(() => socket.connect({ host: "example.invalid", port: 443 })).toThrow("Non-loopback");
  socket.destroy();
  expect(guard.takeNetworkAttempts()).toHaveLength(2);
  const server = createServer((_req, res) => res.end("scripted"));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw Error("address");
    expect(await (await fetch(`http://127.0.0.1:${address.port}/`)).text()).toBe("scripted");
    expect(guard.takeNetworkAttempts()).toEqual([]);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
