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
