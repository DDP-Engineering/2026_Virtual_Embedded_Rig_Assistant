import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { ConsoleLogger, createNodeFiles, createPaths, MemoryCredentials, nodeClock } from "./host-ports.js";

it("retains registered credentials and scrubs valid JSON console lines including escaped keys/data", async () => {
  const lines: string[] = [],
    logger = new ConsoleLogger((line) => lines.push(line));
  const key = 'fictional-key-15-"\\\n';
  const unregister = logger.registerSecret(key);
  logger.log("error", key, { [key]: key });
  unregister();
  logger.log("info", key);
  await logger.flush();
  expect(lines).toHaveLength(2);
  expect(lines.map((line) => JSON.parse(line))).toEqual([
    { level: "error", message: "[REDACTED]", data: { "[REDACTED]": "[REDACTED]" } },
    { level: "info", message: "[REDACTED]" },
  ]);
});
it("serializes memory credential mutations, retains undefined values and honors aborts without corrupting state", async () => {
  const registered: string[] = [],
    store = new MemoryCredentials((key) => registered.push(key));
  await store.modify("openai", async () => ({ type: "api_key", key: "first" }));
  let release = () => {};
  const gate = new Promise<void>((done) => {
    release = done;
  });
  const update = store.modify("openai", async (current) => {
    expect(current).toEqual({ type: "api_key", key: "first" });
    await gate;
    return { type: "api_key", key: "second" };
  });
  const preserve = store.modify("openai", async (current) => {
    expect(current).toEqual({ type: "api_key", key: "second" });
    return undefined;
  });
  release();
  await update;
  await preserve;
  const result = await store.read("openai");
  if (result?.type === "api_key") result.key = "external";
  expect(await store.read("openai")).toEqual({ type: "api_key", key: "second" });
  const controller = new AbortController();
  await expect(
    store.modify(
      "openai",
      async () => {
        controller.abort();
        return { type: "api_key", key: "aborted" };
      },
      { signal: controller.signal },
    ),
  ).rejects.toBeDefined();
  expect(await store.read("openai")).toEqual({ type: "api_key", key: "second" });
  expect(await store.list()).toEqual([{ providerId: "openai", type: "api_key" }]);
  await store.delete("openai");
  expect(await store.read("openai")).toBeUndefined();
  expect(registered).toEqual(["first", "second"]);
  await store.close();
});
it("cleans owned temporary paths and preserves supplied data plus atomic backup bytes", async () => {
  const owned = await createPaths(),
    path = owned.paths.userData;
  await owned.close();
  await expect(readFile(join(path, "settings.json"))).rejects.toMatchObject({ code: "ENOENT" });
  const dir = await mkdtemp(join(tmpdir(), "vera-cli-port-"));
  try {
    const supplied = await createPaths(dir),
      files = createNodeFiles(nodeClock);
    await writeFile(join(dir, "keep"), "original");
    await files.writeAtomic(supplied.paths.settings, "exact\nbytes");
    expect(await files.backup(join(dir, "backup"), "original\n")).toBe(true);
    expect(await files.backup(join(dir, "backup"), "replacement")).toBe(false);
    await supplied.close();
    expect(await readFile(join(dir, "keep"), "utf8")).toBe("original");
    expect(await files.read(supplied.paths.settings)).toBe("exact\nbytes");
    expect(await readFile(join(dir, "backup"), "utf8")).toBe("original\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
