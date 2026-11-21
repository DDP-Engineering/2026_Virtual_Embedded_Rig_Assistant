import { expect, it } from "vitest";
import { veraErrorSchema } from "./errors.js";
import { appEventSchema } from "./events.js";
import { channels } from "./ipc.js";

// REQ-FUNC-33cd5f9f
it("reads the active turn count and the limit across workbenches", () => {
  const channel = channels["session.capacity"];
  expect(channel.request.parse({})).toEqual({});
  expect(channel.request.safeParse({ workbenchId: "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0A" }).success).toBe(false);
  expect(channel.response.parse({ active: 4, limit: 3 })).toEqual({ active: 4, limit: 3 });
  for (const invalid of [
    { active: -1, limit: 3 },
    { active: 1, limit: 0 },
    { active: 1.5, limit: 3 },
    { active: 1 },
    { active: 1, limit: 3, extra: true },
  ])
    expect(channel.response.safeParse(invalid).success).toBe(false);
});

// REQ-FUNC-33cd5f9f
it("announces a changed count or limit as an application event with both values", () => {
  const event = { type: "session.capacity", active: 2, limit: 3 };
  expect(appEventSchema.parse(event)).toEqual(event);
  expect(appEventSchema.safeParse({ type: "session.capacity" }).success).toBe(false);
  expect(appEventSchema.safeParse({ ...event, workbenchId: "x" }).success).toBe(false);
});

// REQ-FUNC-52e97b95
it("types the refusal at the limit as TURN_LIMIT with the limit", () => {
  const error = { code: "TURN_LIMIT", messageKey: "errors.TURN_LIMIT", params: { limit: 3 } };
  expect(veraErrorSchema.parse(error)).toEqual(error);
});
