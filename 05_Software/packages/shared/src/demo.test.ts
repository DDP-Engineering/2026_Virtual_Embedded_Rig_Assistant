// REQ-FUNC-66b6fda6: future scenarios; execution deferred by user policy.
import { expect, it } from "vitest";
import { demoWorkbench } from "./demo.js";
import { channels } from "./ipc.js";
import { workbenchIdSchema } from "./workbench.js";

it("opens the host-selected demo with an empty strict request only", () => {
  expect(channels["workbench.demo.open"].request.parse({})).toEqual({});
  for (const request of [{ folder: "/outside" }, { reset: true }, { source: "user" }])
    expect(channels["workbench.demo.open"].request.safeParse(request).success).toBe(false);
  expect(workbenchIdSchema.parse(demoWorkbench.id)).toBe(demoWorkbench.id);
  expect(new Set(demoWorkbench.files).size).toBe(demoWorkbench.files.length);
  expect(demoWorkbench.files.some((path) => path.startsWith(".vera/"))).toBe(false);
});
