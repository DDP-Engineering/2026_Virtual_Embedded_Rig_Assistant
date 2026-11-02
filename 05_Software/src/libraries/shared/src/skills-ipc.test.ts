import { expect, it } from "vitest";
import { channels } from "./ipc.js";

const scope = { workbenchId: "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C" };
it("validates strict skill scope/source/name/content/hash without renderer path authority", () => {
  expect(channels["skills.create"].request.parse({ ...scope, name: "reader", source: "user" })).toBeTruthy();
  for (const request of [
    { ...scope, name: "../reader", source: "user" },
    { ...scope, name: "reader", source: "user", path: "C:/secret" },
    { ...scope, name: "reader", source: "other" },
  ])
    expect(channels["skills.create"].request.safeParse(request).success).toBe(false);
  expect(
    channels["skills.save"].request.safeParse({
      ...scope,
      name: "reader",
      source: "user",
      content: "text",
      sha256: "old",
    }).success,
  ).toBe(false);
  expect(
    channels["skills.list"].response.parse([
      { name: "bad", source: "workbench", description: "", enabled: true, error: "name" },
    ]),
  ).toHaveLength(1);
});
it("lists plugin skills but refuses plugin targets for open, create and save (REQ-SEC-f7e4f258)", () => {
  expect(
    channels["skills.list"].response.parse([
      { name: "echo-guide", source: "plugin", plugin: "echo-tools", description: "Guide.", enabled: true },
    ]),
  ).toHaveLength(1);
  for (const channel of ["skills.open", "skills.create"] as const) {
    expect(
      channels[channel].request.safeParse({ ...scope, name: "echo-guide", source: "plugin" }).success,
    ).toBe(false);
    expect(
      channels[channel].request.safeParse({ ...scope, name: "echo-guide", source: "workbench" }).success,
    ).toBe(true);
  }
  const save = { ...scope, name: "echo-guide", content: "x", sha256: "a".repeat(64) };
  expect(channels["skills.save"].request.safeParse({ ...save, source: "plugin" }).success).toBe(false);
  expect(channels["skills.save"].request.safeParse({ ...save, source: "user" }).success).toBe(true);
});
