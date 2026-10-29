import { expect, it } from "vitest";
import { channels } from "./ipc.js";

it("accepts only explicit archive booleans and a valid session identity", () => {
  const input = { sessionId: "ses_01ARZ3NDEKTSV4RRFFQ69G5FAV", archived: true };
  expect(channels["session.archive.set"].request.parse(input)).toEqual(input);
  for (const value of [
    { ...input, archived: "yes" },
    { sessionId: input.sessionId },
    { ...input, sessionId: "bad" },
    { ...input, extra: 1 },
  ])
    expect(channels["session.archive.set"].request.safeParse(value).success).toBe(false);
});
