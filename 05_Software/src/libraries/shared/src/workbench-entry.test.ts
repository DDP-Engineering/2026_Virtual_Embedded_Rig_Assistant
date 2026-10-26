import { expect, it } from "vitest";
import * as shared from "./index.js";
import { channels } from "./ipc.js";

it("exposes ordinary workbench contracts without a bundled example endpoint or inventory", () => {
  expect(Object.hasOwn(channels, "workbench.create")).toBe(true);
  expect(Object.hasOwn(channels, "workbench.open")).toBe(true);
  expect(Object.hasOwn(channels, "workbench.demo.open")).toBe(false);
  expect(Object.hasOwn(shared, "demoWorkbench")).toBe(false);
});
