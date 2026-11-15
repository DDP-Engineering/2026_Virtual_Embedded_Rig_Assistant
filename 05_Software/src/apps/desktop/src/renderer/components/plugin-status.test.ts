// @vitest-environment jsdom
import type { PluginProgramStatus } from "@vera/shared";
import { expect, it } from "vitest";
import { dependencyCheck } from "./plugin-status.js";

const program = (more: Partial<PluginProgramStatus>): PluginProgramStatus => ({
  name: "tool",
  kind: "pip",
  state: "ready",
  ...more,
});

// REQ-UX-157f139c
it("derives the Dependencies check from the program statuses and the required plugins", () => {
  expect(dependencyCheck(undefined, false, [])).toEqual({ state: "unchecked", names: [] });
  expect(dependencyCheck([], false, [])).toEqual({ state: "ready", names: [] });
  expect(dependencyCheck([program({})], false, [])).toEqual({ state: "ready", names: [] });
  expect(dependencyCheck(undefined, true, [])).toEqual({ state: "unavailable", names: [] });
  expect(
    dependencyCheck(
      [
        program({ name: "a", state: "unavailable", problem: "version" }),
        program({ name: "b", state: "missing" }),
      ],
      false,
      ["serial-monitor"],
    ),
  ).toEqual({ state: "unavailable", names: ["a"] });
  // A required plugin counts before any check.
  expect(dependencyCheck(undefined, false, ["serial-monitor"])).toEqual({
    state: "missing",
    names: ["serial-monitor"],
  });
  expect(
    dependencyCheck(
      [
        program({ name: "pip-tool", state: "missing" }),
        program({ name: "vendor", kind: "find", state: "missing" }),
      ],
      false,
      [],
    ),
  ).toEqual({ state: "missing", names: ["pip-tool"] });
  expect(dependencyCheck([program({ name: "vendor", kind: "find", state: "missing" })], false, [])).toEqual({
    state: "external",
    names: ["vendor"],
  });
  // A found external installation of a program VERA cannot download is the vendor's too.
  expect(dependencyCheck([program({ name: "ext", state: "missing", external: true })], false, [])).toEqual({
    state: "external",
    names: ["ext"],
  });
});
