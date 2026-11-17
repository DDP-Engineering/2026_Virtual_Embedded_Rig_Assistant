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

it("masks every descriptive program status field while retaining schema identities", () => {
  const status = {
    name: "tool",
    kind: "find",
    state: "ready",
    version: "secret",
    range: "secret",
    path: "/secret/tool",
    detail: "secret",
    hint: "secret",
    link: "https://secret.example",
  } as const;
  const projected = scrubProgramStatuses([status], (value) => value.replaceAll("secret", "[REDACTED]"));
  expect(projected[0]).toEqual({
    ...status,
    version: "[REDACTED]",
    range: "[REDACTED]",
    path: "/[REDACTED]/tool",
    detail: "[REDACTED]",
    hint: "[REDACTED]",
    link: "https://[REDACTED].example",
  });
  expect(pluginProgramStatusSchema.array().parse(projected)).toEqual(projected);
  expect(scrubProgramStatuses([status], (value) => value)).toEqual([status]);
});
