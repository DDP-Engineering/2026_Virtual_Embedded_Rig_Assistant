import { expect, it } from "vitest";
import { mergeWorkbench, workbenchPatchSchema, workbenchSchema } from "./workbench.js";

it("defaults to off and keeps independent whole-minute settings for each workbench", () => {
  const original = workbenchSchema.parse({
    format: 1,
    id: "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C",
    name: "Original",
  });
  expect(original.agent.question_timeout_minutes ?? null).toBeNull();
  for (const minutes of [1, 1440]) {
    const saved = mergeWorkbench(original, { agent: { question_timeout_minutes: minutes } });
    expect(workbenchSchema.parse(JSON.parse(JSON.stringify(saved))).agent.question_timeout_minutes).toBe(
      minutes,
    );
    expect(original.agent.question_timeout_minutes ?? null).toBeNull();
    expect(
      mergeWorkbench(saved, { agent: { question_timeout_minutes: null } }).agent.question_timeout_minutes,
    ).toBeNull();
  }
  for (const minutes of [0, -1, 1.5, 1441, "3"]) {
    const agent = { question_timeout_minutes: minutes };
    expect(workbenchPatchSchema.safeParse({ agent }).success).toBe(false);
    expect(workbenchSchema.safeParse({ ...original, agent }).success).toBe(false);
  }
});
