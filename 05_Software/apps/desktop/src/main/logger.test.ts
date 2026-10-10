import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, expect, it } from "vitest";

let createLogger: typeof import("./logger.js").createLogger;
beforeAll(async () => {
  expect(existsSync(new URL("./logger.ts", import.meta.url)), "redacting daily logger exists").toBe(true);
  ({ createLogger } = await import("./logger.js"));
});
it("writes levels and timestamps as JSON lines and retains seven newest daily files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vera-logs-"));
  try {
    await writeFile(join(dir, "notes.txt"), "keep");
    let date = new Date("2026-10-01T23:00:00Z");
    const logger = createLogger(dir, { now: () => date, sleep: async () => {} });
    for (let day = 1; day <= 9; day++) {
      date = new Date(`2026-10-${String(day).padStart(2, "0")}T23:00:00Z`);
      for (const level of ["debug", "info", "warn", "error"] as const) logger.log(level, "entry", { day });
    }
    await logger.flush();
    expect((await readdir(dir)).sort()).toEqual([
      "notes.txt",
      ...Array.from({ length: 7 }, (_, i) => `vera-2026-10-0${i + 3}.log`),
    ]);
    const lines = (await readFile(join(dir, "vera-2026-10-09.log"), "utf8"))
      .trim()
      .split("\n")
      .map((s) => JSON.parse(s));
    expect(lines.map((line) => line.level)).toEqual(["debug", "info", "warn", "error"]);
    expect(lines[0]).toEqual({
      timestamp: "2026-10-09T23:00:00.000Z",
      level: "debug",
      message: "entry",
      data: { day: 9 },
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it("registered secrets never appear in any line, including escaped nested values and keys", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vera-redact-"));
  try {
    const logger = createLogger(dir, { now: () => new Date("2026-10-10T00:00:00Z"), sleep: async () => {} });
    const secrets = ["api-token-123", 'quote"slash\\newline\nsecret', "api-token"];
    const stop = logger.registerSecret(secrets[0] ?? "");
    logger.registerSecret(secrets[1] ?? "");
    logger.registerSecret(secrets[2] ?? "");
    for (const level of ["debug", "info", "warn", "error"] as const)
      logger.log(level, secrets.join(" ") + secrets.join(" "), { [secrets[0] ?? ""]: { nested: secrets } });
    await logger.flush();
    const content = await readFile(join(dir, "vera-2026-10-10.log"), "utf8");
    for (const secret of secrets) {
      expect(content).not.toContain(secret);
      expect(content).not.toContain(JSON.stringify(secret).slice(1, -1));
    }
    for (const line of content.trim().split("\n")) expect(JSON.parse(line).message).toContain("[REDACTED]");
    stop();
    stop();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it("flush reports I/O failure and subsequent logging recovers", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vera-log-failure-"));
  try {
    const blocked = join(dir, "logs");
    await writeFile(blocked, "file blocks directory");
    const logger = createLogger(blocked, {
      now: () => new Date("2026-10-10T00:00:00Z"),
      sleep: async () => {},
    });
    logger.log("error", "first");
    await expect(logger.flush()).rejects.toThrow();
    await rm(blocked);
    logger.log("info", "second");
    await logger.flush();
    expect(await readFile(join(blocked, "vera-2026-10-10.log"), "utf8")).toContain("second");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it("redaction preserves valid JSON when registered text includes JSON delimiters", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vera-redact-json-"));
  try {
    const logger = createLogger(dir, { now: () => new Date("2026-10-10T00:00:00Z"), sleep: async () => {} });
    logger.registerSecret('"data"');
    logger.log("info", 'contains "data"', { value: '"data"' });
    await logger.flush();
    const line = await readFile(join(dir, "vera-2026-10-10.log"), "utf8");
    expect(JSON.parse(line)).toMatchObject({
      level: "info",
      message: "contains [REDACTED]",
      data: { value: "[REDACTED]" },
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
