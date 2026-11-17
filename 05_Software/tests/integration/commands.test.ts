import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { commandPlatformProbe } from "../support/command-platform-probe.js";

it("runs actual commands, closed stdin, clean environment and background process trees", async () => {
  const root = await mkdtemp(join(tmpdir(), "vera-term01-"));
  try {
    const receipt = await commandPlatformProbe(root);
    expect(receipt.background).toMatchObject({ allDead: true });
    expect(receipt.lifecycle).toEqual({ sessionStop: true, appStop: true });
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}, 60000);
