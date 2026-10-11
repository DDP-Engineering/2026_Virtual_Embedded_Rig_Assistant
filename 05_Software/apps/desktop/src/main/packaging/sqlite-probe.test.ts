import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { expect, it } from "vitest";
import { exerciseDatabase, probeSqlite } from "./sqlite-probe.js";

it("queries real native WAL unicode61 and trigram databases and reports node:sqlite", async () => {
  const result = await probeSqlite();
  expect(result.primary.status).toBe("passed");
  expect(result.primary.walFile).toBe(true);
  expect(result.primary.trigram).toEqual({ text: "I2C1_CR1 enables the peripheral clock" });
  expect(result.primary.loadMs).toBeGreaterThanOrEqual(0);
  // Node's availability is a measured fallback outcome, not assumed Electron parity.
  expect(["passed", "unavailable"]).toContain(result.fallback.status);
});

it("cleans its unique temporary folder when opening the native database fails", async () => {
  let path = "";
  await expect(
    exerciseDatabase((databasePath) => {
      path = databasePath;
      throw new Error("open failed");
    }),
  ).rejects.toThrow("open failed");
  expect(existsSync(dirname(path))).toBe(false);
});
