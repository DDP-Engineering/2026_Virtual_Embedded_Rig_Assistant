import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { acquireGuard, guardName } from "./guard.js";

it("native IPC guard is exclusive across processes and disappears on process crash", async () => {
  const root = await mkdtemp(join(tmpdir(), "vera-guard-"));
  await mkdir(join(root, ".vera"));
  const module = new URL("./guard.ts", import.meta.url).href;
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import { acquireGuard } from ${JSON.stringify(module)};
    const release = await acquireGuard(${JSON.stringify(root)});
    process.send(Boolean(release));
  `,
    ],
    { stdio: ["ignore", "pipe", "pipe", "ipc"] },
  );
  const exited = once(child, "exit");
  let output = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  try {
    const ready = once(child, "message");
    expect(
      await Promise.race([
        ready,
        exited.then(() => {
          throw new Error(output);
        }),
      ]),
    ).toEqual([true, undefined]);
    expect(await acquireGuard(root)).toBeUndefined();
    child.kill("SIGKILL");
    await exited;
    const release = await acquireGuard(root);
    expect(release).toBeTypeOf("function");
    await release?.();
    const next = await acquireGuard(root);
    expect(next).toBeTypeOf("function");
    await next?.();
    expect(guardName(root).length).toBeLessThan(107);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await exited;
    }
    await rm(root, { recursive: true, force: true });
  }
});
