import { expect, it } from "vitest";
import { eventEnvelopeSchema } from "./events.js";
import { channels } from "./ipc.js";

const owner = {
  workbenchId: "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C",
  indexLease: 5,
  viewId: "c8518406-3a25-4ad6-b11d-20ca0197b0cf",
};

it("admits only owned status actions and workbench-scoped status updates", () => {
  const request = channels["git.status"].request;
  expect(request.parse({ ...owner, action: "open" })).toMatchObject(owner);
  expect(request.safeParse({ ...owner, action: "open", args: ["status"] }).success).toBe(false);
  expect(request.safeParse({ ...owner, action: "run" }).success).toBe(false);
  expect(request.safeParse({ ...owner, indexLease: 0, action: "open" }).success).toBe(false);
  const event = {
    type: "git.status",
    update: { ...owner, status: { state: "unsupported" }, watchLimited: false },
  };
  expect(eventEnvelopeSchema.safeParse({ topic: "workbench", id: owner.workbenchId, event }).success).toBe(
    true,
  );
  expect(
    eventEnvelopeSchema.safeParse({ topic: "workbench", id: "wb_00000000000000000000000001", event }).success,
  ).toBe(false);
});
