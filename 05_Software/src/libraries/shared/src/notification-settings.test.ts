import { expect, it } from "vitest";
import { channels } from "./ipc.js";
import { defaultSettings, settingsSchema } from "./settings.js";

it("requires all notification settings on disk and validates each optional IPC patch field", () => {
  const defaults = defaultSettings("00000000-0000-4000-8000-000000000001");
  expect(defaults).toMatchObject({
    schemaVersion: 1,
    notifications: { turnCompletion: "background", approvalRequests: true, questionRequests: true },
  });
  expect(settingsSchema.safeParse({ ...defaults, notifications: undefined }).success).toBe(false);
  expect(
    settingsSchema.safeParse({
      ...defaults,
      notifications: { turnCompletion: "always", approvalRequests: true },
    }).success,
  ).toBe(false);
  const request = channels["app.settings.update"].request;
  for (const turnCompletion of ["never", "background", "always"])
    expect(request.safeParse({ notifications: { turnCompletion } }).success).toBe(true);
  expect(request.safeParse({ notifications: { approvalRequests: false } }).success).toBe(true);
  expect(request.safeParse({ notifications: { questionRequests: false } }).success).toBe(true);
  for (const notifications of [
    { turnCompletion: "foreground" },
    { approvalRequests: "false" },
    { questionRequests: "false" },
    { approvalRequests: true, extra: true },
    null,
  ]) {
    expect(request.safeParse({ notifications }).success).toBe(false);
    expect(settingsSchema.safeParse({ ...defaults, notifications }).success).toBe(false);
  }
});
