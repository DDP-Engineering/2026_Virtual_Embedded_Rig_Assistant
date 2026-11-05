import { pluginProgramStatusSchema } from "@vera/shared";
import { expect, it } from "vitest";
import { scrubProgramStatuses } from "./program-statuses.js";

it("bounds expanded redaction while preserving a valid useful dependency failure", () => {
  const statuses = scrubProgramStatuses(
    [
      {
        name: "tool",
        kind: "find",
        state: "unavailable",
        problem: "version",
        detail: "x".repeat(2000),
        hint: "x".repeat(1024),
        link: "x".repeat(1024),
      },
    ],
    (value) => value.replaceAll("x", "[REDACTED]"),
  );
  expect(pluginProgramStatusSchema.array().safeParse(statuses).success).toBe(true);
  expect(JSON.stringify(statuses)).not.toContain("x");
  expect(statuses[0]?.detail).toHaveLength(2000);
  expect(statuses[0]?.hint).toHaveLength(1024);
  expect(statuses[0]?.link).toHaveLength(1024);
});
